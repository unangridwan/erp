-- Jenis kontrak kerja jadi master data (bukan lagi hanya PKWT/PKWTT): harian lepas, magang, kemitraan, dan jenis lain
-- bisa ditambah/diubah tanpa rilis baru saat peraturan berubah. Kolom contract_type di dokumen tetap menyimpan kode.

create table contract_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_-]{2,20}$'),
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 1000),
  -- Dasar hukum / catatan peraturan (mis. "PP 35/2021 Pasal 4–8").
  legal_basis text check (char_length(legal_basis) <= 300),
  -- true = wajib tanggal berakhir (waktu tertentu): ikut pengingat kontrak berakhir.
  fixed_term boolean not null default false,
  -- Batas masa satu kontrak (bulan); null = tanpa batas.
  max_months integer check (max_months between 1 and 600),
  -- Judul dokumen bawaan bila template tidak menentukan.
  document_title text check (char_length(document_title) <= 200),
  sequence integer not null default 10,
  -- Jenis bawaan sistem (PKWT/PKWTT): tidak bisa dihapus & kodenya tetap.
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

insert into contract_types (tenant_id, code, name, description, legal_basis, fixed_term, max_months, document_title, sequence, is_system)
select t.id, v.code, v.name, v.description, v.legal_basis, v.fixed_term, v.max_months, v.document_title, v.sequence, v.is_system
from tenants t
cross join (values
  ('pkwt', 'PKWT (kontrak)', 'Perjanjian kerja waktu tertentu.', 'UU 6/2023 jo. PP 35/2021 Pasal 4–8', true, 60,
   'PERJANJIAN KERJA WAKTU TERTENTU', 10, true),
  ('pkwtt', 'PKWTT (tetap)', 'Perjanjian kerja waktu tidak tertentu (karyawan tetap).', 'UU 6/2023 jo. PP 35/2021',
   false, null, 'PERJANJIAN KERJA WAKTU TIDAK TERTENTU', 20, true),
  ('harian', 'Harian lepas', 'Pekerja harian lepas: bekerja kurang dari 21 hari per bulan, upah per hari kehadiran.',
   'PP 35/2021 Pasal 10–11', false, null, 'PERJANJIAN KERJA HARIAN LEPAS', 30, false),
  ('magang', 'Magang', 'Pemagangan di perusahaan berdasarkan perjanjian pemagangan.', 'Permenaker 6/2020', true, 12,
   'PERJANJIAN PEMAGANGAN', 40, false),
  ('mitra', 'Mitra / kemitraan', 'Hubungan kemitraan (bukan hubungan kerja), mis. tenaga lepas atau mitra penjualan.',
   null, false, null, 'PERJANJIAN KEMITRAAN', 50, false)
) as v(code, name, description, legal_basis, fixed_term, max_months, document_title, sequence, is_system);

-- Lepas batasan lama 'pkwt'/'pkwtt' (termasuk "PKWT wajib tanggal berakhir" di penawaran; kini divalidasi dari master).
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('contracts'::regclass, 'contract_templates'::regclass, 'hiring_requests'::regclass, 'job_offers'::regclass)
      and pg_get_constraintdef(c.oid) like '%contract_type%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table contracts
  add foreign key (tenant_id, contract_type) references contract_types (tenant_id, code);
alter table contract_templates
  add foreign key (tenant_id, contract_type) references contract_types (tenant_id, code);
alter table hiring_requests
  add foreign key (tenant_id, contract_type) references contract_types (tenant_id, code);
alter table job_offers
  add foreign key (tenant_id, contract_type) references contract_types (tenant_id, code);

alter table contract_types enable row level security;
alter table contract_types force row level security;
create policy tenant_isolation on contract_types
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on contract_types to app_user;
