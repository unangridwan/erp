-- Fondasi multi-tenant + struktur grup (holding, anak perusahaan, unit bisnis, cabang).
create extension if not exists pgcrypto;

create type entity_type as enum ('holding', 'subsidiary', 'associate', 'joint_venture', 'other');
create type consolidation_method as enum ('full', 'proportional', 'equity', 'none');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  parent_id uuid references companies(id),
  code text not null,
  name text not null,
  entity_type entity_type not null default 'subsidiary',
  npwp text,
  currency_code text not null default 'IDR',
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_not_own_parent check (parent_id is distinct from id)
);
create unique index companies_tenant_code_uq on companies (tenant_id, code);
create index companies_parent_idx on companies (parent_id);

create table ownership_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  parent_company_id uuid not null references companies(id),
  child_company_id uuid not null references companies(id),
  pct numeric(7, 4) not null check (pct > 0 and pct <= 100),
  method consolidation_method not null,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ownership_not_self check (parent_company_id <> child_company_id),
  constraint ownership_valid_range check (valid_to is null or valid_to >= valid_from)
);
create index ownership_child_idx on ownership_history (tenant_id, child_company_id, valid_from);

create table business_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index business_units_tenant_code_uq on business_units (tenant_id, code);

create table branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null references companies(id),
  code text not null,
  name text not null,
  nitku text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index branches_company_code_uq on branches (company_id, code);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  email text not null,
  name text not null,
  password_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_tenant_email_uq on users (tenant_id, email);

create table user_companies (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  is_default boolean not null default false,
  primary key (user_id, company_id)
);

-- Row-Level Security: setiap tabel bisnis hanya terlihat untuk tenant di `app.tenant_id`.
-- Role aplikasi `app_user` tidak punya BYPASSRLS; FORCE agar pemilik tabel pun ikut aturan.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

grant usage on schema public to app_user;
grant select on tenants to app_user;

do $$
declare t text;
begin
  foreach t in array array['companies', 'ownership_history', 'business_units', 'branches', 'users', 'user_companies'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
