-- CRM bagian 1 (Sales Cloud inti): status & profil lead, produk per peluang, peran kontak, riwayat tahap,
-- profil akun/kontak di partner.

alter table crm_leads
  add column lead_status text not null default 'new'
    check (lead_status in ('new', 'contacted', 'qualified', 'unqualified')),
  add column title text check (char_length(title) <= 100),
  add column industry text check (char_length(industry) <= 100),
  add column website text check (char_length(website) <= 200),
  add column employee_count integer check (employee_count >= 0),
  add column annual_revenue numeric(20, 2) check (annual_revenue >= 0),
  add column street text check (char_length(street) <= 300),
  add column city text check (char_length(city) <= 100),
  add column province text check (char_length(province) <= 100),
  add column next_step text check (char_length(next_step) <= 300),
  -- Kontak utama (partner perorangan, biasanya anak dari akun).
  add column contact_id uuid,
  add column converted_at timestamptz,
  add foreign key (tenant_id, contact_id) references partners (tenant_id, id) on delete set null (contact_id);

-- Lead lama yang sudah menjadi peluang dianggap sudah terkualifikasi.
update crm_leads set lead_status = 'qualified' where lead_type = 'opportunity';

-- Produk yang ditawarkan pada peluang; bila ada baris, pendapatan harapan = jumlah subtotal.
create table crm_lead_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  lead_id uuid not null,
  sequence integer not null default 10,
  product_id uuid not null,
  name text check (char_length(name) <= 500),
  quantity numeric(18, 4) not null default 1 check (quantity > 0),
  price_unit numeric(20, 4) not null default 0 check (price_unit >= 0),
  discount numeric(7, 4) not null default 0 check (discount between 0 and 100),
  subtotal numeric(20, 2) not null default 0,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references crm_leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);
create index crm_lead_products_lead_idx on crm_lead_products (lead_id);

-- Peran kontak pada peluang (pengambil keputusan, pemberi pengaruh, …).
create table crm_contact_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  lead_id uuid not null,
  partner_id uuid not null,
  role text not null default 'other'
    check (role in ('decision_maker', 'influencer', 'champion', 'evaluator', 'buyer', 'user', 'other')),
  is_primary boolean not null default false,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (lead_id, partner_id),
  foreign key (tenant_id, lead_id) references crm_leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade
);
create unique index crm_contact_roles_primary_idx on crm_contact_roles (lead_id) where is_primary;

-- Riwayat perpindahan tahap/status: dasar laporan kecepatan pipeline.
create table crm_stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  lead_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid,
  state text not null default 'open' check (state in ('open', 'won', 'lost')),
  expected_revenue numeric(20, 2) not null default 0,
  probability numeric(5, 2) not null default 0,
  user_id uuid,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references crm_leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, from_stage_id) references crm_stages (tenant_id, id) on delete set null (from_stage_id),
  foreign key (tenant_id, to_stage_id) references crm_stages (tenant_id, id) on delete set null (to_stage_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id)
);
create index crm_stage_history_lead_idx on crm_stage_history (lead_id, changed_at);

-- Titik awal riwayat untuk peluang yang sudah ada.
insert into crm_stage_history (tenant_id, lead_id, to_stage_id, state, expected_revenue, probability, changed_at)
select tenant_id, id, stage_id, 'open', expected_revenue, probability, created_at
from crm_leads where lead_type = 'opportunity';
insert into crm_stage_history (tenant_id, lead_id, from_stage_id, to_stage_id, state, expected_revenue, probability, changed_at)
select tenant_id, id, stage_id, stage_id, state, expected_revenue, probability, coalesce(closed_at, updated_at)
from crm_leads where lead_type = 'opportunity' and state <> 'open';

-- Profil akun (perusahaan) & kontak (perorangan).
alter table partners
  add column industry text check (char_length(industry) <= 100),
  add column website text check (char_length(website) <= 200),
  add column employee_count integer check (employee_count >= 0),
  add column annual_revenue numeric(20, 2) check (annual_revenue >= 0),
  add column job_title text check (char_length(job_title) <= 100),
  add column account_rating text check (account_rating in ('hot', 'warm', 'cold')),
  add column do_not_contact boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['crm_lead_products', 'crm_contact_roles', 'crm_stage_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
