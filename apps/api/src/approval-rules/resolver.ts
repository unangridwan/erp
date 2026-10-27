import { ForbiddenException } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte, schema, sql, type Db } from "@erp/db";
import {
  applicableSteps,
  limitFor,
  withinLimit,
  type ApprovalLimitDoc,
  type ApprovalRuleDoc,
} from "@erp/shared";

/**
 * Resolusi aturan persetujuan & batas wewenang (dipakai dokumen SDM, PO, dan permintaan generik).
 * Tahap: approver user → user itu; peran → semua pemegang peran di perusahaan; keduanya null = admin jenis dokumen.
 */

const RULE = schema.approvalRules;
const LIMIT = schema.approvalLimits;
const STEP = schema.documentApprovalSteps;
const E = schema.employees;
type Employee = typeof E.$inferSelect;

export interface ResolvedStep {
  step: number;
  approverUserId: string | null;
  approverRoleId: string | null;
  label: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const gone = (e: Employee) => !e.active || (!!e.resignDate && e.resignDate < today());

export async function rulesFor(tx: Db, companyId: string, docType: ApprovalRuleDoc) {
  return tx
    .select()
    .from(RULE)
    .where(and(eq(RULE.companyId, companyId), eq(RULE.docType, docType)))
    .orderBy(asc(RULE.sequence));
}

async function employeeById(tx: Db, id: string | null) {
  if (!id) return null;
  const [row] = await tx.select().from(E).where(eq(E.id, id));
  return row && !gone(row) ? row : null;
}

/** Atasan ke-n (1 = langsung) yang masih aktif. */
async function managerAt(tx: Db, employee: Employee, depth: number) {
  let current: Employee | null = employee;
  for (let i = 0; i < depth && current; i++) current = await employeeById(tx, current.managerId);
  return current && current.id !== employee.id ? current : null;
}

/**
 * Tahap dari aturan untuk dokumen baru; `null` bila jenis dokumen belum punya aturan (pakai perilaku lama).
 * Atasan/kepala departemen yang tidak ada → tahap admin; pemohon sendiri dilewati; penyetuju berurutan yang sama
 * digabung.
 */
export async function planSteps(
  tx: Db,
  input: {
    companyId: string;
    docType: ApprovalRuleDoc;
    value: string | number | null;
    employee: Employee | null;
    requesterUserId: string | null;
  },
): Promise<ResolvedStep[] | null> {
  const rules = await rulesFor(tx, input.companyId, input.docType);
  if (!rules.length) return null;
  const out: ResolvedStep[] = [];
  for (const rule of applicableSteps(rules, input.value)) {
    let userId: string | null = null;
    let roleId: string | null = null;
    const e = input.employee;
    if (rule.approverType === "manager" || rule.approverType === "manager_2")
      userId = e ? ((await managerAt(tx, e, rule.approverType === "manager" ? 1 : 2))?.userId ?? null) : null;
    else if (rule.approverType === "department_head" && e?.departmentId) {
      const [dept] = await tx
        .select({ managerId: schema.departments.managerId })
        .from(schema.departments)
        .where(eq(schema.departments.id, e.departmentId));
      const head = await employeeById(tx, dept?.managerId ?? null);
      userId = head && head.id !== e.id ? head.userId : null;
    } else if (rule.approverType === "user") userId = rule.userId;
    else if (rule.approverType === "role") roleId = rule.roleId;
    if (userId && userId === input.requesterUserId) continue;
    const prev = out.at(-1);
    if (prev && prev.approverUserId === userId && prev.approverRoleId === roleId) continue;
    out.push({ step: out.length + 1, approverUserId: userId, approverRoleId: roleId, label: rule.label });
  }
  return out;
}

export async function saveSteps(tx: Db, resModel: string, resId: string, steps: ResolvedStep[]) {
  await tx.delete(STEP).where(and(eq(STEP.resModel, resModel), eq(STEP.resId, resId)));
  if (steps.length) await tx.insert(STEP).values(steps.map((s) => ({ ...s, resModel, resId })));
}

export async function storedSteps(tx: Db, resModel: string, resId: string): Promise<ResolvedStep[]> {
  return tx
    .select({
      step: STEP.step,
      approverUserId: STEP.approverUserId,
      approverRoleId: STEP.approverRoleId,
      label: STEP.label,
    })
    .from(STEP)
    .where(and(eq(STEP.resModel, resModel), eq(STEP.resId, resId)))
    .orderBy(asc(STEP.step));
}

/** Pengguna aktif yang memegang peran di perusahaan (penugasan khusus perusahaan itu atau semua perusahaan). */
export async function roleHolders(tx: Db, roleId: string, companyId: string) {
  const UR = schema.userRoles;
  const rows = await tx
    .selectDistinct({ userId: UR.userId })
    .from(UR)
    .innerJoin(schema.users, eq(schema.users.id, UR.userId))
    .where(
      and(
        eq(UR.roleId, roleId),
        eq(schema.users.active, true),
        sql`(${UR.companyId} = ${companyId} or (${UR.companyId} is null and (
          exists (select 1 from user_companies uc where uc.user_id = ${UR.userId} and uc.company_id = ${companyId})
          or exists (select 1 from role_permissions rp where rp.role_id = ${UR.roleId} and rp.permission = '*'))))`,
      ),
    );
  return rows.map((r) => r.userId);
}

/** Peran pengguna yang berlaku di perusahaan. */
export async function userRoleIds(tx: Db, userId: string, companyId: string) {
  const UR = schema.userRoles;
  const rows = await tx
    .select({ roleId: UR.roleId })
    .from(UR)
    .where(and(eq(UR.userId, userId), sql`(${UR.companyId} is null or ${UR.companyId} = ${companyId})`));
  return rows.map((r) => r.roleId);
}

/** User yang hari ini mendelegasikan persetujuannya kepada `userId`. */
export async function delegatorsOf(tx: Db, userId: string, date = today()) {
  const DEL = schema.approvalDelegations;
  const rows = await tx
    .select({ userId: DEL.userId })
    .from(DEL)
    .where(and(eq(DEL.delegateUserId, userId), lte(DEL.dateFrom, date), gte(DEL.dateTo, date)));
  return new Set(rows.map((r) => r.userId));
}

/** Pengguna yang boleh memutuskan tahap ini (di luar delegasi); kosong = admin jenis dokumen. */
export async function stepUsers(
  tx: Db,
  step: { approverUserId: string | null; approverRoleId?: string | null },
  companyId: string,
) {
  if (step.approverUserId) return [step.approverUserId];
  if (step.approverRoleId) return roleHolders(tx, step.approverRoleId, companyId);
  return [];
}

/** `userId` memutuskan atas nama salah satu `approvers` (langsung atau sebagai delegasi aktif). */
export async function actsForAny(
  tx: Db,
  approvers: readonly string[],
  userId: string,
  delegators?: Set<string>,
) {
  if (approvers.includes(userId)) return { ok: true, delegated: false };
  const from = delegators ?? (await delegatorsOf(tx, userId));
  const delegated = approvers.some((a) => from.has(a));
  return { ok: delegated, delegated };
}

export async function limitsFor(tx: Db, companyId: string, docType: ApprovalLimitDoc) {
  return tx
    .select()
    .from(LIMIT)
    .where(and(eq(LIMIT.companyId, companyId), eq(LIMIT.docType, docType)));
}

/** Batas wewenang pengguna (`undefined` = tidak diatur, `null` = tanpa batas). */
export async function limitOf(
  tx: Db,
  input: { companyId: string; docType: ApprovalLimitDoc; userId: string; categoryId?: string | null },
) {
  const limits = await limitsFor(tx, input.companyId, input.docType);
  if (!limits.length) return undefined;
  return limitFor(limits, {
    userId: input.userId,
    roleIds: await userRoleIds(tx, input.userId, input.companyId),
    categoryId: input.categoryId ?? null,
  });
}

const fmt = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Tolak bila nominal melebihi batas wewenang penyetuju. */
export async function assertWithinLimit(
  tx: Db,
  input: {
    companyId: string;
    docType: ApprovalLimitDoc;
    userId: string;
    categoryId?: string | null;
    amount: string | number | null;
  },
) {
  const limit = await limitOf(tx, input);
  if (!withinLimit(limit, input.amount))
    throw new ForbiddenException(`Nominal melebihi batas wewenang Anda (${fmt(limit!)})`);
}

/** Nama peran (untuk label "menunggu"). */
export async function roleNames(tx: Db, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: schema.roles.id, name: schema.roles.name })
    .from(schema.roles)
    .where(inArray(schema.roles.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
