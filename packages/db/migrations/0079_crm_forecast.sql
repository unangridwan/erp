-- CRM bagian 2: kategori forecast, kuota penjualan, penyesuaian forecast manajer, wilayah penjualan.

alter table crm_stages
  add column forecast_category text not null default 'pipeline'
    check (forecast_category in ('pipeline', 'best_case', 'commit', 'omitted'));
-- Tahap bawaan: makin dekat ke penutupan makin pasti.
update crm_stages set forecast_category = 'best_case' where not is_won and probability >= 50 and probability < 75;
update crm_stages set forecast_category = 'commit' where not is_won and probability >= 75;

create table crm_territories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  sequence integer not null default 10,
  -- Aturan pencocokan: { provinces: [], cities: [], industries: [] }; daftar kosong = tidak membatasi.
  rules jsonb not null default '{}',
  manager_id uuid,
  -- Anggota (user) yang menerima lead wilayah ini secara bergiliran; divalidasi aplikasi.
  member_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, manager_id) references users (tenant_id, id) on delete set null (manager_id)
);

alter table crm_leads
  add column forecast_category text
    check (forecast_category in ('pipeline', 'best_case', 'commit', 'omitted')),
  add column territory_id uuid,
  add foreign key (tenant_id, territory_id) references crm_territories (tenant_id, id) on delete set null (territory_id);
create index crm_leads_close_idx on crm_leads (company_id, expected_close) where state = 'open';

alter table partners
  add column territory_id uuid,
  add foreign key (tenant_id, territory_id) references crm_territories (tenant_id, id) on delete set null (territory_id);

-- Kuota bulanan per salesperson atau per tim (tepat salah satu).
create table crm_quotas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid,
  team_id uuid,
  period_start date not null check (extract(day from period_start) = 1),
  amount numeric(20, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((user_id is null) <> (team_id is null)),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references sales_teams (tenant_id, id) on delete cascade
);
create unique index crm_quotas_user_idx on crm_quotas (company_id, user_id, period_start) where user_id is not null;
create unique index crm_quotas_team_idx on crm_quotas (company_id, team_id, period_start) where team_id is not null;

-- Forecast yang ditetapkan manajer untuk seorang salesperson pada satu bulan (menimpa angka hitungan di tampilan).
create table crm_forecast_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  user_id uuid not null,
  period_start date not null check (extract(day from period_start) = 1),
  amount numeric(20, 2) not null check (amount >= 0),
  note text check (char_length(note) <= 500),
  adjusted_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, period_start),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, adjusted_by) references users (tenant_id, id) on delete set null (adjusted_by)
);

do $$
declare t text;
begin
  foreach t in array array['crm_territories', 'crm_quotas', 'crm_forecast_adjustments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
