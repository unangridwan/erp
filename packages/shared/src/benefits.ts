import { Decimal } from "decimal.js";
import { z } from "zod";

const d = (v: Decimal.Value) => new Decimal(v ?? 0);
const rupiah = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

export const BENEFIT_KINDS = ["health_insurance", "pension", "other"] as const;
export type BenefitKind = (typeof BENEFIT_KINDS)[number];
export const BENEFIT_KIND_LABEL: Record<BenefitKind, [string, string]> = {
  health_insurance: ["Asuransi kesehatan", "Health insurance"],
  pension: ["DPLK / dana pensiun", "Pension fund (DPLK)"],
  other: ["Fasilitas lain", "Other benefit"],
};

export const SALARY_CALCS = ["fixed_amount", "per_attendance_day", "attendance_premium"] as const;
export type SalaryCalc = (typeof SALARY_CALCS)[number];
export const SALARY_CALC_LABEL: Record<SalaryCalc, [string, string]> = {
  fixed_amount: ["Nilai tetap", "Fixed amount"],
  per_attendance_day: ["Per hari hadir", "Per attendance day"],
  attendance_premium: ["Premi kehadiran", "Attendance premium"],
};

export interface AttendanceFacts {
  /** Hari hadir (tanggal unik absensi tervalidasi). */
  presentDays: number;
  /** Kejadian terlambat. */
  lateCount: number;
  /** Hari kerja tidak hadir tanpa cuti. */
  absentDays: number;
}

/**
 * Tunjangan berbasis kehadiran: per hari hadir = tarif × hari hadir; premi kehadiran = penuh bila keterlambatan dan
 * ketidakhadiran tidak melebihi batas (batas kosong = tidak diperiksa), selain itu 0.
 */
export function attendanceAllowance(
  calc: SalaryCalc,
  rate: Decimal.Value,
  facts: AttendanceFacts,
  rules: { maxLate?: number | null; maxAbsent?: number | null } = {},
): string {
  if (calc === "per_attendance_day") return rupiah(d(rate).times(Math.max(facts.presentDays, 0))).toFixed(0);
  if (calc === "attendance_premium") {
    const lost =
      (rules.maxLate !== null && rules.maxLate !== undefined && facts.lateCount > rules.maxLate) ||
      (rules.maxAbsent !== null && rules.maxAbsent !== undefined && facts.absentDays > rules.maxAbsent) ||
      facts.presentDays === 0;
    return lost ? "0" : rupiah(d(rate)).toFixed(0);
  }
  return rupiah(d(rate)).toFixed(0);
}

export interface BenefitPlanTerms {
  calc: "fixed" | "percent_wage";
  employerAmount: Decimal.Value;
  employeeAmount: Decimal.Value;
  wageCap?: Decimal.Value | null;
  dependentAmount: Decimal.Value;
  dependentPayer: "employer" | "employee";
}

/**
 * Iuran/premi bulanan satu kepesertaan. `percent_wage`: % × min(upah, batas upah); nilai kepesertaan (bila diisi)
 * menimpa nilai paket. Tanggungan keluarga menambah porsi pembayar yang ditentukan paket.
 */
export function benefitContribution(
  plan: BenefitPlanTerms,
  wage: Decimal.Value,
  dependents: number,
  override: { employer?: Decimal.Value | null; employee?: Decimal.Value | null } = {},
) {
  const base = plan.wageCap ? Decimal.min(d(wage), d(plan.wageCap)) : d(wage);
  const value = (v: Decimal.Value) => (plan.calc === "percent_wage" ? base.times(d(v)).div(100) : d(v));
  let employer = value(override.employer ?? plan.employerAmount);
  let employee = value(override.employee ?? plan.employeeAmount);
  const extra = d(plan.dependentAmount).times(Math.max(dependents, 0));
  if (plan.dependentPayer === "employer") employer = employer.plus(extra);
  else employee = employee.plus(extra);
  return { employer: rupiah(employer).toFixed(0), employee: rupiah(employee).toFixed(0) };
}

/** Plafon klaim yang berlaku: plafon golongan menimpa plafon kategori; null = tanpa plafon. */
export function effectiveClaimLimit(
  categoryLimit: Decimal.Value | null | undefined,
  gradeLimit: Decimal.Value | null | undefined,
): string | null {
  if (gradeLimit !== null && gradeLimit !== undefined) return d(gradeLimit).toFixed(2);
  if (categoryLimit !== null && categoryLimit !== undefined) return d(categoryLimit).toFixed(2);
  return null;
}

const money = z.coerce
  .number()
  .min(0)
  .transform((v) => v.toFixed(2));

export const benefitPlanSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(30)
      .regex(/^[A-Z0-9_]+$/, "Huruf besar, angka, atau _"),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(BENEFIT_KINDS),
    providerId: z.string().uuid().nullish(),
    policyNo: z.string().trim().max(100).nullish(),
    calc: z.enum(["fixed", "percent_wage"]).default("fixed"),
    employerAmount: money.default(0),
    employeeAmount: money.default(0),
    wageCap: money.nullish(),
    dependentAmount: money.default(0),
    dependentPayer: z.enum(["employer", "employee"]).default("employer"),
    /** Porsi perusahaan menambah penghasilan bruto PPh 21 (natura); bawaan: ya, kecuali DPLK. */
    taxable: z.boolean().optional(),
    expenseAccountId: z.string().uuid().nullish(),
    payableAccountId: z.string().uuid().nullish(),
    active: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.calc === "percent_wage")
      for (const k of ["employerAmount", "employeeAmount"] as const)
        if (Number(p[k]) > 100)
          ctx.addIssue({ code: "custom", path: [k], message: "Persentase maksimal 100" });
  })
  .transform((p) => ({ ...p, taxable: p.taxable ?? p.kind !== "pension" }));
export type BenefitPlanInput = z.infer<typeof benefitPlanSchema>;

export const benefitEnrollmentSchema = z
  .object({
    planId: z.string().uuid(),
    employeeId: z.string().uuid(),
    dateStart: z.string().date(),
    dateEnd: z.string().date().nullish(),
    memberNo: z.string().trim().max(100).nullish(),
    dependentIds: z.array(z.string().uuid()).max(20).default([]),
    employerAmount: money.nullish(),
    employeeAmount: money.nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((e) => !e.dateEnd || e.dateEnd >= e.dateStart, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["dateEnd"],
  });
export type BenefitEnrollmentInput = z.infer<typeof benefitEnrollmentSchema>;

export const expenseCategoryLimitsSchema = z.object({
  limits: z
    .array(z.object({ gradeId: z.string().uuid(), annualLimit: money }))
    .max(100)
    .refine((l) => new Set(l.map((x) => x.gradeId)).size === l.length, "Golongan tidak boleh dobel"),
});
