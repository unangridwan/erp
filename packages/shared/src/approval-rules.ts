/**
 * Aturan persetujuan & batas wewenang yang dikelola admin.
 *
 * - Alur (`approval_rules`): tahap per jenis dokumen; tahap berlaku bila nilai dokumen ≥ `minValue` (nominal klaim/PO,
 *   jumlah hari cuti, jam lembur). Jenis dokumen tanpa aturan memakai perilaku lama.
 * - Batas wewenang (`approval_limits`): nominal maksimum per pengguna atau per peran; batas pengguna menimpa peran,
 *   beberapa peran → ambil yang terbesar, lalu batas default perusahaan.
 */
import { z } from "zod";

type Text2 = readonly [id: string, en: string];

export const APPROVAL_RULE_DOCS = {
  leave_request: { label: ["Cuti", "Leave"], value: ["Jumlah hari", "Days"] },
  overtime: { label: ["Lembur", "Overtime"], value: ["Jumlah jam", "Hours"] },
  expense_claim: { label: ["Klaim biaya", "Expense claim"], value: ["Nominal", "Amount"] },
  attendance_request: { label: ["Koreksi absensi", "Attendance correction"], value: null },
  shift_request: { label: ["Tukar shift", "Shift change"], value: null },
  purchase_order: { label: ["Pesanan pembelian (PO)", "Purchase order"], value: ["Nominal", "Amount"] },
} as const satisfies Record<string, { label: Text2; value: Text2 | null }>;
export type ApprovalRuleDoc = keyof typeof APPROVAL_RULE_DOCS;
export const APPROVAL_RULE_DOC_KEYS = Object.keys(APPROVAL_RULE_DOCS) as ApprovalRuleDoc[];

export const APPROVAL_LIMIT_DOCS = {
  purchase_order: ["Pesanan pembelian (PO)", "Purchase order"],
  expense_claim: ["Klaim biaya", "Expense claim"],
  approval_request: ["Permintaan persetujuan", "Approval request"],
} as const satisfies Record<string, Text2>;
export type ApprovalLimitDoc = keyof typeof APPROVAL_LIMIT_DOCS;
export const APPROVAL_LIMIT_DOC_KEYS = Object.keys(APPROVAL_LIMIT_DOCS) as ApprovalLimitDoc[];

export const APPROVER_TYPE_LABELS = {
  manager: ["Atasan langsung", "Direct manager"],
  manager_2: ["Atasan dari atasan", "Manager's manager"],
  department_head: ["Kepala departemen", "Department head"],
  user: ["Pengguna tertentu", "Specific user"],
  role: ["Peran", "Role"],
  admin: ["Admin dokumen (HR / Pembelian)", "Document admin (HR / Purchasing)"],
} as const satisfies Record<string, Text2>;
export type ApproverType = keyof typeof APPROVER_TYPE_LABELS;
const APPROVER_TYPES = Object.keys(APPROVER_TYPE_LABELS) as [ApproverType, ...ApproverType[]];

type Num = string | number | null | undefined;
const num = (v: Num) => (v === null || v === undefined || v === "" ? null : Number(v));

export interface RuleStep {
  sequence: number;
  approverType: ApproverType;
  userId?: string | null;
  roleId?: string | null;
  minValue?: Num;
  label?: string | null;
}

/** Tahap yang berlaku untuk nilai dokumen, urut `sequence`. */
export function applicableSteps<T extends RuleStep>(rules: readonly T[], value: Num): T[] {
  const v = num(value) ?? 0;
  return [...rules]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((r) => {
      const min = num(r.minValue);
      return min === null || v >= min;
    });
}

export interface LimitRow {
  roleId?: string | null;
  userId?: string | null;
  categoryId?: string | null;
  /** null = tanpa batas. */
  maxAmount: Num;
}

/**
 * Batas wewenang yang berlaku untuk seorang pengguna: batas pengguna > peran terbesar > default perusahaan
 * (role & user kosong). Di tiap tingkat, batas khusus kategori menimpa batas umum. `undefined` = tidak ada batas
 * yang diatur sama sekali; `null` = tanpa batas.
 */
export function limitFor(
  limits: readonly LimitRow[],
  who: { userId: string; roleIds: readonly string[]; categoryId?: string | null },
): number | null | undefined {
  const scoped = (rows: LimitRow[]) => {
    const specific = rows.filter((r) => who.categoryId && r.categoryId === who.categoryId);
    return specific.length ? specific : rows.filter((r) => !r.categoryId);
  };
  const largest = (rows: LimitRow[]) =>
    rows.length === 0
      ? undefined
      : rows.some((r) => num(r.maxAmount) === null)
        ? null
        : Math.max(...rows.map((r) => num(r.maxAmount)!));
  const user = scoped(limits.filter((r) => r.userId === who.userId));
  if (user.length) return largest(user);
  const roles = new Set(who.roleIds);
  const role = scoped(limits.filter((r) => !r.userId && r.roleId && roles.has(r.roleId)));
  if (role.length) return largest(role);
  return largest(scoped(limits.filter((r) => !r.userId && !r.roleId)));
}

/** Nominal masih dalam batas (`null`/`undefined` = tanpa batas). */
export function withinLimit(limit: number | null | undefined, amount: Num) {
  return limit === null || limit === undefined || (num(amount) ?? 0) <= limit;
}

const money = z.union([z.number(), z.string().trim()]).transform((v, ctx) => {
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Harus angka ≥ 0" });
    return z.NEVER;
  }
  return n.toFixed(2);
});

export const approvalRuleStepSchema = z
  .object({
    approverType: z.enum(APPROVER_TYPES),
    userId: z.string().uuid().nullish(),
    roleId: z.string().uuid().nullish(),
    minValue: money.nullish(),
    label: z.string().trim().max(100).nullish(),
  })
  .superRefine((s, ctx) => {
    if (s.approverType === "user" && !s.userId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userId"], message: "Pilih pengguna" });
    if (s.approverType === "role" && !s.roleId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roleId"], message: "Pilih peran" });
  })
  .transform((s) => ({
    ...s,
    userId: s.approverType === "user" ? s.userId! : null,
    roleId: s.approverType === "role" ? s.roleId! : null,
  }));

export const approvalRulesSchema = z.object({ steps: z.array(approvalRuleStepSchema).max(10) });

export const approvalLimitSchema = z
  .object({
    roleId: z.string().uuid().nullish(),
    userId: z.string().uuid().nullish(),
    categoryId: z.string().uuid().nullish(),
    maxAmount: money.nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .refine((l) => !(l.roleId && l.userId), {
    path: ["roleId"],
    message: "Pilih peran atau pengguna, bukan keduanya",
  });

export const approvalLimitsSchema = z.object({ limits: z.array(approvalLimitSchema).max(200) });

export const approvalSimulateSchema = z.object({
  docType: z.enum(APPROVAL_RULE_DOC_KEYS as [ApprovalRuleDoc, ...ApprovalRuleDoc[]]),
  value: money.nullish(),
  employeeId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
});
