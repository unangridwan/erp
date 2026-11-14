-- Maintenance aset: peralatan, rencana perawatan berkala (hari/meter), permintaan perbaikan (preventif & korektif),
-- suku cadang dari gudang, jasa vendor, downtime & laporan MTBF/MTTR.

create table maintenance_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  member_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 40),
  name text not null check (char_length(name) between 1 and 160),
  category text check (char_length(category) <= 80),
  asset_id uuid,
  work_center_id uuid,
  location text check (char_length(location) <= 160),
  branch_id uuid,
  business_unit_id uuid,
  cost_center_id uuid,
  serial_no text check (char_length(serial_no) <= 120),
  vendor_id uuid,
  warranty_until date,
  team_id uuid,
  technician_user_id uuid,
  meter_unit text check (meter_unit in ('hours', 'km', 'cycles')),
  meter numeric(14, 1) not null default 0 check (meter >= 0),
  state text not null default 'operational' check (state in ('operational', 'down', 'retired')),
  criticality text not null default 'medium' check (criticality in ('low', 'medium', 'high')),
  note text check (char_length(note) <= 2000),
  custom jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, asset_id) references assets (tenant_id, id) on delete set null (asset_id),
  foreign key (tenant_id, work_center_id) references work_centers (tenant_id, id) on delete set null (work_center_id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete set null (branch_id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id) on delete set null (business_unit_id),
  foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete set null (cost_center_id),
  foreign key (tenant_id, vendor_id) references partners (tenant_id, id) on delete set null (vendor_id),
  foreign key (tenant_id, team_id) references maintenance_teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, technician_user_id) references users (tenant_id, id) on delete set null (technician_user_id)
);
create unique index equipment_code_uq on equipment (tenant_id, company_id, lower(code));

create table equipment_meter_readings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  equipment_id uuid not null,
  date date not null,
  value numeric(14, 1) not null check (value >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, equipment_id) references equipment (tenant_id, id) on delete cascade
);
create index equipment_meter_readings_idx on equipment_meter_readings (equipment_id, date desc);

create table maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  equipment_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  interval_days integer check (interval_days between 1 and 3650),
  interval_meter numeric(14, 1) check (interval_meter > 0),
  lead_days integer not null default 0 check (lead_days between 0 and 90),
  start_date date not null default current_date,
  last_done_date date,
  last_done_meter numeric(14, 1),
  -- [{label}] tugas yang harus dicentang saat mengerjakan.
  tasks jsonb not null default '[]',
  duration_hours numeric(8, 2),
  team_id uuid,
  technician_user_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (interval_days is not null or interval_meter is not null),
  foreign key (tenant_id, equipment_id) references equipment (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references maintenance_teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, technician_user_id) references users (tenant_id, id) on delete set null (technician_user_id)
);

create table maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  equipment_id uuid not null,
  kind text not null default 'corrective' check (kind in ('preventive', 'corrective')),
  plan_id uuid,
  -- Kunci siklus rencana (tanggal jatuh tempo / meter) agar request preventif dibuat sekali per siklus.
  plan_cycle text,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requested_by uuid,
  team_id uuid,
  technician_user_id uuid,
  scheduled_date date,
  state text not null default 'new' check (state in ('new', 'scheduled', 'in_progress', 'done', 'cancelled')),
  breakdown_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  downtime_hours numeric(10, 2),
  -- [{label, done}] hasil checklist.
  checklist jsonb not null default '[]',
  resolution text check (char_length(resolution) <= 5000),
  labor_hours numeric(8, 2),
  labor_cost numeric(20, 2) not null default 0 check (labor_cost >= 0),
  vendor_id uuid,
  vendor_cost numeric(20, 2) not null default 0 check (vendor_cost >= 0),
  move_id uuid,
  parts_cost numeric(20, 2) not null default 0,
  parts_move_id uuid,
  custom jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, equipment_id) references equipment (tenant_id, id) on delete restrict,
  foreign key (tenant_id, plan_id) references maintenance_plans (tenant_id, id) on delete set null (plan_id),
  foreign key (tenant_id, team_id) references maintenance_teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, technician_user_id) references users (tenant_id, id) on delete set null (technician_user_id),
  foreign key (tenant_id, vendor_id) references partners (tenant_id, id) on delete set null (vendor_id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id) on delete set null (move_id),
  foreign key (tenant_id, parts_move_id) references account_moves (tenant_id, id) on delete set null (parts_move_id)
);
create unique index maintenance_requests_cycle_uq on maintenance_requests (plan_id, plan_cycle)
  where plan_cycle is not null and state <> 'cancelled';
create index maintenance_requests_equipment_idx on maintenance_requests (equipment_id, created_at desc);

create table maintenance_parts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  request_id uuid not null,
  product_id uuid not null,
  quantity numeric(16, 4) not null check (quantity > 0),
  location_id uuid,
  lot_name text check (char_length(lot_name) <= 120),
  cost numeric(20, 2),
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references maintenance_requests (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete restrict,
  foreign key (tenant_id, location_id) references stock_locations (tenant_id, id) on delete set null (location_id)
);

create table maintenance_settings (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  expense_account_id uuid,
  parts_location_id uuid,
  primary key (tenant_id, company_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, expense_account_id) references accounts (tenant_id, id) on delete set null (expense_account_id),
  foreign key (tenant_id, parts_location_id) references stock_locations (tenant_id, id) on delete set null (parts_location_id)
);

-- Peralatan & permintaan perbaikan ikut field kustom dan aturan otomatis.
alter table custom_fields drop constraint custom_fields_model_check;
alter table custom_fields add constraint custom_fields_model_check check (model in ('partner', 'product', 'employee',
  'fleet_vehicle', 'crm_lead', 'sale_order', 'purchase_order', 'account_move', 'stock_picking', 'production_order',
  'equipment', 'maintenance_request'));
alter table automation_rules drop constraint automation_rules_model_check;
alter table automation_rules add constraint automation_rules_model_check check (model in ('partner', 'product',
  'employee', 'fleet_vehicle', 'crm_lead', 'sale_order', 'purchase_order', 'account_move', 'stock_picking',
  'production_order', 'equipment', 'maintenance_request'));
create trigger automation_event after insert or update on equipment
  for each row execute function erp_automation_event('equipment');
create trigger automation_event after insert or update on maintenance_requests
  for each row execute function erp_automation_event('maintenance_request');

do $$
declare t text;
begin
  foreach t in array array['maintenance_teams', 'equipment', 'equipment_meter_readings', 'maintenance_plans',
                           'maintenance_requests', 'maintenance_parts', 'maintenance_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
