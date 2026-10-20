-- Penilaian kinerja (KPI berbobot: penilaian diri → atasan → kalibrasi HR), pelatihan & sertifikasi, dan riwayat
-- karir karyawan (mutasi, promosi, perubahan upah).

create table appraisal_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  -- Kosong = template umum; diisi = dipakai untuk karyawan dengan jabatan ini.
  job_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references job_positions (tenant_id, id) on delete set null (job_id)
);

create table appraisal_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  template_id uuid not null,
  sequence integer not null default 0,
  name text not null,
  description text,
  weight numeric(6, 2) not null check (weight > 0),
  unique (tenant_id, id),
  foreign key (tenant_id, template_id) references appraisal_templates (tenant_id, id) on delete cascade
);

create table appraisal_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  date_start date not null,
  date_end date not null,
  state text not null default 'draft' check (state in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (date_end >= date_start),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table appraisals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  cycle_id uuid not null,
  employee_id uuid not null,
  template_id uuid,
  manager_user_id uuid,
  -- self = menunggu penilaian diri; manager = menunggu atasan; calibration = menunggu kalibrasi HR; done = final.
  state text not null default 'self' check (state in ('self', 'manager', 'calibration', 'done')),
  self_score numeric(4, 2),
  manager_score numeric(4, 2),
  final_score numeric(4, 2),
  rating text check (rating is null or rating in ('A', 'B', 'C', 'D', 'E')),
  employee_comment text,
  manager_comment text,
  hr_comment text,
  -- Rekomendasi kenaikan upah (%) hasil kalibrasi.
  raise_percent numeric(5, 2),
  self_submitted_at timestamptz,
  manager_submitted_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (cycle_id, employee_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cycle_id) references appraisal_cycles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id) references appraisal_templates (tenant_id, id) on delete set null (template_id)
);

create table appraisal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  appraisal_id uuid not null,
  sequence integer not null default 0,
  name text not null,
  weight numeric(6, 2) not null check (weight > 0),
  self_score smallint check (self_score is null or self_score between 1 and 5),
  manager_score smallint check (manager_score is null or manager_score between 1 and 5),
  comment text,
  unique (tenant_id, id),
  foreign key (tenant_id, appraisal_id) references appraisals (tenant_id, id) on delete cascade
);

create table trainings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  provider text,
  date_start date not null,
  date_end date not null,
  cost numeric(20, 2) not null default 0 check (cost >= 0),
  -- Masa berlaku sertifikat (bulan) sejak pelatihan selesai; kosong = tanpa masa berlaku.
  certificate_valid_months integer check (certificate_valid_months is null or certificate_valid_months > 0),
  state text not null default 'planned' check (state in ('planned', 'done', 'cancel')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (date_end >= date_start),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table training_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  training_id uuid not null,
  employee_id uuid not null,
  state text not null default 'enrolled' check (state in ('enrolled', 'completed', 'absent')),
  certificate_document_id uuid,
  certificate_expiry date,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (training_id, employee_id),
  foreign key (tenant_id, training_id) references trainings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, certificate_document_id) references hr_documents (tenant_id, id) on delete set null (certificate_document_id)
);

-- Riwayat karir: dicatat otomatis saat departemen/jabatan/cabang/atasan berubah dan saat kontrak baru berlaku.
create table employee_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  date date not null,
  kind text not null check (kind in ('join', 'department', 'job', 'branch', 'manager', 'wage', 'resign')),
  old_value text,
  new_value text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index employee_history_employee_idx on employee_history (employee_id, date);

do $$
declare t text;
begin
  foreach t in array array['appraisal_templates', 'appraisal_template_items', 'appraisal_cycles', 'appraisals',
    'appraisal_lines', 'trainings', 'training_participants', 'employee_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
