-- MRP sederhana: kebutuhan bersih per produk (SO belum terkirim, bahan order produksi terbuka, stok minimum) dikurangi
-- stok & pasokan, diurai per level BOM dengan lead time → usulan order produksi & RFQ yang dikonfirmasi pengguna.

alter table boms add column lead_days integer not null default 0 check (lead_days >= 0);

create table mrp_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  warehouse_id uuid not null,
  -- Permintaan bertanggal sampai batas ini yang diperhitungkan.
  horizon_date date not null,
  proposals integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, warehouse_id) references warehouses (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);

create table mrp_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  run_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('manufacture', 'purchase')),
  level integer not null default 0,
  -- Kebutuhan & pasokan (satuan produk) untuk penjelasan usulan.
  demand numeric(18, 4) not null default 0,
  available numeric(18, 4) not null default 0,
  quantity numeric(18, 4) not null check (quantity > 0),
  date_needed date not null,
  date_start date not null,
  bom_id uuid,
  supplier_id uuid,
  reason text,
  state text not null default 'proposed' check (state in ('proposed', 'done', 'ignored')),
  production_order_id uuid,
  purchase_order_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, run_id) references mrp_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, bom_id) references boms (tenant_id, id) on delete set null (bom_id),
  foreign key (tenant_id, supplier_id) references partners (tenant_id, id),
  foreign key (tenant_id, production_order_id) references production_orders (tenant_id, id) on delete set null (production_order_id),
  foreign key (tenant_id, purchase_order_id) references purchase_orders (tenant_id, id) on delete set null (purchase_order_id)
);
create index mrp_proposals_run_idx on mrp_proposals (run_id);

do $$
declare t text;
begin
  foreach t in array array['mrp_runs', 'mrp_proposals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
