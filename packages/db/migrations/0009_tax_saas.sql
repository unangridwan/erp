-- Fase 5: lokalisasi pajak (faktur pajak keluaran Coretax, faktur masukan, bukti potong PPh 23 & PPh 21),
-- billing SaaS (paket, langganan, tagihan platform), onboarding, dan sesi login yang bisa dicabut.

-- ---- Data perusahaan & partner untuk Coretax ----

alter table companies
  add column pkp boolean not null default false,
  -- ID TKU 22 digit (NPWP 16 digit + 6 digit tempat usaha, "000000" = pusat).
  add column nitku text,
  add column street text,
  add column city text,
  add column province text,
  add column postal_code text,
  add column phone text,
  add column email text,
  -- Langkah onboarding yang ditandai selesai/dilewati manual, mis. {"tax": "done", "users": "skipped"}.
  add column onboarding jsonb not null default '{}',
  add column onboarding_completed_at timestamptz;

alter table partners
  add column tax_document_type text not null default 'TIN'
    check (tax_document_type in ('TIN', 'National ID', 'Passport', 'Other ID')),
  add column tax_document_number text,
  -- 6 digit tempat usaha pembeli (000000 = pusat) — digabung dengan NPWP menjadi ID TKU.
  add column tku text not null default '000000',
  add column country_code text not null default 'IDN',
  -- Kode transaksi faktur bawaan (04 = DPP nilai lain 11/12, 01 = umum, 02/03 = pemungut, 07/08 = fasilitas).
  add column tax_trx_code text not null default '04';

alter table products add column tax_goods_code text;
alter table uoms add column coretax_code text;

alter table taxes
  add column tax_kind text not null default 'other'
    check (tax_kind in ('vat', 'vat_luxury', 'pph23', 'pph4_2', 'pph22', 'other')),
  -- Kode objek pajak Coretax untuk pajak potong/pungut, mis. "24-104-14".
  add column tax_object_code text;

update taxes t set tax_kind = case
    when a.code in ('1-1500', '2-1200') and t.base_ratio < 1 then 'vat'
    when a.code in ('1-1500', '2-1200') then 'vat_luxury'
    when a.code in ('1-1510', '2-1310') then 'pph23'
    else 'other' end
from accounts a where a.id = t.account_id;

-- Satuan bawaan → kode satuan Coretax.
update uoms set coretax_code = case name
    when 'Pcs' then 'UM.0021' when 'Lusin' then 'UM.0017' when 'kg' then 'UM.0003' when 'g' then 'UM.0004'
    when 'ton' then 'UM.0001' when 'L' then 'UM.0007' when 'm' then 'UM.0013' when 'cm' then 'UM.0015'
    when 'Jam' then 'UM.0027' when 'Hari' then 'UM.0026' else null end;

-- ---- Faktur pajak keluaran ----

create table tax_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  move_id uuid not null,
  state text not null default 'draft' check (state in ('draft', 'exported', 'approved', 'cancelled')),
  trx_code text not null,
  add_info text,
  facility_stamp text,
  custom_doc text,
  invoice_date date not null,
  period_month smallint not null,
  period_year smallint not null,
  ref text not null,
  seller_idtku text not null,
  buyer_tin text not null,
  buyer_document text not null,
  buyer_document_number text,
  buyer_country text not null,
  buyer_name text not null,
  buyer_address text not null,
  buyer_email text,
  buyer_idtku text not null,
  tax_base numeric(20, 2) not null default 0,
  other_tax_base numeric(20, 2) not null default 0,
  vat numeric(20, 2) not null default 0,
  stlg numeric(20, 2) not null default 0,
  -- Nomor faktur dari Coretax (17 digit) setelah faktur diunggah & disetujui.
  efaktur_number text,
  approved_at timestamptz,
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);
create unique index tax_invoices_move_uq on tax_invoices (move_id) where state <> 'cancelled';
create unique index tax_invoices_number_uq on tax_invoices (company_id, efaktur_number) where efaktur_number is not null;
create index tax_invoices_period_idx on tax_invoices (company_id, period_year, period_month);

create table tax_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  tax_invoice_id uuid not null,
  sequence smallint not null default 0,
  opt text not null check (opt in ('A', 'B')),
  code text not null,
  name text not null,
  unit text not null,
  price numeric(20, 2) not null,
  qty numeric(18, 4) not null,
  total_discount numeric(20, 2) not null default 0,
  tax_base numeric(20, 2) not null,
  other_tax_base numeric(20, 2) not null,
  vat_rate numeric(5, 2) not null,
  vat numeric(20, 2) not null,
  stlg_rate numeric(5, 2) not null default 0,
  stlg numeric(20, 2) not null default 0,
  foreign key (tenant_id, tax_invoice_id) references tax_invoices (tenant_id, id) on delete cascade
);

-- Berkas XML yang pernah diekspor (jejak audit apa yang diunggah ke Coretax).
create table tax_export_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('efaktur', 'bppu', 'bpmp')),
  file_name text not null,
  content text not null,
  record_count integer not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id)
);

-- ---- Faktur pajak masukan (diimpor dari Coretax) ----

create table input_tax_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  efaktur_number text not null,
  invoice_date date not null,
  seller_tin text not null,
  seller_name text not null,
  tax_base numeric(20, 2) not null default 0,
  other_tax_base numeric(20, 2) not null default 0,
  vat numeric(20, 2) not null default 0,
  stlg numeric(20, 2) not null default 0,
  coretax_status text,
  partner_id uuid,
  move_id uuid,
  state text not null default 'new' check (state in ('new', 'credited', 'not_credited')),
  credit_month smallint,
  credit_year smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, efaktur_number),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id),
  check ((state = 'credited') = (credit_month is not null and credit_year is not null))
);

-- ---- Bukti potong: BPPU (PPh 23/4(2)/22 dari tagihan) & BPMP (PPh 21 bulanan pegawai tetap) ----

create table withholding_slips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('bppu', 'bpmp')),
  state text not null default 'draft' check (state in ('draft', 'exported', 'approved', 'cancelled')),
  period_month smallint not null,
  period_year smallint not null,
  partner_id uuid,
  employee_id uuid,
  move_id uuid,
  tax_id uuid,
  payslip_id uuid,
  counterpart_name text not null,
  counterpart_tin text,
  counterpart_idtku text,
  ptkp_status text,
  position text,
  tax_object_code text,
  tax_certificate text not null default 'N/A',
  tax_base numeric(20, 2) not null,
  rate numeric(7, 4) not null,
  tax_amount numeric(20, 2) not null,
  document_type text,
  document_number text,
  document_date date,
  withholder_idtku text not null,
  withholding_date date not null,
  bupot_number text,
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, tax_id) references taxes (tenant_id, id),
  foreign key (tenant_id, payslip_id) references payslips (tenant_id, id)
);
create unique index withholding_slips_move_tax_uq on withholding_slips (move_id, tax_id)
  where move_id is not null and state <> 'cancelled';
create unique index withholding_slips_payslip_uq on withholding_slips (payslip_id)
  where payslip_id is not null and state <> 'cancelled';
create index withholding_slips_period_idx on withholding_slips (company_id, kind, period_year, period_month);

-- ---- Billing SaaS ----

-- Global (tanpa RLS): katalog paket.
create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price_monthly numeric(20, 2) not null default 0,
  price_yearly numeric(20, 2) not null default 0,
  -- null = tanpa batas.
  max_users integer,
  max_companies integer,
  modules text[] not null,
  public boolean not null default true,
  sort smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into plans (code, name, description, price_monthly, price_yearly, max_users, max_companies, modules, sort) values
  ('starter', 'Starter', 'Akuntansi, penjualan, pembelian & persediaan untuk usaha kecil',
   499000, 4990000, 5, 1, array['accounting', 'crm', 'sales', 'purchase', 'inventory', 'tax'], 10),
  ('business', 'Bisnis', 'Semua modul operasional termasuk SDM & payroll, multi perusahaan',
   1499000, 14990000, 25, 5, array['accounting', 'crm', 'sales', 'purchase', 'inventory', 'tax', 'hr', 'payroll'], 20),
  ('enterprise', 'Enterprise', 'Tanpa batas pengguna & perusahaan, untuk grup usaha',
   4999000, 49990000, null, null, array['accounting', 'crm', 'sales', 'purchase', 'inventory', 'tax', 'hr', 'payroll'], 30);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null check (status in ('trialing', 'active', 'cancelled', 'suspended')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence billing_invoice_seq;

create table billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null unique,
  plan_id uuid not null references plans(id),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  -- 'new' = langganan pertama/ganti paket (periode mulai saat dibayar), 'renewal' = perpanjangan.
  purpose text not null check (purpose in ('new', 'renewal')),
  amount numeric(20, 2) not null,
  tax numeric(20, 2) not null,
  total numeric(20, 2) not null,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  issued_at timestamptz not null default now(),
  due_at timestamptz not null,
  paid_at timestamptz,
  provider text,
  provider_ref text,
  payment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index billing_invoices_tenant_idx on billing_invoices (tenant_id, issued_at desc);
create unique index billing_invoices_open_uq on billing_invoices (tenant_id) where status = 'open';

-- Tenant yang sudah ada: masa uji coba 30 hari paket Enterprise.
insert into subscriptions (tenant_id, plan_id, status, trial_ends_at)
select t.id, (select id from plans where code = 'enterprise'), 'trialing', now() + interval '30 days' from tenants t;

alter table users add column platform_admin boolean not null default false;
alter table users add column last_login_at timestamptz;

-- Sesi login: perangkat & alamat IP untuk daftar "sesi aktif".
alter table refresh_tokens add column ip text, add column user_agent text;

do $$
declare t text;
begin
  foreach t in array array['tax_invoices', 'tax_invoice_lines', 'tax_export_batches', 'input_tax_invoices',
                           'withholding_slips', 'subscriptions', 'billing_invoices'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  end loop;
  foreach t in array array['tax_invoices', 'tax_invoice_lines', 'tax_export_batches', 'input_tax_invoices',
                           'withholding_slips'] loop
    execute format('alter table %I force row level security', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Langganan & tagihan platform: tenant (app_user) hanya bisa membaca miliknya. Tanpa FORCE, sehingga
-- layanan billing lewat koneksi pemilik (webhook pembayaran, admin platform, penjadwal) bisa lintas tenant.
grant select on plans, subscriptions, billing_invoices to app_user;
