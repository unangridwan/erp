-- Field kustom buatan admin tenant: definisi per model (master & dokumen utama), nilainya disimpan di kolom jsonb
-- `custom` setiap tabel target (kunci = custom_fields.key).

create table custom_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  -- null = berlaku di semua perusahaan.
  company_id uuid,
  model text not null check (model in ('partner', 'product', 'employee', 'fleet_vehicle', 'crm_lead', 'sale_order',
    'purchase_order', 'account_move', 'stock_picking', 'production_order')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80),
  label_en text check (char_length(label_en) <= 80),
  field_type text not null check (field_type in ('text', 'textarea', 'number', 'money', 'date', 'boolean', 'select',
    'multiselect', 'url', 'email', 'ref')),
  -- [{value, label}] untuk select/multiselect.
  options jsonb not null default '[]',
  ref_model text check (ref_model in ('partner', 'product', 'employee', 'user')),
  required boolean not null default false,
  default_value jsonb,
  help text check (char_length(help) <= 300),
  section text check (char_length(section) <= 60),
  sequence integer not null default 0,
  show_in_list boolean not null default false,
  show_on_pdf boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, model, key),
  check ((field_type = 'ref') = (ref_model is not null)),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);
create index custom_fields_model_idx on custom_fields (tenant_id, model, sequence);

alter table partners add column custom jsonb not null default '{}';
alter table products add column custom jsonb not null default '{}';
alter table employees add column custom jsonb not null default '{}';
alter table fleet_vehicles add column custom jsonb not null default '{}';
alter table crm_leads add column custom jsonb not null default '{}';
alter table sale_orders add column custom jsonb not null default '{}';
alter table purchase_orders add column custom jsonb not null default '{}';
alter table account_moves add column custom jsonb not null default '{}';
alter table stock_pickings add column custom jsonb not null default '{}';
alter table production_orders add column custom jsonb not null default '{}';

alter table custom_fields enable row level security;
alter table custom_fields force row level security;
create policy tenant_isolation on custom_fields
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on custom_fields to app_user;

-- Field kustom boleh diubah pada entri terposting (bukan data akuntansi).
create or replace function erp_guard_posted_move() returns trigger language plpgsql as $$
begin
  if current_setting('erp.purge', true) = 'on' and current_user <> 'app_user' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'Entri jurnal % sudah diposting dan tidak bisa dihapus', coalesce(old.name, old.id::text)
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.state = 'posted'
     and (to_jsonb(new) - 'amount_residual' - 'payment_state' - 'updated_at' - 'dunning_level' - 'last_dunning_at' - 'custom')
         <> (to_jsonb(old) - 'amount_residual' - 'payment_state' - 'updated_at' - 'dunning_level' - 'last_dunning_at' - 'custom') then
    raise exception 'Entri jurnal % sudah diposting dan tidak bisa diubah', old.name using errcode = 'check_violation';
  end if;
  return new;
end $$;
