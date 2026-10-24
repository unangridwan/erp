# PRD Modul SDM & Payroll — Referensi Fitur Talenta

Oct 24, 2026 · @Unang

## Ringkasan

Talenta (Mekari) yang dipakai BLST terdiri dari 9 menu utama, 1 profil karyawan dengan 5 kelompok data, dan 8 jenis pengajuan mandiri (ESS). Inventaris ini diambil dari akun Sekretaris Perusahaan (peran karyawan + atasan langsung) dan dipetakan menjadi kebutuhan modul SDM & Payroll ERP.

- **Cakupan:** Home, Employee profile, Employees, Recruitment, Time, Productivity, Company, Applications, Integrations, plus Inbox, menu (+), pengaturan akun.
- **Tidak tercakup:** menu admin HR (pengaturan payroll, komponen gaji, kebijakan cuti, approval rule, laporan). Menu ini tidak tampil di akun ini — lihat bagian Catatan.
- **Data pribadi:** hanya nama field yang dicatat, bukan nilainya.

## Peta menu

Navigasi Talenta punya tiga lapis: header global, sidebar menu utama, dan sub-menu profil karyawan.

1. **Header global**
   1. Product switcher (HRIS, Insights, Performance Management, Recruitment, LMS)
   2. Tombol (+) Request: Time off, Attendance, Change shift, Benefit reimbursement
   3. Inbox / notifikasi (tab: Inbox, NPP, Forms, Timesheet, Tasks, Sent item; tombol New message)
   4. App launcher Mekari (Talenta, Flex, Jurnal, Klikpajak, Qontak, Sign, Launchpad, University)
   5. Menu akun: ganti bahasa (EN/ID/ZH), Account settings, Support center, What's new, Help, Sign out
2. **Home (Dashboard)** — sapaan, shortcut request, quick links, aplikasi, banner, Announcement & Tasks, saldo cuti, Who's Off
3. **Employee profile (My Info)**
   1. General: Personal (Basic info, Family, Emergency contact), Employment, Education & experience, Additional info
   2. Time management: Attendance, Timeoff, Shift
   3. Payroll: Payroll info, Payslip
   4. Finance: Reimbursement, Loan
   5. Files, Assets
   6. History: Adjustment, Transfer, NPP, Reprimand
4. **Employees** — Directory, Org chart
5. **Recruitment** — Overview, Job listings, Candidates, Calendar, Activity log, Reports, Settings
6. **Time** — Attendance (My attendance log), Calendar (Company calendar)
7. **Productivity**
   1. Projects & tasks: Projects, Tasks, Timesheet (Time tracker, Activities, Summary, Tracker report, Settings)
   2. Forms & surveys: Forms, My submissions
8. **Company** — Announcement
9. **Applications** — LMS, Performance Review, Insight, Talentics, Marketplace
10. **Integrations** — katalog add-on (akuntansi, ERP, mesin absensi, LMS)
11. **Account settings** — Change password payslip PDF, Change password, Talenta Labs

## Daftar fitur per modul

Tabel ini mencatat fungsi, field, dan aksi yang terlihat di tiap halaman.

| Modul | Menu / halaman | Fungsi | Field / kolom & aksi yang terlihat |
| --- | --- | --- | --- |
| Dashboard | Home | Ringkasan harian karyawan | Shortcut request (reimbursement, time off, attendance, change shift); quick links; widget saldo cuti per jenis (mis. Cuti Tahunan, Cuti Sakit dengan surat dokter); Who's Off (hari ini); tab Announcement & Tasks dengan filter + search; banner produk |
| Data Karyawan | Personal – Basic info | Data pribadi & identitas | Nama lengkap, telepon, email (login), telepon tambahan, tempat & tanggal lahir (+umur otomatis), gender, status nikah, golongan darah, agama; NIK (NPWP 16 digit), alamat KTP, kode pos, alamat domisili, no. & masa berlaku paspor; tombol Edit per blok |
| Data Karyawan | Personal – Family, Emergency contact | Data keluarga & kontak darurat | Daftar anggota keluarga dan kontak darurat (tab terpisah) |
| Data Karyawan | Employment | Data kepegawaian | Perusahaan, Employee ID, barcode, organisasi, jabatan, job level, status kerja (PKWT/PKWTT), cabang, tanggal bergabung (+masa kerja otomatis), grade, class, approval line, manager; daftar subordinate (bawahan langsung yang perlu approval) |
| Data Karyawan | Education & experience | Riwayat pendidikan & kerja | Tab Formal education, Informal education, Working experience; kolom institusi, gelar, bidang studi, periode, nilai, aktivitas, sertifikat; Add new; Download CV |
| Data Karyawan | Additional info | Custom field | Field tambahan yang didefinisikan perusahaan |
| Data Karyawan | Files | Dokumen karyawan | Unggah & simpan dokumen pribadi/kepegawaian |
| Data Karyawan | Assets | Aset yang dipegang karyawan | Nama aset, kategori, nomor aset, tanggal serah, tanggal kembali; search |
| Riwayat | Adjustment history | Riwayat penyesuaian gaji | Transaction ID, periode, end date, amount; dilindungi password + OTP |
| Riwayat | Transfer history | Mutasi/promosi | Effective date, transfer type, item, dari, ke, catatan |
| Riwayat | NPP history | Perubahan nomor pegawai | Transaction ID, effective date, NPP lama, NPP baru |
| Riwayat | Reprimand history | Surat peringatan/teguran | Riwayat SP per karyawan |
| Kehadiran | Attendance (request) | Koreksi/pengajuan absensi | Form: tanggal, shift, jam masuk, jam pulang, alasan (maks 200 karakter), lampiran (maks 5 file JPG/PNG/PDF/CSV/XLSX, 5 MB); daftar: tanggal request, tanggal absensi, data absensi, shift, status; filter bulan & status |
| Kehadiran | My attendance log | Log kehadiran bulanan | Ringkasan: On time, Late clock in, Early clock out, No clock out, No clock in, Invalid, Absent, Day off, Time off, Next workdays; tabel: tanggal, shift, jadwal masuk/pulang, clock in/out, attendance code, time off code, overtime; filter |
| Kehadiran | Shift | Pengajuan tukar shift | Request shift change; kolom created date, start date, status; filter bulan, tahun, status |
| Kehadiran | Company calendar | Kalender perusahaan | Tampilan bulanan; tab All events, Birthday, Time off; libur; tombol Request time off |
| Cuti | Timeoff | Saldo & pengajuan cuti | Saldo per kebijakan (mis. Cuti Tahunan 20 hari); Request time off; Request delegation; tab Time off request & Delegation; kolom created date, policy code, start/end date, additional policy, notes, status, taken, canceled |
| Payroll | Payroll info | Data penggajian karyawan | Bank (nama bank, no. rekening, pemilik); Pajak (NPWP 15 & 16 digit, status PTKP); BPJS (no. Ketenagakerjaan, no. Kesehatan); Edit per blok |
| Payroll | Payslip | Slip gaji | Slip per periode; PDF diproteksi password (diatur di Account settings); akses butuh password + OTP |
| Keuangan | Reimbursement | Klaim penggantian biaya | Saldo benefit; Request reimbursement; tab Request & Taken; kolom transaction ID, jenis, created date, effective date, detail, total, status |
| Keuangan | Loan | Pinjaman karyawan | Ringkasan pinjaman; riwayat: transaction ID, nama pinjaman, jumlah, cicilan, bunga, effective date |
| Direktori | Employees | Direktori & struktur | Directory (nama, Employee ID, foto, search, atur kolom); Org chart |
| Rekrutmen | Recruitment | ATS | Overview, Job listings, Candidates, Calendar (interview), Activity log, Reports, Settings |
| Produktivitas | Projects & tasks | Proyek, tugas, timesheet | Projects; Tasks (create task, filter, due date, export); task group untuk insentif payroll; Timesheet: Time tracker, Activities, Summary, Tracker report |
| Produktivitas | Forms & surveys | Form kustom | Forms (nama, status); My submissions |
| Komunikasi | Announcement | Pengumuman perusahaan | Filter kategori, search |
| Komunikasi | Inbox | Pesan & notifikasi approval | Folder Inbox, NPP, Forms, Timesheet, Tasks, Sent item; New message; select all, delete, mark read; retensi data 2 tahun |
| Platform | Integrations | Add-on | Jurnal (aktif), SAP S/4HANA & Business One, M365 Business Central, Odoo, Acumatica, Oracle NetSuite, mesin absensi Hikvision & ZKTeco, LMS |
| Platform | Account settings | Keamanan akun | Password PDF payslip (6–8 angka), ganti password, Talenta Labs; bahasa EN/ID/ZH |

Aturan approval yang terlihat di sistem: request tidak bisa di-approve bila jadwal shift karyawan berubah (request jadi invalid), absensi sudah dikunci (attendance lock), atau karyawan sudah resign.

## Kebutuhan fungsional untuk PRD

Usulan awal: 9 kebutuhan P0 untuk MVP, karena payroll butuh data karyawan, kehadiran, dan cuti yang sudah rapi. Prioritas bisa diubah lewat dropdown.

| ID | Kebutuhan (user story) | Acuan Talenta | Prioritas |
| --- | --- | --- | --- |
| HR-01 | Sebagai HR, saya mengelola master data karyawan (pribadi, identitas, keluarga, kontak darurat, kepegawaian) per entitas BLST. | Personal, Employment | P0 – MVP |
| HR-02 | Sebagai HR, saya mengatur struktur organisasi, jabatan, job level, grade, cabang, dan approval line. | Employment, Org chart | P0 – MVP |
| HR-03 | Sebagai karyawan, saya melihat dan mengajukan perubahan data diri (Edit per blok, disetujui HR). | Edit + notifikasi "Change Data Request Accepted" | P1 – Fase 2 |
| TM-01 | Sebagai karyawan, saya clock in/out dan melihat log kehadiran bulanan beserta ringkasannya. | My attendance log | P0 – MVP |
| TM-02 | Sebagai karyawan, saya mengajukan koreksi absensi dan tukar shift dengan lampiran. | Attendance request, Shift | P0 – MVP |
| TM-03 | Sebagai HR, saya mengatur shift, jadwal kerja, kalender libur, dan mengunci absensi per periode. | Shift, Company calendar, attendance lock | P0 – MVP |
| LV-01 | Sebagai karyawan, saya melihat saldo dan mengajukan cuti per kebijakan, termasuk delegasi tugas. | Timeoff, Delegation | P0 – MVP |
| WF-01 | Sebagai atasan, saya menyetujui/menolak request bawahan dari inbox; sistem memblokir approval bila shift berubah, absensi terkunci, atau karyawan resign. | Inbox, Subordinate, aturan approval | P0 – MVP |
| PY-01 | Sebagai HR, saya menyimpan data bank, NPWP, status PTKP, dan nomor BPJS tiap karyawan. | Payroll info | P0 – MVP |
| PY-02 | Sebagai HR, saya menjalankan payroll bulanan (komponen tetap/tidak tetap, lembur, potongan absensi, PPh 21, BPJS) dari data kehadiran dan cuti. | Payroll (admin, tidak terlihat) | P0 – MVP |
| PY-03 | Sebagai karyawan, saya mengunduh slip gaji PDF berpassword; akses dilindungi password + OTP. | Payslip, Account settings | P1 – Fase 2 |
| PY-04 | Sebagai HR, saya mencatat penyesuaian gaji dengan riwayat dan periode berlaku. | Adjustment history | P1 – Fase 2 |
| FN-01 | Sebagai karyawan, saya mengajukan reimbursement sesuai saldo benefit; yang disetujui masuk ke payroll. | Reimbursement | P1 – Fase 2 |
| FN-02 | Sebagai HR, saya mencatat pinjaman karyawan dengan cicilan dan bunga yang dipotong otomatis di payroll. | Loan | P1 – Fase 2 |
| HR-04 | Sebagai HR, saya mencatat mutasi/promosi, perubahan NPP, dan surat peringatan sebagai riwayat. | Transfer, NPP, Reprimand | P1 – Fase 2 |
| HR-05 | Sebagai HR, saya mencatat aset yang dipegang karyawan dan dokumen kepegawaian. | Assets, Files | P2 – Nanti |
| HR-06 | Sebagai karyawan, saya mencari rekan kerja di direktori dan melihat bagan organisasi. | Employees | P1 – Fase 2 |
| HR-07 | Sebagai HR, saya mengelola riwayat pendidikan & pengalaman serta mencetak CV. | Education & experience | P2 – Nanti |
| HR-08 | Sebagai HR, saya menambah custom field tanpa ubah kode. | Additional info | P2 – Nanti |
| CM-01 | Sebagai HR, saya menerbitkan pengumuman per kategori yang tampil di dashboard. | Announcement | P2 – Nanti |
| PR-01 | Sebagai karyawan, saya mencatat task dan timesheet; HR bisa menghitung insentif dari task selesai. | Projects & tasks | P2 – Nanti |
| PR-02 | Sebagai HR, saya membuat form/survei kustom dan melihat submission. | Forms & surveys | P2 – Nanti |
| RC-01 | Sebagai HR, saya mengelola lowongan, kandidat, dan jadwal interview. | Recruitment | P2 – Nanti |
| IN-01 | Sebagai Finance, jurnal payroll otomatis masuk ke modul akuntansi ERP. | Integrasi Jurnal | P1 – Fase 2 |
| IN-02 | Sebagai HR, data mesin absensi (fingerprint/face) tersinkron otomatis. | Hikvision, ZKTeco | P1 – Fase 2 |
| UX-01 | Sebagai karyawan, saya memakai dashboard ESS berisi shortcut request, saldo cuti, Who's Off, dan pengumuman, di web & mobile. | Home, aplikasi mobile | P1 – Fase 2 |

## Catatan & batasan

Inventaris ini lengkap untuk sisi karyawan dan atasan, tapi belum mencakup sisi admin HR — bagian terpenting untuk payroll.

- **Belum terlihat (perlu akun admin HR atau sumber lain):** pengaturan komponen gaji, run payroll, kalkulasi PPh 21 & BPJS, laporan (SPT, BPJS, rekap payroll), kebijakan cuti & lembur, approval rule, attendance lock, import/export data, live attendance/geofencing.
- **Tidak dibuka:** Adjustment history dan Payslip meminta password + OTP; isinya tidak dicek. Recruitment, LMS, Performance Review, Insight, dan Talentics adalah aplikasi terpisah dan hanya menunya yang dicatat.
- **Menu belum dibuka satu per satu:** isi Projects, Timesheet, Org chart, Family, Emergency contact, dan Files.
- **Pertanyaan terbuka:** apakah Recruitment, LMS, dan Performance masuk lingkup modul SDM ERP, atau tetap aplikasi terpisah?
