import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, schema, sql, type Db } from "@erp/db";
import {
  addDays,
  applicantSchema,
  applicantStageSchema,
  checklistStartSchema,
  checklistTemplateSchema,
  employeeSchema,
  expiryStatus,
  hireSchema,
  hrDocumentSchema,
  interviewSchema,
  jobOpeningSchema,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { reportError } from "../common/error-reporting.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ChecklistService } from "./checklist.service.js";
import { EmployeeService } from "./employee.service.js";
import { HrModule } from "./hr.module.js";

const D = schema.hrDocuments;
const AP = schema.applicants;
const IV = schema.applicantInterviews;
const today = () => new Date().toISOString().slice(0, 10);

// ---- Dokumen ----

/** Dokumen karyawan/pelamar (KTP, NPWP, ijazah, kontrak, sertifikat, …) — khusus hr.manage. */
@Controller("hr-documents")
class DocumentsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.manage")
  list(@Query() query: { employeeId?: string; applicantId?: string }) {
    return this.tenantDb.run(async (tx) => {
      if (!query.employeeId && !query.applicantId)
        throw new BadRequestException("Pilih karyawan atau pelamar");
      const rows = await tx
        .select({
          id: D.id,
          employeeId: D.employeeId,
          applicantId: D.applicantId,
          kind: D.kind,
          name: D.name,
          fileName: D.fileName,
          fileType: D.fileType,
          number: D.number,
          size: sql<number>`octet_length(${D.file})::int`,
          issuedDate: D.issuedDate,
          expiryDate: D.expiryDate,
          note: D.note,
          createdAt: D.createdAt,
        })
        .from(D)
        .where(
          and(
            eq(D.companyId, currentContext().companyId),
            query.employeeId ? eq(D.employeeId, query.employeeId) : undefined,
            query.applicantId ? eq(D.applicantId, query.applicantId) : undefined,
          ),
        )
        .orderBy(asc(D.kind), desc(D.createdAt));
      return rows.map((r) => ({ ...r, expiry: expiryStatus(r.expiryDate, today()) }));
    });
  }

  /** Dokumen yang kedaluwarsa atau akan kedaluwarsa dalam `days` hari (bawaan 30). */
  @Get("expiring")
  @RequirePermission("hr.manage")
  expiring(@Query("days") days?: string) {
    return this.tenantDb.run((tx) => expiringDocuments(tx, currentContext().companyId, Number(days) || 30));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(hrDocumentSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      if (input.employeeId) {
        const [e] = await tx
          .select({ id: schema.employees.id })
          .from(schema.employees)
          .where(and(eq(schema.employees.id, input.employeeId), eq(schema.employees.companyId, companyId)));
        if (!e) throw fieldError("employeeId", "Karyawan tidak ditemukan di perusahaan ini");
      }
      if (input.applicantId) {
        const [a] = await tx
          .select({ id: AP.id })
          .from(AP)
          .where(and(eq(AP.id, input.applicantId), eq(AP.companyId, companyId)));
        if (!a) throw fieldError("applicantId", "Pelamar tidak ditemukan");
      }
      const { file, ...rest } = input;
      const [row] = await tx
        .insert(D)
        .values({
          ...rest,
          employeeId: rest.employeeId ?? null,
          applicantId: rest.applicantId ?? null,
          issuedDate: rest.issuedDate ?? null,
          expiryDate: rest.expiryDate ?? null,
          note: rest.note ?? null,
          companyId,
          file: Buffer.from(file.data, "base64"),
          fileName: file.name,
          fileType: file.type,
          createdBy: currentContext().userId,
        })
        .returning({ id: D.id, name: D.name, kind: D.kind, expiryDate: D.expiryDate });
      return row!;
    });
  }

  @Get(":id/file")
  @RequirePermission("hr.manage")
  async file(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("inline") inline: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .select({ file: D.file, name: D.fileName, type: D.fileType })
        .from(D)
        .where(and(eq(D.id, id), eq(D.companyId, currentContext().companyId)));
      if (!row) throw new NotFoundException("Dokumen tidak ditemukan");
      return row;
    });
    // inline=1 → pratinjau gambar/PDF di browser (kartu identitas).
    if (inline) res.type(doc.type).setHeader("Content-Disposition", "inline").send(doc.file);
    else res.type(doc.type).attachment(doc.name).send(doc.file);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) =>
      tx.delete(D).where(and(eq(D.id, id), eq(D.companyId, currentContext().companyId))),
    );
  }
}

async function expiringDocuments(tx: Db, companyId: string, days: number) {
  const rows = await tx
    .select({
      id: D.id,
      kind: D.kind,
      name: D.name,
      expiryDate: D.expiryDate,
      employeeId: D.employeeId,
      employeeName: schema.employees.name,
    })
    .from(D)
    .innerJoin(schema.employees, eq(schema.employees.id, D.employeeId))
    .where(
      and(
        eq(D.companyId, companyId),
        eq(schema.employees.active, true),
        isNotNull(D.expiryDate),
        lte(D.expiryDate, addDays(today(), days)),
      ),
    )
    .orderBy(asc(D.expiryDate));
  return rows.map((r) => ({ ...r, expiry: expiryStatus(r.expiryDate, today(), days) }));
}

/** Pengingat HR: dokumen kedaluwarsa, kontrak PKWT berakhir, tugas checklist lewat tenggat. */
async function reminders(tx: Db, companyId: string, days: number) {
  const contracts = await tx
    .select({
      id: schema.contracts.id,
      name: schema.contracts.name,
      dateEnd: schema.contracts.dateEnd,
      employeeId: schema.contracts.employeeId,
      employeeName: schema.employees.name,
    })
    .from(schema.contracts)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.contracts.employeeId))
    .where(
      and(
        eq(schema.contracts.companyId, companyId),
        eq(schema.contracts.state, "running"),
        eq(schema.contracts.contractType, "pkwt"),
        isNotNull(schema.contracts.dateEnd),
        lte(schema.contracts.dateEnd, addDays(today(), days)),
      ),
    )
    .orderBy(asc(schema.contracts.dateEnd));
  const tasks = await tx
    .select({
      id: schema.hrChecklistTasks.id,
      name: schema.hrChecklistTasks.name,
      dueDate: schema.hrChecklistTasks.dueDate,
      checklistId: schema.hrChecklists.id,
      employeeName: schema.employees.name,
    })
    .from(schema.hrChecklistTasks)
    .innerJoin(schema.hrChecklists, eq(schema.hrChecklists.id, schema.hrChecklistTasks.checklistId))
    .innerJoin(schema.employees, eq(schema.employees.id, schema.hrChecklists.employeeId))
    .where(
      and(
        eq(schema.hrChecklists.companyId, companyId),
        eq(schema.hrChecklists.state, "open"),
        isNull(schema.hrChecklistTasks.doneAt),
        sql`${schema.hrChecklistTasks.dueDate} < current_date`,
      ),
    )
    .orderBy(asc(schema.hrChecklistTasks.dueDate));
  // Surat peringatan yang masih berlaku dan akan berakhir dalam `days` hari.
  const warnings = await tx
    .select({
      id: schema.employeeWarnings.id,
      level: schema.employeeWarnings.level,
      validUntil: schema.employeeWarnings.validUntil,
      employeeId: schema.employeeWarnings.employeeId,
      employeeName: schema.employees.name,
    })
    .from(schema.employeeWarnings)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.employeeWarnings.employeeId))
    .where(
      and(
        eq(schema.employeeWarnings.companyId, companyId),
        sql`${schema.employeeWarnings.validUntil} >= current_date`,
        lte(schema.employeeWarnings.validUntil, addDays(today(), days)),
      ),
    )
    .orderBy(asc(schema.employeeWarnings.validUntil));
  return {
    documents: await expiringDocuments(tx, companyId, days),
    contracts: contracts.map((c) => ({ ...c, expiry: expiryStatus(c.dateEnd, today(), days) })),
    overdueTasks: tasks,
    warnings: warnings.map((w) => ({ ...w, expiry: expiryStatus(w.validUntil, today(), days) })),
  };
}

@Controller("hr/reminders")
class RemindersController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query("days") days?: string) {
    return this.tenantDb.run((tx) => reminders(tx, currentContext().companyId, Number(days) || 30));
  }
}

/** Email pengingat HR harian ke pengguna ber-permission hr.manage (sekali per perusahaan per hari). */
@Injectable()
export class HrReminderService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("HrReminder");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(Mailer) private readonly mailer: Mailer,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.hrReminder.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDaily().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "hr-reminder" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Kirim pengingat untuk semua tenant; mengembalikan jumlah email terkirim. */
  async runDaily(tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let sent = 0;
    for (const tenantId of tenants) {
      const mails = await this.tenantDb
        .runAs(tenantId, async (tx) => {
          const out: { to: string; subject: string; text: string }[] = [];
          const companies = await tx
            .select({ id: schema.companies.id, name: schema.companies.name })
            .from(schema.companies);
          for (const company of companies) {
            const r = await reminders(tx, company.id, 30);
            if (!r.documents.length && !r.contracts.length && !r.overdueTasks.length && !r.warnings.length)
              continue;
            const [logged] = await tx
              .insert(schema.hrReminderLog)
              .values({ companyId: company.id, sentOn: today() })
              .onConflictDoNothing()
              .returning();
            if (!logged) continue;
            const recipients = await tx
              .selectDistinct({ email: schema.users.email })
              .from(schema.users)
              .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
              .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
              .innerJoin(schema.userCompanies, eq(schema.userCompanies.userId, schema.users.id))
              .where(
                and(
                  eq(schema.users.active, true),
                  eq(schema.userCompanies.companyId, company.id),
                  inArray(schema.rolePermissions.permission, ["hr.manage", "*"]),
                ),
              );
            const lines = [
              ...r.contracts.map((c) => `- Kontrak PKWT ${c.name} (${c.employeeName}) berakhir ${c.dateEnd}`),
              ...r.documents.map(
                (d) => `- Dokumen ${d.name} (${d.employeeName}) kedaluwarsa ${d.expiryDate}`,
              ),
              ...r.overdueTasks.map(
                (t) => `- Tugas checklist "${t.name}" (${t.employeeName}) lewat tenggat ${t.dueDate}`,
              ),
              ...r.warnings.map(
                (w) => `- ${w.level.toUpperCase()} ${w.employeeName} berakhir ${w.validUntil}`,
              ),
            ];
            for (const { email } of recipients)
              out.push({
                to: email,
                subject: `Pengingat HR ${company.name}: ${lines.length} hal perlu ditindaklanjuti`,
                text: `Pengingat harian SDM (30 hari ke depan):\n\n${lines.join("\n")}\n`,
              });
          }
          return out;
        })
        .catch((e: unknown) => {
          this.logger.warn(`Pengingat HR tenant ${tenantId}: ${(e as Error).message}`);
          return [];
        });
      for (const mail of mails) {
        await this.mailer.send(mail).catch((e: unknown) => this.logger.warn((e as Error).message));
        sent++;
      }
    }
    return sent;
  }
}

// ---- Rekrutmen ----

const JobOpeningsController = createCrudController({
  path: "job-openings",
  model: "job_opening",
  table: schema.jobOpenings,
  schema: jobOpeningSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.jobOpenings.name],
  orderBy: schema.jobOpenings.dateOpen,
  companyColumn: schema.jobOpenings.companyId,
  perCompany: true,
  refs: { jobId: schema.jobPositions, departmentId: schema.departments },
});

/** Pelamar per lowongan: kanban tahap, wawancara, dan penerimaan menjadi karyawan. */
@Controller("applicants")
class ApplicantsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query() query: { openingId?: string; stage?: string }) {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          applicant: AP,
          openingName: schema.jobOpenings.name,
          nextInterview: sql<string | null>`(select min(i.scheduled_at) from ${IV} i
            where i.applicant_id = applicants.id and not i.done)`,
        })
        .from(AP)
        .innerJoin(schema.jobOpenings, eq(schema.jobOpenings.id, AP.openingId))
        .where(
          and(
            eq(AP.companyId, currentContext().companyId),
            query.openingId ? eq(AP.openingId, query.openingId) : undefined,
            query.stage ? eq(AP.stage, query.stage as "new") : undefined,
          ),
        )
        .orderBy(desc(AP.createdAt))
        .then((rows) =>
          rows.map((r) => ({ ...r.applicant, openingName: r.openingName, nextInterview: r.nextInterview })),
        ),
    );
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.load(tx, id));
  }

  @Post()
  @RequirePermission("hr.write")
  create(@Body() body: unknown) {
    const input = parse(applicantSchema, body);
    return this.tenantDb.run(async (tx) => {
      const opening = await this.opening(tx, input.openingId);
      if (opening.state !== "open") throw fieldError("openingId", "Lowongan sudah ditutup");
      const [row] = await tx
        .insert(AP)
        .values({
          ...input,
          email: input.email ?? null,
          expectedWage: input.expectedWage ?? null,
          notes: input.notes ?? null,
          companyId: opening.companyId,
        })
        .returning();
      return this.load(tx, row!.id);
    });
  }

  @Put(":id")
  @RequirePermission("hr.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(applicantSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      await this.opening(tx, input.openingId);
      await tx
        .update(AP)
        .set({
          ...input,
          email: input.email ?? null,
          expectedWage: input.expectedWage ?? null,
          notes: input.notes ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, id));
      return this.load(tx, id);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const a = await this.find(tx, id);
      if (a.stage === "hired")
        throw new BadRequestException("Pelamar yang sudah diterima tidak bisa dihapus");
      await tx.delete(D).where(and(eq(D.applicantId, id), isNull(D.employeeId)));
      await tx.delete(AP).where(eq(AP.id, id));
    });
  }

  /** Pindah tahap kanban (tahap "diterima" lewat /hire). */
  @Post(":id/stage")
  @HttpCode(200)
  @RequirePermission("hr.write")
  stage(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(applicantStageSchema, body);
    return this.tenantDb.run(async (tx) => {
      const a = await this.find(tx, id);
      if (a.stage === "hired") throw new BadRequestException("Pelamar sudah diterima menjadi karyawan");
      if (input.refuseReasonId) {
        const [reason] = await tx
          .select({ id: schema.refuseReasons.id })
          .from(schema.refuseReasons)
          .where(
            and(
              eq(schema.refuseReasons.id, input.refuseReasonId),
              eq(schema.refuseReasons.companyId, a.companyId),
            ),
          );
        if (!reason) throw fieldError("refuseReasonId", "Alasan penolakan tidak ditemukan");
      }
      const refused = input.stage === "refused";
      await tx
        .update(AP)
        .set({
          stage: input.stage,
          refuseReasonId: refused ? (input.refuseReasonId ?? null) : null,
          refuseReason: refused ? (input.refuseReason ?? null) : null,
          // Tahap terakhir sebelum ditolak (funnel laporan rekrutmen).
          refusedStage: refused ? (a.stage === "refused" ? a.refusedStage : a.stage) : null,
          ...(input.stage !== a.stage ? { stageChangedAt: sql`now()` } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, id));
      return this.load(tx, id);
    });
  }

  @Post(":id/interviews")
  @RequirePermission("hr.write")
  addInterview(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(interviewSchema, body);
    return this.tenantDb.run(async (tx) => {
      const a = await this.find(tx, id);
      await tx.insert(IV).values({ ...this.interviewValues(input), applicantId: id });
      // Wawancara pertama memindahkan pelamar baru/screening ke tahap wawancara.
      if (a.stage === "new" || a.stage === "screening")
        await tx
          .update(AP)
          .set({ stage: "interview", stageChangedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(AP.id, id));
      return this.load(tx, id);
    });
  }

  @Put(":id/interviews/:interviewId")
  @RequirePermission("hr.write")
  updateInterview(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("interviewId", ParseUUIDPipe) interviewId: string,
    @Body() body: unknown,
  ) {
    const input = parse(interviewSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      const [row] = await tx
        .update(IV)
        .set({ ...this.interviewValues(input), updatedAt: sql`now()` })
        .where(and(eq(IV.id, interviewId), eq(IV.applicantId, id)))
        .returning();
      if (!row) throw new NotFoundException("Wawancara tidak ditemukan");
      return this.load(tx, id);
    });
  }

  /**
   * Terima pelamar: buat data karyawan + kontrak draft, pindahkan dokumen pelamar ke karyawan, mulai checklist
   * onboarding, dan tutup lowongan bila kuota terpenuhi.
   */
  @Post(":id/hire")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  hire(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = parse(hireSchema, body);
    return this.tenantDb.run(async (tx) => {
      const a = await this.find(tx, id, true);
      if (a.stage === "hired") throw new BadRequestException("Pelamar sudah diterima menjadi karyawan");
      if (a.stage === "refused") throw new BadRequestException("Pelamar sudah ditolak");
      // Nilai bawaan dari penawaran kerja yang diterima pelamar.
      const [offer] = await tx
        .select()
        .from(schema.jobOffers)
        .where(and(eq(schema.jobOffers.applicantId, id), eq(schema.jobOffers.state, "accepted")))
        .orderBy(desc(schema.jobOffers.respondedAt))
        .limit(1);
      const input = {
        ...parsed,
        joinDate: parsed.joinDate ?? offer?.startDate,
        wage: parsed.wage ?? offer?.wage,
        contractType: parsed.contractType ?? offer?.contractType ?? "pkwtt",
        dateEnd: parsed.dateEnd ?? offer?.contractEnd ?? null,
      };
      if (!input.joinDate) throw fieldError("joinDate", "Isi tanggal mulai bekerja");
      if (!input.wage) throw fieldError("wage", "Isi gaji");
      if (input.contractType === "pkwt" && !input.dateEnd)
        throw fieldError("dateEnd", "PKWT wajib punya tanggal berakhir");
      const opening = await this.opening(tx, a.openingId);
      const employee = await this.employees.create(
        tx,
        parse(employeeSchema, {
          name: a.name,
          workEmail: a.email,
          workPhone: a.phone,
          departmentId: opening.departmentId,
          jobId: opening.jobId,
          joinDate: input.joinDate,
          ptkpStatus: input.ptkpStatus,
        }),
      );
      const contractName = await this.sequences.next(
        tx,
        "hr.contract",
        employee.companyId,
        new Date(`${input.joinDate}T00:00:00Z`),
        "KTR",
      );
      const [contract] = await tx
        .insert(schema.contracts)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          name: contractName,
          contractType: input.contractType,
          dateStart: input.joinDate,
          dateEnd: input.dateEnd ?? null,
          wage: input.wage,
          note: `Dari rekrutmen: ${opening.name}`,
        })
        .returning({ id: schema.contracts.id });
      await tx
        .update(D)
        .set({ employeeId: employee.id, updatedAt: sql`now()` })
        .where(eq(D.applicantId, id));
      await tx
        .update(AP)
        .set({
          stage: "hired",
          employeeId: employee.id,
          hiredAt: sql`now()`,
          stageChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, id));
      const [hired] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(AP)
        .where(and(eq(AP.openingId, opening.id), eq(AP.stage, "hired")));
      if ((hired?.n ?? 0) >= opening.quota)
        await tx
          .update(schema.jobOpenings)
          .set({ state: "closed", dateClose: today(), updatedAt: sql`now()` })
          .where(eq(schema.jobOpenings.id, opening.id));
      const checklist = await this.checklists.start(tx, { employeeId: employee.id, kind: "onboarding" });
      await this.activity.log(tx, {
        resModel: "employee",
        resId: employee.id,
        action: "comment",
        message: `Diterima dari rekrutmen ${opening.name}`,
      });
      return { employeeId: employee.id, contractId: contract!.id, checklistId: checklist.id };
    });
  }

  private interviewValues(input: z.infer<typeof interviewSchema>) {
    return {
      scheduledAt: new Date(input.scheduledAt),
      interviewerId: input.interviewerId ?? null,
      location: input.location ?? null,
      result: input.result ?? null,
      score: input.score ?? null,
      done: input.done,
    };
  }

  private async load(tx: Db, id: string) {
    const a = await this.find(tx, id);
    const [opening] = await tx
      .select({ name: schema.jobOpenings.name })
      .from(schema.jobOpenings)
      .where(eq(schema.jobOpenings.id, a.openingId));
    const [reason] = a.refuseReasonId
      ? await tx
          .select({ name: schema.refuseReasons.name })
          .from(schema.refuseReasons)
          .where(eq(schema.refuseReasons.id, a.refuseReasonId))
      : [];
    const interviews = await tx
      .select({ interview: IV, interviewerName: schema.users.name })
      .from(IV)
      .leftJoin(schema.users, eq(schema.users.id, IV.interviewerId))
      .where(eq(IV.applicantId, id))
      .orderBy(asc(IV.scheduledAt));
    return {
      ...a,
      openingName: opening?.name ?? "",
      refuseReasonName: reason?.name ?? null,
      interviews: interviews.map((r) => ({ ...r.interview, interviewerName: r.interviewerName })),
    };
  }

  private async find(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(AP)
      .where(and(eq(AP.id, id), eq(AP.companyId, currentContext().companyId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundException("Pelamar tidak ditemukan");
    return row;
  }

  private async opening(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(schema.jobOpenings)
      .where(
        and(eq(schema.jobOpenings.id, id), eq(schema.jobOpenings.companyId, currentContext().companyId)),
      );
    if (!row) throw fieldError("openingId", "Lowongan tidak ditemukan");
    return row;
  }
}

// ---- Checklist ----

@Controller("hr-checklist-templates")
class ChecklistTemplatesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run((tx) => this.checklists.templates(tx));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(checklistTemplateSchema, body);
    return this.tenantDb.run((tx) => this.checklists.saveTemplate(tx, input));
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(checklistTemplateSchema, body);
    return this.tenantDb.run((tx) => this.checklists.saveTemplate(tx, input, id));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.checklists.removeTemplate(tx, id));
  }
}

@Controller("hr-checklists")
class ChecklistsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query() query: { employeeId?: string; state?: string }) {
    return this.tenantDb.run((tx) => this.checklists.list(tx, query));
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.checklists.get(tx, id));
  }

  @Post()
  @RequirePermission("hr.write")
  start(@Body() body: unknown) {
    const input = parse(checklistStartSchema, body);
    return this.tenantDb.run((tx) => this.checklists.start(tx, input));
  }

  /** Penanggung jawab tugas atau HR (diperiksa ChecklistService). */
  @Post("tasks/:taskId")
  @HttpCode(200)
  toggle(@Param("taskId", ParseUUIDPipe) taskId: string, @Body() body: unknown) {
    const { done } = parse(z.object({ done: z.boolean() }), body);
    return this.tenantDb.run((tx) => this.checklists.toggle(tx, taskId, done));
  }
}

@Controller("me")
class PortalChecklistController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
  ) {}

  @Get("checklist-tasks")
  tasks() {
    return this.tenantDb.run((tx) => this.checklists.myTasks(tx));
  }
}

/** Rekrutmen, dokumen karyawan, checklist onboarding/offboarding, dan pengingat HR. */
@Module({
  imports: [HrModule],
  controllers: [
    DocumentsController,
    RemindersController,
    JobOpeningsController,
    ApplicantsController,
    ChecklistTemplatesController,
    ChecklistsController,
    PortalChecklistController,
  ],
  providers: [ActivityService, SequenceService, HrReminderService],
  exports: [HrReminderService],
})
export class RecruitmentModule {}
