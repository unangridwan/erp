-- Profil karyawan lengkap: biodata tambahan, foto, golongan, kartu identitas, keluarga, pendidikan, pengalaman
-- kerja, promosi/demosi/mutasi (dengan SK), dan surat peringatan.

alter table employees
  add column birth_place text,
  add column religion text
    check (religion is null or religion in ('islam', 'protestant', 'catholic', 'hindu', 'buddha', 'confucian', 'other')),
  add column marital_status text
    check (marital_status is null or marital_status in ('single', 'married', 'divorced', 'widowed')),
  add column blood_type text check (blood_type is null or blood_type in ('A', 'B', 'AB', 'O')),
  add column rhesus text check (rhesus is null or rhesus in ('+', '-')),
  add column nationality text not null default 'WNI',
  add column height_cm smallint check (height_cm is null or height_cm between 30 and 250),
  add column weight_kg smallint check (weight_kg is null or weight_kg between 2 and 400),
  add column personal_email text,
  add column personal_phone text,
  -- `address` = alamat sesuai KTP; domisili bila berbeda.
  add column domicile_address text,
  add column kk_no_enc text,
  add column grade_id uuid,
  add foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete set null (grade_id);

-- Foto di tabel terpisah agar query karyawan (payroll, daftar) tidak ikut memuat biner.
create table employee_photos (
  employee_id uuid primary key,
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  photo bytea not null check (octet_length(photo) <= 1048576),
  photo_type text not null check (photo_type in ('image/jpeg', 'image/png', 'image/webp')),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

alter table hr_documents drop constraint hr_documents_kind_check;
alter table hr_documents add constraint hr_documents_kind_check
  check (kind in ('ktp', 'npwp', 'kk', 'bpjs_kes', 'bpjs_tk', 'sim', 'passport', 'bank_book', 'ijazah', 'cv',
    'contract', 'decree', 'certificate', 'warning', 'other'));
alter table hr_documents add column number text;

alter table employee_history drop constraint employee_history_kind_check;
alter table employee_history add constraint employee_history_kind_check
  check (kind in ('join', 'department', 'job', 'branch', 'manager', 'wage', 'resign', 'promotion', 'demotion',
    'transfer', 'grade', 'warning'));

create table employee_family (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  employee_id uuid not null,
  relation text not null check (relation in ('spouse', 'child', 'father', 'mother', 'sibling', 'other')),
  name text not null,
  nik_enc text,
  gender text check (gender is null or gender in ('male', 'female')),
  birth_place text,
  birth_date date,
  education text,
  occupation text,
  phone text,
  -- Tanggungan PTKP (istri/suami & anak kandung/angkat, maks. 3 tanggungan).
  dependent boolean not null default false,
  bpjs_covered boolean not null default false,
  alive boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index employee_family_employee_idx on employee_family (employee_id);

create table employee_education (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  employee_id uuid not null,
  level text not null check (level in ('sd', 'smp', 'sma', 'd1', 'd2', 'd3', 'd4', 's1', 's2', 's3', 'other')),
  institution text not null,
  major text,
  year_start smallint check (year_start is null or year_start between 1900 and 2200),
  year_end smallint check (year_end is null or year_end between 1900 and 2200),
  gpa numeric(4, 2) check (gpa is null or gpa >= 0),
  document_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (year_start is null or year_end is null or year_end >= year_start),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, document_id) references hr_documents (tenant_id, id) on delete set null (document_id)
);
create index employee_education_employee_idx on employee_education (employee_id);

create table employee_experiences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  employee_id uuid not null,
  company text not null,
  position text,
  date_start date,
  date_end date,
  reason_leaving text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (date_start is null or date_end is null or date_end >= date_start),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index employee_experiences_employee_idx on employee_experiences (employee_id);

-- Promosi/demosi/mutasi/rotasi berdasarkan SK; diterapkan → data karyawan & (opsional) kontrak upah baru.
create table employee_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('promotion', 'demotion', 'transfer', 'rotation')),
  decree_no text,
  effective_date date not null,
  from_job_id uuid,
  to_job_id uuid,
  from_department_id uuid,
  to_department_id uuid,
  from_branch_id uuid,
  to_branch_id uuid,
  from_manager_id uuid,
  to_manager_id uuid,
  from_grade_id uuid,
  to_grade_id uuid,
  old_wage numeric(20, 2),
  new_wage numeric(20, 2) check (new_wage is null or new_wage >= 0),
  reason text,
  state text not null default 'draft' check (state in ('draft', 'done', 'cancel')),
  document_id uuid,
  contract_id uuid,
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, to_job_id) references job_positions (tenant_id, id) on delete set null (to_job_id),
  foreign key (tenant_id, to_department_id) references departments (tenant_id, id) on delete set null (to_department_id),
  foreign key (tenant_id, to_branch_id) references branches (tenant_id, id) on delete set null (to_branch_id),
  foreign key (tenant_id, to_manager_id) references employees (tenant_id, id) on delete set null (to_manager_id),
  foreign key (tenant_id, to_grade_id) references salary_grades (tenant_id, id) on delete set null (to_grade_id),
  foreign key (tenant_id, document_id) references hr_documents (tenant_id, id) on delete set null (document_id),
  foreign key (tenant_id, contract_id) references contracts (tenant_id, id) on delete set null (contract_id)
);
create index employee_movements_employee_idx on employee_movements (employee_id, effective_date);

-- Surat peringatan (UU 13/2003 ps. 161 jo. PP 35/2021): berlaku maks. 6 bulan.
create table employee_warnings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  level text not null check (level in ('sp1', 'sp2', 'sp3')),
  decree_no text,
  date date not null,
  valid_until date not null,
  reason text not null,
  document_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (valid_until >= date),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, document_id) references hr_documents (tenant_id, id) on delete set null (document_id)
);
create index employee_warnings_employee_idx on employee_warnings (employee_id, valid_until);

do $$
declare t text;
begin
  foreach t in array array['employee_photos', 'employee_family', 'employee_education', 'employee_experiences', 'employee_movements',
    'employee_warnings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
