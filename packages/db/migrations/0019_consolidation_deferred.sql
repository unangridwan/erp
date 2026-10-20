-- Item tunda konsolidasi: reklasifikasi selisih kurs saat pelepasan, pengukuran ulang nilai wajar kepemilikan
-- sebelumnya pada akuisisi bertahap.

alter table group_accounts drop constraint group_accounts_role_check;
alter table group_accounts add constraint group_accounts_role_check check (role in (
  'investment', 'goodwill', 'nci_equity', 'nci_profit', 'cta', 'retained_earnings', 'associate_investment',
  'associate_income', 'ic_difference', 'inventory', 'cost_of_sales', 'dividends', 'equity_transactions',
  'disposal_gain', 'cta_reclassified', 'remeasurement_gain'));

-- Nilai wajar kepemilikan yang sudah dimiliki sebelum pengendalian diperoleh (PSAK 22), diisi pada baris kepemilikan
-- saat pengendalian diperoleh (mata uang penyajian grup). Kosong = tanpa pengukuran ulang (biaya perolehan).
alter table ownership_history add column previous_interest_fair_value numeric(20, 2);
