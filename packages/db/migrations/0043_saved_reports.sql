-- Pembuat laporan kustom (dataset HR/Payroll) & laporan terjadwal via email.

create table saved_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  dataset text not null check (char_length(dataset) between 1 and 60),
  -- {columns, filters, conditions, groupBy, aggregates, sort, limit, chart}
  config jsonb not null default '{}',
  -- private = hanya pemilik; shared = semua pengguna yang punya hak baca dataset.
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, owner_id) references users (tenant_id, id) on delete cascade
);
create index saved_reports_company_idx on saved_reports (company_id, owner_id);

create table report_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  report_id uuid not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  -- Jam kirim (zona waktu perusahaan), hari (1 = Senin … 7 = Minggu) untuk mingguan, tanggal untuk bulanan.
  hour smallint not null default 7 check (hour between 0 and 23),
  weekday smallint check (weekday between 1 and 7),
  monthday smallint check (monthday between 1 and 28),
  format text not null default 'xlsx' check (format in ('xlsx', 'csv', 'pdf')),
  recipients text[] not null check (cardinality(recipients) between 1 and 20),
  active boolean not null default true,
  -- Periode terakhir yang sudah dikirim (mis. 2026-10-29, 2026-W44, 2026-10) → tepat sekali per periode.
  last_period text,
  last_sent_at timestamptz,
  next_run_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (frequency <> 'weekly' or weekday is not null),
  check (frequency <> 'monthly' or monthday is not null),
  foreign key (tenant_id, report_id) references saved_reports (tenant_id, id) on delete cascade
);
create index report_schedules_due_idx on report_schedules (next_run_at) where active;

create table report_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  schedule_id uuid not null,
  period text not null,
  sent_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'failed')),
  rows integer,
  recipients text[] not null default '{}',
  error text,
  manual boolean not null default false,
  foreign key (tenant_id, schedule_id) references report_schedules (tenant_id, id) on delete cascade
);
create index report_deliveries_schedule_idx on report_deliveries (schedule_id, sent_at desc);

do $$
declare t text;
begin
  foreach t in array array['saved_reports', 'report_schedules', 'report_deliveries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
