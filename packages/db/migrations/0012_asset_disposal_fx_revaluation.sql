-- Item tunda Fase 1: pelepasan/penjualan aset tetap (termasuk ke perusahaan grup) dan revaluasi selisih kurs akhir
-- bulan (belum terealisasi) atas piutang/utang & rekening bank valas.

alter table assets drop constraint assets_state_check;
alter table assets add constraint assets_state_check check (state in ('draft', 'running', 'closed', 'disposed'));
alter table assets
  add column disposal_date date,
  add column disposal_kind text check (disposal_kind in ('sale', 'scrap')),
  add column disposal_price numeric(20, 2),
  add column disposal_partner_id uuid,
  add column disposal_move_id uuid,
  add column disposal_invoice_id uuid,
  -- Laba (positif) / rugi pelepasan = harga jual − nilai buku (mata uang perusahaan).
  add column disposal_gain numeric(20, 2),
  -- Aset di perusahaan grup lain yang dijual ke perusahaan ini (dasar eliminasi laba belum terealisasi).
  add column source_asset_id uuid;

alter table accounting_settings
  add column asset_disposal_account_id uuid,
  add column unrealized_fx_gain_account_id uuid,
  add column unrealized_fx_loss_account_id uuid;

insert into accounts (tenant_id, company_id, code, name, account_type)
select s.tenant_id, s.company_id, a.code, a.name, a.type
from accounting_settings s
cross join (values ('4-9500', 'Laba (Rugi) Pelepasan Aset Tetap', 'income_other'),
                   ('4-9110', 'Laba Selisih Kurs Belum Terealisasi', 'income_other'),
                   ('7-1110', 'Rugi Selisih Kurs Belum Terealisasi', 'expense_other')) as a(code, name, type)
on conflict (company_id, code) do nothing;
update accounting_settings s set
  asset_disposal_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '4-9500'),
  unrealized_fx_gain_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '4-9110'),
  unrealized_fx_loss_account_id = (select id from accounts a where a.company_id = s.company_id and a.code = '7-1110');

-- Satu revaluasi per perusahaan per tanggal; jurnalnya dibalik otomatis sehari kemudian.
create table fx_revaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default nullif(current_setting('app.tenant_id', true), '')::uuid references tenants(id) on delete cascade,
  company_id uuid not null,
  date date not null,
  move_id uuid,
  reversal_move_id uuid,
  -- Rincian per baris/akun yang dinilai ulang (untuk ditampilkan kembali).
  lines jsonb not null default '[]',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (company_id, date),
  foreign key (tenant_id, company_id) references companies (tenant_id, id)
);
alter table fx_revaluations enable row level security;
alter table fx_revaluations force row level security;
create policy tenant_isolation on fx_revaluations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on fx_revaluations to app_user;
