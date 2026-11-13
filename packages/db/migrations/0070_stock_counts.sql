-- Stock opname (sesi hitung fisik): snapshot stok sistem → hitung (manual/scan/impor) → persetujuan selisih →
-- posting penyesuaian (jurnal selisih persediaan).

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  warehouse_id uuid not null,
  -- Lokasi akar yang dihitung (beserta sublokasinya); kosong = stok gudang.
  location_id uuid not null,
  -- Cycle count: hanya kategori produk ini (beserta subkategori); kosong = semua produk (opname penuh).
  category_id uuid,
  date date not null,
  state text not null default 'draft'
    check (state in ('draft', 'counting', 'in_approval', 'approved', 'done', 'cancel')),
  approval_request_id uuid,
  note text check (char_length(note) <= 1000),
  started_at timestamptz,
  posted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, category_id) references product_categories (tenant_id, id),
  foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index stock_counts_name_uq on stock_counts (company_id, name);

create table stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  count_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  -- Lot/serial yang ditemukan saat hitung tetapi belum ada di sistem (dibuat saat posting).
  lot_name text check (char_length(lot_name) <= 100),
  system_qty numeric(18, 4) not null default 0,
  counted_qty numeric(18, 4) check (counted_qty >= 0),
  -- Biaya per unit saat snapshot (untuk nilai selisih).
  unit_cost numeric(20, 4) not null default 0,
  note text check (char_length(note) <= 300),
  counted_by uuid,
  counted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, count_id) references stock_counts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, lot_id) references stock_lots (tenant_id, id),
  foreign key (tenant_id, counted_by) references users (tenant_id, id) on delete set null (counted_by)
);
create unique index stock_count_lines_uq
  on stock_count_lines (count_id, product_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(lot_name, ''));

create index products_barcode_idx on products (tenant_id, barcode) where barcode is not null;

do $$
declare t text;
begin
  foreach t in array array['stock_counts', 'stock_count_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
