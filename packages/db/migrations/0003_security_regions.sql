-- Sisa Fase 0: refresh token, 2FA (TOTP), undangan user, wilayah Indonesia,
-- dan foreign key komposit (tenant_id, id) agar rujukan lintas tenant ditolak oleh database.

-- 2FA: secret TOTP disimpan terenkripsi (AES-256-GCM, kunci dari ENCRYPTION_KEY aplikasi).
alter table users
  add column totp_secret_enc text,
  add column totp_enabled boolean not null default false,
  add column totp_last_step bigint;

-- Refresh token berotasi. Hanya hash SHA-256 yang disimpan; token lama yang dipakai ulang
-- dianggap bocor dan mencabut seluruh keluarga token (family_id).
create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  email text not null,
  name text not null,
  role_ids uuid[] not null default '{}',
  company_ids uuid[] not null,
  token_hash text not null unique,
  invited_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_tenant_email_idx on invitations (tenant_id, email);

do $$
declare t text;
begin
  foreach t in array array['refresh_tokens', 'invitations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Wilayah administrasi (global, read-only): level 1 provinsi .. 4 desa/kelurahan.
create table regions (
  code text primary key,
  name text not null,
  level smallint not null check (level between 1 and 4),
  parent_code text references regions(code)
);
create index regions_parent_idx on regions (parent_code);
create index regions_level_name_idx on regions (level, name);
grant select on regions to app_user;

-- FK komposit: setiap FK satu kolom antar tabel ber-tenant diganti menjadi (tenant_id, kolom) → (tenant_id, id).
-- Pemeriksaan FK Postgres mengabaikan RLS, jadi tanpa ini tenant bisa merujuk baris milik tenant lain.
do $$
declare
  fk record;
  ref_table text;
  on_delete text;
begin
  for ref_table in
    select distinct c.confrelid::regclass::text
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1
      and c.confrelid <> 'tenants'::regclass
      and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'tenant_id')
      and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'tenant_id')
  loop
    execute format('alter table %I add constraint %I unique (tenant_id, id)', ref_table, ref_table || '_tenant_id_uq');
  end loop;

  for fk in
    select c.conname, c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as ref,
           a.attname as col, ra.attname as ref_col, c.confdeltype
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1
      and c.confrelid <> 'tenants'::regclass
      and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'tenant_id')
      and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'tenant_id')
  loop
    on_delete := case fk.confdeltype
      when 'c' then 'cascade'
      when 'n' then format('set null (%I)', fk.col)
      else 'no action'
    end;
    execute format('alter table %I drop constraint %I', fk.tbl, fk.conname);
    execute format('alter table %I add constraint %I foreign key (tenant_id, %I) references %I (tenant_id, %I) on delete %s',
                   fk.tbl, fk.conname, fk.col, fk.ref, fk.ref_col, on_delete);
  end loop;
end $$;
