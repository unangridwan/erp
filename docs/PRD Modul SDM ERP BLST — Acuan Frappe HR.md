# PRD Modul SDM ERP BLST — Acuan Frappe HR

Oct 24, 2026 · @Unang

Modul SDM ERP BLST dibangun di atas ERPNext dengan Frappe HR v16.15 sebagai fondasi, lalu dilengkapi penyesuaian Indonesia (PPh 21 TER, BPJS, THR, pesangon) dan struktur multi-entitas BLST.

## 1. Ringkasan & Tujuan

**Latar belakang.** Instance unang.frappe.cloud menjalankan Frappe 16.29, ERPNext 16.30 dan Frappe HR 16.15. Frappe HR terdiri dari 2 modul (HR dan Payroll), 9 workspace, 106 DocType utama dan 28 laporan bawaan. PRD ini memetakan semuanya menjadi kebutuhan produk untuk modul SDM BLST, melengkapi PRD acuan Talenta yang sudah ada.

**Tujuan produk**

1. Satu sumber data karyawan untuk holding, Anak Perusahaan dan SBU, dengan pemisahan data per Company.
2. Seluruh siklus karyawan, dari permintaan tenaga kerja (FPK) sampai Full & Final Settlement, berjalan digital dengan approval berjenjang.
3. Payroll bulanan yang patuh regulasi Indonesia dan langsung menjurnal ke akuntansi ERPNext.
4. Layanan mandiri karyawan (ESS) lewat web dan PWA mobile: check-in, cuti, klaim, slip gaji.

**Ruang lingkup.** Hanya fungsi SDM yang tersedia di Frappe HR: Tenure (siklus karyawan), Recruitment, Shift & Attendance, Leaves, Expenses, Performance, Payroll, Tax & Benefits, dan HR Setup. Di luar lingkup: modul Loan (Lending), Project/Timesheet, dan akuntansi umum, kecuali sebagai titik integrasi.

**Konvensi.** Tanda (S) = dokumen submittable, yaitu punya status Draft → Submitted → Cancelled dan dapat diamandemen. Nama DocType ditulis dalam bahasa Inggris sesuai Frappe agar mudah dicocokkan saat kustomisasi.

## 2. Peta Modul Frappe HR

&#91;embedded content: peta modul Frappe HR · 9 workspace\]

Semua workspace bertumpu pada data induk Employee di HR Setup; Payroll dan Tax & Benefits membaca hasil Shift & Attendance, Leaves dan Expenses setiap periode gaji.

## 3. Pengguna & Peran

Hak akses mengikuti role Frappe, dibatasi per Company lewat User Permission agar HR tiap entitas hanya melihat karyawannya sendiri.

| Role (Frappe) | Padanan BLST | Akses utama |
| --- | --- | --- |
| System Manager | Admin TI holding | Konfigurasi, user, workflow, integrasi |
| HR Manager | Kepala SDM holding | Semua DocType HR & Payroll lintas entitas, setting, submit payroll |
| HR User | Staf SDM entitas (IICC, IPB Press, dll) | Input data karyawan, absensi, cuti, rekrutmen untuk entitasnya |
| Leave Approver | Atasan langsung | Menyetujui Leave Application dan Compensatory Leave |
| Expense Approver | Atasan / Kepala Unit | Menyetujui Expense Claim dan Employee Advance |
| Interviewer | User/manajer perekrut | Mengisi Interview Feedback |
| Accounts User / Manager | Keuangan | Pembayaran klaim, jurnal payroll, Bank Remittance |
| Employee (ESS) | Seluruh karyawan | Profil sendiri, check-in, pengajuan cuti/klaim/shift, slip gaji, appraisal diri |
| Direksi & Komisaris (custom, baca saja) | Direksi, Dekom | Dashboard dan laporan agregat SDM |

**Kebutuhan multi-entitas**

- Setiap Employee terikat ke satu Company; mutasi antar-entitas memakai Employee Transfer (opsi buat Employee baru di entitas tujuan).
- Holiday List, Salary Structure, Leave Policy dan Shift Type dapat berbeda per Company.
- Laporan konsolidasi untuk holding membaca lintas Company tanpa membuka data gaji individu ke role yang tidak berhak.

## 4. Kebutuhan Fungsional per Sub-Modul

Prioritas: **P1** = MVP go-live, **P2** = fase 2, **P3** = opsional. DocType acuan menunjuk objek Frappe HR yang dipakai atau dikustomisasi.

### 4.1 Data Induk & Tenure (siklus karyawan)

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-EMP-01 | Profil karyawan lengkap dalam tab: Overview, Company Details, Alamat & Kontak Darurat, Attendance & Leaves, Approvers, Salary, Bank, Personal, Asuransi Kesehatan, Paspor, Pendidikan, Pengalaman Kerja, Riwayat di Perusahaan, Joining, Exit | Employee | P1 |
| FR-EMP-02 | Penomoran karyawan via Naming Series atau NIK internal (HR Settings → Employee Naming By) | HR Settings | P1 |
| FR-EMP-03 | Struktur organisasi: Company, Department, Designation, Branch, Employee Grade, Employment Type (PKWT, PKWTT, Harian, Magang) | Department, Designation, Employee Grade, Employment Type | P1 |
| FR-EMP-04 | Dokumen identitas (KTP, NPWP, BPJS) dengan jenis dokumen yang bisa dikonfigurasi | Identification Document Type | P1 |
| FR-EMP-05 | Onboarding berbasis template: daftar tugas per departemen/designation, PIC, tenggat, dibuat otomatis saat Job Offer diterima | Employee Onboarding, Employee Onboarding Template | P1 |
| FR-EMP-06 | Surat pengangkatan dari template | Appointment Letter, Appointment Letter Template | P2 |
| FR-EMP-07 | Promosi dan mutasi tercatat sebagai dokumen dengan perubahan atribut (before/after) dan tanggal efektif; mutasi antar-Company | Employee Promotion, Employee Transfer | P1 |
| FR-EMP-08 | Peta keahlian karyawan | Skill, Employee Skill Map | P3 |
| FR-EMP-09 | Pengaduan/keluhan karyawan dengan jenis, pihak terkait dan penyelesaian | Employee Grievance, Grievance Type | P2 |
| FR-EMP-10 | Offboarding: checklist separation, exit interview (web form kuesioner), Full & Final Statement (piutang, aset, hak terutang) | Employee Separation (+Template), Exit Interview, Full and Final Statement | P1 |
| FR-EMP-11 | Pengingat otomatis ulang tahun, ulang tahun kerja, dan hari libur via email | HR Settings → Reminders | P2 |
| FR-EMP-12 | Daily Work Summary: email harian ke grup, rekap balasan | Daily Work Summary, Daily Work Summary Group | P3 |
| FR-EMP-13 | Perjalanan dinas dan log kendaraan dinas | Travel Request, Purpose of Travel, Vehicle Log | P2 |

### 4.2 Rekrutmen

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-REC-01 | Rencana kebutuhan tenaga kerja per Company/Department dengan jumlah posisi dan estimasi biaya | Staffing Plan (S) | P2 |
| FR-REC-02 | Permintaan karyawan (FPK): posisi, jumlah, kompensasi, alasan, tenggat, status, waktu pengisian (Time to Fill) | Job Requisition | P1 |
| FR-REC-03 | Lowongan dari template, terbit di portal karier web, cek kuota Staffing Plan | Job Opening, Job Opening Template | P1 |
| FR-REC-04 | Data pelamar, sumber pelamar, CV; referensi dari karyawan | Job Applicant, Job Applicant Source, Employee Referral | P1 |
| FR-REC-05 | Tahapan wawancara bertingkat, jadwal, pewawancara, skill yang dinilai, feedback dan rating, pengingat otomatis | Interview Round, Interview Type, Interview, Interview Feedback | P1 |
| FR-REC-06 | Surat penawaran dari template term, status Accepted/Rejected, validasi lowongan (HR Settings → Check Vacancies) | Job Offer, Job Offer Term Template, Offer Term | P1 |
| FR-REC-07 | Konversi Job Offer → Employee → Employee Onboarding dalam satu alur | Job Offer, Employee | P1 |
| FR-REC-08 | Analitik rekrutmen per lowongan dan tahap | Recruitment Analytics (report) | P2 |

### 4.3 Shift & Absensi

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-ATT-01 | Jenis shift: jam mulai/selesai, Holiday List, warna roster, auto attendance, toleransi check-in/out, ambang setengah hari dan absen, late entry & early exit grace period | Shift Type | P1 |
| FR-ATT-02 | Penugasan shift individual, massal (tool), jadwal berulang, dan permintaan tukar shift oleh karyawan | Shift Assignment, Shift Assignment Tool, Shift Schedule, Shift Schedule Assignment, Shift Request | P1 |
| FR-ATT-03 | Check-in/out dari mesin fingerprint (API) dan aplikasi mobile dengan geolokasi; geofence lokasi shift | Employee Checkin, Shift Location, HR Settings | P1 |
| FR-ATT-04 | Absensi otomatis dari log check-in per shift; absensi manual, massal (Employee Attendance Tool) dan impor (Upload Attendance) | Attendance, Employee Attendance Tool, Upload Attendance | P1 |
| FR-ATT-05 | Koreksi absensi oleh karyawan (lupa absen, dinas luar, WFH) dengan approval | Attendance Request | P1 |
| FR-ATT-06 | Lembur: jenis lembur, slip lembur otomatis dari shift, masuk ke payroll | Overtime Type, Overtime Slip | P1 |
| FR-ATT-07 | Kalender libur per Company dan penugasannya ke karyawan | Holiday List, Holiday List Assignment | P1 |
| FR-ATT-08 | Laporan: Monthly Attendance Sheet, Shift Attendance, Employees working on a holiday | Report | P1 |

### 4.4 Cuti

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-LV-01 | Jenis cuti dengan aturan: maksimal per periode, maksimal berturut-turut, cuti tak dibayar, dibayar sebagian, opsional, saldo negatif, hari libur dihitung/tidak, kompensasi | Leave Type | P1 |
| FR-LV-02 | Carry forward dengan batas dan masa kedaluwarsa; encashment dengan batas dan komponen gaji | Leave Type, Leave Encashment | P1 |
| FR-LV-03 | Cuti yang bertambah bertahap (earned leave): frekuensi, tanggal alokasi, pembulatan | Leave Type | P2 |
| FR-LV-04 | Periode cuti, kebijakan cuti per grade, penugasan kebijakan massal, alokasi dan penyesuaian saldo | Leave Period, Leave Policy, Leave Policy Assignment, Leave Allocation, Leave Adjustment, Leave Control Panel | P1 |
| FR-LV-05 | Pengajuan cuti oleh karyawan, approval atasan, larangan self-approval, batas pengajuan mundur, notifikasi email | Leave Application, HR Settings | P1 |
| FR-LV-06 | Tanggal blok cuti (masa sibuk) per departemen | Leave Block List | P2 |
| FR-LV-07 | Cuti pengganti karena kerja di hari libur | Compensatory Leave Request | P2 |
| FR-LV-08 | Buku besar cuti untuk audit saldo | Leave Ledger Entry, Leave Ledger (report) | P1 |
| FR-LV-09 | Laporan saldo cuti per karyawan dan ringkasan | Employee Leave Balance, Employee Leave Balance Summary | P1 |

### 4.5 Expenses (klaim & uang muka)

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-EXP-01 | Jenis klaim dengan akun beban default per Company | Expense Claim Type | P1 |
| FR-EXP-02 | Pengajuan klaim dengan lampiran bukti, pajak, approval wajib, larangan self-approval | Expense Claim | P1 |
| FR-EXP-03 | Uang muka karyawan (kasbon dinas), pembayaran, pengembalian, dan pemotongan dari klaim atau gaji | Employee Advance | P1 |
| FR-EXP-04 | Pembayaran klaim lewat Payment Entry dan jurnal ke akuntansi | Expense Claim → Payment Entry | P1 |
| FR-EXP-05 | Laporan klaim belum dibayar, ringkasan uang muka, biaya kendaraan | Unpaid Expense Claim, Employee Advance Summary, Vehicle Expenses | P2 |

### 4.6 Kinerja (Performance)

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-PRF-01 | Siklus penilaian (periode, peserta, template per designation) | Appraisal Cycle, Appraisal Template | P1 |
| FR-PRF-02 | KRA berbobot dan Goal bertingkat (goal tree) yang terhubung ke KRA, progres per goal | KRA, Goal | P1 |
| FR-PRF-03 | Penilaian: skor goal, feedback 360 dari rekan/atasan dengan kriteria, self appraisal, skor akhir berbobot, refleksi | Appraisal, Employee Performance Feedback, Employee Feedback Criteria | P1 |
| FR-PRF-04 | Laporan ringkasan appraisal per siklus/departemen | Appraisal Overview | P2 |

### 4.7 Pelatihan

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-TRN-01 | Program pelatihan, event dengan peserta dan jadwal, hasil dan umpan balik peserta | Training Program, Training Event, Training Result, Training Feedback | P2 |

### 4.8 Payroll

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-PAY-01 | Komponen gaji Earning/Deduction dengan formula dan kondisi, akun per Company, komponen statistik, accrual, arrear, flexible benefit | Salary Component | P1 |
| FR-PAY-02 | Struktur gaji per grade/jabatan dan penugasan per karyawan (termasuk massal) dengan tanggal efektif dan gaji pokok | Salary Structure, Salary Structure Assignment, Bulk Salary Structure Assignment | P1 |
| FR-PAY-03 | Periode payroll dan aturan hari kerja: dasar hari kerja, perlakuan absensi kosong, libur, fraksi gaji setengah hari | Payroll Period, Payroll Settings | P1 |
| FR-PAY-04 | Proses payroll massal per Company/departemen: buat slip, submit, jurnal akuntansi, pembayaran bank | Payroll Entry, Salary Slip | P1 |
| FR-PAY-05 | Pendapatan/potongan tambahan satu kali, insentif, bonus retensi, penahanan gaji, koreksi payroll, rapel (arrear) | Additional Salary, Employee Incentive, Retention Bonus, Salary Withholding, Payroll Correction, Arrear | P1 |
| FR-PAY-06 | Slip gaji dikirim via email terenkripsi kata sandi; tampilkan saldo cuti di slip | Payroll Settings | P1 |
| FR-PAY-07 | Pesangon/uang penghargaan masa kerja berdasarkan aturan bertingkat masa kerja | Gratuity, Gratuity Rule | P1 |
| FR-PAY-08 | Laporan: Salary Register, CTC Break-up, Bank Remittance, pembayaran per mode, Accrued Earnings | Report | P1 |

### 4.9 Pajak & Benefit

| ID | Kebutuhan | DocType acuan | Prioritas |
| --- | --- | --- | --- |
| FR-TAX-01 | Tarif pajak penghasilan bertingkat per periode dan komputasi pajak tahunan | Income Tax Slab, Income Tax Computation | P1 (dikustomisasi untuk PPh 21) |
| FR-TAX-02 | Deklarasi dan bukti pengurang pajak oleh karyawan | Employee Tax Exemption Declaration, Proof Submission, Category, Sub Category | P3 (konsep India, sesuaikan) |
| FR-TAX-03 | Penghasilan lain di luar payroll untuk perhitungan pajak | Employee Other Income | P2 |
| FR-TAX-04 | Benefit fleksibel: pengajuan, klaim, ledger saldo benefit | Employee Benefit Application, Employee Benefit Claim, Employee Benefit Ledger | P2 |
| FR-TAX-05 | Data asuransi kesehatan karyawan | Employee Health Insurance | P2 |

### 4.10 Layanan Mandiri & Mobile

- **FR-ESS-01 (P1)** — PWA Frappe HR (/hrms): check-in geolokasi, pengajuan cuti, klaim, uang muka, dan lihat slip gaji dari ponsel.
- **FR-ESS-02 (P1)** — Notifikasi push/in-app untuk approval dan status pengajuan (PWA Notification).
- **FR-ESS-03 (P2)** — Portal karier publik untuk Job Opening dan lamaran online.

## 5. Data Model (DocType kunci & relasi)

Employee adalah pusat model: hampir semua transaksi SDM menautkan `employee` dan `company`, sehingga filter per entitas dan riwayat karyawan bisa dibaca dari satu tempat.

| Entitas | Relasi utama | Catatan desain |
| --- | --- | --- |
| Employee | Company, Department, Designation, Branch, Grade, Employment Type, User, reports\_to (Employee), Holiday List, Leave/Expense Approver | Master; perubahan jabatan dicatat via Promotion/Transfer, bukan edit langsung |
| Job Requisition → Job Opening → Job Applicant → Interview → Job Offer | Designation, Department, Company, Staffing Plan | Rantai rekrutmen; Job Offer diterima memicu Employee + Onboarding |
| Shift Type → Shift Assignment → Employee Checkin → Attendance | Employee, Holiday List, Shift Location | Attendance unik per karyawan per tanggal; sumber: auto, manual, request |
| Leave Type → Leave Policy → Leave Policy Assignment → Leave Allocation → Leave Application | Leave Period, Employee | Saldo dihitung dari Leave Ledger Entry, bukan field statis |
| Salary Component → Salary Structure → Salary Structure Assignment → Salary Slip | Payroll Period, Payroll Entry, Income Tax Slab, Company accounts | Slip menarik absensi, cuti tak dibayar, lembur, Additional Salary, pinjaman/uang muka |
| Expense Claim / Employee Advance | Expense Claim Type, Payment Entry, GL | Posting langsung ke buku besar ERPNext |
| Appraisal Cycle → Appraisal | Appraisal Template, KRA, Goal, Employee Performance Feedback | Skor akhir = gabungan goal, feedback, self appraisal |
| Employee Separation → Exit Interview → Full and Final Statement → Gratuity | Employee, aset, uang muka, slip terakhir | Menutup status karyawan (Left) dan kewajiban finansial |

**Kustomisasi data untuk BLST (Custom Field)**

- Employee: NIK KTP, NPWP, status PTKP (TK/0 s.d. K/3), no. BPJS Kesehatan & Ketenagakerjaan, jenis kontrak PKWT/PKWTT, tanggal akhir kontrak, kategori TER (A/B/C).
- Salary Component: flag komponen BPJS (porsi perusahaan/karyawan), flag dasar THR, flag objek PPh 21.
- Company: kode entitas BLST (holding, AP, SBU), nomor kepesertaan BPJS per entitas.

## 6. Workflow & Approval

Instance belum punya Workflow aktif untuk dokumen SDM (hanya 2 workflow Loan yang nonaktif); approval saat ini bergantung pada field approver dan status bawaan. BLST perlu Workflow Frappe untuk approval berjenjang berikut.

| Dokumen | Pengaju | Jenjang approval (usulan) | Efek setelah disetujui |
| --- | --- | --- | --- |
| Job Requisition (FPK) | Kepala Unit | Kepala SDM entitas → Direktur entitas → SDM holding (bila di luar Staffing Plan) | Boleh buat Job Opening |
| Job Offer | HR User | Kepala SDM → Direktur | Kirim ke kandidat |
| Leave Application | Karyawan | Atasan langsung (Leave Approver) → SDM untuk cuti > 3 hari | Attendance "On Leave", saldo berkurang |
| Attendance / Shift Request | Karyawan | Atasan langsung | Attendance/Shift Assignment dibuat |
| Expense Claim / Employee Advance | Karyawan | Atasan → Keuangan | Siap dibayar, jurnal ke GL |
| Employee Promotion / Transfer | HR User | Kepala SDM → Direksi | Atribut Employee berubah pada tanggal efektif |
| Payroll Entry | HR User | Kepala SDM → Direktur Keuangan | Submit slip, jurnal, Bank Remittance |
| Employee Separation / F&F | HR User | Kepala SDM → Keuangan → Direksi | Status Left, pembayaran akhir |

## 7. Laporan & Dashboard

Frappe HR menyediakan 28 laporan bawaan; yang relevan untuk BLST:

- **Karyawan:** Employee Information, Employee Analytics, Employee Birthday, Employee Exits.
- **Absensi & cuti:** Monthly Attendance Sheet, Shift Attendance, Employees working on a holiday, Employee Leave Balance (+Summary), Leave Ledger.
- **Rekrutmen & kinerja:** Recruitment Analytics, Appraisal Overview.
- **Payroll & biaya:** Salary Register, Employee CTC Break-up, Bank Remittance, Salary Payments Based On Payment Mode, Accrued Earnings Report, Income Tax Computation, Income Tax Deductions, Unpaid Expense Claim, Employee Advance Summary, Vehicle Expenses.
- **Tidak relevan (khusus India), ganti dengan versi Indonesia:** Provident Fund Deductions, Professional Tax Deductions, Salary Payments via ECS.

Laporan tambahan BLST: rekap BPJS per entitas, SPT/bukti potong PPh 21 (1721-A1), turnover dan headcount per entitas, kontrak PKWT yang akan berakhir, dan dashboard SDM untuk Direksi.

## 8. Integrasi

- **Akuntansi ERPNext:** jurnal payroll per Company/cost center, Payment Entry untuk klaim dan uang muka.
- **Mesin absensi:** push log ke Employee Checkin via REST API.
- **Bank:** file transfer massal dari Bank Remittance sesuai format bank BLST.
- **Email/notifikasi:** template notifikasi cuti, wawancara, exit questionnaire, slip gaji terenkripsi.
- **Migrasi dari Talenta:** impor data karyawan, saldo cuti awal, dan riwayat gaji lewat Data Import.

## 9. Kebutuhan Non-Fungsional

- **Keamanan:** data gaji hanya untuk HR Manager dan Payroll; User Permission per Company; slip gaji terenkripsi; audit trail (Version) pada Employee dan Salary Structure Assignment.
- **Kepatuhan:** pelindungan data pribadi karyawan (UU PDP), retensi dokumen kepegawaian.
- **Kinerja:** proses payroll satu entitas selesai dalam hitungan menit; absensi otomatis berjalan terjadwal (scheduler).
- **Ketersediaan:** PWA dapat dipakai dari ponsel; antarmuka berbahasa Indonesia.

## 10. Penyesuaian Indonesia (gap Frappe HR)

| Kebutuhan | Kondisi di Frappe HR | Pendekatan |
| --- | --- | --- |
| PPh 21 metode TER bulanan + perhitungan tahunan di Desember | Income Tax Slab bertingkat tahunan, tidak mengenal TER/PTKP | Custom: tabel TER A/B/C, PTKP, hitung ulang Desember; komponen formula di Salary Component |
| BPJS Kesehatan & Ketenagakerjaan (JKK, JKM, JHT, JP) dengan batas upah | Tidak ada bawaan | Salary Component berformula + batas upah di Payroll Settings custom |
| THR keagamaan | Tidak ada bawaan | Additional Salary massal dengan rumus proporsional masa kerja |
| Pesangon, UPMK, UPH sesuai PP 35/2021 | Gratuity Rule bertingkat masa kerja | Konfigurasi Gratuity Rule per alasan PHK |
| Lembur sesuai Kepmen (1,5x/2x per jam) | Overtime Type dengan multiplier | Konfigurasi Overtime Type hari kerja/libur |
| Kontrak PKWT dan pengingat habis kontrak | Tidak ada | Custom Field + notifikasi terjadwal |
| Bukti potong 1721-A1 dan e-SPT | Laporan pajak India | Laporan custom |

Angka tarif dan batas upah wajib diverifikasi dengan konsultan pajak/ketenagakerjaan sebelum go-live.

## 11. Prioritas Rilis

1. **Fase 1 (MVP):** Data induk karyawan multi-entitas, shift & absensi + PWA check-in, cuti, expense claim & uang muka, payroll dengan PPh 21 TER, BPJS dan THR, laporan inti.
2. **Fase 2:** Rekrutmen end-to-end (FPK sampai onboarding), appraisal KRA/Goal, lembur otomatis, offboarding & F&F, dashboard Direksi.
3. **Fase 3:** Pelatihan, benefit fleksibel, skill map, grievance, perjalanan dinas, daily work summary.

**Pertanyaan terbuka**

- [ ] Format file transfer bank mana yang dipakai tiap entitas?
- [ ] Apakah BPRS Botani Bina Rahmah memakai payroll terpisah karena regulasi OJK?
- [ ] Jenjang approval final per entitas perlu ditetapkan Direksi.
