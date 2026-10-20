-- Klaim biaya (reimbursement) karyawan dengan persetujuan berjenjang, dibayar lewat kas/bank atau slip gaji;
-- pengajuan perubahan data pribadi dari portal karyawan.

-- Data pribadi tambahan yang bisa diajukan perubahannya oleh karyawan.
alter table employees
  add column address text,
  add column emergency_contact text,
  add column emergency_phone text;

-- Kategori klaim: akun beban, plafon per tahun per karyawan (kosong = tanpa plafon), objek PPh 21 bila dibayar via slip.
create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  account_id uuid not null,
  annual_limit numeric(20, 2) check (annual_limit is null or annual_limit >= 0),
  taxable boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts (tenant_id, id)
);

create table expense_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  name text not null,
  date date not null,
  description text,
  state text not null default 'draft'
    check (state in ('draft', 'confirm', 'approved', 'refused', 'paid', 'cancel')),
  approval_step smallint not null default 1,
  approval_levels smallint not null default 1,
  -- payslip = dibayar bersama gaji berikutnya; cash = dibayar langsung dari kas/bank.
  pay_method text not null default 'payslip' check (pay_method in ('payslip', 'cash')),
  total numeric(20, 2) not null default 0,
  payslip_id uuid,
  move_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payslip_id) references payslips (tenant_id, id) on delete set null (payslip_id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id)
);
create index expense_claims_employee_idx on expense_claims (employee_id, date);

create table expense_claim_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  claim_id uuid not null,
  category_id uuid not null,
  date date not null,
  amount numeric(20, 2) not null check (amount > 0),
  note text,
  -- Bukti (struk/nota) opsional, maks. 2 MB.
  attachment bytea check (attachment is null or octet_length(attachment) <= 2097152),
  attachment_name text,
  attachment_type text,
  unique (tenant_id, id),
  foreign key (tenant_id, claim_id) references expense_claims (tenant_id, id) on delete cascade,
  foreign key (tenant_id, category_id) references expense_categories (tenant_id, id)
);
create index expense_claim_lines_claim_idx on expense_claim_lines (claim_id);

-- Baris slip yang membayar klaim (posting: debit akun beban kategori klaim).
alter table payslip_lines add column expense_claim_id uuid;
alter table payslip_lines add constraint payslip_lines_expense_claim_fk
  foreign key (tenant_id, expense_claim_id) references expense_claims (tenant_id, id) on delete set null (expense_claim_id);

alter table payroll_settings add column expense_approval_levels smallint not null default 1
  check (expense_approval_levels between 1 and 3);

alter table approvals drop constraint approvals_res_model_check;
alter table approvals add constraint approvals_res_model_check
  check (res_model in ('leave_request', 'overtime', 'expense_claim'));

-- Pengajuan perubahan data pribadi dari portal; disetujui HR lalu diterapkan. Nomor rekening disimpan terenkripsi.
create table employee_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  changes jsonb not null,
  note text,
  state text not null default 'confirm' check (state in ('confirm', 'approved', 'refused')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['expense_categories', 'expense_claims', 'expense_claim_lines', 'employee_change_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
