-- Fase 5b: konsolidasi grup — bagan akun grup & pemetaan, data akuisisi, dan proses konsolidasi
-- (entitas, saldo terjemahan, jurnal eliminasi/penyesuaian) yang disimpan sebagai snapshot per proses.

-- Data akuisisi per relasi kepemilikan (dalam mata uang penyajian grup): dasar goodwill & KNP.
alter table ownership_history
  add column consideration numeric(20, 2),
  add column acquired_net_assets numeric(20, 2);

create table group_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null,
  -- Peran khusus dalam konsolidasi (akun penampung otomatis).
  role text check (role in ('investment', 'goodwill', 'nci_equity', 'nci_profit', 'cta', 'retained_earnings',
                            'associate_investment', 'associate_income', 'ic_difference')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create unique index group_accounts_role_uq on group_accounts (tenant_id, role) where role is not null;

create table consolidation_account_map (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  account_id uuid not null,
  company_id uuid not null,
  group_account_id uuid not null,
  primary key (account_id),
  foreign key (tenant_id, account_id) references accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_account_id) references group_accounts (tenant_id, id)
);

create table consolidation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  root_company_id uuid not null,
  date_from date not null,
  date_to date not null,
  currency_code text not null,
  state text not null default 'draft' check (state in ('draft', 'final')),
  warnings jsonb not null default '[]',
  computed_at timestamptz,
  finalized_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, root_company_id) references companies (tenant_id, id),
  check (date_from <= date_to)
);

create table consolidation_entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  run_id uuid not null,
  company_id uuid not null,
  method text not null check (method in ('full', 'proportional', 'equity')),
  direct_pct numeric(7, 4) not null,
  effective_pct numeric(7, 4) not null,
  currency_code text not null,
  closing_rate numeric(20, 10) not null default 1,
  average_rate numeric(20, 10) not null default 1,
  historical_rate numeric(20, 10) not null default 1,
  unique (tenant_id, id),
  unique (run_id, company_id),
  foreign key (tenant_id, run_id) references consolidation_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id) references companies (tenant_id, id)
);

-- Saldo per entitas per akun grup: lokal dan setelah translasi & faktor metode (penyajian).
create table consolidation_balances (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  run_id uuid not null,
  company_id uuid not null,
  group_account_id uuid not null,
  local_amount numeric(20, 2) not null,
  amount numeric(20, 2) not null,
  primary key (run_id, company_id, group_account_id),
  foreign key (tenant_id, run_id) references consolidation_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_account_id) references group_accounts (tenant_id, id)
);

create table consolidation_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  run_id uuid not null,
  kind text not null check (kind in ('translation', 'investment', 'nci_profit', 'intercompany', 'equity_method', 'manual')),
  company_id uuid,
  description text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, run_id) references consolidation_runs (tenant_id, id) on delete cascade
);

create table consolidation_entry_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  entry_id uuid not null,
  group_account_id uuid not null,
  company_id uuid,
  -- Debit positif, kredit negatif (mata uang penyajian).
  amount numeric(20, 2) not null,
  foreign key (tenant_id, entry_id) references consolidation_entries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_account_id) references group_accounts (tenant_id, id)
);

-- Konsolidasi termasuk paket Enterprise.
update plans set modules = array_append(modules, 'consolidation')
where code = 'enterprise' and not ('consolidation' = any(modules));

do $$
declare t text;
begin
  foreach t in array array['group_accounts', 'consolidation_account_map', 'consolidation_runs', 'consolidation_entities',
                           'consolidation_balances', 'consolidation_entries', 'consolidation_entry_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
