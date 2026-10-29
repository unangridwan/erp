-- Siklus kenaikan gaji: anggaran, usulan per karyawan (dari rating appraisal), persetujuan, penerapan ke kontrak.

create table compensation_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  effective_date date not null,
  -- percent = % dari total upah bulanan peserta; amount = tambahan upah bulanan maksimal (rupiah).
  budget_kind text not null default 'percent' check (budget_kind in ('percent', 'amount')),
  budget_value numeric(20, 2) not null default 0 check (budget_value >= 0),
  department_id uuid,
  grade_id uuid,
  state text not null default 'draft' check (state in ('draft', 'in_approval', 'approved', 'applied', 'cancel')),
  approval_request_id uuid,
  note text check (char_length(note) <= 1000),
  created_by uuid,
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (budget_kind <> 'percent' or budget_value <= 100),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete set null (department_id),
  foreign key (tenant_id, grade_id) references salary_grades (tenant_id, id) on delete set null (grade_id),
  foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id)
);
create index compensation_cycles_company_idx on compensation_cycles (company_id, effective_date);

create table compensation_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  cycle_id uuid not null,
  employee_id uuid not null,
  contract_id uuid not null,
  current_wage numeric(20, 2) not null,
  appraisal_id uuid,
  rating text,
  suggested_percent numeric(6, 2) not null default 0,
  proposed_percent numeric(6, 2) not null default 0 check (proposed_percent between -100 and 100),
  new_wage numeric(20, 2) not null check (new_wage >= 0),
  reason text check (char_length(reason) <= 500),
  proposed_by uuid,
  new_contract_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id),
  foreign key (tenant_id, cycle_id) references compensation_cycles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contract_id) references contracts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, appraisal_id) references appraisals (tenant_id, id) on delete set null (appraisal_id),
  foreign key (tenant_id, new_contract_id) references contracts (tenant_id, id) on delete set null (new_contract_id)
);
create index compensation_proposals_employee_idx on compensation_proposals (employee_id);

do $$
declare t text;
begin
  foreach t in array array['compensation_cycles', 'compensation_proposals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
