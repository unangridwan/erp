-- Fase 1 lanjutan: selisih kurs saat pelunasan, rekonsiliasi bank, aset tetap & penyusutan,
-- tutup buku akhir tahun, dan anggaran.

-- Sisa dalam mata uang dokumen, agar pelunasan valas dapat dideteksi lunas walau kurs berubah.

-- Pengaman baris posted juga mengizinkan pembaruan sisa mata uang dokumen.
create or replace function erp_guard_posted_lines() returns trigger language plpgsql as $$
declare
  st text;
begin
  if current_setting('erp.purge', true) = 'on' and current_user <> 'app_user' then
    return coalesce(new, old);
  end if;
  select state into st from account_moves where id = coalesce(new.move_id, old.move_id);
  if st = 'posted' then
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'amount_residual' - 'amount_residual_currency' - 'reconciled' - 'balance')
           = (to_jsonb(old) - 'amount_residual' - 'amount_residual_currency' - 'reconciled' - 'balance') then
      return new;
    end if;
    raise exception 'Baris jurnal pada entri yang sudah diposting tidak bisa diubah' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

alter table account_move_lines add column amount_residual_currency numeric(20, 2) not null default 0;
-- Backfill oleh pemilik schema (melewati pengaman baris posted, hanya di transaksi migrasi ini).
set local erp.purge = 'on';
update account_move_lines
  set amount_residual_currency = round(amount_currency * amount_residual / balance, 2)
  where amount_residual <> 0 and balance <> 0;
set local erp.purge = 'off';

-- Akun laba/rugi selisih kurs per perusahaan.
alter table accounting_settings
  add column fx_gain_account_id uuid,
  add column fx_loss_account_id uuid,
  add foreign key (tenant_id, fx_gain_account_id) references accounts (tenant_id, id),
  add foreign key (tenant_id, fx_loss_account_id) references accounts (tenant_id, id);
update accounting_settings s set
  fx_gain_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '4-9100'),
  fx_loss_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '7-1100');

-- Entri penutup tahun fiskal (P/L → saldo laba). Satu per perusahaan per tahun.
alter table account_moves add column closing_year smallint;
create unique index account_moves_closing_uq on account_moves (company_id, closing_year) where closing_year is not null;

-- Entri penutup dibuat bersamaan dengan penguncian periode sampai akhir tahun fiskal (satu transaksi), sehingga
-- pemeriksaan lock date di akhir transaksi tidak berlaku untuknya.
create or replace function erp_check_posted_move() returns trigger language plpgsql as $$
declare
  d numeric;
  c numeric;
  n int;
  lock date;
begin
  if new.state <> 'posted' then
    return null;
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into d, c, n
    from account_move_lines where move_id = new.id;
  if n < 2 or d <> c or d = 0 then
    raise exception 'Entri jurnal tidak seimbang (debit %, kredit %, % baris)', d, c, n using errcode = 'check_violation';
  end if;
  select lock_date into lock from accounting_settings where company_id = new.company_id;
  if lock is not null and new.date <= lock and new.closing_year is null then
    raise exception 'Periode sudah dikunci sampai %; entri bertanggal % tidak bisa diposting', lock, new.date
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

-- ---- Rekonsiliasi bank ----
create table bank_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  journal_id uuid not null,
  name text not null,
  date date not null,
  balance_start numeric(20, 2),
  balance_end numeric(20, 2),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, journal_id) references journals (tenant_id, id)
);

create table bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  statement_id uuid not null,
  sequence integer not null default 0,
  date date not null,
  payment_ref text not null,
  partner_name text,
  -- Positif = uang masuk, negatif = uang keluar.
  amount numeric(20, 2) not null check (amount <> 0),
  partner_id uuid,
  -- Entri jurnal hasil rekonsiliasi; null = belum direkonsiliasi.
  move_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, statement_id) references bank_statements (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);
create index bank_statement_lines_open_idx on bank_statement_lines (tenant_id, statement_id) where move_id is null;

-- ---- Aset tetap ----
create table assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text,
  name text not null,
  state text not null default 'draft' check (state in ('draft', 'running', 'closed')),
  method text not null default 'straight_line' check (method in ('straight_line', 'declining_balance')),
  acquisition_date date not null,
  first_depreciation_date date not null,
  cost numeric(20, 2) not null check (cost > 0),
  salvage_value numeric(20, 2) not null default 0 check (salvage_value >= 0),
  useful_life_months integer not null check (useful_life_months between 1 and 1200),
  asset_account_id uuid not null,
  depreciation_account_id uuid not null,
  expense_account_id uuid not null,
  journal_id uuid not null,
  branch_id uuid,
  business_unit_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (salvage_value < cost),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, asset_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, depreciation_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, expense_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, journal_id) references journals (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id)
);

create table asset_depreciation_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  asset_id uuid not null,
  sequence integer not null,
  date date not null,
  amount numeric(20, 2) not null,
  accumulated numeric(20, 2) not null,
  book_value numeric(20, 2) not null,
  move_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);
create unique index asset_depreciation_lines_seq_uq on asset_depreciation_lines (asset_id, sequence);

-- ---- Anggaran ----
create table budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id)
);

create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  budget_id uuid not null,
  account_id uuid not null,
  business_unit_id uuid,
  branch_id uuid,
  -- Jumlah yang direncanakan (positif untuk pendapatan maupun beban).
  amount numeric(20, 2) not null,
  unique (tenant_id, id),
  foreign key (tenant_id, budget_id) references budgets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['bank_statements', 'bank_statement_lines', 'assets', 'asset_depreciation_lines', 'budgets', 'budget_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
