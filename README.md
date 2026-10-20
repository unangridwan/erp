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

| Endpoint                                                                                                                                               | Keterangan                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/employees`, `/departments`, `/job-positions`, `/public-holidays`, `/leave-types`, `/leave-allocations`, `/overtimes`                                 | Data karyawan (NIK/NPWP/rekening terenkripsi), struktur, hari libur, cuti, lembur                              |
| `GET/POST /contracts`, `GET/PUT/DELETE /contracts/:id`, `POST /contracts/:id/{start,close}`                                                            | Kontrak PKWT/PKWTT dengan tunjangan & potongan bulanan                                                         |
| `GET/POST /leaves`, `GET /leaves/balances?employeeId=`, `POST /leaves/:id/{approve,refuse,cancel}`                                                     | Pengajuan cuti (hari kerja di luar libur), saldo jatah                                                         |
| `POST /attendance/{check-in,check-out}`, `GET/POST /attendance`                                                                                        | Absensi dari portal, rekap & koreksi manual                                                                    |
| `GET /me/{employee,attendance,leaves,leave-types,payslips}`                                                                                            | Portal karyawan (user yang terhubung ke data karyawan)                                                         |
| `/salary-components`, `GET/PUT /payroll/settings`                                                                                                      | Komponen gaji, tarif JKK, batas upah BPJS, akun & jurnal gaji                                                  |
| `GET/POST /payroll-runs`, `GET /payroll-runs/:id`, `POST /payroll-runs/:id/{compute,post,pay,cancel}`                                                  | Payroll bulanan: hitung, posting jurnal, bayar gaji bersih                                                     |
| `GET /payroll-runs/:id/{bank-transfer,recap}?format=csv`                                                                                               | File transfer bank, rekap PPh 21 & BPJS (NIK/NPWP)                                                             |
| `GET /payslips/:id`, `PUT /payslips/:id/inputs`, `GET /payslips/:id/pdf`                                                                               | Slip gaji, input THR/bonus/potongan, PDF                                                                       |
| `/work-schedules`, `/shift-assignments`, `GET /attendance/lateness?from=&to=&employeeId=`                                                              | Jadwal kerja & shift, toleransi & potongan keterlambatan (otomatis di slip)                                    |
| `GET /approvals/pending`, `GET /approvals/:model/:id`, `POST /approvals/overtime/:id/{approve,refuse}`                                                 | Persetujuan berjenjang cuti & lembur: atasan → atasan dari atasan → HR                                         |
| `GET/POST /employee-loans`, `GET /employee-loans/:id`, `POST /employee-loans/:id/{disburse,cancel}`                                                    | Pinjaman karyawan: cair via kas/bank, cicilan otomatis di slip sampai lunas                                    |
| `/work-entries`                                                                                                                                        | Hasil kerja pekerja borongan (terkunci setelah payroll diposting)                                              |
| `GET/POST /employees/:id/severances`, `POST /employees/:id/severance/preview`                                                                          | Pesangon, UPMK, UPH, uang pisah/kompensasi PKWT (PP 35/2021) + PPh 21 final                                    |
| `/salary-grades`, `GET /hr/wage-scale`                                                                                                                 | Struktur & skala upah (PP 36/2021): golongan di jabatan, upah di luar rentang                                  |
| `POST /payroll-runs/:id/{thr,retro}`                                                                                                                   | THR otomatis (Permenaker 6/2016) & rapel kenaikan upah berlaku mundur                                          |
| `GET /payroll-runs/:id/bank-transfer?format=csv\|bca\|mandiri\|bri\|bni`, `GET …/bank-transfer/summary`                                                | File transfer gaji massal per bank (rekening bank itu saja) + ringkasan per bank                               |
| `GET /payroll-runs/:id/recap?format=csv\|edabu\|sipp`                                                                                                  | Rekap PPh 21 & BPJS, unggah BPJS Kesehatan (e-Dabu) & Ketenagakerjaan (SIPP)                                   |
| `POST /payroll-runs/:id/email-payslips`                                                                                                                | Kirim slip PDF berkata sandi (tanggal lahir DDMMYYYY) ke email kerja                                           |
| `GET /payroll/reports/cost?from=YYYY-MM&to=YYYY-MM&groupBy=department\|branch\|month`                                                                  | Biaya tenaga kerja (pendapatan + BPJS perusahaan) dari payroll terposting                                      |
| `/expense-categories`, `GET/POST /expense-claims`, `GET/PUT/DELETE /expense-claims/:id`, `POST /expense-claims/:id/{submit,approve,refuse,cancel,pay}` | Klaim biaya: plafon tahunan per kategori, persetujuan berjenjang, bayar via slip/kas-bank, bukti PDF/JPG/PNG   |
| `GET /employee-change-requests`, `POST /employee-change-requests/:id/{approve,refuse}`                                                                 | Perubahan data pribadi dari portal, disetujui HR lalu diterapkan                                               |
| `GET /me/{expense-categories,overtimes,loans,change-requests,withholding-slips}`, `POST /me/{overtimes,change-requests}`, `GET /expense-claims?mine=1` | Portal karyawan: lembur, klaim, pinjaman, perubahan data, bukti potong A1                                      |
| `/job-openings`, `GET/POST /applicants`, `GET/PUT/DELETE /applicants/:id`, `POST /applicants/:id/{stage,interviews,hire}`                              | Rekrutmen: lowongan, kanban pelamar, wawancara (skor), terima → karyawan + kontrak draft + onboarding          |
| `GET/POST /hr-documents`, `GET /hr-documents/:id/file`, `GET /hr-documents/expiring`, `GET /hr/reminders`                                              | Dokumen karyawan/pelamar (PDF/JPG/PNG ≤ 5 MB) & pengingat kedaluwarsa, kontrak PKWT berakhir                   |
| `/hr-checklist-templates`, `GET/POST /hr-checklists`, `POST /hr-checklists/tasks/:taskId`, `GET /me/checklist-tasks`                                   | Checklist onboarding/offboarding (otomatis saat karyawan baru/tanggal keluar diisi)                            |
| `/appraisal-templates`, `GET/POST /appraisal-cycles`, `POST /appraisal-cycles/:id/{start,close}`                                                       | Penilaian kinerja: template KPI berbobot per jabatan, siklus, formulir per karyawan                            |
| `GET /appraisals`, `PUT /appraisals/:id/{self,manager}`, `POST /appraisals/:id/calibrate`, `GET /me/appraisals`                                        | Penilaian diri → atasan → kalibrasi HR (skor akhir, predikat A–E, usulan kenaikan upah)                        |
| `/trainings`, `POST /trainings/:id/participants`, `PUT /trainings/:id/participants/:pid`                                                               | Pelatihan & sertifikasi; sertifikat menjadi dokumen karyawan dengan masa berlaku                               |
| `GET /employees/:id/history`, `GET /hr/org-chart`, `GET /hr/dashboard?year=`                                                                           | Riwayat karir otomatis, struktur organisasi, dashboard SDM (headcount, turnover, cuti, biaya)                  |
| `GET/PUT/DELETE /employees/:id/photo`, `GET/PUT /me/photo`                                                                                             | Foto karyawan (JPG/PNG/WebP ≤ 1 MB, diperkecil di browser)                                                     |
| `/employees/:id/{family,education,experiences}`, `GET /employees/:id/profile-summary`                                                                  | Data keluarga (NIK terenkripsi), riwayat pendidikan, pengalaman kerja, kelengkapan profil & saran PTKP         |
| `GET/POST /employee-movements`, `POST /employee-movements/:id/{apply,cancel}`                                                                          | Promosi/demosi/mutasi/rotasi dengan SK: perbarui jabatan/departemen/cabang/atasan/golongan & kontrak upah baru |
| `GET/POST /employee-warnings`, `GET /me/profile`                                                                                                       | Surat peringatan SP1–SP3 (berlaku 6 bulan, masuk pengingat HR); profil sendiri di portal                       |

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

### Pajak Coretax, Langganan & Operasional (Fase 5)

| Endpoint                                                                                                    | Keterangan                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /tax-invoices?year=&month=&state=`, `POST /tax-invoices/generate`                                      | Faktur pajak keluaran: draft dari faktur penjualan ber-PPN yang sudah diposting               |
| `PATCH /tax-invoices/:id`, `POST /tax-invoices/export`, `POST /tax-invoices/:id/{approve,cancel}`           | Kode transaksi/fasilitas, ekspor XML `TaxInvoiceBulk` (tax.manage), catat nomor faktur terbit |
| `POST /tax-invoices/import-numbers`                                                                         | Impor CSV daftar faktur Coretax (Referensi → Nomor Faktur Pajak)                              |
| `GET /input-tax-invoices`, `POST /input-tax-invoices/{import,credit}`, `PATCH /input-tax-invoices/:id`      | Faktur masukan dari CSV Coretax, cocok otomatis ke tagihan, kreditkan maks. 3 masa            |
| `GET /withholding-slips?kind=bppu\|bpmp`, `POST /withholding-slips/{generate,export}`                       | Bukti potong PPh 23/4(2)/22 dari tagihan (BPPU) & PPh 21 bulanan dari payroll (BPMP), XML     |
| `GET /tax/vat-report?year=&month=`, `GET /tax/exports`, `GET /tax/exports/:id`                              | Rekap SPT Masa PPN, riwayat berkas XML yang diekspor                                          |
| `POST /tax-invoices/check`, `POST /tax-invoices/:id/replace`                                                | Periksa isi faktur sebelum diunggah; draft faktur pengganti atas faktur yang sudah terbit     |
| `GET/POST /tax/nsfp-ranges`, `DELETE /tax/nsfp-ranges/:id`, `POST /tax-invoices/export-legacy`              | e-Faktur 3.x (pra-Coretax): rentang NSFP & CSV impor FK/OF (pengganti, uang muka/pelunasan)   |
| `GET /tax-returns`, `POST /tax-returns/{generate,export-legacy}`, `PATCH /tax-returns/:id`                  | Nota retur pajak masukan dari nota debit; CSV RM untuk faktur lama; mengurangi PPN masukan    |
| `POST /withholding-slips/generate {kind: "bpa1"}`                                                           | Bukti potong A1 tahunan dari slip masa terakhir (Desember/karyawan keluar), XML `A1Bulk`      |
| `GET /onboarding`, `PUT /onboarding/company`, `POST /onboarding/{opening-balance,steps,complete}`           | Panduan awal: profil & PKP, saldo awal (selisih → 3-9900), checklist                          |
| `GET /billing`, `POST /billing/{subscribe,cancel,resume}`, `POST /billing/invoices/:id/pay`                 | Paket, tagihan + PPN, pembayaran (Xendit atau transfer manual)                                |
| `POST /billing/webhooks/xendit`                                                                             | Callback Xendit (header `x-callback-token` = `XENDIT_CALLBACK_TOKEN`)                         |
| `/platform/{tenants,plans,invoices}`, `POST /platform/invoices/:id/mark-paid`, `POST /platform/billing/run` | Admin platform (operator SaaS; `pnpm platform:admin <slug> <email>`)                          |
| `GET /auth/sessions`, `DELETE /auth/sessions[/:id]`                                                         | Sesi login aktif per perangkat, cabut satu/semua                                              |
| `GET /health/ready`, `GET /metrics`                                                                         | Readiness (DB & migrasi), metrik Prometheus (`Authorization: Bearer $METRICS_TOKEN`)          |

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

Pesan error API mengikuti `Accept-Language` (`en` → Inggris; bawaan Indonesia). Seluruh pesan error di kode — exception,
validasi zod, dan trigger database — punya terjemahan (`apps/api/src/common/error-messages-en.ts`); tes
`error-i18n-coverage` gagal bila ada pesan baru tanpa terjemahan.

## Pemeriksaan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Test RLS di `packages/db` berjalan bila `DATABASE_URL` di-set (dilewati jika tidak).
