-- Dashboard BI: dashboard kustom (widget dari laporan tersimpan atau konfigurasi dataset) & sematan ke Beranda.

create table dashboards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  -- [{id, title, type, width, source: {reportId} | {dataset, config}, compare}]
  widgets jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, owner_id) references users (tenant_id, id) on delete cascade
);
create index dashboards_company_idx on dashboards (company_id, owner_id);

-- Dashboard yang disematkan pengguna di Beranda: ref = id dashboard atau "builtin:<kunci>".
create table dashboard_pins (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid not null,
  ref text not null check (char_length(ref) between 1 and 80),
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (tenant_id, company_id, user_id, ref),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['dashboards', 'dashboard_pins'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
