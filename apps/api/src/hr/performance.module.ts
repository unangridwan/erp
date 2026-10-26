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
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, schema, sql, type Db, type SQL } from "@erp/db";
import {
  appraisalCalibrateSchema,
  appraisalCycleSchema,
  appraisalReviewSchema,
  appraisalStartSchema,
  appraisalTemplateSchema,
  hasPermission,
  orgTree,
  RAISE_BY_RATING,
  ratingFor,
  trainingParticipantsSchema,
  trainingResultSchema,
  trainingSchema,
  turnoverRate,
  weightedScore,
} from "@erp/shared";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { NotificationService } from "../notifications/notification.service.js";
import { EmployeeService } from "./employee.service.js";
import { HistoryService } from "./history.service.js";
import { HrModule } from "./hr.module.js";

const AT = schema.appraisalTemplates;
const ATI = schema.appraisalTemplateItems;
const CY = schema.appraisalCycles;
const AP = schema.appraisals;
const AL = schema.appraisalLines;
const TR = schema.trainings;
const TP = schema.trainingParticipants;
const E = schema.employees;

/** Indikator bawaan bila perusahaan belum membuat template penilaian. */
const DEFAULT_KPI = [
  { name: "Pencapaian target kerja", weight: 40 },
  { name: "Kualitas hasil kerja", weight: 25 },
  { name: "Kerja sama & komunikasi", weight: 20 },
  { name: "Disiplin & kehadiran", weight: 15 },
];

const companyId = () => currentContext().companyId;

// ---- Template penilaian ----

@Controller("appraisal-templates")
class AppraisalTemplatesController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({ template: AT, jobName: schema.jobPositions.name })
        .from(AT)
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, AT.jobId))
        .where(eq(AT.companyId, companyId()))
        .orderBy(asc(AT.name));
      const items = rows.length
        ? await tx
            .select()
            .from(ATI)
            .where(
              inArray(
                ATI.templateId,
                rows.map((r) => r.template.id),
              ),
            )
            .orderBy(asc(ATI.sequence))
        : [];
      return rows.map((r) => ({
        ...r.template,
        jobName: r.jobName,
        items: items.filter((i) => i.templateId === r.template.id),
      }));
    });
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(appraisalTemplateSchema, body);
    return this.tenantDb.run((tx) => this.save(tx, input));
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(appraisalTemplateSchema, body);
    return this.tenantDb.run((tx) => this.save(tx, input, id));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => tx.delete(AT).where(and(eq(AT.id, id), eq(AT.companyId, companyId()))));
  }

  private async save(tx: Db, input: z.infer<typeof appraisalTemplateSchema>, id?: string) {
    const { items, ...values } = input;
    if (values.jobId) {
      const [job] = await tx
        .select({ id: schema.jobPositions.id })
        .from(schema.jobPositions)
        .where(eq(schema.jobPositions.id, values.jobId));
      if (!job) throw fieldError("jobId", "Jabatan tidak ditemukan");
    }
    let templateId = id;
    if (id) {
      const [row] = await tx
        .update(AT)
        .set({ ...values, jobId: values.jobId ?? null, updatedAt: sql`now()` })
        .where(and(eq(AT.id, id), eq(AT.companyId, companyId())))
        .returning();
      if (!row) throw new NotFoundException("Template penilaian tidak ditemukan");
      await tx.delete(ATI).where(eq(ATI.templateId, id));
    } else {
      const [row] = await tx
        .insert(AT)
        .values({ ...values, jobId: values.jobId ?? null, companyId: companyId() })
        .returning();
      templateId = row!.id;
    }
    await tx.insert(ATI).values(
      items.map((item, i) => ({
        templateId: templateId!,
        sequence: i,
        name: item.name,
        description: item.description ?? null,
        weight: String(item.weight),
      })),
    );
    return { id: templateId! };
  }
}

// ---- Siklus & penilaian ----

@Controller("appraisal-cycles")
class AppraisalCyclesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          cycle: CY,
          total: sql<number>`(select count(*)::int from ${AP} a where a.cycle_id = appraisal_cycles.id)`,
          done: sql<number>`(select count(*)::int from ${AP} a where a.cycle_id = appraisal_cycles.id and a.state = 'done')`,
        })
        .from(CY)
        .where(eq(CY.companyId, companyId()))
        .orderBy(desc(CY.dateStart))
        .then((rows) => rows.map((r) => ({ ...r.cycle, total: r.total, done: r.done }))),
    );
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(appraisalCycleSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .insert(CY)
        .values({ ...input, companyId: companyId() })
        .returning();
      return row!;
    });
  }

  /**
   * Buka siklus: buat formulir penilaian per karyawan aktif dari template jabatannya (atau template umum/bawaan),
   * penilai = user atasan langsung.
   */
  @Post(":id/start")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  start(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(appraisalStartSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const cycle = await this.find(tx, id);
      if (cycle.state === "closed") throw new BadRequestException("Siklus penilaian sudah ditutup");
      const employees = await tx
        .select()
        .from(E)
        .where(
          and(
            eq(E.companyId, cycle.companyId),
            eq(E.active, true),
            lte(E.joinDate, cycle.dateEnd),
            or(isNull(E.resignDate), gte(E.resignDate, cycle.dateEnd)),
            input.employeeIds?.length ? inArray(E.id, input.employeeIds) : undefined,
          ),
        );
      const templates = await tx
        .select()
        .from(AT)
        .where(and(eq(AT.companyId, cycle.companyId), eq(AT.active, true)));
      const items = templates.length
        ? await tx
            .select()
            .from(ATI)
            .where(
              inArray(
                ATI.templateId,
                templates.map((t) => t.id),
              ),
            )
            .orderBy(asc(ATI.sequence))
        : [];
      const fallback = input.templateId
        ? templates.find((t) => t.id === input.templateId)
        : templates.find((t) => !t.jobId);
      if (input.templateId && !fallback) throw fieldError("templateId", "Template penilaian tidak ditemukan");
      const existing = new Set(
        (await tx.select({ employeeId: AP.employeeId }).from(AP).where(eq(AP.cycleId, id))).map(
          (r) => r.employeeId,
        ),
      );
      let created = 0;
      for (const employee of employees) {
        if (existing.has(employee.id)) continue;
        const template = templates.find((t) => t.jobId && t.jobId === employee.jobId) ?? fallback;
        const lines = template
          ? items.filter((i) => i.templateId === template.id).map((i) => ({ name: i.name, weight: i.weight }))
          : DEFAULT_KPI.map((k) => ({ name: k.name, weight: String(k.weight) }));
        const manager = employee.managerId
          ? (await tx.select({ userId: E.userId }).from(E).where(eq(E.id, employee.managerId)))[0]?.userId
          : null;
        const [appraisal] = await tx
          .insert(AP)
          .values({
            companyId: cycle.companyId,
            cycleId: id,
            employeeId: employee.id,
            templateId: template?.id ?? null,
            managerUserId: manager ?? null,
          })
          .returning({ id: AP.id });
        await tx.insert(AL).values(
          lines.map((l, i) => ({
            appraisalId: appraisal!.id,
            sequence: i,
            name: l.name,
            weight: l.weight,
          })),
        );
        created++;
      }
      await tx
        .update(CY)
        .set({ state: "open", updatedAt: sql`now()` })
        .where(eq(CY.id, id));
      return { created };
    });
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  close(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      const [pending] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(AP)
        .where(and(eq(AP.cycleId, id), sql`${AP.state} <> 'done'`));
      if (pending?.n)
        throw new BadRequestException(`Masih ada ${pending.n} penilaian yang belum selesai dikalibrasi`);
      const [row] = await tx
        .update(CY)
        .set({ state: "closed", updatedAt: sql`now()` })
        .where(eq(CY.id, id))
        .returning();
      return row!;
    });
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(CY)
      .where(and(eq(CY.id, id), eq(CY.companyId, companyId())));
    if (!row) throw new NotFoundException("Siklus penilaian tidak ditemukan");
    return row;
  }
}

/** Daftar penilaian beserta nama karyawan, siklus, dan atasan penilai. */
function appraisalQuery(tx: Db, filter: SQL | undefined) {
  return tx
    .select({
      appraisal: AP,
      employeeName: E.name,
      employeeUserId: E.userId,
      cycleName: CY.name,
      managerName: schema.users.name,
    })
    .from(AP)
    .innerJoin(E, eq(E.id, AP.employeeId))
    .innerJoin(CY, eq(CY.id, AP.cycleId))
    .leftJoin(schema.users, eq(schema.users.id, AP.managerUserId))
    .where(and(eq(AP.companyId, companyId()), filter))
    .orderBy(asc(E.name))
    .then((rows) =>
      rows.map((r) => ({
        ...r.appraisal,
        employeeName: r.employeeName,
        employeeUserId: r.employeeUserId,
        cycleName: r.cycleName,
        managerName: r.managerName,
      })),
    );
}

/**
 * Formulir penilaian: karyawan mengisi penilaian diri, atasan menilai, HR mengkalibrasi (skor akhir, predikat,
 * usulan kenaikan upah).
 */
@Controller("appraisals")
class AppraisalsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query("cycleId") cycleId?: string) {
    return this.tenantDb.run((tx) => appraisalQuery(tx, cycleId ? eq(AP.cycleId, cycleId) : undefined));
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const a = await this.load(tx, id);
      this.access(a);
      return a;
    });
  }

  /** Penilaian diri oleh karyawan. */
  @Put(":id/self")
  self(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(appraisalReviewSchema, body);
    return this.tenantDb.run(async (tx) => {
      const a = await this.load(tx, id);
      if (a.employeeUserId !== currentContext().userId)
        throw new ForbiddenException("Penilaian diri hanya oleh karyawan yang bersangkutan");
      if (a.state !== "self") throw new BadRequestException("Penilaian diri sudah dikirim");
      const score = await this.saveScores(tx, a, input, "selfScore");
      await tx
        .update(AP)
        .set({
          selfScore: String(score),
          employeeComment: input.comment ?? null,
          selfSubmittedAt: new Date(),
          // Tanpa atasan ber-akun: langsung ke kalibrasi HR.
          state: a.managerUserId ? "manager" : "calibration",
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, id));
      await this.notifications.notify(tx, [a.managerUserId], {
        kind: "appraisal.manager",
        title: `Penilaian diri ${a.employeeName} (${a.cycleName}) menunggu penilaian Anda`,
        link: `/hr/appraisals/${id}`,
      });
      return this.load(tx, id);
    });
  }

  /** Penilaian atasan (atau HR bila karyawan tidak punya atasan ber-akun). */
  @Put(":id/manager")
  manager(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(appraisalReviewSchema, body);
    return this.tenantDb.run(async (tx) => {
      const a = await this.load(tx, id);
      const ctx = currentContext();
      const hr = hasPermission(ctx.permissions, "hr.manage");
      if (a.managerUserId !== ctx.userId && !hr)
        throw new ForbiddenException("Hanya atasan langsung atau HR yang bisa menilai");
      if (a.employeeUserId === ctx.userId)
        throw new ForbiddenException("Tidak bisa menilai diri sendiri sebagai atasan");
      if (a.state !== "manager" && !(hr && a.state === "self"))
        throw new BadRequestException("Penilaian tidak sedang menunggu atasan");
      const score = await this.saveScores(tx, a, input, "managerScore");
      await tx
        .update(AP)
        .set({
          managerScore: String(score),
          managerComment: input.comment ?? null,
          managerSubmittedAt: new Date(),
          state: "calibration",
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, id));
      return this.load(tx, id);
    });
  }

  /** Kalibrasi HR: skor akhir (bawaan skor atasan), predikat (bawaan dari skor), usulan kenaikan upah. */
  @Post(":id/calibrate")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  calibrate(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(appraisalCalibrateSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const a = await this.load(tx, id);
      if (a.state !== "calibration") throw new BadRequestException("Penilaian belum siap dikalibrasi");
      const final = input.finalScore ?? Number(a.managerScore ?? a.selfScore);
      const rating = input.rating ?? ratingFor(final);
      await tx
        .update(AP)
        .set({
          finalScore: final.toFixed(2),
          rating,
          raisePercent: String(input.raisePercent ?? RAISE_BY_RATING[rating]),
          hrComment: input.comment ?? null,
          state: "done",
          doneAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, id));
      await this.activity.log(tx, {
        resModel: "employee",
        resId: a.employeeId,
        action: "comment",
        message: `Penilaian kinerja ${a.cycleName}: skor ${final.toFixed(2)}, predikat ${rating}`,
      });
      return this.load(tx, id);
    });
  }

  private async saveScores(
    tx: Db,
    a: Awaited<ReturnType<AppraisalsController["load"]>>,
    input: z.infer<typeof appraisalReviewSchema>,
    field: "selfScore" | "managerScore",
  ) {
    const byId = new Map(input.lines.map((l) => [l.id, l]));
    const missing = a.lines.find((l) => !byId.has(l.id));
    if (missing) throw fieldError("lines", `Indikator "${missing.name}" belum dinilai`);
    for (const line of a.lines) {
      const given = byId.get(line.id)!;
      await tx
        .update(AL)
        .set({ [field]: given.score, ...(given.comment !== undefined ? { comment: given.comment } : {}) })
        .where(eq(AL.id, line.id));
    }
    return weightedScore(a.lines.map((l) => ({ weight: l.weight, score: byId.get(l.id)!.score })))!;
  }

  /** Karyawan pemilik, atasan penilai, atau hr.read. */
  private access(a: { employeeUserId: string | null; managerUserId: string | null }) {
    const ctx = currentContext();
    if (hasPermission(ctx.permissions, "hr.read")) return;
    if (a.employeeUserId === ctx.userId || a.managerUserId === ctx.userId) return;
    throw new ForbiddenException("Butuh permission hr.read");
  }

  async load(tx: Db, id: string) {
    const [a] = await appraisalQuery(tx, eq(AP.id, id));
    if (!a) throw new NotFoundException("Penilaian tidak ditemukan");
    const lines = await tx.select().from(AL).where(eq(AL.appraisalId, id)).orderBy(asc(AL.sequence));
    return { ...a, lines };
  }
}

@Controller("me")
class PortalPerformanceController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  /** Penilaian milik sendiri dan yang perlu dinilai sebagai atasan. */
  @Get("appraisals")
  mine() {
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const rows = await appraisalQuery(tx, or(eq(E.userId, ctx.userId), eq(AP.managerUserId, ctx.userId)));
      return rows.map((r) => ({ ...r, role: r.employeeUserId === ctx.userId ? "self" : "manager" }));
    });
  }
}

// ---- Pelatihan ----

@Controller("trainings")
class TrainingsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          training: TR,
          participants: sql<number>`(select count(*)::int from ${TP} p where p.training_id = trainings.id)`,
          completed: sql<number>`(select count(*)::int from ${TP} p where p.training_id = trainings.id and p.state = 'completed')`,
        })
        .from(TR)
        .where(eq(TR.companyId, companyId()))
        .orderBy(desc(TR.dateStart))
        .then((rows) =>
          rows.map((r) => ({ ...r.training, participants: r.participants, completed: r.completed })),
        ),
    );
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.load(tx, id));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(trainingSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .insert(TR)
        .values({ ...this.values(input), companyId: companyId() })
        .returning();
      return this.load(tx, row!.id);
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(trainingSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      await tx
        .update(TR)
        .set({ ...this.values(input), updatedAt: sql`now()` })
        .where(eq(TR.id, id));
      return this.load(tx, id);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => tx.delete(TR).where(and(eq(TR.id, id), eq(TR.companyId, companyId()))));
  }

  @Post(":id/participants")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  addParticipants(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(trainingParticipantsSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      const valid = await tx
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.companyId, companyId()), inArray(E.id, input.employeeIds)));
      if (valid.length !== new Set(input.employeeIds).size)
        throw fieldError("employeeIds", "Karyawan tidak ditemukan di perusahaan ini");
      await tx
        .insert(TP)
        .values(valid.map((e) => ({ trainingId: id, employeeId: e.id })))
        .onConflictDoNothing();
      return this.load(tx, id);
    });
  }

  /** Hasil peserta: selesai (dengan sertifikat opsional → dokumen karyawan berkedaluwarsa) atau tidak hadir. */
  @Put(":id/participants/:participantId")
  @RequirePermission("hr.manage")
  result(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("participantId", ParseUUIDPipe) participantId: string,
    @Body() body: unknown,
  ) {
    const input = parse(trainingResultSchema, body);
    return this.tenantDb.run(async (tx) => {
      const training = await this.find(tx, id);
      const [p] = await tx
        .select()
        .from(TP)
        .where(and(eq(TP.id, participantId), eq(TP.trainingId, id)));
      if (!p) throw new NotFoundException("Peserta pelatihan tidak ditemukan");
      const expiry =
        input.state !== "completed"
          ? null
          : (input.certificateExpiry ??
            (training.certificateValidMonths
              ? addMonths(training.dateEnd, training.certificateValidMonths)
              : null));
      let documentId = p.certificateDocumentId;
      if (input.state === "completed" && input.certificate) {
        const [doc] = await tx
          .insert(schema.hrDocuments)
          .values({
            companyId: training.companyId,
            employeeId: p.employeeId,
            kind: "certificate",
            name: `Sertifikat ${training.name}`,
            file: Buffer.from(input.certificate.data, "base64"),
            fileName: input.certificate.name,
            fileType: input.certificate.type,
            issuedDate: training.dateEnd,
            expiryDate: expiry,
            createdBy: currentContext().userId,
          })
          .returning({ id: schema.hrDocuments.id });
        documentId = doc!.id;
      } else if (documentId)
        await tx
          .update(schema.hrDocuments)
          .set({ expiryDate: expiry, updatedAt: sql`now()` })
          .where(eq(schema.hrDocuments.id, documentId));
      await tx
        .update(TP)
        .set({ state: input.state, certificateExpiry: expiry, certificateDocumentId: documentId })
        .where(eq(TP.id, participantId));
      return this.load(tx, id);
    });
  }

  @Delete(":id/participants/:participantId")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async removeParticipant(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("participantId", ParseUUIDPipe) participantId: string,
  ) {
    await this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      await tx.delete(TP).where(and(eq(TP.id, participantId), eq(TP.trainingId, id)));
    });
  }

  private values(input: z.infer<typeof trainingSchema>) {
    return {
      ...input,
      provider: input.provider ?? null,
      certificateValidMonths: input.certificateValidMonths ?? null,
      description: input.description ?? null,
    };
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(TR)
      .where(and(eq(TR.id, id), eq(TR.companyId, companyId())));
    if (!row) throw new NotFoundException("Pelatihan tidak ditemukan");
    return row;
  }

  private async load(tx: Db, id: string) {
    const training = await this.find(tx, id);
    const participants = await tx
      .select({ participant: TP, employeeName: E.name, employeeNumber: E.employeeNumber })
      .from(TP)
      .innerJoin(E, eq(E.id, TP.employeeId))
      .where(eq(TP.trainingId, id))
      .orderBy(asc(E.name));
    return {
      ...training,
      participants: participants.map((p) => ({
        ...p.participant,
        employeeName: p.employeeName,
        employeeNumber: p.employeeNumber,
      })),
    };
  }
}

const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

// ---- Riwayat, org chart, dashboard ----

@Controller()
class HrInsightsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  @Get("employees/:id/history")
  @RequirePermission("hr.read")
  employeeHistory(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const [e] = await tx
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.id, id), eq(E.companyId, companyId())));
      if (!e) throw new NotFoundException("Karyawan tidak ditemukan");
      const [history, trainings] = await Promise.all([
        this.history.list(tx, id),
        tx
          .select({
            id: TR.id,
            name: TR.name,
            dateEnd: TR.dateEnd,
            state: TP.state,
            certificateExpiry: TP.certificateExpiry,
          })
          .from(TP)
          .innerJoin(TR, eq(TR.id, TP.trainingId))
          .where(eq(TP.employeeId, id))
          .orderBy(desc(TR.dateStart)),
      ]);
      const appraisals = await tx
        .select({
          id: AP.id,
          cycleName: CY.name,
          finalScore: AP.finalScore,
          rating: AP.rating,
          state: AP.state,
        })
        .from(AP)
        .innerJoin(CY, eq(CY.id, AP.cycleId))
        .where(eq(AP.employeeId, id))
        .orderBy(desc(CY.dateStart));
      return { history, trainings, appraisals };
    });
  }

  /** Struktur organisasi dari atasan langsung karyawan aktif. */
  @Get("hr/org-chart")
  @RequirePermission("hr.read")
  orgChart() {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({
          id: E.id,
          name: E.name,
          managerId: E.managerId,
          jobName: schema.jobPositions.name,
          departmentName: schema.departments.name,
          hasPhoto: sql<boolean>`exists (select 1 from employee_photos p where p.employee_id = ${E.id})`,
        })
        .from(E)
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
        .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .where(and(eq(E.companyId, companyId()), eq(E.active, true)))
        .orderBy(asc(E.name));
      return orgTree(rows);
    });
  }

  /** Dashboard HR tahunan: headcount, masuk/keluar, turnover, cuti, lembur, biaya tenaga kerja per bulan. */
  @Get("hr/dashboard")
  @RequirePermission("hr.read")
  dashboard(@Query("year") yearParam?: string) {
    const year = Number(yearParam) || new Date().getUTCFullYear();
    return this.tenantDb.run(async (tx) => {
      const cid = companyId();
      const yStart = `${year}-01-01`;
      const yEnd = `${year}-12-31`;
      const employees = await tx
        .select({
          joinDate: E.joinDate,
          resignDate: E.resignDate,
          gender: E.gender,
          departmentName: schema.departments.name,
        })
        .from(E)
        .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .where(eq(E.companyId, cid));
      const activeOn = (date: string) =>
        employees.filter((e) => e.joinDate <= date && (!e.resignDate || e.resignDate > date));
      const monthEnd = (m: number) => new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
      const per = <T extends string>(rows: { key: T; value: string | number }[]) =>
        new Map(rows.map((r) => [r.key, Number(r.value)]));
      const leave = per(
        await tx
          .select({
            key: sql<string>`to_char(${schema.leaveRequests.dateFrom}, 'MM')`,
            value: sql<string>`sum(${schema.leaveRequests.days})::text`,
          })
          .from(schema.leaveRequests)
          .where(
            and(
              eq(schema.leaveRequests.companyId, cid),
              eq(schema.leaveRequests.state, "approved"),
              gte(schema.leaveRequests.dateFrom, yStart),
              lte(schema.leaveRequests.dateFrom, yEnd),
            ),
          )
          .groupBy(sql`1`),
      );
      const overtime = per(
        await tx
          .select({
            key: sql<string>`to_char(${schema.overtimes.date}, 'MM')`,
            value: sql<string>`sum(${schema.overtimes.hours})::text`,
          })
          .from(schema.overtimes)
          .where(
            and(
              eq(schema.overtimes.companyId, cid),
              eq(schema.overtimes.state, "approved"),
              gte(schema.overtimes.date, yStart),
              lte(schema.overtimes.date, yEnd),
            ),
          )
          .groupBy(sql`1`),
      );
      // Biaya tenaga kerja = pendapatan + iuran perusahaan BPJS Kesehatan + BPJS Ketenagakerjaan (dilaporkan terpisah).
      const costRows = await tx
        .select({
          key: sql<string>`to_char(${schema.payrollRuns.periodStart}, 'MM')`,
          earnings: sql<string>`sum(${schema.payslips.earnings})::text`,
          kes: sql<string>`sum(${schema.payslips.kesEmployer})::text`,
          tk: sql<string>`sum(${schema.payslips.tkEmployer})::text`,
        })
        .from(schema.payslips)
        .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
        .where(
          and(
            eq(schema.payslips.companyId, cid),
            inArray(schema.payrollRuns.state, ["done", "paid"]),
            gte(schema.payrollRuns.periodStart, yStart),
            lte(schema.payrollRuns.periodStart, yEnd),
          ),
        )
        .groupBy(sql`1`);
      const cost = new Map(costRows.map((r) => [r.key, r]));
      const months = Array.from({ length: 12 }, (_, i) => {
        const mm = String(i + 1).padStart(2, "0");
        const from = `${year}-${mm}-01`;
        const to = monthEnd(i + 1);
        return {
          month: `${year}-${mm}`,
          headcount: activeOn(to).length,
          joins: employees.filter((e) => e.joinDate >= from && e.joinDate <= to).length,
          leaves: employees.filter((e) => e.resignDate && e.resignDate >= from && e.resignDate <= to).length,
          leaveDays: leave.get(mm) ?? 0,
          overtimeHours: overtime.get(mm) ?? 0,
          labourCost: (
            Number(cost.get(mm)?.earnings ?? 0) +
            Number(cost.get(mm)?.kes ?? 0) +
            Number(cost.get(mm)?.tk ?? 0)
          ).toFixed(0),
          bpjsKesCost: Number(cost.get(mm)?.kes ?? 0).toFixed(0),
          bpjsTkCost: Number(cost.get(mm)?.tk ?? 0).toFixed(0),
        };
      });
      const today = new Date().toISOString().slice(0, 10);
      const current = activeOn(today);
      const count = (values: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const v of values) m.set(v ?? "", (m.get(v ?? "") ?? 0) + 1);
        return [...m.entries()]
          .map(([key, n]) => ({ key: key || null, count: n }))
          .sort((a, b) => b.count - a.count);
      };
      const leavers = employees.filter(
        (e) => e.resignDate && e.resignDate >= yStart && e.resignDate <= yEnd,
      ).length;
      const startCount = employees.filter(
        (e) => e.joinDate < yStart && (!e.resignDate || e.resignDate >= yStart),
      ).length;
      const endCount = activeOn(yEnd < today ? yEnd : today).length;
      const [ratings] = await Promise.all([
        tx
          .select({ rating: AP.rating, count: sql<number>`count(*)::int` })
          .from(AP)
          .innerJoin(CY, eq(CY.id, AP.cycleId))
          .where(
            and(
              eq(AP.companyId, cid),
              eq(AP.state, "done"),
              gte(CY.dateEnd, yStart),
              lte(CY.dateStart, yEnd),
            ),
          )
          .groupBy(AP.rating),
      ]);
      const [trainingCost] = await tx
        .select({ cost: sql<string>`coalesce(sum(${TR.cost}), 0)::text` })
        .from(TR)
        .where(
          and(
            eq(TR.companyId, cid),
            sql`${TR.state} <> 'cancel'`,
            gte(TR.dateStart, yStart),
            lte(TR.dateStart, yEnd),
          ),
        );
      return {
        year,
        headcount: current.length,
        byDepartment: count(current.map((e) => e.departmentName)),
        byGender: count(current.map((e) => e.gender)),
        joins: months.reduce((s, m) => s + m.joins, 0),
        leavers,
        turnover: turnoverRate(leavers, startCount, endCount),
        ratings: ratings.sort((a, b) => String(a.rating).localeCompare(String(b.rating))),
        trainingCost: Number(trainingCost?.cost ?? 0).toFixed(0),
        months,
      };
    });
  }
}

/** Penilaian kinerja, pelatihan, riwayat karir, struktur organisasi, dan dashboard HR. */
@Module({
  imports: [HrModule],
  controllers: [
    AppraisalTemplatesController,
    AppraisalCyclesController,
    AppraisalsController,
    PortalPerformanceController,
    TrainingsController,
    HrInsightsController,
  ],
  providers: [ActivityService],
})
export class PerformanceModule {}
