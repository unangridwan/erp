-- Kebijakan usia pensiun per perusahaan (berbeda tiap perusahaan) + pengecualian per jabatan/golongan/departemen,
-- dan usia pensiun khusus per karyawan.

create table retirement_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  retirement_age smallint not null default 56 check (retirement_age between 40 and 80),
  -- Tanggal pensiun saat mencapai usia: tepat ulang tahun, akhir bulan ulang tahun, atau awal bulan berikutnya.
  date_rule text not null default 'end_of_month' check (date_rule in ('birthday', 'end_of_month', 'next_month_start')),
  -- Pengingat HR N bulan sebelum tanggal pensiun.
  reminder_months smallint not null default 6 check (reminder_months between 0 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table retirement_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  -- Prioritas: jabatan > golongan > departemen > bawaan perusahaan.
  kind text not null check (kind in ('job', 'grade', 'department')),
  ref_id uuid not null,
  retirement_age smallint not null check (retirement_age between 40 and 80),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (company_id, kind, ref_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

-- Usia pensiun khusus karyawan (mis. perpanjangan masa kerja); kosong = ikut kebijakan perusahaan.
alter table employees add column retirement_age smallint check (retirement_age between 40 and 80);

do $$
declare t text;
begin
  foreach t in array array['retirement_policies', 'retirement_rules'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
