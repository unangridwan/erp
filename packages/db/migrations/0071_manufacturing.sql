-- Manufaktur ringan: stasiun kerja, BOM (multi-level, phantom) dengan operasi, order produksi dengan konsumsi bahan
-- aktual + biaya konversi (jam × tarif stasiun kerja) lewat akun Barang Dalam Proses (WIP).

-- Lokasi virtual Produksi: bahan keluar ke sini, barang jadi masuk dari sini.
alter table stock_locations drop constraint if exists stock_locations_usage_check;
alter table stock_locations
  add constraint stock_locations_usage_check
  check (usage in ('view', 'internal', 'supplier', 'customer', 'inventory', 'transit', 'production'));
drop index if exists stock_locations_virtual_uq;
create unique index stock_locations_virtual_uq on stock_locations (company_id, usage)
  where usage in ('supplier', 'customer', 'inventory', 'production');
insert into stock_locations (tenant_id, company_id, parent_id, name, complete_name, usage)
select v.tenant_id, v.company_id, v.id, 'Produksi', v.complete_name || '/Produksi', 'production'
from stock_locations v
where v.usage = 'view' and v.name = 'Virtual' and v.parent_id is null
  and not exists (select 1 from stock_locations p where p.company_id = v.company_id and p.usage = 'production');

-- Akun WIP & biaya konversi dibebankan.
alter table accounting_settings
  add column wip_account_id uuid,
  add column production_absorption_account_id uuid;
alter table accounting_settings add foreign key (tenant_id, wip_account_id) references accounts (tenant_id, id);
alter table accounting_settings add foreign key (tenant_id, production_absorption_account_id) references accounts (tenant_id, id);
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '1-1450', 'Barang Dalam Proses', 'asset_current'
from accounting_settings s
where not exists (select 1 from accounts a where a.company_id = s.company_id and a.code = '1-1450');
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '5-1300', 'Biaya Konversi Produksi Dibebankan', 'expense_direct_cost'
from accounting_settings s
where not exists (select 1 from accounts a where a.company_id = s.company_id and a.code = '5-1300');
update accounting_settings s set
  wip_account_id = (select a.id from accounts a where a.company_id = s.company_id and a.code = '1-1450'),
  production_absorption_account_id = (select a.id from accounts a where a.company_id = s.company_id and a.code = '5-1300');

create table work_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 30),
  name text not null check (char_length(name) between 1 and 120),
  -- Tarif tenaga kerja + overhead per jam (mata uang perusahaan).
  cost_per_hour numeric(20, 2) not null default 0 check (cost_per_hour >= 0),
  capacity_hours_per_day numeric(6, 2) not null default 8 check (capacity_hours_per_day > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, code),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table boms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  product_id uuid not null,
  code text check (char_length(code) <= 60),
  -- Jumlah hasil per BOM (dalam satuan produk).
  quantity numeric(18, 4) not null default 1 check (quantity > 0),
  -- normal = dibuat lewat order produksi; phantom = kit/sub-rakitan yang langsung diledakkan ke komponennya.
  bom_type text not null default 'normal' check (bom_type in ('normal', 'phantom')),
  active boolean not null default true,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);
create index boms_product_idx on boms (company_id, product_id) where active;

create table bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  bom_id uuid not null,
  sequence integer not null default 0,
  product_id uuid not null,
  -- Kuantitas dalam satuan baris (uom_ratio = rasio ke satuan produk komponen).
  quantity numeric(18, 4) not null check (quantity > 0),
  uom_id uuid references uoms(id),
  uom_ratio numeric(18, 6) not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, bom_id) references boms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);

create table bom_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  bom_id uuid not null,
  sequence integer not null default 0,
  name text not null check (char_length(name) between 1 and 120),
  work_center_id uuid not null,
  -- Menit standar per jumlah hasil BOM.
  minutes numeric(10, 2) not null default 0 check (minutes >= 0),
  unique (tenant_id, id),
  foreign key (tenant_id, bom_id) references boms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, work_center_id) references work_centers (tenant_id, id)
);

create table production_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  product_id uuid not null,
  bom_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  warehouse_id uuid not null,
  location_id uuid not null,
  location_dest_id uuid not null,
  date_planned date not null,
  state text not null default 'draft' check (state in ('draft', 'confirmed', 'in_progress', 'done', 'cancel')),
  qty_produced numeric(18, 4) not null default 0,
  lot_name text check (char_length(lot_name) <= 100),
  origin text check (char_length(origin) <= 200),
  note text check (char_length(note) <= 2000),
  material_cost numeric(20, 2) not null default 0,
  conversion_cost numeric(20, 2) not null default 0,
  unit_cost numeric(20, 4) not null default 0,
  account_move_id uuid,
  date_done timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, bom_id) references boms (tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, location_dest_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, account_move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index production_orders_name_uq on production_orders (company_id, name);

create table production_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  order_id uuid not null,
  sequence integer not null default 0,
  product_id uuid not null,
  -- Dalam satuan produk komponen.
  qty_required numeric(18, 4) not null,
  qty_consumed numeric(18, 4),
  -- Lot yang dipakai: [{lotId, quantity}]; kosong = dipilih otomatis (kedaluwarsa/tertua dulu).
  lots jsonb not null default '[]',
  value numeric(20, 2),
  stock_move_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references production_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);

create table production_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  order_id uuid not null,
  sequence integer not null default 0,
  name text not null,
  work_center_id uuid not null,
  planned_minutes numeric(10, 2) not null default 0,
  actual_minutes numeric(10, 2),
  cost_per_hour numeric(20, 2) not null default 0,
  state text not null default 'pending' check (state in ('pending', 'running', 'done')),
  started_at timestamptz,
  finished_at timestamptz,
  cost numeric(20, 2) not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references production_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, work_center_id) references work_centers (tenant_id, id)
);

alter table stock_moves add column production_order_id uuid,
  add foreign key (tenant_id, production_order_id) references production_orders (tenant_id, id);

do $$
declare t text;
begin
  foreach t in array array['work_centers', 'boms', 'bom_lines', 'bom_operations', 'production_orders',
    'production_components', 'production_operations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
