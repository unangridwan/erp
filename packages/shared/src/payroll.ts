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

/**
 * Iuran BPJS dari upah (gaji pokok + tunjangan tetap). `onlyJkkJkm`: pekerja harian lepas/borongan yang belum memenuhi
 * masa kerja kepesertaan penuh hanya diikutkan JKK & JKM.
 */
export function bpjsContributions(
  wage: Decimal.Value,
  s: BpjsSettings = DEFAULT_BPJS,
  onlyJkkJkm = false,
  enrollment: BpjsEnrollment = FULL_ENROLLMENT,
) {
  const w = Decimal.max(d(wage), 0);
  const kesBase = Decimal.min(w, s.kesWageCap);
  const jpBase = Decimal.min(w, s.jpWageCap);
  const pct = (base: Decimal, rate: Decimal.Value) => rupiah(base.times(rate).div(100)).toFixed(0);
  const full = (v: string) => (onlyJkkJkm ? "0" : v);
  // Tidak terdaftar pada program → iuran program itu nol.
  const on = {
    jkk: enrollment.tk && (enrollment.jkk ?? true),
    jkm: enrollment.tk && (enrollment.jkm ?? true),
    jht: enrollment.tk && (enrollment.jht ?? true),
  };
  const kes = (v: string) => (enrollment.kes ? full(v) : "0");
  const prog = (flag: boolean, v: string) => (flag ? v : "0");
  const jp = (v: string) => (enrollment.tk && enrollment.jp ? full(v) : "0");
  const anyTk = on.jkk || on.jkm || on.jht || (enrollment.tk && enrollment.jp);
  return {
    employer: {
      kes: kes(pct(kesBase, 4)),
      jht: prog(on.jht, full(pct(w, 3.7))),
      jkk: prog(on.jkk, pct(w, s.jkkRate)),
      jkm: prog(on.jkm, pct(w, 0.3)),
      jp: jp(pct(jpBase, 2)),
    },
    employee: {
      kes: kes(pct(kesBase, 1)),
      jht: prog(on.jht, full(pct(w, 2))),
      jp: jp(pct(jpBase, 1)),
    },
    /** Dasar upah iuran: Kesehatan dibatasi batas upah Kes; Ketenagakerjaan = upah (JP dibatasi tersendiri). */
    kesWage: enrollment.kes && !onlyJkkJkm ? kesBase.toFixed(0) : "0",
    tkWage: anyTk ? w.toFixed(0) : "0",
  };
}

/** Kepesertaan karyawan per program BPJS. */
export interface BpjsEnrollment {
  kes: boolean;
  tk: boolean;
  /** Jaminan Pensiun (bagian BPJS Ketenagakerjaan). */
  jp: boolean;
  /** Program BPJS Ketenagakerjaan satu per satu (bawaan: ikut `tk`). */
  jkk?: boolean;
  jkm?: boolean;
  jht?: boolean;
}

export const FULL_ENROLLMENT: BpjsEnrollment = { kes: true, tk: true, jp: true };

/** Program BPJS sebuah kode baris slip: Kesehatan atau Ketenagakerjaan (JHT, JKK, JKM, JP). */
export const bpjsProgram = (code: string): "kes" | "tk" => (code.startsWith("BPJS_KES") ? "kes" : "tk");

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

/**
 * Hari kerja dalam rentang (inklusif), tidak termasuk hari libur. `workDays` = hari kerja jadwal (0 = Minggu);
 * bawaan Senin–Jumat.
 */
export function workingDays(
  from: string,
  to: string,
  holidays: string[] = [],
  workDays: readonly number[] = [1, 2, 3, 4, 5],
): number {
  const off = new Set(holidays);
  let count = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t);
    const iso = day.toISOString().slice(0, 10);
    if (workDays.includes(day.getUTCDay()) && !off.has(iso)) count++;
  }
  return count;
}

/** Kode baris tunjangan PPh 21 (gross-up). */
export const GROSS_UP_CODE = "TUNJ_PPH21";

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
  /** Potongan keterlambatan bulan ini (mengurangi upah). */
  latePenalty?: Decimal.Value;
  /**
   * Pekerja harian lepas / borongan: `wage` = upah periode (hari × upah harian, atau satuan × tarif). BPJS dari
   * `bpjsWage`; PPh 21 memakai tarif harian per hari kerja (bukan TER bulanan).
   */
  casual?: { kind: "daily" | "piece"; days: number; bpjsWage: Decimal.Value; onlyJkkJkm: boolean };
  /** Kepesertaan BPJS Kesehatan / Ketenagakerjaan / JP (bawaan: ikut semua). */
  enrollment?: BpjsEnrollment;
  /** Gross-up: perusahaan menanggung PPh 21 lewat tunjangan PPh 21 yang besarnya sama dengan pajaknya. */
  grossUp?: boolean;
  /**
   * Kategori PPh 21 dari jenis kontrak: pegawai tetap (TER/tahunan), tidak tetap (tarif harian), bukan pegawai
   * (Pasal 17 atas 50% bruto), atau tidak dipotong. Bawaan: tidak tetap bila `casual`, selain itu pegawai tetap.
   */
  taxCategory?: "permanent" | "non_permanent" | "non_employee" | "none";
  /**
   * Slip koreksi: hanya selisih (tanpa gaji pokok & BPJS); PPh 21 dihitung atas bruto gabungan masa yang sama
   * dikurangi PPh 21 yang sudah dipotong di slip sebelumnya (`sameMonth`).
   */
  correction?: boolean;
  sameMonth?: { gross: Decimal.Value; pph21: Decimal.Value; employeePension: Decimal.Value };
  /**
   * Benefit yang dibayar perusahaan ke pihak ketiga (premi asuransi, iuran DPLK, fasilitas): tidak menambah gaji
   * bersih; yang `taxable` (natura) menambah penghasilan bruto PPh 21.
   */
  employerBenefits?: { code: string; name: string; amount: Decimal.Value; taxable: boolean }[];
  /** Iuran pensiun dibayar karyawan di luar BPJS (DPLK): pengurang penghasilan bruto PPh 21 setahun. */
  extraPension?: Decimal.Value;
}

export type PayslipCategory =
  | "basic"
  | "allowance"
  | "overtime"
  | "unpaid"
  | "deduction"
  | "bpjs_employee"
  | "bpjs_employer"
  | "benefit_employer"
  | "tax";

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

  const basicName = !input.casual
    ? "Gaji pokok"
    : input.casual.kind === "daily"
      ? `Upah harian (${input.casual.days} hari)`
      : "Upah borongan";
  if (!input.correction || !wage.isZero())
    lines.push({ code: "BASIC", name: basicName, category: "basic", amount: rupiah(wage).toFixed(0) });
  for (const a of input.allowances) {
    lines.push({ code: a.code, name: a.name, category: "allowance", amount: rupiah(d(a.amount)).toFixed(0) });
  }
  const grossUpAt = lines.length;
  const overtime = input.overtime.reduce((s, o) => s.plus(overtimePay(baseWage, o.hours, o.day)), d(0));
  if (overtime.gt(0))
    lines.push({ code: "OT", name: "Lembur", category: "overtime", amount: overtime.toFixed(0) });
  const absent =
    !input.casual && input.unpaidDays > 0 && input.workingDays > 0
      ? rupiah(baseWage.times(Math.min(input.unpaidDays, input.workingDays)).div(input.workingDays))
      : d(0);
  if (absent.gt(0))
    lines.push({
      code: "UNPAID",
      name: "Potongan hari tidak dibayar",
      category: "unpaid",
      amount: absent.negated().toFixed(0),
    });
  const late = rupiah(Decimal.max(d(input.latePenalty ?? 0), 0));
  if (late.gt(0))
    lines.push({
      code: "LATE",
      name: "Potongan keterlambatan",
      category: "unpaid",
      amount: late.negated().toFixed(0),
    });
  const unpaid = absent.plus(late);

  const enrollment = input.enrollment ?? FULL_ENROLLMENT;
  const bpjs = input.casual
    ? bpjsContributions(input.casual.bpjsWage, input.bpjs, input.casual.onlyJkkJkm, enrollment)
    : bpjsContributions(baseWage, input.bpjs, false, enrollment);
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
  const benefits = (input.employerBenefits ?? []).filter((b) => d(b.amount).gt(0));
  for (const b of benefits)
    lines.push({
      code: b.code,
      name: b.name,
      category: "benefit_employer",
      amount: rupiah(d(b.amount)).toFixed(0),
    });

  const taxableBase = wage
    .plus(input.allowances.filter((a) => a.taxable !== false).reduce((s, a) => s.plus(a.amount), d(0)))
    .plus(overtime)
    .minus(unpaid)
    .plus(bpjs.employer.jkk)
    .plus(bpjs.employer.jkm)
    .plus(bpjs.employer.kes)
    .plus(benefits.filter((b) => b.taxable).reduce((s, b) => s.plus(rupiah(d(b.amount))), d(0)));
  const pension = d(bpjs.employee.jht).plus(bpjs.employee.jp);
  // Pengurang PPh 21: iuran JHT & JP BPJS + iuran pensiun lain (DPLK) yang dibayar karyawan.
  const taxPension = pension.plus(rupiah(Decimal.max(d(input.extraPension ?? 0), 0)));
  const prior = input.sameMonth ?? { gross: 0, pph21: 0, employeePension: 0 };

  /** PPh 21 slip ini bila bruto ditambah tunjangan PPh 21 sebesar `extra`. */
  const taxOn = (extra: Decimal) => {
    const gross = rupiah(taxableBase.plus(extra));
    const masaGross = gross.plus(prior.gross);
    const monthly = pph21Monthly(masaGross, input.status, input.hasNpwp);
    let pph21 = d(monthly.tax);
    let annual: ReturnType<typeof pph21Annual> | null = null;
    const category = input.taxCategory ?? (input.casual ? "non_permanent" : "permanent");
    if (category === "none") {
      pph21 = d(0);
    } else if (category === "non_employee") {
      // Bukan pegawai (PMK 168/2023): tarif Pasal 17 atas 50% penghasilan bruto, tanpa PTKP; tanpa NPWP +20%.
      const tax = d(progressiveTax(masaGross.times(0.5)));
      pph21 = taxFloor(input.hasNpwp ? tax : tax.times(1.2));
    } else if (category === "non_permanent") {
      // Pegawai tidak tetap: tarif harian atas rata-rata bruto per hari kerja.
      const days = Math.max(input.casual?.days ?? input.workingDays, 1);
      pph21 = d(pph21Daily(masaGross.div(days), input.hasNpwp)).times(days);
    } else if (input.isFinal) {
      annual = pph21Annual({
        annualGross: d(input.ytd.gross).plus(masaGross),
        months: input.ytd.months + 1,
        employeePension: d(input.ytd.employeePension).plus(prior.employeePension).plus(taxPension),
        status: input.status,
        hasNpwp: input.hasNpwp,
      });
      // Bisa negatif: kelebihan potong dikembalikan ke karyawan.
      pph21 = d(annual.tax).minus(input.ytd.pph21);
    }
    return { gross, monthly, annual, pph21: pph21.minus(prior.pph21) };
  };
  let taxAllowance = d(0);
  let tax = taxOn(taxAllowance);
  if (input.grossUp) {
    // Iterasi titik tetap tunjangan = pajak; bila berputar di batas lapisan TER, ambil yang terbesar.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const next = Decimal.max(tax.pph21, 0);
      if (next.eq(taxAllowance)) break;
      if (seen.has(next.toFixed(0))) {
        taxAllowance = Decimal.max(taxAllowance, next);
        tax = taxOn(taxAllowance);
        break;
      }
      seen.add(next.toFixed(0));
      taxAllowance = next;
      tax = taxOn(taxAllowance);
    }
    if (taxAllowance.gt(0))
      lines.splice(grossUpAt, 0, {
        code: GROSS_UP_CODE,
        name: "Tunjangan PPh 21",
        category: "allowance",
        amount: taxAllowance.toFixed(0),
      });
  }
  const { gross, monthly, annual, pph21 } = tax;
  const earnings = wage
    .plus(input.allowances.reduce((s, a) => s.plus(a.amount), d(0)))
    .plus(taxAllowance)
    .plus(overtime)
    .minus(unpaid);
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
  const sum = (rows: [string, string, string][], program: "kes" | "tk") =>
    rows
      .filter(([code]) => bpjsProgram(code) === program)
      .reduce((t, [, , a]) => t.plus(a), d(0))
      .toFixed(0);
  return {
    lines,
    earnings: rupiah(earnings).toFixed(0),
    gross: gross.toFixed(0),
    terCategory: monthly.category,
    terRate: input.isFinal || input.casual ? null : monthly.rate,
    pph21: pph21.toFixed(0),
    employeeBpjs: employeeBpjs.toFixed(0),
    employerBpjs: employerBpjs.toFixed(0),
    // BPJS Kesehatan dan Ketenagakerjaan selalu dilaporkan terpisah.
    kesEmployee: sum(employee, "kes"),
    kesEmployer: sum(employer, "kes"),
    tkEmployee: sum(employee, "tk"),
    tkEmployer: sum(employer, "tk"),
    kesWage: bpjs.kesWage,
    tkWage: bpjs.tkWage,
    employeePension: taxPension.toFixed(0),
    employerBenefits: benefits.reduce((s, b) => s.plus(rupiah(d(b.amount))), d(0)).toFixed(0),
    deductions: deductions.toFixed(0),
    net: rupiah(net).toFixed(0),
    annual,
  };
}

// ---- Jadwal kerja & keterlambatan ----

export interface WorkSchedule {
  /** Jam masuk lokal "HH:MM". */
  start: string;
  /** Toleransi keterlambatan (menit) sebelum dikenai potongan. */
  toleranceMinutes: number;
  /** Potongan per menit terlambat (dihitung dari jam masuk, bukan dari batas toleransi). */
  penaltyPerMinute: Decimal.Value;
  /** Potongan tetap per kejadian terlambat. */
  penaltyPerOccurrence: Decimal.Value;
  /** Hari kerja (0 = Minggu … 6 = Sabtu). */
  workDays: number[];
}

/** Tanggal & menit-sejak-tengah-malam waktu lokal untuk sebuah instan. */
function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/**
 * Keterlambatan dari absen masuk pertama setiap hari kerja (hari libur & di luar hari kerja jadwal tidak dihitung).
 * Terlambat bila masuk lewat dari jam masuk + toleransi; menit terlambat dihitung dari jam masuk.
 */
export function lateness(
  checkIns: { checkIn: Date | string; schedule: WorkSchedule }[],
  timeZone = "Asia/Jakarta",
  holidays: string[] = [],
) {
  const off = new Set(holidays);
  const first = new Map<string, { minutes: number; schedule: WorkSchedule }>();
  for (const c of checkIns) {
    const local = localParts(new Date(c.checkIn), timeZone);
    const prev = first.get(local.date);
    if (!prev || local.minutes < prev.minutes)
      first.set(local.date, { minutes: local.minutes, schedule: c.schedule });
  }
  const days: { date: string; minutes: number; penalty: string }[] = [];
  let total = d(0);
  for (const [date, { minutes, schedule }] of [...first.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (off.has(date) || !schedule.workDays.includes(weekday)) continue;
    const [h, m] = schedule.start.split(":").map(Number) as [number, number];
    const late = minutes - (h * 60 + m);
    if (late <= schedule.toleranceMinutes) continue;
    const penalty = rupiah(d(schedule.penaltyPerMinute).times(late).plus(schedule.penaltyPerOccurrence));
    total = total.plus(penalty);
    days.push({ date, minutes: late, penalty: penalty.toFixed(0) });
  }
  return {
    occurrences: days.length,
    minutes: days.reduce((s, x) => s + x.minutes, 0),
    penalty: total.toFixed(0),
    days,
  };
}

// ---- Pesangon (PP 35/2021) ----

/** Alasan PHK & pengali uang pesangon (UP) / uang penghargaan masa kerja (UPMK) menurut PP 35/2021. */
export const SEVERANCE_REASONS = {
  merger_refused: {
    article: "Pasal 41",
    label: "Penggabungan/peleburan/pemisahan perusahaan",
    up: 1,
    upmk: 1,
  },
  takeover: { article: "Pasal 42 ayat (1)", label: "Pengambilalihan perusahaan", up: 1, upmk: 1 },
  takeover_changed_terms: {
    article: "Pasal 42 ayat (2)",
    label: "Pengambilalihan dengan perubahan syarat kerja, pekerja tidak bersedia",
    up: 0.5,
    upmk: 1,
  },
  efficiency_loss: {
    article: "Pasal 43 ayat (1)",
    label: "Efisiensi karena perusahaan merugi",
    up: 0.5,
    upmk: 1,
  },
  efficiency_prevent_loss: {
    article: "Pasal 43 ayat (2)",
    label: "Efisiensi untuk mencegah kerugian",
    up: 1,
    upmk: 1,
  },
  closure_loss: { article: "Pasal 44 ayat (1)", label: "Perusahaan tutup karena merugi", up: 0.5, upmk: 1 },
  closure_no_loss: {
    article: "Pasal 44 ayat (2)",
    label: "Perusahaan tutup bukan karena merugi",
    up: 1,
    upmk: 1,
  },
  force_majeure_closure: {
    article: "Pasal 45 ayat (1)",
    label: "Keadaan memaksa, perusahaan tutup",
    up: 0.5,
    upmk: 1,
  },
  force_majeure_no_closure: {
    article: "Pasal 45 ayat (2)",
    label: "Keadaan memaksa, perusahaan tidak tutup",
    up: 0.75,
    upmk: 1,
  },
  pkpu_loss: { article: "Pasal 46 ayat (1)", label: "PKPU karena merugi", up: 0.5, upmk: 1 },
  pkpu_no_loss: { article: "Pasal 46 ayat (2)", label: "PKPU bukan karena merugi", up: 1, upmk: 1 },
  bankruptcy: { article: "Pasal 47", label: "Perusahaan pailit", up: 0.5, upmk: 1 },
  employer_misconduct: {
    article: "Pasal 48",
    label: "Permohonan pekerja karena perbuatan pengusaha",
    up: 1,
    upmk: 1,
  },
  resignation: { article: "Pasal 50", label: "Mengundurkan diri atas kemauan sendiri", up: 0, upmk: 0 },
  absence: { article: "Pasal 51", label: "Mangkir 5 hari kerja berturut-turut", up: 0, upmk: 0 },
  violation: {
    article: "Pasal 52 ayat (1)",
    label: "Pelanggaran PK/PP/PKB setelah surat peringatan",
    up: 0.5,
    upmk: 1,
  },
  urgent_violation: { article: "Pasal 52 ayat (2)", label: "Pelanggaran bersifat mendesak", up: 0, upmk: 0 },
  detention: { article: "Pasal 54", label: "Ditahan pihak berwajib", up: 0, upmk: 1 },
  long_illness: { article: "Pasal 55", label: "Sakit berkepanjangan lebih dari 12 bulan", up: 2, upmk: 1 },
  retirement: { article: "Pasal 56", label: "Memasuki usia pensiun", up: 1.75, upmk: 1 },
  death: { article: "Pasal 57", label: "Meninggal dunia", up: 2, upmk: 1 },
  pkwt_end: { article: "Pasal 15–16", label: "Berakhirnya PKWT (uang kompensasi)", up: 0, upmk: 0 },
} as const;
export type SeveranceReason = keyof typeof SEVERANCE_REASONS;

/** Bulan upah uang pesangon menurut masa kerja (Pasal 40 ayat 2). */
export function severanceMonths(years: Decimal.Value): number {
  return Math.min(Math.floor(d(years).toNumber()) + 1, 9);
}

/** Bulan upah UPMK menurut masa kerja (Pasal 40 ayat 3); di bawah 3 tahun tidak ada. */
export function longServiceMonths(years: Decimal.Value): number {
  const y = Math.floor(d(years).toNumber());
  if (y < 3) return 0;
  if (y >= 24) return 10;
  return Math.floor(y / 3) + 1;
}

/** PPh 21 final atas pesangon (PP 68/2009): 0% s.d. 50 jt, 5% s.d. 100 jt, 15% s.d. 500 jt, 25% di atasnya. */
export function severanceTax(amount: Decimal.Value): string {
  const brackets: Bracket[] = [
    [50_000_000, 0],
    [100_000_000, 5],
    [500_000_000, 15],
    [Infinity, 25],
  ];
  let remaining = d(amount);
  let lower = d(0);
  let tax = d(0);
  for (const [upTo, rate] of brackets) {
    if (remaining.lte(0)) break;
    const width = upTo === Infinity ? remaining : Decimal.min(remaining, d(upTo).minus(lower));
    tax = tax.plus(width.times(rate).div(100));
    remaining = remaining.minus(width);
    lower = d(upTo === Infinity ? 0 : upTo);
  }
  return taxFloor(tax).toFixed(0);
}

/** Masa kerja dalam tahun (desimal) dari tanggal masuk sampai tanggal berakhir. */
export function serviceYears(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return d(Math.max(months, 0)).div(12).toDecimalPlaces(4).toString();
}

/**
 * Hak akhir hubungan kerja (PP 35/2021): UP × pengali alasan, UPMK × pengali, uang penggantian hak (cuti tahunan
 * yang belum diambil, upah sehari = upah sebulan ÷ hari kerja sebulan) ditambah komponen lain, uang pisah (bila diatur
 * PK/PP/PKB), atau uang kompensasi PKWT (masa kerja ÷ 12 × upah). Upah = gaji pokok + tunjangan tetap.
 */
export function severance(input: {
  reason: SeveranceReason;
  joinDate: string;
  endDate: string;
  monthlyWage: Decimal.Value;
  unusedLeaveDays?: Decimal.Value;
  workDaysPerMonth?: number;
  otherRights?: Decimal.Value;
  separationPay?: Decimal.Value;
}) {
  const rule = SEVERANCE_REASONS[input.reason];
  const wage = d(input.monthlyWage);
  const years = serviceYears(input.joinDate, input.endDate);
  const upMonths = rule.up ? severanceMonths(years) : 0;
  const upmkMonths = rule.upmk ? longServiceMonths(years) : 0;
  const up = rupiah(wage.times(upMonths).times(rule.up));
  const upmk = rupiah(wage.times(upmkMonths).times(rule.upmk));
  const leave = rupiah(
    wage.div(input.workDaysPerMonth ?? 21).times(Decimal.max(d(input.unusedLeaveDays ?? 0), 0)),
  );
  const uph = leave.plus(d(input.otherRights ?? 0));
  const separation = rupiah(d(input.separationPay ?? 0));
  let pkwt = d(0);
  if (input.reason === "pkwt_end") {
    // Kompensasi PKWT: masa kerja ≥ 1 bulan; proporsional masa kerja ÷ 12 bulan.
    const months = d(years).times(12).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    pkwt = months.gte(1) ? rupiah(wage.times(months).div(12)) : d(0);
  }
  const gross = up.plus(upmk).plus(uph).plus(separation).plus(pkwt);
  const tax = d(severanceTax(gross));
  return {
    reason: input.reason,
    article: rule.article,
    label: rule.label,
    serviceYears: years,
    upMonths,
    upFactor: rule.up,
    up: up.toFixed(0),
    upmkMonths,
    upmkFactor: rule.upmk,
    upmk: upmk.toFixed(0),
    leaveCompensation: leave.toFixed(0),
    uph: rupiah(uph).toFixed(0),
    separationPay: separation.toFixed(0),
    pkwtCompensation: pkwt.toFixed(0),
    gross: rupiah(gross).toFixed(0),
    tax: tax.toFixed(0),
    net: rupiah(gross.minus(tax)).toFixed(0),
  };
}

// ---- Pekerja harian lepas & borongan ----

/**
 * PPh 21 pegawai tidak tetap per hari (PMK 168/2023): bruto sehari s.d. Rp450.000 → 0%; s.d. Rp2.500.000 → TER
 * harian 0,5%; di atasnya tarif Pasal 17 atas 50% bruto sehari.
 */
export function pph21Daily(dailyGross: Decimal.Value, hasNpwp = true): string {
  const g = d(dailyGross);
  let tax = g.lte(450_000) ? d(0) : g.lte(2_500_000) ? g.times(0.005) : d(progressiveTax(g.times(0.5)));
  if (!hasNpwp) tax = tax.times(1.2);
  return taxFloor(tax).toFixed(0);
}
