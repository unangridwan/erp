-- Man Power Planning: rencana posisi per departemen per tahun → persetujuan → anggaran tenaga kerja & akuntansi.

create table manpower_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  year smallint not null check (year between 2000 and 2100),
  department_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  state text not null default 'draft' check (state in ('draft', 'in_approval', 'approved', 'cancel')),
  approval_request_id uuid,
  -- Bulan pembayaran THR yang dianggarkan (null = THR tidak dianggarkan).
  thr_month smallint check (thr_month between 1 and 12),
  note text check (char_length(note) <= 1000),
  submitted_by uuid,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id)
);
create unique index manpower_plans_dept_year on manpower_plans (company_id, year, department_id) where state <> 'cancel';

create table manpower_plan_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  plan_id uuid not null,
  sequence smallint not null default 0,
  job_id uuid not null,
  grade_id uuid,
  -- existing = posisi terisi saat ini, new = tambahan, replacement = pengganti karyawan keluar (headcount tetap).
  kind text not null check (kind in ('existing', 'new', 'replacement')),
  quantity smallint not null check (quantity between 0 and 10000),
  start_month smallint not null default 1 check (start_month between 1 and 12),
  end_month smallint check (end_month between 1 and 12),
  monthly_wage numeric(20, 2) not null default 0 check (monthly_wage >= 0),
  monthly_allowance numeric(20, 2) not null default 0 check (monthly_allowance >= 0),
  reason text check (char_length(reason) <= 300),
  replaces_employee_id uuid,
  job_opening_id uuid,
  check (end_month is null or end_month >= start_month),
  unique (tenant_id, id),
  foreign key (tenant_id, plan_id) references manpower_plans (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references job_positions (tenant_id, id),
  foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete set null (grade_id),
  foreign key (tenant_id, replaces_employee_id) references employees (tenant_id, id) on delete set null (replaces_employee_id),
  foreign key (tenant_id, job_opening_id) references job_openings (tenant_id, id) on delete set null (job_opening_id)
);
create index manpower_plan_lines_plan on manpower_plan_lines (plan_id);

alter table job_openings add column manpower_plan_line_id uuid;
alter table job_openings
  add foreign key (tenant_id, manpower_plan_line_id) references manpower_plan_lines (tenant_id, id) on delete set null (manpower_plan_line_id);

alter table manpower_budgets add column source_plan_id uuid;
alter table manpower_budgets
  add foreign key (tenant_id, source_plan_id) references manpower_plans (tenant_id, id) on delete set null (source_plan_id);

-- Anggaran akuntansi yang dibangun otomatis dari MPP disetujui (satu per perusahaan × tahun).
alter table budgets add column source text not null default 'manual' check (source in ('manual', 'manpower'));
alter table budgets add column source_year smallint;
create unique index budgets_manpower_year on budgets (company_id, source_year) where source = 'manpower';

do $$
declare t text;
begin
  foreach t in array array['manpower_plans', 'manpower_plan_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
