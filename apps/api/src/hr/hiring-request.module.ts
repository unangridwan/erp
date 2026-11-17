import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, ne, schema, sql, type Db, type SQL } from "@erp/db";
import {
  ACTIVE_HIRING_STATES,
  hasPermission,
  hiringFromLineSchema,
  hiringProgress,
  hiringRequestSchema,
  lineRemaining,
  type HiringRequestInput,
} from "@erp/shared";
import { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ApprovalEngineService } from "./approval-engine.service.js";
import { HrModule } from "./hr.module.js";
import { assertContractType } from "./contract-types.module.js";
import { systemCategoryId } from "./approval-categories.registry.js";

const H = schema.hiringRequests;
const L = schema.manpowerPlanLines;
const P = schema.manpowerPlans;
const D = schema.departments;
const E = schema.employees;
const J = schema.jobPositions;
const G = schema.salaryGrades;
const OP = schema.jobOpenings;
const AP = schema.applicants;
const REQ = schema.approvalRequests;

const listQuery = z.object({
  state: z.enum(["draft", "in_approval", "approved", "refused", "cancel"]).optional(),
  departmentId: z.string().uuid().optional(),
  lineId: z.string().uuid().optional(),
});
const can = (p: string) => hasPermission(currentContext().permissions, p);
type Hiring = typeof H.$inferSelect;

/**
 * Usulan penambahan karyawan (FPK): diajukan dari baris MPP yang disetujui (kuota & gaji terisi otomatis, dibatasi
 * sisa kuota baris) atau di luar rencana (ditandai, kategori persetujuan sendiri). Setelah disetujui menjadi
 * lowongan; detailnya menampilkan seluruh alur sampai karyawan aktif & onboarding.
 */
@Controller()
class HiringRequestController implements OnModuleInit {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    this.approvals.onOutcome(async (tx, requestId) => {
      const [row] = await tx.select().from(H).where(eq(H.approvalRequestId, requestId));
      if (row) await this.sync(tx, row);
    });
  }

  @Get("hiring-requests")
  list(@Query() query: unknown) {
    const q = parse(listQuery, query);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const headOf = await this.headedDepartments(tx);
      if (!can("hr.read") && !headOf.length) throw new ForbiddenException("Butuh permission hr.read");
      const filters: (SQL | undefined)[] = [eq(H.companyId, ctx.companyId)];
      if (!can("hr.read")) filters.push(inArray(H.departmentId, headOf));
      if (q.state) filters.push(eq(H.state, q.state));
      if (q.departmentId) filters.push(eq(H.departmentId, q.departmentId));
      if (q.lineId) filters.push(eq(H.manpowerPlanLineId, q.lineId));
      const rows = await tx
        .select({
          request: H,
          department: D.name,
          job: J.name,
          openingId: OP.id,
          openingState: OP.state,
        })
        .from(H)
        .innerJoin(D, eq(D.id, H.departmentId))
        .innerJoin(J, eq(J.id, H.jobId))
        .leftJoin(OP, eq(OP.hiringRequestId, H.id))
        .where(and(...filters))
        .orderBy(desc(H.createdAt));
      const hired = await this.hiredCounts(
        tx,
        rows.flatMap((r) => (r.openingId ? [r.openingId] : [])),
      );
      return {
        canManage: can("hr.manage"),
        items: rows.map((r) => ({
          ...r.request,
          department: r.department,
          job: r.job,
          openingId: r.openingId,
          openingState: r.openingState,
          active: r.openingId ? (hired.get(r.openingId)?.active ?? 0) : 0,
          candidates: r.openingId ? (hired.get(r.openingId)?.hired ?? 0) : 0,
        })),
      };
    });
  }

  @Get("hiring-requests/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id);
      await this.assertCanRead(tx, row.departmentId);
      return this.detail(tx, await this.sync(tx, row));
    });
  }

  /** FPK manual: dengan baris MPP (dicek sisa kuota) atau di luar rencana. */
  @Post("hiring-requests")
  create(@Body() body: unknown) {
    const input = parse(hiringRequestSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.assertCanEdit(tx, input.departmentId);
      const values = await this.validate(tx, input);
      const [row] = await tx
        .insert(H)
        .values({ ...values, companyId: currentContext().companyId, requestedBy: currentContext().userId })
        .returning();
      await this.log(tx, row!.id, values.unplanned ? "FPK di luar MPP dibuat" : "FPK dibuat dari MPP");
      return this.detail(tx, row!);
    });
  }

  /** Ajukan FPK dari baris MPP disetujui: departemen, jabatan, golongan, jumlah (sisa kuota) & gaji terisi otomatis. */
  @Post("manpower-plan-lines/:id/hiring-request")
  fromLine(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(hiringFromLineSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const { line, plan } = await this.line(tx, id);
      await this.assertCanEdit(tx, plan.departmentId);
      const remaining = lineRemaining(line.quantity, await this.lineRequests(tx, line.id));
      if (remaining <= 0) throw new BadRequestException("Seluruh kuota posisi ini sudah diajukan lewat FPK");
      const [grade] = line.gradeId
        ? await tx
            .select({ min: G.minWage, max: G.maxWage, base: G.baseWage })
            .from(G)
            .where(eq(G.id, line.gradeId))
        : [];
      const wage = Number(line.monthlyWage) ? line.monthlyWage : null;
      const values = await this.validate(tx, {
        departmentId: plan.departmentId,
        jobId: line.jobId,
        gradeId: line.gradeId,
        kind: line.kind === "replacement" ? "replacement" : "new",
        quantity: input.quantity ?? remaining,
        contractType: input.contractType ?? "pkwt",
        // Rentang gaji FPK: skala upah golongan; tanpa skala → gaji pokok standar golongan.
        wageMin: grade ? (grade.min ?? grade.base) : wage,
        wageMax: grade ? (grade.max ?? grade.base) : wage,
        targetDate: input.targetDate ?? `${plan.year}-${String(line.startMonth).padStart(2, "0")}-01`,
        reason: input.reason || line.reason || `Sesuai ${plan.name}`,
        replacesEmployeeId: line.replacesEmployeeId,
        manpowerPlanLineId: line.id,
      });
      const [row] = await tx
        .insert(H)
        .values({ ...values, companyId: plan.companyId, requestedBy: currentContext().userId })
        .returning();
      await this.log(tx, row!.id, `FPK dibuat dari ${plan.name}`);
      return this.detail(tx, row!);
    });
  }

  @Put("hiring-requests/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(hiringRequestSchema, body);
    return this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id);
      await this.assertCanEdit(tx, row.departmentId);
      await this.assertCanEdit(tx, input.departmentId);
      if (row.state !== "draft") throw new BadRequestException("Hanya FPK draft yang bisa diubah");
      const values = await this.validate(tx, input, id);
      const [saved] = await tx
        .update(H)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(H.id, id))
        .returning();
      return this.detail(tx, saved!);
    });
  }

  @Delete("hiring-requests/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id);
      await this.assertCanEdit(tx, row.departmentId);
      if (row.state !== "draft") throw new BadRequestException("Hanya FPK draft yang bisa dihapus");
      await tx.delete(H).where(eq(H.id, id));
    });
  }

  /** Ajukan ke persetujuan: kategori "FPK" (dalam MPP) atau "FPK di luar MPP". */
  @Post("hiring-requests/:id/submit")
  @HttpCode(200)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id);
      await this.assertCanEdit(tx, row.departmentId);
      if (row.state !== "draft") throw new BadRequestException("FPK sudah diajukan");
      // Kuota baris bisa sudah terpakai FPK lain sejak draft ini dibuat.
      await this.validate(tx, toInput(row), id);
      const [info] = await tx
        .select({ department: D.name, job: J.name })
        .from(D)
        .innerJoin(J, eq(J.id, row.jobId))
        .where(eq(D.id, row.departmentId));
      const plan = row.manpowerPlanLineId ? await this.line(tx, row.manpowerPlanLineId) : null;
      const request = await this.approvals.createRequest(tx, {
        categoryId: await this.category(tx, row.companyId, row.unplanned),
        subject: `${info?.job ?? "Posisi"} – ${info?.department ?? ""} (${row.quantity} orang)`,
        reference: plan?.plan.name ?? "Di luar MPP",
        location: null,
        contact: null,
        date: row.targetDate,
        quantity: String(row.quantity),
        amount: row.wageMax ? String(Number(row.wageMax) * row.quantity) : null,
        description: [
          row.unplanned ? "DI LUAR MAN POWER PLANNING." : `Sesuai ${plan?.plan.name ?? "MPP"}.`,
          `${row.kind === "replacement" ? "Pengganti" : "Tambahan"} ${row.quantity} orang, kontrak ${row.contractType.toUpperCase()}.`,
          row.wageMin || row.wageMax
            ? `Gaji Rp ${Number(row.wageMin ?? row.wageMax).toLocaleString("id-ID")} – Rp ${Number(row.wageMax ?? row.wageMin).toLocaleString("id-ID")}.`
            : "",
          `Alasan: ${row.reason}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      const submitted = await this.approvals.submit(tx, request.id);
      const [saved] = await tx
        .update(H)
        .set({
          state: "in_approval",
          approvalRequestId: request.id,
          number: submitted.number ?? null,
          submittedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(H.id, id))
        .returning();
      await this.log(tx, id, `FPK ${submitted.number ?? ""} diajukan`);
      return this.detail(tx, await this.sync(tx, saved!));
    });
  }

  @Post("hiring-requests/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id);
      await this.assertCanEdit(tx, row.departmentId);
      if (row.state === "cancel" || row.state === "refused")
        throw new BadRequestException("FPK sudah selesai");
      const [opening] = await tx.select({ id: OP.id }).from(OP).where(eq(OP.hiringRequestId, id));
      if (opening)
        throw new BadRequestException("Lowongan dari FPK ini sudah dibuka; tutup lowongan di menu Rekrutmen");
      if (row.state === "in_approval" && row.approvalRequestId) {
        const [req] = await tx
          .select({ state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, row.approvalRequestId));
        if (req?.state === "submitted") await this.approvals.cancel(tx, row.approvalRequestId);
      }
      const [saved] = await tx
        .update(H)
        .set({ state: "cancel", updatedAt: sql`now()` })
        .where(eq(H.id, id))
        .returning();
      await this.log(tx, id, "FPK dibatalkan");
      return this.detail(tx, saved!);
    });
  }

  /** Buka lowongan dari FPK yang disetujui (sekali per FPK). */
  @Post("hiring-requests/:id/job-opening")
  openJob(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      if (!can("hr.manage")) throw new ForbiddenException("Butuh permission hr.manage");
      const row = await this.sync(tx, await this.find(tx, id));
      return openingFromHiring(tx, row);
    });
  }

  // ---- internal ----

  /** Status FPK mengikuti permintaan persetujuan. */
  private async sync(tx: Db, row: Hiring): Promise<Hiring> {
    if (row.state !== "in_approval" || !row.approvalRequestId) return row;
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, row.approvalRequestId));
    const next =
      req?.state === "approved"
        ? "approved"
        : req?.state === "refused"
          ? "refused"
          : req?.state === "cancel"
            ? "cancel"
            : null;
    if (!next) return row;
    const [saved] = await tx
      .update(H)
      .set({ state: next, ...(next === "approved" ? { approvedAt: new Date() } : {}), updatedAt: sql`now()` })
      .where(eq(H.id, row.id))
      .returning();
    await this.log(
      tx,
      row.id,
      { approved: "FPK disetujui", refused: "FPK ditolak", cancel: "FPK dibatalkan" }[next],
    );
    return saved!;
  }

  /** Validasi rujukan & kuota baris MPP; mengembalikan nilai kolom. */
  private async validate(tx: Db, input: HiringRequestInput, exceptId?: string) {
    const ctx = currentContext();
    const [dept] = await tx
      .select({ id: D.id })
      .from(D)
      .where(and(eq(D.id, input.departmentId), eq(D.companyId, ctx.companyId)));
    if (!dept) throw fieldError("departmentId", "Departemen tidak ditemukan");
    const [job] = await tx.select({ id: J.id, gradeId: J.gradeId }).from(J).where(eq(J.id, input.jobId));
    if (!job) throw fieldError("jobId", "Jabatan tidak ditemukan");
    if (input.gradeId) {
      const [grade] = await tx.select({ id: G.id }).from(G).where(eq(G.id, input.gradeId));
      if (!grade) throw fieldError("gradeId", "Golongan tidak ditemukan");
    }
    if (input.replacesEmployeeId) {
      const [emp] = await tx
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.id, input.replacesEmployeeId), eq(E.companyId, ctx.companyId)));
      if (!emp) throw fieldError("replacesEmployeeId", "Karyawan yang diganti tidak ditemukan");
    }
    if (input.manpowerPlanLineId) {
      const { line, plan } = await this.line(tx, input.manpowerPlanLineId);
      if (plan.departmentId !== input.departmentId || line.jobId !== input.jobId)
        throw fieldError("manpowerPlanLineId", "Baris MPP berbeda departemen/jabatan");
      const remaining = lineRemaining(line.quantity, await this.lineRequests(tx, line.id), exceptId);
      if (input.quantity > remaining)
        throw fieldError(
          "quantity",
          `Melebihi sisa kuota MPP (${remaining} orang); ajukan FPK di luar MPP untuk kelebihannya`,
        );
    }
    await assertContractType(tx, input.contractType);
    return {
      departmentId: input.departmentId,
      jobId: input.jobId,
      gradeId: input.gradeId ?? job.gradeId ?? null,
      kind: input.kind,
      quantity: input.quantity,
      contractType: input.contractType,
      wageMin: input.wageMin ?? null,
      wageMax: input.wageMax ?? null,
      targetDate: input.targetDate ?? null,
      reason: input.reason,
      replacesEmployeeId: input.replacesEmployeeId ?? null,
      manpowerPlanLineId: input.manpowerPlanLineId ?? null,
      unplanned: !input.manpowerPlanLineId,
    };
  }

  private async line(tx: Db, id: string) {
    const [row] = await tx
      .select({ line: L, plan: P })
      .from(L)
      .innerJoin(P, eq(P.id, L.planId))
      .where(and(eq(L.id, id), eq(P.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Baris MPP tidak ditemukan");
    if (row.plan.state !== "approved") throw new BadRequestException("MPP belum disetujui");
    if (row.line.kind === "existing") throw new BadRequestException("Posisi terisi tidak perlu FPK");
    return row;
  }

  private lineRequests(tx: Db, lineId: string) {
    return tx
      .select({ id: H.id, quantity: H.quantity, state: H.state })
      .from(H)
      .where(and(eq(H.manpowerPlanLineId, lineId), inArray(H.state, [...ACTIVE_HIRING_STATES])));
  }

  /** Karyawan dari pelamar diterima per lowongan: calon (kontrak belum mulai) & aktif. */
  private async hiredCounts(tx: Db, openingIds: string[]) {
    const out = new Map<string, { hired: number; active: number }>();
    if (!openingIds.length) return out;
    const rows = await tx
      .select({
        openingId: AP.openingId,
        hired: sql<number>`count(*) filter (where ${AP.stage} = 'hired')::int`,
        active: sql<number>`count(*) filter (where ${E.active} and not ${E.pendingStart})::int`,
      })
      .from(AP)
      .leftJoin(E, eq(E.id, AP.employeeId))
      .where(inArray(AP.openingId, openingIds))
      .groupBy(AP.openingId);
    for (const r of rows) out.set(r.openingId, { hired: r.hired, active: r.active });
    return out;
  }

  private async detail(tx: Db, row: Hiring) {
    const [info] = await tx
      .select({ department: D.name, job: J.name })
      .from(D)
      .innerJoin(J, eq(J.id, row.jobId))
      .where(eq(D.id, row.departmentId));
    const [grade] = row.gradeId ? await tx.select({ name: G.name }).from(G).where(eq(G.id, row.gradeId)) : [];
    const planInfo = row.manpowerPlanLineId
      ? (
          await tx
            .select({
              planId: P.id,
              planName: P.name,
              planState: P.state,
              lineQuantity: L.quantity,
            })
            .from(L)
            .innerJoin(P, eq(P.id, L.planId))
            .where(eq(L.id, row.manpowerPlanLineId))
        )[0]
      : undefined;
    const [replaces] = row.replacesEmployeeId
      ? await tx.select({ id: E.id, name: E.name }).from(E).where(eq(E.id, row.replacesEmployeeId))
      : [];
    const [request] = row.approvalRequestId
      ? await tx
          .select({ id: REQ.id, number: REQ.number, state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, row.approvalRequestId))
      : [];
    const [opening] = await tx
      .select({ id: OP.id, name: OP.name, state: OP.state, quota: OP.quota })
      .from(OP)
      .where(eq(OP.hiringRequestId, row.id));
    const people = opening ? await this.people(tx, opening.id) : [];
    const count = (f: (p: (typeof people)[number]) => boolean) => people.filter(f).length;
    const progress = hiringProgress({
      planned: !row.unplanned,
      planApproved: planInfo?.planState === "approved",
      requestState: row.state,
      quantity: row.quantity,
      hasOpening: !!opening,
      offersAccepted: count((p) => p.offerAccepted || p.stage === "hired"),
      contracts: count((p) => !!p.contractId),
      active: count((p) => p.active),
      onboardingDone: count((p) => p.onboarding === "done"),
    });
    const headOf = await this.headedDepartments(tx);
    return {
      ...row,
      department: info?.department ?? "",
      job: info?.job ?? "",
      grade: grade?.name ?? null,
      replaces: replaces ?? null,
      plan: planInfo
        ? {
            id: planInfo.planId,
            name: planInfo.planName,
            state: planInfo.planState,
            lineQuantity: planInfo.lineQuantity,
          }
        : null,
      approvalRequest: request ?? null,
      opening: opening ?? null,
      applicants: {
        total: people.length,
        byStage: Object.fromEntries(
          ["new", "screening", "interview", "offer", "hired", "refused"].map((s) => [
            s,
            count((p) => p.stage === s),
          ]),
        ),
      },
      people: people.filter((p) => p.stage === "hired" || p.offerAccepted),
      progress,
      canEdit: can("hr.manage") || headOf.includes(row.departmentId),
      canManage: can("hr.manage"),
    };
  }

  /** Pelamar lowongan beserta penawaran diterima, kontrak, status karyawan & onboarding. */
  private async people(tx: Db, openingId: string) {
    const rows = await tx
      .select({
        applicantId: AP.id,
        name: AP.name,
        stage: AP.stage,
        employeeId: AP.employeeId,
        active: E.active,
        pendingStart: E.pendingStart,
        joinDate: E.joinDate,
      })
      .from(AP)
      .leftJoin(E, eq(E.id, AP.employeeId))
      .where(eq(AP.openingId, openingId))
      .orderBy(asc(AP.name));
    const ids = rows.map((r) => r.applicantId);
    const empIds = rows.flatMap((r) => (r.employeeId ? [r.employeeId] : []));
    const offers = ids.length
      ? await tx
          .select({ applicantId: schema.jobOffers.applicantId, state: schema.jobOffers.state })
          .from(schema.jobOffers)
          .where(inArray(schema.jobOffers.applicantId, ids))
      : [];
    const contracts = empIds.length
      ? await tx
          .select({
            id: schema.contracts.id,
            employeeId: schema.contracts.employeeId,
            name: schema.contracts.name,
            state: schema.contracts.state,
          })
          .from(schema.contracts)
          .where(and(inArray(schema.contracts.employeeId, empIds), ne(schema.contracts.state, "cancel")))
      : [];
    const checklists = empIds.length
      ? await tx
          .select({
            id: schema.hrChecklists.id,
            employeeId: schema.hrChecklists.employeeId,
            state: schema.hrChecklists.state,
          })
          .from(schema.hrChecklists)
          .where(
            and(inArray(schema.hrChecklists.employeeId, empIds), eq(schema.hrChecklists.kind, "onboarding")),
          )
      : [];
    return rows.map((r) => {
      const contract = contracts.find((c) => c.employeeId === r.employeeId);
      const checklist = checklists.find((c) => c.employeeId === r.employeeId);
      return {
        applicantId: r.applicantId,
        name: r.name,
        stage: r.stage,
        employeeId: r.employeeId,
        joinDate: r.joinDate,
        offerAccepted: offers.some((o) => o.applicantId === r.applicantId && o.state === "accepted"),
        contractId: contract?.id ?? null,
        contractName: contract?.name ?? null,
        contractState: contract?.state ?? null,
        active: !!r.employeeId && !!r.active && !r.pendingStart,
        checklistId: checklist?.id ?? null,
        onboarding: checklist?.state ?? null,
      };
    });
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(H)
      .where(and(eq(H.id, id), eq(H.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("FPK tidak ditemukan");
    return row;
  }

  private async headedDepartments(tx: Db) {
    const ctx = currentContext();
    const rows = await tx
      .select({ id: D.id })
      .from(D)
      .innerJoin(E, eq(E.id, D.managerId))
      .where(and(eq(D.companyId, ctx.companyId), eq(E.userId, ctx.userId)));
    return rows.map((r) => r.id);
  }

  private async assertCanRead(tx: Db, departmentId: string) {
    if (can("hr.read")) return;
    if (!(await this.headedDepartments(tx)).includes(departmentId))
      throw new ForbiddenException("Butuh permission hr.read");
  }

  private async assertCanEdit(tx: Db, departmentId: string) {
    if (can("hr.manage")) return;
    if (!(await this.headedDepartments(tx)).includes(departmentId))
      throw new ForbiddenException("Hanya HR (hr.manage) atau kepala departemen yang bisa mengajukan FPK");
  }

  /** FPK dalam rencana memakai kategori "FPK"; di luar MPP kategori sendiri agar bisa diberi penyetuju tambahan. */
  private category(tx: Db, companyId: string, unplanned: boolean) {
    return systemCategoryId(tx, companyId, unplanned ? "FPK_NP" : "FPK");
  }

  private log(tx: Db, id: string, message: string) {
    return this.activity.log(tx, { resModel: "hiring_request", resId: id, action: "comment", message });
  }
}

/** Lowongan dari FPK yang disetujui (dipakai juga oleh endpoint FPK lama). */
export async function openingFromHiring(tx: Db, row: Hiring) {
  if (row.state !== "approved") throw new BadRequestException("FPK belum disetujui");
  const [existing] = await tx.select({ id: OP.id }).from(OP).where(eq(OP.hiringRequestId, row.id));
  if (existing) throw new BadRequestException("Lowongan untuk FPK ini sudah dibuat");
  const [info] = await tx
    .select({ department: D.name, job: J.name })
    .from(D)
    .innerJoin(J, eq(J.id, row.jobId))
    .where(eq(D.id, row.departmentId));
  const [opening] = await tx
    .insert(OP)
    .values({
      companyId: row.companyId,
      name: `${info?.job ?? "Posisi"} – ${info?.department ?? ""}${row.kind === "replacement" ? " (pengganti)" : ""}`,
      jobId: row.jobId,
      departmentId: row.departmentId,
      description: row.reason,
      quota: row.quantity,
      targetDate: row.targetDate,
      wageMin: row.wageMin,
      wageMax: row.wageMax,
      approvalRequestId: row.approvalRequestId,
      manpowerPlanLineId: row.manpowerPlanLineId,
      hiringRequestId: row.id,
    })
    .returning();
  // Baris MPP menunjuk lowongan pertamanya (realisasi baris dihitung dari semua lowongan FPK baris itu).
  if (row.manpowerPlanLineId)
    await tx
      .update(L)
      .set({ jobOpeningId: opening!.id })
      .where(and(eq(L.id, row.manpowerPlanLineId), sql`${L.jobOpeningId} is null`));
  return opening!;
}

const toInput = (row: Hiring): HiringRequestInput => ({
  departmentId: row.departmentId,
  jobId: row.jobId,
  gradeId: row.gradeId,
  kind: row.kind,
  quantity: row.quantity,
  contractType: row.contractType,
  wageMin: row.wageMin,
  wageMax: row.wageMax,
  targetDate: row.targetDate,
  reason: row.reason,
  replacesEmployeeId: row.replacesEmployeeId,
  manpowerPlanLineId: row.manpowerPlanLineId,
});

@Module({ imports: [HrModule], controllers: [HiringRequestController], providers: [ActivityService] })
export class HiringRequestModule {}
