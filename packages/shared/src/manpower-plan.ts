import { Decimal } from "decimal.js";
import { z } from "zod";
import { bpjsContributions, DEFAULT_BPJS, type BpjsSettings } from "./payroll.js";

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

export const MANPOWER_LINE_KINDS = ["existing", "new", "replacement"] as const;
export type ManpowerLineKind = (typeof MANPOWER_LINE_KINDS)[number];
export const MANPOWER_LINE_KIND_LABEL: Record<ManpowerLineKind, [string, string]> = {
  existing: ["Posisi terisi", "Existing"],
  new: ["Tambahan", "New position"],
  replacement: ["Pengganti", "Replacement"],
};

export interface ManpowerLine {
  jobId: string;
  kind: ManpowerLineKind;
  quantity: number;
  startMonth: number;
  endMonth?: number | null;
  monthlyWage: Decimal.Value;
  monthlyAllowance?: Decimal.Value | null;
}

export interface ManpowerMonth {
  month: number;
  headcount: number;
  salary: number;
  bpjsKes: number;
  bpjsTk: number;
  /** Gaji + tunjangan + THR + BPJS perusahaan. */
  cost: number;
}

const empty = (): ManpowerMonth[] =>
  Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    headcount: 0,
    salary: 0,
    bpjsKes: 0,
    bpjsTk: 0,
    cost: 0,
  }));

/** Bulan aktif suatu baris; pengganti tidak menambah headcount/biaya (menggantikan posisi yang sudah dihitung). */
export const lineActive = (l: ManpowerLine, month: number) =>
  l.kind !== "replacement" && month >= l.startMonth && (l.endMonth == null || month <= l.endMonth);

/**
 * Rencana per bulan untuk sekumpulan baris: headcount, gaji+tunjangan, BPJS perusahaan (dasar = upah + tunjangan
 * tetap), dan THR (1 bulan upah, prorata bulan aktif) pada `thrMonth`.
 */
export function planMonthly(
  lines: ManpowerLine[],
  bpjs: BpjsSettings = DEFAULT_BPJS,
  thrMonth?: number | null,
): ManpowerMonth[] {
  const months = empty();
  for (const l of lines) {
    if (!l.quantity) continue;
    const pay = d(l.monthlyWage).plus(d(l.monthlyAllowance));
    const er = bpjsContributions(pay, bpjs).employer;
    const kes = d(er.kes).times(l.quantity);
    const tk = d(er.jht).plus(er.jkk).plus(er.jkm).plus(er.jp).times(l.quantity);
    let active = 0;
    for (const m of months) {
      if (!lineActive(l, m.month)) continue;
      active++;
      m.headcount += l.quantity;
      m.salary = d(m.salary).plus(pay.times(l.quantity)).toNumber();
      m.bpjsKes = d(m.bpjsKes).plus(kes).toNumber();
      m.bpjsTk = d(m.bpjsTk).plus(tk).toNumber();
    }
    if (thrMonth && active) {
      const thr = pay.times(l.quantity).times(active).div(12).toDecimalPlaces(0);
      const m = months[thrMonth - 1]!;
      m.salary = d(m.salary).plus(thr).toNumber();
    }
  }
  for (const m of months) m.cost = d(m.salary).plus(m.bpjsKes).plus(m.bpjsTk).toNumber();
  return months;
}

/** Ringkasan rencana: headcount awal & akhir tahun, tambahan, pengganti, total biaya. */
export function planSummary(lines: ManpowerLine[], bpjs?: BpjsSettings, thrMonth?: number | null) {
  const months = planMonthly(lines, bpjs, thrMonth);
  const sum = (k: "salary" | "bpjsKes" | "bpjsTk" | "cost") =>
    months.reduce((s, m) => s.plus(m[k]), new Decimal(0)).toNumber();
  const qty = (kind: ManpowerLineKind) =>
    lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.quantity, 0);
  return {
    startHeadcount: months[0]!.headcount,
    endHeadcount: months[11]!.headcount,
    peakHeadcount: Math.max(...months.map((m) => m.headcount)),
    existing: qty("existing"),
    additions: qty("new"),
    replacements: qty("replacement"),
    salary: sum("salary"),
    bpjsKes: sum("bpjsKes"),
    bpjsTk: sum("bpjsTk"),
    annualCost: sum("cost"),
    months,
  };
}

export type RealizationStatus = "not_started" | "recruiting" | "partial" | "fulfilled";

/** Status pemenuhan baris tambahan/pengganti dari lowongan & pelamar yang diterima. */
export function lineRealization(quantity: number, hasOpening: boolean, hired: number): RealizationStatus {
  if (quantity > 0 && hired >= quantity) return "fulfilled";
  if (hired > 0) return "partial";
  return hasOpening ? "recruiting" : "not_started";
}

const amount = z.coerce
  .number()
  .min(0, "Tidak boleh negatif")
  .transform((v) => v.toFixed(2));
const month = z.coerce.number().int().min(1, "Bulan 1–12").max(12, "Bulan 1–12");

export const manpowerPlanLineSchema = z
  .object({
    jobId: z.string().uuid(),
    gradeId: z.string().uuid().nullish(),
    kind: z.enum(MANPOWER_LINE_KINDS),
    quantity: z.coerce.number().int().min(0).max(10000),
    startMonth: month.default(1),
    endMonth: month.nullish(),
    monthlyWage: amount.default(0),
    monthlyAllowance: amount.default(0),
    reason: z.string().trim().max(300).nullish(),
    replacesEmployeeId: z.string().uuid().nullish(),
  })
  .refine((l) => l.endMonth == null || l.endMonth >= l.startMonth, {
    path: ["endMonth"],
    message: "Bulan akhir sebelum bulan mulai",
  })
  .refine((l) => l.kind === "existing" || l.quantity > 0, {
    path: ["quantity"],
    message: "Jumlah posisi minimal 1",
  });

export const manpowerPlanSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  thrMonth: month.nullish(),
  note: z.string().trim().max(1000).nullish(),
  lines: z.array(manpowerPlanLineSchema).max(500).optional(),
});
export const manpowerPlanCreateSchema = manpowerPlanSchema.extend({
  year: z.coerce.number().int().min(2000).max(2100),
  departmentId: z.string().uuid(),
});
export type ManpowerPlanInput = z.infer<typeof manpowerPlanSchema>;
