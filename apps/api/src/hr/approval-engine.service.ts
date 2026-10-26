import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { aliasedTable, and, asc, desc, eq, gte, inArray, lte, schema, sql, type Db } from "@erp/db";
import {
  APPROVAL_FIELD_LABELS,
  type approvalCategorySchema,
  type approvalDelegationSchema,
  type approvalRequestSchema,
  buildApprovalSteps,
  DEFAULT_APPROVAL_CATEGORIES,
  hasPermission,
  missingApprovalFields,
  requestOutcome,
} from "@erp/shared";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { NotificationService } from "../notifications/notification.service.js";
import { SequenceService } from "../sequences/sequence.service.js";

const CAT = schema.approvalCategories;
const APR = schema.approvalCategoryApprovers;
const REQ = schema.approvalRequests;
const STEP = schema.approvalRequestSteps;
const DEL = schema.approvalDelegations;
const E = schema.employees;

type CategoryInput = z.infer<typeof approvalCategorySchema>;
type RequestInput = z.infer<typeof approvalRequestSchema>;
type DelegationInput = z.infer<typeof approvalDelegationSchema>;
type Employee = typeof E.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

/** Karyawan sudah keluar: tidak aktif atau tanggal resign sudah lewat. */
export function hasLeft(employee: Pick<Employee, "active" | "resignDate">) {
  return !employee.active || (!!employee.resignDate && employee.resignDate < today());
}

/**
 * Mesin persetujuan generik: kategori permintaan dengan field wajib/opsional, tahap dari atasan + penyetuju kategori
 * menurut batas nominal (DoA), mode berurutan/paralel dengan minimum persetujuan, dan delegasi penyetuju.
 * Tahap tanpa penyetuju diputuskan HR (hr.manage).
 */
@Injectable()
export class ApprovalEngineService {
  constructor(
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** Beri tahu penyetuju yang sekarang bisa memutuskan (berurutan: tahap terdepan; paralel: semua tahap terbuka). */
  private async notifyPending(tx: Db, request: typeof REQ.$inferSelect, mode: "sequential" | "parallel") {
    const pending = (await this.steps(tx, request.id)).filter((s) => s.state === "pending");
    const first = Math.min(...pending.map((s) => s.sequence));
    const current = mode === "parallel" ? pending : pending.filter((s) => s.sequence === first);
    await this.notifications.notify(
      tx,
      current.map((s) => s.approverUserId),
      {
        kind: "approval.pending",
        title: `Permintaan ${request.number ?? ""} menunggu persetujuan Anda`.replace("  ", " "),
        body: request.subject,
        link: `/hr/approval-requests/${request.id}`,
        companyId: request.companyId,
      },
    );
  }

  // ---- Delegasi ----

  /** User yang hari ini mendelegasikan persetujuannya kepada `userId`. */
  async delegatorsOf(tx: Db, userId: string, date = today()) {
    const rows = await tx
      .select({ userId: DEL.userId })
      .from(DEL)
      .where(and(eq(DEL.delegateUserId, userId), lte(DEL.dateFrom, date), gte(DEL.dateTo, date)));
    return new Set(rows.map((r) => r.userId));
  }

  /** `userId` boleh memutuskan atas nama `approverUserId` (sendiri, atau delegasinya yang aktif). */
  async actsFor(tx: Db, approverUserId: string | null, userId: string) {
    if (!approverUserId) return { ok: false, delegated: false };
    if (approverUserId === userId) return { ok: true, delegated: false };
    const delegated = (await this.delegatorsOf(tx, userId)).has(approverUserId);
    return { ok: delegated, delegated };
  }

  async listDelegations(tx: Db, all: boolean) {
    const ctx = currentContext();
    if (all && !hasPermission(ctx.permissions, "hr.manage"))
      throw new ForbiddenException("Butuh permission hr.manage");
    const U = aliasedTable(schema.users, "delegator");
    const D = aliasedTable(schema.users, "delegate");
    return tx
      .select({
        id: DEL.id,
        userId: DEL.userId,
        userName: U.name,
        delegateUserId: DEL.delegateUserId,
        delegateName: D.name,
        dateFrom: DEL.dateFrom,
        dateTo: DEL.dateTo,
        reason: DEL.reason,
      })
      .from(DEL)
      .innerJoin(U, eq(U.id, DEL.userId))
      .innerJoin(D, eq(D.id, DEL.delegateUserId))
      .where(
        and(
          eq(DEL.companyId, ctx.companyId),
          all ? undefined : sql`(${DEL.userId} = ${ctx.userId} or ${DEL.delegateUserId} = ${ctx.userId})`,
        ),
      )
      .orderBy(desc(DEL.dateFrom));
  }

  async createDelegation(tx: Db, input: DelegationInput) {
    const ctx = currentContext();
    const userId = input.userId ?? ctx.userId;
    if (userId !== ctx.userId && !hasPermission(ctx.permissions, "hr.manage"))
      throw new ForbiddenException("Butuh permission hr.manage");
    if (userId === input.delegateUserId)
      throw fieldError("delegateUserId", "Tidak bisa mendelegasikan kepada diri sendiri");
    await this.assertCompanyUsers(tx, [
      { path: "userId", id: userId },
      { path: "delegateUserId", id: input.delegateUserId },
    ]);
    const [row] = await tx
      .insert(DEL)
      .values({
        companyId: ctx.companyId,
        userId,
        delegateUserId: input.delegateUserId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        reason: input.reason ?? null,
      })
      .returning();
    return row!;
  }

  async removeDelegation(tx: Db, id: string) {
    const ctx = currentContext();
    const [row] = await tx
      .select()
      .from(DEL)
      .where(and(eq(DEL.id, id), eq(DEL.companyId, ctx.companyId)));
    if (!row) throw new NotFoundException("Delegasi tidak ditemukan");
    if (row.userId !== ctx.userId && !hasPermission(ctx.permissions, "hr.manage"))
      throw new ForbiddenException("Butuh permission hr.manage");
    await tx.delete(DEL).where(eq(DEL.id, id));
  }

  // ---- Kategori ----

  /** Kategori bawaan BLST untuk perusahaan yang belum punya kategori sama sekali. */
  async ensureDefaults(tx: Db, companyId: string) {
    const [any] = await tx.select({ id: CAT.id }).from(CAT).where(eq(CAT.companyId, companyId)).limit(1);
    if (any) return;
    await tx
      .insert(CAT)
      .values(DEFAULT_APPROVAL_CATEGORIES.map((c, i) => ({ ...c, companyId, sequence: (i + 1) * 10 })))
      .onConflictDoNothing();
  }

  async listCategories(tx: Db, activeOnly: boolean) {
    const companyId = currentContext().companyId;
    await this.ensureDefaults(tx, companyId);
    const rows = await tx
      .select({
        category: CAT,
        approvers: sql<number>`(select count(*) from approval_category_approvers a where a.category_id = ${CAT.id})::int`,
      })
      .from(CAT)
      .where(and(eq(CAT.companyId, companyId), activeOnly ? eq(CAT.active, true) : undefined))
      .orderBy(asc(CAT.sequence), asc(CAT.name));
    return rows.map((r) => ({ ...r.category, approverCount: r.approvers }));
  }

  async getCategory(tx: Db, id: string) {
    const [category] = await tx
      .select()
      .from(CAT)
      .where(and(eq(CAT.id, id), eq(CAT.companyId, currentContext().companyId)));
    if (!category) throw new NotFoundException("Kategori persetujuan tidak ditemukan");
    const approvers = await tx
      .select({
        id: APR.id,
        userId: APR.userId,
        userName: schema.users.name,
        label: APR.label,
        required: APR.required,
        minAmount: APR.minAmount,
        sequence: APR.sequence,
      })
      .from(APR)
      .innerJoin(schema.users, eq(schema.users.id, APR.userId))
      .where(eq(APR.categoryId, id))
      .orderBy(asc(APR.sequence));
    return { ...category, approvers };
  }

  async saveCategory(tx: Db, id: string | null, input: CategoryInput) {
    const companyId = currentContext().companyId;
    await this.assertCompanyUsers(
      tx,
      input.approvers.map((a, i) => ({ path: `approvers.${i}.userId`, id: a.userId })),
    );
    const [dup] = await tx
      .select({ id: CAT.id })
      .from(CAT)
      .where(and(eq(CAT.companyId, companyId), eq(CAT.code, input.code)));
    if (dup && dup.id !== id) throw fieldError("code", "Kode kategori sudah dipakai");
    const { approvers, ...values } = input;
    const row = { ...values, description: values.description ?? null };
    let categoryId = id;
    if (id) {
      await this.getCategory(tx, id);
      await tx
        .update(CAT)
        .set({ ...row, updatedAt: sql`now()` })
        .where(eq(CAT.id, id));
      await tx.delete(APR).where(eq(APR.categoryId, id));
    } else {
      const [created] = await tx
        .insert(CAT)
        .values({ ...row, companyId })
        .returning({ id: CAT.id });
      categoryId = created!.id;
    }
    // Prefix nomor mengikuti kategori (urutan nomor tetap berlanjut).
    await tx
      .update(schema.sequences)
      .set({ prefix: input.prefix })
      .where(
        and(eq(schema.sequences.companyId, companyId), eq(schema.sequences.code, `approval.${input.code}`)),
      );
    if (approvers.length)
      await tx.insert(APR).values(
        approvers.map((a, i) => ({
          categoryId: categoryId!,
          sequence: (i + 1) * 10,
          userId: a.userId,
          label: a.label ?? null,
          required: a.required,
          minAmount: a.minAmount ?? null,
        })),
      );
    return this.getCategory(tx, categoryId!);
  }

  async removeCategory(tx: Db, id: string) {
    await this.getCategory(tx, id);
    const [used] = await tx.select({ id: REQ.id }).from(REQ).where(eq(REQ.categoryId, id)).limit(1);
    if (used)
      throw new BadRequestException("Kategori sudah dipakai permintaan; nonaktifkan saja (Aktif = tidak)");
    await tx.delete(CAT).where(eq(CAT.id, id));
  }

  // ---- Permintaan ----

  async listRequests(tx: Db, query: { mine?: string; review?: string; state?: string; categoryId?: string }) {
    const ctx = currentContext();
    let ids: string[] | null = null;
    if (query.review) ids = (await this.reviewable(tx)).map((r) => r.id);
    else if (!query.mine && !hasPermission(ctx.permissions, "hr.read"))
      throw new ForbiddenException("Butuh permission hr.read");
    if (ids && ids.length === 0) return [];
    const rows = await tx
      .select({
        request: {
          id: REQ.id,
          number: REQ.number,
          subject: REQ.subject,
          state: REQ.state,
          amount: REQ.amount,
          date: REQ.date,
          dateFrom: REQ.dateFrom,
          dateTo: REQ.dateTo,
          submittedAt: REQ.submittedAt,
          decidedAt: REQ.decidedAt,
          createdAt: REQ.createdAt,
          categoryId: REQ.categoryId,
          requestedBy: REQ.requestedBy,
        },
        categoryName: CAT.name,
        requesterName: schema.users.name,
        employeeName: E.name,
      })
      .from(REQ)
      .innerJoin(CAT, eq(CAT.id, REQ.categoryId))
      .leftJoin(schema.users, eq(schema.users.id, REQ.requestedBy))
      .leftJoin(E, eq(E.id, REQ.employeeId))
      .where(
        and(
          eq(REQ.companyId, ctx.companyId),
          query.mine ? eq(REQ.requestedBy, ctx.userId) : undefined,
          ids ? inArray(REQ.id, ids) : undefined,
          query.state ? eq(REQ.state, query.state as "draft") : undefined,
          query.categoryId ? eq(REQ.categoryId, query.categoryId) : undefined,
        ),
      )
      .orderBy(desc(REQ.createdAt))
      .limit(500);
    return rows.map((r) => ({
      ...r.request,
      categoryName: r.categoryName,
      requesterName: r.employeeName ?? r.requesterName,
    }));
  }

  /** Detail permintaan + tahap + apa yang boleh dilakukan user ini. */
  async getRequest(tx: Db, id: string) {
    const ctx = currentContext();
    const request = await this.find(tx, id);
    const category = await this.getCategory(tx, request.categoryId);
    const steps = await this.steps(tx, id);
    const act = await this.actionableStep(tx, request, category, steps);
    const visible =
      request.requestedBy === ctx.userId ||
      hasPermission(ctx.permissions, "hr.read") ||
      act !== null ||
      (await Promise.all(steps.map((s) => this.actsFor(tx, s.approverUserId, ctx.userId)))).some((a) => a.ok);
    if (!visible) throw new ForbiddenException("Butuh permission hr.read");
    const [requester] = request.requestedBy
      ? await tx
          .select({ name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.id, request.requestedBy))
      : [];
    const { attachment, ...rest } = request;
    const editable = request.state === "draft" && this.canEdit(request);
    return {
      ...rest,
      hasAttachment: attachment !== null,
      requesterName: requester?.name ?? null,
      category: {
        id: category.id,
        code: category.code,
        name: category.name,
        description: category.description,
        fields: category.fields,
        approvalMode: category.approvalMode,
        minApprovals: category.minApprovals,
      },
      steps,
      can: {
        edit: editable,
        submit: editable,
        cancel: (request.state === "draft" || request.state === "submitted") && this.canEdit(request),
        decide: act !== null,
      },
    };
  }

  async createRequest(tx: Db, input: RequestInput) {
    const ctx = currentContext();
    const category = await this.getCategory(tx, input.categoryId);
    if (!category.active) throw fieldError("categoryId", "Kategori persetujuan tidak aktif");
    const [employee] = await tx
      .select({ id: E.id })
      .from(E)
      .where(and(eq(E.userId, ctx.userId), eq(E.companyId, ctx.companyId)));
    const [row] = await tx
      .insert(REQ)
      .values({
        ...this.values(input),
        companyId: ctx.companyId,
        categoryId: category.id,
        employeeId: employee?.id ?? null,
        requestedBy: ctx.userId,
      })
      .returning({ id: REQ.id });
    return this.getRequest(tx, row!.id);
  }

  async updateRequest(tx: Db, id: string, input: RequestInput) {
    const request = await this.find(tx, id, true);
    if (request.state !== "draft") throw new BadRequestException("Hanya permintaan draft yang bisa diubah");
    this.assertCanEdit(request);
    const category = await this.getCategory(tx, input.categoryId);
    if (!category.active && category.id !== request.categoryId)
      throw fieldError("categoryId", "Kategori persetujuan tidak aktif");
    await tx
      .update(REQ)
      .set({ ...this.values(input), categoryId: category.id, updatedAt: sql`now()` })
      .where(eq(REQ.id, id));
    return this.getRequest(tx, id);
  }

  async removeRequest(tx: Db, id: string) {
    const request = await this.find(tx, id, true);
    if (request.state !== "draft") throw new BadRequestException("Hanya permintaan draft yang bisa dihapus");
    this.assertCanEdit(request);
    await tx.delete(REQ).where(eq(REQ.id, id));
  }

  /** Ajukan: validasi field wajib, bentuk tahap (atasan + DoA), beri nomor. */
  async submit(tx: Db, id: string) {
    const request = await this.find(tx, id, true);
    if (request.state !== "draft") throw new BadRequestException("Permintaan sudah diajukan");
    this.assertCanEdit(request);
    const category = await this.getCategory(tx, request.categoryId);
    if (!category.active) throw fieldError("categoryId", "Kategori persetujuan tidak aktif");
    const missing = missingApprovalFields(category.fields, {
      ...request,
      hasAttachment: request.attachment !== null,
    });
    if (missing.length)
      throw new BadRequestException({
        message: "Lengkapi field wajib",
        errors: missing.map((f) => ({
          path: f === "period" ? "dateFrom" : f,
          message: `${APPROVAL_FIELD_LABELS[f]} wajib diisi`,
        })),
      });
    let managerUserId: string | null = null;
    if (request.employeeId) {
      const [employee] = await tx.select().from(E).where(eq(E.id, request.employeeId));
      if (employee && hasLeft(employee))
        throw new BadRequestException("Karyawan sudah resign; permintaan tidak bisa diproses");
      if (employee?.managerId) {
        const [manager] = await tx.select().from(E).where(eq(E.id, employee.managerId));
        if (manager && !hasLeft(manager)) managerUserId = manager.userId;
      }
    }
    const planned = buildApprovalSteps({
      managerFirst: category.managerFirst,
      approvers: category.approvers,
      amount: request.amount,
      managerUserId,
      requesterUserId: request.requestedBy,
    });
    await tx.insert(STEP).values(planned.map((s) => ({ ...s, requestId: id })));
    const number =
      request.number ??
      (await this.sequences.next(
        tx,
        `approval.${category.code}`,
        request.companyId,
        new Date(),
        category.prefix,
      ));
    await tx
      .update(REQ)
      .set({ state: "submitted", number, submittedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(REQ.id, id));
    await this.activity.log(tx, {
      resModel: "approval_request",
      resId: id,
      action: "comment",
      message: `Permintaan ${number} diajukan (${planned.length} tahap)`,
    });
    await this.notifyPending(tx, { ...request, number }, category.approvalMode);
    return this.getRequest(tx, id);
  }

  async cancel(tx: Db, id: string) {
    const request = await this.find(tx, id, true);
    if (request.state !== "draft" && request.state !== "submitted")
      throw new BadRequestException("Permintaan sudah diputuskan");
    this.assertCanEdit(request);
    await tx
      .update(STEP)
      .set({ state: "skipped" })
      .where(and(eq(STEP.requestId, id), eq(STEP.state, "pending")));
    await tx
      .update(REQ)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(REQ.id, id));
    return this.getRequest(tx, id);
  }

  /** Putuskan tahap yang terbuka untuk user ini (langsung, sebagai delegasi, atau HR untuk tahap HR). */
  async decide(tx: Db, id: string, decision: "approved" | "refused", note?: string | null) {
    const ctx = currentContext();
    const request = await this.find(tx, id, true);
    if (request.state !== "submitted") throw new BadRequestException("Permintaan sudah diproses");
    if (request.requestedBy === ctx.userId)
      throw new ForbiddenException("Tidak bisa menyetujui permintaan sendiri");
    if (request.employeeId) {
      const [employee] = await tx.select().from(E).where(eq(E.id, request.employeeId));
      if (employee && hasLeft(employee))
        throw new BadRequestException("Karyawan sudah resign; permintaan tidak bisa diproses");
    }
    const category = await this.getCategory(tx, request.categoryId);
    const steps = await this.steps(tx, id);
    const act = await this.actionableStep(tx, request, category, steps);
    if (!act) throw new ForbiddenException("Menunggu persetujuan penyetuju lain pada tahap ini");
    await tx
      .update(STEP)
      .set({
        state: decision,
        decidedBy: ctx.userId,
        delegated: act.delegated,
        decidedAt: new Date(),
        note: note ?? null,
      })
      .where(eq(STEP.id, act.step.id));
    const after = steps.map((s) => (s.id === act.step.id ? { ...s, state: decision } : s));
    const outcome = requestOutcome(after, category.approvalMode, category.minApprovals);
    if (outcome.state !== "submitted") {
      await tx
        .update(STEP)
        .set({ state: "skipped" })
        .where(and(eq(STEP.requestId, id), eq(STEP.state, "pending")));
      await tx
        .update(REQ)
        .set({ state: outcome.state, decidedAt: new Date(), updatedAt: sql`now()` })
        .where(eq(REQ.id, id));
    }
    await this.activity.log(tx, {
      resModel: "approval_request",
      resId: id,
      action: "comment",
      message: `Tahap ${act.step.sequence}${act.step.label ? ` (${act.step.label})` : ""} ${
        decision === "approved" ? "disetujui" : "ditolak"
      }${act.delegated ? " sebagai delegasi" : ""}${
        outcome.state === "approved"
          ? " — permintaan disetujui"
          : outcome.state === "refused"
            ? " — permintaan ditolak"
            : ""
      }${note ? `: ${note}` : ""}`,
    });
    if (outcome.state === "submitted") await this.notifyPending(tx, request, category.approvalMode);
    else
      await this.notifications.notify(tx, [request.requestedBy], {
        kind: `approval.${outcome.state}`,
        title: `Permintaan ${request.number} ${outcome.state === "approved" ? "disetujui" : "ditolak"}`,
        body: request.subject,
        link: `/hr/approval-requests/${request.id}`,
        companyId: request.companyId,
      });
    return this.getRequest(tx, id);
  }

  async attachment(tx: Db, id: string) {
    await this.getRequest(tx, id);
    const request = await this.find(tx, id);
    if (!request.attachment) throw new NotFoundException("Lampiran tidak ditemukan");
    return {
      data: request.attachment,
      name: request.attachmentName ?? "lampiran",
      type: request.attachmentType ?? "application/octet-stream",
    };
  }

  /** Permintaan yang menunggu keputusan user ini (untuk kotak persetujuan). */
  async reviewable(tx: Db) {
    const ctx = currentContext();
    const hr = hasPermission(ctx.permissions, "hr.manage");
    const delegators = await this.delegatorsOf(tx, ctx.userId);
    const approvers = [ctx.userId, ...delegators];
    const candidates = await tx
      .select({ request: REQ, category: CAT })
      .from(REQ)
      .innerJoin(CAT, eq(CAT.id, REQ.categoryId))
      .where(
        and(
          eq(REQ.companyId, ctx.companyId),
          eq(REQ.state, "submitted"),
          sql`exists (select 1 from approval_request_steps s where s.request_id = ${REQ.id} and s.state = 'pending'
            and (s.approver_user_id in (${sql.join(
              approvers.map((u) => sql`${u}::uuid`),
              sql`, `,
            )}) ${hr ? sql`or s.approver_user_id is null` : sql``}))`,
        ),
      );
    const result = [];
    for (const { request, category } of candidates) {
      if (request.requestedBy === ctx.userId) continue;
      const steps = await this.steps(tx, request.id);
      const act = await this.actionableStep(tx, request, category, steps, delegators);
      if (act)
        result.push({
          id: request.id,
          number: request.number,
          subject: request.subject,
          categoryName: category.name,
          amount: request.amount,
          requestedBy: request.requestedBy,
          employeeId: request.employeeId,
          step: act.step.sequence,
          levels: steps.filter((s) => s.state !== "skipped").length,
          mine: act.step.approverUserId !== null,
          delegated: act.delegated,
        });
    }
    return result;
  }

  /** Ringkasan untuk dashboard: milik saya per status, menunggu saya, per kategori (HR). */
  async summary(tx: Db) {
    const ctx = currentContext();
    const mine = await tx
      .select({ state: REQ.state, count: sql<number>`count(*)::int` })
      .from(REQ)
      .where(and(eq(REQ.companyId, ctx.companyId), eq(REQ.requestedBy, ctx.userId)))
      .groupBy(REQ.state);
    const byCategory = hasPermission(ctx.permissions, "hr.read")
      ? await tx
          .select({
            categoryId: CAT.id,
            categoryName: CAT.name,
            submitted: sql<number>`count(*) filter (where ${REQ.state} = 'submitted')::int`,
            approved: sql<number>`count(*) filter (where ${REQ.state} = 'approved')::int`,
            refused: sql<number>`count(*) filter (where ${REQ.state} = 'refused')::int`,
          })
          .from(REQ)
          .innerJoin(CAT, eq(CAT.id, REQ.categoryId))
          .where(eq(REQ.companyId, ctx.companyId))
          .groupBy(CAT.id, CAT.name)
          .orderBy(asc(CAT.name))
      : [];
    return {
      mine: Object.fromEntries(mine.map((m) => [m.state, m.count])),
      toReview: (await this.reviewable(tx)).length,
      byCategory,
    };
  }

  // ---- Internal ----

  private async find(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(REQ)
      .where(and(eq(REQ.id, id), eq(REQ.companyId, currentContext().companyId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundException("Permintaan persetujuan tidak ditemukan");
    return row;
  }

  private async steps(tx: Db, requestId: string) {
    const D = aliasedTable(schema.users, "decider");
    return tx
      .select({
        id: STEP.id,
        sequence: STEP.sequence,
        approverUserId: STEP.approverUserId,
        approverName: schema.users.name,
        label: STEP.label,
        required: STEP.required,
        state: STEP.state,
        decidedBy: STEP.decidedBy,
        decidedByName: D.name,
        delegated: STEP.delegated,
        decidedAt: STEP.decidedAt,
        note: STEP.note,
      })
      .from(STEP)
      .leftJoin(schema.users, eq(schema.users.id, STEP.approverUserId))
      .leftJoin(D, eq(D.id, STEP.decidedBy))
      .where(eq(STEP.requestId, requestId))
      .orderBy(asc(STEP.sequence));
  }

  /** Tahap terbuka pertama yang boleh diputuskan user ini, atau null. */
  private async actionableStep(
    tx: Db,
    request: { state: string; requestedBy: string | null },
    category: { approvalMode: "sequential" | "parallel"; minApprovals: number },
    steps: Awaited<ReturnType<ApprovalEngineService["steps"]>>,
    delegators?: Set<string>,
  ) {
    const ctx = currentContext();
    if (request.state !== "submitted" || request.requestedBy === ctx.userId) return null;
    const open = new Set(requestOutcome(steps, category.approvalMode, category.minApprovals).open);
    const from = delegators ?? (await this.delegatorsOf(tx, ctx.userId));
    const hr = hasPermission(ctx.permissions, "hr.manage");
    for (const step of steps) {
      if (!open.has(step.sequence)) continue;
      if (step.approverUserId === ctx.userId) return { step, delegated: false };
      if (step.approverUserId && from.has(step.approverUserId)) return { step, delegated: true };
      if (!step.approverUserId && hr) return { step, delegated: false };
    }
    return null;
  }

  private canEdit(request: { requestedBy: string | null }) {
    const ctx = currentContext();
    return request.requestedBy === ctx.userId || hasPermission(ctx.permissions, "hr.write");
  }

  private assertCanEdit(request: { requestedBy: string | null }) {
    if (!this.canEdit(request)) throw new ForbiddenException("Butuh permission hr.write");
  }

  private values(input: RequestInput) {
    return {
      subject: input.subject,
      date: input.date ?? null,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
      quantity: input.quantity ?? null,
      amount: input.amount ?? null,
      reference: input.reference ?? null,
      location: input.location ?? null,
      contact: input.contact ?? null,
      description: input.description ?? null,
      ...(input.attachment === undefined
        ? {}
        : input.attachment === null
          ? { attachment: null, attachmentName: null, attachmentType: null }
          : {
              attachment: Buffer.from(input.attachment.data, "base64"),
              attachmentName: input.attachment.name,
              attachmentType: input.attachment.type,
            }),
    };
  }

  /** User harus punya akses ke perusahaan aktif. */
  private async assertCompanyUsers(tx: Db, users: { path: string; id: string }[]) {
    if (!users.length) return;
    const companyId = currentContext().companyId;
    const rows = await tx
      .select({ userId: schema.userCompanies.userId })
      .from(schema.userCompanies)
      .where(
        and(
          eq(schema.userCompanies.companyId, companyId),
          inArray(
            schema.userCompanies.userId,
            users.map((u) => u.id),
          ),
        ),
      );
    const ok = new Set(rows.map((r) => r.userId));
    const bad = users.find((u) => !ok.has(u.id));
    if (bad) throw fieldError(bad.path, "User tidak punya akses ke perusahaan ini");
  }
}
