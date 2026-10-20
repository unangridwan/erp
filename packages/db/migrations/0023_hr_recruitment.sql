-- Dokumen karyawan/pelamar (berkas di Postgres, maks. 5 MB) dengan tanggal kedaluwarsa & pengingat, rekrutmen
-- (lowongan, pelamar per tahap, jadwal wawancara, jadikan karyawan), serta checklist onboarding/offboarding.

create table job_openings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  job_id uuid,
  department_id uuid,
  description text,
  quota integer not null default 1 check (quota >= 1),
  state text not null default 'open' check (state in ('open', 'closed')),
  date_open date not null default current_date,
  date_close date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references job_positions (tenant_id, id) on delete set null (job_id),
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete set null (department_id)
);

create table applicants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  opening_id uuid not null,
  name text not null,
  email text,
  phone text,
  source text not null default 'other' check (source in ('referral', 'jobportal', 'website', 'walkin', 'other')),
  stage text not null default 'new'
    check (stage in ('new', 'screening', 'interview', 'offer', 'hired', 'refused')),
  expected_wage numeric(20, 2) check (expected_wage is null or expected_wage >= 0),
  notes text,
  refuse_reason text,
  employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, opening_id) references job_openings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete set null (employee_id)
);
create index applicants_opening_idx on applicants (opening_id, stage);

create table applicant_interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  applicant_id uuid not null,
  scheduled_at timestamptz not null,
  interviewer_id uuid,
  location text,
  result text,
  score smallint check (score is null or score between 1 and 5),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, applicant_id) references applicants (tenant_id, id) on delete cascade
);

create table hr_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid,
  applicant_id uuid,
  kind text not null
    check (kind in ('ktp', 'npwp', 'kk', 'ijazah', 'cv', 'contract', 'decree', 'certificate', 'other')),
  name text not null,
  file bytea not null check (octet_length(file) <= 5242880),
  file_name text not null,
  file_type text not null,
  issued_date date,
  expiry_date date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (employee_id is not null or applicant_id is not null),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, applicant_id) references applicants (tenant_id, id) on delete set null (applicant_id)
);
create index hr_documents_employee_idx on hr_documents (employee_id);
create index hr_documents_expiry_idx on hr_documents (company_id, expiry_date) where expiry_date is not null;

-- Template checklist; tenggat relatif terhadap tanggal masuk (onboarding) atau tanggal keluar (offboarding).
create table hr_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('onboarding', 'offboarding')),
  name text not null,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create unique index hr_checklist_templates_default_idx on hr_checklist_templates (company_id, kind) where is_default;

create table hr_checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  template_id uuid not null,
  sequence integer not null default 0,
  name text not null,
  responsible text not null default 'hr' check (responsible in ('hr', 'manager', 'employee', 'it')),
  due_days integer not null default 0 check (due_days between -365 and 365),
  action text check (action is null or action in ('severance', 'deactivate_user')),
  unique (tenant_id, id),
  foreign key (tenant_id, template_id) references hr_checklist_templates (tenant_id, id) on delete cascade
);

create table hr_checklists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('onboarding', 'offboarding')),
  name text not null,
  base_date date not null,
  state text not null default 'open' check (state in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create unique index hr_checklists_open_idx on hr_checklists (employee_id, kind) where state = 'open';

create table hr_checklist_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  checklist_id uuid not null,
  sequence integer not null default 0,
  name text not null,
  responsible text not null check (responsible in ('hr', 'manager', 'employee', 'it')),
  responsible_user_id uuid,
  due_date date not null,
  action text check (action is null or action in ('severance', 'deactivate_user')),
  done_at timestamptz,
  done_by uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, checklist_id) references hr_checklists (tenant_id, id) on delete cascade
);
create index hr_checklist_tasks_user_idx on hr_checklist_tasks (responsible_user_id) where done_at is null;

-- Pengingat harian HR yang sudah dikirim (agar tidak dobel).
create table hr_reminder_log (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  sent_on date not null,
  primary key (tenant_id, company_id, sent_on)
);

do $$
declare t text;
begin
  foreach t in array array['job_openings', 'applicants', 'applicant_interviews', 'hr_documents', 'hr_checklist_templates',
    'hr_checklist_template_items', 'hr_checklists', 'hr_checklist_tasks', 'hr_reminder_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
