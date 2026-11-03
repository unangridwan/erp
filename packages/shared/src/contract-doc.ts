/** Dokumen kontrak kerja: placeholder template, isi dari data karyawan & kontrak, terbilang, template bawaan. */
import { Decimal } from "decimal.js";
import { z } from "zod";

export const CONTRACT_PLACEHOLDERS: [string, string, string][] = [
  ["nomor_kontrak", "Nomor kontrak", "Contract number"],
  ["tanggal_kontrak", "Tanggal kontrak (hari, tanggal)", "Contract date"],
  ["kota", "Kota penandatanganan", "City of signing"],
  ["perusahaan", "Nama perusahaan", "Company name"],
  ["alamat_perusahaan", "Alamat perusahaan", "Company address"],
  ["npwp_perusahaan", "NPWP perusahaan", "Company tax ID"],
  ["penandatangan", "Penandatangan perusahaan", "Company signer"],
  ["jabatan_penandatangan", "Jabatan penandatangan", "Signer's title"],
  ["nama", "Nama karyawan", "Employee name"],
  ["no_karyawan", "Nomor karyawan", "Employee number"],
  ["nik", "NIK KTP", "National ID"],
  ["tempat_lahir", "Tempat lahir", "Place of birth"],
  ["tanggal_lahir", "Tanggal lahir", "Date of birth"],
  ["jenis_kelamin", "Jenis kelamin", "Gender"],
  ["alamat", "Alamat karyawan", "Employee address"],
  ["jabatan", "Jabatan", "Job position"],
  ["departemen", "Departemen", "Department"],
  ["golongan", "Golongan", "Grade"],
  ["lokasi_kerja", "Lokasi kerja", "Work location"],
  ["jenis_kontrak", "Jenis kontrak", "Contract type"],
  ["tanggal_mulai", "Tanggal mulai", "Start date"],
  ["tanggal_berakhir", "Tanggal berakhir", "End date"],
  ["masa_kontrak", "Masa kontrak", "Contract duration"],
  ["gaji", "Gaji pokok (Rp)", "Base wage"],
  ["gaji_terbilang", "Gaji pokok terbilang", "Base wage in words"],
  ["jenis_upah", "Satuan upah (per bulan/hari/satuan)", "Wage unit"],
  ["tunjangan", "Daftar tunjangan tetap", "Fixed allowances"],
  ["tunjangan_tidak_tetap", "Tunjangan tidak tetap (per hari hadir, premi)", "Variable allowances"],
  ["potongan", "Potongan tetap", "Deductions"],
  ["komponen_gaji", "Rincian semua komponen gaji", "All pay components"],
  ["total_upah", "Gaji pokok + tunjangan tetap", "Wage + fixed allowances"],
];

export type ComponentCalc = "fixed_amount" | "per_attendance_day" | "attendance_premium";

/** Satuan nilai komponen gaji di kontrak sesuai cara hitungnya. */
export function componentUnit(calc: ComponentCalc | null | undefined, locale: "id" | "en" = "id") {
  if (calc === "per_attendance_day") return locale === "en" ? "per day present" : "per hari hadir";
  if (calc === "attendance_premium")
    return locale === "en"
      ? "per month if attendance criteria are met"
      : "per bulan bila memenuhi syarat kehadiran";
  return locale === "en" ? "per month" : "per bulan";
}

/** Komponen gaji kontrak (tunjangan/potongan) untuk dokumen; `kind`/`calc` kosong = tunjangan nilai tetap. */
export interface ContractDocComponent {
  name: string;
  amount: Decimal.Value;
  fixed: boolean;
  kind?: "allowance" | "deduction";
  calc?: ComponentCalc;
}

const UNITS = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
];

function words(n: number): string {
  if (n < 12) return UNITS[n]!;
  if (n < 20) return `${words(n - 10)} belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} puluh ${words(n % 10)}`.trim();
  if (n < 200) return `seratus ${words(n - 100)}`.trim();
  if (n < 1000) return `${words(Math.floor(n / 100))} ratus ${words(n % 100)}`.trim();
  if (n < 2000) return `seribu ${words(n - 1000)}`.trim();
  const scales: [number, string][] = [
    [1e12, "triliun"],
    [1e9, "miliar"],
    [1e6, "juta"],
    [1e3, "ribu"],
  ];
  for (const [size, name] of scales)
    if (n >= size) return `${words(Math.floor(n / size))} ${name} ${words(n % size)}`.trim();
  return "";
}

/** Angka rupiah dalam kata (bulat), mis. 6.500.000 → "enam juta lima ratus ribu rupiah". */
export function terbilang(value: Decimal.Value): string {
  const n = new Decimal(value).abs().toDecimalPlaces(0).toNumber();
  if (n === 0) return "nol rupiah";
  return `${words(n).replace(/\s+/g, " ")} rupiah`;
}

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** "2026-11-16" → "16 November 2026". */
export function tanggalPanjang(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-11-16" → "Senin, 16 November 2026". */
export function hariTanggal(date: string): string {
  return `${DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}, ${tanggalPanjang(date)}`;
}

const rupiah = (v: Decimal.Value) =>
  `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(new Decimal(v).toNumber())}`;

/** Jumlah bulan penuh dari tanggal mulai s.d. tanggal berakhir (inklusif): 1 Jan – 31 Des = 12 bulan. */
export function contractMonths(start: string, end: string): number {
  const next = new Date(`${end}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const [y1, m1, d1] = start.split("-").map(Number) as [number, number, number];
  let months = (next.getUTCFullYear() - y1) * 12 + (next.getUTCMonth() + 1 - m1);
  if (next.getUTCDate() < d1) months -= 1;
  return Math.max(0, months);
}

export interface ContractDocInput {
  contract: {
    name: string;
    contractType: "pkwt" | "pkwtt";
    dateStart: string;
    dateEnd: string | null;
    wage: Decimal.Value;
    wageType: "monthly" | "daily" | "piece";
  };
  /** Tunjangan & potongan kontrak (termasuk komponen otomatis yang berlaku untuk semua karyawan). */
  allowances: ContractDocComponent[];
  employee: {
    name: string;
    employeeNumber: string;
    nik: string | null;
    birthPlace: string | null;
    birthDate: string | null;
    gender: "male" | "female" | null;
    address: string | null;
    job: string | null;
    department: string | null;
    grade: string | null;
    workLocation: string | null;
  };
  company: { name: string; address: string | null; npwp: string | null; city: string | null };
  signer: { name: string | null; title: string | null; city: string | null };
  /** Tanggal dokumen (bawaan tanggal mulai kontrak). */
  date?: string;
}

/** Nilai placeholder dari data kontrak, karyawan & perusahaan. Kosong ditampilkan "………" agar terlihat saat dicetak. */
export function contractVars(input: ContractDocInput): Record<string, string> {
  const blank = "………………";
  const c = input.contract;
  const items = input.allowances.filter((a) => new Decimal(a.amount).gt(0));
  const isAllowance = (a: ContractDocComponent) => (a.kind ?? "allowance") === "allowance";
  const isFixed = (a: ContractDocComponent) => a.fixed && (a.calc ?? "fixed_amount") === "fixed_amount";
  const fixed = items.filter((a) => isAllowance(a) && isFixed(a));
  const variable = items.filter((a) => isAllowance(a) && !isFixed(a));
  const deductions = items.filter((a) => !isAllowance(a));
  const total = fixed.reduce((s, a) => s.plus(a.amount), new Decimal(c.wage));
  const line = (a: ContractDocComponent) => `${a.name} ${rupiah(a.amount)} ${componentUnit(a.calc)}`;
  const wageUnit =
    c.wageType === "daily" ? "per hari" : c.wageType === "piece" ? "per satuan hasil" : "per bulan";
  const months = c.dateEnd ? contractMonths(c.dateStart, c.dateEnd) : 0;
  const date = input.date ?? c.dateStart;
  const v = (x: string | null | undefined) => (x && x.trim() ? x : blank);
  return {
    nomor_kontrak: c.name,
    tanggal_kontrak: hariTanggal(date),
    kota: v(input.signer.city ?? input.company.city),
    perusahaan: input.company.name,
    alamat_perusahaan: v(input.company.address),
    npwp_perusahaan: v(input.company.npwp),
    penandatangan: v(input.signer.name),
    jabatan_penandatangan: v(input.signer.title),
    nama: input.employee.name,
    no_karyawan: input.employee.employeeNumber,
    nik: v(input.employee.nik),
    tempat_lahir: v(input.employee.birthPlace),
    tanggal_lahir: v(tanggalPanjang(input.employee.birthDate)),
    jenis_kelamin:
      input.employee.gender === "male"
        ? "Laki-laki"
        : input.employee.gender === "female"
          ? "Perempuan"
          : blank,
    alamat: v(input.employee.address),
    jabatan: v(input.employee.job),
    departemen: v(input.employee.department),
    golongan: v(input.employee.grade),
    lokasi_kerja: v(input.employee.workLocation ?? input.company.city),
    jenis_kontrak:
      c.contractType === "pkwt"
        ? "Perjanjian Kerja Waktu Tertentu (PKWT)"
        : "Perjanjian Kerja Waktu Tidak Tertentu (PKWTT)",
    tanggal_mulai: tanggalPanjang(c.dateStart),
    tanggal_berakhir: c.dateEnd ? tanggalPanjang(c.dateEnd) : "tidak ditentukan",
    masa_kontrak: c.dateEnd ? `${months} (${words(months) || "nol"}) bulan` : "waktu tidak tertentu",
    gaji: rupiah(c.wage),
    gaji_terbilang: terbilang(c.wage),
    jenis_upah: wageUnit,
    tunjangan: fixed.length ? fixed.map((a) => `${a.name} ${rupiah(a.amount)}`).join("; ") : "tidak ada",
    tunjangan_tidak_tetap: variable.length ? variable.map(line).join("; ") : "tidak ada",
    potongan: deductions.length ? deductions.map(line).join("; ") : "tidak ada",
    komponen_gaji: [
      `- Gaji pokok: ${rupiah(c.wage)} ${wageUnit}`,
      ...fixed.map((a) => `- ${a.name} (tunjangan tetap): ${rupiah(a.amount)} per bulan`),
      ...variable.map(
        (a) => `- ${a.name} (tunjangan tidak tetap): ${rupiah(a.amount)} ${componentUnit(a.calc)}`,
      ),
      ...deductions.map((a) => `- ${a.name} (potongan): ${rupiah(a.amount)} ${componentUnit(a.calc)}`),
    ].join("\n"),
    total_upah: rupiah(total),
  };
}

/** Isi placeholder `{kunci}`; placeholder tak dikenal dibiarkan apa adanya. */
export function renderContractTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{([a-z_]+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

const PARTIES = `Pada hari ini, {tanggal_kontrak}, bertempat di {kota}, yang bertanda tangan di bawah ini:

1. {penandatangan}, jabatan {jabatan_penandatangan}, dalam hal ini bertindak untuk dan atas nama {perusahaan}, beralamat di {alamat_perusahaan}, selanjutnya disebut PIHAK PERTAMA.

2. {nama}, NIK {nik}, lahir di {tempat_lahir} pada tanggal {tanggal_lahir}, jenis kelamin {jenis_kelamin}, beralamat di {alamat}, selanjutnya disebut PIHAK KEDUA.`;

const COMMON = `Pasal 4 – Waktu Kerja dan Lembur
Waktu kerja mengikuti jadwal kerja yang ditetapkan PIHAK PERTAMA sesuai peraturan perundang-undangan. Kerja lembur atas perintah PIHAK PERTAMA dibayar sesuai Peraturan Pemerintah Nomor 35 Tahun 2021.

Pasal 5 – Jaminan Sosial
PIHAK PERTAMA mendaftarkan PIHAK KEDUA sebagai peserta BPJS Kesehatan dan BPJS Ketenagakerjaan. Iuran ditanggung para pihak sesuai ketentuan yang berlaku.

Pasal 6 – Kewajiban dan Kerahasiaan
PIHAK KEDUA wajib melaksanakan tugas dengan penuh tanggung jawab, menaati Peraturan Perusahaan, serta menjaga kerahasiaan informasi PIHAK PERTAMA selama dan sesudah hubungan kerja berakhir.`;

export const DEFAULT_CONTRACT_TEMPLATES: {
  name: string;
  contractType: "pkwt" | "pkwtt";
  title: string;
  body: string;
}[] = [
  {
    name: "PKWT standar",
    contractType: "pkwt",
    title: "PERJANJIAN KERJA WAKTU TERTENTU",
    body: `${PARTIES}

Para pihak sepakat mengikatkan diri dalam Perjanjian Kerja Waktu Tertentu dengan ketentuan sebagai berikut:

Pasal 1 – Jabatan dan Penempatan
PIHAK KEDUA dipekerjakan sebagai {jabatan} pada departemen {departemen}, dengan lokasi kerja di {lokasi_kerja}.

Pasal 2 – Jangka Waktu
Perjanjian ini berlaku selama {masa_kontrak}, terhitung sejak {tanggal_mulai} sampai dengan {tanggal_berakhir}, dan berakhir demi hukum pada tanggal tersebut kecuali diperpanjang dengan perjanjian tertulis.

Pasal 3 – Upah
PIHAK KEDUA menerima upah pokok sebesar {gaji} ({gaji_terbilang}) {jenis_upah}, tunjangan tetap: {tunjangan}, dan tunjangan tidak tetap: {tunjangan_tidak_tetap}. Upah dibayarkan setiap bulan setelah dipotong PPh Pasal 21, iuran BPJS bagian pekerja, dan potongan lain yang disepakati: {potongan}.

${COMMON}

Pasal 7 – Berakhirnya Perjanjian
Pihak yang mengakhiri perjanjian sebelum jangka waktunya berakhir wajib membayar ganti rugi sesuai ketentuan perundang-undangan. Pada saat perjanjian berakhir, PIHAK KEDUA berhak atas uang kompensasi sesuai Peraturan Pemerintah Nomor 35 Tahun 2021.

Pasal 8 – Penutup
Hal-hal yang belum diatur dalam perjanjian ini mengikuti Peraturan Perusahaan dan peraturan perundang-undangan yang berlaku. Perjanjian ini dibuat dalam rangkap dua yang masing-masing mempunyai kekuatan hukum yang sama.`,
  },
  {
    name: "PKWTT standar",
    contractType: "pkwtt",
    title: "PERJANJIAN KERJA WAKTU TIDAK TERTENTU",
    body: `${PARTIES}

Para pihak sepakat mengikatkan diri dalam Perjanjian Kerja Waktu Tidak Tertentu dengan ketentuan sebagai berikut:

Pasal 1 – Jabatan dan Penempatan
PIHAK KEDUA diangkat sebagai karyawan tetap dengan jabatan {jabatan} pada departemen {departemen}, dengan lokasi kerja di {lokasi_kerja}.

Pasal 2 – Mulai Bekerja dan Masa Percobaan
Hubungan kerja dimulai pada {tanggal_mulai} untuk waktu tidak tertentu, dengan masa percobaan paling lama 3 (tiga) bulan. Selama masa percobaan PIHAK KEDUA menerima upah tidak kurang dari upah minimum yang berlaku.

Pasal 3 – Upah
PIHAK KEDUA menerima upah pokok sebesar {gaji} ({gaji_terbilang}) {jenis_upah}, tunjangan tetap: {tunjangan}, dan tunjangan tidak tetap: {tunjangan_tidak_tetap}. Upah dibayarkan setiap bulan setelah dipotong PPh Pasal 21, iuran BPJS bagian pekerja, dan potongan lain yang disepakati: {potongan}.

${COMMON}

Pasal 7 – Pemutusan Hubungan Kerja
Pemutusan hubungan kerja dan hak-hak yang timbul karenanya (uang pesangon, uang penghargaan masa kerja, dan uang penggantian hak) mengikuti Peraturan Pemerintah Nomor 35 Tahun 2021.

Pasal 8 – Penutup
Hal-hal yang belum diatur dalam perjanjian ini mengikuti Peraturan Perusahaan dan peraturan perundang-undangan yang berlaku. Perjanjian ini dibuat dalam rangkap dua yang masing-masing mempunyai kekuatan hukum yang sama.`,
  },
];

export const contractTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contractType: z.enum(["pkwt", "pkwtt"]).nullish(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(60000),
  signerName: z.string().trim().max(200).nullish(),
  signerTitle: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

/** Terapkan template & atur penandatangan perusahaan pada kontrak (isi dokumen dirender ulang). */
export const contractDocumentSchema = z.object({
  templateId: z.string().uuid().nullish(),
  /** Isi yang sudah diedit manual (tanpa template). */
  body: z.string().trim().min(1).max(80000).nullish(),
  signerName: z.string().trim().max(200).nullish(),
  signerTitle: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
});

/** Tanda tangan digital: gambar PNG (base64, boleh data URL) dari kanvas, wajib persetujuan isi. */
export const contractSignSchema = z.object({
  image: z.string().min(100, "Tanda tangan kosong").max(700_000, "Gambar tanda tangan terlalu besar"),
  agree: z.literal(true, { errorMap: () => ({ message: "Centang persetujuan isi kontrak" }) }),
  /** HR: karyawan menandatangani langsung di perangkat HR. */
  inPerson: z.boolean().default(false),
});

/** Unggah kontrak yang sudah ditandatangani (scan tanda tangan basah / hasil e-sign layanan luar). */
export const contractSignedUploadSchema = z.object({
  method: z.enum(["manual", "external"]),
  name: z.string().trim().min(1).max(200),
  type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  data: z.string().min(1, "Pilih berkas").max(10_000_000, "Berkas maksimal 7 MB"),
});

/** Kontrak yang dibuat bersama karyawan baru (mulai = tanggal masuk). */
export const newEmployeeContractSchema = z
  .object({
    /** Tanggal mulai kontrak = tanggal masuk karyawan (hanya diinput di sini). */
    dateStart: z.string().date(),
    templateId: z.string().uuid().nullish(),
    contractType: z.enum(["pkwt", "pkwtt"]).default("pkwtt"),
    wageType: z.enum(["monthly", "daily", "piece"]).default("monthly"),
    taxMethod: z.enum(["gross", "gross_up"]).default("gross"),
    dateEnd: z.string().date().nullish(),
    wage: z.coerce
      .number({ invalid_type_error: "Upah harus berupa angka" })
      .positive("Upah harus lebih dari 0")
      .transform((v) => v.toFixed(2)),
    /** Komponen gaji lain (tunjangan tetap/tidak tetap, potongan) — nilai per bulan atau tarif per hari hadir/premi. */
    allowances: z
      .array(
        z.object({
          componentId: z.string().uuid(),
          amount: z.coerce
            .number({ invalid_type_error: "Nilai harus berupa angka" })
            .min(0, "Tidak boleh negatif")
            .transform((v) => v.toFixed(2)),
        }),
      )
      .max(50)
      .default([]),
  })
  .refine((c) => c.contractType !== "pkwt" || c.dateEnd, {
    message: "PKWT wajib punya tanggal berakhir",
    path: ["dateEnd"],
  })
  .refine((c) => !c.dateEnd || c.dateEnd >= c.dateStart, {
    message: "Tanggal berakhir sebelum mulai",
    path: ["dateEnd"],
  });
