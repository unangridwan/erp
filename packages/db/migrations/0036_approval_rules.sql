-- Aturan persetujuan & batas wewenang yang dikelola admin.

-- Batas wewenang (nominal maksimum yang boleh disetujui/diajukan tanpa persetujuan) per pengguna atau per peran.
-- role_id & user_id null = batas default perusahaan. max_amount null = tanpa batas. category_id hanya untuk
-- approval_request (null = semua kategori). Untuk PO, bila tidak ada batas default di sini, dipakai
-- accounting_settings.purchase_approval_amount.
create table approval_limits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  doc_type text not null check (doc_type in ('purchase_order', 'expense_claim', 'approval_request')),
  category_id uuid,
  role_id uuid references roles(id) on delete cascade,
  user_id uuid,
  max_amount numeric(20, 2) check (max_amount is null or max_amount >= 0),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, category_id) references approval_categories (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  check (role_id is null or user_id is null),
  check (category_id is null or doc_type = 'approval_request')
);
create unique index approval_limits_uq on approval_limits (
  company_id, doc_type,
  coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Alur persetujuan per jenis dokumen. Bila sebuah jenis dokumen punya aturan, tahapnya menggantikan perilaku lama
-- (atasan → HR menurut pengaturan payroll; batas PO). min_value: tahap berlaku bila nilai dokumen ≥ batas (nominal
-- klaim/PO, jumlah hari cuti, jam lembur); null = selalu.
create table approval_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  doc_type text not null check (doc_type in ('leave_request', 'overtime', 'expense_claim', 'attendance_request',
    'shift_request', 'purchase_order')),
  sequence integer not null default 10,
  approver_type text not null check (approver_type in ('manager', 'manager_2', 'department_head', 'user', 'role',
    'admin')),
  user_id uuid,
  role_id uuid references roles(id) on delete cascade,
  min_value numeric(20, 2) check (min_value is null or min_value >= 0),
  label text check (char_length(label) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  check ((approver_type = 'user') = (user_id is not null)),
  check ((approver_type = 'role') = (role_id is not null))
);
create index approval_rules_company_idx on approval_rules (company_id, doc_type, sequence);

-- Tahap yang di-resolve dari aturan saat dokumen diajukan. Kedua approver null = admin jenis dokumen (HR untuk
-- dokumen SDM, pemegang purchase.approve untuk PO).
create table document_approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  res_model text not null,
  res_id uuid not null,
  step integer not null check (step >= 1),
  approver_user_id uuid,
  approver_role_id uuid references roles(id) on delete set null,
  label text,
  unique (tenant_id, id),
  unique (res_model, res_id, step),
  foreign key (tenant_id, approver_user_id) references users (tenant_id, id) on delete set null (approver_user_id)
);

-- Penyetuju kategori permintaan generik boleh berupa peran (semua pemegang peran itu di perusahaan).
alter table approval_category_approvers
  alter column user_id drop not null,
  add column role_id uuid references roles(id) on delete cascade,
  add constraint approval_category_approvers_who check ((user_id is null) <> (role_id is null));
alter table approval_request_steps
  add column approver_role_id uuid references roles(id) on delete set null;

-- PO bertingkat menurut aturan.
alter table purchase_orders
  add column approval_step integer not null default 1,
  add column approval_levels integer not null default 0;

do $$
declare t text;
begin
  foreach t in array array['approval_limits', 'approval_rules', 'document_approval_steps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
