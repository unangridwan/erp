-- Fase 2: CRM (lead/peluang, tahapan pipeline, alasan kalah, tim penjualan, aktivitas terjadwal)
-- dan penjualan (termin pembayaran, daftar harga, penawaran/sales order, penagihan dari SO).

create table crm_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  sequence integer not null default 10,
  probability numeric(5, 2) not null default 10 check (probability between 0 and 100),
  is_won boolean not null default false,
  fold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table crm_lost_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table sales_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid,
  name text not null,
  leader_id uuid,
  -- Anggota tim (user); divalidasi aplikasi karena array tidak bisa memakai FK.
  member_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, leader_id) references users (tenant_id, id) on delete set null (leader_id)
);

create table payment_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  days integer not null default 0 check (days between 0 and 3650),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table pricelists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid,
  name text not null,
  currency_code text not null default 'IDR' references currencies(code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id)
);

-- Aturan harga: produk tertentu > kategori > semua produk; berlaku bila kuantitas ≥ minimum dan tanggal dalam rentang.
create table pricelist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  pricelist_id uuid not null,
  product_id uuid,
  category_id uuid,
  min_quantity numeric(18, 4) not null default 0,
  compute text not null default 'discount' check (compute in ('fixed', 'discount')),
  fixed_price numeric(20, 4),
  discount numeric(7, 4) not null default 0 check (discount between -1000 and 100),
  date_start date,
  date_end date,
  created_at timestamptz not null default now(),
  check (compute <> 'fixed' or fixed_price is not null),
  check (date_end is null or date_start is null or date_end >= date_start),
  unique (tenant_id, id),
  foreign key (tenant_id, pricelist_id) references pricelists (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, category_id) references product_categories (tenant_id, id) on delete cascade
);

-- Default penjualan per partner.
alter table partners
  add column payment_term_id uuid,
  add column pricelist_id uuid,
  add column salesperson_id uuid,
  add foreign key (tenant_id, payment_term_id) references payment_terms (tenant_id, id) on delete set null (payment_term_id),
  add foreign key (tenant_id, pricelist_id) references pricelists (tenant_id, id) on delete set null (pricelist_id),
  add foreign key (tenant_id, salesperson_id) references users (tenant_id, id) on delete set null (salesperson_id);

create table crm_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  lead_type text not null default 'opportunity' check (lead_type in ('lead', 'opportunity')),
  name text not null,
  partner_id uuid,
  contact_name text,
  partner_name text,
  email text,
  phone text,
  source text check (source in ('website', 'referral', 'event', 'ads', 'social', 'cold_call', 'other')),
  stage_id uuid,
  user_id uuid,
  team_id uuid,
  expected_revenue numeric(20, 2) not null default 0 check (expected_revenue >= 0),
  probability numeric(5, 2) not null default 10 check (probability between 0 and 100),
  expected_close date,
  priority smallint not null default 0 check (priority between 0 and 3),
  state text not null default 'open' check (state in ('open', 'won', 'lost')),
  lost_reason_id uuid,
  lost_note text,
  closed_at timestamptz,
  description text,
  branch_id uuid,
  business_unit_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, stage_id) references crm_stages (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, team_id) references sales_teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, lost_reason_id) references crm_lost_reasons (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id)
);
create index crm_leads_pipeline_idx on crm_leads (tenant_id, company_id, state, stage_id);

-- Aktivitas terjadwal (telepon, rapat, email, to-do) untuk dokumen apa pun.
create table scheduled_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  res_model text not null,
  res_id uuid not null,
  activity_type text not null default 'todo' check (activity_type in ('call', 'meeting', 'email', 'todo')),
  summary text not null,
  note text,
  due_date date not null,
  user_id uuid not null,
  done_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create index scheduled_activities_res_idx on scheduled_activities (tenant_id, res_model, res_id);
create index scheduled_activities_todo_idx on scheduled_activities (tenant_id, user_id, due_date) where done_at is null;

create table sale_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  state text not null default 'draft' check (state in ('draft', 'sent', 'sale', 'cancel')),
  partner_id uuid not null,
  date_order date not null,
  validity_date date,
  payment_term_id uuid,
  pricelist_id uuid,
  currency_code text not null references currencies(code),
  user_id uuid,
  team_id uuid,
  lead_id uuid,
  client_order_ref text,
  note text,
  branch_id uuid,
  business_unit_id uuid,
  amount_untaxed numeric(20, 2) not null default 0,
  amount_tax numeric(20, 2) not null default 0,
  amount_total numeric(20, 2) not null default 0,
  invoice_status text not null default 'no' check (invoice_status in ('no', 'to_invoice', 'invoiced')),
  confirmed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, payment_term_id) references payment_terms (tenant_id, id),
  foreign key (tenant_id, pricelist_id) references pricelists (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, team_id) references sales_teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, lead_id) references crm_leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index sale_orders_name_uq on sale_orders (company_id, name);
create index sale_orders_list_idx on sale_orders (tenant_id, company_id, state, date_order desc);

create table sale_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  order_id uuid not null,
  sequence integer not null default 0,
  product_id uuid,
  name text not null,
  quantity numeric(18, 4) not null default 1 check (quantity >= 0),
  price_unit numeric(20, 4) not null default 0,
  discount numeric(7, 4) not null default 0 check (discount between 0 and 100),
  tax_ids uuid[] not null default '{}',
  price_subtotal numeric(20, 2) not null default 0,
  -- Baris uang muka dibuat otomatis saat menagih DP; kuantitas dipesan 0, kuantitas tertagih ±1.
  is_downpayment boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references sale_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);
create index sale_order_lines_order_idx on sale_order_lines (order_id);

-- Hubungan baris faktur ↔ baris SO (untuk kuantitas tertagih & status penagihan).
alter table account_move_lines
  add column sale_line_id uuid,
  add foreign key (tenant_id, sale_line_id) references sale_order_lines (tenant_id, id);
create index aml_sale_line_idx on account_move_lines (sale_line_id) where sale_line_id is not null;
alter table account_moves add column invoice_origin text;

-- Pajak bawaan & akun uang muka per perusahaan.
alter table accounting_settings
  add column default_sale_tax_id uuid,
  add column default_purchase_tax_id uuid,
  add column down_payment_account_id uuid,
  add foreign key (tenant_id, default_sale_tax_id) references taxes (tenant_id, id) on delete set null (default_sale_tax_id),
  add foreign key (tenant_id, default_purchase_tax_id) references taxes (tenant_id, id) on delete set null (default_purchase_tax_id),
  add foreign key (tenant_id, down_payment_account_id) references accounts (tenant_id, id);

-- Backfill untuk perusahaan yang sudah ada (dijalankan oleh pemilik schema).
update accounting_settings s set
  default_sale_tax_id = (select id from taxes t where t.company_id = s.company_id and t.name = 'PPN Keluaran 12% (DPP 11/12)'),
  default_purchase_tax_id = (select id from taxes t where t.company_id = s.company_id and t.name = 'PPN Masukan 12% (DPP 11/12)'),
  down_payment_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '2-1600');

insert into crm_stages (tenant_id, name, sequence, probability, is_won)
select t.id, s.name, s.seq, s.prob, s.won
from tenants t
cross join (values ('Baru', 10, 10, false), ('Kualifikasi', 20, 30, false), ('Proposal', 30, 60, false),
                   ('Negosiasi', 40, 80, false), ('Menang', 50, 100, true)) as s(name, seq, prob, won);
insert into crm_lost_reasons (tenant_id, name)
select t.id, r.name from tenants t
cross join (values ('Harga terlalu tinggi'), ('Memilih pesaing'), ('Tidak ada anggaran'), ('Tidak ada respons')) as r(name);
insert into payment_terms (tenant_id, name, days)
select t.id, p.name, p.days from tenants t
cross join (values ('Tunai', 0), ('Net 14 hari', 14), ('Net 30 hari', 30), ('Net 60 hari', 60)) as p(name, days);

do $$
declare t text;
begin
  foreach t in array array['crm_stages', 'crm_lost_reasons', 'sales_teams', 'payment_terms', 'pricelists', 'pricelist_items',
                           'crm_leads', 'scheduled_activities', 'sale_orders', 'sale_order_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
