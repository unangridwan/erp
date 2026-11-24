-- Peringatan dini otomatis: pengaturan aturan per perusahaan (aktif, ambang, penerima) dan catatan pengiriman harian
-- (satu ringkasan per orang per aturan per hari, sekaligus mencegah pengiriman ganda).

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  key text not null check (char_length(key) between 1 and 40),
  active boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  recipients text[] not null default '{}',
  -- Pengguna yang terakhir mengatur: hak aksesnya dipakai saat aturan dijalankan terjadwal.
  owner_id uuid,
  last_run_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, key),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, owner_id) references users (tenant_id, id) on delete set null (owner_id)
);

create table alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  rule_key text not null,
  user_id uuid not null,
  day date not null,
  count integer not null check (count >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, rule_key, user_id, day),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);

alter table alert_rules enable row level security;
alter table alert_rules force row level security;
create policy tenant_isolation on alert_rules
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on alert_rules to app_user;

alter table alert_events enable row level security;
alter table alert_events force row level security;
create policy tenant_isolation on alert_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on alert_events to app_user;
