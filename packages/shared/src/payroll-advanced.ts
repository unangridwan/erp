import { Decimal } from "decimal.js";
import { toCsv } from "./csv.js";

/**
 * Payroll lanjutan (fungsi murni):
 * - THR keagamaan — Permenaker 6/2016.
 * - Rapel kenaikan upah yang berlaku mundur.
 * - Struktur & skala upah — PP 36/2021.
 * - File transfer gaji massal per bank (BCA, Mandiri, BRI, BNI) dan CSV umum.
 */

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const rupiah = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

/** Bulan penuh dari `from` sampai `to` (tanggal YYYY-MM-DD). */
export function fullMonths(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(months, 0);
}

export interface ThrInput {
  wageType: "monthly" | "daily" | "piece";
  /** Upah sebulan: gaji pokok + tunjangan tetap (bulanan). */
  monthlyWage: Decimal.Value;
  joinDate: string;
  /** Tanggal hari raya keagamaan (masa kerja dihitung sampai tanggal ini). */
  holidayDate: string;
  /** Harian lepas/borongan: upah bulanan yang sudah dibayar, terbaru dahulu (maks. 12 dipakai). */
  history?: Decimal.Value[];
}

/**
 * THR Permenaker 6/2016: masa kerja ≥ 12 bulan = 1 bulan upah; 1–12 bulan = masa kerja/12 × 1 bulan upah;
 * < 1 bulan tidak berhak. Pekerja harian lepas: rata-rata upah 12 bulan terakhir (atau selama masa kerja bila
 * kurang dari 12 bulan).
 */
export function thrAmount(input: ThrInput) {
  const serviceMonths = fullMonths(input.joinDate, input.holidayDate);
  if (input.holidayDate < input.joinDate || serviceMonths < 1)
    return { eligible: false, serviceMonths, basis: "none" as const, base: "0", amount: "0" };
  if (input.wageType !== "monthly") {
    const history = (input.history ?? []).slice(0, 12).map((x) => d(x));
    const base = history.length
      ? rupiah(history.reduce((s, x) => s.plus(x), d(0)).div(history.length))
      : d(0);
    return {
      eligible: true,
      serviceMonths,
      basis: "average" as const,
      base: base.toFixed(0),
      amount: base.toFixed(0),
    };
  }
  const base = rupiah(d(input.monthlyWage));
  if (serviceMonths >= 12)
    return {
      eligible: true,
      serviceMonths,
      basis: "full" as const,
      base: base.toFixed(0),
      amount: base.toFixed(0),
    };
  return {
    eligible: true,
    serviceMonths,
    basis: "prorata" as const,
    base: base.toFixed(0),
    amount: rupiah(base.times(serviceMonths).div(12)).toFixed(0),
  };
}

export interface RetroMonth {
  /** YYYY-MM */
  period: string;
  /** Gaji pokok + tunjangan tetap yang sudah dibayar pada bulan itu. */
  paid: Decimal.Value;
  /** Rapel yang sudah dibayar sebelumnya untuk bulan itu. */
  alreadyPaid?: Decimal.Value;
}

/**
 * Rapel: selisih upah baru (gaji pokok + tunjangan tetap) terhadap yang sudah dibayar untuk bulan-bulan sejak
 * tanggal berlaku. Bulan pertama diprorata hari kalender bila berlaku di tengah bulan; bulan sebelum tanggal
 * berlaku dan selisih negatif diabaikan.
 */
export function retroPay(input: { effectiveDate: string; monthlyDue: Decimal.Value; months: RetroMonth[] }) {
  const due = d(input.monthlyDue);
  const effMonth = input.effectiveDate.slice(0, 7);
  const lines = [...input.months]
    .filter((m) => m.period >= effMonth)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((m) => {
      let fraction = d(1);
      if (m.period === effMonth) {
        const [y, mo] = m.period.split("-").map(Number) as [number, number];
        const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const from = Number(input.effectiveDate.slice(8, 10));
        fraction = d(days - from + 1).div(days);
      }
      const gap = due.minus(m.paid);
      const diff = Decimal.max(rupiah(gap.times(fraction)).minus(d(m.alreadyPaid)), 0);
      return {
        period: m.period,
        paid: d(m.paid).toFixed(0),
        due: due.toFixed(0),
        fraction: fraction.toDecimalPlaces(4).toFixed(),
        diff: diff.toFixed(0),
      };
    })
    .filter((l) => d(l.diff).gt(0));
  return { lines, total: lines.reduce((s, l) => s.plus(l.diff), d(0)).toFixed(0) };
}

/** Posisi upah terhadap golongan (struktur & skala upah): di bawah, dalam, atau di atas rentang. */
export function gradePosition(
  wage: Decimal.Value,
  grade: { minWage?: Decimal.Value | null; maxWage?: Decimal.Value | null },
) {
  const w = d(wage);
  if (grade.minWage !== null && grade.minWage !== undefined && w.lt(grade.minWage)) return "below" as const;
  if (grade.maxWage !== null && grade.maxWage !== undefined && w.gt(grade.maxWage)) return "above" as const;
  return "within" as const;
}

/**
 * Gaji pokok kontrak dibandingkan golongan: standar (= gaji pokok golongan), disesuaikan manual, dan posisinya
 * terhadap rentang skala upah.
 */
export function gradeWageStatus(
  wage: Decimal.Value,
  grade: { minWage?: Decimal.Value | null; maxWage?: Decimal.Value | null; baseWage?: Decimal.Value | null },
) {
  const base = grade.baseWage === null || grade.baseWage === undefined ? null : d(grade.baseWage);
  return {
    standard: base ? base.toFixed(2) : null,
    adjusted: base ? !d(wage).eq(base) : false,
    difference: base ? d(wage).minus(base).toFixed(2) : null,
    position: gradePosition(wage, grade),
  };
}

// ---- Transfer gaji massal ----

export const BANK_FORMATS = ["bca", "mandiri", "bri", "bni", "csv"] as const;
export type BankFormat = (typeof BANK_FORMATS)[number];
export type BankCode = Exclude<BankFormat, "csv">;

export const BANK_LABELS: Record<BankCode, string> = {
  bca: "BCA (KlikBCA Bisnis)",
  mandiri: "Mandiri (MCM)",
  bri: "BRI (CMS / QLola)",
  bni: "BNI (BNIDirect)",
};

/** Kenali bank dari nama bebas di data karyawan (bank syariah anak usaha tidak dianggap bank induk). */
export function bankOf(name: string | null | undefined): BankCode | null {
  const n = (name ?? "").toUpperCase().replace(/[^A-Z ]/g, " ");
  if (/SYARIAH|BSI/.test(n)) return null;
  if (/\bBCA\b|CENTRAL ASIA/.test(n)) return "bca";
  if (/MANDIRI/.test(n)) return "mandiri";
  if (/\bBRI\b|RAKYAT INDONESIA/.test(n)) return "bri";
  if (/\bBNI\b|NEGARA INDONESIA/.test(n)) return "bni";
  return null;
}

export interface TransferRow {
  employeeNumber: string;
  name: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  amount: string;
}

export interface TransferHeader {
  /** Rekening sumber (debet) perusahaan. */
  sourceAccount: string;
  /** Corporate ID / kode perusahaan (opsional). */
  companyCode?: string | null;
  /** Tanggal efektif transfer (YYYY-MM-DD). */
  date: string;
  /** Keterangan transaksi, mis. "GAJI 2025-10". */
  remark: string;
}

/** Nama penerima: huruf/angka/spasi kapital, maks. 35 karakter (batas umum file massal bank). */
const beneficiary = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 35);
const accountNo = (s: string) => s.replace(/\D/g, "");
const remarkOf = (s: string, max: number) => beneficiary(s).slice(0, max);
const ymd = (date: string) => date.replace(/-/g, "");
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const join = (rows: (string | number)[][], sep: string) => rows.map((r) => r.join(sep)).join("\r\n") + "\r\n";

/**
 * File transfer gaji massal. Format bank memuat hanya karyawan dengan rekening di bank itu (transfer sesama bank);
 * sisanya dikembalikan di `skipped` untuk ditransfer dengan format lain/antarbank. Tata letak mengikuti templat
 * unggah massal umum tiap bank — cocokkan dengan templat terbaru dari bank sebelum dipakai produksi.
 */
export interface TransferFileOptions {
  /** Awalan nama file (bawaan "transfer-gaji"). */
  filePrefix?: string;
  /** Label kolom referensi & alasan nominal nol di file CSV (bawaan untuk gaji karyawan). */
  referenceLabel?: string;
  zeroReason?: string;
}

export function bankTransferFile(
  format: BankFormat,
  header: TransferHeader,
  rows: TransferRow[],
  opts: TransferFileOptions = {},
) {
  const valid = rows.filter((r) => accountNo(r.bankAccount) && d(r.amount).gt(0));
  const included = format === "csv" ? valid : valid.filter((r) => bankOf(r.bankName) === format);
  const skipped = rows
    .filter((r) => !included.includes(r))
    .map((r) => ({
      employeeNumber: r.employeeNumber,
      name: r.name,
      bankName: r.bankName,
      reason: !accountNo(r.bankAccount)
        ? "Rekening kosong"
        : d(r.amount).lte(0)
          ? (opts.zeroReason ?? "Gaji bersih nol")
          : "Bank berbeda",
    }));
  const total = included.reduce((s, r) => s.plus(r.amount), d(0)).toFixed(0);
  const source = accountNo(header.sourceAccount);
  const period = header.date.slice(0, 7);
  let content: string;
  let extension = "csv";
  switch (format) {
    case "bca":
      // KlikBCA Bisnis — transfer massal (payroll): baris header lalu detail rekening, nominal, nama.
      content = join(
        [
          [
            "H",
            header.companyCode ?? "",
            source,
            ymd(header.date),
            included.length,
            total,
            remarkOf(header.remark, 18),
          ],
          ...included.map((r, i) => [
            "D",
            i + 1,
            accountNo(r.bankAccount),
            d(r.amount).toFixed(0),
            beneficiary(r.bankAccountName || r.name),
            r.employeeNumber,
          ]),
        ],
        ",",
      );
      extension = "txt";
      break;
    case "mandiri":
      // Mandiri MCM — bulk transfer CSV: baris "P" (header) lalu baris penerima.
      content = join(
        [
          ["P", ymd(header.date), source, included.length, total],
          ...included.map((r) => [
            accountNo(r.bankAccount),
            beneficiary(r.bankAccountName || r.name),
            "IDR",
            d(r.amount).toFixed(0),
            remarkOf(header.remark, 35),
            r.employeeNumber,
            "IBU",
          ]),
        ],
        ",",
      );
      break;
    case "bri":
      // BRI CMS — payroll massal: pemisah titik koma, tanggal DD/MM/YYYY.
      content = join(
        [
          ["NO", "REKENING TUJUAN", "NAMA", "NOMINAL", "KETERANGAN", "REKENING SUMBER", "TANGGAL"],
          ...included.map((r, i) => [
            i + 1,
            accountNo(r.bankAccount),
            beneficiary(r.bankAccountName || r.name),
            d(r.amount).toFixed(0),
            remarkOf(header.remark, 30),
            source,
            dmy(header.date),
          ]),
        ],
        ";",
      );
      break;
    case "bni":
      // BNIDirect — bulk payment: header (jumlah & total) lalu detail.
      content = join(
        [
          [ymd(header.date), included.length, total, source, header.companyCode ?? ""],
          ...included.map((r) => [
            accountNo(r.bankAccount),
            beneficiary(r.bankAccountName || r.name),
            d(r.amount).toFixed(0),
            remarkOf(header.remark, 30),
            r.employeeNumber,
          ]),
        ],
        ",",
      );
      break;
    default:
      content = toCsv(
        [opts.referenceLabel ?? "NIK Karyawan", "Nama", "Bank", "No Rekening", "Atas Nama", "Jumlah"],
        included.map((r) => ({
          [opts.referenceLabel ?? "NIK Karyawan"]: r.employeeNumber,
          Nama: r.name,
          Bank: r.bankName,
          "No Rekening": accountNo(r.bankAccount),
          "Atas Nama": r.bankAccountName || r.name,
          Jumlah: d(r.amount).toFixed(0),
        })),
      );
  }
  return {
    filename: `${opts.filePrefix ?? "transfer-gaji"}-${format}-${period}.${extension}`,
    contentType: extension === "txt" ? "text/plain; charset=utf-8" : "text/csv; charset=utf-8",
    content,
    count: included.length,
    total,
    skipped,
  };
}

/**
 * Plafon klaim per kategori per tahun: sisa plafon setelah klaim lain (yang diajukan/disetujui/dibayar) dan
 * apakah klaim baru masih muat. Plafon kosong = tanpa batas.
 */
export function claimLimitCheck(input: {
  limit: Decimal.Value | null;
  used: Decimal.Value;
  amount: Decimal.Value;
}) {
  if (input.limit === null || input.limit === undefined)
    return { ok: true, remaining: null as string | null, excess: "0" };
  const remaining = Decimal.max(d(input.limit).minus(input.used), 0);
  const excess = Decimal.max(d(input.amount).minus(remaining), 0);
  return { ok: excess.isZero(), remaining: remaining.toFixed(0), excess: excess.toFixed(0) };
}
