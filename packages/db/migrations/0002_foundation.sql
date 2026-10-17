-- Fase 0: RBAC, master data (mata uang, partner, UoM, produk), sequence dokumen, log aktivitas.

-- Mata uang: master global (tanpa tenant).
create table currencies (
  code text primary key,
  name text not null,
  symbol text not null,
  decimals smallint not null default 2
);
insert into currencies (code, name, symbol, decimals) values
  ('IDR', 'Rupiah Indonesia', 'Rp', 0),
  ('USD', 'US Dollar', '$', 2),
  ('SGD', 'Singapore Dollar', 'S$', 2),
  ('EUR', 'Euro', '€', 2),
  ('CNY', 'Chinese Yuan', '¥', 2),
  ('JPY', 'Japanese Yen', '¥', 0);
grant select on currencies to app_user;

-- Kurs per tenant: nilai 1 unit mata uang asing dalam IDR pada tanggal tertentu.
create table currency_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  currency_code text not null references currencies(code),
  rate_date date not null,
  rate numeric(20, 10) not null check (rate > 0),
  created_at timestamptz not null default now()
);
create unique index currency_rates_uq on currency_rates (tenant_id, currency_code, rate_date);

create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roles_tenant_code_uq on roles (tenant_id, code);

-- Kode permission didefinisikan di kode aplikasi (packages/shared/src/permissions.ts); '*' = semua.
create table role_permissions (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

create table user_roles (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);

-- Partner: pelanggan, pemasok, kontak. company_id null = dipakai bersama seluruh grup.
-- ic_company_id terisi bila partner ini mewakili perusahaan lain dalam grup (intercompany).
create table partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid references companies(id),
  parent_id uuid references partners(id),
  kind text not null default 'company' check (kind in ('company', 'person')),
  name text not null,
  is_customer boolean not null default false,
  is_supplier boolean not null default false,
  npwp text,
  email text,
  phone text,
  street text,
  city text,
  province text,
  postal_code text,
  ic_company_id uuid references companies(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partners_tenant_name_idx on partners (tenant_id, name);
create unique index partners_ic_company_uq on partners (tenant_id, ic_company_id) where ic_company_id is not null;

create table uom_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null
);
create unique index uom_categories_uq on uom_categories (tenant_id, name);

-- factor: jumlah satuan referensi dalam 1 satuan ini (Lusin = 12 Pcs → factor 12).
create table uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  category_id uuid not null references uom_categories(id),
  name text not null,
  factor numeric(18, 6) not null default 1 check (factor > 0),
  is_reference boolean not null default false,
  active boolean not null default true
);
create unique index uoms_uq on uoms (tenant_id, category_id, name);
create unique index uoms_one_reference_uq on uoms (category_id) where is_reference;

create table product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  parent_id uuid references product_categories(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid references companies(id),
  sku text not null,
  name text not null,
  product_type text not null default 'storable' check (product_type in ('storable', 'consumable', 'service')),
  category_id uuid references product_categories(id),
  uom_id uuid not null references uoms(id),
  sale_price numeric(18, 2) not null default 0,
  cost numeric(18, 2) not null default 0,
  barcode text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_sku_uq on products (tenant_id, sku);

-- Penomoran dokumen per perusahaan (mis. SO/2026/0001). Diambil dengan row lock agar tidak bentrok.
create table sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  code text not null,
  prefix text not null,
  padding smallint not null default 4,
  next_number integer not null default 1,
  reset_yearly boolean not null default true,
  current_year smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sequences_uq on sequences (company_id, code);

-- Audit trail & chatter untuk semua dokumen (res_model + res_id polymorphic).
create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  res_model text not null,
  res_id uuid not null,
  action text not null,
  user_id uuid references users(id) on delete set null,
  changes jsonb,
  message text,
  created_at timestamptz not null default now()
);
create index activity_logs_res_idx on activity_logs (tenant_id, res_model, res_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['currency_rates', 'roles', 'role_permissions', 'user_roles', 'partners', 'uom_categories',
                           'uoms', 'product_categories', 'products', 'sequences', 'activity_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Log aktivitas bersifat append-only bagi aplikasi.
revoke update, delete on activity_logs from app_user;
