-- Item tunda Fase 2–3: varian produk (atribut & nilai) dan portal pelanggan.

create table product_attributes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null,
  sequence integer not null default 10,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index product_attributes_name_uq on product_attributes (tenant_id, lower(name));

create table product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  attribute_id uuid not null,
  name text not null,
  -- Kode pendek untuk SKU varian (mis. "M", "MRH").
  code text,
  sequence integer not null default 10,
  -- Tambahan harga jual varian yang memakai nilai ini.
  price_extra numeric(18, 2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, attribute_id) references product_attributes (tenant_id, id) on delete cascade
);
create unique index product_attribute_values_name_uq on product_attribute_values (attribute_id, lower(name));

-- Produk induk varian (template) tidak dipakai langsung di dokumen; variannya adalah produk biasa.
alter table products add column is_variant_template boolean not null default false;
alter table products add column variant_of_id uuid references products(id);
alter table products add column attribute_value_ids uuid[] not null default '{}';
create index products_variant_of_idx on products (variant_of_id) where variant_of_id is not null;
create unique index products_variant_combo_uq on products (variant_of_id, attribute_value_ids)
  where variant_of_id is not null;

-- Akun portal pelanggan (terpisah dari user internal): melihat penawaran/pesanan/faktur partnernya.
create table portal_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  partner_id uuid not null,
  email text not null,
  name text not null,
  password_hash text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  invited_by uuid,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade
);
create unique index portal_users_email_uq on portal_users (tenant_id, lower(email));
create unique index portal_users_partner_uq on portal_users (partner_id);
create index portal_users_invite_idx on portal_users (invite_token_hash) where invite_token_hash is not null;

do $$
declare t text;
begin
  foreach t in array array['product_attributes', 'product_attribute_values', 'portal_users'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
