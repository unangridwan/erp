-- Aplikasi terhubung: ERP sebagai penyedia login (OpenID Connect), akun layanan untuk API, webhook keluar.

-- Akun layanan (milik aplikasi terhubung): tanpa password, tidak bisa login, tidak dihitung batas pengguna paket.
alter table users add column kind text not null default 'human' check (kind in ('human', 'service'));

create table oauth_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  -- Publik, format `<tenant_id>.<acak>` agar tenant diketahui sebelum konteks RLS ada.
  client_id text not null unique,
  secret_hash text not null,
  redirect_uris text[] not null default '{}',
  post_logout_redirect_uris text[] not null default '{}',
  -- Kosong = semua pengguna aktif boleh masuk ke aplikasi ini.
  allowed_role_ids uuid[] not null default '{}',
  service_user_id uuid references users(id) on delete set null,
  webhook_url text check (char_length(webhook_url) <= 500),
  webhook_secret_enc text,
  webhook_events text[] not null default '{}',
  active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table oauth_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  client_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  company_id uuid,
  code_hash text not null unique,
  redirect_uri text not null,
  code_challenge text not null,
  nonce text,
  scope text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, client_id) references oauth_clients (tenant_id, id) on delete cascade
);

create table oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  client_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  company_id uuid,
  family_id uuid not null,
  token_hash text not null unique,
  scope text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, client_id) references oauth_clients (tenant_id, id) on delete cascade
);
create index oauth_refresh_tokens_family_idx on oauth_refresh_tokens (family_id);

-- Kunci tanda tangan id_token (global, dibaca lewat koneksi pemilik). Kunci privat terenkripsi ENCRYPTION_KEY.
create table oidc_keys (
  kid text primary key,
  alg text not null default 'RS256',
  private_jwk_enc text not null,
  public_jwk jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Outbox webhook: diisi trigger dalam transaksi yang sama dengan perubahan data; isi dibangun saat dikirim.
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  client_id uuid not null,
  event text not null,
  res_model text not null,
  res_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, client_id) references oauth_clients (tenant_id, id) on delete cascade
);
create index webhook_deliveries_pending_idx on webhook_deliveries (next_attempt_at) where state = 'pending';
create index webhook_deliveries_client_idx on webhook_deliveries (client_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['oauth_clients', 'oauth_codes', 'oauth_refresh_tokens', 'webhook_deliveries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Antrekan webhook untuk aplikasi yang berlangganan event ini. Perubahan yang hanya menyentuh updated_at diabaikan;
-- event yang sama untuk data yang sama dan belum dicoba kirim tidak diantrekan dua kali.
create function enqueue_webhook() returns trigger language plpgsql as $$
declare
  model text := tg_argv[0];
  ev text;
  rid uuid;
  tid uuid;
begin
  if tg_op = 'INSERT' then
    ev := model || '.created'; rid := new.id; tid := new.tenant_id;
  elsif tg_op = 'DELETE' then
    ev := model || '.deleted'; rid := old.id; tid := old.tenant_id;
  else
    if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then return null; end if;
    rid := new.id; tid := new.tenant_id;
    if (to_jsonb(old) ->> 'active')::boolean and not (to_jsonb(new) ->> 'active')::boolean then
      ev := model || '.archived';
    elsif not (to_jsonb(old) ->> 'active')::boolean and (to_jsonb(new) ->> 'active')::boolean then
      ev := model || '.reactivated';
    else
      ev := model || '.updated';
    end if;
  end if;
  insert into webhook_deliveries (tenant_id, client_id, event, res_model, res_id)
  select c.tenant_id, c.id, ev, model, rid
  from oauth_clients c
  where c.tenant_id = tid and c.active and c.webhook_url is not null and ev = any (c.webhook_events)
    and not exists (
      select 1 from webhook_deliveries d
      where d.client_id = c.id and d.res_id = rid and d.event = ev and d.state = 'pending' and d.attempts = 0
    );
  return null;
end $$;

create trigger employees_webhook after insert or update or delete on employees
  for each row execute function enqueue_webhook('employee');
create trigger departments_webhook after insert or update or delete on departments
  for each row execute function enqueue_webhook('department');
