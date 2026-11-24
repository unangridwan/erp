-- Alur bisnis end-to-end: SLA & departemen penanggung jawab per tahap proses, serta waktu transisi dokumen yang
-- sebelumnya tidak tercatat (konfirmasi & mulai produksi, permintaan persetujuan PO).

create table flow_stage_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  process text not null check (process in ('o2c', 'p2p', 'mfg', 'h2p')),
  stage text not null check (char_length(stage) between 1 and 40),
  -- Batas waktu tahap (hari kalender sejak dokumen masuk tahap); null = pakai bawaan aplikasi.
  sla_days integer check (sla_days between 0 and 3650),
  department_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, process, stage),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete set null (department_id)
);

alter table flow_stage_settings enable row level security;
alter table flow_stage_settings force row level security;
create policy tenant_isolation on flow_stage_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on flow_stage_settings to app_user;

alter table production_orders add column confirmed_at timestamptz, add column started_at timestamptz;
alter table purchase_orders add column approval_requested_at timestamptz;

-- Isi data lama dengan perkiraan terbaik agar alur & waktu siklus tidak kosong.
update production_orders set confirmed_at = created_at where state in ('confirmed', 'in_progress', 'done');
update production_orders o set started_at = coalesce(
    (select min(p.started_at) from production_operations p where p.order_id = o.id), o.created_at)
  where state in ('in_progress', 'done');
update purchase_orders set approval_requested_at = created_at
  where state = 'to_approve' or approved_at is not null;
