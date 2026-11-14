-- Inspeksi mutu (QM): titik kontrol per produk/kategori/pemasok saat penerimaan & hasil produksi, pemeriksaan dengan
-- checklist & nilai ukur + foto, karantina, keputusan (terima / terima bersyarat / retur / scrap), dan NCR.

alter table warehouses add column quarantine_location_id uuid;
alter table warehouses add foreign key (tenant_id, quarantine_location_id)
  references stock_locations (tenant_id, id) on delete set null (quarantine_location_id);

create table quality_points (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  trigger text not null check (trigger in ('receipt', 'production')),
  -- Kosong = semua produk (dalam kategori bila diisi).
  product_id uuid,
  category_id uuid,
  -- Hanya untuk penerimaan: kosong = semua pemasok.
  partner_id uuid,
  sampling text not null default 'all' check (sampling in ('all', 'percent', 'quantity')),
  sample_value numeric(12, 2) check (sample_value > 0),
  -- [{label, kind: pass_fail|measure, min, max, unit, photo}]
  items jsonb not null default '[]',
  instructions text check (char_length(instructions) <= 5000),
  quarantine boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, category_id) references product_categories (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade
);

create table quality_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  point_id uuid,
  trigger text not null check (trigger in ('receipt', 'production')),
  picking_id uuid,
  stock_move_id uuid,
  production_order_id uuid,
  product_id uuid not null,
  partner_id uuid,
  -- [{lotId, quantity}] barang yang ditahan.
  lots jsonb not null default '[]',
  quantity numeric(16, 4) not null check (quantity > 0),
  sample_qty numeric(16, 4) not null check (sample_qty > 0),
  -- Lokasi barang saat diperiksa (karantina) & tujuan bila diterima.
  location_id uuid not null,
  dest_location_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'passed', 'failed', 'conditional')),
  -- [{label, kind, value, passed, note, min, max, unit, photo}]
  results jsonb not null default '[]',
  decision text check (decision in ('accept', 'conditional', 'return', 'scrap')),
  note text check (char_length(note) <= 5000),
  inspector_id uuid,
  decided_at timestamptz,
  return_picking_id uuid,
  scrap_move_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, point_id) references quality_points (tenant_id, id) on delete set null (point_id),
  foreign key (tenant_id, picking_id) references stock_pickings (tenant_id, id) on delete set null (picking_id),
  foreign key (tenant_id, production_order_id) references production_orders (tenant_id, id) on delete set null (production_order_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete restrict,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete set null (partner_id),
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, dest_location_id) references stock_locations (tenant_id, id),
  foreign key (tenant_id, return_picking_id) references stock_pickings (tenant_id, id) on delete set null (return_picking_id),
  foreign key (tenant_id, scrap_move_id) references account_moves (tenant_id, id) on delete set null (scrap_move_id)
);
create index quality_checks_state_idx on quality_checks (company_id, state);

create table quality_check_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  check_id uuid not null,
  item_index integer,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, check_id) references quality_checks (tenant_id, id) on delete cascade
);

-- Catatan ketidaksesuaian (NCR).
create table quality_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  check_id uuid,
  product_id uuid,
  partner_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  root_cause text check (char_length(root_cause) <= 5000),
  corrective_action text check (char_length(corrective_action) <= 5000),
  responsible_user_id uuid,
  state text not null default 'open' check (state in ('open', 'in_progress', 'closed')),
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, check_id) references quality_checks (tenant_id, id) on delete set null (check_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete set null (product_id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete set null (partner_id),
  foreign key (tenant_id, responsible_user_id) references users (tenant_id, id) on delete set null (responsible_user_id)
);

do $$
declare t text;
begin
  foreach t in array array['quality_points', 'quality_checks', 'quality_check_photos', 'quality_alerts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
