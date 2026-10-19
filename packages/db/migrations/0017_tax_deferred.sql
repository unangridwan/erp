-- Item tunda Fase 5 (pajak): PPnBM per produk, faktur uang muka/pelunasan & pengganti, e-Faktur 3.x (NSFP),
-- nota retur pajak masukan, bukti potong A1.

-- ---- PPnBM ----
alter table taxes drop constraint if exists taxes_tax_kind_check;
alter table taxes add constraint taxes_tax_kind_check
  check (tax_kind in ('vat', 'vat_luxury', 'ppnbm', 'pph23', 'pph4_2', 'pph22', 'other'));

-- Akun & pajak PPnBM untuk perusahaan yang sudah memakai bagan akun bawaan.
insert into accounts (tenant_id, company_id, code, name, account_type)
select a.tenant_id, a.company_id, '2-1210', 'Utang PPnBM', 'liability_current'
from accounts a
where a.code = '2-1200'
  and not exists (select 1 from accounts x where x.company_id = a.company_id and x.code = '2-1210');

insert into taxes (tenant_id, company_id, name, type_tax_use, amount, base_ratio, account_id, tax_kind)
select acc.tenant_id, acc.company_id, r.name, 'sale', r.amount, 1, acc.id, 'ppnbm'
from accounts acc
cross join (values ('PPnBM 10%', 10), ('PPnBM 20%', 20)) as r(name, amount)
where acc.code = '2-1210'
  and not exists (select 1 from taxes t where t.company_id = acc.company_id and t.name = r.name);

-- Tarif PPnBM produk (%, PP 61/2020 & PP 74/2021): baris penjualan otomatis memakai PPN barang mewah + pajak
-- PPnBM perusahaan dengan tarif ini. Disimpan sebagai tarif karena produk bisa dipakai lintas perusahaan.
alter table products add column luxury_tax_rate numeric(5, 2) check (luxury_tax_rate > 0 and luxury_tax_rate <= 200);

-- ---- Faktur pajak keluaran ----
alter table tax_invoices drop constraint if exists tax_invoices_state_check;
alter table tax_invoices add constraint tax_invoices_state_check
  check (state in ('draft', 'exported', 'approved', 'replaced', 'cancelled'));
alter table tax_invoices
  -- 0 = normal, 1 = uang muka, 2 = pelunasan (potongan uang muka dikurangkan dari DPP).
  add column down_payment smallint not null default 0 check (down_payment in (0, 1, 2)),
  add column down_payment_tax_base numeric(20, 2) not null default 0,
  add column down_payment_vat numeric(20, 2) not null default 0,
  add column down_payment_stlg numeric(20, 2) not null default 0,
  -- Faktur pengganti: menunjuk faktur yang diganti beserta nomornya.
  add column replaces_id uuid,
  add column replaced_number text,
  -- e-Faktur 3.x (pra-Coretax): NSFP 13 digit.
  add column nsfp text;
-- Satu faktur pajak asli per faktur penjualan; penggantinya berantai lewat replaces_id (satu pengganti aktif).
drop index if exists tax_invoices_move_uq;
create unique index tax_invoices_move_uq on tax_invoices (move_id) where state <> 'cancelled' and replaces_id is null;
create unique index tax_invoices_replaces_uq on tax_invoices (replaces_id) where state <> 'cancelled';

create table nsfp_ranges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  -- 5 digit pertama NSFP (3 digit kode + 2 digit tahun).
  prefix text not null check (prefix ~ '^\d{5}$'),
  serial_from integer not null,
  serial_to integer not null,
  next_serial integer not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (serial_to >= serial_from and next_serial between serial_from and serial_to + 1),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id)
);

-- ---- Nota retur pajak masukan ----
create table tax_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  move_id uuid not null,
  input_tax_invoice_id uuid,
  state text not null default 'draft' check (state in ('draft', 'exported', 'approved', 'cancelled')),
  return_number text not null,
  return_date date not null,
  period_month smallint not null,
  period_year smallint not null,
  tax_base numeric(20, 2) not null default 0,
  vat numeric(20, 2) not null default 0,
  stlg numeric(20, 2) not null default 0,
  coretax_number text,
  batch_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);
create index tax_returns_move_idx on tax_returns (move_id);

-- ---- Bukti potong A1 ----
alter table withholding_slips drop constraint if exists withholding_slips_kind_check;
alter table withholding_slips add constraint withholding_slips_kind_check check (kind in ('bppu', 'bpmp', 'bpa1'));
alter table withholding_slips
  add column month_start smallint,
  add column month_end smallint,
  -- Rincian penghasilan setahun (gaji, tunjangan lain, premi asuransi, bonus/THR, iuran pensiun).
  add column details jsonb;

alter table tax_export_batches drop constraint if exists tax_export_batches_kind_check;
alter table tax_export_batches add constraint tax_export_batches_kind_check
  check (kind in ('efaktur', 'bppu', 'bpmp', 'bpa1', 'efaktur_legacy', 'retur_legacy'));

do $$
declare t text;
begin
  foreach t in array array['nsfp_ranges', 'tax_returns'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
