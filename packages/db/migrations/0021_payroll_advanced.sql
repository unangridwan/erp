-- Payroll lanjutan: struktur & skala upah (PP 36/2021), THR & rapel otomatis, format transfer bank per bank,
-- laporan BPJS (dasar upah per slip), dan pengiriman slip gaji via email.

-- Golongan upah (struktur & skala upah): rentang upah pokok per golongan, dipasang di jabatan.
create table salary_grades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  min_wage numeric(20, 2) not null check (min_wage >= 0),
  max_wage numeric(20, 2) not null,
  sequence integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  check (max_wage >= min_wage)
);
alter table job_positions add column grade_id uuid;
alter table job_positions add constraint job_positions_grade_fk
  foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete set null (grade_id);

-- Komponen THR & rapel yang dipakai perhitungan otomatis; rekening sumber transfer gaji (debet).
alter table payroll_settings
  add column thr_component_id uuid,
  add column retro_component_id uuid,
  add column transfer_source_account text,
  add column transfer_company_code text;
alter table payroll_settings add constraint payroll_settings_thr_fk
  foreign key (tenant_id, thr_component_id) references salary_components (tenant_id, id) on delete set null (thr_component_id);
alter table payroll_settings add constraint payroll_settings_retro_fk
  foreign key (tenant_id, retro_component_id) references salary_components (tenant_id, id) on delete set null (retro_component_id);

-- Asal input slip: manual, THR otomatis, atau rapel otomatis (rincian selisih per bulan di detail).
alter table payslip_inputs
  add column source text not null default 'manual' check (source in ('manual', 'thr', 'retro')),
  add column detail jsonb;

-- Dasar upah BPJS slip (upah + tunjangan tetap, atau rata-rata borongan) untuk laporan e-Dabu/SIPP;
-- status pengiriman slip via email.
alter table payslips
  add column bpjs_wage numeric(20, 2) not null default 0,
  add column emailed_at timestamptz,
  add column email_error text;

-- Komponen rapel untuk perusahaan yang sudah menyiapkan payroll.
insert into salary_components (tenant_id, company_id, code, name, kind, fixed, taxable)
select s.tenant_id, s.company_id, 'RAPEL', 'Rapel kenaikan upah', 'allowance', false, true
from payroll_settings s
where not exists (select 1 from salary_components c where c.company_id = s.company_id and c.code = 'RAPEL');
update payroll_settings s set
  thr_component_id = (select id from salary_components c where c.company_id = s.company_id and c.code = 'THR'),
  retro_component_id = (select id from salary_components c where c.company_id = s.company_id and c.code = 'RAPEL');

do $$
declare t text;
begin
  foreach t in array array['salary_grades'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
