-- Persetujuan offboarding & Full and Final Statement lewat mesin persetujuan (kategori sistem OFFBOARD), dan OTP email
-- sebagai cara kedua membuka slip gaji di portal selain PIN slip.

alter table payroll_settings add column offboarding_approval boolean not null default false;

-- Pengajuan keluar karyawan (`exit`, dijalankan setelah disetujui) atau persetujuan F&F (`settlement`), dengan cuplikan
-- Full & Final Statement saat diajukan.
create table offboarding_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  kind text not null check (kind in ('exit', 'settlement')),
  state text not null default 'pending' check (state in ('pending', 'approved', 'refused', 'cancel')),
  payload jsonb,
  settlement jsonb not null,
  net numeric(20, 2) not null default 0,
  approval_request_id uuid,
  decided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index offboarding_requests_employee_idx on offboarding_requests (employee_id, created_at desc);
create unique index offboarding_requests_pending_key on offboarding_requests (employee_id, kind) where state = 'pending';

alter table offboarding_requests enable row level security;
alter table offboarding_requests force row level security;
create policy tenant_isolation on offboarding_requests
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on offboarding_requests to app_user;

-- OTP slip gaji: hash kode 6 digit, kedaluwarsa 10 menit, dikirim paling cepat tiap 60 detik.
alter table employees add column payslip_otp_hash text;
alter table employees add column payslip_otp_expires timestamptz;
alter table employees add column payslip_otp_sent_at timestamptz;
