-- Pendapatan/biaya ditangguhkan (diakui prorata per bulan), jurnal berulang, dan pembalik otomatis jurnal akrual.

alter table accounting_settings
  add column deferred_revenue_account_id uuid,
  add column deferred_expense_account_id uuid;
alter table accounting_settings add foreign key (tenant_id, deferred_revenue_account_id)
  references accounts (tenant_id, id);
alter table accounting_settings add foreign key (tenant_id, deferred_expense_account_id)
  references accounts (tenant_id, id);

-- Perusahaan lama: akun Pendapatan Diterima di Muka (2-1650) dibuat bila belum ada; akun penangguhan diisi dari
-- bagan akun standar (2-1650 dan 1-1700 Biaya Dibayar Dimuka).
insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, '2-1650', 'Pendapatan Diterima di Muka', 'liability_current'
from accounting_settings s
where not exists (select 1 from accounts a where a.company_id = s.company_id and a.code = '2-1650');
update accounting_settings s set
  deferred_revenue_account_id = (select a.id from accounts a where a.company_id = s.company_id and a.code = '2-1650'),
  deferred_expense_account_id = (select a.id from accounts a where a.company_id = s.company_id and a.code = '1-1700');

alter table account_move_lines
  add column deferral_start date,
  add column deferral_end date,
  -- Akun tujuan asli (pendapatan/beban) dari baris yang dipindah ke akun penangguhan saat diposting.
  add column deferral_account_id uuid,
  add constraint account_move_lines_deferral_check check (
    (deferral_start is null and deferral_end is null)
    or (deferral_start is not null and deferral_end is not null and deferral_end >= deferral_start)
  );

create table recurring_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  journal_id uuid not null,
  ref text check (char_length(ref) <= 200),
  narration text check (char_length(narration) <= 2000),
  lines jsonb not null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval smallint not null default 1 check (interval between 1 and 12),
  start_date date not null,
  next_date date,
  end_date date,
  remaining_count integer check (remaining_count >= 0),
  auto_post boolean not null default false,
  auto_reverse boolean not null default false,
  active boolean not null default true,
  last_run_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references companies (tenant_id, id) on delete cascade,
  foreign key (tenant_id, journal_id) references journals (tenant_id, id)
);
alter table recurring_entries enable row level security;
alter table recurring_entries force row level security;
create policy tenant_isolation on recurring_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on recurring_entries to app_user;

alter table account_moves
  -- Draft yang diposting otomatis oleh penjadwal saat tanggalnya tiba (pengakuan penangguhan, jurnal berulang).
  add column auto_post boolean not null default false,
  -- Jurnal akrual: saat diposting, pembalik bertanggal ini dibuat & diposting otomatis.
  add column auto_reverse_date date,
  add column deferral_source_move_id uuid,
  add column recurring_id uuid;
alter table account_moves add foreign key (tenant_id, deferral_source_move_id)
  references account_moves (tenant_id, id);
-- Template yang sudah menghasilkan jurnal tidak bisa dihapus (nonaktifkan saja): entri terposting tidak boleh diubah.
alter table account_moves add foreign key (tenant_id, recurring_id)
  references recurring_entries (tenant_id, id);
create index account_moves_auto_post_idx on account_moves (date) where state = 'draft' and auto_post;
create index account_moves_deferral_source_idx on account_moves (deferral_source_move_id)
  where deferral_source_move_id is not null;
