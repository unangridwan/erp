-- Impor/ekspor data HR & Payroll: absensi dari berkas mesin absensi, dan profil ekspor (kolom & filter tersimpan).

alter table attendances drop constraint attendances_source_check;
alter table attendances add constraint attendances_source_check check (source in ('web', 'manual', 'import'));

create table export_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  dataset text not null,
  name text not null,
  columns text[] not null,
  filters jsonb not null default '{}',
  -- Dipakai bersama semua pengguna perusahaan (hanya pemegang hak kelola yang boleh membuat).
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create index export_presets_lookup_idx on export_presets (company_id, dataset);

alter table export_presets enable row level security;
alter table export_presets force row level security;
create policy tenant_isolation on export_presets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on export_presets to app_user;
