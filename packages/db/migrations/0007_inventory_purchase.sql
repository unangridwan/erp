-- Fase 3: persediaan (gudang, lokasi, transfer, lot/serial, quant, valuasi FIFO/average)
-- dan pembelian (harga pemasok, RFQ/purchase order, penerimaan, tagihan dari PO).

-- ---- Produk ----
alter table products
  add column tracking text not null default 'none' check (tracking in ('none', 'lot', 'serial')),
  add column cost_method text not null default 'average' check (cost_method in ('average', 'fifo'));

-- ---- Lokasi & gudang ----
create table stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  parent_id uuid,
  name text not null,
  complete_name text not null,
  -- view = pengelompokan; internal = stok fisik; supplier/customer/inventory = lokasi virtual lawan transaksi.
  usage text not null check (usage in ('view', 'internal', 'supplier', 'customer', 'inventory', 'transit')),
  warehouse_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references stock_locations (tenant_id, id)
);
-- Satu lokasi virtual per jenis per perusahaan.
create unique index stock_locations_virtual_uq on stock_locations (company_id, usage)
  where usage in ('supplier', 'customer', 'inventory');

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null,
  name text not null,
  branch_id uuid,
  view_location_id uuid not null,
  lot_stock_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, view_location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, lot_stock_id) references stock_locations (tenant_id, id)
);
create unique index warehouses_company_code_uq on warehouses (company_id, code);
alter table stock_locations
  add foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id) on delete set null (warehouse_id);

create table stock_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  product_id uuid not null,
  name text not null,
  expiration_date date,
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);
create unique index stock_lots_name_uq on stock_lots (company_id, product_id, name);

-- ---- Pembelian ----
create table product_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid,
  partner_id uuid not null,
  product_id uuid not null,
  product_code text,
  price numeric(20, 4) not null default 0 check (price >= 0),
  currency_code text not null default 'IDR' references currencies(code),
  min_qty numeric(18, 4) not null default 0 check (min_qty >= 0),
  delay_days integer not null default 0 check (delay_days >= 0),
  sequence integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade
);
create index product_suppliers_product_idx on product_suppliers (product_id, sequence);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  -- draft = RFQ, sent = RFQ terkirim, to_approve = menunggu persetujuan, purchase = PO.
  state text not null default 'draft' check (state in ('draft', 'sent', 'to_approve', 'purchase', 'cancel')),
  partner_id uuid not null,
  partner_ref text,
  date_order date not null,
  date_planned date,
  payment_term_id uuid,
  currency_code text not null references currencies(code),
  user_id uuid,
  warehouse_id uuid,
  note text,
  branch_id uuid,
  business_unit_id uuid,
  amount_untaxed numeric(20, 2) not null default 0,
  amount_tax numeric(20, 2) not null default 0,
  amount_total numeric(20, 2) not null default 0,
  approved_by uuid,
  approved_at timestamptz,
  confirmed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, payment_term_id) references payment_terms (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id),
  foreign key (tenant_id, approved_by) references users (tenant_id, id) on delete set null (approved_by),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index purchase_orders_name_uq on purchase_orders (company_id, name);
create index purchase_orders_list_idx on purchase_orders (tenant_id, company_id, state, date_order desc);

create table purchase_order_lines (
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
  date_planned date,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references purchase_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);
create index purchase_order_lines_order_idx on purchase_order_lines (order_id);

alter table account_move_lines
  add column purchase_line_id uuid,
  add foreign key (tenant_id, purchase_line_id) references purchase_order_lines (tenant_id, id);
create index aml_purchase_line_idx on account_move_lines (purchase_line_id) where purchase_line_id is not null;

alter table sale_orders
  add column warehouse_id uuid,
  add foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id);

-- ---- Transfer & pergerakan stok ----
create table stock_pickings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  picking_type text not null check (picking_type in ('incoming', 'outgoing', 'internal')),
  state text not null default 'draft' check (state in ('draft', 'ready', 'done', 'cancel')),
  warehouse_id uuid not null,
  partner_id uuid,
  location_id uuid not null,
  location_dest_id uuid not null,
  scheduled_date date not null,
  date_done timestamptz,
  origin text,
  sale_order_id uuid,
  purchase_order_id uuid,
  return_of_id uuid,
  backorder_of_id uuid,
  note text,
  -- Jurnal valuasi yang dibuat saat transfer divalidasi.
  account_move_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, location_dest_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, sale_order_id) references sale_orders (tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references purchase_orders (tenant_id, id),
  foreign key (tenant_id, return_of_id) references stock_pickings (tenant_id, id),
  foreign key (tenant_id, backorder_of_id) references stock_pickings (tenant_id, id),
  foreign key (tenant_id, account_move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index stock_pickings_name_uq on stock_pickings (company_id, name);
create index stock_pickings_list_idx on stock_pickings (tenant_id, company_id, picking_type, state, scheduled_date desc);

create table stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  picking_id uuid,
  product_id uuid not null,
  name text not null,
  -- Kuantitas diminta & kuantitas yang benar-benar dipindahkan.
  quantity numeric(18, 4) not null check (quantity >= 0),
  quantity_done numeric(18, 4) not null default 0 check (quantity_done >= 0),
  location_id uuid not null,
  location_dest_id uuid not null,
  state text not null default 'draft' check (state in ('draft', 'ready', 'done', 'cancel')),
  -- Harga beli per unit (mata uang perusahaan) untuk penerimaan; null = pakai biaya produk saat ini.
  price_unit numeric(20, 4),
  -- Hasil valuasi saat selesai: biaya per unit & nilai total (positif).
  unit_cost numeric(20, 4),
  value numeric(20, 2),
  sale_line_id uuid,
  purchase_line_id uuid,
  origin_return_move_id uuid,
  is_inventory boolean not null default false,
  reference text,
  date timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, picking_id) references stock_pickings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, location_dest_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, sale_line_id) references sale_order_lines (tenant_id, id),
  foreign key (tenant_id, purchase_line_id) references purchase_order_lines (tenant_id, id),
  foreign key (tenant_id, origin_return_move_id) references stock_moves (tenant_id, id)
);
create index stock_moves_picking_idx on stock_moves (picking_id);
create index stock_moves_product_idx on stock_moves (company_id, product_id, state, date);
create index stock_moves_sale_line_idx on stock_moves (sale_line_id) where sale_line_id is not null;
create index stock_moves_purchase_line_idx on stock_moves (purchase_line_id) where purchase_line_id is not null;

-- Rincian lot/serial per pergerakan (hanya untuk produk ber-tracking).
create table stock_move_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  move_id uuid not null,
  lot_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unique (tenant_id, id),
  foreign key (tenant_id, move_id) references stock_moves (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lot_id) references stock_lots (tenant_id, id)
);
create index stock_move_lines_move_idx on stock_move_lines (move_id);

create table stock_quants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  quantity numeric(18, 4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, lot_id) references stock_lots (tenant_id, id)
);
create unique index stock_quants_uq on stock_quants (location_id, product_id, lot_id) nulls not distinct;
create index stock_quants_product_idx on stock_quants (company_id, product_id);

-- Lapisan valuasi: masuk (+) dan keluar (−). Sisa kuantitas/nilai pada lapisan masuk dipakai FIFO.
create table stock_valuation_layers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  product_id uuid not null,
  stock_move_id uuid,
  quantity numeric(18, 4) not null,
  unit_cost numeric(20, 4) not null,
  value numeric(20, 2) not null,
  remaining_qty numeric(18, 4) not null default 0,
  remaining_value numeric(20, 2) not null default 0,
  description text,
  account_move_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, stock_move_id) references stock_moves (tenant_id, id),
  foreign key (tenant_id, account_move_id) references account_moves (tenant_id, id)
);
create index svl_product_idx on stock_valuation_layers (company_id, product_id, created_at);
create index svl_fifo_idx on stock_valuation_layers (company_id, product_id, created_at) where remaining_qty > 0;

-- Biaya rata-rata per produk per perusahaan (metode average).
create table product_company_costs (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  product_id uuid not null,
  average_cost numeric(20, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, product_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade
);

create table stock_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  warehouse_id uuid not null,
  product_id uuid not null,
  min_qty numeric(18, 4) not null default 0 check (min_qty >= 0),
  max_qty numeric(18, 4) not null default 0 check (max_qty >= 0),
  qty_multiple numeric(18, 4) not null default 1 check (qty_multiple > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade
);
create unique index stock_reorder_rules_uq on stock_reorder_rules (warehouse_id, product_id);

-- ---- Akuntansi persediaan ----
alter table accounting_settings
  add column stock_valuation_account_id uuid,
  add column stock_input_account_id uuid,
  add column cogs_account_id uuid,
  add column stock_adjustment_account_id uuid,
  add column stock_journal_id uuid,
  -- PO dengan total (mata uang perusahaan) di atas nilai ini butuh persetujuan purchase.approve; null = tanpa persetujuan.
  add column purchase_approval_amount numeric(20, 2),
  add foreign key (tenant_id, stock_valuation_account_id) references accounts (tenant_id, id),
  add foreign key (tenant_id, stock_input_account_id) references accounts (tenant_id, id),
  add foreign key (tenant_id, cogs_account_id) references accounts (tenant_id, id),
  add foreign key (tenant_id, stock_adjustment_account_id) references accounts (tenant_id, id),
  add foreign key (tenant_id, stock_journal_id) references journals (tenant_id, id);

-- Backfill untuk perusahaan yang sudah ada (dijalankan oleh pemilik schema): akun, jurnal, gudang, lokasi.
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, a.code, a.name, a.type
from accounting_settings s
cross join (values ('2-1800', 'Barang Diterima Belum Ditagih', 'liability_current'),
                   ('5-1200', 'Selisih Persediaan', 'expense_direct_cost')) as a(code, name, type)
on conflict (company_id, code) do nothing;
insert into journals (tenant_id, company_id, code, name, journal_type)
select s.tenant_id, s.company_id, 'STJ', 'Valuasi Persediaan', 'general' from accounting_settings s
on conflict (company_id, code) do nothing;
update accounting_settings s set
  stock_valuation_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '1-1400'),
  stock_input_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '2-1800'),
  cogs_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '5-1000'),
  stock_adjustment_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '5-1200'),
  stock_journal_id = (select id from journals j where j.company_id = s.company_id and j.code = 'STJ');

do $$
declare
  c record;
  partner_view uuid;
  virtual_view uuid;
  wh_view uuid;
  wh_stock uuid;
  wh uuid;
begin
  for c in select id, tenant_id from companies loop
    insert into stock_locations (tenant_id, company_id, name, complete_name, usage)
      values (c.tenant_id, c.id, 'Partner', 'Partner', 'view') returning id into partner_view;
    insert into stock_locations (tenant_id, company_id, name, complete_name, usage)
      values (c.tenant_id, c.id, 'Virtual', 'Virtual', 'view') returning id into virtual_view;
    insert into stock_locations (tenant_id, company_id, parent_id, name, complete_name, usage) values
      (c.tenant_id, c.id, partner_view, 'Pemasok', 'Partner/Pemasok', 'supplier'),
      (c.tenant_id, c.id, partner_view, 'Pelanggan', 'Partner/Pelanggan', 'customer'),
      (c.tenant_id, c.id, virtual_view, 'Penyesuaian Persediaan', 'Virtual/Penyesuaian Persediaan', 'inventory');
    insert into stock_locations (tenant_id, company_id, name, complete_name, usage)
      values (c.tenant_id, c.id, 'WH', 'WH', 'view') returning id into wh_view;
    insert into stock_locations (tenant_id, company_id, parent_id, name, complete_name, usage)
      values (c.tenant_id, c.id, wh_view, 'Stok', 'WH/Stok', 'internal') returning id into wh_stock;
    insert into warehouses (tenant_id, company_id, code, name, view_location_id, lot_stock_id)
      values (c.tenant_id, c.id, 'WH', 'Gudang Utama', wh_view, wh_stock) returning id into wh;
    update stock_locations set warehouse_id = wh where id in (wh_view, wh_stock);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['stock_locations', 'warehouses', 'stock_lots', 'product_suppliers', 'purchase_orders',
                           'purchase_order_lines', 'stock_pickings', 'stock_moves', 'stock_move_lines', 'stock_quants',
                           'stock_valuation_layers', 'product_company_costs', 'stock_reorder_rules'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
