-- Kinerja lanjutan & layanan mandiri: sasaran bertingkat (goal/KRA) + check-in, feedback 360, catatan atasan,
-- pengumuman perusahaan, notifikasi in-app.

create table performance_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  parent_id uuid,
  cycle_id uuid,
  -- Pemilik: karyawan, atau departemen, atau perusahaan (keduanya kosong).
  employee_id uuid,
  department_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  metric text not null default 'percent' check (metric in ('percent', 'number', 'currency', 'boolean')),
  start_value numeric(20, 2) not null default 0,
  target_value numeric(20, 2) not null default 100,
  current_value numeric(20, 2) not null default 0,
  unit text check (char_length(unit) <= 30),
  weight numeric(6, 2) not null default 1 check (weight > 0),
  due_date date,
  state text not null default 'active' check (state in ('draft', 'active', 'done', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references performance_goals (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cycle_id) references appraisal_cycles (tenant_id, id) on delete set null (cycle_id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade,
  check (employee_id is null or department_id is null),
  check (metric = 'boolean' or target_value <> start_value)
);
create index performance_goals_parent_idx on performance_goals (parent_id);
create index performance_goals_employee_idx on performance_goals (employee_id);

create table goal_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  goal_id uuid not null,
  value numeric(20, 2) not null,
  note text check (char_length(note) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, goal_id) references performance_goals (tenant_id, id) on delete cascade
);

create table feedback_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  cycle_id uuid,
  subject_employee_id uuid not null,
  reviewer_user_id uuid not null,
  relation text not null check (relation in ('peer', 'subordinate', 'manager', 'self', 'other')),
  state text not null default 'pending' check (state in ('pending', 'submitted', 'declined')),
  -- Skor 1–5 per kompetensi (kunci FEEDBACK_COMPETENCIES).
  scores jsonb not null default '{}',
  strengths text check (char_length(strengths) <= 2000),
  improvements text check (char_length(improvements) <= 2000),
  due_date date,
  requested_by uuid,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, cycle_id) references appraisal_cycles (tenant_id, id) on delete set null (cycle_id),
  foreign key (tenant_id, subject_employee_id) references employees (tenant_id, id) on delete cascade
);
-- Satu permintaan terbuka per subjek–reviewer (per siklus).
create unique index feedback_requests_open_uq on feedback_requests
  (subject_employee_id, reviewer_user_id, coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where state = 'pending';

-- Catatan atasan/HR tentang karyawan (1-on-1, pencapaian, kejadian); tidak pernah terlihat oleh karyawan.
create table employee_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  author_user_id uuid not null,
  body text not null check (char_length(body) between 1 and 5000),
  -- private = hanya penulis; hr = penulis + pengguna hr.manage.
  visibility text not null default 'private' check (visibility in ('private', 'hr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  -- Audiens: semua karyawan, atau satu departemen.
  department_id uuid,
  pinned boolean not null default false,
  published_at timestamptz,
  expires_at date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade
);

create table announcement_reads (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  announcement_id uuid not null,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id),
  foreign key (tenant_id, announcement_id) references announcements (tenant_id, id) on delete cascade
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid not null,
  kind text not null check (char_length(kind) <= 50),
  title text not null check (char_length(title) <= 300),
  body text check (char_length(body) <= 2000),
  link text check (char_length(link) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create index notifications_user_idx on notifications (user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['performance_goals', 'goal_checkins', 'feedback_requests', 'employee_notes',
                           'announcements', 'announcement_reads', 'notifications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
