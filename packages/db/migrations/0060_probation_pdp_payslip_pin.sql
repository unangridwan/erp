-- Masa percobaan (hanya PKWTT, maks. 3 bulan — UU 13/2003 ps. 60) dengan hasil evaluasi.
alter table contracts
  add column probation_months smallint check (probation_months between 1 and 3),
  add column probation_end date,
  add column probation_result text check (probation_result in ('passed', 'failed')),
  add column probation_note text check (char_length(probation_note) <= 1000),
  add column probation_decided_at timestamptz,
  add column probation_decided_by uuid;

-- UU PDP: persetujuan pemrosesan data pelamar & anonimisasi setelah masa retensi.
alter table applicants
  add column consent_at timestamptz,
  add column consent_source text check (consent_source in ('form', 'email', 'paper', 'portal', 'other')),
  add column anonymized_at timestamptz;

alter table payroll_settings
  -- Bulan sejak pelamar ditolak / lowongan ditutup sebelum datanya dianonimkan (kosong = tidak otomatis).
  add column applicant_retention_months smallint check (applicant_retention_months between 1 and 120),
  -- Karyawan wajib memasukkan PIN slip sebelum melihat/mengunduh slip gaji di portal.
  add column payslip_pin_required boolean not null default false;

-- PIN slip gaji per karyawan (hash) + pembatasan percobaan & sesi buka singkat.
alter table employees
  add column payslip_pin_hash text,
  add column payslip_pin_failed smallint not null default 0,
  add column payslip_pin_locked_until timestamptz,
  add column payslip_unlocked_until timestamptz;

-- Log akses data pribadi karyawan (NIK, NPWP, rekening, gaji) oleh pengguna lain.
create table personal_data_access_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid,
  employee_id uuid,
  fields text[] not null default '{}',
  purpose text not null check (char_length(purpose) <= 200),
  record_count integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create index personal_data_access_logs_employee_idx on personal_data_access_logs (employee_id, created_at desc);
create index personal_data_access_logs_company_idx on personal_data_access_logs (company_id, created_at desc);

alter table personal_data_access_logs enable row level security;
alter table personal_data_access_logs force row level security;
create policy tenant_isolation on personal_data_access_logs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Log hanya bisa ditambah, tidak diubah/dihapus aplikasi.
grant select, insert on personal_data_access_logs to app_user;
