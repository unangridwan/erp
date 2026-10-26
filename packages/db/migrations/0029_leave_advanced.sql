-- Cuti lanjutan: aturan per jenis cuti, setengah hari, lampiran, delegasi tugas, cuti massal, rencana akrual dengan
-- carry-over berkedaluwarsa, tanggal blok cuti, dan cuti pengganti dari lembur hari libur.

alter table leave_types
  add column code text,
  add column allow_half_day boolean not null default true,
  add column max_consecutive_days numeric(6, 2) check (max_consecutive_days is null or max_consecutive_days > 0),
  add column allow_negative boolean not null default false,
  add column negative_limit numeric(6, 2) not null default 0 check (negative_limit >= 0),
  add column requires_attachment boolean not null default false,
  -- true = durasi dihitung hari kalender (mis. cuti melahirkan), false = hari kerja.
  add column count_calendar_days boolean not null default false,
  add column employee_requestable boolean not null default true;

update leave_types set requires_attachment = true where name = 'Sakit (dengan surat dokter)';
update leave_types set count_calendar_days = true, allow_half_day = false where name = 'Cuti melahirkan';

-- Jenis cuti bawaan tambahan (PP 35/2021 & UU 13/2003 pasal 93) untuk tenant yang sudah ada.
insert into leave_types (tenant_id, name, paid, requires_allocation, allow_half_day, employee_requestable)
select t.id, l.name, true, l.alloc, l.half, l.self from tenants t
cross join (values ('Cuti menikah', false, false, true), ('Cuti ayah/paternitas', false, false, true),
                   ('Cuti duka', false, false, true), ('Cuti pengganti', true, true, true)) as l(name, alloc, half, self)
where not exists (select 1 from leave_types x where x.tenant_id = t.id and x.name = l.name);

alter table leave_requests
  add column half_day text check (half_day in ('am', 'pm')),
  add column attachment bytea check (attachment is null or octet_length(attachment) <= 2097152),
  add column attachment_name text,
  add column attachment_type text,
  add column delegate_employee_id uuid,
  add column delegate_note text,
  -- Cuti massal (cuti bersama) yang dibuat sekaligus oleh HR.
  add column bulk_id uuid,
  add constraint leave_requests_half_day_single check (half_day is null or date_from = date_to),
  add constraint leave_requests_delegate_fk
    foreign key (tenant_id, delegate_employee_id) references employees (tenant_id, id) on delete set null (delegate_employee_id);
create index leave_requests_bulk_idx on leave_requests (bulk_id) where bulk_id is not null;

create table leave_accrual_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  leave_type_id uuid not null,
  name text not null,
  frequency text not null default 'yearly' check (frequency in ('monthly', 'yearly')),
  days_per_period numeric(6, 2) not null check (days_per_period > 0),
  -- Akrual mulai setelah masa kerja N bulan (cuti tahunan: 12 bulan).
  start_after_months integer not null default 0 check (start_after_months >= 0),
  -- Batas saldo dari rencana ini (akrual berhenti bila sisa sudah mencapai batas).
  max_balance numeric(6, 2) check (max_balance is null or max_balance > 0),
  carry_over text not null default 'none' check (carry_over in ('none', 'all', 'limited')),
  carry_over_max numeric(6, 2) check (carry_over_max is null or carry_over_max >= 0),
  -- Sisa yang dibawa ke tahun berikutnya kedaluwarsa setelah N bulan (null = sampai akhir tahun).
  carry_over_expiry_months integer check (carry_over_expiry_months is null or carry_over_expiry_months between 1 and 12),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, leave_type_id) references leave_types (tenant_id, id)
);

create table leave_accrual_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  plan_id uuid not null,
  employee_id uuid not null,
  date_from date not null,
  unique (tenant_id, id),
  unique (plan_id, employee_id),
  foreign key (tenant_id, plan_id) references leave_accrual_plans (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

alter table leave_allocations
  add column source text not null default 'manual' check (source in ('manual', 'accrual', 'carry_over', 'compensatory')),
  add column accrual_plan_id uuid,
  -- Periode akrual/carry-over (YYYY atau YYYY-MM): satu jatah per karyawan + rencana + periode.
  add column period text,
  add column overtime_id uuid,
  add constraint leave_allocations_plan_fk
    foreign key (tenant_id, accrual_plan_id) references leave_accrual_plans (tenant_id, id) on delete set null (accrual_plan_id),
  add constraint leave_allocations_overtime_fk
    foreign key (tenant_id, overtime_id) references overtimes (tenant_id, id) on delete set null (overtime_id);
create unique index leave_allocations_period_uq on leave_allocations (employee_id, accrual_plan_id, source, period)
  where accrual_plan_id is not null and period is not null;
create unique index leave_allocations_overtime_uq on leave_allocations (overtime_id) where overtime_id is not null;

-- Tanggal blok cuti (masa sibuk / hari wajib masuk), per perusahaan atau departemen.
create table leave_block_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  date_from date not null,
  date_to date not null,
  department_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade,
  check (date_to >= date_from)
);

-- Lembur hari libur yang dijadikan cuti pengganti tidak dibayar lagi di payroll.
alter table overtimes add column compensated boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['leave_accrual_plans', 'leave_accrual_assignments', 'leave_block_dates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
