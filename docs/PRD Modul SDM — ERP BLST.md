# PRD Modul SDM — ERP BLST

Oct 24, 2026 · @Unang

## 1. Ringkasan dan ruang lingkup

Modul SDM ERP BLST dibangun dengan 9 sub-modul yang mengacu pada fungsi Odoo 20.0 Enterprise (instance nangs13.odoo.com, lokalisasi Payroll Indonesia aktif), lalu disesuaikan untuk struktur holding–Anak Perusahaan–SBU dan regulasi ketenagakerjaan Indonesia.

**Tujuan produk**

- Satu basis data karyawan untuk seluruh entitas BLST, dengan pemisahan data per perusahaan.
- Proses SDM end-to-end: rekrut → onboarding → absensi & cuti → penggajian → penilaian → offboarding.
- Payroll sesuai PPh 21, BPJS Kesehatan/Ketenagakerjaan, dan THR tanpa hitung manual.
- Semua pengajuan (cuti, lembur, biaya, permintaan umum) melalui alur persetujuan yang tercatat dan dapat diaudit.

**Ruang lingkup (9 sub-modul)**

| No | Sub-modul | Acuan Odoo | Fungsi inti |
| --- | --- | --- | --- |
| 1 | Karyawan | hr, hr\_skills | Data master karyawan, organisasi, versi kontrak, skill, onboarding |
| 2 | Penilaian | hr\_appraisal | Siklus appraisal, target/goal, umpan balik 360, evolusi skill |
| 3 | Absensi | hr\_attendance | Check-in/out, kiosk, GPS & foto, lembur, validasi |
| 4 | Perekrutan | hr\_recruitment, hr\_referral | Lowongan, pipeline pelamar, wawancara, talent pool, referral |
| 5 | Cuti | hr\_holidays | Tipe cuti, alokasi, akrual, pengajuan, hari libur |
| 6 | Armada | fleet, hr\_fleet | Kendaraan, pengemudi, kontrak, servis, odometer, biaya |
| 7 | Payroll | hr\_payroll, l10n\_id\_hr\_payroll | Struktur gaji, aturan, slip gaji, pay run, PPh 21, BPJS |
| 8 | Pengeluaran | hr\_expense | Klaim biaya, OCR struk, persetujuan, reimburse |
| 9 | Persetujuan | approvals | Kategori persetujuan generik dan alur approver |

**Di luar lingkup tahap ini:** Timesheet, Planning, Sign, Learning/eLearning penuh, dan gamifikasi (Lencana/Tantangan) — dicatat sebagai pengembangan lanjutan.

**Peran pengguna**

| Peran | Akses utama |
| --- | --- |
| Karyawan (ESS) | Profil sendiri, absensi, cuti, klaim biaya, permintaan persetujuan, slip gaji, appraisal diri |
| Atasan / Manajer | Tim langsung: persetujuan cuti, absensi, biaya; appraisal bawahan; interviewer |
| HR Officer | Data karyawan entitasnya, rekrutmen, alokasi cuti, validasi absensi |
| HR Manager / Payroll Officer | Konfigurasi, payroll, laporan, semua entitas yang ditugaskan |
| Fleet Manager | Kendaraan, kontrak, servis, biaya armada |
| Finance | Posting biaya dan gaji ke akuntansi, pembayaran |
| Direksi / Sekretaris Perusahaan | Dashboard, laporan lintas entitas, persetujuan tingkat akhir |

## 2. Modul Karyawan

Modul Karyawan adalah data master bagi 8 modul lainnya; setiap karyawan punya satu profil tetap dan riwayat versi kontrak bertanggal efektif.

**Menu acuan Odoo:** Manajemen · Direktori · Departemen · Learning (Sertifikasi, Peserta) · Laporan (Headcount, Inventaris Keterampilan) · Konfigurasi (Onboarding/Offboarding, Tipe Karyawan, Lokasi Kerja, Alasan Resign, Tipe Keterampilan, Jadwal Kerja, Time Types, Jabatan, Templat Kontrak).

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| KRY-01 | Profil karyawan | Nama, nama legal, foto, email/telepon kerja, kontak kerja, tag, user login, perusahaan | MVP |
| KRY-02 | Data pribadi | Tempat/tanggal lahir, NIK/KTP, paspor, kewarganegaraan, jenis kelamin, alamat, status nikah, pasangan, jumlah tanggungan, kontak darurat, pendidikan, jarak rumah–kantor | MVP |
| KRY-03 | Data kerja | Departemen, jabatan, judul jabatan, atasan, coach, lokasi kerja (kantor/rumah/lainnya per hari), jadwal kerja, zona waktu | MVP |
| KRY-04 | Versi kontrak (hr.version) | Riwayat bertanggal efektif: tanggal mulai/akhir kontrak, PKWT/PKWTT, akhir masa percobaan, tipe karyawan, gaji pokok, tipe upah (tetap/per jam), struktur gaji, PIC HR | MVP |
| KRY-05 | Templat kontrak | Kontrak dibuat dari templat jabatan; tanda tangan elektronik opsional | P2 |
| KRY-06 | Atribut payroll Indonesia | Kode PTKP (TK/0–K/3), tipe Gross/Gross Up, BPJS JKK, tunjangan tetap, rekening bank & distribusi gaji | MVP |
| KRY-07 | Approver per karyawan | Penyetuju cuti, absensi, biaya, timesheet ditetapkan per karyawan (default: atasan) | MVP |
| KRY-08 | Resume & keterampilan | Riwayat pendidikan/kerja/pelatihan, skill dengan level, masa berlaku sertifikat, peringatan kedaluwarsa | P2 |
| KRY-09 | Dokumen | KTP, SIM, izin kerja/visa dengan tanggal kedaluwarsa dan pengingat | P2 |
| KRY-10 | Struktur organisasi | Departemen berjenjang (parent–child), manajer, bagan organisasi, direktori karyawan | MVP |
| KRY-11 | Onboarding / Offboarding | Rencana aktivitas per departemen yang otomatis membuat tugas saat karyawan masuk/keluar | P2 |
| KRY-12 | Resign / keluar | Tanggal keluar, alasan resign, arsip karyawan, pemicu offboarding | MVP |
| KRY-13 | Identitas absensi | Badge ID / barcode dan PIN untuk kiosk | MVP |
| KRY-14 | Field kustom | Properti tambahan per perusahaan tanpa ubah kode | P3 |
| KRY-15 | Laporan | Headcount per entitas/departemen/tipe, inventaris keterampilan, ulang tahun | MVP |
| KRY-16 | Smart button | Akses cepat ke appraisal, target, jam kerja bulan ini, riwayat GROSS/PPh21/JHT/JP, kendaraan, slip gaji | P2 |

**Aturan bisnis**

- Satu karyawan boleh memiliki banyak versi kontrak; payroll selalu membaca versi yang berlaku pada periode gaji.
- Data pribadi (NIK, rekening, gaji) hanya terlihat oleh HR, Payroll, dan karyawan bersangkutan.
- Karyawan pada entitas berbeda dipisahkan per perusahaan; HR holding dapat diberi akses multi-entitas.
- Alasan resign dan tanggal keluar wajib diisi sebelum karyawan diarsipkan.

## 3. Modul Penilaian (Appraisal)

Modul Penilaian menjalankan siklus appraisal berkala per karyawan, mengikat target (goal) dan skill, serta mengumpulkan umpan balik 360 derajat.

**Menu acuan Odoo:** Penilaian · Target · Laporan (Analisis Penilaian, Evolusi Skill) · Konfigurasi (Template Appraisal, Skala Evaluasi, Kemampuan, 360 Masukan, Perpustakaan Target, Label, Tipe & Rencana Aktivitas).

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| PNL-01 | Appraisal | Karyawan, atasan (bisa lebih dari satu), tanggal appraisal, template, status Draft → Ongoing → Done | MVP |
| PNL-02 | Template appraisal | Pertanyaan/kolom untuk karyawan dan atasan; template per departemen | MVP |
| PNL-03 | Umpan balik dua sisi | Isian karyawan dan atasan terpisah; masing-masing bisa disembunyikan sampai “dipublikasikan” | MVP |
| PNL-04 | Skala evaluasi & nilai akhir | Skala rating yang dapat dikonfigurasi (mis. 1–5 atau Kurang–Istimewa); nilai akhir oleh atasan | MVP |
| PNL-05 | Catatan privat | Catatan khusus atasan/HR, tidak terlihat karyawan | MVP |
| PNL-06 | Target (goal) | Nama, deskripsi, tenggat, progres 0/25/50/75/100%, label, sub-target berjenjang | MVP |
| PNL-07 | Perpustakaan target | Templat target yang dapat dipakai ulang, dengan waktu biasa (usual timing) | P2 |
| PNL-08 | Skill dalam appraisal | Penilaian level skill saat appraisal; target jabatan untuk jalur karier | P2 |
| PNL-09 | Umpan balik 360 | Minta masukan dari rekan/bawahan melalui survei | P2 |
| PNL-10 | Jadwal otomatis | Appraisal pertama dan kedua setelah N bulan sejak masuk; berikutnya berkala; appraisal otomatis setelah rekrutmen | P2 |
| PNL-11 | Rencana aktivitas | Tugas otomatis (mis. jadwalkan rapat, isi formulir) saat appraisal dimulai | P3 |
| PNL-12 | Laporan | Analisis penilaian per departemen/periode, distribusi nilai, evolusi skill | MVP |

**Aturan bisnis**

- Appraisal ditutup (Done) hanya oleh atasan atau HR setelah nilai akhir terisi.
- Nilai akhir dan riwayat appraisal menjadi masukan kenaikan gaji/jabatan (tautan ke versi kontrak).
- Siklus penilaian BLST dan bobot KPI per entitas perlu ditetapkan HR (pertanyaan terbuka).

## 4. Modul Absensi

Modul Absensi mencatat check-in/check-out dari web, ponsel, atau kiosk, lengkap dengan lokasi dan foto, lalu menghitung jam kerja dan lembur yang diteruskan ke Payroll.

**Menu acuan Odoo:** Absensiku · Manajemen (Dashboard, Karyawan, Absensi) · Mode Kios · Laporan (Absensi, Buku Cuti) · Konfigurasi (Time Types, Pengaturan, Automatic Rules, Onboarding).

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| ABS-01 | Check-in / check-out | Tombol di web/ponsel (systray); catat waktu masuk/keluar, jam kerja, durasi istirahat | MVP |
| ABS-02 | Mode kiosk | Tablet di kantor: identifikasi via barcode/badge (kamera atau scanner), PIN karyawan, atau pilih nama; jeda layar dapat diatur | MVP |
| ABS-03 | Lokasi & perangkat | Simpan latitude/longitude, alamat, IP, browser untuk masuk dan keluar | MVP |
| ABS-04 | Foto check-in | Ambil foto saat check-in sebagai bukti kehadiran | P2 |
| ABS-05 | Mode pencatatan | Kiosk, Systray, Manual, Technical, Automatic Check-Out tercatat per entri | MVP |
| ABS-06 | Checkout otomatis | Tutup absensi yang lupa checkout setelah batas jam tertentu | P2 |
| ABS-07 | Validasi absensi | Status Draft → Validated / Refused oleh approver absensi; toleransi validasi (jam) | MVP |
| ABS-08 | Time Types & aturan otomatis | Klasifikasi jam (kerja normal, lembur 1, lembur 2) berdasarkan aturan otomatis (Time Rule) | MVP |
| ABS-09 | Lembur | Hitung kelebihan jam terhadap jadwal kerja; entri lembur terpisah dan diteruskan ke Payroll | MVP |
| ABS-10 | Kontrol kehadiran | Deteksi “hadir” berdasarkan status login, email, IP, atau absensi | P3 |
| ABS-11 | Dashboard | Siapa yang sedang hadir, terlambat, belum checkout per hari | MVP |
| ABS-12 | Laporan | Rekap absensi per karyawan/departemen/periode, buku cuti (gabungan hadir & cuti) | MVP |
| ABS-13 | Absensi berbasis kontrak | Opsi per versi kontrak: gaji dihitung dari absensi (bukan jadwal) | P2 |

**Aturan bisnis**

- Hanya absensi berstatus Validated yang dibaca Payroll.
- Satu karyawan tidak boleh punya dua absensi terbuka sekaligus.
- Perhitungan upah lembur mengikuti ketentuan lembur PP 35/2021 (jam pertama dan jam berikutnya dengan tarif berbeda); tarif dikonfigurasi di Time Types.
- Radius geofence per lokasi kerja (opsional) menolak check-in di luar area.

## 5. Modul Perekrutan

Modul Perekrutan mengelola lowongan per jabatan dan pipeline pelamar bertahap sampai kontrak ditandatangani, lalu mengubah pelamar menjadi karyawan tanpa input ulang.

**Menu acuan Odoo:** Lamaran (per Jabatan, per Kelompok Talenta, Semua) · Laporan (Analisis Perekrutan, Sumber, Kecepatan Perekrutan, Performa Tim) · Konfigurasi (Jabatan, Tipe Karyawan, Tag, Gelar, Alasan Tolak, Label, Departemen, Tipe Keterampilan, Aktivitas, Job Board, Email). Tahapan bawaan: New → Qualification → First Interview → Second Interview → Contract Proposal → Contract Signed.

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| RKT-01 | Lowongan (jabatan) | Nama jabatan, departemen, perusahaan, lokasi, tipe karyawan, target rekrut, recruiter, interviewer, deskripsi & persyaratan, rentang gaji, gelar yang diharapkan, skill dibutuhkan | MVP |
| RKT-02 | Publikasi | Tayang di website karier, alias email untuk lamaran masuk, posting ke job board, tanggal publikasi otomatis | P2 |
| RKT-03 | Pelamar | Nama, email, telepon, LinkedIn, gelar, ketersediaan, CV & lampiran, sumber/medium (UTM), tag | MVP |
| RKT-04 | Pipeline kanban | Tahapan dapat dikonfigurasi per jabatan; status kanban (In Progress/Ready/Waiting/Blocked); evaluasi bintang | MVP |
| RKT-05 | Wawancara | Jadwal rapat terhubung kalender, daftar interviewer, formulir/survei wawancara, catatan pelamar | MVP |
| RKT-06 | Penawaran gaji | Gaji yang diharapkan vs yang diusulkan, periode bayar | MVP |
| RKT-07 | Tolak pelamar | Alasan tolak, tanggal tolak, email templat penolakan | MVP |
| RKT-08 | Talent pool | Kelompokkan kandidat potensial untuk lowongan berikutnya | P2 |
| RKT-09 | Pencocokan skill | Skor kecocokan berdasarkan skill & gelar terhadap jabatan | P3 |
| RKT-10 | OCR CV | Ekstrak data CV otomatis untuk mengisi lamaran | P3 |
| RKT-11 | Referral karyawan | Karyawan merujuk kandidat, poin referral, status referral, hadiah | P3 |
| RKT-12 | Konversi ke karyawan | Saat Contract Signed: buat karyawan + versi kontrak dari data pelamar; picu onboarding dan appraisal awal | MVP |
| RKT-13 | Laporan | Jumlah lamaran per tahap, sumber terbaik, waktu-ke-rekrut, performa recruiter/interviewer | MVP |

**Aturan bisnis**

- Pembukaan lowongan baru memerlukan Formulir Permintaan Karyawan (FPK) yang disetujui melalui modul Persetujuan.
- Data pelamar yang ditolak disimpan dengan masa retensi tertentu sesuai UU PDP (UU 27/2022) dan dapat dianonimkan.
- Satu kandidat dapat melamar beberapa jabatan; riwayat lamaran ditautkan.

## 6. Modul Cuti

Modul Cuti mengatur tipe cuti, alokasi kuota (manual atau akrual), pengajuan dengan persetujuan satu/dua tingkat, dan meneruskan cuti tidak berbayar ke Payroll.

**Menu acuan Odoo:** My Time (Days Off, Requests) · Overview (kalender tim) · Manajemen (Cuti, Alokasi) · Laporan (per Karyawan, per Tipe, Saldo) · Konfigurasi (Time Types, Rencana Akrual, Company Holidays, Hari Libur Wajib, Automatic Rules).

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| CTI-01 | Tipe cuti | Nama, kode payroll, satuan (hari/jam), durasi (penuh/setengah hari/jam kustom), berbayar/tidak, wajib alokasi, boleh diajukan karyawan, butuh dokumen pendukung, hitung hari kerja/kalender, abaikan hari libur, boleh saldo negatif (dengan batas) | MVP |
| CTI-02 | Persetujuan cuti | Validasi: tanpa / oleh HR / oleh approver cuti / keduanya (dua tingkat). Status: To Approve → Second Approval → Approved / Refused / Cancelled | MVP |
| CTI-03 | Pengajuan cuti | Tanggal mulai–selesai, pagi/siang (setengah hari), jam dari–ke, alasan, lampiran; durasi dihitung otomatis dari jadwal kerja | MVP |
| CTI-04 | Alokasi | Alokasi per karyawan, massal (per departemen/perusahaan/tag), dengan masa berlaku; status persetujuan sendiri | MVP |
| CTI-05 | Rencana akrual | Level/milestone: tambah N hari per frekuensi (harian–tahunan, per jam kerja), mulai setelah N hari/bulan/tahun, batas maksimum, carry-over (hilang/terbawa, batas, masa berlaku), dasar jam kerja aktual | MVP |
| CTI-06 | Hari libur | Libur perusahaan per entitas/jadwal kerja, hari wajib masuk (blokir cuti), impor libur nasional & cuti bersama | MVP |
| CTI-07 | Kalender & ringkasan | Kalender tim, saldo sisa per tipe, hari libur, cuti yang akan datang di dashboard karyawan | MVP |
| CTI-08 | Aturan otomatis | Time Rule untuk memangkas/menyesuaikan cuti (mis. otomatis potong saat alokasi habis) | P2 |
| CTI-09 | Integrasi payroll | Status slip gaji per cuti: dihitung di slip berikutnya / sudah dihitung / perlu koreksi | MVP |
| CTI-10 | Pengajuan massal | HR membuat cuti untuk banyak karyawan sekaligus (mis. cuti bersama) | P2 |
| CTI-11 | Laporan | Per karyawan, per tipe, saldo, analisis cuti vs absensi | MVP |
| CTI-12 | Notifikasi | Email/notifikasi ke approver dan karyawan; pertemuan otomatis di kalender | MVP |

**Aturan bisnis (Indonesia)**

- Cuti tahunan minimal 12 hari kerja setelah 12 bulan bekerja terus-menerus (UU 13/2003 jo. UU 6/2023) — dikonfigurasi sebagai rencana akrual.
- Tipe cuti bawaan yang disiapkan: Tahunan, Sakit (dengan surat dokter), Melahirkan, Ayah/Paternitas, Menikah, Duka, Tanpa Upah, Kompensasi Lembur, WFH.
- Cuti bersama yang ditetapkan pemerintah dapat memotong saldo cuti tahunan sesuai kebijakan perusahaan.
- Cuti tanpa upah otomatis mengurangi hari kerja di slip gaji.

## 7. Modul Armada

Modul Armada mencatat kendaraan operasional, pengemudi (karyawan), kontrak sewa/asuransi, servis, odometer, dan total biaya kepemilikan per kendaraan.

**Menu acuan Odoo:** Armada (Kendaraan, Kontrak, Layanan, Odometer) · Laporan (Biaya, Odometer) · Konfigurasi (Pengaturan, Produsen, Model, Kategori, Tipe Kontrak, Jenis Layanan, Status Kendaraan, Label, Jenis Aktivitas). Status bawaan: New Request → To Order → Registered → Downgraded.

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| ARM-01 | Data kendaraan | Nomor polisi, nomor rangka, merek & model, kategori, tahun, kursi, pintu, transmisi, bahan bakar, tenaga, emisi, warna, lokasi, perusahaan, fleet manager | MVP |
| ARM-02 | Pengemudi | Pengemudi saat ini dan pengemudi berikutnya (karyawan), riwayat penugasan, tanggal tersedia | MVP |
| ARM-03 | Siklus status | Permintaan baru → dipesan → terdaftar → nonaktif; tanggal pesan, registrasi, kontrak pertama | MVP |
| ARM-04 | Nilai aset | Nilai katalog, nilai beli, nilai residu, rencana penggantian kendaraan | P2 |
| ARM-05 | Kontrak | Tipe (sewa/leasing, asuransi, dll.), vendor, referensi, mulai–berakhir, biaya awal + biaya berulang (harian–tahunan), layanan termasuk, status New/Running/Expired/Done/Closed | MVP |
| ARM-06 | Pengingat kontrak | Notifikasi sebelum kontrak/STNK/asuransi kedaluwarsa (jumlah hari dapat diatur) | MVP |
| ARM-07 | Servis | Jenis layanan, vendor, biaya, odometer, tanggal mulai–selesai, pengemudi, status New/Running/Done/Cancelled, tagihan vendor terhubung ke akuntansi | MVP |
| ARM-08 | Odometer | Log pembacaan km per tanggal, satuan km/mi | MVP |
| ARM-09 | Laporan biaya | Biaya per kendaraan/kategori/periode (kontrak + servis), tren odometer | MVP |
| ARM-10 | Kendaraan pribadi | Kendaraan pribadi karyawan yang dipakai dinas (untuk klaim jarak tempuh) | P3 |
| ARM-11 | Pengajuan kendaraan | Permintaan pemakaian/sewa kendaraan via modul Persetujuan (kategori Car Rental) | P2 |

**Aturan bisnis**

- Satu kendaraan hanya memiliki satu pengemudi aktif pada satu waktu.
- Biaya servis dan kontrak dibebankan ke akun analitik entitas/unit pemilik kendaraan.
- Kolom tambahan Indonesia: nomor STNK, masa berlaku STNK & pajak tahunan, nomor BPKB, KIR (jika kendaraan niaga).

## 8. Modul Payroll

Modul Payroll menghitung slip gaji bulanan dari versi kontrak, hari kerja, cuti, lembur, dan input lain melalui aturan gaji yang dapat dikonfigurasi, termasuk PPh 21 dan BPJS sesuai struktur “Indonesia: Regular Pay” (41 aturan).

**Menu acuan Odoo:** Dashboard (peringatan) · Karyawan · Cuti · Slip Gaji (Slip Gaji, Pay Run) · Laporan (Slip Gaji, Working Days, Other Inputs, Audit Trail) · Konfigurasi (Templat Kontrak, Tipe Karyawan, Time Types, Jadwal Kerja, Company Holidays, Tunjangan, Premium Pay, Tipe Struktur, Struktur, Aturan, Parameter Aturan, Kategori Aturan, Peringatan Dashboard).

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| PAY-01 | Struktur gaji | Tipe struktur & struktur per entitas/tipe karyawan; nama slip, kalkulasi year-to-date, pakai baris hari kerja | MVP |
| PAY-02 | Aturan gaji | Kode, kategori, urutan, kondisi (selalu/input/domain/ekspresi), jenis nilai (persen/tetap/input/rumus), visibilitas di slip, kontribusi biaya pemberi kerja, akun GL | MVP |
| PAY-03 | Parameter aturan | Nilai bertanggal (tarif BPJS, plafon, tabel TER PPh 21, PTKP) yang bisa diperbarui tanpa ubah rumus | MVP |
| PAY-04 | Slip gaji | Periode dari–sampai, hari & jam kerja, input lain, baris perhitungan; status Draft → Validated → Paid / Canceled; peringatan & error per slip | MVP |
| PAY-05 | Pay run (batch) | Hitung massal per periode/struktur/tipe karyawan; status Draft → Ready → Done → Paid; total bruto & neto | MVP |
| PAY-06 | Hari kerja & input | Baris hari kerja dari jadwal, absensi, cuti; input lain (insentif, potongan) per karyawan | MVP |
| PAY-07 | Penyesuaian slip | Tunjangan/potongan sekali atau berulang per karyawan; penyitaan/pengalihan gaji, pinjaman | P2 |
| PAY-08 | Koreksi & refund | Slip pengganti/koreksi, slip refund, tautan ke slip asal | P2 |
| PAY-09 | Laporan pembayaran | File transfer bank massal per pay run, tanggal bayar | MVP |
| PAY-10 | Akuntansi | Jurnal gaji per slip/batch ke akun & analitik entitas | MVP |
| PAY-11 | Dashboard & peringatan | Karyawan tanpa kontrak/rekening, kontrak berakhir, slip negatif, data tidak lengkap | MVP |
| PAY-12 | Audit trail | Log perubahan slip, aturan, dan kontrak | MVP |
| PAY-13 | Slip PDF & portal | Slip gaji PDF dikirim email / unduh via ESS; riwayat GROSS/PPh21/JHT/JP per karyawan | MVP |
| PAY-14 | Tanggal tutup payroll | Kunci perubahan absensi/cuti setelah tanggal tutup | P2 |

**Komponen gaji Indonesia (dari struktur bawaan)**

| Kelompok | Komponen |
| --- | --- |
| Pendapatan | Gaji Pokok, Tunjangan Tetap, Tunjangan Transportasi, Makan, Level/Jabatan, Insentif, THR, Lembur, Natura/Perumahan, Laptop, Asuransi |
| BPJS ditanggung perusahaan | BPJS Kesehatan, JKK, JKM, JHT (perusahaan), JP (perusahaan); termasuk tunggakan bulan sebelumnya |
| Pajak | Tunjangan Pajak (Gross Up), Penghasilan Bruto, Biaya Jabatan, JHT + JP, PTKP, PKP, PPh 21 |
| Potongan karyawan | JHT, JP, BPJS Kesehatan, penyitaan/pengalihan gaji, potongan lain |
| Lainnya | Reimburse biaya (dari Pengeluaran), Gaji Neto, Total Bruto |

**Aturan bisnis**

- PPh 21 bulanan memakai tarif efektif rata-rata (TER) PP 58/2023 dan PMK 168/2023; Desember dihitung ulang dengan tarif Pasal 17 setahun.
- Metode Gross atau Gross Up dipilih per versi kontrak; PTKP dari status keluarga karyawan.
- Upah dasar BPJS mengikuti plafon yang berlaku; nilai disimpan sebagai parameter bertanggal.
- THR dibayar minimal 7 hari sebelum hari raya, proporsional untuk masa kerja kurang dari 12 bulan (Permenaker 6/2016).
- Slip berstatus Validated tidak dapat diubah; koreksi hanya lewat slip koreksi.
- Output tambahan yang dibutuhkan: bukti potong PPh 21 (1721-A1), rekap e-Bupot, dan file iuran BPJS.

## 9. Modul Pengeluaran (Expense)

Modul Pengeluaran menerima klaim biaya karyawan per item (tanpa laporan gabungan, seperti di Odoo 20), memprosesnya melalui persetujuan, lalu mem-posting ke akuntansi dan mengganti lewat transfer atau slip gaji.

**Menu acuan Odoo:** Pengeluaran Saya (Pengeluaran Saya, Untuk Diproses) · Laporan (Analisis Pengeluaran) · Konfigurasi (Pengaturan, Produk Biaya). Produk bawaan: Komunikasi, Biaya Umum, Makan, Hadiah, Jarak Tempuh (Mileage), Perjalanan & Akomodasi.

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| EXP-01 | Klaim biaya | Deskripsi, tanggal, karyawan, kategori (produk biaya), harga satuan × jumlah, mata uang, pajak termasuk, catatan, lampiran struk | MVP |
| EXP-02 | Dibayar oleh | Karyawan (perlu reimburse) atau perusahaan (kartu/kas perusahaan); metode pembayaran perusahaan | MVP |
| EXP-03 | Status | Draft → Submitted → Approved → Posted → In Payment → Paid; Refused | MVP |
| EXP-04 | Persetujuan | Oleh approver biaya karyawan / atasan; tanggal persetujuan; pengingat | MVP |
| EXP-05 | Pecah biaya | Satu struk dipecah ke beberapa kategori atau akun analitik | P2 |
| EXP-06 | Distribusi analitik | Beban ke entitas, proyek, atau unit (persentase) | MVP |
| EXP-07 | OCR struk | Unggah foto/PDF struk → ekstrak tanggal, total, vendor otomatis | P2 |
| EXP-08 | Klaim via email | Kirim struk ke alias email untuk membuat klaim | P3 |
| EXP-09 | Posting akuntansi | Jurnal biaya ke akun & jurnal biaya default; tautan ke tagihan vendor yang sudah ada | MVP |
| EXP-10 | Reimburse via payroll | Klaim disetujui ditambahkan ke slip gaji berikutnya (aturan EXPENSES) | MVP |
| EXP-11 | Jarak tempuh | Tarif per km untuk kendaraan pribadi | P3 |
| EXP-12 | Kartu kredit perusahaan | Sinkronisasi transaksi kartu (Stripe Issuing di Odoo; padanan lokal opsional) | P3 |
| EXP-13 | Laporan | Analisis per karyawan, kategori, departemen, entitas, periode | MVP |

**Aturan bisnis**

- Klaim tanpa lampiran bukti ditolak sistem, kecuali kategori tertentu.
- Batas nominal per kategori/jabatan (mis. uang makan dinas) dikonfigurasi; melebihi batas butuh persetujuan tambahan.
- Uang muka perjalanan dinas diselesaikan (settlement) dengan klaim biaya aktual.

## 10. Modul Persetujuan (Approvals)

Modul Persetujuan menyediakan formulir permintaan generik per kategori, dengan kolom yang bisa diwajibkan/opsional dan daftar approver bertingkat, untuk semua permintaan yang tidak punya modul khusus.

**Menu acuan Odoo:** Dashboard · Persetujuan Saya (Permintaan Saya) · Manajer (Untuk Ditinjau, Semua Persetujuan) · Konfigurasi (Kategori Penyetuju, Produk). Kategori bawaan: Perjalanan Dinas, Peminjaman Barang, Persetujuan Umum, Persetujuan Kontrak, Permohonan Pembayaran, Sewa Kendaraan, Hadiah Referral, Pengadaan.

**Kebutuhan fungsional**

| ID | Fitur | Rincian | Prioritas |
| --- | --- | --- | --- |
| APV-01 | Kategori persetujuan | Nama, deskripsi, ikon, perusahaan, urutan; tiap kolom (tanggal, periode, jumlah, nominal, referensi, kontak, pembayaran, lokasi, produk, dokumen) diset Wajib / Opsional / Tidak ada | MVP |
| APV-02 | Approver | Daftar approver per kategori + opsi atasan karyawan sebagai approver; tandai approver wajib | MVP |
| APV-03 | Minimum persetujuan | Jumlah minimum approver yang harus setuju | MVP |
| APV-04 | Urutan persetujuan | Berurutan (berjenjang) atau paralel | MVP |
| APV-05 | Nomor otomatis | Prefix & sekuens per kategori (mis. FPK/2026/0001) | MVP |
| APV-06 | Permintaan | Subjek, kategori, pemohon, tanggal/periode, jumlah, nominal, lokasi, kontak, referensi, deskripsi, lampiran, baris produk | MVP |
| APV-07 | Status | To Submit → Submitted → Approved / Refused / Canceled; riwayat & komentar | MVP |
| APV-08 | Properti kustom | Kolom tambahan per kategori tanpa ubah kode | P2 |
| APV-09 | Tindak lanjut | Kategori Pengadaan membuat RFQ; Peminjaman Barang membuat mutasi stok | P3 |
| APV-10 | Dashboard | Permintaan saya, yang perlu saya tinjau, semua per status/kategori | MVP |

**Kategori khusus BLST yang disiapkan:** FPK (Formulir Permintaan Karyawan), Perjalanan Dinas, Uang Muka, Lembur Terencana, Peminjaman Aset/Kendaraan, Persetujuan Kontrak/Perjanjian, Permohonan Pembayaran.

**Aturan bisnis**

- Matriks otorisasi (Delegation of Authority) per entitas: batas nominal menentukan jenjang approver (Manajer → Direktur → Direksi Holding).
- Delegasi sementara saat approver cuti.
- Satu mesin persetujuan dipakai bersama oleh Cuti, Absensi, Pengeluaran, dan Payroll agar aturan konsisten.

## 11. Integrasi, kebutuhan non-fungsional, dan roadmap

Karyawan menjadi sumber data tunggal; Absensi, Cuti, dan Pengeluaran menjadi input Payroll, dan Persetujuan menjadi mesin alur bersama.

&#91;embedded content: integrasi modul SDM · 9 modul + Akuntansi\]

FPK yang disetujui membuka lowongan; pelamar yang menandatangani kontrak otomatis menjadi karyawan.

**Kebutuhan non-fungsional**

| Aspek | Kebutuhan |
| --- | --- |
| Multi-entitas | Holding, 8 Anak Perusahaan/SBU dalam satu sistem; data, aturan gaji, libur, dan approver per entitas; laporan konsolidasi |
| Hak akses | Berbasis peran (lihat bagian 1) + record rule per perusahaan/departemen; data gaji dan pribadi terbatas |
| Pelindungan data | Sesuai UU 27/2022 (PDP): enkripsi data sensitif, log akses, masa retensi, persetujuan pelamar |
| Audit | Jejak perubahan pada kontrak, gaji, slip, persetujuan (siapa, kapan, nilai lama–baru) |
| Bahasa & lokal | Antarmuka Bahasa Indonesia, format Rupiah, zona waktu WIB/WITA/WIT |
| Mobile / ESS | Absensi GPS & foto, cuti, klaim biaya, persetujuan, slip gaji dari ponsel |
| Kinerja | Pay run 500 karyawan selesai < 5 menit; halaman utama < 2 detik |
| Notifikasi | Email dan in-app untuk pengajuan, persetujuan, kedaluwarsa dokumen/kontrak |
| Impor/ekspor | Impor massal karyawan, saldo cuti, absensi mesin fingerprint; ekspor Excel/PDF |
| API | REST API untuk mesin absensi, bank, e-Bupot, dan aplikasi internal (HRIS, ERM) |

**Roadmap rilis**

| Fase | Modul | Isi |
| --- | --- | --- |
| 1 — Fondasi | Karyawan, Persetujuan | Data master, organisasi, versi kontrak, matriks otorisasi |
| 2 — Waktu | Absensi, Cuti | Check-in GPS/kiosk, lembur, tipe cuti & akrual, hari libur |
| 3 — Gaji | Payroll, Pengeluaran | Struktur Indonesia, PPh 21 TER, BPJS, THR, reimburse, jurnal |
| 4 — Talenta | Perekrutan, Penilaian | Pipeline pelamar, konversi karyawan, appraisal & target |
| 5 — Aset | Armada | Kendaraan, kontrak, servis, biaya |

**Pertanyaan terbuka**

- [ ] Jumlah karyawan per entitas dan entitas mana yang ikut rilis pertama?
- [ ] Siklus appraisal dan skala nilai yang dipakai BLST?
- [ ] Merek mesin fingerprint yang perlu diintegrasikan?
- [ ] Bank penerima file transfer gaji?
- [ ] Matriks otorisasi nominal per entitas sudah ditetapkan Direksi?
