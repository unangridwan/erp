# Analisis fitur: ERP ini vs ERP sekelas SAP (S/4HANA)

Status per 12 November 2026 (migrasi terakhir `0061`). Pembanding: SAP S/4HANA (beserta SuccessFactors dan Group
Reporting) sebagai acuan ERP kelas enterprise. Penilaian berdasarkan kode di repo ini, bukan rencana.

Legenda: ✅ setara untuk kebutuhan umum · 🟡 ada tetapi lebih sederhana · ❌ belum ada.

## 1. Ringkasan

**Posisi produk.** ERP SaaS multi-tenant untuk perusahaan menengah dan grup usaha Indonesia (dagang, jasa, agro,
distribusi). Cakupannya setara Odoo Community/Enterprise tanpa manufaktur, ditambah lokalisasi Indonesia dan
konsolidasi grup yang lebih dalam. ERP ini **belum** pengganti SAP untuk korporasi manufaktur, multinasional, atau
bervolume transaksi sangat besar.

| Area                                | Cakupan dibanding SAP | Catatan singkat                                                     |
| ----------------------------------- | :-------------------: | ------------------------------------------------------------------- |
| Keuangan (FI)                       |         ±85%          | Inti lengkap + kredit, dunning, akrual, arus kas; payment run belum |
| Controlling (CO)                    |         ±60%          | Cost/profit center, laporan, alokasi biaya; product costing belum   |
| Konsolidasi grup                    |         ±85%          | Kuat: eliminasi IC, goodwill, NCI, CTA, segmen                      |
| Penjualan (SD) & CRM                |         ±60%          | Alur lengkap; pricing & kontrak sederhana                           |
| Pembelian (MM)                      |         ±60%          | RFQ–PO–3-way match; kontrak & landed cost belum                     |
| Persediaan & gudang (IM/EWM)        |         ±50%          | Multi gudang, lot/serial; bin & barcode belum                       |
| Manufaktur, QM, Maintenance, Proyek |          ±5%          | Belum ada (kecuali armada)                                          |
| SDM & Payroll (HCM/SuccessFactors)  |         ±85%          | Sangat lengkap untuk aturan Indonesia                               |
| Pajak Indonesia                     |   **lebih unggul**    | SAP perlu add-on partner lokal                                      |
| Platform (keamanan, integrasi, BI)  |         ±55%          | RBAC & persetujuan kuat; extensibility & BI belum                   |

**Keunggulan utama dibanding SAP:**

1. **Lokalisasi Indonesia bawaan**: Coretax (faktur keluaran/masukan, retur, NSFP, BPPU, BPMP, BPA1, BP21), PPh 21
   TER, BPJS per program, THR, pesangon PP 35/2021, UU PDP. Di SAP semua ini add-on atau kustomisasi.
2. **Siap pakai dan murah**: SaaS multi-tenant, daftar → langsung jalan (COA, pajak, gudang, komponen gaji otomatis),
   antarmuka dua bahasa, impor Excel. SAP butuh implementasi berbulan-bulan.
3. **Konsolidasi grup dan antarperusahaan** sudah menyatu dengan transaksi harian (SO↔PO antarperusahaan, rekening
   koran pusat-cabang, eliminasi otomatis).

**Celah terbesar:**

1. Tidak ada **manufaktur/MRP, QM, maintenance aset, dan project system**.
2. **Controlling** baru dasar: cost center, profit center, dan alokasi biaya periodik sudah ada; product costing dan
   profitabilitas (CO-PA) belum.
3. **Kontrol keuangan operasional**: payment run otomatis ke pemasok dan blokir pengiriman saat batas kredit terlampaui (batas kredit peringatan, dunning, akrual/deferral, jurnal berulang, dan arus kas sudah ada sejak P1).

## 2. Perbandingan per modul

### 2.1 Keuangan (SAP FI)

| Fitur SAP                                    | Status | Di ERP ini                                                                           |
| -------------------------------------------- | :----: | ------------------------------------------------------------------------------------ |
| Buku besar, COA, jurnal, multi perusahaan    |   ✅   | Akuntansi › Akun, Jurnal, Entri; COA otomatis saat perusahaan dibuat                 |
| Piutang & utang (faktur, tagihan, bayar)     |   ✅   | Akuntansi › Faktur, Tagihan, Pembayaran; umur piutang/utang                          |
| Multi mata uang & revaluasi kurs             |   ✅   | Kurs + sumber kurs otomatis, revaluasi kurs, selisih kurs realisasi                  |
| Rekonsiliasi bank                            |   ✅   | Akuntansi › Bank (impor mutasi CSV + mapping)                                        |
| Aset tetap (FI-AA)                           |   ✅   | Akuntansi › Aset: penyusutan, pelepasan                                              |
| Tutup buku periode                           |   ✅   | Pengaturan akuntansi (tanggal kunci, tutup tahun)                                    |
| Anggaran & realisasi                         |   🟡   | Anggaran per akun/periode; tanpa versi, komitmen, atau kontrol dana                  |
| Laporan keuangan                             |   ✅   | Neraca, laba rugi, neraca saldo, buku besar, arus kas (per perusahaan & konsolidasi) |
| Nomor dokumen per tahun                      |   ✅   | Urutan per tahun (`sequence_years`)                                                  |
| Batas kredit & blokir pengiriman             |   🟡   | Batas kredit per pelanggan per perusahaan (peringatan, tanpa blokir)                 |
| Dunning (surat tagih bertingkat)             |   ✅   | Akuntansi › Penagihan: tingkat, email + PDF, otomatis harian                         |
| Payment run otomatis (vendor)                |   🟡   | Ada file transfer bank untuk payroll; belum untuk pembayaran pemasok                 |
| Akrual/deferral, jurnal berulang             |   ✅   | Penangguhan prorata per baris faktur, pembalik otomatis, Jurnal Berulang             |
| Multi-ledger (IFRS + lokal), valuasi paralel |   ❌   | —                                                                                    |
| Jejak audit                                  |   🟡   | Log aktivitas & riwayat perubahan; belum log kepatuhan formal (SOX)                  |

### 2.2 Controlling (SAP CO)

| Fitur SAP                            | Status | Di ERP ini                                                       |
| ------------------------------------ | :----: | ---------------------------------------------------------------- |
| Dimensi analitik di jurnal           |   ✅   | Unit bisnis, cabang, cost center, profit center per baris        |
| Hierarki cost center / profit center |   ✅   | Akuntansi › Cost Center / Profit Center, Laporan Controlling     |
| Alokasi & distribusi biaya           |   ✅   | Akuntansi › Alokasi Biaya (persen / kunci statistik, bertingkat) |
| Product costing (HPP standar)        |   🟡   | Valuasi FIFO/rata-rata; tanpa standard cost & variance           |
| Profitabilitas (CO-PA)               |   🟡   | Laporan penjualan & segmen konsolidasi; tanpa CO-PA              |
| Biaya tenaga kerja per departemen    |   ✅   | Payroll › Biaya tenaga kerja, anggaran tenaga kerja (MPP)        |

### 2.3 Konsolidasi grup (SAP Group Reporting)

| Fitur SAP                                        | Status | Di ERP ini                                   |
| ------------------------------------------------ | :----: | -------------------------------------------- |
| Struktur kepemilikan, metode penuh/ekuitas       |   ✅   | Struktur Grup › Kepemilikan                  |
| Eliminasi antarperusahaan & rekonsiliasi IC      |   ✅   | Konsolidasi › Run, pemetaan akun grup        |
| Goodwill, NCI, CTA, akuisisi bertahap            |   ✅   | Termasuk kurs penutupan & reklasifikasi CTA  |
| Laba belum terealisasi (persediaan IC, asosiasi) |   ✅   |                                              |
| Laporan segmen & sub-grup, ekspor Excel          |   ✅   |                                              |
| Arus kas konsolidasi                             |   ✅   |                                              |
| Data collection dari sistem lain, workflow tutup |   🟡   | Hanya dari perusahaan dalam tenant yang sama |

### 2.4 Penjualan & CRM (SAP SD / Sales Cloud)

| Fitur SAP                                       | Status | Di ERP ini                                      |
| ----------------------------------------------- | :----: | ----------------------------------------------- |
| Lead, pipeline, aktivitas, alasan kalah         |   ✅   | CRM                                             |
| Penawaran → SO → kirim → faktur                 |   ✅   | Penjualan + Persediaan + Akuntansi              |
| Daftar harga & diskon                           |   🟡   | Pricelist; tanpa condition technique bertingkat |
| Komisi sales                                    |   ✅   | Rencana komisi                                  |
| Retur & nota kredit                             |   ✅   |                                                 |
| SO↔PO antarperusahaan                           |   ✅   |                                                 |
| Portal pelanggan                                |   ✅   | Faktur & pesanan                                |
| ATP (cek ketersediaan) & reservasi              |   🟡   | Reservasi stok; tanpa ATP berbasis jadwal       |
| Kontrak penjualan, scheduling agreement, rebate |   ❌   | —                                               |
| Uang muka penjualan                             |   ✅   | Termasuk perlakuan PPN uang muka                |

### 2.5 Pembelian (SAP MM)

| Fitur SAP                                  | Status | Di ERP ini                                      |
| ------------------------------------------ | :----: | ----------------------------------------------- |
| RFQ → PO → penerimaan → tagihan            |   ✅   | Pembelian                                       |
| Pencocokan 3 arah, selisih harga beli      |   ✅   | Pembelian › Pencocokan                          |
| Persetujuan PO bertingkat & batas wewenang |   ✅   | Pengaturan › Aturan persetujuan                 |
| Pemasok per produk, reorder otomatis       |   ✅   | Pemasok produk, aturan reorder, pengadaan ulang |
| Dropship                                   |   ✅   |                                                 |
| Kontrak kerangka / blanket PO, quota       |   ❌   | —                                               |
| Evaluasi pemasok                           |   ❌   | —                                               |
| Landed cost (bea, ongkir ke HPP)           |   ❌   | —                                               |
| Purchase requisition dari departemen       |   🟡   | Lewat permintaan persetujuan generik            |

### 2.6 Persediaan & gudang (SAP IM / EWM)

| Fitur SAP                                  | Status | Di ERP ini                                       |
| ------------------------------------------ | :----: | ------------------------------------------------ |
| Multi gudang & lokasi, transfer internal   |   ✅   | Gudang, Lokasi, Transfer                         |
| Valuasi FIFO / rata-rata, kartu stok       |   ✅   | Valuasi, Kartu stok                              |
| Lot & nomor serial, varian produk, satuan  |   ✅   | Lot/serial, konversi satuan, varian              |
| Penyesuaian / stock opname                 |   🟡   | Penyesuaian stok; tanpa jadwal cycle count       |
| Bin, putaway, picking wave, packing        |   ❌   | —                                                |
| Barcode / pemindai (RF)                    |   🟡   | Kolom barcode untuk pencarian; belum mode pindai |
| Kedaluwarsa (FEFO), karantina, QM inspeksi |   ❌   | —                                                |

### 2.7 Manufaktur, mutu, maintenance, proyek, transportasi

| Modul SAP                           | Status | Catatan                                                     |
| ----------------------------------- | :----: | ----------------------------------------------------------- |
| PP / MRP (BOM, routing, work order) |   ❌   | Belum ada; penting untuk anak usaha produksi (mis. herbal)  |
| QM (inspeksi mutu)                  |   ❌   | —                                                           |
| PM / EAM (maintenance aset)         |   🟡   | Hanya armada: servis, kontrak, odometer, pengingat STNK/KIR |
| PS (project system)                 |   ❌   | Integrasi aplikasi proyek luar sudah dihapus                |
| TM (transportasi)                   |   ❌   | —                                                           |

### 2.8 SDM & Payroll (SAP HCM / SuccessFactors)

| Fitur SAP                                   | Status | Di ERP ini                                                     |
| ------------------------------------------- | :----: | -------------------------------------------------------------- |
| Data karyawan, struktur organisasi, riwayat |   ✅   | Form karyawan, org chart, mutasi, SP, dokumen                  |
| Perencanaan tenaga kerja & rekrutmen        |   ✅   | MPP → FPK → lowongan → pelamar → penawaran → kontrak           |
| Kontrak, template, tanda tangan elektronik  |   ✅   | PKWT/PKWTT/harian/magang/mitra, PDF + e-sign + verifikasi      |
| Onboarding & offboarding                    |   ✅   | Checklist, exit interview, Full & Final                        |
| Waktu & kehadiran                           |   ✅   | Jadwal, shift, geofence, kiosk, mesin absensi, lembur otomatis |
| Cuti                                        |   ✅   | Akrual, carry-over, cuti bersama, ledger saldo                 |
| Payroll                                     |   ✅   | PPh 21 TER, gross-up, BPJS per program, THR, rapel, koreksi    |
| Kinerja (goal, 360, kalibrasi)              |   ✅   |                                                                |
| Kompensasi & benefit                        |   ✅   | Siklus kenaikan, total rewards, asuransi, DPLK                 |
| ESS / MSS (portal)                          |   ✅   | Portal Saya: slip (PIN), cuti, klaim, kontrak, sasaran         |
| Analitik SDM & laporan kustom               |   ✅   | Turnover, demografi, pay equity, pembuat laporan terjadwal     |
| Learning (LMS), succession, talent pool     |   🟡   | Pelatihan sederhana; tanpa LMS & succession                    |
| Payroll multi-negara                        |   ❌   | Khusus Indonesia                                               |

### 2.9 Pajak Indonesia

| Fitur                                             | Status | Catatan                         |
| ------------------------------------------------- | :----: | ------------------------------- |
| Faktur keluaran & masukan Coretax (XML)           |   ✅   | Termasuk retur, uang muka, NSFP |
| Bukti potong BPPU, BPMP, BPA1, BP21               |   ✅   |                                 |
| Rekap PPN                                         |   ✅   |                                 |
| SPT Masa PPN/PPh siap lapor otomatis ke DJP (API) |   ❌   | Ekspor file; belum host-to-host |

Di SAP, kebutuhan ini dipenuhi oleh add-on partner lokal (biaya tambahan).

### 2.10 Platform & teknologi

| Aspek                                   | Status | Di ERP ini                                                        |
| --------------------------------------- | :----: | ----------------------------------------------------------------- |
| Multi-tenant & isolasi data             |   ✅   | PostgreSQL Row-Level Security                                     |
| Hak akses granular & batas wewenang     |   ✅   | Peran per perusahaan, hak per fitur, delegasi, aturan persetujuan |
| SSO & integrasi                         |   ✅   | SSO OIDC/SAML masuk; ERP sebagai penyedia OIDC; webhook; REST API |
| Laporan kustom & terjadwal              |   🟡   | Pembuat laporan untuk SDM & payroll; modul lain laporan tetap     |
| Dashboard BI / analitik tertanam        |   ❌   | —                                                                 |
| Custom field & workflow designer visual |   ❌   | —                                                                 |
| EDI / IDoc, integrasi marketplace/bank  |   ❌   | Impor/ekspor file saja                                            |
| Aplikasi mobile                         |   🟡   | Web responsif; tanpa aplikasi native/offline                      |
| Skala & kinerja                         |   🟡   | Belum diuji pada jutaan transaksi; daftar dimuat ≤5.000 baris     |
| Ketersediaan tinggi & DR                |   🟡   | Backup + PITR ada; HA/DR multi-region belum terbukti              |

## 3. Peta jalan yang disarankan

Urutan berdasarkan dampak untuk target pasar (grup usaha menengah Indonesia).

| Prioritas | Paket                          | Isi                                                                                     | Memakai ulang                         |
| :-------: | ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------- |
|    P1     | Kontrol keuangan (✅ selesai)  | Batas kredit (peringatan), dunning, akrual/deferral, jurnal berulang, laporan arus kas  | Faktur, pembayaran, scheduler laporan |
|    P1     | Controlling dasar (✅ selesai) | Cost center & profit center (hierarki), alokasi biaya periodik, laporan per pusat biaya | Dimensi unit bisnis/cabang, anggaran  |
|    P2     | Payment run & bank             | Usulan bayar pemasok jatuh tempo, file transfer bank, persetujuan                       | File bank payroll, aturan persetujuan |
|    P2     | Pembelian & gudang lanjutan    | Landed cost, kontrak pembelian, evaluasi pemasok, barcode, cycle count, FEFO            | Picking, lot/serial, penyesuaian      |
|    P3     | Manufaktur ringan              | BOM, work order, konsumsi bahan & hasil produksi, MRP sederhana, HPP produksi           | Persediaan, valuasi, reorder          |
|    P4     | Platform                       | Custom field, dashboard BI, pembuat laporan untuk semua modul, workflow designer        | Pembuat laporan, mesin persetujuan    |
|    P5     | Maintenance & mutu             | Maintenance aset umum (bukan hanya armada), inspeksi mutu saat terima/produksi          | Modul armada, aset tetap              |

## 4. Kesimpulan

- Untuk **grup usaha Indonesia di bidang dagang, distribusi, jasa, dan agro**, ERP ini sudah setara atau lebih unggul
  dari SAP pada keuangan inti, pajak lokal, konsolidasi, dan SDM-payroll, dengan biaya dan waktu implementasi jauh
  lebih rendah.
- Untuk **manufaktur, kebutuhan controlling yang ketat, atau perusahaan multinasional bervolume besar**, SAP masih
  jauh lebih lengkap. Celah terpenting yang perlu ditutup lebih dulu: kontrol keuangan (P1) dan controlling dasar (P1),
  lalu manufaktur ringan (P3) bila ada anak usaha produksi.
