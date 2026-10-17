-- Fase 4: SDM (departemen, jabatan, karyawan, kontrak, absensi, hari libur, cuti, lembur)
-- dan payroll (komponen gaji, pengaturan, payroll run, slip gaji dengan PPh 21 TER & BPJS).

create table departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  parent_id uuid,
  manager_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references departments (tenant_id, id)
);

create table job_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_number text not null,
  name text not null,
  department_id uuid,
  job_id uuid,
  manager_id uuid,
  user_id uuid,
  work_email text,
  work_phone text,
  branch_id uuid,
  business_unit_id uuid,
  -- Data pribadi sensitif disimpan terenkripsi (AES-256-GCM, kunci ENCRYPTION_KEY) — UU PDP.
  nik_enc text,
  npwp_enc text,
  bank_account_enc text,
  birth_date date,
  gender text check (gender in ('male', 'female')),
  ptkp_status text not null default 'TK/0' check (ptkp_status in ('TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3')),
  bpjs_kes_no text,
  bpjs_tk_no text,
  bank_name text,
  bank_account_name text,
  join_date date not null,
  resign_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete set null (department_id),
  foreign key (tenant_id, job_id) references job_positions (tenant_id, id) on delete set null (job_id),
  foreign key (tenant_id, manager_id) references employees (tenant_id, id) on delete set null (manager_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id)
);
create unique index employees_number_uq on employees (company_id, employee_number);
create unique index employees_user_uq on employees (company_id, user_id) where user_id is not null;
alter table departments
  add foreign key (tenant_id, manager_id) references employees (tenant_id, id) on delete set null (manager_id);

create table salary_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null,
  name text not null,
  kind text not null check (kind in ('allowance', 'deduction')),
  fixed boolean not null default false,
  taxable boolean not null default true,
  -- Akun beban (tunjangan) atau akun lawan (potongan); kosong = akun bawaan pengaturan payroll.
  account_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts (tenant_id, id)
);
create unique index salary_components_code_uq on salary_components (company_id, code);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  name text not null,
  contract_type text not null default 'pkwtt' check (contract_type in ('pkwt', 'pkwtt')),
  date_start date not null,
  date_end date,
  wage numeric(20, 2) not null check (wage >= 0),
  state text not null default 'draft' check (state in ('draft', 'running', 'closed', 'cancel')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index contracts_employee_idx on contracts (employee_id, state);

create table contract_allowances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  contract_id uuid not null,
  component_id uuid not null,
  amount numeric(20, 2) not null check (amount >= 0),
  unique (tenant_id, id),
  foreign key (tenant_id, contract_id) references contracts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, component_id) references salary_components (tenant_id, id)
);

create table public_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, date)
);

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  paid boolean not null default true,
  requires_allocation boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table leave_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  days numeric(6, 2) not null check (days >= 0),
  date_from date not null,
  date_to date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, leave_type_id) references leave_types (tenant_id, id)
);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  date_from date not null,
  date_to date not null,
  -- Hari kerja (Senin–Jumat di luar hari libur) dalam rentang cuti.
  days numeric(6, 2) not null,
  reason text,
  state text not null default 'confirm' check (state in ('confirm', 'approved', 'refused', 'cancel')),
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, leave_type_id) references leave_types (tenant_id, id),
  foreign key (tenant_id, approved_by) references users (tenant_id, id) on delete set null (approved_by),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create index leave_requests_employee_idx on leave_requests (employee_id, date_from);

create table attendances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  check_in timestamptz not null,
  check_out timestamptz,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  source text not null default 'web' check (source in ('web', 'manual')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  check (check_out is null or check_out > check_in)
);
create index attendances_employee_idx on attendances (employee_id, check_in desc);
-- Satu absensi terbuka (belum pulang) per karyawan.
create unique index attendances_open_uq on attendances (employee_id) where check_out is null;

create table payroll_settings (
  company_id uuid primary key,
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  jkk_rate numeric(5, 2) not null default 0.24,
  kes_wage_cap numeric(20, 2) not null default 12000000,
  jp_wage_cap numeric(20, 2) not null default 10547400,
  salary_expense_account_id uuid not null,
  bpjs_expense_account_id uuid not null,
  salary_payable_account_id uuid not null,
  pph21_payable_account_id uuid not null,
  bpjs_payable_account_id uuid not null,
  journal_id uuid not null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, salary_expense_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, bpjs_expense_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, salary_payable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, pph21_payable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, bpjs_payable_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, journal_id) references journals (tenant_id, id)
);

create table payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  period_start date not null,
  period_end date not null,
  payment_date date not null,
  -- draft = bisa dihitung ulang; done = diposting ke jurnal; paid = gaji bersih sudah dibayar.
  state text not null default 'draft' check (state in ('draft', 'done', 'paid', 'cancel')),
  account_move_id uuid,
  payment_move_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, account_move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, payment_move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
-- Satu payroll aktif per bulan per perusahaan (akumulasi PPh 21 setahun bergantung padanya).
create unique index payroll_runs_period_uq on payroll_runs (company_id, period_start) where state <> 'cancel';

create table payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  run_id uuid not null,
  employee_id uuid not null,
  contract_id uuid not null,
  ptkp_status text not null,
  has_npwp boolean not null,
  ter_category text not null,
  ter_rate numeric(5, 2),
  is_final boolean not null default false,
  working_days integer not null default 0,
  unpaid_days numeric(6, 2) not null default 0,
  earnings numeric(20, 2) not null default 0,
  gross numeric(20, 2) not null default 0,
  pph21 numeric(20, 2) not null default 0,
  employee_bpjs numeric(20, 2) not null default 0,
  employer_bpjs numeric(20, 2) not null default 0,
  employee_pension numeric(20, 2) not null default 0,
  deductions numeric(20, 2) not null default 0,
  net numeric(20, 2) not null default 0,
  annual jsonb,
  branch_id uuid,
  business_unit_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (run_id, employee_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, run_id) references payroll_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id),
  foreign key (tenant_id, contract_id) references contracts (tenant_id, id)
);
create index payslips_employee_idx on payslips (employee_id);

create table payslip_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  payslip_id uuid not null,
  sequence integer not null default 0,
  code text not null,
  name text not null,
  category text not null,
  amount numeric(20, 2) not null,
  component_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, payslip_id) references payslips (tenant_id, id) on delete cascade,
  foreign key (tenant_id, component_id) references salary_components (tenant_id, id)
);
create index payslip_lines_payslip_idx on payslip_lines (payslip_id);

-- Komponen tidak tetap per slip (THR, bonus, insentif, potongan).
create table payslip_inputs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  payslip_id uuid not null,
  component_id uuid not null,
  amount numeric(20, 2) not null check (amount >= 0),
  description text,
  unique (tenant_id, id),
  foreign key (tenant_id, payslip_id) references payslips (tenant_id, id) on delete cascade,
  foreign key (tenant_id, component_id) references salary_components (tenant_id, id)
);

create table overtimes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  date date not null,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 12),
  day_type text not null default 'workday' check (day_type in ('workday', 'rest_day')),
  description text,
  -- Diisi saat lembur dibayar lewat slip gaji yang diposting.
  payslip_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payslip_id) references payslips (tenant_id, id) on delete set null (payslip_id)
);
create index overtimes_employee_idx on overtimes (employee_id, date);

-- ---- Backfill untuk perusahaan & tenant yang sudah ada (dijalankan oleh pemilik schema) ----
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '1-1800', 'Piutang Karyawan', 'asset_current' from accounting_settings s
on conflict (company_id, code) do nothing;
insert into journals (tenant_id, company_id, code, name, journal_type)
select s.tenant_id, s.company_id, 'SAL', 'Gaji', 'general' from accounting_settings s
on conflict (company_id, code) do nothing;
insert into payroll_settings (tenant_id, company_id, salary_expense_account_id, bpjs_expense_account_id,
  salary_payable_account_id, pph21_payable_account_id, bpjs_payable_account_id, journal_id)
select s.tenant_id, s.company_id,
  (select id from accounts a where a.company_id = s.company_id and a.code = '6-1000'),
  (select id from accounts a where a.company_id = s.company_id and a.code = '6-1100'),
  (select id from accounts a where a.company_id = s.company_id and a.code = '2-1500'),
  (select id from accounts a where a.company_id = s.company_id and a.code = '2-1300'),
  (select id from accounts a where a.company_id = s.company_id and a.code = '2-1400'),
  (select id from journals j where j.company_id = s.company_id and j.code = 'SAL')
from accounting_settings s
where exists (select 1 from accounts a where a.company_id = s.company_id and a.code = '6-1000');

insert into salary_components (tenant_id, company_id, code, name, kind, fixed, taxable, account_id)
select s.tenant_id, s.company_id, c.code, c.name, c.kind, c.fixed, true,
  case when c.account is null then null
       else (select id from accounts a where a.company_id = s.company_id and a.code = c.account) end
from payroll_settings s
cross join (values
  ('TJAB', 'Tunjangan jabatan', 'allowance', true, null),
  ('TKEL', 'Tunjangan keluarga', 'allowance', true, null),
  ('TRANS', 'Tunjangan transport', 'allowance', false, null),
  ('MAKAN', 'Tunjangan makan', 'allowance', false, null),
  ('THR', 'Tunjangan Hari Raya', 'allowance', false, null),
  ('BONUS', 'Bonus', 'allowance', false, null),
  ('PINJ', 'Potongan pinjaman karyawan', 'deduction', false, '1-1800')
) as c(code, name, kind, fixed, account)
on conflict (company_id, code) do nothing;

insert into leave_types (tenant_id, name, paid, requires_allocation)
select t.id, l.name, l.paid, l.alloc from tenants t
cross join (values ('Cuti tahunan', true, true), ('Sakit (dengan surat dokter)', true, false),
                   ('Cuti melahirkan', true, false), ('Izin tanpa upah', false, false)) as l(name, paid, alloc);

do $$
declare t text;
begin
  foreach t in array array['departments', 'job_positions', 'employees', 'salary_components', 'contracts', 'contract_allowances',
                           'public_holidays', 'leave_types', 'leave_allocations', 'leave_requests', 'attendances',
                           'payroll_settings', 'payroll_runs', 'payslips', 'payslip_lines', 'payslip_inputs', 'overtimes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
