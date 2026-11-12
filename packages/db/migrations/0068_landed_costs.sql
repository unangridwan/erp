-- Landed cost: biaya tambahan (angkut, bea masuk, asuransi) dibagi ke barang yang diterima dan menambah nilai
-- persediaan; porsi barang yang sudah keluar dibebankan ke HPP.

alter table products
  add column weight numeric(14, 4) check (weight >= 0),
  add column volume numeric(14, 6) check (volume >= 0);

create table landed_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null,
  date date not null,
  state text not null default 'draft' check (state in ('draft', 'posted', 'cancel')),
  vendor_bill_id uuid,
  move_id uuid,
  reversal_move_id uuid,
  note text check (char_length(note) <= 500),
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, vendor_bill_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, move_id) references account_moves (tenant_id, id),
  foreign key (tenant_id, reversal_move_id) references account_moves (tenant_id, id)
);

create table landed_cost_pickings (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  landed_cost_id uuid not null,
  picking_id uuid not null,
  primary key (landed_cost_id, picking_id),
  foreign key (tenant_id, landed_cost_id) references landed_costs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, picking_id) references stock_pickings (tenant_id, id)
);

create table landed_cost_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  landed_cost_id uuid not null,
  sequence smallint not null default 0,
  name text not null check (char_length(name) between 1 and 200),
  -- Akun lawan (kredit): mis. biaya angkut pada tagihan jasa, atau utang/akrual biaya impor.
  account_id uuid not null,
  amount numeric(20, 2) not null check (amount > 0),
  split_method text not null default 'value' check (split_method in ('value', 'quantity', 'weight', 'volume', 'equal')),
  unique (tenant_id, id),
  foreign key (tenant_id, landed_cost_id) references landed_costs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts (tenant_id, id)
);

-- Hasil pembagian saat posting: per pergerakan stok × baris biaya.
create table landed_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  landed_cost_id uuid not null,
  line_id uuid not null,
  stock_move_id uuid not null,
  product_id uuid not null,
  layer_id uuid,
  basis numeric(24, 6) not null,
  addition numeric(20, 2) not null,
  stock_portion numeric(20, 2) not null,
  sold_portion numeric(20, 2) not null,
  -- Sisa kuantitas lapisan saat posting; pembatalan hanya bila belum berubah (barang belum keluar lagi).
  remaining_qty_at_post numeric(18, 4) not null default 0,
  foreign key (tenant_id, landed_cost_id) references landed_costs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, line_id) references landed_cost_lines (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['landed_costs', 'landed_cost_pickings', 'landed_cost_lines', 'landed_cost_adjustments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
