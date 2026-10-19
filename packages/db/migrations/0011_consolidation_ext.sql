-- Fase 5b lanjutan: laba belum terealisasi persediaan, kepemilikan berubah di tengah periode (akuisisi bertahap,
-- penjualan sebagian, pelepasan), kurs historis per tanggal transaksi, saldo awal untuk laporan perubahan ekuitas &
-- arus kas konsolidasian, dan akun rekening antar kantor (RK pusat–cabang).

-- Akun RK pusat–cabang: saldo per cabang harus saling hapus dalam satu perusahaan.
alter table accounts add column branch_clearing boolean not null default false;

insert into accounts (tenant_id, company_id, code, name, account_type, branch_clearing)
select s.tenant_id, s.company_id, a.code, a.name, a.type, a.clearing
from accounting_settings s
cross join (values ('1-1900', 'Rekening Antar Kantor (RK Pusat–Cabang)', 'asset_current', true),
                   ('4-9400', 'Laba (Rugi) Pelepasan Investasi', 'income_other', false))
  as a(code, name, type, clearing)
on conflict (company_id, code) do nothing;

alter table group_accounts drop constraint group_accounts_role_check;
alter table group_accounts add constraint group_accounts_role_check check (role in (
  'investment', 'goodwill', 'nci_equity', 'nci_profit', 'cta', 'retained_earnings', 'associate_investment',
  'associate_income', 'ic_difference', 'inventory', 'cost_of_sales', 'dividends', 'equity_transactions',
  'disposal_gain'));

alter table consolidation_entries drop constraint consolidation_entries_kind_check;
alter table consolidation_entries add constraint consolidation_entries_kind_check check (kind in (
  'translation', 'investment', 'nci_profit', 'intercompany', 'equity_method', 'manual', 'unrealized_profit',
  'disposal'));

-- Tanggal pengendalian/pengaruh diperoleh & dilepas (laba rugi entitas hanya dihitung di antaranya), dan apakah
-- kurs historis ekuitas diisi manual (bila tidak, ekuitas dijabarkan dengan kurs pada tanggal transaksinya).
alter table consolidation_entities
  add column acquisition_date date,
  add column disposal_date date,
  add column historical_rate_manual boolean not null default false;

-- Sumber saldo awal: proses final periode sebelumnya, atau dihitung ulang per tanggal sebelum periode.
alter table consolidation_runs
  add column opening_source text check (opening_source in ('previous_run', 'computed')),
  add column opening_run_id uuid;

-- Posisi keuangan konsolidasian awal periode per akun grup (laba rugi sudah ditutup ke saldo laba).
create table consolidation_opening_balances (
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  run_id uuid not null,
  group_account_id uuid not null,
  amount numeric(20, 2) not null,
  primary key (run_id, group_account_id),
  foreign key (tenant_id, run_id) references consolidation_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_account_id) references group_accounts (tenant_id, id)
);
alter table consolidation_opening_balances enable row level security;
alter table consolidation_opening_balances force row level security;
create policy tenant_isolation on consolidation_opening_balances
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on consolidation_opening_balances to app_user;
