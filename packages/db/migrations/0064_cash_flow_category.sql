-- Kelompok arus kas per akun (laporan arus kas metode tidak langsung). Kosong = otomatis dari jenis akun.
alter table accounts add column cash_flow_category text
  check (cash_flow_category in ('cash', 'operating', 'investing', 'financing'));
