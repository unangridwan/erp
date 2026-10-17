import { Decimal } from "decimal.js";

/**
 * Perhitungan payroll Indonesia (fungsi murni, tanpa I/O):
 * - PPh 21 pegawai tetap metode Tarif Efektif Rata-rata (TER) — PP 58/2023 & PMK 168/2023:
 *   Januari–November = TER × penghasilan bruto bulanan; masa pajak terakhir (Desember / bulan berhenti bekerja)
 *   = PPh 21 setahun (tarif Pasal 17) − PPh 21 yang sudah dipotong.
 * - BPJS Kesehatan & Ketenagakerjaan (JHT, JKK, JKM, JP) dengan batas upah.
 * - Upah lembur — PP 35/2021 (upah sejam = 1/173 × upah sebulan).
 */

const d = (v: Decimal.Value) => new Decimal(v ?? 0);
const rupiah = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
/** PPh dibulatkan ke bawah ke rupiah penuh. */
const taxFloor = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_DOWN);

export const PTKP_STATUSES = ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"] as const;
export type PtkpStatus = (typeof PTKP_STATUSES)[number];
export type TerCategory = "A" | "B" | "C";

/** PTKP setahun (PMK 101/PMK.010/2016): diri sendiri 54 jt, kawin +4,5 jt, tiap tanggungan +4,5 jt (maks. 3). */
export function ptkpAmount(status: PtkpStatus): string {
  const [marital, deps] = status.split("/") as [string, string];
  return d(54_000_000)
    .plus(marital === "K" ? 4_500_000 : 0)
    .plus(d(4_500_000).times(Number(deps)))
    .toFixed(0);
}

/** Kategori TER: A = TK/0, TK/1, K/0; B = TK/2, TK/3, K/1, K/2; C = K/3. */
export function terCategory(status: PtkpStatus): TerCategory {
  if (status === "TK/0" || status === "TK/1" || status === "K/0") return "A";
  if (status === "K/3") return "C";
  return "B";
}

/** Batas atas bruto bulanan (Rp) & tarif (%) per lapisan, dari Lampiran PP 58/2023. Lapisan terakhir tanpa batas. */
type Bracket = [upTo: number, rate: number];
const TER: Record<TerCategory, Bracket[]> = {
  A: [
    [5_400_000, 0],
    [5_650_000, 0.25],
    [5_950_000, 0.5],
    [6_300_000, 0.75],
    [6_750_000, 1],
    [7_500_000, 1.25],
    [8_550_000, 1.5],
    [9_650_000, 1.75],
    [10_050_000, 2],
    [10_350_000, 2.25],
    [10_700_000, 2.5],
    [11_050_000, 3],
    [11_600_000, 3.5],
    [12_500_000, 4],
    [13_750_000, 5],
    [15_100_000, 6],
    [16_950_000, 7],
    [19_750_000, 8],
    [24_150_000, 9],
    [26_450_000, 10],
    [28_000_000, 11],
    [30_050_000, 12],
    [32_400_000, 13],
    [35_400_000, 14],
    [39_100_000, 15],
    [43_850_000, 16],
    [47_800_000, 17],
    [51_400_000, 18],
    [56_300_000, 19],
    [62_200_000, 20],
    [68_600_000, 21],
    [77_500_000, 22],
    [89_000_000, 23],
    [103_000_000, 24],
    [125_000_000, 25],
    [157_000_000, 26],
    [206_000_000, 27],
    [337_000_000, 28],
    [454_000_000, 29],
    [550_000_000, 30],
    [695_000_000, 31],
    [910_000_000, 32],
    [1_400_000_000, 33],
    [Infinity, 34],
  ],
  B: [
    [6_200_000, 0],
    [6_500_000, 0.25],
    [6_850_000, 0.5],
    [7_300_000, 0.75],
    [9_200_000, 1],
    [10_750_000, 1.5],
    [11_250_000, 2],
    [11_600_000, 2.5],
    [12_600_000, 3],
    [13_600_000, 4],
    [14_950_000, 5],
    [16_400_000, 6],
    [18_450_000, 7],
    [21_850_000, 8],
    [26_000_000, 9],
    [27_700_000, 10],
    [29_350_000, 11],
    [31_450_000, 12],
    [33_950_000, 13],
    [37_100_000, 14],
    [41_100_000, 15],
    [45_800_000, 16],
    [49_500_000, 17],
    [53_800_000, 18],
    [58_500_000, 19],
    [64_000_000, 20],
    [71_000_000, 21],
    [80_000_000, 22],
    [93_000_000, 23],
    [109_000_000, 24],
    [129_000_000, 25],
    [163_000_000, 26],
    [211_000_000, 27],
    [374_000_000, 28],
    [459_000_000, 29],
    [555_000_000, 30],
    [704_000_000, 31],
    [957_000_000, 32],
    [1_405_000_000, 33],
    [Infinity, 34],
  ],
  C: [
    [6_600_000, 0],
    [6_950_000, 0.25],
    [7_350_000, 0.5],
    [7_800_000, 0.75],
    [8_850_000, 1],
    [9_800_000, 1.25],
    [10_950_000, 1.5],
    [11_200_000, 1.75],
    [12_050_000, 2],
    [12_950_000, 3],
    [14_150_000, 4],
    [15_550_000, 5],
    [17_050_000, 6],
    [19_500_000, 7],
    [22_700_000, 8],
    [26_600_000, 9],
    [28_100_000, 10],
    [30_100_000, 11],
    [32_600_000, 12],
    [35_400_000, 13],
    [38_900_000, 14],
    [43_000_000, 15],
    [47_400_000, 16],
    [51_200_000, 17],
    [55_800_000, 18],
    [60_400_000, 19],
    [66_700_000, 20],
    [74_500_000, 21],
    [83_200_000, 22],
    [95_600_000, 23],
    [110_000_000, 24],
    [134_000_000, 25],
    [169_000_000, 26],
    [221_000_000, 27],
    [390_000_000, 28],
    [463_000_000, 29],
    [561_000_000, 30],
    [709_000_000, 31],
    [965_000_000, 32],
    [1_419_000_000, 33],
    [Infinity, 34],
  ],
};

/** Tarif TER (%) untuk penghasilan bruto sebulan. */
export function terRate(category: TerCategory, monthlyGross: Decimal.Value): string {
  const gross = d(monthlyGross);
  const bracket = TER[category].find(([upTo]) => gross.lte(upTo))!;
  return String(bracket[1]);
}

/** PPh 21 bulanan metode TER; tanpa NPWP dikenai tarif 20% lebih tinggi. */
export function pph21Monthly(monthlyGross: Decimal.Value, status: PtkpStatus, hasNpwp = true) {
  const category = terCategory(status);
  const rate = terRate(category, monthlyGross);
  let tax = d(monthlyGross).times(rate).div(100);
  if (!hasNpwp) tax = tax.times(1.2);
  return { category, rate, tax: taxFloor(Decimal.max(tax, 0)).toFixed(0) };
}

/** Tarif progresif Pasal 17 ayat (1) huruf a UU PPh (UU HPP). */
const PROGRESSIVE: Bracket[] = [
  [60_000_000, 5],
  [250_000_000, 15],
  [500_000_000, 25],
  [5_000_000_000, 30],
  [Infinity, 35],
];

export function progressiveTax(pkp: Decimal.Value): string {
  let remaining = d(pkp);
  let lower = d(0);
  let tax = d(0);
  for (const [upTo, rate] of PROGRESSIVE) {
    if (remaining.lte(0)) break;
    const width = upTo === Infinity ? remaining : Decimal.min(remaining, d(upTo).minus(lower));
    tax = tax.plus(width.times(rate).div(100));
    remaining = remaining.minus(width);
    lower = d(upTo === Infinity ? 0 : upTo);
  }
  return taxFloor(tax).toFixed(0);
}

/**
 * PPh 21 setahun untuk masa pajak terakhir: bruto − biaya jabatan (5%, maks. Rp500.000 × bulan bekerja)
 * − iuran JHT & JP yang dibayar pegawai = neto; PKP = neto − PTKP (dibulatkan ke bawah ke ribuan).
 */
export function pph21Annual(input: {
  annualGross: Decimal.Value;
  months: number;
  employeePension: Decimal.Value;
  status: PtkpStatus;
  hasNpwp?: boolean;
}) {
  const gross = d(input.annualGross);
  const biayaJabatan = Decimal.min(
    gross.times(0.05),
    d(500_000).times(Math.min(Math.max(input.months, 1), 12)),
  );
  const neto = gross.minus(biayaJabatan).minus(input.employeePension);
  const ptkp = d(ptkpAmount(input.status));
  const pkp = Decimal.max(neto.minus(ptkp), 0).div(1000).floor().times(1000);
  let tax = d(progressiveTax(pkp));
  if (input.hasNpwp === false) tax = taxFloor(tax.times(1.2));
  return {
    biayaJabatan: rupiah(biayaJabatan).toFixed(0),
    neto: rupiah(neto).toFixed(0),
    ptkp: ptkp.toFixed(0),
    pkp: pkp.toFixed(0),
    tax: tax.toFixed(0),
  };
}

export interface BpjsSettings {
  /** Tarif JKK (%) sesuai kelompok risiko: 0,24 / 0,54 / 0,89 / 1,27 / 1,74. */
  jkkRate: Decimal.Value;
  /** Batas upah BPJS Kesehatan (Perpres 64/2020: Rp12.000.000). */
  kesWageCap: Decimal.Value;
  /** Batas upah Jaminan Pensiun (disesuaikan BPJS tiap Maret). */
  jpWageCap: Decimal.Value;
}

export const DEFAULT_BPJS: BpjsSettings = { jkkRate: "0.24", kesWageCap: "12000000", jpWageCap: "10547400" };

/** Iuran BPJS dari upah (gaji pokok + tunjangan tetap). */
export function bpjsContributions(wage: Decimal.Value, s: BpjsSettings = DEFAULT_BPJS) {
  const w = Decimal.max(d(wage), 0);
  const kesBase = Decimal.min(w, s.kesWageCap);
  const jpBase = Decimal.min(w, s.jpWageCap);
  const pct = (base: Decimal, rate: Decimal.Value) => rupiah(base.times(rate).div(100)).toFixed(0);
  return {
    employer: {
      kes: pct(kesBase, 4),
      jht: pct(w, 3.7),
      jkk: pct(w, s.jkkRate),
      jkm: pct(w, 0.3),
      jp: pct(jpBase, 2),
    },
    employee: {
      kes: pct(kesBase, 1),
      jht: pct(w, 2),
      jp: pct(jpBase, 1),
    },
  };
}

export type OvertimeDay = "workday" | "rest_day";

/**
 * Upah lembur (PP 35/2021, pola 5 hari kerja): upah sejam = 1/173 × upah sebulan.
 * Hari kerja: jam ke-1 × 1,5, berikutnya × 2. Hari istirahat/libur: jam 1–8 × 2, jam ke-9 × 3, jam 10–12 × 4.
 */
export function overtimePay(monthlyWage: Decimal.Value, hours: Decimal.Value, day: OvertimeDay): string {
  const hourly = d(monthlyWage).div(173);
  const h = d(hours);
  let multiplier: Decimal;
  if (day === "workday") {
    multiplier = Decimal.min(h, 1)
      .times(1.5)
      .plus(Decimal.max(h.minus(1), 0).times(2));
  } else {
    multiplier = Decimal.min(h, 8)
      .times(2)
      .plus(Decimal.min(Decimal.max(h.minus(8), 0), 1).times(3))
      .plus(Decimal.max(h.minus(9), 0).times(4));
  }
  return rupiah(hourly.times(multiplier)).toFixed(0);
}

/** Hari kerja Senin–Jumat dalam rentang (inklusif), tidak termasuk hari libur. */
export function workingDays(from: string, to: string, holidays: string[] = []): number {
  const off = new Set(holidays);
  let count = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t);
    const iso = day.toISOString().slice(0, 10);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !off.has(iso)) count++;
  }
  return count;
}

export interface PayslipItem {
  code: string;
  name: string;
  amount: Decimal.Value;
  /** Tunjangan tetap ikut dasar upah BPJS & lembur. */
  fixed?: boolean;
  /** Termasuk penghasilan bruto PPh 21 (bawaan: ya). */
  taxable?: boolean;
}

export interface PayslipInput {
  wage: Decimal.Value;
  allowances: PayslipItem[];
  deductions: PayslipItem[];
  overtime: { hours: Decimal.Value; day: OvertimeDay }[];
  unpaidDays: number;
  workingDays: number;
  status: PtkpStatus;
  hasNpwp: boolean;
  bpjs: BpjsSettings;
  /** Masa pajak terakhir (Desember atau bulan berhenti bekerja): hitung PPh 21 setahun. */
  isFinal: boolean;
  /** Akumulasi masa sebelumnya dalam tahun pajak yang sama (untuk masa terakhir). */
  ytd: { gross: Decimal.Value; pph21: Decimal.Value; employeePension: Decimal.Value; months: number };
}

export type PayslipCategory =
  "basic" | "allowance" | "overtime" | "unpaid" | "deduction" | "bpjs_employee" | "bpjs_employer" | "tax";

export interface PayslipLine {
  code: string;
  name: string;
  category: PayslipCategory;
  amount: string;
}

/**
 * Hitung satu slip gaji. Bruto PPh 21 = penghasilan kena pajak + premi JKK, JKM, dan BPJS Kesehatan yang dibayar
 * pemberi kerja (JHT & JP pemberi kerja tidak termasuk). Gaji bersih = penghasilan − iuran pegawai − PPh 21 − potongan.
 */
export function computePayslip(input: PayslipInput) {
  const lines: PayslipLine[] = [];
  const wage = d(input.wage);
  const fixed = input.allowances.filter((a) => a.fixed).reduce((s, a) => s.plus(a.amount), d(0));
  const baseWage = wage.plus(fixed);

  lines.push({ code: "BASIC", name: "Gaji pokok", category: "basic", amount: rupiah(wage).toFixed(0) });
  for (const a of input.allowances) {
    lines.push({ code: a.code, name: a.name, category: "allowance", amount: rupiah(d(a.amount)).toFixed(0) });
  }
  const overtime = input.overtime.reduce((s, o) => s.plus(overtimePay(baseWage, o.hours, o.day)), d(0));
  if (overtime.gt(0))
    lines.push({ code: "OT", name: "Lembur", category: "overtime", amount: overtime.toFixed(0) });
  const unpaid =
    input.unpaidDays > 0 && input.workingDays > 0
      ? rupiah(baseWage.times(Math.min(input.unpaidDays, input.workingDays)).div(input.workingDays))
      : d(0);
  if (unpaid.gt(0))
    lines.push({
      code: "UNPAID",
      name: "Potongan hari tidak dibayar",
      category: "unpaid",
      amount: unpaid.negated().toFixed(0),
    });

  const bpjs = bpjsContributions(baseWage, input.bpjs);
  const employer: [string, string, string][] = [
    ["BPJS_KES_ER", "BPJS Kesehatan (perusahaan 4%)", bpjs.employer.kes],
    ["JHT_ER", "BPJS JHT (perusahaan 3,7%)", bpjs.employer.jht],
    ["JKK", `BPJS JKK (perusahaan ${d(input.bpjs.jkkRate).toFixed().replace(".", ",")}%)`, bpjs.employer.jkk],
    ["JKM", "BPJS JKM (perusahaan 0,3%)", bpjs.employer.jkm],
    ["JP_ER", "BPJS JP (perusahaan 2%)", bpjs.employer.jp],
  ];
  const employee: [string, string, string][] = [
    ["BPJS_KES_EE", "BPJS Kesehatan (karyawan 1%)", bpjs.employee.kes],
    ["JHT_EE", "BPJS JHT (karyawan 2%)", bpjs.employee.jht],
    ["JP_EE", "BPJS JP (karyawan 1%)", bpjs.employee.jp],
  ];
  for (const [code, name, amount] of employer)
    if (d(amount).gt(0)) lines.push({ code, name, category: "bpjs_employer", amount });
  for (const [code, name, amount] of employee)
    if (d(amount).gt(0))
      lines.push({ code, name, category: "bpjs_employee", amount: d(amount).negated().toFixed(0) });

  const taxableEarnings = wage
    .plus(input.allowances.filter((a) => a.taxable !== false).reduce((s, a) => s.plus(a.amount), d(0)))
    .plus(overtime)
    .minus(unpaid);
  const earnings = wage
    .plus(input.allowances.reduce((s, a) => s.plus(a.amount), d(0)))
    .plus(overtime)
    .minus(unpaid);
  const gross = rupiah(
    taxableEarnings.plus(bpjs.employer.jkk).plus(bpjs.employer.jkm).plus(bpjs.employer.kes),
  );
  const pension = d(bpjs.employee.jht).plus(bpjs.employee.jp);

  const monthly = pph21Monthly(gross, input.status, input.hasNpwp);
  let pph21 = d(monthly.tax);
  let annual: ReturnType<typeof pph21Annual> | null = null;
  if (input.isFinal) {
    annual = pph21Annual({
      annualGross: d(input.ytd.gross).plus(gross),
      months: input.ytd.months + 1,
      employeePension: d(input.ytd.employeePension).plus(pension),
      status: input.status,
      hasNpwp: input.hasNpwp,
    });
    // Bisa negatif: kelebihan potong dikembalikan ke karyawan.
    pph21 = d(annual.tax).minus(input.ytd.pph21);
  }
  if (!pph21.isZero())
    lines.push({ code: "PPH21", name: "PPh 21", category: "tax", amount: pph21.negated().toFixed(0) });

  for (const x of input.deductions) {
    lines.push({
      code: x.code,
      name: x.name,
      category: "deduction",
      amount: rupiah(d(x.amount)).negated().toFixed(0),
    });
  }
  const employeeBpjs = d(bpjs.employee.kes).plus(pension);
  const deductions = input.deductions.reduce((s, x) => s.plus(rupiah(d(x.amount))), d(0));
  const employerBpjs = employer.reduce((s, [, , a]) => s.plus(a), d(0));
  const net = earnings.minus(employeeBpjs).minus(pph21).minus(deductions);
  return {
    lines,
    earnings: rupiah(earnings).toFixed(0),
    gross: gross.toFixed(0),
    terCategory: monthly.category,
    terRate: input.isFinal ? null : monthly.rate,
    pph21: pph21.toFixed(0),
    employeeBpjs: employeeBpjs.toFixed(0),
    employerBpjs: employerBpjs.toFixed(0),
    employeePension: pension.toFixed(0),
    deductions: deductions.toFixed(0),
    net: rupiah(net).toFixed(0),
    annual,
  };
}
