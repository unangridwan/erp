/** Definisi lembar workbook simulasi: kolom (kunci ↔ judul Indonesia), menu ERP, dan cara memasukkan. */
import ExcelJS from "exceljs";
import type { Cell, Model, Row } from "./model.js";

export interface SheetDef {
  name: string;
  /** Menu ERP tempat data dimasukkan. */
  menu: string;
  /** "impor" = ada file siap impor di folder impor/; "form" = input lewat form satu per satu. */
  how: "impor" | "form" | "otomatis";
  note?: string;
  columns: [key: string, header: string, width?: number][];
}

const C = (key: string, header: string, width?: number): [string, string, number?] => [key, header, width];
const company = C("company", "Perusahaan", 11);
const emp = C("employeeNumber", "No. Karyawan", 14);

export const SHEETS: SheetDef[] = [
  {
    name: "Perusahaan",
    menu: "Pengaturan › Perusahaan",
    how: "form",
    note: "Perusahaan pertama (holding) dibuat saat daftar; ganti nama & kodenya, lalu tambah 4 anak usaha (induk = DPA).",
    columns: [
      C("code", "Kode", 8),
      C("name", "Nama", 32),
      C("parent", "Induk", 8),
      C("entityType", "Jenis Entitas", 12),
      C("npwp", "NPWP", 18),
      C("pkp", "PKP"),
      C("street", "Alamat", 50),
      C("city", "Kota", 16),
      C("province", "Provinsi", 16),
      C("postalCode", "Kode Pos"),
      C("phone", "Telepon", 16),
      C("email", "Email", 28),
      C("ownershipPct", "Kepemilikan Induk (%)"),
      C("capital", "Modal Disetor (Rp)", 18),
    ],
  },
  {
    name: "Cabang",
    menu: "Pengaturan › Cabang",
    how: "form",
    columns: [company, C("code", "Kode"), C("name", "Nama", 36), C("city", "Kota", 18)],
  },
  {
    name: "Unit Bisnis",
    menu: "Pengaturan › Unit Bisnis",
    how: "impor",
    columns: [C("code", "Kode", 12), C("name", "Nama", 30)],
  },
  {
    name: "Kurs",
    menu: "Akuntansi › Konfigurasi › Kurs Mata Uang",
    how: "impor",
    columns: [C("currencyCode", "Mata Uang"), C("rateDate", "Tanggal", 12), C("rate", "Kurs (Rp)")],
  },
  {
    name: "Libur Nasional",
    menu: "Kehadiran › Konfigurasi › Hari Libur",
    how: "form",
    note: "2021–2025 (data demo). 2026 diimpor dari daftar bawaan aplikasi (tombol Impor libur nasional).",
    columns: [C("year", "Tahun"), C("date", "Tanggal", 12), C("name", "Nama", 40), C("kind", "Jenis", 12)],
  },
  {
    name: "Akun Tambahan",
    menu: "Akuntansi › Bagan Akun (per perusahaan)",
    how: "impor",
    note: "Bagan akun bawaan dibuat otomatis; lembar ini hanya akun tambahan.",
    columns: [company, C("code", "Kode Akun"), C("name", "Nama Akun", 36), C("accountType", "Tipe Akun", 16)],
  },
  {
    name: "Saldo Awal",
    menu: "Onboarding › Saldo Awal (per perusahaan)",
    how: "impor",
    note: "Tanggal 1 Jan 2021. Baris 5-1200 membalik selisih persediaan dari stok awal agar persediaan tidak tercatat dua kali.",
    columns: [
      company,
      C("accountCode", "Kode Akun"),
      C("partner", "Partner", 30),
      C("debit", "Debit"),
      C("credit", "Kredit"),
      C("name", "Keterangan", 36),
    ],
  },
  {
    name: "Aset Tetap",
    menu: "Akuntansi › Aset Tetap",
    how: "form",
    columns: [
      company,
      C("name", "Nama Aset", 36),
      C("assetAccount", "Akun Aset"),
      C("depreciationAccount", "Akun Akumulasi"),
      C("expenseAccount", "Akun Beban"),
      C("acquisitionDate", "Tgl Perolehan", 12),
      C("firstDepreciationDate", "Tgl Penyusutan Pertama", 12),
      C("cost", "Nilai Perolehan"),
      C("usefulLifeMonths", "Umur (bulan)"),
      C("salvageValue", "Nilai Sisa"),
    ],
  },
  {
    name: "Anggaran",
    menu: "Akuntansi › Anggaran",
    how: "form",
    columns: [
      company,
      C("budget", "Nama Anggaran", 22),
      C("year", "Tahun"),
      C("accountCode", "Kode Akun"),
      C("amount", "Jumlah Setahun"),
    ],
  },
  {
    name: "Kategori Produk",
    menu: "Persediaan › Konfigurasi › Kategori Produk",
    how: "impor",
    columns: [company, C("name", "Nama", 30), C("parent", "Induk")],
  },
  {
    name: "Produk",
    menu: "Persediaan › Produk",
    how: "impor",
    note: "File impor memerlukan ID satuan; skrip muat mengisinya otomatis. Stok awal dimasukkan lewat Penyesuaian Stok per 1 Jan 2026.",
    columns: [
      company,
      C("sku", "SKU", 12),
      C("name", "Nama Produk", 50),
      C("category", "Kategori", 22),
      C("productType", "Tipe"),
      C("uom", "Satuan"),
      C("salePrice", "Harga Jual"),
      C("cost", "Harga Pokok"),
      C("costMethod", "Metode Biaya"),
      C("exportPriceUsd", "Harga Ekspor (USD)"),
      C("openingStock", "Stok Awal"),
    ],
  },
  {
    name: "Partner",
    menu: "Kontak › Partner",
    how: "impor",
    columns: [
      company,
      C("name", "Nama", 40),
      C("kind", "Jenis"),
      C("isCustomer", "Pelanggan"),
      C("isSupplier", "Pemasok"),
      C("npwp", "NPWP", 18),
      C("email", "Email", 30),
      C("phone", "Telepon", 16),
      C("street", "Alamat", 30),
      C("city", "Kota", 16),
      C("province", "Provinsi", 16),
      C("countryCode", "Negara"),
      C("taxDocumentType", "Jenis Dok. Pajak"),
      C("taxTrxCode", "Kode Transaksi Faktur"),
      C("paymentTerm", "Termin Bayar", 14),
    ],
  },
  {
    name: "Golongan Upah",
    menu: "Karyawan › Konfigurasi › Golongan Upah",
    how: "impor",
    columns: [
      C("code", "Kode"),
      C("name", "Nama", 36),
      C("baseWage", "Gaji Pokok"),
      C("minWage", "Gaji Pokok Minimum"),
      C("maxWage", "Gaji Pokok Maksimum"),
      C("sequence", "Urutan"),
    ],
  },
  {
    name: "Jabatan",
    menu: "Karyawan › Konfigurasi › Jabatan",
    how: "form",
    columns: [C("name", "Nama Jabatan", 36), C("grade", "Golongan")],
  },
  {
    name: "Departemen",
    menu: "Karyawan › Departemen (per perusahaan)",
    how: "form",
    note: "Kepala departemen diisi setelah karyawan diimpor.",
    columns: [company, C("name", "Departemen", 28), C("managerNumber", "Kepala (No. Karyawan)", 16)],
  },
  {
    name: "Jadwal Kerja",
    menu: "Kehadiran › Jadwal Kerja (per perusahaan)",
    how: "form",
    columns: [
      company,
      C("name", "Nama Jadwal", 32),
      C("startTime", "Jam Masuk"),
      C("endTime", "Jam Pulang"),
      C("graceMinutes", "Toleransi (menit)"),
    ],
  },
  {
    name: "Karyawan",
    menu: "Karyawan › Impor/Ekspor Data › Karyawan",
    how: "impor",
    columns: [
      company,
      emp,
      C("name", "Nama", 26),
      C("department", "Departemen", 24),
      C("job", "Jabatan", 28),
      C("grade", "Golongan"),
      C("managerNumber", "No. Karyawan Atasan", 14),
      C("branch", "Cabang"),
      C("schedule", "Jadwal Kerja", 28),
      C("workEmail", "Email Kerja", 34),
      C("workPhone", "Telepon Kerja", 14),
      C("joinDate", "Tanggal Masuk", 12),
      C("nik", "NIK", 18),
      C("kkNo", "No. KK", 18),
      C("npwp", "NPWP", 18),
      C("ptkpStatus", "Status PTKP"),
      C("bpjsKesNo", "No. BPJS Kesehatan", 16),
      C("bpjsKesEnrolled", "Peserta BPJS Kesehatan"),
      C("bpjsTkNo", "No. BPJS Ketenagakerjaan (KPJ)", 16),
      C("bpjsTkEnrolled", "Peserta BPJS Ketenagakerjaan"),
      C("bpjsJpEnrolled", "Ikut Jaminan Pensiun"),
      C("overtimeEligible", "Berhak Upah Lembur"),
      C("birthPlace", "Tempat Lahir", 14),
      C("birthDate", "Tanggal Lahir", 12),
      C("gender", "Jenis Kelamin"),
      C("religion", "Agama"),
      C("maritalStatus", "Status Pernikahan"),
      C("bloodType", "Golongan Darah"),
      C("address", "Alamat KTP", 36),
      C("personalPhone", "No. HP Pribadi", 16),
      C("personalEmail", "Email Pribadi", 30),
      C("emergencyContact", "Kontak Darurat", 20),
      C("emergencyPhone", "Telepon Kontak Darurat", 16),
      C("bankName", "Bank"),
      C("bankAccount", "No. Rekening", 18),
      C("bankAccountName", "Nama Pemilik Rekening", 24),
    ],
  },
  {
    name: "Kontrak",
    menu: "Karyawan › Impor/Ekspor Data › Kontrak",
    how: "impor",
    note: "Kolom TJAB/TKEL/TRANS = komponen gaji tetap per bulan (kode komponen bawaan).",
    columns: [
      company,
      emp,
      C("contractType", "Jenis"),
      C("wageType", "Tipe Upah"),
      C("dateStart", "Mulai", 12),
      C("dateEnd", "Berakhir", 12),
      C("wage", "Upah Pokok"),
      C("note", "Catatan", 26),
      C("TJAB", "TJAB"),
      C("TKEL", "TKEL"),
      C("TRANS", "TRANS"),
    ],
  },
  {
    name: "Penyesuaian Upah",
    menu: "Karyawan › Promosi & Mutasi (SK Penyesuaian upah, terapkan)",
    how: "form",
    note: "Kenaikan upah tahunan tiap 1 Januari; menerapkan SK membuat kontrak upah baru per tanggal efektif.",
    columns: [
      company,
      emp,
      C("effectiveDate", "Tanggal Efektif", 12),
      C("newWage", "Upah Baru"),
      C("reason", "Alasan", 28),
    ],
  },
  {
    name: "Karyawan Keluar",
    menu: "Karyawan › Kontrak › Akhiri kontrak (karyawan keluar)",
    how: "form",
    columns: [
      company,
      emp,
      C("resignDate", "Tanggal Keluar", 12),
      C("reason", "Alasan Keluar", 14),
      C("note", "Catatan", 26),
    ],
  },
  {
    name: "Keluarga",
    menu: "Karyawan › Impor/Ekspor Data › Keluarga",
    how: "impor",
    columns: [
      company,
      emp,
      C("relation", "Hubungan"),
      C("name", "Nama", 24),
      C("gender", "Jenis Kelamin"),
      C("birthDate", "Tanggal Lahir", 12),
      C("dependent", "Tanggungan PTKP"),
      C("bpjsCovered", "Ditanggung BPJS Kesehatan"),
    ],
  },
  {
    name: "Pendidikan",
    menu: "Karyawan › Impor/Ekspor Data › Pendidikan",
    how: "impor",
    columns: [
      company,
      emp,
      C("level", "Jenjang"),
      C("institution", "Institusi", 32),
      C("major", "Jurusan", 20),
      C("yearStart", "Tahun Masuk"),
      C("yearEnd", "Tahun Lulus"),
      C("gpa", "IPK/Nilai"),
    ],
  },
  {
    name: "Alokasi Cuti",
    menu: "Cuti & Klaim › Impor/Ekspor Data › Alokasi Cuti",
    how: "impor",
    columns: [
      company,
      emp,
      C("leaveType", "Jenis Cuti", 14),
      C("days", "Jumlah Hari"),
      C("dateFrom", "Berlaku Dari", 12),
      C("dateTo", "Berlaku Sampai", 12),
      C("note", "Catatan", 22),
    ],
  },
  {
    name: "Pengajuan Cuti",
    menu: "Cuti & Klaim › Cuti (ajukan lalu setujui)",
    how: "form",
    columns: [
      company,
      emp,
      C("leaveType", "Jenis Cuti", 14),
      C("dateFrom", "Dari", 12),
      C("dateTo", "Sampai", 12),
      C("reason", "Alasan", 24),
      C("state", "Status"),
    ],
  },
  {
    name: "Absensi",
    menu: "Kehadiran › Impor/Ekspor Data › Absensi",
    how: "impor",
    note: "Semua karyawan Jan 2025 – Okt 2026; 2021–2024 hanya pekerja harian (upahnya per hari hadir). Hari kerja Senin–Jumat di luar hari libur & cuti.",
    columns: [company, emp, C("date", "Tanggal", 12), C("checkIn", "Jam Masuk"), C("checkOut", "Jam Pulang")],
  },
  {
    name: "Lembur",
    menu: "Kehadiran › Impor/Ekspor Data › Lembur",
    how: "impor",
    columns: [
      company,
      emp,
      C("date", "Tanggal", 12),
      C("hours", "Jam"),
      C("dayType", "Jenis Hari"),
      C("description", "Keterangan", 28),
    ],
  },
  {
    name: "Kategori Klaim",
    menu: "Cuti & Klaim › Konfigurasi › Kategori Klaim",
    how: "form",
    columns: [
      company,
      C("name", "Nama", 22),
      C("accountCode", "Kode Akun"),
      C("annualLimit", "Plafon Setahun"),
    ],
  },
  {
    name: "Klaim Biaya",
    menu: "Cuti & Klaim › Klaim Biaya (ajukan, setujui)",
    how: "form",
    columns: [
      company,
      emp,
      C("date", "Tanggal", 12),
      C("category", "Kategori", 22),
      C("amount", "Jumlah"),
      C("description", "Keterangan", 34),
      C("payMethod", "Dibayar Lewat"),
    ],
  },
  {
    name: "Pinjaman Karyawan",
    menu: "Payroll › Pinjaman Karyawan",
    how: "form",
    columns: [
      company,
      emp,
      C("name", "Nama Pinjaman", 30),
      C("principal", "Pokok"),
      C("installment", "Cicilan/bulan"),
      C("startPeriod", "Mulai Potong"),
      C("disburseDate", "Tanggal Cair", 12),
    ],
  },
  {
    name: "Payroll",
    menu: "Payroll › Payroll Run",
    how: "form",
    note: "Buat run, Hitung, Posting, lalu Bayar.",
    columns: [
      company,
      C("period", "Periode"),
      C("paymentDate", "Tanggal Bayar", 12),
      C("name", "Nama", 22),
      C("post", "Posting"),
      C("pay", "Bayar"),
    ],
  },
  {
    name: "Anggaran Tenaga Kerja",
    menu: "Karyawan › Perencanaan › Anggaran Tenaga Kerja › Impor",
    how: "impor",
    columns: [
      company,
      C("year", "Tahun"),
      C("department", "Departemen", 26),
      C("month", "Bulan"),
      C("headcount", "Headcount"),
      C("cost", "Biaya"),
    ],
  },
  {
    name: "Penjualan",
    menu: "Penjualan › Pesanan (konfirmasi → kirim → faktur → pembayaran)",
    how: "form",
    note: "Kolom tanggal kosong = belum dilakukan per 31 Okt 2026.",
    columns: [
      company,
      C("orderNo", "No. Referensi", 14),
      C("partner", "Pelanggan", 36),
      C("dateOrder", "Tgl Pesanan", 12),
      C("pricelist", "Daftar Harga", 12),
      C("intercompany", "Antar-Perusahaan"),
      C("deliveryDate", "Tgl Kirim", 12),
      C("invoiceDate", "Tgl Faktur", 12),
      C("paymentDate", "Tgl Bayar", 12),
    ],
  },
  {
    name: "Penjualan - Baris",
    menu: "Penjualan › Pesanan (baris)",
    how: "form",
    columns: [company, C("orderNo", "No. Referensi", 14), C("sku", "SKU", 12), C("quantity", "Kuantitas")],
  },
  {
    name: "Pembelian",
    menu: "Pembelian › Pesanan Pembelian (konfirmasi → terima → tagihan → bayar)",
    how: "form",
    columns: [
      company,
      C("orderNo", "No. Referensi", 14),
      C("partner", "Pemasok", 36),
      C("dateOrder", "Tgl Pesanan", 12),
      C("pricelist", "-"),
      C("intercompany", "-"),
      C("deliveryDate", "Tgl Terima", 12),
      C("invoiceDate", "Tgl Tagihan", 12),
      C("paymentDate", "Tgl Bayar", 12),
    ],
  },
  {
    name: "Pembelian - Baris",
    menu: "Pembelian › Pesanan Pembelian (baris)",
    how: "form",
    columns: [company, C("orderNo", "No. Referensi", 14), C("sku", "SKU", 12), C("quantity", "Kuantitas")],
  },
  {
    name: "Tagihan Antar-Perusahaan",
    menu: "Akuntansi › Tagihan Pemasok",
    how: "form",
    note: "Sisi pembeli dari transaksi antar-perusahaan (dieliminasi saat konsolidasi).",
    columns: [
      company,
      C("vendor", "Pemasok (anggota grup)", 30),
      C("ref", "Referensi", 14),
      C("date", "Tanggal", 12),
      C("description", "Uraian", 50),
      C("amount", "Jumlah (sebelum PPN)"),
      C("accountCode", "Akun"),
      C("paymentDate", "Tgl Bayar", 12),
    ],
  },
  {
    name: "Prospek CRM",
    menu: "CRM › Pipeline",
    how: "form",
    columns: [
      company,
      C("name", "Peluang", 50),
      C("partnerName", "Calon Pelanggan", 34),
      C("contactName", "Kontak", 20),
      C("email", "Email", 28),
      C("phone", "Telepon", 16),
      C("stage", "Tahap"),
      C("expectedRevenue", "Perkiraan Nilai"),
      C("expectedClose", "Perkiraan Tutup", 12),
      C("salesperson", "Sales (No. Karyawan)", 14),
      C("source", "Sumber"),
    ],
  },
  {
    name: "Lowongan",
    menu: "Karyawan › Rekrutmen › Lowongan",
    how: "form",
    columns: [
      company,
      C("name", "Lowongan", 40),
      C("job", "Jabatan", 28),
      C("department", "Departemen", 24),
      C("quota", "Kuota"),
      C("dateOpen", "Dibuka", 12),
      C("targetDate", "Target", 12),
      C("wageMin", "Gaji Min"),
      C("wageMax", "Gaji Maks"),
    ],
  },
  {
    name: "Pelamar",
    menu: "Karyawan › Rekrutmen › Pelamar",
    how: "form",
    columns: [
      company,
      C("opening", "Lowongan", 40),
      C("name", "Nama", 24),
      C("email", "Email", 28),
      C("phone", "Telepon", 16),
      C("source", "Sumber"),
      C("expectedWage", "Gaji Diharapkan"),
      C("stage", "Tahap"),
      C("consent", "Setuju Pemrosesan Data"),
    ],
  },
  {
    name: "Armada - Model",
    menu: "Armada › Konfigurasi › Model",
    how: "form",
    columns: [C("manufacturer", "Merek"), C("model", "Model", 24), C("category", "Kategori")],
  },
  {
    name: "Armada - Kendaraan",
    menu: "Armada › Kendaraan",
    how: "form",
    columns: [
      company,
      C("licensePlate", "No. Polisi", 14),
      C("manufacturer", "Merek"),
      C("model", "Model", 22),
      C("modelYear", "Tahun"),
      C("color", "Warna"),
      C("driver", "Pengemudi (No. Karyawan)", 14),
      C("purchaseValue", "Nilai Beli"),
      C("stnkExpiry", "STNK Berlaku s.d.", 12),
      C("taxDueDate", "Pajak Tahunan", 12),
      C("branch", "Cabang"),
    ],
  },
  {
    name: "Tutup Buku",
    menu: "Akuntansi › Tutup Buku Tahunan",
    how: "form",
    note: "Dijalankan setelah semua transaksi tahun itu masuk.",
    columns: [company, C("fiscalYear", "Tahun Fiskal")],
  },
  {
    name: "Pengguna",
    menu: "Pengaturan › Pengguna",
    how: "form",
    note: "Kata sandi demo sama untuk semua akun.",
    columns: [
      company,
      C("name", "Nama", 20),
      C("email", "Email", 36),
      C("password", "Kata Sandi", 16),
      C("role", "Peran"),
    ],
  },
];

const PANDUAN = (model: Model) => [
  ["DATA SIMULASI GRUP PT DIDIN PUTRA AGRO (fiktif)"],
  [""],
  [
    "Isi",
    "Holding PT Didin Putra Agro (DPA) + 4 anak usaha 100%: PT Benih Unggul Indonesia (BUI), PT Agroteknologi Indonesia (AGT), PT Perdagangan Tani (PTN), PT Yuyun Herbal Nusantara (YHN).",
  ],
  [
    "Periode",
    "Saldo awal 1 Januari 2021; transaksi harian & bulanan Januari 2021 – Oktober 2026 (penjualan, pembelian, stok, cuti, lembur, klaim, payroll, penyusutan, anggaran, tutup buku 2021–2025). Volume tumbuh tiap tahun; absensi harian semua karyawan sejak 2025.",
  ],
  [
    "Volume",
    `${model["Karyawan"]?.length ?? 0} karyawan, ${model["Produk"]?.length ?? 0} produk, ${model["Partner"]?.length ?? 0} partner, ${model["Penjualan"]?.length ?? 0} pesanan penjualan, ${model["Pembelian"]?.length ?? 0} pesanan pembelian, ${model["Absensi"]?.length ?? 0} baris absensi.`,
  ],
  [""],
  [
    "Cara tercepat",
    "Jalankan `pnpm demo:load` (lihat README › Data simulasi): semua lembar dimuat otomatis lewat API ERP berurutan.",
  ],
  [
    "Impor manual",
    "Folder impor/<KODE>/ berisi file .xlsx siap unggah per perusahaan, bernomor urut. Pilih perusahaan aktif di navbar lalu unggah di menu yang tertera.",
  ],
  [
    "Input manual",
    "Lembar bertanda 'form' diinput satu per satu lewat form ERP, berurutan dari atas ke bawah.",
  ],
  [""],
  ["Lembar", "Menu ERP", "Cara", "Baris", "Catatan"],
  ...SHEETS.map((s) => [s.name, s.menu, s.how, String(model[s.name]?.length ?? 0), s.note ?? ""]),
  [""],
  [
    "Semua nama, NIK, NPWP, rekening & alamat adalah fiktif dan dibangkitkan acak — bukan data orang atau badan usaha nyata.",
  ],
];

const cellValue = (v: Cell | undefined) =>
  v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "ya" : "tidak") : v;

/** Workbook utama: Panduan + satu lembar per tabel. */
export async function writeWorkbook(model: Model, path: string) {
  const book = new ExcelJS.Workbook();
  book.creator = "ERP — data simulasi";
  book.created = new Date("2026-11-01T00:00:00Z");
  const guide = book.addWorksheet("Panduan");
  for (const r of PANDUAN(model)) guide.addRow(r);
  guide.getRow(1).font = { bold: true, size: 14 };
  guide.getRow(11).font = { bold: true };
  guide.getColumn(1).width = 26;
  guide.getColumn(2).width = 70;
  guide.getColumn(3).width = 9;
  guide.getColumn(5).width = 70;
  for (const s of SHEETS) {
    const sheet = book.addWorksheet(s.name.slice(0, 31));
    sheet.addRow(s.columns.map(([, h]) => h)).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of model[s.name] ?? []) sheet.addRow(s.columns.map(([k]) => cellValue(r[k])));
    s.columns.forEach(([, h, w], i) => (sheet.getColumn(i + 1).width = w ?? Math.max(10, h.length + 2)));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  await book.xlsx.writeFile(path);
}

/** Baca kembali workbook (data yang diubah user ikut dimuat). */
export async function readWorkbook(path: string): Promise<Model> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const model: Model = {};
  for (const s of SHEETS) {
    const sheet = book.getWorksheet(s.name.slice(0, 31));
    if (!sheet) continue;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    const keyOf = new Map(s.columns.map(([k, h]) => [h, k]));
    const rows: Row[] = [];
    sheet.eachRow((r, n) => {
      if (n === 1) return;
      const row: Row = {};
      headers.forEach((h, i) => {
        const key = keyOf.get(h);
        if (!key) return;
        let v = r.getCell(i + 1).value as unknown;
        if (v && typeof v === "object" && "result" in v) v = (v as { result: unknown }).result;
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        row[key] = v === undefined || v === null ? null : (v as Cell);
      });
      rows.push(row);
    });
    model[s.name] = rows;
  }
  return model;
}

export const str = (v: Cell | undefined) => (v === null || v === undefined ? "" : String(v));
export const num = (v: Cell | undefined) => (v === null || v === undefined || v === "" ? 0 : Number(v));
export const yes = (v: Cell | undefined) =>
  v === true || ["ya", "true", "1", "y"].includes(str(v).toLowerCase());
