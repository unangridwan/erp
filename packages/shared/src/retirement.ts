import { z } from "zod";

/**
 * Usia pensiun: kebijakan tiap perusahaan (PP/PKB) berbeda. Bawaan perusahaan + pengecualian per jabatan, golongan,
 * atau departemen; karyawan bisa punya usia pensiun khusus.
 */
export type RetirementDateRule = "birthday" | "end_of_month" | "next_month_start";
export type RetirementRuleKind = "job" | "grade" | "department";

export const RETIREMENT_DATE_RULE_LABEL: Record<RetirementDateRule, [string, string]> = {
  birthday: ["Tepat hari ulang tahun", "On the birthday"],
  end_of_month: ["Akhir bulan ulang tahun", "End of the birthday month"],
  next_month_start: ["Awal bulan berikutnya", "First day of the following month"],
};
export const RETIREMENT_RULE_KIND_LABEL: Record<RetirementRuleKind, [string, string]> = {
  job: ["Jabatan", "Job position"],
  grade: ["Golongan", "Grade"],
  department: ["Departemen", "Department"],
};

const age = z.coerce.number().int().min(40, "Usia pensiun 40–80 tahun").max(80, "Usia pensiun 40–80 tahun");

export const retirementPolicySchema = z.object({
  retirementAge: age,
  dateRule: z.enum(["birthday", "end_of_month", "next_month_start"]).default("end_of_month"),
  reminderMonths: z.coerce.number().int().min(0).max(60).default(6),
  rules: z
    .array(
      z.object({
        kind: z.enum(["job", "grade", "department"]),
        refId: z.string().uuid(),
        retirementAge: age,
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .max(500)
    .default([]),
});
export type RetirementPolicyInput = z.infer<typeof retirementPolicySchema>;

export const DEFAULT_RETIREMENT_AGE = 56;

/**
 * Tanggal pensiun (YYYY-MM-DD) dari tanggal lahir & usia pensiun. Lahir 29 Feb pada tahun bukan kabisat → 28 Feb.
 */
export function retirementDate(birthDate: string, retirementAge: number, rule: RetirementDateRule): string {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  const year = y + retirementAge;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  if (rule === "birthday") return iso(new Date(Date.UTC(year, m - 1, Math.min(d, lastDay))));
  if (rule === "end_of_month") return iso(new Date(Date.UTC(year, m - 1, lastDay)));
  return iso(new Date(Date.UTC(year, m, 1)));
}

/** Usia pensiun yang berlaku: karyawan > jabatan > golongan > departemen > bawaan perusahaan. */
export function resolveRetirementAge(
  employee: {
    retirementAge?: number | null;
    jobId?: string | null;
    gradeId?: string | null;
    departmentId?: string | null;
  },
  policy: { retirementAge: number } | null | undefined,
  rules: { kind: RetirementRuleKind; refId: string; retirementAge: number }[],
): { age: number; source: "employee" | RetirementRuleKind | "company" } {
  if (employee.retirementAge) return { age: employee.retirementAge, source: "employee" };
  for (const kind of ["job", "grade", "department"] as const) {
    const ref = kind === "job" ? employee.jobId : kind === "grade" ? employee.gradeId : employee.departmentId;
    const rule = ref && rules.find((r) => r.kind === kind && r.refId === ref);
    if (rule) return { age: rule.retirementAge, source: kind };
  }
  return { age: policy?.retirementAge ?? DEFAULT_RETIREMENT_AGE, source: "company" };
}
