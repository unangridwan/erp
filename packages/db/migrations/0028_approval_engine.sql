-- Mesin persetujuan generik: kategori permintaan dengan field wajib/opsional, penyetuju bertingkat atau paralel,
-- matriks otorisasi berdasarkan nominal (Delegation of Authority), dan delegasi penyetuju selama berhalangan.

-- Kategori permintaan per perusahaan (FPK, perjalanan dinas, uang muka, dll.).
create table approval_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9_]{2,20}$'),
  name text not null,
  description text,
  -- Prefix nomor permintaan, mis. FPK → FPK/2026/0001.
  prefix text not null,
  -- Konfigurasi field: {"amount": "required" | "optional" | "none", ...}.
  fields jsonb not null default '{}',
  -- Atasan langsung pemohon menjadi penyetuju pertama.
  manager_first boolean not null default true,
  approval_mode text not null default 'sequential' check (approval_mode in ('sequential', 'parallel')),
  -- Jumlah minimum persetujuan; 0 = semua tahap yang berlaku harus menyetujui.
  min_approvals smallint not null default 0 check (min_approvals >= 0),
  sequence integer not null default 10,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, code),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

-- Penyetuju tetap per kategori. min_amount = batas nominal DoA: tahap berlaku bila nominal ≥ batas (null = selalu).
create table approval_category_approvers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  category_id uuid not null,
  sequence integer not null default 10,
  user_id uuid not null,
  label text,
  required boolean not null default true,
  min_amount numeric(20, 2) check (min_amount is null or min_amount >= 0),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references approval_categories (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index approval_category_approvers_category_idx on approval_category_approvers (category_id);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  category_id uuid not null,
  number text,
  subject text not null,
  -- Karyawan pemohon (bila user terhubung dengan data karyawan).
  employee_id uuid,
  requested_by uuid,
  state text not null default 'draft' check (state in ('draft', 'submitted', 'approved', 'refused', 'cancel')),
  date date,
  date_from date,
  date_to date,
  quantity numeric(12, 2),
  amount numeric(20, 2) check (amount is null or amount >= 0),
  reference text,
  location text,
  contact text,
  description text,
  attachment bytea check (attachment is null or octet_length(attachment) <= 2097152),
  attachment_name text,
  attachment_type text,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, category_id) references approval_categories (tenant_id, id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete set null (employee_id),
  foreign key (tenant_id, requested_by) references users (tenant_id, id) on delete set null (requested_by),
  check (date_to is null or date_from is null or date_to >= date_from)
);
create index approval_requests_company_idx on approval_requests (company_id, state);

-- Tahap persetujuan yang dibentuk saat diajukan. approver_user_id null = diputuskan HR (hr.manage).
create table approval_request_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  request_id uuid not null,
  sequence integer not null,
  approver_user_id uuid,
  label text,
  required boolean not null default true,
  state text not null default 'pending' check (state in ('pending', 'approved', 'refused', 'skipped')),
  decided_by uuid,
  -- Diputuskan oleh delegasi penyetuju.
  delegated boolean not null default false,
  decided_at timestamptz,
  note text,
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references approval_requests (tenant_id, id) on delete cascade,
  foreign key (tenant_id, approver_user_id) references users (tenant_id, id) on delete set null (approver_user_id),
  foreign key (tenant_id, decided_by) references users (tenant_id, id) on delete set null (decided_by)
);
create index approval_request_steps_request_idx on approval_request_steps (request_id);
create index approval_request_steps_approver_idx on approval_request_steps (approver_user_id) where state = 'pending';

-- Delegasi penyetuju (mis. saat cuti): selama periode, delegate boleh memutuskan atas nama user.
create table approval_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid not null,
  delegate_user_id uuid not null,
  date_from date not null,
  date_to date not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, delegate_user_id) references users (tenant_id, id) on delete cascade,
  check (user_id <> delegate_user_id),
  check (date_to >= date_from)
);
create index approval_delegations_user_idx on approval_delegations (user_id, date_from, date_to);

do $$
declare t text;
begin
  foreach t in array array['approval_categories', 'approval_category_approvers', 'approval_requests',
    'approval_request_steps', 'approval_delegations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
