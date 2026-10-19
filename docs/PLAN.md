# Rencana Pembangunan ERP (mirip Odoo) — SaaS Multi-tenant, Fokus Indonesia

## Context
Repository `unangridwan/erp` masih kosong (belum ada commit). Tujuannya membangun ERP lengkap seperti Odoo:
modular, terintegrasi (Sales → Inventory → Accounting → HR), dijual sebagai **SaaS multi-tenant**, dengan
**lokalisasi Indonesia** (PPN, e-Faktur/Coretax DJP, PPh 21 TER, BPJS, Rupiah, Bahasa Indonesia).
Keputusan yang sudah diambil:
- Stack: **TypeScript full-stack** — NestJS + PostgreSQL + Drizzle ORM (backend), Next.js + React (frontend).
- MVP mencakup 4 domain: **Sales+CRM, Purchase+Inventory, Accounting, HR+Payroll**.

Rencana ini menyusun arsitektur, struktur repo, desain data inti, roadmap per fase, dan langkah pertama
yang akan dikerjakan di branch `claude/friendly-hypatia-g289ty`.

---

## 1. Arsitektur

**Modular monolith** (bukan microservices di awal) — satu deployable, tapi setiap modul ERP
terisolasi dengan batas jelas (seperti addon Odoo). Bisa dipecah jadi service nanti bila perlu.

```
Browser (Next.js App Router, React, TanStack Query, shadcn/ui)
        │  REST + OpenAPI (typed client di-generate)
API Gateway / NestJS app ──► Modul: core, crm, sales, purchase, inventory, accounting, hr, payroll, l10n_id
        │                          │ komunikasi antar modul via Domain Events (in-process EventBus + Outbox)
        ├── PostgreSQL 16 (Row-Level Security per tenant)
        ├── Redis (cache, session, BullMQ job queue)
        ├── Object storage S3/MinIO (lampiran, PDF faktur)
        └── Worker (BullMQ): PDF, email, laporan berat, sinkronisasi Coretax, payroll run
```

### Multi-tenancy
- **Shared DB, shared schema + kolom `tenant_id`** di setiap tabel bisnis, ditegakkan dengan
  **PostgreSQL Row-Level Security** (`SET app.tenant_id` per request/transaksi). Murah, skalabel,
  dan aman dari bocor data walau ada bug query.
- Tenant di-resolve dari subdomain (`acme.erpku.id`) atau header JWT.
- Dalam satu tenant: **struktur grup** — holding → anak/cucu perusahaan (entitas legal, `company_id`)
  → unit bisnis → cabang. Detail di §3.10 (Konsolidasi Grup).
- Tabel global (non-tenant): `tenants`, `plans`, `subscriptions`, mata uang, wilayah Indonesia, master pajak.

### Prinsip lintas-modul (meniru kekuatan Odoo)
| Konsep Odoo | Implementasi |
|---|---|
| Addon/modul + dependency | Setiap modul = NestJS module + manifest (`depends`, `permissions`, `menus`, `migrations`); modul bisa diaktifkan per tenant (dasar paket langganan) |
| ORM `res.partner` dll. | Master bersama di `core`: Partner (customer/vendor/karyawan kontak), Product, UoM, Currency, Company |
| Workflow state (`draft→confirmed→done`) | State machine eksplisit per dokumen (XState-like kecil / tabel transisi) + audit |
| Chatter / mail.thread | `activity_log` + komentar + lampiran polymorphic (`res_model`, `res_id`) untuk semua dokumen |
| Sequence (`SO/2026/0001`) | Service `sequence` per company, per tipe dokumen, reset tahunan, gap-safe dengan row lock |
| Access rights & record rules | RBAC (role → permission) + record rules (mis. salesperson hanya lihat lead miliknya) |
| Multi-currency | Kurs harian (sumber kurs BI/Kemenkeu), selisih kurs realized/unrealized |
| Reports QWeb | Template PDF (React-PDF / Puppeteer HTML→PDF) |
| Studio (custom field) | Fase lanjut: custom fields via kolom `jsonb` + metadata |

### Integrasi antar modul (event-driven)
- Sales Order confirmed → `inventory` buat Delivery Order.
- Delivery done → `accounting` jurnal HPP (COGS) & persediaan; Invoice posted → jurnal Piutang/Pendapatan/PPN Keluaran.
- Goods Receipt → jurnal persediaan / GRNI; Vendor Bill → Hutang + PPN Masukan.
- Payroll run → jurnal beban gaji, utang PPh 21, utang BPJS.
- Pola **Transactional Outbox** agar event tidak hilang; handler idempotent.

---

## 2. Struktur Repository (monorepo pnpm + Turborepo)

```
erp/
├── apps/
│   ├── api/                # NestJS (HTTP API)
│   ├── worker/             # BullMQ worker (pakai modul yang sama)
│   └── web/                # Next.js (UI back-office)
├── packages/
│   ├── db/                 # Drizzle schema, migrasi, seed, RLS policies
│   ├── modules/            # logika domain per modul (dipakai api & worker)
│   │   ├── core/  crm/  sales/  purchase/  inventory/
│   │   ├── accounting/  hr/  payroll/  l10n-id/
│   ├── shared/             # tipe, zod schema, util money/decimal, error
│   ├── ui/                 # komponen shadcn/ui + komponen ERP (DataTable, Form builder, Kanban, Chatter)
│   └── api-client/         # client ter-generate dari OpenAPI
├── infra/                  # docker-compose (postgres, redis, minio, mailpit), Dockerfile, k8s/helm nanti
├── docs/                   # ADR, desain modul, panduan
└── .github/workflows/      # CI: lint, typecheck, test, build
```

Tooling: pnpm, Turborepo, ESLint + Prettier, Vitest (unit), Jest/Supertest atau Vitest (integrasi API dengan
Testcontainers Postgres), Playwright (E2E), Zod untuk validasi, `decimal.js` untuk uang (**jangan float**;
simpan `numeric(18,2)` / kuantitas `numeric(18,4)`).

---

## 3. Modul & Fitur

### 3.0 Core / Platform (fondasi, wajib dulu)
- Auth: email+password, JWT access + refresh, 2FA (TOTP), undangan user, SSO (fase lanjut).
- Tenant onboarding & billing langganan (paket = kumpulan modul + kuota user).
- Company, cabang, user, role & permission, record rules, audit log.
- Master: Partner, Product (+varian, kategori, UoM & konversi), Currency & kurs, wilayah Indonesia (provinsi→kelurahan), bank.
- Sequence, lampiran, chatter/aktivitas, notifikasi (in-app + email), import/export CSV/Excel.
- UI framework generik: list view (filter, group-by, pencarian), form view, kanban, pivot/graph sederhana.

### 3.1 CRM
Lead/opportunity, pipeline kanban per stage, aktivitas & reminder, sumber lead, tim sales, alasan kalah,
konversi lead → customer → quotation.

### 3.2 Sales
Quotation → Sales Order → Delivery → Invoice; pricelist, diskon, syarat pembayaran, PDF penawaran,
down payment, retur penjualan, komisi sales (lanjut), laporan penjualan.

### 3.3 Purchase
Purchase Request (opsional) → RFQ → PO (approval bertingkat) → Goods Receipt → Vendor Bill
(3-way matching PO/GR/Bill), harga pemasok, retur pembelian.

### 3.4 Inventory
Multi-gudang & lokasi (hierarki), stock move & stock quant (model double-entry seperti Odoo:
setiap move dari lokasi A → B), picking (receipt/delivery/internal transfer), lot/serial & tanggal kedaluwarsa,
stock opname/penyesuaian, reorder rule (min/max), valuasi **FIFO & Average** dengan layer valuasi,
laporan kartu stok.

### 3.5 Accounting
- COA standar Indonesia (template SAK EMKM / SAK ETAP), jurnal (Penjualan, Pembelian, Kas, Bank, Umum).
- Journal entry double-entry dengan validasi debit=kredit, periode & lock date, tutup buku.
- AR/AP: invoice, credit note, pembayaran, rekonsiliasi (parsial), aging report.
- Bank: impor mutasi (CSV / format bank BCA/Mandiri/BRI), rekonsiliasi bank.
- Aset tetap & penyusutan (garis lurus/saldo menurun), anggaran (lanjut).
- Laporan: Neraca, Laba Rugi, Arus Kas, Buku Besar, Neraca Saldo — dapat difilter per perusahaan,
  unit bisnis, cabang; laporan konsolidasi grup di §3.10.
- Setiap baris jurnal wajib membawa dimensi `company_id`, `business_unit_id`, `branch_id` (+ analytic
  opsional: proyek, departemen) agar laporan per segmen tidak perlu jurnal terpisah.

### 3.6 HR
Karyawan (data pribadi, NIK, NPWP, PTKP, BPJS), struktur organisasi & jabatan, kontrak (PKWT/PKWTT),
absensi (clock-in web/mobile, geolokasi), shift, cuti & izin (saldo, approval), lembur.

### 3.7 Payroll
Komponen gaji (tunjangan tetap/tidak tetap, potongan), struktur gaji, payroll run bulanan,
slip gaji PDF, **PPh 21 metode TER (PP 58/2023)** + perhitungan tahunan Desember, **BPJS Kesehatan &
Ketenagakerjaan (JHT, JKK, JKM, JP)** dengan batas upah, THR, export file transfer bank, jurnal otomatis.

### 3.8 Lokalisasi Indonesia (`l10n-id`)
- PPN 11%/12% (DPP nilai lain 11/12 sesuai aturan 2025), PPnBM, PPh 23/4(2) potong-pungut.
- **e-Faktur / Coretax DJP**: generate NSFP, export XML Coretax untuk Faktur Pajak Keluaran,
  impor Faktur Masukan; e-Bupot (PPh 21/23).
- Format angka & tanggal Indonesia, terbilang Rupiah di invoice, Bahasa Indonesia default (i18n `next-intl`, EN tersedia).
- Kalender libur nasional untuk absensi/payroll.

### 3.10 Konsolidasi Grup (Holding, Anak Perusahaan, Unit Bisnis, Cabang)

**a. Struktur organisasi grup (3 level berbeda sifatnya)**
| Level | Sifat | Pembukuan | Konsolidasi |
|---|---|---|---|
| **Perusahaan / entitas legal** (holding, anak, cucu, asosiasi, JV) | Badan hukum sendiri, NPWP sendiri, COA & periode fiskal sendiri, bisa beda mata uang | Buku besar terpisah per `company_id` | Dikonsolidasi dengan eliminasi + kepemilikan |
| **Unit bisnis / divisi** | Segmen dalam satu atau lintas perusahaan | Dimensi pada baris jurnal | Agregasi (laporan segmen, PSAK 5) |
| **Cabang** | Lokasi operasional; opsional NPWP cabang/NITKU untuk faktur | Dimensi pada baris jurnal, atau "akun RK (Rekening Koran) Pusat–Cabang" bila cabang pembukuan mandiri | Gabung ke perusahaan induknya + eliminasi RK pusat-cabang |

- Pohon grup fleksibel (`group_structure`): node bisa holding, sub-holding, anak, cabang; mendukung
  kepemilikan bertingkat & tidak langsung (holding 80% A, A 60% B → efektif 48%).
- Riwayat kepemilikan bertanggal (`ownership_history`): akuisisi, divestasi, perubahan % di tengah periode.
- User bisa diberi akses ke satu/banyak perusahaan; switcher perusahaan di UI; dashboard grup untuk eksekutif holding.

**b. Metode konsolidasi per entitas (berdasarkan pengendalian, PSAK 65/66/15)**
- **Penuh (full)** — anak dikendalikan (>50% atau kendali de facto): 100% aset/liabilitas/laba digabung,
  porsi pihak lain dicatat sebagai **Kepentingan Non-Pengendali (KNP/NCI)**.
- **Proporsional** — operasi bersama (joint operation): digabung sesuai %.
- **Ekuitas (equity method)** — asosiasi/ventura bersama (20–50%): hanya baris "Investasi pada entitas asosiasi"
  dan "Bagian laba asosiasi".
- **Tidak dikonsolidasi** — investasi <20% (nilai wajar).

**c. Transaksi antar perusahaan (intercompany) — diotomasi di sumbernya**
- Partner otomatis untuk setiap perusahaan grup (flag `is_intercompany`, `ic_company_id`).
- **Aturan intercompany** (mirip Odoo): SO di perusahaan A ke perusahaan B otomatis membuat PO di B;
  invoice A otomatis membuat vendor bill di B; transfer stok antar perusahaan; pinjaman & dividen antar perusahaan;
  alokasi biaya / management fee holding ke anak.
- Akun intercompany khusus (piutang/hutang IC, pendapatan/beban IC) + **mitra IC wajib** pada baris jurnal (`ic_partner_company_id`).
- **Rekonsiliasi intercompany**: laporan pencocokan saldo A↔B per akun/periode, deteksi selisih
  (beda kurs, beda timing, belum dicatat), workflow konfirmasi saldo antar entitas sebelum tutup buku.

**d. Proses konsolidasi (per periode, dijalankan di worker)**
1. **Lock** periode di semua entitas (cek tutup buku & rekonsiliasi IC selesai).
2. **Mapping COA**: COA lokal tiap entitas → **COA grup** (`consolidation_account_map`), sehingga anak boleh punya COA berbeda.
3. **Translasi mata uang** (PSAK 10): aset & liabilitas kurs penutupan, L/R kurs rata-rata, ekuitas kurs historis;
   selisih ke "Selisih kurs penjabaran" di OCI.
4. **Penyesuaian** kebijakan akuntansi (bila beda) — jurnal penyesuaian konsolidasi.
5. **Eliminasi otomatis**:
   - Investasi induk vs ekuitas anak (+ goodwill / keuntungan pembelian dari PPA saat akuisisi).
   - Piutang ↔ hutang IC, pendapatan ↔ beban IC, dividen IC.
   - **Laba belum terealisasi** atas persediaan/aset tetap yang masih ada di entitas pembeli (unrealized profit, pakai margin per transaksi).
   - RK Pusat ↔ RK Cabang.
6. **Hitung KNP** atas ekuitas & laba anak (kepemilikan efektif bertingkat).
7. **Jurnal konsolidasi manual** (top-side adjustment) dengan approval dan audit trail.
8. Simpan **snapshot hasil** (`consolidation_run` versi, bisa dijalankan ulang/draft vs final).

Jurnal eliminasi & penyesuaian disimpan di **"entitas konsolidasi" virtual** (buku terpisah), sehingga
buku besar entitas legal tidak pernah tersentuh.

**e. Laporan konsolidasi**
- Neraca, Laba Rugi & OCI, Arus Kas, Perubahan Ekuitas — konsolidasian.
- **Kertas kerja konsolidasi (worksheet)**: kolom per entitas → total gabungan → eliminasi → konsolidasi, drill-down sampai jurnal sumber.
- Laporan per sub-grup (konsolidasi parsial: misal sub-holding saja), per unit bisnis, per cabang, laporan segmen.
- Perbandingan periode, budget vs aktual grup, ekspor Excel/PDF.
- Konsolidasi non-keuangan: stok grup, penjualan grup, headcount & biaya gaji grup (dashboard).

**f. Fase pengerjaan**
- Fase 0: model `companies` hierarkis + dimensi unit bisnis/cabang + akses multi-company (fondasi wajib sejak awal).
- Fase 1: dimensi pada jurnal, laporan per entitas/unit/cabang, akun & partner intercompany.
- Fase 2–3: aturan intercompany otomatis (SO↔PO, invoice↔bill, transfer stok).
- **Fase 5b (baru, 5–6 minggu)**: mesin konsolidasi (mapping COA, translasi, eliminasi, KNP, equity method,
  worksheet, laporan konsolidasian, rekonsiliasi IC).

### 3.9 Fase lanjut (setelah MVP, menuju "selengkap Odoo")
POS (offline-capable), Manufacturing/MRP (BoM, work order), Project & Timesheet, Helpdesk, Website/e-commerce,
Marketing/email, Fleet, Maintenance, Document management, Approval engine generik, Studio (custom field/form),
mobile app (React Native/Expo), integrasi marketplace (Tokopedia/Shopee), payment gateway (Midtrans/Xendit),
BI dashboard, public REST API + webhook untuk partner.

---

## 4. Desain Data Inti (contoh tabel kunci)
Semua tabel bisnis: `id uuid`, `tenant_id`, `company_id`, `created_at/by`, `updated_at/by`, `deleted_at` (soft delete untuk master).

- `core`: tenants, companies, users, roles, permissions, user_roles, partners, partner_addresses, products, product_variants, uom, currencies, currency_rates, sequences, attachments, activity_logs, outbox_events
- `crm`: crm_stages, crm_leads, crm_activities
- `sales`: pricelists, sale_orders, sale_order_lines
- `purchase`: purchase_orders, purchase_order_lines
- `inventory`: warehouses, stock_locations, stock_pickings, stock_moves, stock_quants, stock_lots, stock_valuation_layers
- `accounting`: accounts, journals, account_moves, account_move_lines, taxes, payments, reconciliations, fiscal_periods
- `hr/payroll`: employees, departments, jobs, contracts, attendances, leaves, leave_allocations, salary_rules, payslips, payslip_lines
- `l10n_id`: tax_invoices (faktur pajak), nsfp_ranges, withholding_slips (bupot)
- `group/consolidation`: companies (`parent_id`, `entity_type`: holding/subsidiary/associate/jv, `currency_id`, `fiscal_year_start`),
  business_units, branches (`company_id`, `nitku`), ownership_history (`parent_company_id`, `child_company_id`, `pct`, `valid_from/to`, `method`),
  intercompany_rules, group_accounts (COA grup), consolidation_account_map, consolidation_runs, consolidation_entries
  (eliminasi/penyesuaian), consolidation_balances (snapshot per entitas per akun grup), ic_reconciliations, acquisitions (goodwill/PPA)
- `account_move_lines` membawa: `company_id`, `business_unit_id`, `branch_id`, `ic_partner_company_id`, `analytic_distribution jsonb`

Aturan penting: dokumen yang sudah *posted* immutable (koreksi lewat reversal/credit note), semua angka uang pakai decimal.

---

## Status
- [x] Scaffold monorepo, CI, RLS multi-tenant, struktur grup (tenant, perusahaan, kepemilikan, unit bisnis, cabang)
- [x] Fase 0 (inti): auth JWT, RBAC + akses per perusahaan, master Partner/Product/UoM/Currency, partner intercompany
  otomatis, sequence dokumen, log aktivitas, UI list/form generik
- [x] Fase 0 (lanjutan): refresh token berotasi, 2FA TOTP (secret terenkripsi AES-GCM), rate limit login,
  undangan user via email, impor/ekspor CSV, UI dua bahasa (ID/EN), kurs harian + konversi, FK komposit
  `(tenant_id, id)`, data wilayah Indonesia (Kepmendagri 2025)
- [x] Fase 1 (Akuntansi inti): bagan akun standar Indonesia otomatis per perusahaan, jurnal, pajak (PPN 12% DPP 11/12,
  PPN barang mewah, PPh 23 dipotong), faktur & tagihan multi mata uang, jurnal umum, posting bernomor per jurnal,
  jurnal balik / nota kredit, pembayaran & rekonsiliasi parsial, lock date, akun piutang/utang antar perusahaan,
  dimensi cabang & unit bisnis, laporan (neraca saldo, buku besar, neraca, laba rugi, umur piutang/utang)
- [x] Fase 1 (lanjutan): selisih kurs otomatis saat pelunasan valas, rekonsiliasi bank (impor CSV mutasi dengan pemetaan
  kolom, saran pencocokan, biaya bank, pembatalan), aset tetap & penyusutan (garis lurus / saldo menurun, preset kelompok
  fiskal), tutup buku akhir tahun, anggaran vs realisasi, ekspor Excel & cetak/PDF laporan
- [x] Fase 2 (CRM + Penjualan): lead & peluang dengan pipeline kanban (seret antar tahap), konversi lead → pelanggan,
  tandai menang/kalah (alasan kalah), aktivitas terjadwal (telepon/rapat/email/to-do) + "Aktivitas Saya", tim penjualan,
  aturan rekaman (penjual hanya melihat data miliknya tanpa `crm.all`/`sales.all`), analisis pipeline tertimbang;
  penawaran → pesanan (nomor `SO/2026/0001`), daftar harga (produk/kategori/semua, min. kuantitas, promo bertanggal,
  valas), termin pembayaran, pajak bawaan PPN, PDF penawaran & kirim email berlampiran, konfirmasi menandai peluang
  menang, faktur dari pesanan (sisa kuantitas, uang muka persentase/tetap ke akun Uang Muka Pelanggan, potongan DP di
  faktur akhir), status penagihan dihitung dari faktur/nota kredit, analisis penjualan
- [x] Fase 3 (Pembelian + Persediaan): gudang & lokasi hierarkis (lokasi virtual pemasok/pelanggan/penyesuaian),
  transfer penerimaan/pengiriman/internal dengan backorder & retur, lot/serial (+ kedaluwarsa), quant per lokasi,
  valuasi perpetual FIFO & rata-rata tertimbang dengan jurnal otomatis (Persediaan ↔ Barang Diterima Belum Ditagih / HPP /
  Selisih Persediaan), stock opname, kartu stok, valuasi per tanggal, aturan pemesanan ulang min/max → RFQ otomatis;
  harga pemasok bertingkat, RFQ → PO dengan batas persetujuan, penerimaan otomatis dari PO, tagihan dari PO sebatas barang
  diterima (3-way matching), analisis pembelian; SO kini membuat pengiriman dan ditagih sesuai kuantitas terkirim
- [x] Fase 4 (SDM + Payroll): departemen, jabatan, karyawan (NIK/NPWP/rekening terenkripsi AES-256-GCM, tersamar tanpa
  `hr.manage`), kontrak PKWT/PKWTT dengan tunjangan tetap/tidak tetap, absensi masuk/pulang (dengan lokasi), hari libur,
  jenis/jatah/pengajuan cuti dengan saldo & persetujuan, lembur (PP 35/2021), portal karyawan (absen, cuti, slip gaji);
  payroll bulanan dengan PPh 21 metode TER (PP 58/2023) dan perhitungan setahun di masa pajak terakhir (PMK 168/2023,
  termasuk pengembalian kelebihan potong), BPJS Kesehatan/JHT/JKK/JKM/JP dengan batas upah, THR/bonus/potongan per slip,
  prorata karyawan baru/keluar, jurnal gaji per cabang/unit bisnis, pembayaran, file transfer bank, rekap PPh 21 & BPJS,
  slip gaji PDF
- [x] Fase 5 (Lokalisasi pajak & go-live): profil pajak perusahaan (PKP, NPWP 16 digit, ID TKU) & identitas pajak
  pembeli (NPWP/NIK/paspor, kode tempat usaha, kode transaksi); faktur pajak keluaran dari faktur penjualan dengan DPP
  nilai lain 11/12, kode barang/jasa & satuan Coretax, kode 07/08 dengan cap fasilitas, ekspor XML `TaxInvoiceBulk`,
  pencatatan/impor nomor faktur; impor faktur masukan Coretax dengan pencocokan otomatis ke tagihan & pengkreditan
  maks. 3 masa; bukti potong unifikasi (PPh 23/4(2)/22) dari tagihan & BPMP PPh 21 dari payroll dengan ekspor XML;
  rekap SPT Masa PPN; billing SaaS (paket Starter/Bisnis/Enterprise, uji coba, batas pengguna/perusahaan & modul,
  baca-saja saat berakhir, tagihan + PPN, Xendit/transfer manual, perpanjangan otomatis, konsol admin platform);
  panduan awal (profil, saldo awal, checklist); hardening (header keamanan, ID korelasi request, log JSON, metrik
  Prometheus, readiness, daftar & pencabutan sesi, validasi secret produksi), Dockerfile produksi, compose produksi,
  backup harian + restore
- [x] Fase 5b (Konsolidasi grup): bagan akun grup dengan akun peran khusus, pemetaan akun per perusahaan (otomatis
  berdasarkan kode), struktur grup bertingkat dari riwayat kepemilikan (kepemilikan efektif), metode penuh/proporsional/
  ekuitas, translasi kurs (penutupan/rata-rata/historis, selisih ke OCI), eliminasi investasi dengan goodwill & keuntungan
  pembelian murah, KNP atas ekuitas & laba, eliminasi saldo & transaksi antar perusahaan (selisih ke akun selisih IC
  dengan peringatan), jurnal penyesuaian manual, kertas kerja (CSV), neraca & laba rugi konsolidasian dengan atribusi
  pemilik/KNP, rekonsiliasi IC, proses draft/final
- [x] Fase 5b (lanjutan): laba belum terealisasi atas persediaan antar perusahaan otomatis dari lapisan valuasi (FIFO
  stok akhir, termasuk realisasi saldo awal & bagian KNP untuk penjualan upstream) dan eliminasi penjualan barang
  antar perusahaan ke HPP; ekuitas dijabarkan dengan kurs per tanggal transaksi (atau kurs historis manual); entitas
  diakuisisi di tengah periode (laba rugi sejak tanggal pengendalian), akuisisi bertahap & penjualan sebagian tanpa
  kehilangan pengendalian (selisih ke ekuitas, KNP ditimbang per tahap), pelepasan entitas anak/asosiasi di tengah
  periode (laba rugi sampai tanggal lepas, penyesuaian laba pelepasan grup); dividen antar perusahaan & dari asosiasi
  dieliminasi otomatis; selisih IC akibat kurs ke selisih kurs penjabaran; saldo awal dari proses final periode
  sebelumnya atau dihitung ulang; laporan perubahan ekuitas & arus kas (tidak langsung) konsolidasian; ekspor Excel
  multi-lembar & cetak/PDF; akun & laporan RK pusat–cabang dengan peringatan di konsolidasi
- [ ] Fase 5b ditunda: reklasifikasi selisih kurs penjabaran saat entitas asing dilepas, pengukuran ulang nilai wajar
  kepemilikan sebelumnya pada akuisisi bertahap, goodwill entitas asing dijabarkan kurs penutupan, laba belum
  terealisasi pada transaksi dengan asosiasi, laporan per sub-grup/segmen
- [ ] Fase 5 ditunda: bukti potong A1/A2 (XML), retur/pengganti faktur pajak via XML, faktur uang muka/pelunasan,
  PPnBM (STLG) per produk, validasi XSD resmi, NSFP lama (pra-Coretax), PITR/WAL archiving terkelola, tracing
  OpenTelemetry, Sentry
- [ ] Fase 4 ditunda: jadwal shift & aturan keterlambatan, approval berjenjang, pinjaman
  karyawan dengan cicilan otomatis, pesangon (PP 35/2021), BPJS untuk pekerja harian/borongan
- [x] Fase 2–3 (tunda, selesai sebagian): aturan antar perusahaan — SO → draft RFQ, PO → draft penawaran, faktur/nota
  kredit → draft tagihan/nota debit terhubung baris PO (transfer stok antar perusahaan lewat pasangan SO/PO); draft nota
  kredit/debit otomatis dari retur barang yang sudah ditagih; selisih harga tagihan vs PO ke akun 5-1100; aturan komisi
  (per penjual/tim/bawaan, dasar faktur atau lunas) dan laporan komisi + Excel
- [x] Fase 3 (tunda, selesai): satuan beli/jual dengan konversi (baris SO/PO/faktur dalam satuan sekategori, stok &
  valuasi dalam satuan produk), reservasi stok untuk transfer keluar (urut jadwal, cek ketersediaan, lepas cadangan,
  stok tercadang tidak bisa dipakai transfer lain), dropship SO → RFQ pemasok utama → transfer pemasok → pelanggan
  (HPP langsung sebesar harga beli)
- [ ] Fase 2–3 ditunda: varian produk, portal pelanggan
- [x] Fase 1 (tunda, selesai): pelepasan aset tetap — dijual (faktur pelanggan + jurnal pelepasan, laba/rugi ke akun
  4-9500, penyusutan sampai bulan sebelum pelepasan) atau dihapusbukukan; penjualan ke perusahaan grup membuat draf aset di
  buku pembeli dan laba belum terealisasinya dieliminasi di konsolidasi (berkurang seiring penyusutan pembeli); revaluasi
  selisih kurs akhir bulan atas piutang/utang valas terbuka & rekening valas ke akun belum terealisasi (4-9110/7-1110)
  dengan jurnal balik otomatis
- [ ] Fase 1 ditunda: koneksi API bank langsung (butuh kerja sama/kredensial bank; impor CSV mutasi sudah tersedia)
- [ ] Ditunda: rate limiter berbasis Redis (multi-instance), SSO, impor Excel (.xlsx), sumber kurs otomatis
  (KMK kurs pajak / BI), pesan error API dua bahasa

## 5. Roadmap Bertahap

| Fase | Durasi (tim 3–5 dev) | Hasil |
|---|---|---|
| **0. Fondasi** | 4–6 minggu | Monorepo, CI, docker-compose, DB + RLS, auth, tenant & company, RBAC, master Partner/Product/UoM, sequence, chatter, UI shell (menu, list/form generik), i18n |
| **1. Accounting inti** | 6–8 minggu | COA, jurnal, journal entry, pajak, invoice/bill manual, pembayaran, rekonsiliasi, laporan dasar (GL, TB, Neraca, L/R) — jadi "tulang punggung" semua modul lain |
| **2. Sales + CRM** | 5–6 minggu | Lead/pipeline, quotation→SO→invoice otomatis, PDF, pricelist |
| **3. Purchase + Inventory** | 8–10 minggu | PO→GR→Bill, gudang/lokasi, stock move, delivery dari SO, valuasi FIFO/Average, jurnal otomatis persediaan & HPP |
| **4. HR + Payroll** | 6–8 minggu | Karyawan, absensi, cuti, payroll run, PPh 21 TER, BPJS, slip, jurnal gaji |
| **5. Lokalisasi pajak & go-live MVP** | 4–6 minggu | e-Faktur/Coretax XML, e-Bupot, billing SaaS, onboarding wizard, hardening keamanan, backup, monitoring → **beta pelanggan** |
| **5b. Konsolidasi grup** | 5–6 minggu | Mapping COA grup, translasi kurs, eliminasi IC & laba belum terealisasi, KNP, equity method, worksheet & laporan konsolidasian, rekonsiliasi IC (fondasi struktur grup & dimensi sudah dibangun sejak Fase 0–3) |
| **6+. Ekspansi** | berkelanjutan | Modul fase lanjut (POS, MRP, Project, dll.) |

Total MVP termasuk konsolidasi ±9–12 bulan. Setiap fase diakhiri demo alur end-to-end.

---

## 6. Non-fungsional
- **Keamanan**: RLS + guard tenant di aplikasi, OWASP ASVS, rate limiting, enkripsi data sensitif (NIK, NPWP, rekening) di level kolom, audit trail, kepatuhan **UU PDP**.
- **Performa**: index `(tenant_id, company_id, …)`, pagination cursor, laporan berat di worker + materialized view.
- **Observability**: logging terstruktur (pino), OpenTelemetry, Sentry, health check.
- **DevOps**: Docker, staging & production, migrasi DB otomatis di CI/CD, backup PITR, hosting di region Indonesia (data residency).
- **Kualitas**: unit test untuk logika perhitungan (pajak, payroll, valuasi stok wajib coverage tinggi), integration test per alur dokumen, E2E Playwright untuk alur utama.

---

## 7. Langkah Pertama yang Akan Dikerjakan (setelah rencana disetujui)
Di branch `claude/friendly-hypatia-g289ty`:
1. `docs/`: simpan rencana ini sebagai `docs/PLAN.md` + ADR awal (`docs/adr/0001-modular-monolith.md`, `0002-multitenancy-rls.md`).
2. Scaffold monorepo: `package.json` root, `pnpm-workspace.yaml`, `turbo.json`, tsconfig base, ESLint/Prettier.
3. `apps/api` (NestJS) dengan health endpoint, `apps/web` (Next.js) shell, `packages/db` (Drizzle + migrasi awal tabel `tenants`, `companies` hierarkis (`parent_id`, `entity_type`),
   `business_units`, `branches`, `users`, `user_companies`) beserta policy RLS.
4. `infra/docker-compose.yml`: postgres, redis, minio, mailpit.
5. CI GitHub Actions: lint, typecheck, test, build.
6. README berisi cara menjalankan lokal.
7. Commit & push ke `claude/friendly-hypatia-g289ty`.

## 8. Verifikasi (untuk langkah pertama)
- `pnpm install && pnpm -w lint && pnpm -w typecheck && pnpm -w test` lulus.
- `docker compose -f infra/docker-compose.yml up -d` lalu `pnpm --filter db migrate` sukses.
- `pnpm --filter api dev` → `GET /health` mengembalikan 200; `pnpm --filter web dev` → halaman login/shell tampil.
- Test integrasi RLS: query dengan `app.tenant_id` tenant A tidak bisa membaca baris tenant B.
- (Saat Fase 5b) test konsolidasi dengan skenario grup contoh: holding 100% anak A, 80% anak B (beda mata uang USD),
  30% asosiasi C, penjualan IC A→B dengan stok tersisa — cocokkan worksheet dengan hitungan manual
  (eliminasi IC = 0 selisih, KNP 20% benar, neraca konsolidasi balance).
