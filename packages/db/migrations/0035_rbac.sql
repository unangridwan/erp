-- RBAC lengkap: peran kustom (deskripsi, bawaan), peran per perusahaan, tambah/cabut hak per akun.

alter table roles
  add column description text check (char_length(description) <= 500),
  add column is_system boolean not null default false;
update roles set is_system = true where code in ('admin', 'user');

-- Penugasan peran: company_id null = berlaku di semua perusahaan yang boleh diakses pengguna.
alter table user_roles drop constraint user_roles_pkey;
alter table user_roles
  add column id uuid not null default gen_random_uuid() primary key,
  add column company_id uuid,
  add column created_by uuid,
  add column created_at timestamptz not null default now(),
  add constraint user_roles_company_fk
    foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade;
create unique index user_roles_scope_uq on user_roles
  (user_id, role_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index user_roles_user_idx on user_roles (user_id);

-- Hak khusus per akun: grant menambah, deny mencabut (di atas peran); company_id null = semua perusahaan.
create table user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  permission text not null check (char_length(permission) between 1 and 120 and permission <> '*'),
  effect text not null check (effect in ('grant', 'deny')),
  company_id uuid,
  note text check (char_length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create unique index user_permission_overrides_uq on user_permission_overrides
  (user_id, permission, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table user_permission_overrides enable row level security;
alter table user_permission_overrides force row level security;
create policy tenant_isolation on user_permission_overrides
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on user_permission_overrides to app_user;
