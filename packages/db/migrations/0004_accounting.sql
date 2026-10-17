-- Fase 1: akuntansi inti — bagan akun, jurnal, pajak, entri jurnal (termasuk faktur/tagihan),
-- pembayaran, dan rekonsiliasi. Integritas utama ditegakkan database:
--   * entri posted wajib seimbang (debit = kredit) dan tidak boleh di/sebelum lock date,
--   * entri posted tidak bisa diubah/dihapus (koreksi lewat jurnal balik),
--   * semua rujukan memakai FK komposit (tenant_id, id).

-- Tabel lama yang kini menjadi rujukan butuh kunci unik (tenant_id, id).
do $$
declare t text;
begin
  foreach t in array array['business_units', 'branches', 'products', 'partners', 'companies', 'users'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_tenant_id_uq') then
      execute format('alter table %I add constraint %I unique (tenant_id, id)', t, t || '_tenant_id_uq');
    end if;
  end loop;
end $$;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null,
  name text not null,
  account_type text not null check (account_type in (
    'asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current', 'asset_fixed',
    'liability_payable', 'liability_current', 'liability_non_current',
    'equity', 'equity_unaffected',
    'income', 'income_other',
    'expense', 'expense_direct_cost', 'expense_depreciation', 'expense_other')),
  reconcile boolean not null default false,
  currency_code text references currencies(code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create unique index accounts_company_code_uq on accounts (company_id, code);

create table taxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  type_tax_use text not null check (type_tax_use in ('sale', 'purchase')),
  -- Persen tarif. Negatif = pajak dipotong (mis. PPh 23 -2%).
  amount numeric(9, 4) not null,
  -- Rasio DPP terhadap harga (PMK 131/2024: DPP nilai lain 11/12 untuk PPN 12% non-mewah).
  base_ratio numeric(12, 10) not null default 1 check (base_ratio > 0 and base_ratio <= 1),
  account_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts (tenant_id, id)
);

create table journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null,
  name text not null,
  journal_type text not null check (journal_type in ('sale', 'purchase', 'bank', 'cash', 'general')),
  -- Akun pendapatan/beban bawaan (sale/purchase) atau akun kas/bank (bank/cash).
  default_account_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, default_account_id) references accounts (tenant_id, id)
);
create unique index journals_company_code_uq on journals (company_id, code);

create table accounting_settings (
  company_id uuid primary key,
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  -- Tidak ada entri yang boleh diposting pada/sebelum tanggal ini (tutup buku).
  lock_date date,
  receivable_account_id uuid not null,
  payable_account_id uuid not null,
  ic_receivable_account_id uuid not null,
  ic_payable_account_id uuid not null,
  retained_earnings_account_id uuid not null,
  sale_journal_id uuid not null,
  purchase_journal_id uuid not null,
  general_journal_id uuid not null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, receivable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, payable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, ic_receivable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, ic_payable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, retained_earnings_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, sale_journal_id) references journals (tenant_id, id),
  foreign key (tenant_id, purchase_journal_id) references journals (tenant_id, id),
  foreign key (tenant_id, general_journal_id) references journals (tenant_id, id)
);

create table account_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  journal_id uuid not null,
  -- Nomor diberikan saat posting (mis. INV/2026/0001).
  name text,
  move_type text not null default 'entry' check (move_type in ('entry', 'out_invoice', 'out_refund', 'in_invoice', 'in_refund')),
  state text not null default 'draft' check (state in ('draft', 'posted')),
  date date not null,
  due_date date,
  partner_id uuid,
  ref text,
  narration text,
  currency_code text not null references currencies(code),
  -- Kurs: 1 unit mata uang dokumen dalam mata uang perusahaan.
  currency_rate numeric(20, 10) not null default 1 check (currency_rate > 0),
  amount_untaxed numeric(20, 2) not null default 0,
  amount_tax numeric(20, 2) not null default 0,
  amount_total numeric(20, 2) not null default 0,
  -- Sisa tagihan dalam mata uang perusahaan (faktur/tagihan).
  amount_residual numeric(20, 2) not null default 0,
  payment_state text not null default 'not_paid' check (payment_state in ('not_paid', 'partial', 'paid', 'reversed')),
  reversed_entry_id uuid,
  posted_at timestamptz,
  posted_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, journal_id) references journals (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, reversed_entry_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, posted_by) references users (tenant_id, id) on delete set null (posted_by),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index account_moves_name_uq on account_moves (company_id, journal_id, name) where name is not null;
create index account_moves_list_idx on account_moves (tenant_id, company_id, move_type, date desc);

create table account_move_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  move_id uuid not null,
  company_id uuid not null,
  sequence smallint not null default 0,
  -- product: baris barang/jasa; tax: baris pajak; payment_term: piutang/utang; line: jurnal umum.
  display_type text not null default 'line' check (display_type in ('product', 'tax', 'payment_term', 'line')),
  account_id uuid not null,
  partner_id uuid,
  name text,
  -- Dalam mata uang perusahaan.
  debit numeric(20, 2) not null default 0 check (debit >= 0),
  credit numeric(20, 2) not null default 0 check (credit >= 0),
  balance numeric(20, 2) generated always as (debit - credit) stored,
  -- Dalam mata uang dokumen (bertanda: positif = debit).
  currency_code text not null references currencies(code),
  amount_currency numeric(20, 2) not null default 0,
  -- Detail baris faktur.
  product_id uuid,
  quantity numeric(18, 4),
  price_unit numeric(20, 4),
  discount numeric(7, 4) not null default 0 check (discount >= 0 and discount <= 100),
  tax_ids uuid[] not null default '{}',
  tax_line_id uuid,
  tax_base_amount numeric(20, 2),
  -- Dimensi pelaporan & konsolidasi.
  business_unit_id uuid,
  branch_id uuid,
  ic_company_id uuid,
  -- Rekonsiliasi (akun reconcile = true).
  amount_residual numeric(20, 2) not null default 0,
  reconciled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint aml_not_both_sides check (not (debit > 0 and credit > 0)),
  unique (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, tax_line_id) references taxes (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, ic_company_id) references companies (tenant_id, id)
);
create index aml_move_idx on account_move_lines (move_id);
create index aml_account_idx on account_move_lines (tenant_id, account_id);
create index aml_open_idx on account_move_lines (tenant_id, account_id, partner_id) where not reconciled;

create table partial_reconciles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  debit_line_id uuid not null,
  credit_line_id uuid not null,
  -- Dalam mata uang perusahaan.
  amount numeric(20, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, debit_line_id) references account_move_lines (tenant_id, id),
  foreign key (tenant_id, credit_line_id) references account_move_lines (tenant_id, id)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  journal_id uuid not null,
  partner_id uuid not null,
  payment_type text not null check (payment_type in ('inbound', 'outbound')),
  amount numeric(20, 2) not null check (amount > 0),
  currency_code text not null references currencies(code),
  date date not null,
  memo text,
  move_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, journal_id) references journals (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);

-- Entri posted tidak boleh berubah, kecuali kolom hasil rekonsiliasi. Penghapusan data tenant secara
-- keseluruhan (offboarding) dilakukan pemilik schema dengan `set local erp.purge = 'on'`.
create function erp_guard_posted_move() returns trigger language plpgsql as $$
begin
  if current_setting('erp.purge', true) = 'on' and current_user <> 'app_user' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'Entri jurnal % sudah diposting dan tidak bisa dihapus', coalesce(old.name, old.id::text)
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.state = 'posted'
     and (to_jsonb(new) - 'amount_residual' - 'payment_state' - 'updated_at')
         <> (to_jsonb(old) - 'amount_residual' - 'payment_state' - 'updated_at') then
    raise exception 'Entri jurnal % sudah diposting dan tidak bisa diubah', old.name using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger account_moves_guard before update or delete on account_moves
  for each row execute function erp_guard_posted_move();

create function erp_guard_posted_lines() returns trigger language plpgsql as $$
declare
  st text;
begin
  if current_setting('erp.purge', true) = 'on' and current_user <> 'app_user' then
    return coalesce(new, old);
  end if;
  select state into st from account_moves where id = coalesce(new.move_id, old.move_id);
  if st = 'posted' then
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'amount_residual' - 'reconciled' - 'balance')
           = (to_jsonb(old) - 'amount_residual' - 'reconciled' - 'balance') then
      return new;
    end if;
    raise exception 'Baris jurnal pada entri yang sudah diposting tidak bisa diubah' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger account_move_lines_guard before insert or update or delete on account_move_lines
  for each row execute function erp_guard_posted_lines();

-- Saat posting: minimal dua baris, debit = kredit, dan tanggal setelah lock date. Dicek di akhir transaksi.
create function erp_check_posted_move() returns trigger language plpgsql as $$
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
  if lock is not null and new.date <= lock then
    raise exception 'Periode sudah dikunci sampai %; entri bertanggal % tidak bisa diposting', lock, new.date
      using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger account_moves_posted_check after insert or update on account_moves
  deferrable initially deferred for each row execute function erp_check_posted_move();

do $$
declare t text;
begin
  foreach t in array array['accounts', 'taxes', 'journals', 'accounting_settings', 'account_moves', 'account_move_lines',
                           'partial_reconciles', 'payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
