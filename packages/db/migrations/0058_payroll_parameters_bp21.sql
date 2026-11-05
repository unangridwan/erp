-- Parameter payroll berlaku per tanggal (batas upah BPJS & tarif JKK): run lama yang dihitung ulang tetap memakai
-- nilai yang berlaku pada periodenya.
create table payroll_parameters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  effective_from date not null,
  kes_wage_cap numeric(20, 2) not null check (kes_wage_cap >= 0),
  jp_wage_cap numeric(20, 2) not null check (jp_wage_cap >= 0),
  jkk_rate numeric(5, 2) not null check (jkk_rate >= 0 and jkk_rate <= 10),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, effective_from),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

-- Nilai yang berlaku sekarang menjadi parameter awal (berlaku untuk semua periode lama).
insert into payroll_parameters (tenant_id, company_id, effective_from, kes_wage_cap, jp_wage_cap, jkk_rate, note)
select tenant_id, company_id, date '2000-01-01', kes_wage_cap, jp_wage_cap, jkk_rate, 'Nilai awal dari Pengaturan Payroll'
from payroll_settings;

alter table payroll_parameters enable row level security;
alter table payroll_parameters force row level security;
create policy tenant_isolation on payroll_parameters
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on payroll_parameters to app_user;

-- Bukti potong PPh 21 pegawai tidak tetap & bukan pegawai (BP21).
alter table withholding_slips drop constraint if exists withholding_slips_kind_check;
alter table withholding_slips add constraint withholding_slips_kind_check
  check (kind in ('bppu', 'bpmp', 'bpa1', 'bp21'));
alter table withholding_slips
  -- Penghasilan bruto & persentase DPP (100% pegawai tidak tetap, 50% bukan pegawai).
  add column gross numeric(20, 2),
  add column deemed_rate numeric(5, 2);

alter table tax_export_batches drop constraint if exists tax_export_batches_kind_check;
alter table tax_export_batches add constraint tax_export_batches_kind_check
  check (kind in ('efaktur', 'bppu', 'bpmp', 'bpa1', 'bp21', 'efaktur_legacy', 'retur_legacy'));

-- Kode objek pajak bawaan BP21 per perusahaan (Coretax memecah 21-100-03 menjadi beberapa kode; pilih sesuai
-- "Nama Objek Pajak" di e-Bupot). Kosong = diisi per bukti potong sebelum ekspor.
alter table payroll_settings
  add column bp21_non_permanent_code text check (bp21_non_permanent_code ~ '^\d{2}-\d{3}-\d{2}$'),
  add column bp21_non_employee_code text check (bp21_non_employee_code ~ '^\d{2}-\d{3}-\d{2}$');
