# ERP

ERP SaaS multi-tenant (mirip Odoo) dengan lokalisasi Indonesia dan konsolidasi grup usaha.
Rencana lengkap: [docs/PLAN.md](docs/PLAN.md) · Keputusan arsitektur: [docs/adr](docs/adr).

## Struktur

| Path              | Isi                                                             |
| ----------------- | --------------------------------------------------------------- |
| `apps/api`        | Backend NestJS                                                  |
| `apps/web`        | Frontend Next.js                                                |
| `packages/db`     | Skema Drizzle, migrasi SQL, Row-Level Security                  |
| `packages/shared` | Tipe & util bersama (mis. perhitungan kepemilikan efektif grup) |
| `infra`           | docker-compose untuk Postgres, Redis, Mailpit                   |

## Menjalankan lokal

Prasyarat: [Git](https://git-scm.com), [Node.js 22](https://nodejs.org), pnpm 10 (`npm i -g pnpm`), dan
[Docker Desktop](https://www.docker.com/products/docker-desktop/). Perintah di bawah sama untuk **Windows
(PowerShell)**, macOS, dan Linux — file `.env` dibaca otomatis oleh API, migrasi, dan test.

```bash
git clone https://github.com/unangridwan/erp.git
cd erp
pnpm install
copy .env.example .env          # macOS/Linux: cp .env.example .env
```

Buka `.env` dan ganti `JWT_SECRET` serta `ENCRYPTION_KEY` dengan dua teks acak berbeda (masing-masing ≥ 32 karakter).

```bash
docker compose -f infra/docker-compose.yml up -d   # Postgres, Redis, Mailpit
pnpm db:setup                                       # build paket, migrasi database, data wilayah
pnpm dev                                            # api di :3001, web di :3000
```

| Alamat                       | Isi                                 |
| ---------------------------- | ----------------------------------- |
| http://localhost:3000        | Aplikasi web — mulai dari `/signup` |
| http://localhost:3001/health | Cek API                             |
| http://localhost:8025        | Mailpit: email undangan user        |

Signup otomatis membuat perusahaan holding (`HQ`), role `admin` & `user`, satuan (UoM) bawaan, bagan akun, jurnal,
pajak, dan user admin.

### Masalah umum

- **`password authentication failed` / `password gagal diotentikasi` untuk user `erp`**: aplikasi tersambung ke
  PostgreSQL lain, bukan yang dari Docker. Postgres Docker memakai port **5433**; pastikan `DATABASE_URL` di `.env`
  berakhiran `@localhost:5433/erp` (salin ulang dari `.env.example` bila perlu), lalu jalankan
  `docker compose -f infra/docker-compose.yml up -d` lagi.
- **`ECONNREFUSED ... :5433`** saat `pnpm db:setup`: kontainer Postgres belum berjalan. Buka Docker Desktop, jalankan
  `docker compose -f infra/docker-compose.yml up -d`, lalu cek `docker compose -f infra/docker-compose.yml ps` sampai
  postgres berstatus `healthy` dengan port `0.0.0.0:5433->5432`. Bila port masih `5432`, kontainer lama belum dibuat
  ulang — jalankan `up -d` lagi setelah `git pull`.
- **`docker` tidak dikenal**: pastikan Docker Desktop sudah berjalan (ikon di system tray) lalu buka terminal baru.
- **Mulai dari awal**: `docker compose -f infra/docker-compose.yml down -v`, lalu ulangi `up -d` dan `pnpm db:setup`.
- **`pnpm format:check` gagal di Windows karena akhir baris CRLF** (clone dibuat sebelum `.gitattributes` ada): hapus
  folder lalu clone ulang.

### Menjalankan test

```bash
pnpm lint && pnpm typecheck && pnpm test    # test database memakai DATABASE_URL dari .env
```

## API (Fase 0)

Semua endpoint selain `/health` dan endpoint auth publik butuh header `Authorization: Bearer <token>`.
Access token berlaku singkat (default 15 menit); perbarui dengan `POST /auth/refresh` (refresh token berotasi,
pemakaian ulang token lama mencabut seluruh sesi).
Header opsional `X-Company-Id` memilih perusahaan aktif (harus termasuk perusahaan yang boleh diakses user).

| Endpoint                                                                                 | Keterangan                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`      | Sesi (JWT + refresh token), profil, permission, perusahaan |
| `POST /auth/2fa/setup`, `/auth/2fa/enable`, `/auth/2fa/disable`                          | 2FA TOTP (Google Authenticator, Authy, dll.)               |
| `POST /users/invite`, `GET /invitations`, `POST /auth/invitation`, `/auth/accept-invite` | Undangan user via email                                    |
| `/companies`, `/ownerships`, `/business-units`, `/branches`                              | Struktur grup                                              |
| `/partners`, `/products`, `/product-categories`, `/uoms`, `/uom-categories`              | Master data                                                |
| `GET /currencies`, `/currency-rates`, `GET /fx/convert?from=USD&to=IDR&amount=&date=`    | Mata uang, kurs harian, konversi                           |
| `GET /regions?level=1&parent=&q=`                                                        | Wilayah Indonesia (Kepmendagri 2025)                       |
| `GET/POST /users`, `GET /roles`                                                          | Manajemen user                                             |
| `GET /activity/:model/:id`                                                               | Riwayat perubahan (chatter)                                |
| `GET /sequences`                                                                         | Penomoran dokumen perusahaan aktif                         |

### Akuntansi (Fase 1)

| Endpoint                                                                                                     | Keterangan                                                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `/accounts`, `/journals`, `/taxes`                                                                           | Bagan akun, jurnal, pajak (per perusahaan aktif; dipasang otomatis)              |
| `POST /accounting/setup`, `GET/PATCH /accounting/settings`                                                   | Pasang COA standar, lock date                                                    |
| `GET/POST /moves`, `GET/PATCH/DELETE /moves/:id`                                                             | Draft jurnal umum atau faktur/tagihan (`moveType`)                               |
| `POST /moves/:id/post`, `POST /moves/:id/reverse`                                                            | Posting (nomor `INV/2026/0001`), jurnal balik / nota kredit                      |
| `GET/POST /payments`, `POST /reconcile`                                                                      | Pembayaran (melunasi faktur), rekonsiliasi manual                                |
| `GET /reports/trial-balance`, `/general-ledger`, `/balance-sheet`, `/profit-loss`, `/aged`                   | Laporan; filter `dateFrom`, `dateTo`, `companyIds`, `branchId`, `businessUnitId` |
| `GET /reports/:name/export`                                                                                  | Ekspor laporan ke Excel (parameter sama)                                         |
| `/bank-statements`, `POST /bank-statements/import`, `/bank-statement-lines/:id/{suggestions,reconcile,undo}` | Rekonsiliasi bank                                                                |
| `/assets`, `POST /assets/:id/confirm`, `POST /assets/depreciate`                                             | Aset tetap & penyusutan                                                          |
| `POST /assets/:id/dispose`                                                                                   | Jual (faktur + jurnal pelepasan) atau hapus buku aset; laba/rugi ke 4-9500       |
| `GET /accounting/fx-revaluations[/preview?date=]`, `POST /accounting/fx-revaluations`                        | Revaluasi kurs akhir bulan (4-9110/7-1110), dibalik otomatis hari berikutnya     |
| `/budgets`, `GET /reports/budget?budgetId=`                                                                  | Anggaran vs realisasi                                                            |
| `POST /accounting/close-year`                                                                                | Tutup buku tahun fiskal                                                          |

### CRM & Penjualan (Fase 2)

| Endpoint                                                                                      | Keterangan                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/crm-stages`, `/lost-reasons`, `/sales-teams`, `/payment-terms`, `/pricelists`               | Konfigurasi (tahap pipeline, alasan kalah, tim, termin, daftar harga + aturan) |
| `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`                                              | Lead & peluang; filter `leadType`, `state=open,won`, `stageId`, `userId=me`    |
| `POST /leads/:id/{convert,won,lost,reopen}`, `GET /leads/pipeline?from=&to=`                  | Konversi ke peluang/pelanggan, menang/kalah, buka kembali, ringkasan pipeline  |
| `GET/POST /activities`, `GET /activities/mine`, `PATCH/DELETE /activities/:id`, `POST …/done` | Aktivitas terjadwal pada lead, pesanan, atau kontak                            |
| `GET/POST /sale-orders`, `GET/PUT/DELETE /sale-orders/:id`, `POST /sale-orders/compute`       | Penawaran/pesanan; `compute` = pratinjau harga daftar harga, pajak, total      |
| `POST /sale-orders/:id/{send,confirm,cancel,draft}`, `GET /sale-orders/:id/pdf`               | Kirim email (PDF terlampir), konfirmasi, batal, kembali ke draft, unduh PDF    |
| `POST /sale-orders/:id/invoice` (`method`: `regular` / `percentage` / `fixed`)                | Draft faktur dari pesanan (sisa kuantitas atau uang muka)                      |
| `GET /sale-orders/report?from=&to=&groupBy=product\|partner\|salesperson\|month`              | Analisis penjualan pesanan terkonfirmasi                                       |
| `GET /users/options`                                                                          | Pilihan user aktif perusahaan aktif (penanggung jawab, penjual)                |
| `/commission-plans`, `GET /sales/commissions[/export]?dateFrom=&dateTo=`                      | Aturan komisi (penjual → tim → bawaan; dasar faktur/lunas), laporan & Excel    |

### Pembelian & Persediaan (Fase 3)

| Endpoint                                                                                            | Keterangan                                                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/warehouses`, `/stock-locations`, `/reorder-rules`, `/product-suppliers`                           | Gudang (otomatis membuat lokasi stok), lokasi, aturan min/max, harga pemasok bertingkat               |
| `GET/POST /pickings`, `GET/PUT/DELETE /pickings/:id`                                                | Transfer (`pickingType` incoming/outgoing/internal); filter `state`, `saleOrderId`, `purchaseOrderId` |
| `POST /pickings/:id/{confirm,validate,cancel,return}`                                               | Validasi (kuantitas & lot/serial per baris, `createBackorder`), batal, retur                          |
| `GET /stock/{overview,quants,card,valuation,lots}`, `POST /stock/adjustments`                       | Stok, quant per lokasi/lot, kartu stok, valuasi per tanggal, lot; stock opname                        |
| `GET /replenishment`, `POST /replenishment/run`                                                     | Saran pengadaan dari aturan min/max; buat RFQ ke pemasok utama                                        |
| `GET/POST /purchase-orders`, `GET/PUT/DELETE /purchase-orders/:id`, `POST /purchase-orders/compute` | RFQ/PO; `compute` = pratinjau harga pemasok, pajak, total                                             |
| `POST /purchase-orders/:id/{send,confirm,approve,cancel,draft,bill}`, `GET …/pdf`                   | Kirim RFQ, konfirmasi (dengan persetujuan), tagihan dari barang diterima, PDF                         |
| `GET /purchase-orders/matching`, `GET /purchase-orders/report?from=&to=&groupBy=`                   | Pencocokan 3 arah, analisis pembelian                                                                 |

Otomatis (tanpa endpoint baru):

- **Retur setelah ditagih**: validasi retur pelanggan/ke pemasok membuat draft nota kredit/nota debit sebanyak
  kelebihan tagihan, dengan harga pesanan; respons `validate` memuat `documents`.
- **Selisih harga pembelian**: saat tagihan PO diposting, selisih nilai tagihan vs nilai penerimaan (harga PO × kurs
  tanggal PO) dipindahkan dari Barang Diterima Belum Ditagih (2-1800) ke **5-1100 Selisih Harga Pembelian**.
- **Dokumen antar perusahaan** (aktifkan `icAutoDocuments` di perusahaan sumber): SO terkonfirmasi ke perusahaan grup →
  draft RFQ di perusahaan itu; PO terkonfirmasi → draft penawaran; faktur/nota kredit penjualan diposting → draft
  tagihan/nota debit yang terhubung ke baris PO pasangan (`icSourceMoveId`). Transfer stok antar perusahaan berjalan
  lewat pasangan SO/PO ini (pengiriman di penjual, penerimaan di pembeli).

### SDM & Payroll (Fase 4)

| Endpoint                                                                                                               | Keterangan                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/employees`, `/departments`, `/job-positions`, `/public-holidays`, `/leave-types`, `/leave-allocations`, `/overtimes` | Data karyawan (NIK/NPWP/rekening terenkripsi), struktur, hari libur, cuti, lembur |
| `GET/POST /contracts`, `GET/PUT/DELETE /contracts/:id`, `POST /contracts/:id/{start,close}`                            | Kontrak PKWT/PKWTT dengan tunjangan & potongan bulanan                            |
| `GET/POST /leaves`, `GET /leaves/balances?employeeId=`, `POST /leaves/:id/{approve,refuse,cancel}`                     | Pengajuan cuti (hari kerja di luar libur), saldo jatah                            |
| `POST /attendance/{check-in,check-out}`, `GET/POST /attendance`                                                        | Absensi dari portal, rekap & koreksi manual                                       |
| `GET /me/{employee,attendance,leaves,leave-types,payslips}`                                                            | Portal karyawan (user yang terhubung ke data karyawan)                            |
| `/salary-components`, `GET/PUT /payroll/settings`                                                                      | Komponen gaji, tarif JKK, batas upah BPJS, akun & jurnal gaji                     |
| `GET/POST /payroll-runs`, `GET /payroll-runs/:id`, `POST /payroll-runs/:id/{compute,post,pay,cancel}`                  | Payroll bulanan: hitung, posting jurnal, bayar gaji bersih                        |
| `GET /payroll-runs/:id/{bank-transfer,recap}?format=csv`                                                               | File transfer bank, rekap PPh 21 & BPJS (NIK/NPWP)                                |
| `GET /payslips/:id`, `PUT /payslips/:id/inputs`, `GET /payslips/:id/pdf`                                               | Slip gaji, input THR/bonus/potongan, PDF                                          |

PPh 21 dihitung dengan TER (PP 58/2023) per bulan dan tarif Pasal 17 setahun di Desember atau bulan karyawan keluar.
Tarif TER, PTKP, BPJS, dan lembur ada di `packages/shared/src/payroll.ts` (dengan unit test); batas upah JP perlu
diperbarui di Pengaturan Payroll setiap Maret.

### Pajak Coretax, Langganan & Operasional (Fase 5)

| Endpoint                                                                                                    | Keterangan                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /tax-invoices?year=&month=&state=`, `POST /tax-invoices/generate`                                      | Faktur pajak keluaran: draft dari faktur penjualan ber-PPN yang sudah diposting               |
| `PATCH /tax-invoices/:id`, `POST /tax-invoices/export`, `POST /tax-invoices/:id/{approve,cancel}`           | Kode transaksi/fasilitas, ekspor XML `TaxInvoiceBulk` (tax.manage), catat nomor faktur terbit |
| `POST /tax-invoices/import-numbers`                                                                         | Impor CSV daftar faktur Coretax (Referensi → Nomor Faktur Pajak)                              |
| `GET /input-tax-invoices`, `POST /input-tax-invoices/{import,credit}`, `PATCH /input-tax-invoices/:id`      | Faktur masukan dari CSV Coretax, cocok otomatis ke tagihan, kreditkan maks. 3 masa            |
| `GET /withholding-slips?kind=bppu\|bpmp`, `POST /withholding-slips/{generate,export}`                       | Bukti potong PPh 23/4(2)/22 dari tagihan (BPPU) & PPh 21 bulanan dari payroll (BPMP), XML     |
| `GET /tax/vat-report?year=&month=`, `GET /tax/exports`, `GET /tax/exports/:id`                              | Rekap SPT Masa PPN, riwayat berkas XML yang diekspor                                          |
| `GET /onboarding`, `PUT /onboarding/company`, `POST /onboarding/{opening-balance,steps,complete}`           | Panduan awal: profil & PKP, saldo awal (selisih → 3-9900), checklist                          |
| `GET /billing`, `POST /billing/{subscribe,cancel,resume}`, `POST /billing/invoices/:id/pay`                 | Paket, tagihan + PPN, pembayaran (Xendit atau transfer manual)                                |
| `POST /billing/webhooks/xendit`                                                                             | Callback Xendit (header `x-callback-token` = `XENDIT_CALLBACK_TOKEN`)                         |
| `/platform/{tenants,plans,invoices}`, `POST /platform/invoices/:id/mark-paid`, `POST /platform/billing/run` | Admin platform (operator SaaS; `pnpm platform:admin <slug> <email>`)                          |
| `GET /auth/sessions`, `DELETE /auth/sessions[/:id]`                                                         | Sesi login aktif per perangkat, cabut satu/semua                                              |
| `GET /health/ready`, `GET /metrics`                                                                         | Readiness (DB & migrasi), metrik Prometheus (`Authorization: Bearer $METRICS_TOKEN`)          |

Format XML mengikuti template impor Coretax: faktur keluaran (`TaxInvoiceBulk`, dicocokkan dengan contoh referensi
Odoo `l10n_id_efaktur_coretax`), BPMP (`MmPayrollBulk`), dan BPPU (`BpuBulk`). **Uji dulu satu berkas di Coretax**
(menu impor → XML Monitoring) sebelum dipakai rutin, terutama BPPU yang strukturnya belum bisa dicocokkan dengan
template resmi DJP. Bukti potong A1 (Desember/karyawan keluar) belum dibuat — laporkan langsung di Coretax.

Paket langganan: tenant baru mendapat uji coba (`TRIAL_PLAN`, `TRIAL_DAYS`). Modul di luar paket ditolak (403),
melebihi batas pengguna/perusahaan ditolak, dan langganan yang berakhir (lewat `BILLING_GRACE_DAYS`) menjadi baca saja
(402) kecuali halaman langganan. Lihat `docs/operations.md` untuk deployment produksi, backup, dan monitoring.

### Konsolidasi Grup (Fase 5b)

| Endpoint                                                                               | Keterangan                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/group-accounts`                                                                      | Bagan akun grup (peran khusus: investasi, goodwill, KNP, selisih kurs penjabaran, …) |
| `POST /consolidation/bootstrap`, `POST /consolidation/mapping/auto`                    | Salin bagan akun perusahaan aktif + akun peran khusus; petakan akun berkode sama     |
| `GET/PUT /consolidation/mapping?companyId=`                                            | Pemetaan akun perusahaan → akun grup                                                 |
| `GET /consolidation/structure?rootCompanyId=&dateTo=`                                  | Pratinjau entitas, metode, kepemilikan langsung/efektif, kurs bawaan                 |
| `GET/POST /consolidation/runs`, `GET/DELETE /consolidation/runs/:id`                   | Proses konsolidasi (draft/final) per induk & tanggal                                 |
| `POST /consolidation/runs/:id/compute`                                                 | Hitung ulang (opsional `rates` per entitas: penutupan, rata-rata, historis)          |
| `GET /consolidation/runs/:id/{worksheet[?format=csv],report,intercompany}`             | Kertas kerja, neraca & laba rugi konsolidasian (pemilik/KNP), rekonsiliasi IC        |
| `POST /consolidation/runs/:id/entries`, `DELETE …/entries/:entryId`, `POST …/finalize` | Jurnal penyesuaian manual (top-side), finalisasi (harus seimbang)                    |
| `GET /consolidation/runs/:id/export`                                                   | Excel: posisi keuangan, laba rugi, perubahan ekuitas, arus kas, kertas kerja, jurnal |
| `GET /reports/branch-clearing?dateTo=`, `GET /reports/branch-clearing/export`          | Rekonsiliasi RK pusat–cabang (akun bertanda rekening antar kantor)                   |

Translasi: aset/liabilitas kurs penutupan, laba rugi kurs rata-rata, ekuitas kurs historis; selisihnya ke akun selisih
kurs penjabaran. Entitas dikonsolidasi penuh (>50%), proporsional, atau metode ekuitas (asosiasi) sesuai Kepemilikan;
isi `consideration` (harga perolehan) dan `acquiredNetAssets` (aset neto saat akuisisi) di Kepemilikan untuk goodwill.
Eliminasi otomatis: investasi vs ekuitas anak (goodwill/KNP), saldo & transaksi antar perusahaan (baris jurnal dengan
mitra IC), bagian laba KNP, dan metode ekuitas. Jurnal konsolidasi tidak menyentuh buku besar entitas.

Kepemilikan dicatat per baris bertanggal: entitas yang diakuisisi di tengah periode hanya membawa laba rugi sejak tanggal
pengendalian; perubahan persentase (baris baru dengan `consideration` = harga beli/hasil jual) dihitung sebagai
transaksi dengan KNP; relasi yang berakhir (`validTo`) di dalam periode memperlakukan entitas sebagai dilepas.
Laba belum terealisasi atas persediaan dihitung otomatis dari lapisan valuasi stok pembeli yang berasal dari penerimaan
dengan partner antar perusahaan. Dividen dicatat di akun Dividen (3-3000) dengan partner perusahaan grup agar
dieliminasi. Saldo awal laporan perubahan ekuitas & arus kas diambil dari proses final yang berakhir sehari sebelum
periode (bila ada), selain itu dihitung ulang. Setelah upgrade, klik **Buat bagan akun grup** sekali lagi agar peran
akun baru (persediaan, HPP, dividen, transaksi KNP, laba pelepasan) terpasang.

Konfirmasi SO membuat pengiriman; barang ditagih sesuai kuantitas terkirim (jasa sesuai kuantitas dipesan). Validasi
transfer barang stok membuat jurnal di jurnal **STJ**: penerimaan Dr Persediaan / Cr Barang Diterima Belum Ditagih,
pengiriman Dr HPP / Cr Persediaan, opname ke Selisih Persediaan. Tagihan dari PO mendebit Barang Diterima Belum Ditagih.

Resource master mendukung `GET /x?q=&limit=&offset=&active=all|false`, `GET/PATCH/DELETE /x/:id`, `POST /x`,
`GET /x/export` (CSV) dan `POST /x/import` (`{ "csv": "..." }`; baris ber-`id` diperbarui, tanpa `id` dibuat; satu baris
gagal membatalkan seluruh impor).

Login dibatasi 10 percobaan gagal per akun dan 50 per IP per 15 menit (penyimpanan memori; pindah ke Redis saat
berjalan lebih dari satu instance).

## Pemeriksaan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Test RLS di `packages/db` berjalan bila `DATABASE_URL` di-set (dilewati jika tidak).
