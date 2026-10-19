-- Item tunda Fase 4: jadwal kerja/shift & keterlambatan, approval berjenjang cuti/lembur, pinjaman karyawan,
-- pesangon PP 35/2021, dan upah harian lepas/borongan beserta BPJS-nya.

-- Jadwal kerja (shift): jam masuk & aturan potongan keterlambatan.
create table work_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  tolerance_minutes integer not null default 0 check (tolerance_minutes >= 0),
  penalty_per_minute numeric(18, 2) not null default 0 check (penalty_per_minute >= 0),
  penalty_per_occurrence numeric(18, 2) not null default 0 check (penalty_per_occurrence >= 0),
  work_days smallint[] not null default '{1,2,3,4,5}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
alter table employees add column schedule_id uuid;
alter table employees add constraint employees_schedule_fk
  foreign key (tenant_id, schedule_id) references work_schedules (tenant_id, id) on delete set null (schedule_id);

-- Penugasan shift per rentang tanggal (mengganti jadwal bawaan karyawan).
create table shift_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  schedule_id uuid not null,
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, schedule_id) references work_schedules (tenant_id, id) on delete cascade
);
create index shift_assignments_employee_idx on shift_assignments (employee_id, date_from);

alter table payroll_settings add column timezone text not null default 'Asia/Jakarta';
alter table payroll_settings add column employee_loan_account_id uuid;
-- Jumlah tingkat persetujuan (1 = atasan langsung, 2 = + atasan dari atasan, 3 = + HR); 0 = otomatis disetujui.
alter table payroll_settings add column leave_approval_levels smallint not null default 1
  check (leave_approval_levels between 1 and 3);
alter table payroll_settings add column overtime_approval_levels smallint not null default 0
  check (overtime_approval_levels between 0 and 3);
-- Pekerja harian lepas/borongan ikut JHT, JP & BPJS Kesehatan setelah masa kerja ini (bulan); sebelumnya JKK & JKM.
alter table payroll_settings add column casual_full_bpjs_months smallint not null default 3
  check (casual_full_bpjs_months between 0 and 24);
update payroll_settings s set
  employee_loan_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '1-1800');

-- Approval berjenjang.
alter table leave_requests add column approval_step smallint not null default 1;
alter table leave_requests add column approval_levels smallint not null default 1;
alter table overtimes add column state text not null default 'approved'
  check (state in ('confirm', 'approved', 'refused'));
alter table overtimes add column approval_step smallint not null default 1;
alter table overtimes add column approval_levels smallint not null default 0;

create table approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  res_model text not null check (res_model in ('leave_request', 'overtime')),
  res_id uuid not null,
  step smallint not null,
  user_id uuid,
  decision text not null check (decision in ('approved', 'refused')),
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index approvals_res_idx on approvals (res_model, res_id, step);

-- Pinjaman karyawan dengan cicilan otomatis di payroll.
create table employee_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  name text not null,
  principal numeric(20, 2) not null check (principal > 0),
  installment numeric(20, 2) not null check (installment > 0),
  -- Bulan pertama dipotong (YYYY-MM).
  start_period text not null check (start_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  state text not null default 'draft' check (state in ('draft', 'running', 'done', 'cancel')),
  disbursement_date date,
  disbursement_move_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
alter table payslip_lines add column loan_id uuid;

-- Upah harian lepas / borongan: `wage` kontrak = upah per hari / tarif per satuan.
alter table contracts add column wage_type text not null default 'monthly'
  check (wage_type in ('monthly', 'daily', 'piece'));
create table work_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  date date not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  description text,
  payslip_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index work_entries_employee_idx on work_entries (employee_id, date);

-- Pesangon / hak akhir hubungan kerja.
create table severances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  reason text not null,
  end_date date not null,
  monthly_wage numeric(20, 2) not null,
  unused_leave_days numeric(6, 2) not null default 0,
  other_rights numeric(20, 2) not null default 0,
  separation_pay numeric(20, 2) not null default 0,
  result jsonb not null,
  gross numeric(20, 2) not null,
  tax numeric(20, 2) not null,
  net numeric(20, 2) not null,
  state text not null default 'draft' check (state in ('draft', 'posted', 'cancel')),
  move_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['work_schedules', 'shift_assignments', 'approvals', 'employee_loans', 'work_entries',
    'severances'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
