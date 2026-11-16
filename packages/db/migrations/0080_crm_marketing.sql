-- CRM bagian 3 (marketing): kampanye & anggota, email massal, skor lead, aturan penugasan, formulir web-to-lead.

create table crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 150),
  campaign_type text not null default 'email'
    check (campaign_type in ('email', 'event', 'webinar', 'ads', 'social', 'referral', 'other')),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  date_start date,
  date_end date,
  budget numeric(20, 2) not null default 0 check (budget >= 0),
  actual_cost numeric(20, 2) not null default 0 check (actual_cost >= 0),
  expected_revenue numeric(20, 2) not null default 0 check (expected_revenue >= 0),
  user_id uuid,
  description text check (char_length(description) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_end is null or date_start is null or date_end >= date_start),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id)
);

alter table crm_leads
  add column campaign_id uuid,
  add column score integer not null default 0 check (score between 0 and 100),
  add column do_not_contact boolean not null default false,
  add foreign key (tenant_id, campaign_id) references crm_campaigns (tenant_id, id) on delete set null (campaign_id);
create index crm_leads_campaign_idx on crm_leads (campaign_id) where campaign_id is not null;

-- Penerima kampanye: lead atau kontak/akun (tepat salah satu).
create table crm_campaign_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  campaign_id uuid not null,
  lead_id uuid,
  partner_id uuid,
  status text not null default 'targeted'
    check (status in ('targeted', 'sent', 'responded', 'unsubscribed', 'failed')),
  sent_at timestamptz,
  responded_at timestamptz,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  check ((lead_id is null) <> (partner_id is null)),
  foreign key (tenant_id, campaign_id) references crm_campaigns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references crm_leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade
);
create unique index crm_campaign_members_lead_idx on crm_campaign_members (campaign_id, lead_id) where lead_id is not null;
create unique index crm_campaign_members_partner_idx on crm_campaign_members (campaign_id, partner_id) where partner_id is not null;

create table crm_email_blasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  campaign_id uuid not null,
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  sent_by uuid,
  sent_at timestamptz not null default now(),
  foreign key (tenant_id, campaign_id) references crm_campaigns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sent_by) references users (tenant_id, id) on delete set null (sent_by)
);

-- Aturan skor: semua syarat cocok → poin ditambahkan (boleh negatif); skor lead dibatasi 0–100.
create table crm_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  conditions jsonb not null default '[]',
  points integer not null check (points between -100 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

-- Aturan penugasan lead tanpa penanggung jawab: aturan pertama (urutan terkecil) yang cocok; user bergiliran.
create table crm_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  sequence integer not null default 10,
  conditions jsonb not null default '[]',
  user_ids uuid[] not null default '{}',
  team_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_id) references sales_teams (tenant_id, id) on delete set null (team_id)
);

-- Formulir web-to-lead publik; hanya hash kuncinya yang disimpan.
create table crm_web_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  key_hash text not null unique,
  campaign_id uuid,
  source text not null default 'website'
    check (source in ('website', 'referral', 'event', 'ads', 'social', 'cold_call', 'other')),
  fields text[] not null default '{contactName,partnerName,email,phone,description}',
  required_fields text[] not null default '{contactName,email}',
  success_message text check (char_length(success_message) <= 500),
  redirect_url text check (char_length(redirect_url) <= 500),
  active boolean not null default true,
  submission_count integer not null default 0,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, campaign_id) references crm_campaigns (tenant_id, id) on delete set null (campaign_id)
);

do $$
declare t text;
begin
  foreach t in array array['crm_campaigns', 'crm_campaign_members', 'crm_email_blasts', 'crm_scoring_rules',
                           'crm_assignment_rules', 'crm_web_forms'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
