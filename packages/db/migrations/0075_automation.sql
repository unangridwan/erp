-- Aturan otomatis: pemicu (dibuat/diubah/tanggal/terjadwal) → syarat → aksi (notifikasi/email, ubah field, aktivitas,
-- persetujuan, webhook). Perubahan data dicatat trigger DB ke outbox `automation_events`, diproses job setelah commit.

create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  model text not null check (model in ('partner', 'product', 'employee', 'fleet_vehicle', 'crm_lead', 'sale_order',
    'purchase_order', 'account_move', 'stock_picking', 'production_order')),
  trigger text not null check (trigger in ('created', 'updated', 'date', 'scheduled')),
  -- [{field, op, value}] semua harus terpenuhi.
  conditions jsonb not null default '[]',
  -- Hanya saat syarat berubah dari tidak terpenuhi menjadi terpenuhi (mis. status menjadi "sale").
  only_when_changes boolean not null default false,
  date_field text check (char_length(date_field) <= 60),
  offset_days integer not null default 0 check (offset_days between -365 and 365),
  frequency text check (frequency in ('daily', 'weekly', 'monthly')),
  hour smallint not null default 7 check (hour between 0 and 23),
  weekday smallint check (weekday between 1 and 7),
  monthday smallint check (monthday between 1 and 28),
  -- [{type, ...}] dijalankan berurutan.
  actions jsonb not null default '[]',
  webhook_secret_enc text,
  active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, owner_id) references users (tenant_id, id) on delete cascade
);
create index automation_rules_model_idx on automation_rules (tenant_id, model, trigger) where active;

create table automation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid,
  model text not null,
  res_id uuid not null,
  kind text not null check (kind in ('created', 'updated')),
  old jsonb,
  new jsonb not null,
  depth smallint not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index automation_events_pending_idx on automation_events (created_at) where processed_at is null;

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  rule_id uuid not null,
  res_id uuid,
  trigger text not null,
  -- Kunci dedupe untuk pemicu tanggal/terjadwal (mis. tanggal yang diproses atau periode jadwal).
  period_key text,
  status text not null check (status in ('success', 'failed', 'skipped')),
  message text,
  results jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, rule_id) references automation_rules (tenant_id, id) on delete cascade
);
create index automation_runs_rule_idx on automation_runs (rule_id, created_at desc);
create unique index automation_runs_period_uq on automation_runs (rule_id, res_id, period_key)
  where period_key is not null and status <> 'failed';

-- Catat event bila ada aturan aktif untuk model & jenis perubahan ini. `erp.automation_depth` diisi job saat
-- menjalankan aksi agar perubahan oleh aturan tidak memicu rantai tanpa akhir.
create or replace function erp_automation_event() returns trigger language plpgsql as $$
declare
  depth integer := coalesce(nullif(current_setting('erp.automation_depth', true), '')::integer, 0);
  kind text := case when tg_op = 'INSERT' then 'created' else 'updated' end;
begin
  if depth > 2 then
    return null;
  end if;
  if not exists (
    select 1 from automation_rules r
    where r.tenant_id = new.tenant_id and r.model = tg_argv[0] and r.active and r.trigger = kind
  ) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;
  insert into automation_events (tenant_id, company_id, model, res_id, kind, old, new, depth)
  values (new.tenant_id, nullif(to_jsonb(new) ->> 'company_id', '')::uuid, tg_argv[0], new.id, kind,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), depth);
  return null;
end $$;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('partners', 'partner'), ('products', 'product'), ('employees', 'employee'), ('fleet_vehicles', 'fleet_vehicle'),
    ('crm_leads', 'crm_lead'), ('sale_orders', 'sale_order'), ('purchase_orders', 'purchase_order'),
    ('account_moves', 'account_move'), ('stock_pickings', 'stock_picking'), ('production_orders', 'production_order')
  ) as x(tbl, model) loop
    execute format('create trigger automation_event after insert or update on %I for each row execute function erp_automation_event(%L)', t.tbl, t.model);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['automation_rules', 'automation_events', 'automation_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
