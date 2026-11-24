-- Target berjenjang: sasaran kinerja bisa terhubung ke KPI otomatis (nilai berjalan dihitung dari data transaksi
-- untuk pemilik sasaran) dengan periode penilaian, dan dinilai menurut laju terhadap waktu yang sudah berjalan.

alter table performance_goals
  add column kpi_code text check (kpi_code is null or char_length(kpi_code) between 1 and 60),
  add column period_from date,
  add column period_to date,
  add column value_computed_at timestamptz,
  add constraint performance_goals_period_chk check (period_from is null or period_to is null or period_from <= period_to),
  -- KPI otomatis butuh periode agar nilainya bisa dihitung.
  add constraint performance_goals_kpi_period_chk check (kpi_code is null or (period_from is not null and period_to is not null));

create index performance_goals_kpi_idx on performance_goals (company_id, kpi_code) where kpi_code is not null;
