-- Proyek, anggota, task, dan timesheet yang dikirim aplikasi terhubung (mis. aplikasi manajemen proyek).
-- Data milik aplikasi asal; ERP menyimpan salinan untuk ditampilkan per karyawan. Dirujuk lewat external_id per aplikasi.

create table external_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  client_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  code text check (char_length(code) <= 50),
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 2000),
  status text not null default 'active' check (status in ('active', 'on_hold', 'done', 'cancelled')),
  start_date date,
  end_date date,
  manager_employee_id uuid,
  url text check (char_length(url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (client_id, external_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references oauth_clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, manager_employee_id) references employees (tenant_id, id) on delete set null (manager_employee_id)
);
create index external_projects_company_idx on external_projects (company_id, status);

create table external_project_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  project_id uuid not null,
  employee_id uuid not null,
  role text check (char_length(role) <= 100),
  allocation numeric(5, 2) check (allocation between 0 and 100),
  start_date date,
  end_date date,
  unique (project_id, employee_id),
  foreign key (tenant_id, project_id) references external_projects (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index external_project_members_employee_idx on external_project_members (employee_id);

create table external_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  client_id uuid not null,
  project_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  title text not null check (char_length(title) between 1 and 300),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_employee_id uuid,
  due_date date,
  closed_at timestamptz,
  url text check (char_length(url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (client_id, external_id),
  foreign key (tenant_id, project_id) references external_projects (tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignee_employee_id) references employees (tenant_id, id) on delete set null (assignee_employee_id)
);
create index external_tasks_assignee_idx on external_tasks (assignee_employee_id, status);
create index external_tasks_project_idx on external_tasks (project_id);

create table external_timesheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  client_id uuid not null,
  project_id uuid not null,
  task_id uuid,
  employee_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  date date not null,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  description text check (char_length(description) <= 1000),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, external_id),
  foreign key (tenant_id, project_id) references external_projects (tenant_id, id) on delete cascade,
  foreign key (tenant_id, task_id) references external_tasks (tenant_id, id) on delete set null (task_id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index external_timesheets_employee_idx on external_timesheets (employee_id, date);
create index external_timesheets_project_idx on external_timesheets (project_id, date);

do $$
declare t text;
begin
  foreach t in array array['external_projects', 'external_project_members', 'external_tasks', 'external_timesheets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
