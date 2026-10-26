-- Rekrutmen hulu & offboarding: FPK → lowongan, master alasan penolakan, template & surat penawaran kerja,
-- alasan keluar karyawan, exit interview.

alter table job_openings
  -- Formulir Permintaan Karyawan (persetujuan kategori FPK) asal lowongan; satu FPK → satu lowongan.
  add column approval_request_id uuid,
  add column target_date date,
  add column wage_min numeric(20, 2) check (wage_min is null or wage_min >= 0),
  add column wage_max numeric(20, 2) check (wage_max is null or wage_max >= 0),
  add constraint job_openings_fpk_fk
    foreign key (tenant_id, approval_request_id) references approval_requests (tenant_id, id) on delete set null (approval_request_id),
  add constraint job_openings_wage_ck check (wage_min is null or wage_max is null or wage_max >= wage_min);
create unique index job_openings_fpk_uq on job_openings (approval_request_id) where approval_request_id is not null;

create table refuse_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  sequence integer not null default 10,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, name),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

alter table applicants
  add column refuse_reason_id uuid,
  -- Waktu masuk tahap saat ini & waktu diterima (laporan time-to-hire).
  add column stage_changed_at timestamptz not null default now(),
  add column hired_at timestamptz,
  -- Tahap terakhir sebelum ditolak (funnel).
  add column refused_stage text check (refused_stage in ('new', 'screening', 'interview', 'offer')),
  add constraint applicants_refuse_reason_fk
    foreign key (tenant_id, refuse_reason_id) references refuse_reasons (tenant_id, id) on delete set null (refuse_reason_id);
update applicants set stage_changed_at = updated_at, hired_at = case when stage = 'hired' then updated_at end;

create table offer_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  -- Isi surat dengan placeholder {nama}, {posisi}, {departemen}, {gaji}, {tunjangan}, {tanggal_mulai},
  -- {berlaku_sampai}, {jenis_kontrak}, {perusahaan}, {tanggal}.
  body text not null check (char_length(body) between 1 and 20000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

create table job_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  applicant_id uuid not null,
  template_id uuid,
  number text,
  wage numeric(20, 2) not null check (wage >= 0),
  benefits text check (char_length(benefits) <= 2000),
  contract_type text not null default 'pkwtt' check (contract_type in ('pkwt', 'pkwtt')),
  contract_end date,
  start_date date not null,
  valid_until date not null,
  body text not null,
  state text not null default 'draft' check (state in ('draft', 'sent', 'accepted', 'declined', 'expired', 'cancel')),
  sent_at timestamptz,
  responded_at timestamptz,
  response_note text check (char_length(response_note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, applicant_id) references applicants (tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_id) references offer_templates (tenant_id, id) on delete set null (template_id),
  check (contract_type <> 'pkwt' or contract_end is not null)
);
-- Satu penawaran aktif (draft/terkirim/diterima) per pelamar.
create unique index job_offers_active_uq on job_offers (applicant_id) where state in ('draft', 'sent', 'accepted');

alter table employees
  add column resign_reason text check (resign_reason in ('resign', 'end_contract', 'termination', 'retirement', 'death', 'other')),
  add column resign_note text check (char_length(resign_note) <= 1000);

create table exit_interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  employee_id uuid not null,
  date date not null,
  interviewer_id uuid,
  main_reason text not null check (main_reason in ('compensation', 'career', 'manager', 'workload', 'environment',
    'work_life', 'relocation', 'study', 'health', 'family', 'other')),
  -- Skor 1–5 per pertanyaan (kunci EXIT_QUESTIONS).
  scores jsonb not null default '{}',
  would_rejoin boolean,
  would_recommend boolean,
  comment text check (char_length(comment) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (employee_id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['refuse_reasons', 'offer_templates', 'job_offers', 'exit_interviews'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
