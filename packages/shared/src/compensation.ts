import { Decimal } from "decimal.js";
import { z } from "zod";
import { bpjsContributions, DEFAULT_BPJS, type BpjsSettings } from "./payroll.js";

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const rupiah = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

export const COMPENSATION_STATES = ["draft", "in_approval", "approved", "applied", "cancel"] as const;
export type CompensationState = (typeof COMPENSATION_STATES)[number];
export const COMPENSATION_STATE_LABEL: Record<CompensationState, [string, string]> = {
  draft: ["Draft", "Draft"],
  in_approval: ["Menunggu persetujuan", "Awaiting approval"],
  approved: ["Disetujui", "Approved"],
  applied: ["Diterapkan", "Applied"],
  cancel: ["Batal", "Cancelled"],
};

/** Upah baru dari persentase kenaikan (dibulatkan ke rupiah). */
export function newWageFromPercent(current: Decimal.Value, percent: Decimal.Value): string {
  return Decimal.max(rupiah(d(current).times(d(percent).plus(100)).div(100)), 0).toFixed(0);
}

/** Persentase kenaikan dari upah lama → baru (2 desimal). */
export function percentFromWage(current: Decimal.Value, next: Decimal.Value): string {
  if (d(current).isZero()) return "0.00";
  return d(next).minus(current).div(current).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Tambahan biaya tahunan perusahaan akibat perubahan upah: 12 bulan upah + THR (1 bulan) ditambah selisih iuran BPJS
 * perusahaan 12 bulan. `fixedAllowances` ikut dasar upah BPJS (tidak berubah oleh kenaikan).
 */
export function annualCostDelta(
  current: Decimal.Value,
  next: Decimal.Value,
  fixedAllowances: Decimal.Value = 0,
  bpjs: BpjsSettings = DEFAULT_BPJS,
): string {
  const employer = (wage: Decimal) =>
    Object.values(bpjsContributions(wage.plus(d(fixedAllowances)), bpjs).employer).reduce(
      (s, v) => s.plus(v),
      d(0),
    );
  const delta = d(next).minus(current);
  return rupiah(
    delta.times(13).plus(
      employer(d(next))
        .minus(employer(d(current)))
        .times(12),
    ),
  ).toFixed(0);
}

export interface CycleBudget {
  /** Total upah bulanan peserta sebelum kenaikan. */
  baseline: string;
  /** Anggaran tambahan upah bulanan. */
  budget: string;
  /** Tambahan upah bulanan dari usulan. */
  used: string;
  remaining: string;
  /** Rata-rata kenaikan tertimbang (%). */
  averagePercent: string;
  overBudget: boolean;
}

/** Anggaran siklus vs usulan: anggaran persen dihitung dari total upah peserta. */
export function cycleBudget(
  cycle: { budgetKind: "percent" | "amount"; budgetValue: Decimal.Value },
  proposals: { currentWage: Decimal.Value; newWage: Decimal.Value }[],
): CycleBudget {
  const baseline = proposals.reduce((s, p) => s.plus(d(p.currentWage)), d(0));
  const used = proposals.reduce((s, p) => s.plus(d(p.newWage).minus(d(p.currentWage))), d(0));
  const budget =
    cycle.budgetKind === "percent"
      ? rupiah(baseline.times(d(cycle.budgetValue)).div(100))
      : d(cycle.budgetValue);
  return {
    baseline: baseline.toFixed(0),
    budget: budget.toFixed(0),
    used: used.toFixed(0),
    remaining: budget.minus(used).toFixed(0),
    averagePercent: baseline.isZero()
      ? "0.00"
      : used.div(baseline).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    overBudget: used.gt(budget),
  };
}

/** Posisi upah baru terhadap skala golongan: di bawah minimum, di atas maksimum, atau sesuai (null). */
export function gradeFlag(
  wage: Decimal.Value,
  grade: { minWage?: Decimal.Value | null; maxWage?: Decimal.Value | null } | null | undefined,
): "below" | "above" | null {
  if (!grade) return null;
  if (grade.minWage != null && d(wage).lt(d(grade.minWage))) return "below";
  if (grade.maxWage != null && d(grade.maxWage).gt(0) && d(wage).gt(d(grade.maxWage))) return "above";
  return null;
}

const money = z.coerce
  .number()
  .min(0, "Tidak boleh negatif")
  .transform((v) => v.toFixed(2));
const optionalUuid = z.string().uuid().nullish();

export const compensationCycleSchema = z
  .object({
    name: z.string().trim().min(1, "Nama wajib diisi").max(120),
    effectiveDate: z.string().date(),
    budgetKind: z.enum(["percent", "amount"]).default("percent"),
    budgetValue: money.prefault(0),
    departmentId: optionalUuid,
    gradeId: optionalUuid,
    note: z.string().trim().max(1000).nullish(),
  })
  .refine((c) => c.budgetKind !== "percent" || Number(c.budgetValue) <= 100, {
    message: "Persentase maksimal 100",
    path: ["budgetValue"],
  });
export type CompensationCycleInput = z.infer<typeof compensationCycleSchema>;

/** Usulan: isi persentase atau upah baru (upah baru menang bila keduanya diisi). */
export const compensationProposalSchema = z
  .object({
    proposedPercent: z.coerce.number().min(-100).max(100).nullish(),
    newWage: money.nullish(),
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((p) => p.proposedPercent != null || p.newWage != null, {
    message: "Isi persentase kenaikan atau upah baru",
    path: ["proposedPercent"],
  });
export type CompensationProposalInput = z.infer<typeof compensationProposalSchema>;
