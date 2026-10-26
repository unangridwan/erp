-- Armada: kendaraan operasional, pengemudi, kontrak (sewa/leasing/asuransi), servis, odometer, dokumen STNK/BPKB/KIR,
-- pengingat kedaluwarsa, biaya per kendaraan.

create table fleet_manufacturers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index fleet_manufacturers_name_uq on fleet_manufacturers (tenant_id, lower(name));

create table fleet_models (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  manufacturer_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  category text not null default 'car' check (category in ('car', 'motorcycle', 'pickup', 'truck', 'bus', 'other')),
  seats smallint check (seats between 1 and 100),
  doors smallint check (doors between 0 and 10),
  transmission text check (transmission in ('manual', 'automatic')),
  fuel_type text check (fuel_type in ('gasoline', 'diesel', 'electric', 'hybrid', 'lpg', 'other')),
  horsepower integer check (horsepower >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, manufacturer_id) references fleet_manufacturers (tenant_id, id) on delete restrict
);

-- Jenis layanan/kontrak (sewa, asuransi, servis berkala, perpanjangan STNK, ...); akun beban opsional untuk tagihan.
create table fleet_service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  category text not null default 'service' check (category in ('contract', 'service', 'both')),
  account_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts (tenant_id, id) on delete set null (account_id)
);

create table fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  license_plate text not null check (char_length(license_plate) between 1 and 20),
  model_id uuid not null,
  state text not null default 'registered' check (state in ('new_request', 'to_order', 'registered', 'downgraded')),
  -- Dimensi analitik pembebanan biaya.
  branch_id uuid,
  business_unit_id uuid,
  manager_user_id uuid,
  driver_employee_id uuid,
  next_driver_employee_id uuid,
  vin text check (char_length(vin) <= 255),
  engine_no text check (char_length(engine_no) <= 255),
  model_year smallint check (model_year between 1950 and 2200),
  color text check (char_length(color) <= 255),
  location text check (char_length(location) <= 255),
  odometer numeric(12, 1) not null default 0 check (odometer >= 0),
  odometer_unit text not null default 'km' check (odometer_unit in ('km', 'mi')),
  order_date date,
  registration_date date,
  catalog_value numeric(20, 2),
  purchase_value numeric(20, 2),
  residual_value numeric(20, 2),
  replacement_date date,
  asset_id uuid,
  stnk_no text check (char_length(stnk_no) <= 255),
  stnk_expiry date,
  tax_due_date date,
  bpkb_no text check (char_length(bpkb_no) <= 255),
  kir_no text check (char_length(kir_no) <= 255),
  kir_expiry date,
  note text check (char_length(note) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, model_id) references fleet_models (tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete set null (branch_id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id) on delete set null (business_unit_id),
  foreign key (tenant_id, manager_user_id) references users (tenant_id, id) on delete set null (manager_user_id),
  foreign key (tenant_id, driver_employee_id) references employees (tenant_id, id) on delete set null (driver_employee_id),
  foreign key (tenant_id, next_driver_employee_id) references employees (tenant_id, id) on delete set null (next_driver_employee_id),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id) on delete set null (asset_id)
);
create unique index fleet_vehicles_plate_uq on fleet_vehicles (tenant_id, company_id, license_plate);
create index fleet_vehicles_driver_idx on fleet_vehicles (driver_employee_id);

-- Riwayat penugasan pengemudi; satu penugasan terbuka per kendaraan.
create table fleet_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  vehicle_id uuid not null,
  employee_id uuid not null,
  start_date date not null,
  end_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  foreign key (tenant_id, vehicle_id) references fleet_vehicles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create unique index fleet_driver_assignments_open_uq on fleet_driver_assignments (vehicle_id) where end_date is null;

create table fleet_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  vehicle_id uuid not null,
  service_type_id uuid not null,
  vendor_id uuid,
  reference text check (char_length(reference) <= 255),
  start_date date not null,
  end_date date,
  initial_cost numeric(20, 2) not null default 0,
  recurring_cost numeric(20, 2) not null default 0,
  recurring_interval text not null default 'monthly' check (recurring_interval in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  included_services text check (char_length(included_services) <= 2000),
  state text not null default 'running' check (state in ('new', 'running', 'expired', 'closed')),
  reminder_days smallint check (reminder_days between 0 and 365),
  note text check (char_length(note) <= 2000),
  renewed_from_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (end_date is null or end_date >= start_date),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, vehicle_id) references fleet_vehicles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_type_id) references fleet_service_types (tenant_id, id) on delete restrict,
  foreign key (tenant_id, vendor_id) references partners (tenant_id, id) on delete set null (vendor_id),
  foreign key (tenant_id, renewed_from_id) references fleet_contracts (tenant_id, id) on delete set null (renewed_from_id)
);
create index fleet_contracts_vehicle_idx on fleet_contracts (vehicle_id);

create table fleet_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  vehicle_id uuid not null,
  service_type_id uuid not null,
  vendor_id uuid,
  date date not null,
  odometer numeric(12, 1) check (odometer >= 0),
  driver_employee_id uuid,
  cost numeric(20, 2) not null default 0,
  description text check (char_length(description) <= 2000),
  state text not null default 'new' check (state in ('new', 'running', 'done', 'cancelled')),
  -- Tagihan vendor (draft in_invoice) yang dibuat dari servis ini.
  move_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, vehicle_id) references fleet_vehicles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_type_id) references fleet_service_types (tenant_id, id) on delete restrict,
  foreign key (tenant_id, vendor_id) references partners (tenant_id, id) on delete set null (vendor_id),
  foreign key (tenant_id, driver_employee_id) references employees (tenant_id, id) on delete set null (driver_employee_id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id) on delete set null (move_id)
);
create index fleet_services_vehicle_idx on fleet_services (vehicle_id);

create table fleet_odometers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  vehicle_id uuid not null,
  date date not null,
  value numeric(12, 1) not null check (value >= 0),
  driver_employee_id uuid,
  note text check (char_length(note) <= 255),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references fleet_vehicles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, driver_employee_id) references employees (tenant_id, id) on delete set null (driver_employee_id)
);
create index fleet_odometers_vehicle_idx on fleet_odometers (vehicle_id, date);

create table fleet_settings (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  reminder_days smallint not null default 30 check (reminder_days between 1 and 365),
  expense_account_id uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, company_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, expense_account_id) references accounts (tenant_id, id) on delete set null (expense_account_id)
);

create table fleet_reminder_log (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  sent_on date not null,
  primary key (tenant_id, company_id, sent_on)
);

-- Jenis layanan bawaan untuk perusahaan yang sudah ada (perusahaan baru dibuat saat pertama memakai armada).
insert into fleet_service_types (tenant_id, company_id, name, category)
select c.tenant_id, c.id, t.name, t.category
from companies c
cross join (values
  ('Sewa / leasing', 'contract'), ('Asuransi', 'contract'), ('Servis berkala', 'service'), ('Ganti oli', 'service'),
  ('Ban', 'service'), ('Perbaikan', 'service'), ('Perpanjangan STNK', 'both'), ('Pajak tahunan', 'both'),
  ('Uji KIR', 'both'), ('BBM', 'service')
) as t(name, category);

do $$
declare t text;
begin
  foreach t in array array['fleet_manufacturers', 'fleet_models', 'fleet_service_types', 'fleet_vehicles',
                           'fleet_driver_assignments', 'fleet_contracts', 'fleet_services', 'fleet_odometers',
                           'fleet_settings', 'fleet_reminder_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
