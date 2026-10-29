-- Kompensasi & benefit: tunjangan per kehadiran, asuransi kesehatan swasta, DPLK, fasilitas, plafon klaim per golongan.

-- Cara hitung komponen gaji: nilai tetap (bawaan), per hari hadir (uang makan/transport), atau premi kehadiran
-- (hilang bila terlambat/absen melebihi batas). Nilai per karyawan dari tunjangan kontrak; `rate` = nilai bawaan.
alter table salary_components
  add column calc text not null default 'fixed_amount'
    check (calc in ('fixed_amount', 'per_attendance_day', 'attendance_premium')),
  add column rate numeric(20, 2) check (rate >= 0),
  -- Berlaku untuk semua karyawan dengan nilai `rate` tanpa perlu ditambahkan ke kontrak.
  add column auto_assign boolean not null default false,
  add column premium_max_late integer check (premium_max_late >= 0),
  add column premium_max_absent integer check (premium_max_absent >= 0),
  add constraint salary_components_attendance_not_fixed check (calc = 'fixed_amount' or not fixed);

create table benefit_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (char_length(code) between 1 and 30),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('health_insurance', 'pension', 'other')),
  provider_id uuid,
  policy_no text check (char_length(policy_no) <= 100),
  -- fixed = nominal per bulan; percent_wage = % dari upah (gaji pokok + tunjangan tetap), dibatasi wage_cap.
  calc text not null default 'fixed' check (calc in ('fixed', 'percent_wage')),
  employer_amount numeric(20, 2) not null default 0 check (employer_amount >= 0),
  employee_amount numeric(20, 2) not null default 0 check (employee_amount >= 0),
  wage_cap numeric(20, 2) check (wage_cap > 0),
  -- Premi tambahan per tanggungan keluarga per bulan & siapa yang membayar.
  dependent_amount numeric(20, 2) not null default 0 check (dependent_amount >= 0),
  dependent_payer text not null default 'employer' check (dependent_payer in ('employer', 'employee')),
  -- Porsi perusahaan menambah penghasilan bruto PPh 21 (natura/kenikmatan); DPLK perusahaan bukan objek saat dibayar.
  taxable boolean not null default true,
  expense_account_id uuid,
  payable_account_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, code),
  check (calc <> 'percent_wage' or (employer_amount <= 100 and employee_amount <= 100)),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, provider_id) references partners (tenant_id, id) on delete set null (provider_id),
  foreign key (tenant_id, expense_account_id) references accounts (tenant_id, id),
  foreign key (tenant_id, payable_account_id) references accounts (tenant_id, id)
);

create table benefit_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  plan_id uuid not null,
  employee_id uuid not null,
  date_start date not null,
  date_end date,
  member_no text check (char_length(member_no) <= 100),
  -- Anggota keluarga yang ikut ditanggung (employee_family.id).
  dependent_ids uuid[] not null default '{}',
  -- Menimpa nilai paket untuk karyawan ini (nominal per bulan atau %, sesuai cara hitung paket).
  employer_amount numeric(20, 2) check (employer_amount >= 0),
  employee_amount numeric(20, 2) check (employee_amount >= 0),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_end is null or date_end >= date_start),
  foreign key (tenant_id, plan_id) references benefit_plans (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index benefit_enrollments_employee_idx on benefit_enrollments (employee_id, date_start);
create index benefit_enrollments_plan_idx on benefit_enrollments (plan_id);
-- Baris slip benefit: tautan ke paket (porsi perusahaan = kategori benefit_employer).
alter table payslip_lines add column benefit_plan_id uuid;

-- Plafon klaim per golongan (menimpa plafon tahunan kategori).
create table expense_category_limits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  category_id uuid not null,
  grade_id uuid not null,
  annual_limit numeric(20, 2) not null check (annual_limit >= 0),
  unique (category_id, grade_id),
  foreign key (tenant_id, category_id) references expense_categories (tenant_id, id) on delete cascade,
  foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['benefit_plans', 'benefit_enrollments', 'expense_category_limits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
