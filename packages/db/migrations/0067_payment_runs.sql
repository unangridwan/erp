-- Payment run: pembayaran pemasok massal (usulan → persetujuan → eksekusi) dan rekening bank pemasok.

create table partner_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  partner_id uuid not null,
  bank_code text not null default 'other' check (bank_code in ('bca', 'mandiri', 'bri', 'bni', 'other')),
  bank_name text not null check (char_length(bank_name) between 1 and 100),
  -- Kode bank / SWIFT untuk transfer antarbank (opsional).
  bank_identifier text check (char_length(bank_identifier) <= 20),
  account_number text not null check (account_number ~ '^[0-9]{5,34}$'),
  account_holder text not null check (char_length(account_holder) between 1 and 100),
  currency_code text not null default 'IDR',
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, account_number),
  unique (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade
);
create unique index partner_bank_accounts_default_uq on partner_bank_accounts (partner_id) where is_default and active;

create table payment_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  payment_date date not null,
  journal_id uuid not null,
  -- Tagihan jatuh tempo sampai tanggal ini diusulkan.
  due_until date not null,
  state text not null default 'draft' check (state in ('draft', 'in_approval', 'approved', 'done', 'cancel')),
  approval_request_id uuid,
  note text check (char_length(note) <= 500),
  created_by uuid,
  executed_by uuid,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, journal_id) references journals (tenant_id, id),
  foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id)
);

create table payment_run_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  run_id uuid not null,
  partner_id uuid not null,
  bank_account_id uuid,
  -- Tagihan (in_invoice) atau nota kredit pemasok (in_refund, jumlah negatif = mengurangi pembayaran).
  move_id uuid not null,
  amount numeric(20, 2) not null,
  included boolean not null default true,
  state text not null default 'pending' check (state in ('pending', 'paid', 'failed')),
  payment_id uuid,
  error text,
  unique (run_id, move_id),
  foreign key (tenant_id, run_id) references payment_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, bank_account_id) references partner_bank_accounts (tenant_id, id) on delete set null (bank_account_id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);
create index payment_run_lines_move_idx on payment_run_lines (move_id);

do $$
declare t text;
begin
  foreach t in array array['partner_bank_accounts', 'payment_runs', 'payment_run_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Rekening perusahaan untuk jurnal bank (rekening sumber file transfer massal) & corporate ID bank.
alter table journals
  add column bank_account_number text check (bank_account_number ~ '^[0-9]{5,34}$'),
  add column bank_company_code text check (char_length(bank_company_code) <= 30);
