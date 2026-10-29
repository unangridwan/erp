-- Penghitung nomor dokumen per tahun. Sebelumnya satu penghitung per kode di-reset ke 1 setiap kali tahun dokumen
-- berbeda dari tahun terakhir, sehingga dokumen bertanggal bolak-balik antar tahun (tanggal masuk karyawan, jurnal
-- mundur, kontrak) mendapat nomor yang sudah dipakai.

create table sequence_years (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  sequence_id uuid not null references sequences(id) on delete cascade,
  year smallint not null check (year between 1900 and 2999),
  next_number integer not null default 1 check (next_number >= 1),
  primary key (sequence_id, year)
);

alter table sequence_years enable row level security;
alter table sequence_years force row level security;
create policy tenant_isolation on sequence_years
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on sequence_years to app_user;

-- Isi dari nomor yang sudah terbit: pola "{prefix}/{tahun}/{nomor}" di kolom nomor tiap jenis dokumen.
with numbers as (
  select company_id, employee_number as number from employees
  union all select company_id, name from contracts
  union all select company_id, name from expense_claims
  union all select company_id, number from job_offers where number is not null
  union all select company_id, number from approval_requests where number is not null
  union all select company_id, name from account_moves where name is not null
  union all select company_id, name from stock_pickings
  union all select company_id, name from sale_orders
  union all select company_id, name from purchase_orders
),
matched as (
  select s.id as sequence_id, s.tenant_id,
    (regexp_match(n.number, '^' || regexp_replace(s.prefix, '([\^$.|?*+()\[\]{}\\])', '\\\1', 'g') || '/(\d{4})/(\d+)$')) as m
  from sequences s
  join numbers n on n.company_id = s.company_id
  where s.reset_yearly and n.number like s.prefix || '/%'
),
used as (
  select sequence_id, tenant_id, m[1]::smallint as year, max(m[2]::bigint) as max_number
  from matched
  where m is not null and m[1]::int between 1900 and 2999
  group by sequence_id, tenant_id, m[1]
)
insert into sequence_years (tenant_id, sequence_id, year, next_number)
select tenant_id, sequence_id, year, least(max_number + 1, 2147483647)::int from used;

-- Tahun berjalan penghitung lama: jangan turun di bawah nilai lamanya.
insert into sequence_years (tenant_id, sequence_id, year, next_number)
select tenant_id, id, current_year, next_number from sequences
where reset_yearly and current_year is not null
on conflict (sequence_id, year) do update set next_number = greatest(sequence_years.next_number, excluded.next_number);
