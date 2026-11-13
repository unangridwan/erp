-- Kontrak pembelian (blanket order): harga tetap & kuantitas komitmen per produk + plafon nilai, disetujui lewat
-- mesin persetujuan; PO memakai harga kontrak dan realisasinya dihitung dari baris PO yang merujuk baris kontrak.

create table purchase_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  partner_id uuid not null,
  partner_ref text check (char_length(partner_ref) <= 100),
  date_start date not null,
  date_end date not null,
  currency_code text not null references currencies(code),
  payment_term_id uuid,
  -- Plafon nilai total (sebelum pajak) dalam mata uang kontrak; null = tanpa plafon.
  value_limit numeric(20, 2) check (value_limit > 0),
  state text not null default 'draft'
    check (state in ('draft', 'in_approval', 'active', 'closed', 'cancel', 'refused')),
  approval_request_id uuid,
  note text check (char_length(note) <= 2000),
  created_by uuid,
  activated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_end >= date_start),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id),
  foreign key (tenant_id, payment_term_id) references payment_terms (tenant_id, id),
  foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index purchase_contracts_name_uq on purchase_contracts (company_id, name);
create index purchase_contracts_partner_idx on purchase_contracts (tenant_id, company_id, partner_id, state);

create table purchase_contract_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  contract_id uuid not null,
  sequence integer not null default 0,
  product_id uuid not null,
  name text not null check (char_length(name) between 1 and 500),
  -- Kuantitas komitmen dalam satuan baris (uom_ratio = rasio ke satuan produk).
  quantity numeric(18, 4) not null check (quantity > 0),
  uom_id uuid references uoms(id),
  uom_ratio numeric(18, 6) not null default 1,
  price_unit numeric(20, 4) not null check (price_unit >= 0),
  discount numeric(7, 4) not null default 0 check (discount between 0 and 100),
  tax_ids uuid[] not null default '{}',
  min_order_qty numeric(18, 4) check (min_order_qty > 0),
  unique (tenant_id, id),
  unique (contract_id, product_id),
  foreign key (tenant_id, contract_id) references purchase_contracts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);

alter table purchase_orders
  add column contract_id uuid,
  add column contract_warning text,
  add foreign key (tenant_id, contract_id) references purchase_contracts (tenant_id, id);
create index purchase_orders_contract_idx on purchase_orders (contract_id) where contract_id is not null;

alter table purchase_order_lines
  add column contract_line_id uuid,
  add foreign key (tenant_id, contract_line_id) references purchase_contract_lines (tenant_id, id);
create index purchase_order_lines_contract_idx on purchase_order_lines (contract_line_id) where contract_line_id is not null;

do $$
declare t text;
begin
  foreach t in array array['purchase_contracts', 'purchase_contract_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
