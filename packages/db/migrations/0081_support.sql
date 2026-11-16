-- CRM bagian 4 (Service): tiket/kasus pelanggan, antrean (tim), kebijakan SLA + eskalasi, basis pengetahuan,
-- tiket dari portal pelanggan dan email masuk.

create table support_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  leader_id uuid,
  -- Agen di antrean ini; tiket baru tanpa penanggung jawab dibagi bergiliran ke mereka. Divalidasi aplikasi.
  member_ids uuid[] not null default '{}',
  auto_assign boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, leader_id) references users (tenant_id, id) on delete set null (leader_id)
);

-- Target waktu (jam kalender) per prioritas; kebijakan khusus tim menimpa kebijakan umum (team_id null).
create table support_sla_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  priority text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  team_id uuid,
  first_response_hours numeric(8, 2) not null check (first_response_hours > 0),
  resolution_hours numeric(8, 2) not null check (resolution_hours > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (resolution_hours >= first_response_hours),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references support_teams (tenant_id, id) on delete cascade
);
create unique index support_sla_unique_idx on support_sla_policies
  (company_id, priority, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)) where active;

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  number text not null,
  subject text not null check (char_length(subject) between 1 and 200),
  description text check (char_length(description) <= 20000),
  partner_id uuid,
  contact_id uuid,
  contact_name text check (char_length(contact_name) <= 200),
  email text check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 50),
  channel text not null default 'phone' check (channel in ('email', 'portal', 'phone', 'web', 'chat', 'other')),
  category text check (char_length(category) <= 100),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (status in ('new', 'open', 'pending', 'resolved', 'closed')),
  team_id uuid,
  user_id uuid,
  lead_id uuid,
  sla_policy_id uuid,
  first_response_due timestamptz,
  resolve_due timestamptz,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  first_response_breached boolean not null default false,
  resolution_breached boolean not null default false,
  escalated_at timestamptz,
  satisfaction smallint check (satisfaction between 1 and 5),
  satisfaction_note text check (char_length(satisfaction_note) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, number),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete set null (partner_id),
  foreign key (tenant_id, contact_id) references partners (tenant_id, id) on delete set null (contact_id),
  foreign key (tenant_id, team_id) references support_teams (tenant_id, id) on delete set null (team_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, lead_id) references crm_leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, sla_policy_id) references support_sla_policies (tenant_id, id) on delete set null (sla_policy_id)
);
create index support_tickets_status_idx on support_tickets (company_id, status);
create index support_tickets_partner_idx on support_tickets (partner_id) where partner_id is not null;

-- Percakapan tiket: balasan ke pelanggan (public), catatan internal, dan pesan dari pelanggan (customer).
create table support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  ticket_id uuid not null,
  kind text not null check (kind in ('public', 'internal', 'customer')),
  body text not null check (char_length(body) between 1 and 20000),
  author_user_id uuid,
  author_name text check (char_length(author_name) <= 200),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, ticket_id) references support_tickets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, author_user_id) references users (tenant_id, id) on delete set null (author_user_id)
);
create index support_ticket_messages_ticket_idx on support_ticket_messages (ticket_id, created_at);

create table support_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  category text check (char_length(category) <= 100),
  body text not null check (char_length(body) between 1 and 50000),
  published boolean not null default false,
  published_at timestamptz,
  views integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

-- Pengaturan per perusahaan: kunci webhook email masuk (hash), antrean bawaan, tutup otomatis.
create table support_settings (
  company_id uuid primary key,
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  inbound_key_hash text unique,
  default_team_id uuid,
  auto_close_days integer not null default 7 check (auto_close_days between 0 and 365),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, default_team_id) references support_teams (tenant_id, id) on delete set null (default_team_id)
);

do $$
declare t text;
begin
  foreach t in array array['support_teams', 'support_sla_policies', 'support_tickets', 'support_ticket_messages',
                           'support_articles', 'support_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
