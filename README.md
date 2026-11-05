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
| `infra`           | docker-compose (Postgres, Redis, Mailpit), skrip backup & PITR  |

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

### Kalau aplikasi terasa lambat (terutama di Windows)

`pnpm dev` adalah mode pengembangan: setiap halaman dikompilasi saat pertama dibuka (beberapa detik per halaman) dan
kode React tidak dioptimalkan. Untuk menguji/memakai aplikasi, jalankan **mode produksi**:

```bash
pnpm start          # build sekali (berikutnya memakai cache), lalu api di :3001 & web di :3000
```

Setelah mengubah kode atau `git pull`, cukup jalankan `pnpm start` lagi. Tips lain untuk Windows:

- **Kecualikan folder proyek dari pemindaian Windows Defender** (Windows Security → Virus & threat protection →
  Manage settings → Exclusions → Add an exclusion → Folder, mis. `D:\unang\erp`). Pemindaian ribuan berkas
  `node_modules` adalah penyebab utama lambatnya `pnpm install`, build, dan mode dev.
- Windows 11: simpan proyek di **Dev Drive** (Settings → System → Storage → Disks & volumes → Create Dev Drive).
- Docker Desktop: pakai backend **WSL 2** (Settings → General) dan beri memori cukup (≥ 4 GB).
- Mode dev sudah memakai Turbopack (kompilasi lebih cepat); halaman yang sudah pernah dibuka akan cepat.

### Masalah umum

- **`password authentication failed` / `password gagal diotentikasi` untuk user `erp`**: aplikasi tersambung ke
  PostgreSQL lain, bukan yang dari Docker. Postgres Docker memakai port **5433**; pastikan `DATABASE_URL` di `.env`
  berakhiran `@localhost:5433/erp` (salin ulang dari `.env.example` bila perlu), lalu jalankan
  `docker compose -f infra/docker-compose.yml up -d` lagi.
- **`ECONNREFUSED ... :5433`** saat `pnpm db:setup`: kontainer Postgres belum berjalan. Buka Docker Desktop, jalankan
  `docker compose -f infra/docker-compose.yml up -d`, lalu cek `docker compose -f infra/docker-compose.yml ps` sampai
  postgres berstatus `healthy` dengan port `0.0.0.0:5433->5432`. Bila port masih `5432`, kontainer lama belum dibuat
  ulang — jalankan `up -d` lagi setelah `git pull`.
- **"Terjadi kesalahan pada server" / log API `relation ... does not exist` atau `column ... does not exist`** setelah
  `git pull`: migrasi database baru belum dijalankan. Hentikan `pnpm dev`, jalankan `pnpm db:setup`, lalu start ulang.
  Saat start, API juga menulis `Database belum dimigrasi (...)` di log bila masih ada migrasi tertunda. Semua migrasi
  tertunda berjalan dalam satu transaksi; bila satu gagal, pesan `Migrasi 00xx_….sql gagal` menyebut file-nya dan tidak
  ada yang diterapkan.
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

| Endpoint                                                                                 | Keterangan                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`      | Sesi (JWT + refresh token), profil, permission, perusahaan        |
| `POST /auth/2fa/setup`, `/auth/2fa/enable`, `/auth/2fa/disable`                          | 2FA TOTP (Google Authenticator, Authy, dll.)                      |
| `POST /users/invite`, `GET /invitations`, `POST /auth/invitation`, `/auth/accept-invite` | Undangan user via email                                           |
| `/companies`, `/ownerships`, `/business-units`, `/branches`                              | Struktur grup                                                     |
| `/partners`, `/products`, `/product-categories`, `/uoms`, `/uom-categories`              | Master data                                                       |
| `GET /currencies`, `/currency-rates`, `GET /fx/convert?from=USD&to=IDR&amount=&date=`    | Mata uang, kurs harian, konversi                                  |
| `GET /regions?level=1&parent=&q=`                                                        | Wilayah Indonesia (Kepmendagri 2025)                              |
| `GET/POST /users`, `GET /roles`                                                          | Manajemen user                                                    |
| `GET /activity/:model/:id`                                                               | Riwayat perubahan (chatter)                                       |
| `GET /sequences`                                                                         | Penomoran dokumen perusahaan aktif (penghitung per tahun dokumen) |

**Daftar (list) di web: cari, filter, sort & paginasi tanpa memanggil API lagi.** Setiap daftar memuat datanya sekali
(s.d. 5.000 baris, `LIST_LOAD_LIMIT` di `@erp/shared`; endpoint daftar menerima `limit` sampai angka itu, CRUD bawaan
tetap 50), lalu semua olah tampilan berjalan di browser (`packages/shared/src/table-view.ts`, komponen
`apps/web/components/data-table.tsx`): kotak cari di semua kolom (tanpa beda huruf besar/kecil & aksen), tombol
**Filter** per kolom (centang untuk status/kategori, rentang untuk tanggal/angka, teks "mengandung"), chip filter aktif
(× untuk menghapus, **Reset semua**), klik judul kolom untuk sort (naik → turun → bawaan; pilihan **Urutkan** di
tampilan kartu), dan paginasi 25/50/100/Semua. Urutan & ukuran halaman diingat per daftar di browser. Status yang dulu
dipilih lewat dropdown (mis. cuti "Menunggu persetujuan", transfer "Belum selesai", kontrak "Berjalan", lead "Terbuka")
kini jadi filter awal yang bisa dicabut. Parameter yang menentukan datanya (masa pajak, tahun MPP, rentang absensi &
keterlambatan, gudang di Stok, tanggal saldo cuti/valuasi, tab permintaan persetujuan) tetap memuat ulang dari API.
Bila data lebih dari 5.000 baris tampil keterangan "Menampilkan 5.000 dari N data" dan pencarian teks diteruskan ke
server agar baris di luar 5.000 pertama tetap ketemu. Tabel pengaturan (delegasi persetujuan, mesin absensi, template
checklist/KPI, alasan tolak pelamar, siklus penilaian, skala upah per karyawan, rentang NSFP, riwayat revaluasi kurs,
run konsolidasi, paket benefit, tagihan langganan, tenant/paket/tagihan di Platform) memakai alat yang sama. Tidak
diubah: tabel baris formulir/isian, laporan keuangan & rekap (laba rugi, PPN, kartu stok dengan saldo berjalan,
komisi), dan tampilan yang dikelompokkan (hari libur per bulan, aktivitas CRM per tenggat, pengajuan perubahan data).

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
| `/product-attributes`, `/product-attribute-values`, `GET/POST /products/:id/variants`         | Varian produk: atribut & nilai (kode SKU, tambahan harga), buat kombinasi      |
| `GET /partners/:id/portal`, `POST /partners/:id/{portal-invite,portal-revoke}`                | Akses portal pelanggan: undang (email + tautan), cabut                         |

**Portal pelanggan** (`/portal` di web; token portal terpisah dari token user internal):
`POST /portal/auth/{login,accept}`, `GET /portal/me`, `GET /portal/orders[/:id[/pdf]]`, `POST /portal/orders/:id/accept`
(setujui penawaran terkirim; dikonfirmasi atas nama penjualnya), `GET /portal/invoices[/:id[/pdf]]`. Pelanggan hanya
melihat dokumen partnernya (beserta kontak di bawahnya).

### Pembelian & Persediaan (Fase 3)

| Endpoint                                                                                            | Keterangan                                                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/warehouses`, `/stock-locations`, `/reorder-rules`, `/product-suppliers`                           | Gudang (otomatis membuat lokasi stok), lokasi, aturan min/max, harga pemasok bertingkat               |
| `GET/POST /pickings`, `GET/PUT/DELETE /pickings/:id`                                                | Transfer (`pickingType` incoming/outgoing/internal); filter `state`, `saleOrderId`, `purchaseOrderId` |
| `POST /pickings/:id/{confirm,validate,cancel,return}`                                               | Validasi (kuantitas & lot/serial per baris, `createBackorder`), batal, retur                          |
| `POST /pickings/:id/{reserve,unreserve}`                                                            | Cek ketersediaan (cadangkan stok lokasi asal) / lepas cadangan; detail memuat `availability`          |
| `GET /stock/{overview,quants,card,valuation,lots}`, `POST /stock/adjustments`                       | Stok, quant per lokasi/lot, kartu stok, valuasi per tanggal, lot; stock opname                        |
| `GET /replenishment`, `POST /replenishment/run`                                                     | Saran pengadaan dari aturan min/max; buat RFQ ke pemasok utama                                        |
| `GET/POST /purchase-orders`, `GET/PUT/DELETE /purchase-orders/:id`, `POST /purchase-orders/compute` | RFQ/PO; `compute` = pratinjau harga pemasok, pajak, total                                             |
| `POST /purchase-orders/:id/{send,confirm,approve,cancel,draft,bill}`, `GET …/pdf`                   | Kirim RFQ, konfirmasi (dengan persetujuan), tagihan dari barang diterima, PDF                         |
| `GET /purchase-orders/matching`, `GET /purchase-orders/report?from=&to=&groupBy=`                   | Pencocokan 3 arah, analisis pembelian                                                                 |

Otomatis (tanpa endpoint baru):

- **Satuan beli/jual**: produk punya `saleUomId`/`purchaseUomId` bawaan; baris SO/PO/faktur boleh memakai satuan
  lain sekategori (`uomId`, mis. beli per Lusin, stok per Pcs). Kuantitas & harga baris dalam satuan baris; pergerakan
  stok, valuasi, harga pemasok & daftar harga dalam satuan produk (dikonversi dengan `uomRatio`).
- **Reservasi stok**: transfer keluar yang siap otomatis mencadangkan stok lokasi asal (urut jadwal; dicadangkan ulang
  saat stok masuk). Transfer lain tidak bisa memakai stok yang sudah dicadangkan; ringkasan stok menampilkan
  `reserved` & `available`.
- **Dropship**: baris SO bertanda dropship (bawaan dari produk) tidak dikirim dari gudang; konfirmasi SO membuat draft
  RFQ ke pemasok utama, dan PO-nya menghasilkan transfer `dropship` pemasok → pelanggan (HPP = harga beli, lawan
  Barang Diterima Belum Ditagih; tidak lewat persediaan).
- **Retur setelah ditagih**: validasi retur pelanggan/ke pemasok membuat draft nota kredit/nota debit sebanyak
  kelebihan tagihan, dengan harga pesanan; respons `validate` memuat `documents`.
- **Selisih harga pembelian**: saat tagihan PO diposting, selisih nilai tagihan vs nilai penerimaan (harga PO × kurs
  tanggal PO) dipindahkan dari Barang Diterima Belum Ditagih (2-1800) ke **5-1100 Selisih Harga Pembelian**.
- **Dokumen antar perusahaan** (aktifkan `icAutoDocuments` di perusahaan sumber): SO terkonfirmasi ke perusahaan grup →
  draft RFQ di perusahaan itu; PO terkonfirmasi → draft penawaran; faktur/nota kredit penjualan diposting → draft
  tagihan/nota debit yang terhubung ke baris PO pasangan (`icSourceMoveId`). Transfer stok antar perusahaan berjalan
  lewat pasangan SO/PO ini (pengiriman di penjual, penerimaan di pembeli).

### SDM & Payroll (Fase 4)

| Endpoint                                                                                                                                                     | Keterangan                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/employees`, `/departments`, `/job-positions`, `/public-holidays`, `/leave-types`, `/leave-allocations`, `/overtimes`                                       | Data karyawan (NIK/NPWP/rekening terenkripsi), struktur, hari libur, cuti, lembur                                                                                                                   |
| `GET/POST /contracts`, `GET/PUT/DELETE /contracts/:id`, `POST /contracts/:id/{start,close,cancel-exit}`                                                      | Kontrak PKWT/PKWTT dengan tunjangan & potongan bulanan; `close {exit, resignReason}` = karyawan keluar (0051)                                                                                       |
| `GET/POST /leaves`, `GET /leaves/balances?employeeId=`, `POST /leaves/:id/{approve,refuse,cancel}`                                                           | Pengajuan cuti (hari kerja di luar libur), saldo jatah                                                                                                                                              |
| `/work-calendar/{holidays,holidays/import-national,leave-days}`, `POST /me/leave-days`                                                                       | Kalender kerja (0047): libur per perusahaan, impor libur nasional, pratinjau hari cuti                                                                                                              |
| `POST /attendance/{check-in,check-out}`, `GET/POST /attendance`                                                                                              | Absensi dari portal, rekap & koreksi manual                                                                                                                                                         |
| `GET /me/{employee,attendance,leaves,leave-types,payslips}`                                                                                                  | Portal karyawan (user yang terhubung ke data karyawan)                                                                                                                                              |
| `/salary-components`, `GET/PUT /payroll/settings`                                                                                                            | Komponen gaji, tarif JKK, batas upah BPJS, akun & jurnal gaji                                                                                                                                       |
| `GET/POST /payroll-runs`, `GET /payroll-runs/:id`, `POST /payroll-runs/:id/{compute,post,pay,cancel}`                                                        | Payroll bulanan: hitung, posting jurnal, bayar gaji bersih                                                                                                                                          |
| `GET /payroll-runs/:id/{bank-transfer,recap}?format=csv`                                                                                                     | File transfer bank, rekap PPh 21 & BPJS (NIK/NPWP)                                                                                                                                                  |
| `GET /payslips/:id`, `PUT /payslips/:id/inputs`, `GET /payslips/:id/pdf`                                                                                     | Slip gaji, input THR/bonus/potongan, PDF                                                                                                                                                            |
| `/work-schedules`, `/shift-assignments`, `GET /attendance/lateness?from=&to=&employeeId=`                                                                    | Jadwal kerja & shift, toleransi & potongan keterlambatan (otomatis di slip)                                                                                                                         |
| `GET /approvals/pending`, `GET /approvals/:model/:id`, `POST /approvals/overtime/:id/{approve,refuse}`                                                       | Persetujuan berjenjang cuti, lembur, klaim + permintaan generik (kotak gabungan)                                                                                                                    |
| `POST /overtimes/from-attendance`, `POST /approvals/overtime/:id/approve {hours}`                                                                            | Lembur dari absensi (0048); atasan boleh mengurangi jam saat menyetujui                                                                                                                             |
| `GET/POST /employee-loans`, `GET /employee-loans/:id`, `POST /employee-loans/:id/{disburse,cancel}`                                                          | Pinjaman karyawan: cair via kas/bank, cicilan otomatis di slip sampai lunas                                                                                                                         |
| `/work-entries`                                                                                                                                              | Hasil kerja pekerja borongan (terkunci setelah payroll diposting)                                                                                                                                   |
| `GET/POST /employees/:id/severances`, `POST /employees/:id/severance/preview`                                                                                | Pesangon, UPMK, UPH, uang pisah/kompensasi PKWT (PP 35/2021) + PPh 21 final                                                                                                                         |
| `/salary-grades`, `GET /hr/wage-scale`                                                                                                                       | Struktur & skala upah (PP 36/2021): golongan di jabatan, upah di luar rentang                                                                                                                       |
| `POST /payroll-runs/:id/{thr,retro}`                                                                                                                         | THR otomatis (Permenaker 6/2016) & rapel kenaikan upah berlaku mundur                                                                                                                               |
| `GET /payroll-runs/:id/bank-transfer?format=csv\|bca\|mandiri\|bri\|bni`, `GET …/bank-transfer/summary`                                                      | File transfer gaji massal per bank (rekening bank itu saja) + ringkasan per bank                                                                                                                    |
| `GET /payroll-runs/:id/recap?format=csv\|edabu\|sipp`                                                                                                        | Rekap PPh 21 & BPJS, unggah BPJS Kesehatan (e-Dabu) & Ketenagakerjaan (SIPP)                                                                                                                        |
| `POST /payroll-runs/:id/email-payslips`                                                                                                                      | Kirim slip PDF berkata sandi (tanggal lahir DDMMYYYY) ke email kerja                                                                                                                                |
| `GET /payroll/reports/cost?from=YYYY-MM&to=YYYY-MM&groupBy=department\|branch\|month`                                                                        | Biaya tenaga kerja (pendapatan + BPJS perusahaan) dari payroll terposting                                                                                                                           |
| `/expense-categories`, `GET/POST /expense-claims`, `GET/PUT/DELETE /expense-claims/:id`, `POST /expense-claims/:id/{submit,approve,refuse,cancel,pay}`       | Klaim biaya: plafon tahunan per kategori, persetujuan berjenjang, bayar via slip/kas-bank, bukti PDF/JPG/PNG                                                                                        |
| `GET /employee-change-requests`, `POST /employee-change-requests/:id/{approve,refuse}`                                                                       | Perubahan data pribadi dari portal, disetujui HR lalu diterapkan                                                                                                                                    |
| `GET /me/{expense-categories,overtimes,loans,change-requests,withholding-slips}`, `POST /me/{overtimes,change-requests}`, `GET /expense-claims?mine=1`       | Portal karyawan: lembur, klaim, pinjaman, perubahan data, bukti potong A1                                                                                                                           |
| `/job-openings`, `GET/POST /applicants`, `GET/PUT/DELETE /applicants/:id`, `POST /applicants/:id/{stage,interviews,hire}`                                    | Rekrutmen: lowongan, kanban pelamar, wawancara (skor), terima → karyawan + kontrak draft + onboarding                                                                                               |
| `GET/POST /hr-documents`, `GET /hr-documents/:id/file`, `GET /hr-documents/expiring`, `GET /hr/reminders`                                                    | Dokumen karyawan/pelamar (PDF/JPG/PNG ≤ 5 MB) & pengingat kedaluwarsa, kontrak PKWT berakhir                                                                                                        |
| `/hr-checklist-templates`, `GET/POST /hr-checklists`, `POST /hr-checklists/tasks/:taskId`, `GET /me/checklist-tasks`                                         | Checklist onboarding/offboarding (otomatis saat karyawan baru/tanggal keluar diisi)                                                                                                                 |
| `/appraisal-templates`, `GET/POST /appraisal-cycles`, `POST /appraisal-cycles/:id/{start,close}`                                                             | Penilaian kinerja: template KPI berbobot per jabatan, siklus, formulir per karyawan                                                                                                                 |
| `GET /appraisals`, `PUT /appraisals/:id/{self,manager}`, `POST /appraisals/:id/calibrate`, `GET /me/appraisals`                                              | Penilaian diri → atasan → kalibrasi HR (skor akhir, predikat A–E, usulan kenaikan upah)                                                                                                             |
| `/trainings`, `POST /trainings/:id/participants`, `PUT /trainings/:id/participants/:pid`                                                                     | Pelatihan & sertifikasi; sertifikat menjadi dokumen karyawan dengan masa berlaku                                                                                                                    |
| `GET /employees/:id/history`, `GET /hr/org-chart`, `GET /hr/dashboard?year=`                                                                                 | Riwayat karir otomatis, struktur organisasi, dashboard SDM (headcount, turnover, cuti, biaya)                                                                                                       |
| `GET/PUT/DELETE /employees/:id/photo`, `GET/PUT /me/photo`                                                                                                   | Foto karyawan (JPG/PNG/WebP ≤ 1 MB, diperkecil di browser)                                                                                                                                          |
| `GET /employees/:id/overview`, `POST /employees/:id/invite`, `employees.tags`                                                                                | Form karyawan: statistik (penilaian, sasaran, jam bulan ini), kontrak berjalan & tunjangan tetap, status akun portal; undang karyawan ke portal (akun otomatis tertaut); tag bebas yang bisa dicari |
| `/employees/:id/{family,education,experiences}`, `GET /employees/:id/profile-summary`                                                                        | Data keluarga (NIK terenkripsi), riwayat pendidikan, pengalaman kerja, kelengkapan profil & saran PTKP                                                                                              |
| `GET/POST /employee-movements`, `POST /employee-movements/:id/{apply,cancel}`                                                                                | Promosi/demosi/mutasi/rotasi dengan SK: perbarui jabatan/departemen/cabang/atasan/golongan & kontrak upah baru                                                                                      |
| `GET/POST /employee-warnings`, `GET /me/profile`                                                                                                             | Surat peringatan SP1–SP3 (berlaku 6 bulan, masuk pengingat HR); profil sendiri di portal                                                                                                            |
| `GET /data-transfer`, `GET /data-transfer/:key/{columns,template,export}`, `POST /data-transfer/:key/import`                                                 | Impor & ekspor Excel/CSV HR & Payroll: karyawan, kontrak, keluarga, pendidikan, absensi, jatah cuti, lembur, cuti, input slip, rekap slip; kolom ekspor dipilih user, pratinjau impor               |
| `GET/POST/DELETE /data-transfer/:key/presets`                                                                                                                | Profil ekspor (kolom & filter tersimpan; pribadi atau bersama)                                                                                                                                      |
| `GET/POST/PUT/DELETE /approval-categories`, `GET/POST /approval-requests`, `GET/PUT/DELETE /approval-requests/:id`                                           | Persetujuan generik: kategori (field wajib/opsional, penyetuju berurutan/paralel, batas nominal DoA), nomor otomatis                                                                                |
| `POST /approval-requests/:id/{submit,cancel,approve,refuse}`, `GET /approval-requests?mine=1\|review=1`, `GET …/summary`                                     | Ajukan, putuskan per tahap (atasan → penyetuju kategori, fallback HR), permintaan saya & yang perlu ditinjau                                                                                        |
| `GET/POST/DELETE /approval-delegations`                                                                                                                      | Delegasi penyetuju bertanggal; berlaku untuk permintaan, cuti, lembur, dan klaim                                                                                                                    |
| `/leave-accrual-plans`, `POST /leave-accrual-plans/:id/{assign,run,carry-over}`                                                                              | Akrual cuti per bulan/tahun (mulai setelah masa kerja, saldo maks.) + carry-over berbatas & berkedaluwarsa                                                                                          |
| `GET /leaves/{balance-report,ledger,bulk,compensable-overtimes}`, `POST /leaves/bulk`, `/leave-block-dates`                                                  | Saldo & buku besar cuti (FIFO), cuti massal/cuti bersama, tanggal blok cuti, lembur → cuti pengganti                                                                                                |
| `POST /overtimes/:id/compensate`, `GET /leaves/:id/attachment`, `GET /me/colleagues`                                                                         | Cuti pengganti (lembur tidak dibayar lagi), lampiran cuti, rekan untuk delegasi tugas                                                                                                               |
| `/work-locations`, `PUT /employees/:id/attendance-pin`, `PUT /me/attendance-pin`                                                                             | Lokasi kerja (geofence radius), PIN kiosk karyawan                                                                                                                                                  |
| `POST /attendance/{validate,kiosk,auto-checkout}`, `GET /attendance/{summary,today,:id/photo}`, `GET /me/attendance-summary`                                 | Validasi absensi, kiosk badge + PIN, auto-checkout, rekap bulanan per status, dashboard hari ini, foto                                                                                              |
| `/attendance-devices`, `POST /attendance-devices/:id/rotate-key`, `POST /attendance-devices/push` (header `X-Device-Key`)                                    | Mesin absensi (ZKTeco/Hikvision): kunci per mesin, kirim log idempoten                                                                                                                              |
| `/attendance-requests`, `/shift-requests`, `POST …/:id/{approve,refuse,cancel}`, `GET /me/work-schedules`                                                    | Koreksi absensi (lupa absen/dinas luar/WFH) & tukar shift dengan persetujuan berjenjang                                                                                                             |
| `POST /payroll-runs/:id/corrections`, `GET /payroll-runs/:id/warnings`                                                                                       | Payroll koreksi (off-cycle, PPh 21 atas bruto gabungan masa) & peringatan sebelum posting/transfer                                                                                                  |
| `POST /payslips/:id/{hold,unhold,release}`                                                                                                                   | Penahanan gaji per slip (tidak ikut transfer/pembayaran), dilepas dengan pembayaran terpisah                                                                                                        |
| `POST /job-openings/from-fpk/:id`, `/refuse-reasons`, `GET /recruitment/reports?from=&to=`                                                                   | FPK disetujui → lowongan, master alasan penolakan, laporan time-to-fill/time-to-hire, funnel, sumber                                                                                                |
| `/hiring-requests`, `POST /manpower-plan-lines/:id/hiring-request`, `POST /applicants/:id/cancel-hire`                                                       | FPK & alur penambahan karyawan (0049)                                                                                                                                                               |
| `GET/POST /contract-types`, `GET/PUT/DELETE /contract-types/:id`                                                                                             | Master jenis kontrak (PKWT, PKWTT, harian lepas, magang, mitra, …): aturan waktu tertentu & batas masa kontrak (0053)                                                                               |
| `/contract-templates[/placeholders]`, `POST /contract-templates/preview`, `GET/PUT /contracts/:id/document`                                                  | Template kontrak berplaceholder (data karyawan & kontrak terisi otomatis), isi dokumen per kontrak (0050)                                                                                           |
| `GET /contracts/:id/pdf?mode=print\|esign\|signed`, `GET/POST /contracts/:id/signed-file`                                                                    | PDF cetak (TTD basah + meterai), e-sign layanan luar (kolom tanda tangan), bertanda tangan; unggah hasil TTD                                                                                        |
| `POST /contracts/:id/{request-signature,sign}`, `/me/contracts`, `GET /public/contracts/verify/:code`                                                        | Tanda tangan digital di aplikasi (HR & karyawan via portal), jejak audit, verifikasi publik kode dokumen                                                                                            |
| `/offer-templates`, `GET/POST /applicants/:id/offers`, `POST /job-offers/:id/{send,accept,decline,cancel}`, `GET …/pdf`                                      | Surat penawaran kerja dari template (placeholder), jawaban pelamar, PDF; hire memakai nilai penawaran                                                                                               |
| `POST /employees/:id/offboard`, `GET/PUT /employees/:id/exit-interview`, `GET /employees/:id/final-settlement[/pdf]`, `GET /hr/reports/exit-reasons`         | Offboarding: alasan keluar + checklist, exit interview, Full & Final Statement, laporan alasan keluar                                                                                               |
| `/goals` (pohon + progres), `GET /me/goals`, `GET/POST /goals/:id/checkins`                                                                                  | Sasaran & KRA bertingkat (perusahaan → departemen → karyawan), progres induk = rata-rata berbobot turunan, check-in                                                                                 |
| `POST/GET /feedback-requests`, `GET /me/feedback-requests`, `PUT /feedback-requests/:id`, `POST …/decline`, `GET /employees/:id/feedback-summary`            | Feedback 360 per kompetensi; ringkasan anonim (relasi < 2 respons digabung)                                                                                                                         |
| `GET/POST /employees/:id/notes`, `DELETE /employee-notes/:id`                                                                                                | Catatan atasan/HR (privat atau HR), tidak pernah terlihat oleh karyawan                                                                                                                             |
| `/announcements`, `GET /me/announcements`, `POST /me/announcements/:id/read`, `GET /me/whos-off`                                                             | Pengumuman (semua/departemen, pin, terbit, kedaluwarsa, tanda dibaca) & Siapa yang Cuti                                                                                                             |
| `GET /me/notifications[?unread]`, `GET …/count`, `POST …/:id/read`, `POST …/read-all`                                                                        | Notifikasi in-app (lonceng): pengajuan & keputusan cuti/persetujuan, permintaan feedback, penilaian diri                                                                                            |
| `GET /permissions/catalog`, `/roles` (CRUD, `role.manage`)                                                                                                   | Katalog modul → fitur → aksi (lihat/ekspor/ubah/hapus/kelola) + templat peran; peran kustom dengan matriks hak                                                                                      |
| `GET/PATCH /users/:id`, `PUT /users/:id/roles`, `PUT /users/:id/overrides`, `GET /users/:id/access[-log]`, `POST /users/:id/{deactivate,activate,reset-2fa}` | Peran per perusahaan, tambah/cabut hak per akun, hak efektif + sumbernya, riwayat akses; admin terdelegasi hanya memberi hak yang ia miliki                                                         |
| `GET /approval-rules`, `PUT /approval-rules/:docType`, `GET /approval-limits`, `PUT /approval-limits/:docType`, `POST /approval-rules/simulate`              | Aturan persetujuan per jenis dokumen (atasan, atasan ke-2, kepala departemen, pengguna, peran, admin; berlaku bila nilai ≥ batas) & batas wewenang per pengguna/peran (`approval.manage`)           |
| `GET /users/:id/approvals`, `GET /roles/:id/approvals`, `GET /roles/options`                                                                                 | Ringkasan batas wewenang & tahap di mana pengguna/peran menjadi penyetuju; pilihan peran untuk penyetuju kategori                                                                                   |
| `/fleet-vehicles`, `/fleet-models`, `/fleet-manufacturers`, `/fleet-service-types`, `GET /fleet/vehicles/:id/overview`, `POST …/driver`                      | Armada: kendaraan (nopol, STNK/pajak/BPKB/KIR, nilai, cabang analitik), satu pengemudi aktif + riwayat                                                                                              |
| `GET/POST /fleet/vehicles/:id/odometers`, `GET /me/vehicles`, `POST /me/vehicles/:id/odometers`                                                              | Log odometer (tidak boleh mundur), dicatat HR armada atau pengemudi dari portal                                                                                                                     |
| `/fleet-contracts`, `POST /fleet/contracts/:id/{close,renew}`, `/fleet-services`, `POST /fleet/services/:id/bill`                                            | Kontrak sewa/asuransi (biaya awal + berulang, kedaluwarsa otomatis, perpanjangan); servis → tagihan vendor draft                                                                                    |
| `GET /fleet/reports/{costs,odometer}`, `GET /fleet/reminders`, `GET/PUT /fleet/settings`                                                                     | Biaya per kendaraan/kategori/bulan, tren odometer, pengingat dokumen/kontrak (notifikasi in-app harian)                                                                                             |
| Kontrak `taxMethod: gross \| gross_up`                                                                                                                       | Gross-up PPh 21 (tunjangan PPh 21 = pajaknya; ikut BPA1), saldo cuti di slip & PDF                                                                                                                  |

**Tanggal masuk & keluar hanya di kontrak kerja (migrasi 0051).** Form karyawan tidak lagi punya input tanggal masuk/
keluar (tampil baca-saja di tab Kerja › Masa kerja). **Tanggal masuk** = tanggal mulai kontrak pertama: diisi di tab
"Kontrak kerja" saat menambah karyawan, dan mengubah tanggal mulai kontrak pertama ikut mengubah tanggal masuk (kontrak
yang mulai lebih awal memajukannya). **Tanggal keluar** diisi lewat **Akhiri kontrak** → centang "Karyawan keluar" +
tanggal + alasan (resign, habis kontrak, PHK, pensiun, …) + catatan: tanggal & alasan keluar karyawan terisi, riwayat
dicatat, checklist offboarding dimulai. Kontrak keluar bisa diubah ("Ubah data keluar") atau dibatalkan ("Batalkan
keluar": kontrak kembali ke status & tanggal berakhir semula). Kontrak PKWT yang sudah berakhir bisa "Tandai karyawan
keluar". Panel Offboarding di halaman karyawan menampilkan data keluar + tautan ke kontraknya (exit interview & Full and
Final tetap di sana); `POST /employees/:id/offboard` juga lewat kontrak. `PATCH /employees` & impor Excel menolak
perubahan tanggal masuk/keluar. Menambah karyawan butuh hak kelola kontrak (`hr.manage`). Kontrak baru tidak boleh
mulai setelah karyawan keluar.

**Alur penambahan karyawan (migrasi 0049).** MPP disetujui → **Usulan Penambahan Karyawan (FPK)** dari baris MPP
(departemen, jabatan, golongan, gaji terisi otomatis; dibatasi sisa kuota baris; kepala departemen boleh mengajukan)
atau **di luar MPP** (ditandai, kategori persetujuan "FPK di luar MPP" untuk penyetuju tambahan) → persetujuan →
lowongan → pelamar → **penawaran diterima** (wajib) → **Proses kontrak**: calon karyawan (belum aktif, tidak dihitung
headcount/payroll) + kontrak draft dari penawaran; kuota lowongan dicek → **kontrak dimulai**: karyawan aktif, riwayat
masuk, onboarding dimulai (tugas atasan ke kepala departemen; tugas karyawan ke akunnya saat undangan diterima; tugas
"tanda tangan kontrak" selesai otomatis). Calon bisa dibatalkan sebelum kontrak dimulai. Halaman FPK menampilkan
timeline 9 tahap. Lowongan manual tetap boleh (ditandai "Tanpa FPK" di kanban); lowongan dari MPP kini lewat FPK.

**Template & tanda tangan kontrak (migrasi 0050).** Kontrak pertama dibuat **dari form karyawan baru** (tab "Kontrak
kerja": jenis kontrak dari master, template, tanggal berakhir, upah, metode PPh 21, **komponen gaji lain**; mulai = tanggal
masuk) dan **langsung
berlaku** saat karyawan disimpan; tombol "Baru" di daftar kontrak diganti, perpanjangan tetap dari tab Penggajian
karyawan. SDM › Konfigurasi › **Jenis Kontrak** (0053): master jenis perjanjian kerja — bawaan PKWT (waktu tertentu,
maks. 60 bulan), PKWTT, harian lepas, magang (waktu tertentu, maks. 12 bulan), mitra/kemitraan — bisa ditambah, diubah
(nama, keterangan, dasar hukum, wajib tanggal berakhir, batas masa kontrak, judul dokumen bawaan, urutan) dan
dinonaktifkan agar mengikuti perubahan peraturan tanpa rilis baru. Aturannya diperiksa saat kontrak, karyawan baru +
kontrak, FPK, penawaran kerja & proses kontrak pelamar disimpan; jenis "waktu tertentu" ikut pengingat kontrak
berakhir. Kode tersimpan di dokumen (tidak bisa diganti); PKWT/PKWTT tidak bisa dihapus/dinonaktifkan; jenis yang sudah
dipakai tidak bisa dihapus. Jenis tanpa template sendiri memakai template **Perjanjian kerja umum** (`{jenis_kontrak}`,
`{masa_kontrak}`) dengan judul dari master. Tiap jenis juga punya **aturan penggajian** (0054): ikut payroll atau tidak, program BPJS yang diikutkan (Kesehatan,
JKK, JKM, JHT, JP — menjadi batas; centang di data karyawan tetap bisa mengecualikan), kategori PPh 21 (otomatis
mengikuti jenis upah, pegawai tetap TER, tidak tetap tarif harian, bukan pegawai 50% bruto × Pasal 17, atau tidak
dipotong; bukti potong A1/BPMP hanya pegawai tetap), hak THR, dan hak saat berakhir (pesangon, uang kompensasi PKWT, atau tidak ada). Hak upah lembur diatur **per karyawan** (centang "Berhak upah lembur" di tab Penggajian karyawan; bila tidak, lembur
ditolak, tidak dibuat dari absensi, dan tidak dibayar). Bawaan: magang hanya JKK+JKM tanpa THR,
mitra tanpa BPJS dengan PPh 21 bukan pegawai. SDM › Konfigurasi › **Template Kontrak**: isi kontrak dengan placeholder (`{nama}`, `{nik}`, `{jabatan}`,
`{gaji}`, `{gaji_terbilang}`, `{tunjangan}`, `{tunjangan_tidak_tetap}`, `{potongan}`, `{komponen_gaji}`,
`{masa_kontrak}`, …; 31 kolom) yang diisi otomatis dari data karyawan,
kontrak, perusahaan & tunjangan tetap; template bawaan PKWT & PKWTT dibuat otomatis; pratinjau PDF dengan data
karyawan atau contoh. Halaman kontrak › **Dokumen & tanda tangan**: pilih template & penandatangan, ubah isi khusus
kontrak itu, lalu salah satu cara: **PDF cetak** (kotak meterai, ditandatangani basah lalu scan diunggah), **PDF e-sign**
(kolom tanda tangan AcroForm untuk PrivyID/Peruri/Adobe Sign; PDF hasilnya diunggah), atau **tanda tangan digital di
aplikasi** (kanvas; pihak perusahaan oleh HR, karyawan lewat portal "Kontrak kerja saya" setelah diminta atau langsung
di perangkat HR) → PDF bertanda tangan dengan halaman jejak audit (waktu, IP, hash SHA-256) dan **kode verifikasi**
yang bisa dicek siapa pun di `/verify/contract/<kode>` (tanpa gaji/isi kontrak). Isi dibekukan saat diminta/
ditandatangani; setelah ada tanda tangan, syarat kontrak terkunci sampai tanda tangan dibatalkan.

**Komponen gaji di kontrak.** Selain gaji pokok, kontrak memuat komponen gaji lain dari master Komponen Gaji:
tunjangan tetap (dasar upah BPJS & lembur), tunjangan tidak tetap per hari hadir / premi kehadiran (nilai = tarif;
kosong = nilai bawaan komponen), dan potongan — diisi langsung di tab Kontrak kerja saat menambah karyawan maupun di
halaman kontrak (satuan nilai mengikuti cara hitung komponen, nilai bawaan terisi otomatis). Komponen otomatis (berlaku
untuk semua karyawan) ikut ditampilkan dan bisa ditimpa nilainya. Ringkasan kontrak di tab Penggajian karyawan dan
dokumen kontrak mencantumkan semua komponen.

**Lembur dari absensi (migrasi 0048).** Bila diaktifkan di Pengaturan Payroll, setiap absen pulang menghasilkan
pengajuan lembur: hari kerja = menit setelah jam pulang jadwal (opsional + datang sebelum jam masuk; tanpa jadwal =
setelah 8 jam), hari istirahat/libur = seluruh jam kerja, dengan batas minimal, pembulatan ke bawah, dan maksimal per
hari. Pengajuan selalu menunggu atasan langsung (atau aturan persetujuan) di menu Persetujuan; atasan memvalidasi jam
(boleh dikurangi, tidak boleh melebihi hasil hitung) lalu menyetujui atau menolak. Hanya lembur disetujui yang dibayar.
Lembur yang belum diputuskan ikut diperbarui bila absensinya berubah; tanggal yang sudah punya lembur manual dilewati.
Penjadwal tiap jam juga memproses absensi 7 hari terakhir (mesin absensi, kiosk, koreksi, auto-checkout); HR bisa
menghitung ulang dari halaman Absensi (tombol **Hitung lembur**).

**Kalender kerja (migrasi 0047).** Hari cuti, hari kerja payroll, dan potongan tanpa upah dihitung per karyawan menurut
jadwal kerjanya (penugasan shift → jadwal bawaan → Senin–Jumat), di luar hari libur perusahaannya. Hari libur punya
jenis (libur nasional, cuti bersama, libur perusahaan) dan bisa berlaku untuk semua perusahaan atau satu perusahaan;
libur nasional & cuti bersama 2026 bisa diimpor dari data bawaan (SDM › Konfigurasi › Hari Libur), tahun lain lewat
berkas. Upah harian sisa cuti di pesangon memakai 1/25 (6 hari kerja/minggu) atau 1/21 (5 hari). Pengajuan cuti lama
tidak dihitung ulang.

BPJS Kesehatan dan BPJS Ketenagakerjaan (JHT, JKK, JKM, JP) selalu dicatat terpisah: kepesertaan per program di data karyawan,
iuran & dasar upah per program di slip, serta akun beban/utang masing-masing di jurnal gaji.

PPh 21 dihitung dengan TER (PP 58/2023) per bulan dan tarif Pasal 17 setahun di Desember atau bulan karyawan keluar.
Tarif TER, PTKP, BPJS, dan lembur ada di `packages/shared/src/payroll.ts` (dengan unit test); batas upah JP perlu
diperbarui di Pengaturan Payroll setiap Maret.

Kontrak bisa berupah bulanan, harian lepas (hari hadir × upah harian), atau borongan (hasil kerja × upah per satuan).
Pekerja harian/borongan memakai PPh 21 tarif harian (PMK 168/2023) dan hanya ikut JKK & JKM sampai masa kerja mencapai
batas di Pengaturan Payroll (bawaan 3 bulan). Lembur yang butuh persetujuan baru dibayar setelah disetujui. Pesangon
memakai upah sebulan terakhir (harian × 21; borongan rata-rata 3 slip) dan sisa cuti tahunan dari saldo bila tidak diisi.

THR dihitung sampai tanggal hari raya: masa kerja ≥ 12 bulan = upah sebulan (gaji pokok + tunjangan tetap), 1–12 bulan
prorata masa kerja/12, harian lepas/borongan rata-rata upah maks. 12 slip terakhir; masuk slip sebagai komponen THR
(kena PPh 21 lewat TER). Rapel membandingkan upah kontrak berjalan dengan gaji pokok + tunjangan tetap yang sudah dibayar
di payroll terposting sejak tanggal mulai kontrak (bulan pertama prorata hari kalender, rapel terdahulu dikurangkan),
jadi kenaikan upah berlaku mundur dicatat sebagai kontrak baru dengan tanggal mulai di masa lalu. Input otomatis THR/rapel
tidak tertimpa input manual slip. File transfer per bank mengikuti templat unggah massal umum (rekening sumber & corporate
ID diisi di Pengaturan Payroll) — cocokkan dengan templat terbaru bank sebelum dipakai produksi.

Klaim biaya yang disetujui dengan metode "slip gaji" otomatis masuk slip payroll berikutnya (baris `RMB`; tidak kena
PPh 21 kecuali kategori ditandai objek PPh 21) dan saat posting mendebit akun beban kategori klaim; klaim yang berubah
setelah payroll dihitung membuat posting ditolak sampai payroll dihitung ulang. Lembur yang diajukan dari portal selalu
menunggu persetujuan (minimal atasan langsung). Nomor rekening pada pengajuan perubahan data disimpan terenkripsi.

Checklist onboarding dibuat otomatis untuk karyawan baru (tanggal masuk ≤ 30 hari lalu) dan saat pelamar diterima;
offboarding saat tanggal keluar diisi. Tanpa template bawaan perusahaan dipakai checklist standar; tugas "nonaktifkan
akun" menonaktifkan login karyawan saat dicentang. Email pengingat HR harian (dokumen kedaluwarsa, kontrak PKWT
berakhir ≤ 30 hari, tugas checklist lewat tenggat) dikirim ke pengguna `hr.manage`; matikan dengan
`HR_REMINDER_SCHEDULER=off`.

Skor penilaian = rata-rata tertimbang skor 1–5 per indikator; predikat A ≥ 4,5, B ≥ 3,5, C ≥ 2,5, D ≥ 1,5, E, dengan
usulan kenaikan upah bawaan A 10%, B 7%, C 4% (dapat diubah saat kalibrasi). Karyawan tanpa atasan ber-akun dinilai
langsung oleh HR. Riwayat karir dicatat otomatis saat karyawan dibuat, departemen/jabatan/cabang/atasan berubah, tanggal
keluar diisi, dan kontrak baru dengan upah berbeda mulai berlaku.

#### Kompensasi & benefit

| Endpoint                                                                                    | Keterangan                                                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/salary-components` (`calc`, `rate`, `autoAssign`, `premiumMaxLate`, `premiumMaxAbsent`)   | Tunjangan per hari hadir (uang makan/transport) & premi kehadiran dari absensi tervalidasi               |
| `/benefit-plans`, `/benefit-enrollments`, `GET /employees/:id/benefits`, `GET /me/benefits` | Paket asuransi kesehatan swasta, DPLK, fasilitas; kepesertaan + tanggungan keluarga (`payroll.manage`)   |
| `GET /payroll/reports/benefits?from=YYYY-MM&to=YYYY-MM[&format=xlsx]`                       | Premi/iuran per paket & penyedia dari payroll terposting (untuk penyetoran)                              |
| `GET/PUT /expense-categories/:id/limits`                                                    | Plafon klaim tahunan per golongan (menimpa plafon kategori); sisa plafon di `GET /me/expense-categories` |

Porsi perusahaan paket benefit menjadi baris slip `benefit_employer` (tidak dibayar tunai): bila paket ditandai objek
PPh 21 (bawaan untuk asuransi & fasilitas — natura PMK 66/2023) menambah penghasilan bruto; porsi karyawan menjadi
potongan, dan untuk DPLK menjadi pengurang PPh 21 tahunan (seperti iuran pensiun). Saat posting: debit akun beban paket
(kosong = beban gaji), kredit akun utang premi/iuran ke penyedia. Premi kehadiran hilang bila terlambat/tidak hadir
melebihi batas atau tidak hadir sama sekali; nilai per karyawan dari tunjangan kontrak, atau nilai bawaan komponen.

#### Siklus kenaikan gaji & total rewards

| Endpoint                                                                            | Keterangan                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/compensation-cycles`, `POST /compensation-cycles/:id/generate`                    | Siklus (tanggal berlaku, anggaran % upah peserta atau nominal, filter departemen/golongan) & isi usulan |
| `PUT /compensation-proposals/:id`, `GET /me/team-compensation`                      | Ubah usulan (% atau upah baru) oleh HR (`payroll.manage`) atau atasan langsung lewat portal             |
| `POST /compensation-cycles/:id/{submit,cancel,apply}`                               | Ajukan ke Persetujuan (kategori `KENAIKAN`), batalkan, terapkan ke kontrak baru                         |
| `GET /employees/:id/total-rewards[/pdf]?year=`, `GET /me/total-rewards[/pdf]?year=` | Total kompensasi setahun: tunai (gaji, tunjangan, lembur, THR, rapel) + BPJS & benefit perusahaan       |

Saran kenaikan = % kalibrasi penilaian kinerja terakhir yang selesai (atau bawaan predikat A 10%, B 7%, C 4%).
Pengajuan ditolak bila tambahan upah bulanan melebihi anggaran; peringatan bila upah baru di luar skala golongan. Biaya
tahunan = 13 × selisih upah (12 bulan + THR) + selisih iuran BPJS perusahaan 12 bulan. Setelah disetujui, **Terapkan**
mengakhiri kontrak berjalan sehari sebelum tanggal berlaku dan memulai kontrak baru (tunjangan disalin); bila tanggal
berlaku di masa lalu, jalankan **Hitung rapel** di payroll berikutnya.

#### Pembuat laporan kustom & laporan terjadwal

| Endpoint                                                                                | Keterangan                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /reports/datasets`, `POST /saved-reports/preview`                                  | Dataset HR/Payroll yang boleh dibaca user (kolom sensitif hanya untuk pemegang hak kelola) & pratinjau |
| `/saved-reports`, `GET /saved-reports/:id/run`, `GET /saved-reports/:id/export?format=` | Laporan tersimpan (pribadi/dibagikan), jalankan, ekspor `xlsx`/`csv`/`pdf`                             |
| `POST /saved-reports/:id/schedules`, `PATCH/DELETE /report-schedules/:id`               | Jadwal email harian/mingguan/bulanan (jam zona waktu perusahaan), hanya pemilik laporan                |
| `POST /report-schedules/:id/send-now`, `GET /report-schedules/:id/deliveries`           | Kirim sekarang & riwayat pengiriman                                                                    |

Konfigurasi laporan: kolom, filter dataset (dataset slip memakai `runId=latest` = payroll terposting terakhir), syarat
per kolom, kelompok (≤ 3) + agregasi jumlah/banyaknya/rata-rata/min/maks, urutan, batas baris, grafik batang/garis/
donat. Hak baca dataset & kolom sensitif dicek setiap laporan dijalankan (juga saat dikirim terjadwal, dengan hak
pemilik saat itu — bila hak dicabut pengiriman gagal & tercatat). Pengirim berjalan tiap 5 menit dan mengklaim periode
secara atomik sehingga tiap periode terkirim sekali (`REPORT_SCHEDULER=off` untuk mematikan).

#### Perencanaan & analitik SDM

Menu: **SDM › Perencanaan** (Man Power Planning, Anggaran Tenaga Kerja) dan **SDM › Laporan › Analitik SDM**.

| Endpoint                                                                                             | Keterangan                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /manpower-plans?year=`, `POST /manpower-plans`, `GET/PUT/DELETE /manpower-plans/:id`            | Man Power Planning per departemen × tahun (posisi terisi/tambahan/pengganti, bulan mulai/akhir, estimasi upah, THR); HR atau kepala departemen menyusun, upah hanya `payroll.read`                                                                                           |
| `POST /manpower-plans/:id/submit`, `/cancel`, `/revise`, `GET /manpower-plans/:id/export`            | Ajukan lewat kategori persetujuan **MPP**; saat disetujui mengisi Anggaran Tenaga Kerja per jabatan × bulan & anggaran akuntansi "Anggaran SDM {tahun}" (beban gaji, BPJS; baca saja di Akuntansi). Revisi kembali ke draft (anggaran lama berlaku), batal mencabut anggaran |
| `POST /manpower-plan-lines/:id/job-opening`                                                          | Jadikan posisi tambahan/pengganti lowongan; realisasi dari pelamar yang diterima                                                                                                                                                                                             |
| `GET/PUT /manpower-budgets?year=`, `GET /manpower-budgets/template`, `POST /manpower-budgets/import` | Anggaran tenaga kerja per departemen/jabatan/bulan (headcount & biaya; biaya hanya `payroll.read`), template & impor Excel/CSV                                                                                                                                               |
| `GET /manpower-budgets/report?year=[&format=xlsx]`                                                   | Rencana vs aktual: headcount akhir bulan, biaya dari slip terposting, selisih %, lowongan terbuka                                                                                                                                                                            |
| `GET /hr/analytics?year=&departmentId=[&format=xlsx]`                                                | Turnover (sukarela/tidak) & retensi, per departemen/alasan/masa kerja, demografi, kesetaraan gaji per golongan × gender + compa-ratio (`payroll.read`)                                                                                                                       |

### Pajak Coretax, Langganan & Operasional (Fase 5)

| Endpoint                                                                                                                                                          | Keterangan                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tax-invoices?year=&month=&state=`, `POST /tax-invoices/generate`                                                                                            | Faktur pajak keluaran: draft dari faktur penjualan ber-PPN yang sudah diposting                                                    |
| `PATCH /tax-invoices/:id`, `POST /tax-invoices/export`, `POST /tax-invoices/:id/{approve,cancel}`                                                                 | Kode transaksi/fasilitas, ekspor XML `TaxInvoiceBulk` (tax.manage), catat nomor faktur terbit                                      |
| `POST /tax-invoices/import-numbers`                                                                                                                               | Impor CSV daftar faktur Coretax (Referensi → Nomor Faktur Pajak)                                                                   |
| `GET /input-tax-invoices`, `POST /input-tax-invoices/{import,credit}`, `PATCH /input-tax-invoices/:id`                                                            | Faktur masukan dari CSV Coretax, cocok otomatis ke tagihan, kreditkan maks. 3 masa                                                 |
| `GET /withholding-slips?kind=bppu\|bpmp`, `POST /withholding-slips/{generate,export}`                                                                             | Bukti potong PPh 23/4(2)/22 dari tagihan (BPPU) & PPh 21 bulanan dari payroll (BPMP), XML                                          |
| `GET /tax/vat-report?year=&month=`, `GET /tax/exports`, `GET /tax/exports/:id`                                                                                    | Rekap SPT Masa PPN, riwayat berkas XML yang diekspor                                                                               |
| `POST /tax-invoices/check`, `POST /tax-invoices/:id/replace`                                                                                                      | Periksa isi faktur sebelum diunggah; draft faktur pengganti atas faktur yang sudah terbit                                          |
| `GET/POST /tax/nsfp-ranges`, `DELETE /tax/nsfp-ranges/:id`, `POST /tax-invoices/export-legacy`                                                                    | e-Faktur 3.x (pra-Coretax): rentang NSFP & CSV impor FK/OF (pengganti, uang muka/pelunasan)                                        |
| `GET /tax-returns`, `POST /tax-returns/{generate,export-legacy}`, `PATCH /tax-returns/:id`                                                                        | Nota retur pajak masukan dari nota debit; CSV RM untuk faktur lama; mengurangi PPN masukan                                         |
| `POST /withholding-slips/generate {kind: "bpa1"}`                                                                                                                 | Bukti potong A1 tahunan dari slip masa terakhir (Desember/karyawan keluar), XML `A1Bulk`                                           |
| `GET /onboarding`, `PUT /onboarding/company`, `POST /onboarding/{opening-balance,steps,complete}`                                                                 | Panduan awal: profil & PKP, saldo awal (selisih → 3-9900), checklist                                                               |
| `GET /billing`, `POST /billing/{subscribe,cancel,resume}`, `POST /billing/invoices/:id/pay`                                                                       | Paket, tagihan + PPN, pembayaran (Xendit atau transfer manual)                                                                     |
| `POST /billing/webhooks/xendit`                                                                                                                                   | Callback Xendit (header `x-callback-token` = `XENDIT_CALLBACK_TOKEN`)                                                              |
| `/platform/{tenants,plans,invoices}`, `POST /platform/invoices/:id/mark-paid`, `POST /platform/billing/run`                                                       | Admin platform (operator SaaS; `pnpm platform:admin <slug> <email>`)                                                               |
| `POST /platform/plans`, `PUT/DELETE /platform/plans/:id`, `PATCH /platform/tenants/:id/subscription` (`complimentary`, `complimentaryUntil`, `complimentaryNote`) | CRUD paket langganan (hapus hanya bila belum dipakai) & tenant gratis dari admin platform (tanpa tagihan; opsional sampai tanggal) |
| `GET /auth/sessions`, `DELETE /auth/sessions[/:id]`                                                                                                               | Sesi login aktif per perangkat, cabut satu/semua                                                                                   |
| `GET /health/ready`, `GET /metrics`                                                                                                                               | Readiness (DB & migrasi), metrik Prometheus (`Authorization: Bearer $METRICS_TOKEN`)                                               |

Format XML mengikuti template impor Coretax: faktur keluaran (`TaxInvoiceBulk`, dicocokkan dengan contoh referensi
Odoo `l10n_id_efaktur_coretax`), BPMP (`MmPayrollBulk`), BPPU (`BpuBulk`), dan BPA1 (`A1Bulk`). DJP tidak menerbitkan
XSD untuk berkas impor ini, jadi sebelum ekspor ERP memeriksa aturan dari lembar Keterangan template (identitas
16/22 digit, kode barang & satuan, rumus DPP/DPP nilai lain/PPN/PPnBM, keterangan fasilitas kode 07/08). **Uji dulu
satu berkas di Coretax** (menu impor → XML Monitoring) sebelum dipakai rutin, terutama BPPU dan BPA1 yang susunannya
belum bisa dicocokkan dengan berkas hasil konverter resmi DJP.

Faktur pelunasan atas pesanan berpotongan uang muka: potongan dibagi ke baris berpajak sama sebagai diskon, sehingga
DPP = penyerahan − uang muka yang sudah difakturkan. Produk barang mewah memakai tarif PPnBM (`luxuryTaxRate`); baris
penjualannya otomatis berpajak PPN barang mewah (DPP = harga jual) + pajak PPnBM perusahaan bertarif sama. Faktur
pengganti dan retur pajak masukan di Coretax dibuat lewat menu Coretax (impor XML Coretax hanya untuk faktur normal);
ERP mencatat datanya, nomornya, dan pengaruhnya ke rekap PPN. CSV e-Faktur 3.x (FK/OF, RM) disediakan untuk PKP yang
masih memakai aplikasi e-Faktur lama atau membetulkan faktur pra-Coretax.

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
| `GET /consolidation/runs/:id/segments?by=company\|business_unit\|branch`               | Laporan segmen: laba rugi per segmen + baris eliminasi ke konsolidasian              |
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

Akuisisi bertahap: isi `previousInterestFairValue` (nilai wajar kepemilikan sebelumnya) pada baris Kepemilikan saat
pengendalian diperoleh; kenaikan di atas biaya menambah goodwill dan laba pengukuran ulang (4-9700) dicatat setelah
dikurangi bagian laba metode ekuitas yang sudah diakui. Goodwill entitas asing dijabarkan ulang dengan kurs penutupan.
Saat entitas asing dilepas, bagian induk atas selisih kurs penjabaran kumulatif dipisahkan ke akun reklasifikasi
(4-9600). Laba belum terealisasi atas persediaan antara grup dan asosiasi dieliminasi sebesar bagian investor.
Konsolidasi sub-grup: pilih sub-holding sebagai perusahaan induk proses. Laporan segmen menjabarkan saldo tiap segmen
dengan rasio terjemahan entitasnya; baris tanpa dimensi masuk segmen "Tanpa unit bisnis/cabang".

Konfirmasi SO membuat pengiriman; barang ditagih sesuai kuantitas terkirim (jasa sesuai kuantitas dipesan). Validasi
transfer barang stok membuat jurnal di jurnal **STJ**: penerimaan Dr Persediaan / Cr Barang Diterima Belum Ditagih,
pengiriman Dr HPP / Cr Persediaan, opname ke Selisih Persediaan. Tagihan dari PO mendebit Barang Diterima Belum Ditagih.

Resource master mendukung `GET /x?q=&limit=&offset=&active=all|false`, `GET/PATCH/DELETE /x/:id`, `POST /x`,
`GET /x/export` (CSV; `?format=xlsx` untuk Excel) dan `POST /x/import` (`{ "csv": "..." }` atau `{ "xlsx": "<base64>" }`
— lembar pertama, baris pertama berisi nama field; baris ber-`id` diperbarui, tanpa `id` dibuat; satu baris gagal
membatalkan seluruh impor).

Login dibatasi 10 percobaan gagal per akun dan 50 per IP per 15 menit. Dengan `RATE_LIMIT_REDIS_URL` (atau `REDIS_URL`
di produksi) hitungan disimpan di Redis sehingga berlaku untuk semua instance API; bila Redis tidak terjangkau API
sementara memakai memori instance.

### Platform

| Endpoint                                                                                    | Keterangan                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /auth/sso/provider?tenant=`, `GET /auth/sso/start/:slug`, `GET /auth/sso/callback`     | SSO OpenID Connect (Google Workspace, Entra ID, Keycloak, Okta…) + PKCE     |
| `GET/PUT/DELETE /auth/sso/config`                                                           | Issuer, client ID/secret (terenkripsi), domain, user otomatis, SSO wajib    |
| `GET /auth/sso/saml/:slug/metadata`, `POST /auth/sso/saml/acs`, `GET /auth/sso/saml/finish` | SSO SAML 2.0 (ADFS, Entra ID, Okta, OneLogin…): metadata SP, ACS            |
| `GET/PUT /fx/settings`, `POST /fx/fetch {date?}`                                            | Kurs otomatis dari kurs referensi ECB (API Frankfurter), manual atau harian |

SSO OpenID Connect: daftarkan redirect URI `${API_ORIGIN}/auth/sso/callback` di penyedia identitas. User dicocokkan lewat
email terverifikasi (domain bisa dibatasi); 2FA ditangani penyedia identitas. Saat SSO diwajibkan, login password hanya
untuk administrator (akses darurat). Kurs KMK untuk pajak tetap diisi manual (tidak ada API resmi Kemenkeu).

SSO SAML 2.0 (protokol `saml` di pengaturan SSO): unggah URL metadata SP (`/auth/sso/saml/<slug>/metadata`, juga entity
ID) ke IdP, lalu isi URL SSO dan sertifikat penandatanganan IdP. Assertion wajib bertanda tangan; audience, masa berlaku,
dan `InResponseTo` (ID AuthnRequest yang disimpan terenkripsi di RelayState, sehingga aman untuk banyak instance API)
diverifikasi. Login yang dimulai dari IdP (tanpa AuthnRequest) ditolak. Email diambil dari atribut yang dipilih, atribut
email umum, atau NameID.

### Aplikasi Terhubung (ERP sebagai penyedia login)

| Endpoint                                                                                         | Keterangan                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/openid-configuration`, `GET /oauth/jwks`                                       | Discovery OpenID Connect & kunci publik id_token (RS256, dibuat otomatis)                                     |
| Web `/oauth/authorize` → `POST /oauth/authorize`, `POST /oauth/token`                            | Authorization code + PKCE S256; token: `authorization_code`, `refresh_token` (berotasi), `client_credentials` |
| `GET /oauth/userinfo`, `POST /oauth/revoke`, web `/oauth/logout` → `POST /oauth/logout`          | Profil (scope `profile email employee`), cabut refresh token, logout dari aplikasi & ERP                      |
| `/connected-apps`, `POST /connected-apps/:id/{rotate-secret,rotate-webhook-secret,webhook-test}` | Kelola aplikasi (`integration.manage`, admin penuh): redirect URI, peran boleh masuk, akun layanan, webhook   |
| `GET /connected-apps/:id/deliveries`, `POST /webhook-deliveries/:id/retry`                       | Log & kirim ulang webhook                                                                                     |
| `GET /integrations/{employees,departments}?updatedSince=&cursor=&limit=`                         | Sinkron data karyawan/departemen untuk aplikasi (tanpa data sensitif), `hr.read`                              |

Aplikasi lain (mis. manajemen proyek) memakai akun ERP untuk login, token akun layanan (`client_credentials`; hak =
peran akun layanan) untuk API, dan webhook bertanda tangan HMAC (`X-ERP-Signature`) saat karyawan/departemen berubah.
Panduan lengkap + contoh Next.js (Auth.js): [docs/integrasi-aplikasi.md](docs/integrasi-aplikasi.md). Pengirim webhook
berjalan tiap 30 detik (`WEBHOOK_SCHEDULER=off` untuk mematikan).

Pesan error API mengikuti `Accept-Language` (`en` → Inggris; bawaan Indonesia). Seluruh pesan error di kode — exception,
validasi zod, dan trigger database — punya terjemahan (`apps/api/src/common/error-messages-en.ts`); tes
`error-i18n-coverage` gagal bila ada pesan baru tanpa terjemahan.

## Pemeriksaan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Test RLS di `packages/db` berjalan bila `DATABASE_URL` di-set (dilewati jika tidak).
