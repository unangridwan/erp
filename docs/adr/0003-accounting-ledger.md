# ADR 0003 — Buku besar akuntansi

- Status: Diterima
- Tanggal: 2026-10-17

## Konteks

Akuntansi adalah tulang punggung semua modul (penjualan, pembelian, persediaan, penggajian, konsolidasi).
Data keuangan harus dapat diaudit: entri yang sudah diposting tidak boleh berubah diam-diam, dan buku harus
selalu seimbang walau ada bug aplikasi.

## Keputusan

- Satu model entri (`account_moves` + `account_move_lines`) untuk jurnal umum, faktur, tagihan, nota kredit, dan
  pembayaran — seperti Odoo. Faktur menyimpan detail barang pada baris `product`, lalu baris `tax` dan
  `payment_term` (piutang/utang) dihasilkan server.
- Nilai baris dalam mata uang perusahaan (`debit`, `credit`, `balance` tergenerasi) plus `amount_currency` dalam mata
  uang dokumen. Semua perhitungan uang memakai desimal (bukan float).
- Integritas di database:
  - constraint trigger _deferred_: entri `posted` wajib ≥ 2 baris, debit = kredit, dan tanggal setelah lock date;
  - trigger guard: entri/baris posted tidak bisa diubah atau dihapus, kecuali kolom hasil rekonsiliasi;
  - koreksi hanya lewat jurnal balik (`reverse`), yang otomatis merekonsiliasi dokumen asal.
  - Offboarding tenant boleh melewati guard hanya sebagai pemilik schema (`set local erp.purge = 'on'`), tidak sebagai
    `app_user`.
- Nomor dokumen diberikan saat posting per jurnal & tahun (`INV/2026/0001`) dari sequence ber-row-lock, sehingga
  draft yang dihapus tidak meninggalkan celah nomor.
- Rekonsiliasi parsial (`partial_reconciles`) dalam mata uang perusahaan; status pembayaran faktur dihitung dari sisa
  baris piutang/utangnya.
- Pajak Indonesia dimodelkan dengan tarif + rasio DPP (PPN 12% dengan DPP 11/12 = efektif 11%; PPh 23 sebagai tarif
  negatif). Rasio dipulihkan sebagai pecahan agar DPP eksak pada nilai besar.
- Partner yang mewakili perusahaan grup otomatis memakai akun piutang/utang antar perusahaan dan setiap baris membawa
  `ic_company_id` — dasar eliminasi konsolidasi (Fase 5b). Dimensi `branch_id` dan `business_unit_id` per baris.

## Konsekuensi

- Laporan dihitung langsung dari baris posted dengan SQL agregat; untuk volume besar akan ditambah materialized view.
- Selisih kurs saat pelunasan dokumen valas belum dibukukan otomatis (sisa tetap di baris pembayaran) — direncanakan.
- Laporan multi-perusahaan saat ini menjumlahkan saja; eliminasi intercompany dilakukan oleh mesin konsolidasi.
