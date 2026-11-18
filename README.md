# ERP

ERP SaaS multi-tenant (mirip Odoo) dengan lokalisasi Indonesia dan konsolidasi grup usaha.
Rencana lengkap: [docs/PLAN.md](docs/PLAN.md) · Keputusan arsitektur: [docs/adr](docs/adr) · Belajar membaca & mengedit kode: [docs/PANDUAN-KODE.md](docs/PANDUAN-KODE.md) · Perbandingan dengan SAP: [docs/ANALISIS-VS-SAP.md](docs/ANALISIS-VS-SAP.md).

## Struktur

| Path                 | Isi                                                                             |
| -------------------- | ------------------------------------------------------------------------------- |
| `apps/api`           | Backend NestJS                                                                  |
| `apps/web`           | Frontend Next.js                                                                |
| `packages/db`        | Skema Drizzle, migrasi SQL, Row-Level Security                                  |
| `packages/shared`    | Tipe & util bersama (mis. perhitungan kepemilikan efektif grup)                 |
| `packages/demo-data` | Data simulasi grup PT Didin Putra Agro: pembangkit Excel & skrip muat lewat API |
| `demo/`              | Hasil: workbook data simulasi & file siap impor per perusahaan                  |
| `infra`              | docker-compose (Postgres, Redis, Mailpit), skrip backup & PITR                  |

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
- **`Module not found: Can't resolve 'zod'`** (atau paket lain) di `pnpm dev`: tautan paket di `node_modules` belum
  diperbarui. Hentikan `pnpm dev`, jalankan `pnpm install` di folder root proyek (jawab `Y` bila pnpm meminta membangun
  ulang `node_modules`), hapus folder `apps/web/.next`, lalu `pnpm dev` lagi. Cadangan tanpa Turbopack:
  `pnpm --filter @erp/web exec next dev --port 3000`.
- **`docker` tidak dikenal**: pastikan Docker Desktop sudah berjalan (ikon di system tray) lalu buka terminal baru.
- **Mulai dari awal**: `docker compose -f infra/docker-compose.yml down -v`, lalu ulangi `up -d` dan `pnpm db:setup`.
- **`pnpm format:check` gagal di Windows karena akhir baris CRLF** (clone dibuat sebelum `.gitattributes` ada): hapus
  folder lalu clone ulang.

### Data simulasi (grup fiktif PT Didin Putra Agro)

Holding **PT Didin Putra Agro** (DPA) dengan 4 anak usaha 100%: PT Benih Unggul Indonesia (BUI, benih padi/jagung/
sayur/cabai), PT Agroteknologi Indonesia (AGT, smart farming & AI, alsintan), PT Perdagangan Tani (PTN, perdagangan
lokal & ekspor-impor, penjualan USD), PT Yuyun Herbal Nusantara (YHN, budidaya & produk herbal). Periode
**Januari 2021 – Oktober 2026** (saldo awal & stok awal 1 Jan 2021; November 2026 berjalan), dengan usaha yang tumbuh
tiap tahun:

- **Harian**: ±14,9 rb pesanan penjualan (kirim, faktur, bayar) & ±800 pembelian yang makin padat tiap tahun
  (2021 ±32% volume 2026), transaksi antar-perusahaan, ±2,7 rb cuti, ±7 rb lembur, ±2 rb klaim, dan ±180 rb baris
  absensi (semua karyawan sejak 2025; 2021–2024 pekerja harian yang upahnya dihitung dari absensi).
- **Bulanan**: payroll 70 bulan × 5 perusahaan (hitung, posting, bayar), penyusutan aset, kurs USD/EUR, jasa manajemen
  holding.
- **Tahunan**: kenaikan upah tiap Januari (SK Penyesuaian upah), alokasi cuti, anggaran & anggaran tenaga kerja,
  pinjaman karyawan, CRM (menang/kalah), lowongan & pelamar, konsolidasi, dan tutup buku 2021–2025.
- 455 karyawan (60 di antaranya sudah keluar) lengkap dengan kontrak, keluarga, pendidikan, BPJS & rekening;
  147 produk, 113 partner, libur nasional 2021–2026, armada.

- **Excel**: `demo/didin-putra-agro/Data-Simulasi-PT-Didin-Putra-Agro.xlsx` (lembar _Panduan_ menjelaskan menu ERP
  tiap lembar) dan `demo/didin-putra-agro/impor/<KODE>/` berisi file siap unggah lewat menu impor (lihat
  `impor/DAFTAR.md`). Bangkitkan ulang dengan `pnpm demo:excel` (hasilnya selalu sama).
- **Muat otomatis** ke database (API harus berjalan, mis. `pnpm dev`):

  ```bash
  pnpm install                       # wajib sekali setelah git pull (paket packages/demo-data)
  pnpm demo:load                     # tenant "didin-putra-agro", ±30 menit (database/tenant baru)
  pnpm demo:load --api http://localhost:3001 --slug didin-putra-agro --only transaksi,payroll
  ```

  Login: tenant `didin-putra-agro`, `admin@didinputraagro.co.id` / `DemoAgro2026!` (pengguna demo lain per
  perusahaan ada di lembar _Pengguna_). Skrip membaca workbook, jadi data yang Anda ubah di Excel ikut dimuat; tiap
  tahap aman dijalankan ulang (data yang sudah ada dilewati). Tahap: `perusahaan, master, sdm, pengguna, saldo-awal,
transaksi, kehadiran, karyawan-keluar, payroll, crm-rekrutmen-armada, konsolidasi, tutup-buku`. Data 2021–2026 dimuat ke tenant atau
  database **baru** (saldo awal kini 1 Jan 2021); tenant demo lama berisi data 2026 pakai `--slug` lain. Semua data
  fiktif.

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

**Kenyamanan pakai (web).** Pesan sukses/gagal tampil sebagai _toast_ yang hilang sendiri; konfirmasi (hapus,
batalkan, dst.) memakai dialog aplikasi (Esc = batal) — tidak lagi `confirm()` browser. **Ctrl+K / ⌘K** (atau `/`,
atau tombol Cari di navbar) membuka palet perintah: buka menu/aplikasi mana pun, "Buat … baru", favorit & terakhir
dibuka, dan cari data (karyawan, kontak, produk, pesanan penjualan/pembelian, faktur) sesuai hak akses. Form: penanda
"Belum disimpan", tombol **Buang**, **Ctrl+S** untuk menyimpan, peringatan saat meninggalkan halaman dengan perubahan,
field wajib divalidasi saat ditinggalkan & fokus otomatis ke field yang salah. Daftar: klik di mana saja pada baris
untuk membuka (Ctrl/⌘-klik = tab baru, ↑↓ + Enter), pilih banyak baris → **Hapus / Arsipkan / Aktifkan / Ekspor CSV**,
menu **Kolom** untuk menyembunyikan kolom (diingat per daftar), dan keadaan kosong dengan tombol "Buat … pertama" /
"Hapus filter". Beranda menampilkan **Perlu tindakan saya** (persetujuan menunggu, notifikasi), **Favorit & terakhir
dibuka** (☆ di judul data), dan **Buat cepat** di atas grid aplikasi.

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

| Endpoint                                                                                                     | Keterangan                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `/accounts`, `/journals`, `/taxes`                                                                           | Bagan akun, jurnal, pajak (per perusahaan aktif; dipasang otomatis)                                                  |
| `POST /accounting/setup`, `GET/PATCH /accounting/settings`                                                   | Pasang COA standar, lock date                                                                                        |
| `GET/POST /moves`, `GET/PATCH/DELETE /moves/:id`                                                             | Draft jurnal umum atau faktur/tagihan (`moveType`)                                                                   |
| `POST /moves/:id/post`, `POST /moves/:id/reverse`                                                            | Posting (nomor `INV/2026/0001`), jurnal balik / nota kredit                                                          |
| `GET/POST /payments`, `POST /reconcile`                                                                      | Pembayaran (melunasi faktur), rekonsiliasi manual                                                                    |
| `GET /reports/trial-balance`, `/general-ledger`, `/balance-sheet`, `/profit-loss`, `/aged`                   | Laporan; filter `dateFrom`, `dateTo`, `companyIds`, `branchId`, `businessUnitId`                                     |
| `GET /reports/:name/export`                                                                                  | Ekspor laporan ke Excel (parameter sama)                                                                             |
| `/bank-statements`, `POST /bank-statements/import`, `/bank-statement-lines/:id/{suggestions,reconcile,undo}` | Rekonsiliasi bank                                                                                                    |
| `/assets`, `POST /assets/:id/confirm`, `POST /assets/depreciate`                                             | Aset tetap & penyusutan                                                                                              |
| `POST /assets/:id/dispose`                                                                                   | Jual (faktur + jurnal pelepasan) atau hapus buku aset; laba/rugi ke 4-9500                                           |
| `GET /accounting/fx-revaluations[/preview?date=]`, `POST /accounting/fx-revaluations`                        | Revaluasi kurs akhir bulan (4-9110/7-1110), dibalik otomatis hari berikutnya                                         |
| `/budgets`, `GET /reports/budget?budgetId=`                                                                  | Anggaran vs realisasi                                                                                                |
| `POST /accounting/close-year`                                                                                | Tutup buku tahun fiskal                                                                                              |
| `GET/PUT /partners/:id/credit`, `GET /sale-orders/:id/credit-check`                                          | Batas kredit pelanggan per perusahaan (peringatan saja): paparan = piutang terbuka + SO belum ditagih + faktur draft |
| `/dunning-levels`, `GET/PUT /dunning/settings`, `GET /dunning/preview?date=`, `POST /dunning/send`           | Penagihan bertingkat (dunning): tingkat & isi surat, pratinjau, kirim surat teguran (email + PDF)                    |
| `GET /dunning-letters`, `GET /dunning-letters/:id/pdf`, `POST /dunning-letters/:id/resend`                   | Riwayat surat teguran, cetak, kirim ulang                                                                            |
| Baris faktur `deferralStart`/`deferralEnd`, `GET /moves/:id/deferrals`                                       | Pendapatan/biaya ditangguhkan: diakui prorata hari per akhir bulan                                                   |
| Jurnal umum `autoReverseDate`                                                                                | Jurnal akrual: pembalik dibuat & diposting otomatis saat entri diposting                                             |
| `/recurring-entries`, `POST /recurring-entries/:id/generate`                                                 | Jurnal berulang (mingguan/bulanan/triwulan/tahunan), posting otomatis atau draft                                     |
| `GET /reports/cash-flow`, `GET /reports/cash-flow/export`                                                    | Laporan arus kas metode tidak langsung (filter sama dengan laporan lain)                                             |

**Batas kredit & dunning (migrasi 0062).** Batas kredit diisi per pelanggan per perusahaan di form Kontak (panel
**Kredit & penagihan**). Batas ini tidak memblokir: form pesanan penjualan menampilkan peringatan, konfirmasi meminta
penegasan, dan peringatan dicatat di riwayat pesanan. Menu Akuntansi › **Penagihan (Dunning)** menampilkan pelanggan
dengan faktur lewat jatuh tempo. Tingkat bawaannya: H+7 pengingat email, H+30 surat teguran 1, H+60 teguran terakhir
dengan lampiran PDF. Tingkat naik sesuai umur tunggakan, dan faktur yang sudah ditagih pada suatu tingkat tidak ditagih
ulang pada tingkat itu. Pelanggan tanpa email dicatat "gagal kirim" dan suratnya bisa dicetak atau dikirim ulang ke
alamat lain. Bila **Kirim otomatis** diaktifkan di tab Pengaturan, penjadwal mengirim surat setiap hari
(`DUNNING_SCHEDULER=off` untuk mematikannya). Pelanggan perusahaan grup tidak pernah ditagih.

**Penangguhan, akrual & jurnal berulang (migrasi 0063).** Di baris faktur atau tagihan, isi periode **Ditangguhkan**
(mulai–akhir), misalnya untuk langganan setahun atau sewa dibayar di muka. Saat diposting, nilai baris dicatat ke akun
Pendapatan Diterima di Muka (2-1650) atau Biaya Dibayar Dimuka (1-1700); keduanya bisa diubah di Pengaturan Akuntansi.
Sistem lalu membuat draft jurnal pengakuan per akhir bulan, dihitung prorata hari, yang diposting otomatis saat
tanggalnya tiba. Membalik faktur juga membalik pengakuan yang sudah diposting dan menghapus draft sisanya. Jurnal umum
punya kolom **Balik otomatis pada** untuk akrual. Menu Akuntansi › **Jurnal Berulang** membuat jurnal sesuai jadwal;
tiap template bisa diposting otomatis atau dibuat sebagai draft, punya opsi balik otomatis hari berikutnya, dan
bisa berhenti pada tanggal tertentu atau setelah sejumlah kali. Penjadwal berjalan tiap jam
(`ACCOUNTING_SCHEDULER=off` untuk mematikannya).

**Laporan arus kas (migrasi 0064).** Akuntansi › Laporan Keuangan › tab **Arus Kas** menyajikan arus kas metode
tidak langsung (PSAK 2): laba bersih, penyusutan, dan perubahan modal kerja (operasi), lalu aktivitas investasi dan
pendanaan, serta kas awal dan akhir. Laporan ini bisa dibandingkan dengan periode yang sama tahun lalu, difilter per
perusahaan, cabang, atau unit bisnis, dan diekspor ke Excel. Kelompok tiap akun mengikuti jenis akunnya dan bisa
ditimpa lewat kolom **Kelompok arus kas** di Bagan Akun. Bila ada perubahan yang belum terklasifikasi, laporan
menampilkan selisihnya. Entri tutup buku tidak ikut dihitung.

**Controlling: cost center & profit center (migrasi 0065).** Akuntansi › Konfigurasi › **Cost Center** dan **Profit
Center** (berjenjang, per perusahaan; tiap cost center masuk ke satu profit center). Baris jurnal punya kolom cost
center dan profit center yang terisi otomatis:

- payroll, klaim biaya & pesangon dari cost center karyawan, atau departemennya (naik ke departemen induk);
- penyusutan & pelepasan aset dari aset, tagihan servis dari kendaraan, tagihan dari PO, faktur dari SO (profit center);
- bila masih kosong, dari **cost center/profit center bawaan** akun; profit center diambil dari cost center-nya.

Pengaturan Akuntansi › **Cost center wajib** menolak posting entri yang punya baris akun beban (operasional &
penyusutan) tanpa cost center. Baris anggaran bisa diberi cost center (realisasi termasuk cost center turunannya).
Akuntansi › Laporan › **Laporan Controlling** menampilkan biaya per cost center (berjenjang, rincian per akun, vs
anggaran yang diprorata menurut periode) dan laba rugi per profit center (pendapatan, HPP, laba kotor, beban, laba
bersih, margin). Laporan keuangan biasa bisa difilter per cost center atau profit center.

| Endpoint                                                     | Keterangan                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `/cost-centers`, `/profit-centers`                           | CRUD (hapus ditolak bila sudah dipakai jurnal atau punya turunan) |
| `GET /controlling/cost-centers?dateFrom&dateTo&branchId`     | Biaya per cost center (pohon + rollup) vs anggaran                |
| `GET /controlling/cost-centers/:id/accounts?dateFrom&dateTo` | Rincian biaya per akun untuk cost center beserta turunannya       |
| `GET /controlling/profit-centers?dateFrom&dateTo&branchId`   | Laba rugi per profit center                                       |

**Alokasi biaya periodik (migrasi 0066).** Akuntansi › **Alokasi Biaya** membagi biaya cost center pendukung (mis. IT,
umum) ke cost center lain tiap bulan. Metodenya **persen tetap** (total 100%) atau **kunci statistik**: jumlah karyawan
aktif per cost center (otomatis) atau angka yang diinput (luas lantai, jam mesin) yang berlaku mulai bulan tertentu.
Siklus dijalankan berurutan sehingga biaya yang diterima dari siklus sebelumnya ikut dibagi. Hasilnya satu jurnal per
siklus bertanggal akhir bulan, per akun asal (kredit sumber, debit penerima). Satu siklus hanya terposting sekali per
bulan; hasil bisa dibalik (dimulai dari siklus lanjutan) lalu dijalankan ulang. Pratinjau menampilkan dasar dan bagian
tiap penerima sebelum diposting.

| Endpoint                                                               | Keterangan                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/statistical-keys`, `GET/PUT /statistical-keys/:id/values?period`     | Kunci statistik & nilai per cost center per bulan           |
| `GET/POST /allocation-cycles`, `GET/PUT/DELETE /allocation-cycles/:id` | Siklus alokasi + penerima                                   |
| `POST /allocation-runs/preview`, `POST /allocation-runs` `{period}`    | Pratinjau / jalankan & posting semua siklus aktif bulan itu |
| `GET /allocation-runs?period`, `POST /allocation-runs/:id/reverse`     | Riwayat & pembalikan                                        |

**Payment run — pembayaran pemasok massal (migrasi 0067).** Akuntansi › Pemasok › **Payment Run**:

1. **Usulan**: pilih tanggal jatuh tempo, tanggal bayar, dan jurnal bank; semua tagihan pemasok terbuka (mata uang
   perusahaan) yang jatuh tempo diusulkan otomatis. Tagihan bisa dikeluarkan, dibayar sebagian, dan rekening tujuan
   dipilih per pemasok. Tagihan yang sudah ada di run aktif lain tidak diusulkan lagi.
2. **Persetujuan**: diajukan ke kategori **Pembayaran Pemasok** (PAYRUN) di mesin persetujuan; aturan & batas wewenang
   berlaku (nominal = total run).
3. **Eksekusi** (hak posting): per pemasok satu pembayaran (Dr Utang / Cr Bank) yang melunasi tagihannya; tagihan
   dibayar sebagian dicatat terpisah. Tagihan yang berubah sejak disetujui (sudah dibayar) ditandai gagal dan tidak
   dibayar dua kali.
4. **File transfer massal** BCA/Mandiri/BRI/BNI (sesama bank) dan CSV; rekening sumber & corporate ID diisi di jurnal
   bank (Bagan › Jurnal).
5. **Transfer gagal** per pemasok: pembayaran dibalik dan tagihan terbuka lagi untuk run berikutnya.

Rekening bank pemasok dikelola di panel **Rekening bank** pada form kontak (beberapa rekening, satu utama).

| Endpoint                                                             | Keterangan                                       |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| `GET/POST /partners/:id/bank-accounts`, `PUT/DELETE …/:accountId`    | Rekening bank kontak                             |
| `GET/POST /payment-runs`, `GET/PUT /payment-runs/:id`                | Daftar, usulan otomatis, ubah baris (draft)      |
| `POST /payment-runs/:id/submit`, `…/cancel`, `…/execute`             | Ajukan persetujuan, batalkan, eksekusi & posting |
| `GET /payment-runs/:id/bank-file?format=bca\|mandiri\|bri\|bni\|csv` | File transfer massal (`&info=1` ringkasan)       |
| `POST /payment-runs/:id/fail` `{partnerId}`                          | Transfer gagal: balik pembayaran pemasok itu     |

**Landed cost (migrasi 0068).** Persediaan › **Landed Cost** menambahkan biaya angkut, bea masuk, asuransi, dan biaya
lain ke nilai barang dari satu atau beberapa penerimaan yang sudah selesai. Tiap baris biaya punya akun lawan (mis.
biaya angkut di tagihan jasa, atau biaya masih harus dibayar) dan metode pembagian: **nilai barang, kuantitas, berat,
volume, atau rata per baris** (berat & volume diisi di produk). Pratinjau menampilkan tambahan per barang, porsi ke
persediaan, porsi ke HPP (barang yang sudah keluar), dan biaya per unit baru. Posting menaikkan nilai lapisan valuasi
(FIFO) dan biaya rata-rata, lalu membuat jurnal Dr Persediaan + Dr HPP / Cr akun lawan. Landed cost bisa dibuat dari
tagihan jasa (`POST /landed-costs/from-bill/:billId`) dan dibatalkan selama barangnya belum keluar lagi.

**Kontrak pembelian / blanket order (migrasi 0069).** Pembelian › **Kontrak Pembelian** mencatat kontrak harga tetap
dengan pemasok: periode berlaku, produk + harga + diskon + pajak, **kuantitas komitmen per produk**, minimal pesan, dan
**plafon nilai** opsional. Kontrak diajukan lewat mesin persetujuan (kategori "Kontrak Pembelian", nominal = nilai
komitmen atau plafon) dan aktif setelah disetujui. Tombol **Buat PO** membuat RFQ dari sisa kontrak; PO manual ke pemasok
yang punya tepat satu kontrak aktif otomatis memakai harga kontrak (atau pilih kontraknya di form PO). Realisasi
(kuantitas & nilai) dihitung dari PO terkonfirmasi/menunggu persetujuan; PO yang **melebihi sisa, plafon, di bawah
minimal pesan, atau di luar masa kontrak** ditandai peringatan dan konfirmasinya **wajib disetujui**. Kontrak aktif yang
lewat tanggal berakhir tampil "Berakhir"; kontrak bisa ditutup kapan saja.

**Stock opname, barcode & lacak serial (migrasi 0070).** Persediaan › **Stock Opname** membuat sesi hitung fisik per
gudang/lokasi (opname penuh) atau per kategori produk (cycle count). _Mulai hitung_ mengambil snapshot stok sistem per
lokasi & lot; hasil hitung diisi langsung di tabel, lewat **scan barcode** (barcode produk, SKU, atau nomor lot/serial;
pemindai biasa/keyboard wedge), atau **impor Excel/CSV** dari lembar hitung yang diunduh. Barang temuan (produk/serial
yang tidak ada di sistem) bisa ditambahkan. _Ajukan selisih_ mengirim selisih ke mesin persetujuan (kategori "Selisih
Stock Opname", nominal = nilai selisih absolut); tanpa selisih langsung siap diposting. _Posting penyesuaian_ menyetel
stok tiap baris ke hasil hitung lewat penyesuaian persediaan (jurnal selisih otomatis). Menu lama berganti nama
**Penyesuaian Stok** untuk koreksi cepat. Transfer (penerimaan/pengiriman/internal) punya kotak **scan barcode**: scan
produk menambah kuantitas dikerjakan, scan serial/lot menambah baris lot (penerimaan: kode baru = nomor serial baru).
**Label Barcode** mencetak label Code 128 (A4, 3 × 8) untuk produk dan lot/serial. Halaman detail **Lot / Serial**
menampilkan riwayat lengkap nomor itu: penerimaan dari pemasok, perpindahan, opname, pengiriman ke pelanggan, dan posisi
stok sekarang.

**Manufaktur ringan (migrasi 0071).** Aplikasi **Manufaktur**: **Stasiun Kerja** (tarif tenaga kerja + overhead per jam,
kapasitas), **Bill of Materials** (komponen dengan satuan, operasi/rute per stasiun kerja dengan menit standar, BOM
**kit/phantom** yang langsung diurai ke komponennya, deteksi BOM berputar, estimasi biaya per unit), dan **Order
Produksi**: komponen & operasi dihitung dari BOM × jumlah (multi-level), stok bahan tersedia/kurang ditampilkan,
operasi dimulai/diselesaikan dengan menit aktual, lalu _Produksi_ mencatat hasil (boleh sebagian, konsumsi bahan bisa
diubah, lot/serial hasil wajib untuk produk ber-lot/serial; lot bahan dipilih otomatis kedaluwarsa/tertua dulu).
Pembukuan lewat akun **Barang Dalam Proses** (1-1450): bahan keluar Dr WIP / Cr Persediaan (nilai FIFO/rata-rata
aktual), biaya konversi (menit × tarif) Dr WIP / Cr **Biaya Konversi Produksi Dibebankan** (5-1300), barang jadi masuk
Dr Persediaan / Cr WIP sebesar total biaya sehingga WIP per order kembali nol. Laporan **Biaya Produksi** per produk
(bahan, konversi, biaya per unit). Hak akses `mrp.read/write/manage` dan peran bawaan "Manajer Produksi".

**MRP sederhana (migrasi 0072).** Manufaktur › **Perencanaan (MRP)** menjalankan perencanaan kebutuhan per gudang
sampai tanggal batas: kebutuhan = pengiriman pelanggan yang belum selesai + bahan order produksi terbuka + pengisian
stok minimum (aturan pemesanan ulang, sampai maksimum & kelipatan), dikurangi stok gudang dan pasokan terbuka
(penerimaan, RFQ/PO, order produksi). Produk diproses per level BOM (produk jadi lalu komponennya), dengan **lead time**
produksi (di BOM) dan pembelian (Harga Pemasok) untuk tanggal mulai. Hasilnya usulan **order produksi** (produk ber-BOM)
dan **pembelian** ke pemasok utama; usulan terpilih dikonfirmasi menjadi order produksi draft dan RFQ per pemasok,
atau diabaikan. MRP yang dijalankan ulang memperhitungkan dokumen yang sudah dibuat sehingga tidak mengusulkan ganda.

**Field kustom (migrasi 0073).** Pengaturan › **Field Kustom** (hak `customization.manage`) menambah kolom sendiri ke
kontak, produk, karyawan, kendaraan, lead, pesanan penjualan & pembelian, faktur/tagihan/jurnal, transfer stok, dan
order produksi. Tipe: teks, teks panjang, angka, nominal, tanggal, ya/tidak, pilihan, pilihan ganda, URL, email, dan
rujukan (kontak/produk/karyawan/pengguna); bisa wajib, punya nilai bawaan, teks bantuan, dikelompokkan per bagian, dan
berlaku untuk semua atau satu perusahaan. Field tampil di form, bisa menjadi kolom daftar (ikut cari/filter/sort),
ikut ekspor/impor CSV/Excel master (kolom `custom.<kunci>`), dan dicetak di PDF penawaran/pesanan. Nilainya tetap bisa
diubah di dokumen yang sudah dikonfirmasi/diposting (`PATCH /custom-values/:model/:id`). Wajib hanya dipaksa untuk isian
lewat form/impor/API yang mengirim `custom`; dokumen buatan sistem memakai nilai bawaan. Menghapus field ikut menghapus
nilainya; untuk menyembunyikan saja, nonaktifkan.

**Laporan & Dashboard (migrasi 0074).** Aplikasi baru **Laporan & Dashboard** (`/bi`):

- **Pembuat Laporan** (dipindah dari SDM/Payroll ke `/bi/reports`) kini mencakup semua modul: pesanan & baris
  penjualan, lead CRM, faktur/tagihan (umur piutang/utang), item jurnal (laba rugi per akun, cost/profit center),
  pesanan & baris pembelian, stok per lokasi (nilai, di bawah minimum), pergerakan stok, order produksi, riwayat biaya
  gaji, plus dataset SDM/Payroll yang sudah ada. Setiap dataset punya kolom **bulan** untuk tren dan ikut memuat
  **field kustom**; hak baca mengikuti permission modul. Simpan, ekspor, dan jadwal email berlaku untuk semua dataset.
- **Dashboard bawaan**: Penjualan & CRM, Keuangan, Persediaan & Pembelian, SDM & Produksi — KPI dengan perbandingan
  periode sebelumnya, grafik, dan tabel; widget yang datanya tidak boleh dilihat pengguna disembunyikan.
- **Dashboard kustom**: tambah widget dari laporan tersimpan atau atur cepat (data → kelompok → hitung → tampilan),
  atur lebar & urutan, pilih periode (bulan ini … 12 bulan terakhir, rentang kustom), bagikan ke perusahaan, duplikat
  dashboard bawaan, dan **sematkan ke Beranda** (angka KPI tampil di Beranda).

**Aturan otomatis (migrasi 0075).** Pengaturan › **Aturan Otomatis** (hak `customization.manage`) menjalankan aksi
tanpa kode untuk 10 jenis data yang sama dengan field kustom (kontak, produk, karyawan, kendaraan, lead, SO, PO,
faktur/jurnal, transfer stok, order produksi). Editor bertahap:

1. **Kapan** — data dibuat; data diubah (opsional "hanya saat syarat baru terpenuhi", mis. status berubah menjadi
   Pesanan); berdasarkan tanggal (kolom tanggal ± N hari, mis. 3 hari sebelum jatuh tempo; sekali per data); terjadwal
   (harian/mingguan/bulanan pada jam tertentu).
2. **Jika** — syarat per kolom (sama dengan, lebih dari, berisi, salah satu dari, kosong, …), termasuk field kustom.
3. **Lakukan** — notifikasi (pengguna, peran, penanggung jawab, pembuat) & email (kontak data atau alamat tertentu)
   dengan isian `{{kolom}}`, `{{link}}`, `{{rule}}`; ubah field kustom / penanggung jawab; buat aktivitas; ajukan
   permintaan persetujuan (kategori + nominal dari kolom); panggil **webhook** (POST JSON, header
   `X-ERP-Signature: t=<unix>,v1=HMAC-SHA256(rahasia, t + "." + body)`, rahasia tampil sekali).

Perubahan data dicatat trigger database ke antrean dan diproses job setiap 30 detik (`AUTOMATION_SCHEDULER=off` untuk
mematikan), dengan hak pemilik aturan (pengubah terakhir). Tiap aksi berjalan terpisah: aksi yang gagal dibatalkan
tanpa menggagalkan aksi lain. Perubahan oleh aturan bisa memicu aturan lain maksimal 3 tingkat (mencegah perulangan).
Tombol **Jalankan sekarang** menguji aturan pada satu data (atau semua data untuk pemicu tanggal/jadwal), dan **log
eksekusi** mencatat status serta hasil setiap aksi.

**Maintenance aset (migrasi 0076).** Aplikasi baru **Maintenance** (hak `maintenance.read|write|manage`, peran
templat Manajer Maintenance & Teknisi):

- **Peralatan** (mesin, alat, gedung; bisa terhubung aset tetap, stasiun kerja, cost center, cabang/unit bisnis),
  meter pemakaian (jam/km/siklus, tidak boleh mundur), status Beroperasi/Rusak/Tidak dipakai, riwayat perawatan.
- **Rencana perawatan** preventif per N hari dan/atau per N meter, dengan toleransi hari dan checklist tugas. Job harian
  (`MAINTENANCE_SCHEDULER=off` untuk mematikan) membuat permintaan preventif sekali per siklus dan memberi tahu tim;
  tombol **Buat dari rencana jatuh tempo** menjalankannya sekarang.
- **Permintaan perawatan** (preventif/korektif): jadwal, tim & teknisi, prioritas, Mulai → Selesai, checklist, catatan
  hasil, jam kerja. Karyawan melapor kerusakan dari **Portal Saya** (mesin otomatis Rusak, downtime dihitung sejak
  laporan, pelapor diberi tahu saat selesai).
- **Biaya**: suku cadang dikeluarkan dari stok saat selesai (nilai FIFO/rata-rata, jurnal Dr beban perawatan + cost
  center peralatan / Cr persediaan), jasa vendor → **tagihan vendor** draft sekali, plus biaya tenaga kerja internal.
  Akun beban bawaan 6-8000 Beban Pemeliharaan dan Perbaikan (dibuat otomatis) dan lokasi suku cadang diatur di
  Maintenance › Pengaturan.
- **Laporan Keandalan & Biaya**: kerusakan, downtime, MTBF, MTTR, ketersediaan, kepatuhan preventif tepat waktu, dan
  biaya (suku cadang, jasa, tenaga kerja) per peralatan. Peralatan & permintaan mendukung field kustom dan aturan
  otomatis.

**Inspeksi mutu / QM (migrasi 0077).** Aplikasi baru **Mutu** (hak `quality.read|write|manage`, templat peran
Pemeriksa Mutu):

- **Titik kontrol**: periksa saat **penerimaan dari pemasok** atau saat **hasil produksi** selesai, untuk produk,
  kategori, dan/atau pemasok tertentu (yang paling spesifik dipakai). Sampel semua / persen / jumlah tetap. Butir
  pemeriksaan lulus/gagal atau **ukur** dengan batas min–maks + satuan, bisa **wajib foto**, plus instruksi.
- Barang yang terkena titik kontrol otomatis dipindah ke lokasi **Karantina** gudang (dibuat otomatis) dan tidak ikut
  dicadangkan sampai diputuskan. Panel pemeriksaan tampil di transfer penerimaan & order produksi.
- **Keputusan**: **terima** (semua butir lulus) atau **terima bersyarat** → pindah ke gudang; **retur ke pemasok** →
  transfer retur dibuat & divalidasi otomatis (alur nota kredit pembelian berlaku bila sudah ditagih); **scrap** →
  barang keluar dengan jurnal ke akun selisih persediaan. Keputusan selain terima membuat **NCR** (ketidaksesuaian)
  berisi butir yang gagal; NCR mencatat akar masalah, tindakan perbaikan, penanggung jawab, dan hanya bisa ditutup bila
  tindakan perbaikan terisi.
- **Laporan mutu**: jumlah pemeriksaan, lulus/gagal/bersyarat, dan **tingkat cacat** per pemasok & per produk.

### Layanan Pelanggan (Helpdesk, CRM bagian 4)

Aplikasi **Layanan** (migrasi 0081): tiket dengan nomor urut, antrean (tim agen) dan pembagian bergiliran, kebijakan
SLA per prioritas (respons pertama & penyelesaian; tanpa kebijakan berlaku target bawaan), pelanggaran ditandai dan
dieskalasikan ke agen & pemimpin antrean oleh job tiap 5 menit, tiket selesai ditutup otomatis. Balasan agen dikirim
ke email pelanggan; catatan internal tidak terlihat pelanggan. Tiket juga masuk dari **portal pelanggan** (buat, balas,
nilai kepuasan) dan **email masuk** (webhook `POST /public/support/inbound/<kunci>` berisi `{from, subject, text}`;
balasan dengan nomor tiket di subjek masuk ke tiket itu). Basis pengetahuan tampil di portal (menu Bantuan). Laporan:
waktu respons/penyelesaian, kepatuhan SLA, kepuasan per agen/antrean/kategori; tiket tampil di Akun 360°.

| Endpoint                                                                                     | Keterangan                                          |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET/POST /support/tickets`, `GET/PATCH /support/tickets/:id`, `POST …/:id/messages`         | Tiket; balasan publik (email) atau catatan internal |
| `/support/teams`, `/support/sla-policies`, `/support/articles`                               | Antrean, kebijakan SLA, basis pengetahuan           |
| `GET/PUT /support/settings`, `POST /support/settings/inbound-key`, `GET /support/reports`    | Pengaturan, kunci webhook email masuk, laporan      |
| `GET/POST /portal/tickets`, `POST /portal/tickets/:id/{messages,rating}`, `/portal/articles` | Portal pelanggan: tiket & bantuan                   |

### CRM & Penjualan (Fase 2)

CRM memisahkan **Lead** (status baru → dihubungi → terkualifikasi/tidak layak) dari **Peluang**. Konversi lead membuat
akun (perusahaan), kontak di bawah akun itu, dan peluang dengan kontak utama; riwayat tahap dicatat otomatis. Menu:
CRM › Lead, Peluang, Akun, Kontak, Corong & Kecepatan (migrasi 0078).

**Forecast, kuota & wilayah** (migrasi 0079): tiap tahap punya kategori forecast (pipeline / best case / commit) yang
bisa ditimpa per peluang. Forecast satu bulan atau kuartal = peluang menang pada periode itu (closed) + peluang terbuka
yang perkiraan closing-nya di periode itu, dibandingkan kuota bulanan. Pemimpin tim atau pengelola CRM dapat mengisi
forecast manajer per salesperson. Wilayah mencocokkan lead dan akun dari provinsi, kota, atau industri; lead tanpa
penanggung jawab dibagi bergiliran ke anggota wilayah.

**Marketing** (migrasi 0080): kampanye dengan anggota (lead, kontak, atau segmen lead), email massal dengan tautan
berhenti langganan, serta hasil per kampanye (lead, peluang, nilai menang, ROI, biaya per lead). Formulir web-to-lead
punya halaman siap pakai (`/f/<kunci>`) dan cuplikan HTML untuk situs lain; kiriman menjadi lead dengan kampanye,
wilayah, skor, dan penanggung jawab otomatis (honeypot + batas laju, email yang sama tidak menggandakan lead). Skor
lead 0–100 dihitung dari aturan syarat → poin; aturan penugasan membagi lead tanpa penanggung jawab secara bergiliran.

| Endpoint                                                                                        | Keterangan                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/crm-stages`, `/lost-reasons`, `/sales-teams`, `/payment-terms`, `/pricelists`                 | Konfigurasi (tahap pipeline, alasan kalah, tim, termin, daftar harga + aturan) |
| `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`                                                | Lead & peluang; filter `leadType`, `state=open,won`, `stageId`, `userId=me`    |
| `POST /leads/:id/{convert,won,lost,reopen}`, `GET /leads/pipeline?from=&to=`                    | Konversi ke peluang/pelanggan, menang/kalah, buka kembali, ringkasan pipeline  |
| `GET /leads/:id/duplicates`, `POST /leads/:id/merge`                                            | Kemungkinan duplikat (email/telepon/nama perusahaan) di lead & partner; gabung |
| `PUT /leads/:id/products`, `PUT /leads/:id/contact-roles`                                       | Produk peluang (nilai harapan = total) dan peran kontak (satu kontak utama)    |
| `GET /leads/reports/funnel`, `GET /leads/reports/velocity` (`from`, `to`)                       | Corong lead → peluang → menang; lama per tahap, siklus penjualan, win rate     |
| `GET /crm/accounts?kind=company\|person`, `GET /crm/accounts/:id`                               | Akun & kontak; tampilan 360° (peluang, pesanan, faktur sesuai hak, aktivitas)  |
| `GET /crm/forecast?period=YYYY-MM\|YYYY-Qn`, `PUT /crm/forecast/adjustments`                    | Forecast per salesperson/tim vs kuota (closed, commit, best case, pipeline)    |
| `GET/PUT /crm/quotas?year=`, `GET /crm/forecast/attainment?year=`                               | Kuota bulanan per salesperson/tim; pencapaian setahun                          |
| `/crm/territories`, `POST /crm/territory-assign`, `GET /crm/territory-report`                   | Wilayah (aturan provinsi/kota/industri, anggota), penerapan & ringkasan        |
| `/crm/campaigns`, `GET /crm/campaign-stats[/:id]`, `POST /crm/campaigns/:id/{members,emails}`   | Kampanye: anggota (lead/kontak/segmen), email massal, hasil & ROI              |
| `/crm/scoring-rules`, `/crm/assignment-rules`, `POST /crm/{scoring-recompute,assignment-apply}` | Skor lead 0–100 dari aturan; penugasan lead bergiliran                         |
| `/crm/web-forms`, `GET/POST /public/web-forms/:key`, `GET /public/crm/unsubscribe/:token`       | Formulir web-to-lead publik (JSON atau form HTML); berhenti langganan email    |
| `POST /sale-orders/from-lead/:leadId`                                                           | Penawaran draft berisi produk peluang                                          |
| `GET/POST /activities`, `GET /activities/mine`, `PATCH/DELETE /activities/:id`, `POST …/done`   | Aktivitas terjadwal pada lead, pesanan, atau kontak                            |
| `GET/POST /sale-orders`, `GET/PUT/DELETE /sale-orders/:id`, `POST /sale-orders/compute`         | Penawaran/pesanan; `compute` = pratinjau harga daftar harga, pajak, total      |
| `POST /sale-orders/:id/{send,confirm,cancel,draft}`, `GET /sale-orders/:id/pdf`                 | Kirim email (PDF terlampir), konfirmasi, batal, kembali ke draft, unduh PDF    |
| `POST /sale-orders/:id/invoice` (`method`: `regular` / `percentage` / `fixed`)                  | Draft faktur dari pesanan (sisa kuantitas atau uang muka)                      |
| `GET /sale-orders/report?from=&to=&groupBy=product\|partner\|salesperson\|month`                | Analisis penjualan pesanan terkonfirmasi                                       |
| `GET /users/options`                                                                            | Pilihan user aktif perusahaan aktif (penanggung jawab, penjual)                |
| `/commission-plans`, `GET /sales/commissions[/export]?dateFrom=&dateTo=`                        | Aturan komisi (penjual → tim → bawaan; dasar faktur/lunas), laporan & Excel    |
| `/product-attributes`, `/product-attribute-values`, `GET/POST /products/:id/variants`           | Varian produk: atribut & nilai (kode SKU, tambahan harga), buat kombinasi      |
| `GET /partners/:id/portal`, `POST /partners/:id/{portal-invite,portal-revoke}`                  | Akses portal pelanggan: undang (email + tautan), cabut                         |

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

| Endpoint                                                                                                                                                     | Keterangan                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/employees`, `/departments`, `/job-positions`, `/public-holidays`, `/leave-types`, `/leave-allocations`, `/overtimes`                                       | Data karyawan (NIK/NPWP/rekening terenkripsi), struktur, hari libur, cuti, lembur                                                                                                                                                                                                             |
| `GET/POST /contracts`, `GET/PUT/DELETE /contracts/:id`, `POST /contracts/:id/{start,close,cancel-exit}`                                                      | Kontrak PKWT/PKWTT dengan tunjangan & potongan bulanan; `close {exit, resignReason}` = karyawan keluar (0051)                                                                                                                                                                                 |
| `GET/POST /leaves`, `GET /leaves/balances?employeeId=`, `POST /leaves/:id/{approve,refuse,cancel}`                                                           | Pengajuan cuti (hari kerja di luar libur), saldo jatah                                                                                                                                                                                                                                        |
| `/work-calendar/{holidays,holidays/import-national,leave-days}`, `POST /me/leave-days`                                                                       | Kalender kerja (0047): libur per perusahaan, impor libur nasional, pratinjau hari cuti                                                                                                                                                                                                        |
| `POST /attendance/{check-in,check-out}`, `GET/POST /attendance`                                                                                              | Absensi dari portal, rekap & koreksi manual                                                                                                                                                                                                                                                   |
| `GET /me/{employee,attendance,leaves,leave-types,payslips}`                                                                                                  | Portal karyawan (user yang terhubung ke data karyawan)                                                                                                                                                                                                                                        |
| `/salary-components`, `GET/PUT /payroll/settings`                                                                                                            | Komponen gaji, tarif JKK, batas upah BPJS, akun & jurnal gaji                                                                                                                                                                                                                                 |
| `GET/POST /payroll-parameters`, `PUT/DELETE /payroll-parameters/:id`                                                                                         | Batas upah BPJS Kesehatan/JP & tarif JKK **per tanggal berlaku**: run memakai nilai pada awal periodenya (hitung ulang bulan lama tetap memakai nilai lama)                                                                                                                                   |
| `GET/POST /payroll-runs`, `GET /payroll-runs/:id`, `POST /payroll-runs/:id/{compute,post,pay,cancel}`                                                        | Payroll bulanan: hitung, posting jurnal, bayar gaji bersih                                                                                                                                                                                                                                    |
| `GET /payroll-runs/:id/{bank-transfer,recap}?format=csv`                                                                                                     | File transfer bank, rekap PPh 21 & BPJS (NIK/NPWP)                                                                                                                                                                                                                                            |
| `GET /payslips/:id`, `PUT /payslips/:id/inputs`, `GET /payslips/:id/pdf`                                                                                     | Slip gaji, input THR/bonus/potongan, PDF                                                                                                                                                                                                                                                      |
| `/work-schedules`, `/shift-assignments`, `GET /attendance/lateness?from=&to=&employeeId=`                                                                    | Jadwal kerja & shift, toleransi & potongan keterlambatan (otomatis di slip)                                                                                                                                                                                                                   |
| `GET /approvals/pending`, `GET /approvals/:model/:id`, `POST /approvals/overtime/:id/{approve,refuse}`                                                       | Persetujuan berjenjang cuti, lembur, klaim + permintaan generik (kotak gabungan)                                                                                                                                                                                                              |
| `POST /overtimes/from-attendance`, `POST /approvals/overtime/:id/approve {hours}`                                                                            | Lembur dari absensi (0048); atasan boleh mengurangi jam saat menyetujui                                                                                                                                                                                                                       |
| `GET/POST /employee-loans`, `GET /employee-loans/:id`, `POST /employee-loans/:id/{disburse,cancel}`                                                          | Pinjaman karyawan: cair via kas/bank, cicilan otomatis di slip sampai lunas                                                                                                                                                                                                                   |
| `/work-entries`                                                                                                                                              | Hasil kerja pekerja borongan (terkunci setelah payroll diposting)                                                                                                                                                                                                                             |
| `GET/POST /employees/:id/severances`, `POST /employees/:id/severance/preview`                                                                                | Pesangon, UPMK, UPH, uang pisah/kompensasi PKWT (PP 35/2021) + PPh 21 final                                                                                                                                                                                                                   |
| `/salary-grades`, `GET /hr/wage-scale`, `GET /salary-grades/:id/base-wage-impact`, `POST /salary-grades/:id/apply-base-wage`                                 | Struktur & skala upah (PP 36/2021): golongan di karyawan atau jabatan, **gaji pokok standar per golongan** (terisi otomatis di kontrak, tetap bisa diubah — ditandai "Disesuaikan"), terapkan gaji pokok baru ke kontrak berjalan (kontrak upah baru + rapel), upah di luar rentang           |
| `POST /payroll-runs/:id/{thr,retro}`                                                                                                                         | THR otomatis (Permenaker 6/2016) & rapel kenaikan upah berlaku mundur                                                                                                                                                                                                                         |
| `GET /payroll-runs/:id/bank-transfer?format=csv\|bca\|mandiri\|bri\|bni`, `GET …/bank-transfer/summary`                                                      | File transfer gaji massal per bank (rekening bank itu saja) + ringkasan per bank                                                                                                                                                                                                              |
| `GET /payroll-runs/:id/recap?format=csv\|edabu\|sipp`                                                                                                        | Rekap PPh 21 & BPJS, unggah BPJS Kesehatan (e-Dabu) & Ketenagakerjaan (SIPP)                                                                                                                                                                                                                  |
| `POST /payroll-runs/:id/email-payslips`                                                                                                                      | Kirim slip PDF berkata sandi (tanggal lahir DDMMYYYY) ke email kerja                                                                                                                                                                                                                          |
| `GET /payroll/reports/cost?from=YYYY-MM&to=YYYY-MM&groupBy=department\|branch\|month`                                                                        | Biaya tenaga kerja (pendapatan + BPJS perusahaan) dari payroll terposting                                                                                                                                                                                                                     |
| `/expense-categories`, `GET/POST /expense-claims`, `GET/PUT/DELETE /expense-claims/:id`, `POST /expense-claims/:id/{submit,approve,refuse,cancel,pay}`       | Klaim biaya: plafon tahunan per kategori, persetujuan berjenjang, bayar via slip/kas-bank, bukti PDF/JPG/PNG                                                                                                                                                                                  |
| `GET /employee-change-requests`, `POST /employee-change-requests/:id/{approve,refuse}`                                                                       | Perubahan data pribadi dari portal, disetujui HR lalu diterapkan                                                                                                                                                                                                                              |
| `GET /me/{expense-categories,overtimes,loans,change-requests,withholding-slips}`, `POST /me/{overtimes,change-requests}`, `GET /expense-claims?mine=1`       | Portal karyawan: lembur, klaim, pinjaman, perubahan data, bukti potong A1                                                                                                                                                                                                                     |
| `/job-openings`, `GET/POST /applicants`, `GET/PUT/DELETE /applicants/:id`, `POST /applicants/:id/{stage,interviews,hire}`                                    | Rekrutmen: lowongan, kanban pelamar, wawancara (skor), terima → karyawan + kontrak draft + onboarding                                                                                                                                                                                         |
| `GET/POST /hr-documents`, `GET /hr-documents/:id/file`, `GET /hr-documents/expiring`, `GET /hr/reminders`                                                    | Dokumen karyawan/pelamar (PDF/JPG/PNG ≤ 5 MB) & pengingat kedaluwarsa, kontrak PKWT berakhir                                                                                                                                                                                                  |
| `/hr-checklist-templates`, `GET/POST /hr-checklists`, `POST /hr-checklists/tasks/:taskId`, `GET /me/checklist-tasks`                                         | Checklist onboarding/offboarding (otomatis saat karyawan baru/tanggal keluar diisi)                                                                                                                                                                                                           |
| `/appraisal-templates`, `GET/POST /appraisal-cycles`, `POST /appraisal-cycles/:id/{start,close}`                                                             | Penilaian kinerja: template KPI berbobot per jabatan, siklus, formulir per karyawan                                                                                                                                                                                                           |
| `GET /appraisals`, `PUT /appraisals/:id/{self,manager}`, `POST /appraisals/:id/calibrate`, `GET /me/appraisals`                                              | Penilaian diri → atasan → kalibrasi HR (skor akhir, predikat A–E, usulan kenaikan upah)                                                                                                                                                                                                       |
| `/trainings`, `POST /trainings/:id/participants`, `PUT /trainings/:id/participants/:pid`                                                                     | Pelatihan & sertifikasi; sertifikat menjadi dokumen karyawan dengan masa berlaku                                                                                                                                                                                                              |
| `GET /employees/:id/history`, `GET /hr/org-chart`, `GET /hr/dashboard?year=`                                                                                 | Riwayat karir otomatis, struktur organisasi, dashboard SDM (headcount, turnover, cuti, biaya)                                                                                                                                                                                                 |
| `GET/PUT/DELETE /employees/:id/photo`, `GET/PUT /me/photo`                                                                                                   | Foto karyawan (JPG/PNG/WebP ≤ 1 MB, diperkecil di browser)                                                                                                                                                                                                                                    |
| `GET /employees/:id/overview`, `POST /employees/:id/invite`, `employees.tags`                                                                                | Form karyawan: statistik (penilaian, sasaran, jam bulan ini), kontrak berjalan & tunjangan tetap, status akun portal; undang karyawan ke portal (akun otomatis tertaut); tag bebas yang bisa dicari                                                                                           |
| `/employees/:id/{family,education,experiences}`, `GET /employees/:id/profile-summary`                                                                        | Data keluarga (NIK terenkripsi), riwayat pendidikan, pengalaman kerja, kelengkapan profil & saran PTKP                                                                                                                                                                                        |
| `GET/POST /employee-movements`, `POST /employee-movements/:id/{apply,cancel}`                                                                                | Promosi/demosi/mutasi/rotasi dengan SK: perbarui jabatan/departemen/cabang/atasan/golongan & kontrak upah baru                                                                                                                                                                                |
| `GET/POST /employee-warnings`, `GET /me/profile`                                                                                                             | Surat peringatan SP1–SP3 (berlaku 6 bulan, masuk pengingat HR); profil sendiri di portal                                                                                                                                                                                                      |
| `GET /data-transfer`, `GET /data-transfer/:key/{columns,template,export}`, `POST /data-transfer/:key/import`                                                 | Impor & ekspor Excel/CSV HR & Payroll: karyawan, kontrak, keluarga, pendidikan, absensi, jatah cuti, lembur, cuti, input slip, rekap slip; kolom ekspor dipilih user, pratinjau impor                                                                                                         |
| `GET/POST/DELETE /data-transfer/:key/presets`                                                                                                                | Profil ekspor (kolom & filter tersimpan; pribadi atau bersama)                                                                                                                                                                                                                                |
| `GET/POST/PUT/DELETE /approval-categories`, `GET/POST /approval-requests`, `GET/PUT/DELETE /approval-requests/:id`                                           | Persetujuan generik: kategori (field wajib/opsional, penyetuju berurutan/paralel, batas nominal DoA), nomor otomatis                                                                                                                                                                          |
| `POST /approval-requests/:id/{submit,cancel,approve,refuse}`, `GET /approval-requests?mine=1\|review=1`, `GET …/summary`                                     | Ajukan, putuskan per tahap (atasan → penyetuju kategori, fallback HR), permintaan saya & yang perlu ditinjau                                                                                                                                                                                  |
| `GET/POST/DELETE /approval-delegations`                                                                                                                      | Delegasi penyetuju bertanggal; berlaku untuk permintaan, cuti, lembur, dan klaim                                                                                                                                                                                                              |
| `/leave-accrual-plans`, `POST /leave-accrual-plans/:id/{assign,run,carry-over}`                                                                              | Akrual cuti per bulan/tahun (mulai setelah masa kerja, saldo maks.) + carry-over berbatas & berkedaluwarsa                                                                                                                                                                                    |
| `GET /leaves/{balance-report,ledger,bulk,compensable-overtimes}`, `POST /leaves/bulk`, `/leave-block-dates`                                                  | Saldo & buku besar cuti (FIFO), cuti massal/cuti bersama, tanggal blok cuti, lembur → cuti pengganti                                                                                                                                                                                          |
| `POST /overtimes/:id/compensate`, `GET /leaves/:id/attachment`, `GET /me/colleagues`                                                                         | Cuti pengganti (lembur tidak dibayar lagi), lampiran cuti, rekan untuk delegasi tugas                                                                                                                                                                                                         |
| `/work-locations`, `PUT /employees/:id/attendance-pin`, `PUT /me/attendance-pin`                                                                             | Lokasi kerja (geofence radius), PIN kiosk karyawan                                                                                                                                                                                                                                            |
| `POST /attendance/{validate,kiosk,auto-checkout}`, `GET /attendance/{summary,today,:id/photo}`, `GET /me/attendance-summary`                                 | Validasi absensi, kiosk badge + PIN, auto-checkout, rekap bulanan per status, dashboard hari ini, foto                                                                                                                                                                                        |
| `/attendance-devices`, `POST /attendance-devices/:id/rotate-key`, `POST /attendance-devices/push` (header `X-Device-Key`)                                    | Mesin absensi (ZKTeco/Hikvision): kunci per mesin, kirim log idempoten                                                                                                                                                                                                                        |
| `/attendance-requests`, `/shift-requests`, `POST …/:id/{approve,refuse,cancel}`, `GET /me/work-schedules`                                                    | Koreksi absensi (lupa absen/dinas luar/WFH) & tukar shift dengan persetujuan berjenjang                                                                                                                                                                                                       |
| `POST /payroll-runs/:id/corrections`, `GET /payroll-runs/:id/warnings`                                                                                       | Payroll koreksi (off-cycle, PPh 21 atas bruto gabungan masa) & peringatan sebelum posting/transfer                                                                                                                                                                                            |
| `POST /payslips/:id/{hold,unhold,release}`                                                                                                                   | Penahanan gaji per slip (tidak ikut transfer/pembayaran), dilepas dengan pembayaran terpisah                                                                                                                                                                                                  |
| `POST /job-openings/from-fpk/:id`, `/refuse-reasons`, `GET /recruitment/reports?from=&to=`                                                                   | FPK disetujui → lowongan, master alasan penolakan, laporan time-to-fill/time-to-hire, funnel, sumber                                                                                                                                                                                          |
| `/hiring-requests`, `POST /manpower-plan-lines/:id/hiring-request`, `POST /applicants/:id/cancel-hire`                                                       | FPK & alur penambahan karyawan (0049)                                                                                                                                                                                                                                                         |
| `GET/POST /contract-types`, `GET/PUT/DELETE /contract-types/:id`                                                                                             | Master jenis kontrak (PKWT, PKWTT, harian lepas, magang, mitra, …): aturan waktu tertentu & batas masa kontrak (0053)                                                                                                                                                                         |
| `/contract-templates[/placeholders]`, `POST /contract-templates/preview`, `GET/PUT /contracts/:id/document`                                                  | Template kontrak berplaceholder (data karyawan & kontrak terisi otomatis), isi dokumen per kontrak (0050)                                                                                                                                                                                     |
| `GET /contracts/:id/pdf?mode=print\|esign\|signed`, `GET/POST /contracts/:id/signed-file`                                                                    | PDF cetak (TTD basah + meterai), e-sign layanan luar (kolom tanda tangan), bertanda tangan; unggah hasil TTD                                                                                                                                                                                  |
| `POST /contracts/:id/{request-signature,sign}`, `/me/contracts`, `GET /public/contracts/verify/:code`                                                        | Tanda tangan digital di aplikasi (HR & karyawan via portal), jejak audit, verifikasi publik kode dokumen                                                                                                                                                                                      |
| `/offer-templates`, `GET/POST /applicants/:id/offers`, `POST /job-offers/:id/{send,accept,decline,cancel}`, `GET …/pdf`                                      | Surat penawaran kerja dari template (placeholder), jawaban pelamar, PDF; hire memakai nilai penawaran                                                                                                                                                                                         |
| `POST /employees/:id/offboard`, `GET/PUT /employees/:id/exit-interview`, `GET /employees/:id/final-settlement[/pdf]`, `GET /hr/reports/exit-reasons`         | Offboarding: alasan keluar + checklist, exit interview, Full & Final Statement, laporan alasan keluar                                                                                                                                                                                         |
| `/goals` (pohon + progres), `GET /me/goals`, `GET/POST /goals/:id/checkins`                                                                                  | Sasaran & KRA bertingkat (perusahaan → departemen → karyawan), progres induk = rata-rata berbobot turunan, check-in                                                                                                                                                                           |
| `POST/GET /feedback-requests`, `GET /me/feedback-requests`, `PUT /feedback-requests/:id`, `POST …/decline`, `GET /employees/:id/feedback-summary`            | Feedback 360 per kompetensi; ringkasan anonim (relasi < 2 respons digabung)                                                                                                                                                                                                                   |
| `GET/POST /employees/:id/notes`, `DELETE /employee-notes/:id`                                                                                                | Catatan atasan/HR (privat atau HR), tidak pernah terlihat oleh karyawan                                                                                                                                                                                                                       |
| `/announcements`, `GET /me/announcements`, `POST /me/announcements/:id/read`, `GET /me/whos-off`                                                             | Pengumuman (semua/departemen, pin, terbit, kedaluwarsa, tanda dibaca) & Siapa yang Cuti                                                                                                                                                                                                       |
| `GET /me/notifications[?unread]`, `GET …/count`, `POST …/:id/read`, `POST …/read-all`                                                                        | Notifikasi in-app (lonceng) **dan email** (outbox dikirim tiap menit setelah transaksi; tahap yang diputuskan HR memberi tahu pemegang `hr.manage`): pengajuan & keputusan cuti/persetujuan, permintaan feedback, penilaian diri                                                              |
| `GET/PUT /me/notification-settings`                                                                                                                          | Preferensi pengguna: kirim notifikasi juga lewat email (sakelar di lonceng)                                                                                                                                                                                                                   |
| `POST /payroll-runs/:id/submit-approval`, `POST /employee-movements/:id/submit-approval`, `POST /job-offers/:id/submit-approval`                             | Persetujuan opsional per perusahaan (Pengaturan Payroll › Persetujuan dokumen) sebelum payroll diposting, mutasi diterapkan, penawaran dikirim; kategori PAYROLL/MUTASI/PENAWARAN otomatis, mengikuti Aturan Persetujuan; dokumen diubah/dihitung ulang setelah diajukan → wajib ajukan ulang |
| `POST /contracts/:id/probation`, `GET /hr/probations[?state=all]`, `GET /contracts/:id/appointment-letter`                                                   | Masa percobaan PKWTT (1–3 bulan, PKWT ditolak — UU 13/2003 ps. 58 & PP 35/2021): tanggal akhir dihitung dari mulai kontrak, muncul di Pengingat HR & email harian; evaluasi lulus/tidak lulus (tidak lulus → Akhiri kontrak), surat pengangkatan PDF                                          |
| `POST /applicants/:id/anonymize`, `GET /personal-data-access-logs`                                                                                           | UU PDP: persetujuan pelamar wajib saat input (waktu & sumber dicatat), retensi pelamar ditolak/lowongan tutup (bulan, Pengaturan Payroll) → anonimisasi otomatis harian; log akses data pribadi (NIK, NPWP, rekening, gaji) dari detail karyawan, slip & ekspor                               |
| `GET/PUT /me/payslip-pin`, `POST /me/payslip-pin/verify`, `POST /employees/:id/payslip-pin/reset`                                                            | PIN slip gaji 6 digit (opsional per perusahaan): wajib sebelum membuka slip di portal (terbuka 15 menit), 5 kali salah → terkunci 15 menit, HR dapat mereset                                                                                                                                  |
| `GET /permissions/catalog`, `/roles` (CRUD, `role.manage`)                                                                                                   | Katalog modul → fitur → aksi (lihat/ekspor/ubah/hapus/kelola) + templat peran; peran kustom dengan matriks hak; fitur data sensitif **Gaji & kompensasi** dan **Data pribadi** (`hr.salary.*`, `hr.personal.*`) tidak ikut hak lihat/ubah SDM                                                 |
| `GET/PATCH /users/:id`, `PUT /users/:id/roles`, `PUT /users/:id/overrides`, `GET /users/:id/access[-log]`, `POST /users/:id/{deactivate,activate,reset-2fa}` | Peran per perusahaan, tambah/cabut hak per akun, hak efektif + sumbernya, riwayat akses; admin terdelegasi hanya memberi hak yang ia miliki                                                                                                                                                   |
| `GET /approval-rules`, `PUT /approval-rules/:docType`, `GET /approval-limits`, `PUT /approval-limits/:docType`, `POST /approval-rules/simulate`              | Aturan persetujuan per jenis dokumen (atasan, atasan ke-2, kepala departemen, pengguna, peran, admin; berlaku bila nilai ≥ batas) & batas wewenang per pengguna/peran (`approval.manage`)                                                                                                     |
| `GET /users/:id/approvals`, `GET /roles/:id/approvals`, `GET /roles/options`                                                                                 | Ringkasan batas wewenang & tahap di mana pengguna/peran menjadi penyetuju; pilihan peran untuk penyetuju kategori                                                                                                                                                                             |
| `/fleet-vehicles`, `/fleet-models`, `/fleet-manufacturers`, `/fleet-service-types`, `GET /fleet/vehicles/:id/overview`, `POST …/driver`                      | Armada: kendaraan (nopol, STNK/pajak/BPKB/KIR, nilai, cabang analitik), satu pengemudi aktif + riwayat                                                                                                                                                                                        |
| `GET/POST /fleet/vehicles/:id/odometers`, `GET /me/vehicles`, `POST /me/vehicles/:id/odometers`                                                              | Log odometer (tidak boleh mundur), dicatat HR armada atau pengemudi dari portal                                                                                                                                                                                                               |
| `/fleet-contracts`, `POST /fleet/contracts/:id/{close,renew}`, `/fleet-services`, `POST /fleet/services/:id/bill`                                            | Kontrak sewa/asuransi (biaya awal + berulang, kedaluwarsa otomatis, perpanjangan); servis → tagihan vendor draft                                                                                                                                                                              |
| `GET /fleet/reports/{costs,odometer}`, `GET /fleet/reminders`, `GET/PUT /fleet/settings`                                                                     | Biaya per kendaraan/kategori/bulan, tren odometer, pengingat dokumen/kontrak (notifikasi in-app harian)                                                                                                                                                                                       |
| Kontrak `taxMethod: gross \| gross_up`                                                                                                                       | Gross-up PPh 21 (tunjangan PPh 21 = pajaknya; ikut BPA1), saldo cuti di slip & PDF                                                                                                                                                                                                            |

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
dipotong; bukti potong A1/BPMP hanya pegawai tetap, pegawai tidak tetap & bukan pegawai lewat BP21), hak THR, dan hak saat berakhir (pesangon, uang kompensasi PKWT, atau tidak ada). Hak upah lembur diatur **per karyawan** (centang "Berhak upah lembur" di tab Penggajian karyawan; bila tidak, lembur
ditolak, tidak dibuat dari absensi, dan tidak dibayar). Bawaan: magang hanya JKK+JKM tanpa THR,
mitra tanpa BPJS dengan PPh 21 bukan pegawai. SDM › Konfigurasi › **Usia Pensiun** (0056): kebijakan per perusahaan — usia pensiun bawaan, tanggal pensiun
(tepat ulang tahun / akhir bulan ulang tahun / awal bulan berikutnya), pengingat N bulan sebelumnya, dan pengecualian
per jabatan, golongan, atau departemen; usia khusus per karyawan di tab Kerja (urutan: karyawan → jabatan → golongan →
departemen → bawaan). Tanggal pensiun tampil di tab Penggajian karyawan, daftar "Akan pensiun" & Pengingat HR (juga
email harian); kontrak tidak bisa mulai/berakhir setelah tanggal pensiun; dialog Akhiri kontrak punya pintasan
"Pensiun" (tanggal & alasan terisi). SDM › Konfigurasi › **Template Kontrak**: isi kontrak dengan placeholder (`{nama}`, `{nik}`, `{jabatan}`,
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

| Endpoint                                                                                                                                                          | Keterangan                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tax-invoices?year=&month=&state=`, `POST /tax-invoices/generate`                                                                                            | Faktur pajak keluaran: draft dari faktur penjualan ber-PPN yang sudah diposting                                                                                           |
| `PATCH /tax-invoices/:id`, `POST /tax-invoices/export`, `POST /tax-invoices/:id/{approve,cancel}`                                                                 | Kode transaksi/fasilitas, ekspor XML `TaxInvoiceBulk` (tax.manage), catat nomor faktur terbit                                                                             |
| `POST /tax-invoices/import-numbers`                                                                                                                               | Impor CSV daftar faktur Coretax (Referensi → Nomor Faktur Pajak)                                                                                                          |
| `GET /input-tax-invoices`, `POST /input-tax-invoices/{import,credit}`, `PATCH /input-tax-invoices/:id`                                                            | Faktur masukan dari CSV Coretax, cocok otomatis ke tagihan, kreditkan maks. 3 masa                                                                                        |
| `GET /withholding-slips?kind=bppu\|bpmp`, `POST /withholding-slips/{generate,export}`                                                                             | Bukti potong PPh 23/4(2)/22 dari tagihan (BPPU) & PPh 21 bulanan dari payroll (BPMP), XML                                                                                 |
| `GET /tax/vat-report?year=&month=`, `GET /tax/exports`, `GET /tax/exports/:id`                                                                                    | Rekap SPT Masa PPN, riwayat berkas XML yang diekspor                                                                                                                      |
| `POST /tax-invoices/check`, `POST /tax-invoices/:id/replace`                                                                                                      | Periksa isi faktur sebelum diunggah; draft faktur pengganti atas faktur yang sudah terbit                                                                                 |
| `GET/POST /tax/nsfp-ranges`, `DELETE /tax/nsfp-ranges/:id`, `POST /tax-invoices/export-legacy`                                                                    | e-Faktur 3.x (pra-Coretax): rentang NSFP & CSV impor FK/OF (pengganti, uang muka/pelunasan)                                                                               |
| `GET /tax-returns`, `POST /tax-returns/{generate,export-legacy}`, `PATCH /tax-returns/:id`                                                                        | Nota retur pajak masukan dari nota debit; CSV RM untuk faktur lama; mengurangi PPN masukan                                                                                |
| `POST /withholding-slips/generate {kind: "bpa1"}`                                                                                                                 | Bukti potong A1 tahunan dari slip masa terakhir (Desember/karyawan keluar), XML `A1Bulk`                                                                                  |
| `POST /withholding-slips/generate {kind: "bp21"}`                                                                                                                 | Bukti potong PPh 21 pegawai tidak tetap (DPP 100% bruto) & bukan pegawai (DPP 50% bruto) dari payroll terposting, XML `Bp21Bulk`; kode objek bawaan di Pengaturan Payroll |
| `GET /onboarding`, `PUT /onboarding/company`, `POST /onboarding/{opening-balance,steps,complete}`                                                                 | Panduan awal: profil & PKP, saldo awal (selisih → 3-9900), checklist                                                                                                      |
| `GET /billing`, `POST /billing/{subscribe,cancel,resume}`, `POST /billing/invoices/:id/pay`                                                                       | Paket, tagihan + PPN, pembayaran (Xendit atau transfer manual)                                                                                                            |
| `POST /billing/webhooks/xendit`                                                                                                                                   | Callback Xendit (header `x-callback-token` = `XENDIT_CALLBACK_TOKEN`)                                                                                                     |
| `/platform/{tenants,plans,invoices}`, `POST /platform/invoices/:id/mark-paid`, `POST /platform/billing/run`                                                       | Admin platform (operator SaaS; `pnpm platform:admin <slug> <email>`)                                                                                                      |
| `POST /platform/plans`, `PUT/DELETE /platform/plans/:id`, `PATCH /platform/tenants/:id/subscription` (`complimentary`, `complimentaryUntil`, `complimentaryNote`) | CRUD paket langganan (hapus hanya bila belum dipakai) & tenant gratis dari admin platform (tanpa tagihan; opsional sampai tanggal)                                        |
| `GET /auth/sessions`, `DELETE /auth/sessions[/:id]`                                                                                                               | Sesi login aktif per perangkat, cabut satu/semua                                                                                                                          |
| `GET /health/ready`, `GET /metrics`                                                                                                                               | Readiness (DB & migrasi), metrik Prometheus (`Authorization: Bearer $METRICS_TOKEN`)                                                                                      |

Format XML mengikuti template impor Coretax: faktur keluaran (`TaxInvoiceBulk`, dicocokkan dengan contoh referensi
Odoo `l10n_id_efaktur_coretax`), BPMP (`MmPayrollBulk`), BPPU (`BpuBulk`), BPA1 (`A1Bulk`), dan BP21 (`Bp21Bulk`). DJP tidak menerbitkan
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

### Data terhubung & drilldown

Setiap dokumen menampilkan panel **Dokumen terkait**: dokumen asal (↑) dan turunan (↓) lintas modul — mis. faktur ←
pesanan penjualan, → pembayaran yang melunasi, faktur pajak, bukti potong; transfer stok ↔ SO/PO, retur, backorder,
pemeriksaan mutu; slip gaji → proses penggajian, klaim biaya, jurnal; kontak → SO, PO, faktur, pembayaran, transfer,
peluang, tiket (dengan jumlah). Hanya dokumen yang boleh dibaca pengguna yang tampil. Dokumen sumber setiap entri jurnal
dibaca dari view `account_move_sources` (migrasi 0082) yang dibangun dari referensi yang sudah ada, sehingga tidak perlu
diisi ulang oleh modul mana pun.

Angka di laporan keuangan (laba rugi, neraca, arus kas, neraca saldo, umur piutang/utang, RK pusat–cabang), anggaran vs
realisasi, laporan PPN, dan kertas kerja konsolidasi bisa diklik: panel samping menampilkan item jurnal penyusunnya
(total sama dengan angka laporan) beserta entri & dokumen sumbernya, bisa diekspor CSV; laporan tetap di tempat. Tab &
filter laporan keuangan tersimpan di URL.

| Endpoint                                                      | Keterangan                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /links/:model/:id`                                       | Dokumen terkait (model: `account_move`, `sale_order`, `stock_picking`, `partner`…)                                          |
| `GET /reports/drilldown`                                      | Item jurnal penyusun angka laporan (filter akun/jenis akun, partner, dimensi, basis tanggal, item terbuka per rentang umur) |
| `GET /tax/vat-report/drilldown?year&month&use=sale\|purchase` | Baris jurnal PPN keluaran/masukan satu masa                                                                                 |

Laporan BI ikut terhubung: klik angka/kelompok di pembuat laporan, batang/titik/irisan grafik, atau KPI & tabel widget
dashboard membuka panel berisi baris data penyusunnya; baris yang punya dokumen sumber (SO, PO, faktur, peluang,
transfer, MO, slip gaji, karyawan…) bisa dibuka. Laporan modul memakai mekanisme yang sama: analisis penjualan &
pembelian, pipeline CRM per tahap dan menang/kalah per tanggal tutup, biaya tenaga kerja (termasuk payroll koreksi),
biaya produksi, nilai persediaan, laporan mutu per pemasok/produk, keandalan & biaya perawatan per peralatan, biaya
armada (kontrak & servis), serta karyawan masuk/keluar per departemen di analitik SDM. Dataset BI baru:
`quality_checks`, `maintenance_requests`, `fleet_costs`.

| Endpoint              | Keterangan                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /reports/drill` | `{reportId}` atau `{dataset, config}` + `match` (nilai kelompok / kunci tersembunyi `_xxxId`) + `filters` periode |

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
