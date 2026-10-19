-- Item tunda Fase 2–3: dokumen antar perusahaan otomatis (SO ↔ PO, faktur → tagihan), nota kredit/debit dari retur,
-- selisih harga pembelian, dan komisi penjual.

-- Aktifkan per perusahaan: SO/PO/faktur ke perusahaan grup membuat dokumen pasangannya (draf) di perusahaan itu.
alter table companies add column ic_auto_documents boolean not null default false;

alter table sale_orders add column ic_purchase_order_id uuid;
alter table purchase_orders add column ic_sale_order_id uuid;
-- Tagihan/nota yang dibuat otomatis dari faktur perusahaan grup.
alter table account_moves add column ic_source_move_id uuid;
create unique index account_moves_ic_source_uq on account_moves (ic_source_move_id) where ic_source_move_id is not null;

alter table accounting_settings add column price_difference_account_id uuid;
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '5-1100', 'Selisih Harga Pembelian', 'expense_direct_cost'
from accounting_settings s
on conflict (company_id, code) do nothing;
update accounting_settings s set
  price_difference_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '5-1100');

-- Aturan komisi: khusus penjual, lalu tim penjualan, lalu bawaan perusahaan (keduanya kosong).
create table commission_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  rate numeric(7, 4) not null check (rate >= 0 and rate <= 100),
  basis text not null default 'invoiced' check (basis in ('invoiced', 'paid')),
  user_id uuid,
  team_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id),
  foreign key (tenant_id, team_id) references sales_teams (tenant_id, id)
);
alter table commission_plans enable row level security;
alter table commission_plans force row level security;
create policy tenant_isolation on commission_plans
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on commission_plans to app_user;
