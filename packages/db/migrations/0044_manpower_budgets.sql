-- Anggaran tenaga kerja (rencana headcount & biaya per departemen/jabatan/bulan) untuk dibandingkan dengan aktual.

create table manpower_budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  year smallint not null check (year between 2000 and 2100),
  month smallint not null check (month between 1 and 12),
  -- Kosong = seluruh perusahaan / tanpa departemen.
  department_id uuid,
  job_id uuid,
  headcount numeric(10, 2) not null default 0 check (headcount >= 0),
  -- Biaya tenaga kerja rencana per bulan (gaji + BPJS perusahaan).
  cost numeric(20, 2) not null default 0 check (cost >= 0),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references job_positions (tenant_id, id) on delete cascade
);
create unique index manpower_budgets_line_key on manpower_budgets (
  company_id,
  year,
  month,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(job_id, '00000000-0000-0000-0000-000000000000')
);

alter table manpower_budgets enable row level security;
alter table manpower_budgets force row level security;
create policy tenant_isolation on manpower_budgets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on manpower_budgets to app_user;
