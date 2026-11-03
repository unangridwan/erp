-- Dokumen kontrak kerja: template berplaceholder (diisi dari data karyawan & kontrak) → PDF untuk ditandatangani basah
-- (dicetak lalu discan), di layanan e-sign luar (kolom tanda tangan), atau langsung di aplikasi (gambar tanda tangan
-- karyawan & perusahaan + jejak audit & kode verifikasi).

create table contract_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  -- null = untuk semua jenis kontrak.
  contract_type text check (contract_type in ('pkwt', 'pkwtt')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 60000),
  signer_name text check (char_length(signer_name) <= 200),
  signer_title text check (char_length(signer_title) <= 200),
  city text check (char_length(city) <= 100),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade
);

alter table contracts
  add column template_id uuid,
  -- Isi dokumen yang sudah diisi data karyawan (dikunci setelah ada tanda tangan).
  add column body text check (char_length(body) <= 80000),
  -- true = isi diedit manual (tidak dirender ulang dari template saat data karyawan berubah).
  add column body_custom boolean not null default false,
  add column document_title text,
  add column signer_name text,
  add column signer_title text,
  add column sign_city text,
  add column sign_state text not null default 'unsigned' check (sign_state in ('unsigned', 'pending', 'partial', 'signed')),
  add column sign_method text check (sign_method in ('digital', 'manual', 'external')),
  add column sign_requested_at timestamptz,
  add column document_hash text,
  add column verify_code text,
  add column signed_file_name text,
  add column signed_file_type text,
  add column signed_uploaded_at timestamptz,
  add column signed_uploaded_by uuid,
  add foreign key (tenant_id, template_id) references contract_templates (tenant_id, id) on delete set null (template_id);
create unique index contracts_verify_code on contracts (verify_code) where verify_code is not null;

create table contract_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  contract_id uuid not null,
  role text not null check (role in ('company', 'employee')),
  signer_name text not null,
  signer_title text,
  signer_user_id uuid,
  image bytea not null,
  -- Karyawan menandatangani di perangkat HR (tanpa akun portal).
  in_person boolean not null default false,
  ip text,
  user_agent text,
  document_hash text not null,
  signed_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (contract_id, role),
  foreign key (tenant_id, contract_id) references contracts (tenant_id, id) on delete cascade
);

-- Berkas kontrak bertanda tangan (scan / hasil e-sign luar) dipisah agar query kontrak (payroll dll.) tidak ikut memuatnya.
create table contract_signed_files (
  contract_id uuid primary key,
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  data bytea not null,
  unique (tenant_id, contract_id),
  foreign key (tenant_id, contract_id) references contracts (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['contract_templates', 'contract_signatures', 'contract_signed_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
  end loop;
end $$;
