import { z } from "zod";

/**
 * Jenis kontrak kerja sebagai master data (PKWT, PKWTT, harian lepas, magang, kemitraan, …) agar bisa diubah saat
 * peraturan berubah. Dokumen (kontrak, template, FPK, penawaran) menyimpan `code`.
 */
export const CONTRACT_TYPE_CODE = /^[a-z0-9_-]{2,20}$/;

/** Kode jenis kontrak pada input dokumen (huruf kecil, angka, - atau _). */
export const contractTypeCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CONTRACT_TYPE_CODE, "Kode jenis kontrak 2–20 karakter: huruf kecil, angka, - atau _");

export const contractTypeSchema = z.object({
  code: contractTypeCode,
  name: z.string().trim().min(1, "Isi nama").max(100),
  description: z.string().trim().max(1000).nullish(),
  legalBasis: z.string().trim().max(300).nullish(),
  fixedTerm: z.boolean().default(false),
  maxMonths: z.coerce.number().int().min(1, "Minimal 1 bulan").max(600).nullish(),
  documentTitle: z.string().trim().max(200).nullish(),
  sequence: z.coerce.number().int().min(0).max(9999).default(10),
  active: z.boolean().default(true),
  ...{
    inPayroll: z.boolean().default(true),
    bpjsKes: z.boolean().default(true),
    bpjsJkk: z.boolean().default(true),
    bpjsJkm: z.boolean().default(true),
    bpjsJht: z.boolean().default(true),
    bpjsJp: z.boolean().default(true),
    pph21Category: z.enum(["auto", "permanent", "non_permanent", "non_employee", "none"]).default("auto"),
    thr: z.boolean().default(true),
    overtime: z.boolean().default(true),
    severance: z.enum(["pesangon", "compensation", "none"]).default("pesangon"),
  },
});
export type ContractTypeInput = z.infer<typeof contractTypeSchema>;

export interface ContractTypeRule {
  code: string;
  name: string;
  fixedTerm: boolean;
  maxMonths: number | null;
}

export type Pph21Category = "permanent" | "non_permanent" | "non_employee" | "none";
export const PPH21_CATEGORY_LABEL: Record<Pph21Category | "auto", [string, string]> = {
  auto: [
    "Otomatis (bulanan = pegawai tetap, harian/borongan = tidak tetap)",
    "Automatic (monthly = permanent, daily/piece = non-permanent)",
  ],
  permanent: ["Pegawai tetap (TER bulanan, A1)", "Permanent employee (monthly TER, A1)"],
  non_permanent: ["Pegawai tidak tetap (tarif harian)", "Non-permanent employee (daily rate)"],
  non_employee: ["Bukan pegawai (50% bruto × Pasal 17)", "Non-employee (50% of gross × Art. 17)"],
  none: ["Tidak dipotong PPh 21", "No PPh 21 withholding"],
};
export const SEVERANCE_RULE_LABEL: Record<"pesangon" | "compensation" | "none", [string, string]> = {
  pesangon: ["Pesangon (UP, UPMK, UPH)", "Severance (UP, UPMK, UPH)"],
  compensation: ["Uang kompensasi PKWT", "Fixed-term compensation"],
  none: ["Tidak ada", "None"],
};

/** Aturan penggajian jenis kontrak (bagian dari master jenis kontrak). */
export interface ContractPayrollRule {
  inPayroll: boolean;
  bpjsKes: boolean;
  bpjsJkk: boolean;
  bpjsJkm: boolean;
  bpjsJht: boolean;
  bpjsJp: boolean;
  pph21Category: Pph21Category | "auto";
  thr: boolean;
  overtime: boolean;
  severance: "pesangon" | "compensation" | "none";
}

/** Kategori PPh 21 efektif: `auto` mengikuti jenis upah. */
export function resolveTaxCategory(
  rule: Pick<ContractPayrollRule, "pph21Category"> | null | undefined,
  wageType: "monthly" | "daily" | "piece",
): Pph21Category {
  const c = rule?.pph21Category ?? "auto";
  if (c !== "auto") return c;
  return wageType === "monthly" ? "permanent" : "non_permanent";
}

/**
 * Kepesertaan BPJS efektif per program: jenis kontrak menjadi batas, centang di data karyawan dapat mengecualikan
 * (iuran dipotong hanya bila keduanya ikut). Tanpa jenis kontrak (data lama) = mengikuti karyawan.
 */
export function effectiveEnrollment(
  employee: { kes: boolean; tk: boolean; jp: boolean },
  rule?: Pick<ContractPayrollRule, "bpjsKes" | "bpjsJkk" | "bpjsJkm" | "bpjsJht" | "bpjsJp"> | null,
) {
  const r = rule ?? { bpjsKes: true, bpjsJkk: true, bpjsJkm: true, bpjsJht: true, bpjsJp: true };
  const jkk = employee.tk && r.bpjsJkk;
  const jkm = employee.tk && r.bpjsJkm;
  const jht = employee.tk && r.bpjsJht;
  return {
    kes: employee.kes && r.bpjsKes,
    tk: jkk || jkm || jht,
    jkk,
    jkm,
    jht,
    jp: employee.tk && employee.jp && r.bpjsJp,
  };
}

export const DEFAULT_CONTRACT_TYPES: (ContractTypeInput & { isSystem: boolean })[] = [
  {
    code: "pkwt",
    name: "PKWT (kontrak)",
    description: "Perjanjian kerja waktu tertentu.",
    legalBasis: "UU 6/2023 jo. PP 35/2021 Pasal 4–8",
    fixedTerm: true,
    maxMonths: 60,
    documentTitle: "PERJANJIAN KERJA WAKTU TERTENTU",
    sequence: 10,
    active: true,
    inPayroll: true,
    bpjsKes: true,
    bpjsJkk: true,
    bpjsJkm: true,
    bpjsJht: true,
    bpjsJp: true,
    pph21Category: "auto",
    thr: true,
    overtime: true,
    severance: "compensation",
    isSystem: true,
  },
  {
    code: "pkwtt",
    name: "PKWTT (tetap)",
    description: "Perjanjian kerja waktu tidak tertentu (karyawan tetap).",
    legalBasis: "UU 6/2023 jo. PP 35/2021",
    fixedTerm: false,
    maxMonths: null,
    documentTitle: "PERJANJIAN KERJA WAKTU TIDAK TERTENTU",
    sequence: 20,
    active: true,
    inPayroll: true,
    bpjsKes: true,
    bpjsJkk: true,
    bpjsJkm: true,
    bpjsJht: true,
    bpjsJp: true,
    pph21Category: "auto",
    thr: true,
    overtime: true,
    severance: "pesangon",
    isSystem: true,
  },
  {
    code: "harian",
    name: "Harian lepas",
    description: "Pekerja harian lepas: bekerja kurang dari 21 hari per bulan, upah per hari kehadiran.",
    legalBasis: "PP 35/2021 Pasal 10–11",
    fixedTerm: false,
    maxMonths: null,
    documentTitle: "PERJANJIAN KERJA HARIAN LEPAS",
    sequence: 30,
    active: true,
    inPayroll: true,
    bpjsKes: true,
    bpjsJkk: true,
    bpjsJkm: true,
    bpjsJht: true,
    bpjsJp: true,
    pph21Category: "auto",
    thr: true,
    overtime: true,
    severance: "none",
    isSystem: false,
  },
  {
    code: "magang",
    name: "Magang",
    description: "Pemagangan di perusahaan berdasarkan perjanjian pemagangan.",
    legalBasis: "Permenaker 6/2020",
    fixedTerm: true,
    maxMonths: 12,
    documentTitle: "PERJANJIAN PEMAGANGAN",
    sequence: 40,
    active: true,
    inPayroll: true,
    bpjsKes: false,
    bpjsJkk: true,
    bpjsJkm: true,
    bpjsJht: false,
    bpjsJp: false,
    pph21Category: "auto",
    thr: false,
    overtime: false,
    severance: "none",
    isSystem: false,
  },
  {
    code: "mitra",
    name: "Mitra / kemitraan",
    description: "Hubungan kemitraan (bukan hubungan kerja), mis. tenaga lepas atau mitra penjualan.",
    legalBasis: null,
    fixedTerm: false,
    maxMonths: null,
    documentTitle: "PERJANJIAN KEMITRAAN",
    sequence: 50,
    active: true,
    inPayroll: true,
    bpjsKes: false,
    bpjsJkk: false,
    bpjsJkm: false,
    bpjsJht: false,
    bpjsJp: false,
    pph21Category: "non_employee",
    thr: false,
    overtime: false,
    severance: "none",
    isSystem: false,
  },
];

/** Tanggal berakhir terakhir yang masih dalam batas `months` bulan sejak mulai (inklusif), YYYY-MM-DD. */
export function contractLimitDate(dateStart: string, months: number): string {
  const [y, m, d] = dateStart.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

/** Aturan periode per jenis kontrak: tanggal berakhir wajib (waktu tertentu) & batas masa kontrak. */
export function contractPeriodErrors(
  type: ContractTypeRule,
  dateStart: string,
  dateEnd: string | null | undefined,
): string | null {
  if (type.fixedTerm && !dateEnd) return `${type.name} wajib punya tanggal berakhir`;
  if (dateEnd && type.maxMonths && dateEnd > contractLimitDate(dateStart, type.maxMonths))
    return `Masa ${type.name} paling lama ${type.maxMonths} bulan`;
  return null;
}
