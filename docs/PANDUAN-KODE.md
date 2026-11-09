# Panduan membaca & mengedit kode

Panduan untuk membaca kode ERP ini dari awal sampai bisa mengedit sendiri. Urutannya: peta besar → telusuri satu fitur →
peta "mau ubah apa, buka mana" → dua latihan. Semua perintah di bawah dijalankan dari folder root repo.

## 1. Peta besar

Repo ini monorepo pnpm. Ada empat bagian yang saling bergantung:

| Folder            | Isi                                                     | Bahasa           |
| ----------------- | ------------------------------------------------------- | ---------------- |
| `apps/web`        | Tampilan: halaman, form, daftar, menu (Next.js + React) | TypeScript       |
| `apps/api`        | Server: endpoint dan aturan bisnis (NestJS)             | TypeScript       |
| `packages/db`     | Definisi tabel (Drizzle) dan file migrasi SQL           | TypeScript + SQL |
| `packages/shared` | Validasi (zod) dan rumus yang dipakai web **dan** API   | TypeScript       |
| `docs`            | Rencana, keputusan arsitektur, operasional, panduan ini | Markdown         |
| `infra`           | Docker (Postgres, Redis, Mailpit), skrip backup         | YAML/SQL         |

Alur satu fitur selalu sama:

```
layar (web)  →  memanggil endpoint (api)  →  memakai validasi/rumus (shared)  →  menyimpan ke tabel (db)
```

Bacaan awal, berurutan (total ±30 menit): `README.md` (cara menjalankan, daftar endpoint) → `docs/PLAN.md` (apa yang sudah
dibuat dan alasannya) → `docs/adr/` (tiga keputusan arsitektur: modular monolith, multitenancy dengan RLS, buku besar).

Dua konsep yang akan sering muncul:

- **Tenant** = satu pelanggan/perusahaan induk di aplikasi (data terpisah penuh). **Company** = badan usaha di dalam tenant
  (holding dan anak usaha). Hampir semua data milik satu company dan dipilih lewat pemilih perusahaan di navbar.
- **RLS** (_row-level security_) = database sendiri yang memastikan satu tenant tidak bisa melihat data tenant lain. Anda
  tidak perlu mengubahnya, tetapi tabel baru harus mengikuti polanya (lihat migrasi tabel lain).

## 2. Menjalankan dan memeriksa

Langkah awal ada di `README.md` bagian "Menjalankan lokal". Perintah sehari-hari:

```bash
pnpm install        # sekali, dan setiap kali ada paket baru setelah git pull
pnpm db:setup       # menerapkan migrasi database baru (jalankan setelah git pull / setelah menambah migrasi)
pnpm dev            # api di :3001, web di :3000 (biarkan terbuka)
pnpm typecheck      # cek salah tipe — jalankan sering, paling cepat menemukan salah ketik
pnpm lint           # cek gaya kode
pnpm test           # test otomatis (butuh database aktif)
pnpm format         # merapikan semua file (Prettier)
```

Kebiasaan yang disarankan: edit sedikit → `pnpm typecheck` → lihat di browser → lanjut. Jangan menumpuk banyak perubahan
sekaligus.

## 3. Telusuri satu fitur dari ujung ke ujung: Golongan Upah

Fitur ini kecil tetapi memakai semua lapisan. Buka file-file berikut berurutan dan cari kata kunci yang disebut:

| Lapisan         | File                                          | Cari                                                |
| --------------- | --------------------------------------------- | --------------------------------------------------- |
| Menu            | `apps/web/lib/apps.ts`                        | `"/salary-grades"`                                  |
| Layar & form    | `apps/web/lib/resources.ts`                   | `path: "salary-grades"` (kolom daftar + field form) |
| Validasi        | `packages/shared/src/schemas.ts`              | `salaryGradeSchema`                                 |
| Endpoint+aturan | `apps/api/src/hr/hr.module.ts`                | `path: "salary-grades"`, lalu `beforeSave`          |
| Tabel           | `packages/db/src/schema/hr.ts`                | `salaryGrades`                                      |
| Migrasi         | `packages/db/migrations/0057_*.sql`, `0061_*` | perubahan kolom dari waktu ke waktu                 |
| Test            | `apps/api/test/grade-base-wage.test.ts`       | contoh memakai fitur lewat API                      |

Hal yang akan Anda lihat:

- Halaman daftar dan form **tidak ditulis satu per satu**. `apps/web/app/(app)/[resource]/` membaca definisi di
  `resources.ts` lalu menampilkannya lewat `components/list-view.tsx` (daftar) dan `components/form-view.tsx` (form).
- Endpoint CRUD (daftar, buat, ubah, hapus, impor, ekspor) dibuat otomatis oleh `createCrudController` di
  `apps/api/src/common/crud.ts`. Aturan khusus (mis. "gaji pokok tidak boleh di bawah minimum") ditaruh di `beforeSave`.
- Nama field di form (`name: "baseWage"`), di zod (`baseWage`), dan di tabel Drizzle (`baseWage`) **harus sama**. Itu
  satu-satunya "kontrak" antar lapisan.
- Teks di layar memakai `L("Teks Indonesia", "English text")` (dua bahasa). Selalu isi keduanya.

## 4. Mau ubah apa, buka mana

| Mau mengubah                              | Buka                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| Label, urutan, teks bantuan field di form | `apps/web/lib/resources.ts`                                                      |
| Nama atau pengelompokan menu              | `apps/web/lib/apps.ts`                                                           |
| Warna, jarak, ukuran, tata letak          | `apps/web/app/globals.css` (satu file CSS; variabel `--muted`, `--border`, dst.) |
| Halaman khusus (bukan CRUD biasa)         | `apps/web/app/(app)/<modul>/…/page.tsx`, mis. `hr/probations/page.tsx`           |
| Komponen yang dipakai berulang            | `apps/web/components/` (`navbar.tsx`, `data-table.tsx`, `feedback.tsx`)          |
| Aturan bisnis, hitungan, endpoint         | `apps/api/src/<modul>/` (mis. `hr/`, `payroll/`, `sales/`)                       |
| Rumus (pajak, BPJS, cuti, jatuh tempo)    | `packages/shared/src/` (tiap rumus punya `*.test.ts` di sebelahnya)              |
| Validasi field (wajib/opsional, panjang)  | `packages/shared/src/schemas.ts`                                                 |
| Menambah kolom atau tabel                 | `packages/db/src/schema/` **dan** migrasi SQL baru                               |
| Terjemahan pesan error dari server        | `apps/api/src/common/error-messages-en.ts`                                       |
| Hak akses (siapa boleh apa)               | `packages/shared/src/permissions.ts` dan `rbac.ts`                               |

Field yang tersedia di `resources.ts` (nilai `type`): `text`, `number`, `boolean`, `date`, `select`, `ref` (pilihan dari
data lain), `email`.

## 5. Aturan emas

1. **Perubahan tampilan saja** (teks, urutan field, warna, menu) paling aman: cukup `resources.ts`, `apps.ts`,
   `globals.css`. Tidak menyentuh database.
2. **Menambah field yang disimpan** harus berurutan: migrasi SQL → tabel Drizzle → zod di `shared` → (bila perlu) aturan di
   API → `resources.ts`. Bila satu langkah terlewat: kolom tidak tersimpan, atau muncul galat 400 saat menyimpan.
3. **Jangan mengedit migrasi lama.** Selalu buat file baru bernomor berikutnya (`0062_….sql`), lalu `pnpm db:setup`.
   Migrasi yang sudah dijalankan tidak dijalankan ulang.
4. Setelah mengubah `shared` atau `db`, jalankan `pnpm db:setup` (ia membangun ulang kedua paket) atau `pnpm dev` agar web
   dan API memakai versi terbaru.
5. Pesan error baru dari server wajib punya terjemahan Inggris di `error-messages-en.ts` (ada test yang memeriksanya).
6. Pajak, payroll, dan jurnal akuntansi punya aturan yang saling terkait dan di-test ketat. Ubah di sana dengan hati-hati
   dan jalankan `pnpm test` sebelum memakainya.
7. Commit kecil dan sering. Bila ragu, `git status` lalu `git diff` untuk melihat apa yang berubah.

## 6. Latihan 1 — perubahan tampilan (aman, tanpa database)

Tujuan: mengenal `resources.ts` dan `globals.css`.

1. Buka `apps/web/lib/resources.ts`, cari `path: "salary-grades"`.
2. Pada field `baseWage`, ubah `label: L("Gaji pokok", "Base wage")` menjadi `L("Gaji pokok standar", "Standard base wage")`.
3. Pindahkan field `sequence` (Urutan) ke atas, tepat di bawah `name()`.
4. Buka `apps/web/app/globals.css`, cari `.nav-section` dan ubah `font-size: 11px` menjadi `12px`.
5. `pnpm typecheck`, buka `http://localhost:3000/salary-grades/new` dan lihat hasilnya. Dropdown **Konfigurasi** di modul
   Karyawan memakai gaya `.nav-section` untuk subjudulnya.

Membatalkan semua perubahan latihan: `git checkout -- .`

## 7. Latihan 2 — menambah field opsional "Catatan" di Golongan Upah

Tujuan: mengikuti urutan penuh menambah field yang disimpan. Latihan ini sudah dicoba dan berhasil (field muncul di form
dan tersimpan).

**Langkah 1 — migrasi.** Buat file `packages/db/migrations/0062_catatan_golongan.sql` (nomor harus lebih besar dari migrasi
terakhir; cek dengan `ls packages/db/migrations`):

```sql
alter table salary_grades add column note text;
```

**Langkah 2 — tabel Drizzle.** Di `packages/db/src/schema/hr.ts`, pada `salaryGrades`, tambahkan satu baris di antara
`baseWage` dan `sequence`:

```ts
note: text("note"),
```

**Langkah 3 — validasi.** Di `packages/shared/src/schemas.ts`, pada `salaryGradeSchema`, tambahkan (opsional, maks. 300 huruf):

```ts
note: z.string().trim().max(300).nullish(),
```

**Langkah 4 — form.** Di `apps/web/lib/resources.ts`, cari `path: "salary-grades"`, lalu pada daftar `fields` tambahkan
sebelum field `sequence`:

```ts
{ name: "note", label: L("Catatan", "Note"), type: "text" },
```

> Setiap field **wajib** punya `type`. Bila dilupakan, `pnpm typecheck` menolak dengan galat
> `Type '{ name: string; label: Text; }' is not assignable to type 'Field'`.

**Langkah 5 — terapkan dan periksa.**

```bash
pnpm db:setup       # menerapkan migrasi 0062 dan membangun ulang db + shared
pnpm typecheck      # harus bersih
pnpm dev
```

Buka `http://localhost:3000/salary-grades/new`: field **Catatan** tampil. Isi kode, nama, gaji pokok, dan catatan, lalu
simpan. Buka lagi golongan itu: catatan tersimpan.

**Langkah 6 — membatalkan latihan** (jangan tinggalkan migrasi latihan di repo yang sungguhan):

```bash
git checkout -- .
del packages\db\migrations\0062_catatan_golongan.sql      # macOS/Linux: rm packages/db/migrations/0062_catatan_golongan.sql
```

Migrasi yang sudah terlanjur diterapkan ke database lokal tidak ikut dibatalkan oleh langkah di atas. Untuk database
lokal yang hanya berisi data uji, cara paling bersih adalah memulai dari awal:
`docker compose -f infra/docker-compose.yml down -v`, lalu `up -d` dan `pnpm db:setup` (lihat bagian "Masalah umum" di
`README.md`).

Ingin kolom Catatan tampil juga di daftar? Tambahkan `{ name: "note", label: L("Catatan", "Note") }` pada `columns` entri
yang sama.

## 8. Cara mencari kode yang dibutuhkan

- **Mulai dari yang kelihatan.** Salin teks di layar (mis. "Rencana Akrual Cuti"), cari di seluruh proyek (`Ctrl+Shift+F`
  di VS Code). Hasilnya hampir selalu `apps.ts` atau `resources.ts`; dari situ telusuri ke belakang seperti di bagian 3.
- **Lompat ke definisi.** Di VS Code arahkan kursor ke nama fungsi/tipe lalu `F12` (Go to Definition) atau `Shift+F12`
  (semua pemakaian).
- **Baca test sebagai contoh pemakaian.** File di `apps/api/test/` menunjukkan data yang dikirim dan hasil yang
  diharapkan. Setiap fitur besar punya test sendiri; cari berdasarkan nama modul (`payroll-…`, `hr-…`, `sales…`).
- **Jangan baca semuanya.** File besar (`resources.ts`, `schemas.ts`, `hr.module.ts`) cukup dicari bagian yang relevan.

## 9. Galat yang sering muncul dan artinya

| Gejala                                                    | Penyebab dan solusi                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `node_modules missing` / `Cannot find module`             | Paket baru belum terpasang: `pnpm install`                                                      |
| `ECONNREFUSED` saat menjalankan skrip atau halaman kosong | API belum berjalan: `pnpm dev` dan tunggu siap (`http://localhost:3001/health`)                 |
| Error kolom/relasi tidak ada saat menyimpan               | Migrasi belum diterapkan: `pnpm db:setup`                                                       |
| 400 "Validasi gagal" dengan nama field                    | Field tidak cocok di zod (`schemas.ts`) atau form; cek ejaan dan wajib/opsional                 |
| `Type … is not assignable to type 'Field'`                | Field di `resources.ts` kurang properti, biasanya `type`                                        |
| Test `error-i18n-coverage` gagal                          | Pesan error baru belum diterjemahkan di `error-messages-en.ts`                                  |
| Tampilan tidak berubah setelah edit CSS/komponen          | Muat ulang paksa browser (`Ctrl+Shift+R`); bila memakai `pnpm start` jalankan `pnpm build` lagi |

## 10. Kapan sebaiknya minta bantuan

- Mengubah rumus pajak (PPh 21, PPN, Coretax), BPJS, payroll, atau pembentukan jurnal.
- Mengubah kebijakan hak akses atau RLS, atau membuat tabel baru (pola tenant/company harus diikuti).
- Perubahan yang membuat `pnpm test` merah dan penyebabnya tidak jelas setelah dibaca satu per satu.
- Migrasi yang mengubah atau menghapus data yang sudah ada.

Bila meminta bantuan, sertakan: apa yang ingin dicapai, file yang sudah diubah (`git status`), dan pesan galat lengkap.
