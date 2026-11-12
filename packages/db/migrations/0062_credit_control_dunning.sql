-- Batas kredit pelanggan per perusahaan (peringatan, tidak memblokir) dan penagihan bertingkat (dunning).
create table partner_credit_limits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  partner_id uuid not null,
  -- null = tanpa batas kredit.
  credit_limit numeric(20, 2) check (credit_limit >= 0),
  -- Peringatan bila ada faktur lewat jatuh tempo lebih dari N hari (null = tidak diperiksa).
  overdue_warn_days integer check (overdue_warn_days >= 0 and overdue_warn_days <= 3650),
  dunning_excluded boolean not null default false,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, partner_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade
);

create table dunning_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  sequence smallint not null check (sequence between 1 and 20),
  name text not null check (char_length(name) between 1 and 100),
  days_overdue integer not null check (days_overdue between 0 and 3650),
  email_subject text not null check (char_length(email_subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  attach_pdf boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sequence),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table dunning_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  partner_id uuid not null,
  level_id uuid,
  level_sequence smallint not null,
  level_name text not null,
  name text not null,
  date date not null,
  state text not null check (state in ('sent', 'failed', 'printed')),
  email_to text,
  currency_code text not null,
  total_overdue numeric(20, 2) not null,
  invoices jsonb not null default '[]',
  subject text not null,
  body text not null,
  -- null = dikirim otomatis oleh penjadwal.
  sent_by uuid,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, partner_id) references partners (tenant_id, id) on delete cascade,
  foreign key (tenant_id, level_id) references dunning_levels (tenant_id, id) on delete set null (level_id)
);
create index dunning_letters_partner_idx on dunning_letters (company_id, partner_id, date desc);

do $$
declare t text;
begin
  foreach t in array array['partner_credit_limits', 'dunning_levels', 'dunning_letters'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;

-- Tingkat dunning terakhir yang sudah dikirim per faktur (0 = belum pernah ditagih).
alter table account_moves
  add column dunning_level smallint not null default 0,
  add column last_dunning_at timestamptz;

alter table accounting_settings
  add column dunning_enabled boolean not null default false,
  add column dunning_min_amount numeric(20, 2) not null default 0 check (dunning_min_amount >= 0);

-- Tingkat dunning boleh berubah pada faktur terposting (bukan data akuntansi).
create or replace function erp_guard_posted_move() returns trigger language plpgsql as $$
begin
  if current_setting('erp.purge', true) = 'on' and current_user <> 'app_user' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'Entri jurnal % sudah diposting dan tidak bisa dihapus', coalesce(old.name, old.id::text)
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.state = 'posted'
     and (to_jsonb(new) - 'amount_residual' - 'payment_state' - 'updated_at' - 'dunning_level' - 'last_dunning_at')
         <> (to_jsonb(old) - 'amount_residual' - 'payment_state' - 'updated_at' - 'dunning_level' - 'last_dunning_at') then
    raise exception 'Entri jurnal % sudah diposting dan tidak bisa diubah', old.name using errcode = 'check_violation';
  end if;
  return new;
end $$;
