-- Kasbon (uang muka karyawan) & master tarif lembur.
--  * employee_advances: pengajuan lewat mesin persetujuan (kategori sistem KASBON), pencairan ke akun Uang Muka
--    Karyawan, pertanggungjawaban dengan klaim biaya (expense_claims.advance_id), sisa dikembalikan tunai atau dipotong
--    di slip gaji (payslip_lines.advance_id).
--  * expense_categories.receipt_required: bukti wajib per kategori klaim.
--  * payroll_settings.overtime_rates: tarif lembur perusahaan (null = PP 35/2021 pola 5 hari kerja).

create table employee_advances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  name text not null,
  date date not null,
  purpose text not null,
  amount numeric(20, 2) not null check (amount > 0),
  settle_by date not null,
  state text not null default 'draft'
    check (state in ('draft', 'confirm', 'approved', 'refused', 'paid', 'settled', 'cancel')),
  approval_request_id uuid,
  disbursement_date date,
  disbursement_move_id uuid,
  settlement_date date,
  settlement_move_id uuid,
  remainder_method text check (remainder_method in ('return', 'payslip')),
  remainder numeric(20, 2) not null default 0 check (remainder >= 0),
  payslip_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index employee_advances_employee_idx on employee_advances (employee_id, state);

alter table employee_advances enable row level security;
alter table employee_advances force row level security;
create policy tenant_isolation on employee_advances
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on employee_advances to app_user;

alter table expense_claims add column advance_id uuid;
alter table expense_claims add constraint expense_claims_advance_fk
  foreign key (tenant_id, advance_id) references employee_advances (tenant_id, id);
create index expense_claims_advance_idx on expense_claims (advance_id) where advance_id is not null;
alter table expense_categories add column receipt_required boolean not null default false;
alter table payslip_lines add column advance_id uuid;
alter table payroll_settings add column employee_advance_account_id uuid;
alter table payroll_settings add column overtime_rates jsonb;
