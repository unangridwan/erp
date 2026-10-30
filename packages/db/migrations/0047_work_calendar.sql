-- Kalender kerja: hari libur per perusahaan dan jenisnya. Sebelumnya hari libur hanya per tenant (berlaku untuk
-- semua perusahaan) tanpa jenis; hari cuti dihitung Senin–Jumat tanpa melihat jadwal kerja karyawan.

alter table public_holidays
  add column company_id uuid,
  add column kind text not null default 'national' check (kind in ('national', 'collective', 'company')),
  add column source text not null default 'manual' check (source in ('manual', 'import')),
  add foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade;

-- Satu tanggal boleh tercatat sekali untuk semua perusahaan (company_id null) dan/atau sekali per perusahaan.
alter table public_holidays drop constraint public_holidays_tenant_id_date_key;
create unique index public_holidays_company_date
  on public_holidays (tenant_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), date);
create index public_holidays_date on public_holidays (tenant_id, date);
