-- Item tunda platform: SSO OpenID Connect per tenant dan sumber kurs otomatis.

-- ---- SSO (OpenID Connect) ----
create table tenant_sso (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  -- Teks tombol di halaman login, mis. "Google Workspace" atau "Microsoft Entra ID".
  label text not null default 'SSO',
  issuer text not null,
  client_id text not null,
  client_secret_enc text,
  -- Kosong = semua domain email; selain itu hanya email berdomain ini.
  allowed_domains text[] not null default '{}',
  -- Buat user otomatis saat login SSO pertama (dengan peran bawaan).
  auto_provision boolean not null default false,
  default_role_id uuid references roles(id) on delete set null,
  -- Matikan login password untuk user selain admin pemilik (wajib SSO).
  enforce boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

-- ---- Sumber kurs otomatis ----
create table fx_settings (
  tenant_id uuid primary key default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'frankfurter')),
  -- Mata uang yang kursnya diambil (IDR per 1 unit).
  currencies text[] not null default '{USD}',
  -- Ambil otomatis setiap hari oleh penjadwal API.
  daily boolean not null default false,
  last_fetch_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['tenant_sso', 'fx_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
