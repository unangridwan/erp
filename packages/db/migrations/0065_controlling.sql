-- Controlling dasar: profit center & cost center berjenjang per perusahaan, sebagai dimensi baris jurnal.
-- Cost center terisi otomatis dari sumbernya (departemen/karyawan, aset, kendaraan, PO) atau dari default akun;
-- profit center terisi dari cost center atau default akun.

create table profit_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 120),
  parent_id uuid,
  manager_employee_id uuid,
  description text check (char_length(description) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (tenant_id, id),
  check (parent_id is null or parent_id <> id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references profit_centers (tenant_id, id),
  foreign key (tenant_id, manager_employee_id) references employees (tenant_id, id) on delete set null (manager_employee_id)
);

create table cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 120),
  parent_id uuid,
  profit_center_id uuid,
  -- Kategori untuk laporan: produksi, penjualan, administrasi & umum, layanan pendukung (sumber alokasi).
  category text not null default 'admin' check (category in ('production', 'sales', 'admin', 'service')),
  manager_employee_id uuid,
  description text check (char_length(description) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (tenant_id, id),
  check (parent_id is null or parent_id <> id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references cost_centers (tenant_id, id),
  foreign key (tenant_id, profit_center_id) references profit_centers (tenant_id, id),
  foreign key (tenant_id, manager_employee_id) references employees (tenant_id, id) on delete set null (manager_employee_id)
);

do $$
declare t text;
begin
  foreach t in array array['profit_centers', 'cost_centers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Dimensi di baris jurnal.
alter table account_move_lines
  add column cost_center_id uuid,
  add column profit_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id),
  add foreign key (tenant_id, profit_center_id) references profit_centers (tenant_id, id);
create index account_move_lines_cost_center_idx on account_move_lines (cost_center_id) where cost_center_id is not null;
create index account_move_lines_profit_center_idx on account_move_lines (profit_center_id) where profit_center_id is not null;

-- Default per akun (mis. beban listrik kantor → Umum; pendapatan jasa → PC Jasa).
alter table accounts
  add column default_cost_center_id uuid,
  add column default_profit_center_id uuid,
  add foreign key (tenant_id, default_cost_center_id) references cost_centers (tenant_id, id) on delete set null (default_cost_center_id),
  add foreign key (tenant_id, default_profit_center_id) references profit_centers (tenant_id, id) on delete set null (default_profit_center_id);

-- Sumber cost center otomatis.
alter table departments
  add column cost_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete set null (cost_center_id);
alter table employees
  add column cost_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete set null (cost_center_id);
alter table assets
  add column cost_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete set null (cost_center_id);
alter table fleet_vehicles
  add column cost_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete set null (cost_center_id);
alter table purchase_orders
  add column cost_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete set null (cost_center_id);
alter table sale_orders
  add column profit_center_id uuid,
  add foreign key (tenant_id, profit_center_id) references profit_centers (tenant_id, id) on delete set null (profit_center_id);
alter table budget_lines
  add column cost_center_id uuid,
  add foreign key (tenant_id, cost_center_id) references cost_centers (tenant_id, id) on delete cascade;

-- Wajib cost center pada baris akun beban (operasional & penyusutan) saat posting.
alter table accounting_settings add column cost_center_required boolean not null default false;

-- Isi otomatis saat baris dibuat: cost center dari default akun, profit center dari cost center lalu default akun.
create function erp_fill_controlling() returns trigger language plpgsql as $$
begin
  if new.cost_center_id is null then
    select default_cost_center_id into new.cost_center_id from accounts where id = new.account_id;
  end if;
  if new.profit_center_id is null and new.cost_center_id is not null then
    select profit_center_id into new.profit_center_id from cost_centers where id = new.cost_center_id;
  end if;
  if new.profit_center_id is null then
    select default_profit_center_id into new.profit_center_id from accounts where id = new.account_id;
  end if;
  return new;
end $$;
create trigger account_move_lines_controlling before insert on account_move_lines
  for each row execute function erp_fill_controlling();
