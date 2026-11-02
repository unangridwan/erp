-- Alur penambahan karyawan: MPP → FPK (usulan penambahan) → persetujuan → lowongan → pelamar → penawaran →
-- kontrak → karyawan aktif → onboarding. FPK kini punya data posisi sendiri dan terhubung ke baris MPP; pelamar yang
-- diterima menjadi calon karyawan (belum aktif) sampai kontraknya dimulai.

create table hiring_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  number text,
  department_id uuid not null,
  job_id uuid not null,
  grade_id uuid,
  kind text not null default 'new' check (kind in ('new', 'replacement')),
  quantity smallint not null check (quantity between 1 and 1000),
  contract_type text not null default 'pkwt' check (contract_type in ('pkwt', 'pkwtt')),
  wage_min numeric(20, 2) check (wage_min >= 0),
  wage_max numeric(20, 2) check (wage_max >= 0),
  target_date date,
  reason text not null check (char_length(reason) between 1 and 1000),
  replaces_employee_id uuid,
  -- Baris MPP asal; null = di luar rencana (persetujuan kategori "FPK di luar MPP").
  manpower_plan_line_id uuid,
  unplanned boolean not null default false,
  state text not null default 'draft' check (state in ('draft', 'in_approval', 'approved', 'refused', 'cancel')),
  approval_request_id uuid,
  requested_by uuid,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (wage_max is null or wage_min is null or wage_max >= wage_min),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id),
  foreign key (tenant_id, job_id) references job_positions (tenant_id, id),
  foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete set null (grade_id),
  foreign key (tenant_id, replaces_employee_id) references employees (tenant_id, id) on delete set null (replaces_employee_id),
  foreign key (tenant_id, manpower_plan_line_id) references manpower_plan_lines (tenant_id, id) on delete set null (manpower_plan_line_id),
  foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id)
);
create index hiring_requests_line on hiring_requests (manpower_plan_line_id);
create unique index hiring_requests_approval on hiring_requests (approval_request_id) where approval_request_id is not null;

alter table job_openings add column hiring_request_id uuid;
alter table job_openings
  add foreign key (tenant_id, hiring_request_id) references hiring_requests (tenant_id, id) on delete set null (hiring_request_id);
create unique index job_openings_hiring_request on job_openings (hiring_request_id) where hiring_request_id is not null;

-- Calon karyawan: dibuat saat pelamar diterima, aktif saat kontraknya dimulai.
alter table employees add column pending_start boolean not null default false;
alter table employees add column applicant_id uuid;
alter table employees
  add foreign key (tenant_id, applicant_id) references applicants (tenant_id, id) on delete set null (applicant_id);

alter table hiring_requests enable row level security;
alter table hiring_requests force row level security;
create policy tenant_isolation on hiring_requests
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on hiring_requests to app_user;
