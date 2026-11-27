import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  Req,
  type OnModuleInit,
} from "@nestjs/common";
import { assertSalaryVisible, hideSalary } from "./privacy.js";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, schema, sql, type Db } from "@erp/db";
import {
  DEFAULT_OFFER_TEMPLATE,
  DEFAULT_REFUSE_REASONS,
  exitInterviewSchema,
  exitSummary,
  finalSettlement,
  jobOfferSchema,
  offboardSchema,
  offerResponseSchema,
  offerTemplateSchema,
  recruitmentReport,
  refuseReasonSchema,
  renderOfferTemplate,
  type SettlementKind,
  businessToday,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { Request, Response } from "express";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { LoanService } from "../payroll/loan.service.js";
import { PayrollModule } from "../payroll/payroll.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ChecklistService } from "./checklist.service.js";
import { EmployeeService } from "./employee.service.js";
import { HistoryService } from "./history.service.js";
import { openingFromHiring } from "./hiring-request.module.js";
import { ContractService } from "./contract.service.js";
import { HrModule } from "./hr.module.js";
import { ApprovalGateService } from "./approval-gate.service.js";
import { ApprovalEngineService } from "./approval-engine.service.js";
import { renderOfferPdf, renderSettlementPdf } from "./letters-pdf.js";
import { assertContractType } from "./contract-types.module.js";

const RR = schema.refuseReasons;
const OT = schema.offerTemplates;
const JO = schema.jobOffers;
const AP = schema.applicants;
const OP = schema.jobOpenings;
const EI = schema.exitInterviews;
const today = () => businessToday();
const longDate = (d: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const rupiah = (v: Decimal.Value) =>
  `Rp ${new Intl.NumberFormat("id-ID").format(Number(new Decimal(v).toFixed(0)))}`;

const RESIGN_LABEL: Record<string, string> = {
  resign: "Mengundurkan diri",
  end_contract: "Kontrak berakhir",
  termination: "PHK",
  retirement: "Pensiun",
  death: "Meninggal dunia",
  other: "Lainnya",
};

async function companyName(tx: Db, companyId: string) {
  const [c] = await tx
    .select({ name: schema.companies.name })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  return c?.name ?? "";
}

/** Master alasan penolakan & template penawaran; isi bawaan dibuat saat pertama dibuka. */
@Injectable()
export class RecruitmentSetupService {
  async ensureDefaults(tx: Db, companyId: string) {
    const [reason] = await tx.select({ id: RR.id }).from(RR).where(eq(RR.companyId, companyId)).limit(1);
    if (!reason)
      await tx
        .insert(RR)
        .values(DEFAULT_REFUSE_REASONS.map((name, i) => ({ companyId, name, sequence: (i + 1) * 10 })))
        .onConflictDoNothing();
    const [template] = await tx.select({ id: OT.id }).from(OT).where(eq(OT.companyId, companyId)).limit(1);
    if (!template) await tx.insert(OT).values({ companyId, ...DEFAULT_OFFER_TEMPLATE });
  }
}

@Controller("refuse-reasons")
class RefuseReasonsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(RecruitmentSetupService) private readonly setup: RecruitmentSetupService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query("active") active?: string) {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      await this.setup.ensureDefaults(tx, companyId);
      return tx
        .select()
        .from(RR)
        .where(and(eq(RR.companyId, companyId), active ? eq(RR.active, true) : undefined))
        .orderBy(asc(RR.sequence), asc(RR.name));
    });
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(refuseReasonSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .insert(RR)
        .values({ ...input, companyId: currentContext().companyId })
        .returning();
      return row!;
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(refuseReasonSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .update(RR)
        .set({ ...input, updatedAt: sql`now()` })
        .where(and(eq(RR.id, id), eq(RR.companyId, currentContext().companyId)))
        .returning();
      if (!row) throw new NotFoundException("Alasan penolakan tidak ditemukan");
      return row;
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const [used] = await tx.select({ id: AP.id }).from(AP).where(eq(AP.refuseReasonId, id)).limit(1);
      // Alasan yang sudah dipakai cukup dinonaktifkan agar laporan tetap utuh.
      if (used)
        await tx
          .update(RR)
          .set({ active: false, updatedAt: sql`now()` })
          .where(and(eq(RR.id, id), eq(RR.companyId, currentContext().companyId)));
      else await tx.delete(RR).where(and(eq(RR.id, id), eq(RR.companyId, currentContext().companyId)));
    });
  }
}

@Controller("offer-templates")
class OfferTemplatesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(RecruitmentSetupService) private readonly setup: RecruitmentSetupService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      await this.setup.ensureDefaults(tx, companyId);
      return tx.select().from(OT).where(eq(OT.companyId, companyId)).orderBy(asc(OT.name));
    });
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(offerTemplateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .insert(OT)
        .values({ ...input, companyId: currentContext().companyId })
        .returning();
      return row!;
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(offerTemplateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .update(OT)
        .set({ ...input, updatedAt: sql`now()` })
        .where(and(eq(OT.id, id), eq(OT.companyId, currentContext().companyId)))
        .returning();
      if (!row) throw new NotFoundException("Template penawaran tidak ditemukan");
      return row;
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) =>
      tx.delete(OT).where(and(eq(OT.id, id), eq(OT.companyId, currentContext().companyId))),
    );
  }
}

/** Surat penawaran kerja per pelamar: dibuat dari template, dikirim, lalu diterima/ditolak pelamar. */
@Injectable()
export class JobOfferService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ApprovalGateService) private readonly gate: ApprovalGateService,
  ) {}

  /** Penawaran terkirim yang lewat masa berlaku menjadi kedaluwarsa. */
  async expire(tx: Db, applicantId?: string) {
    await tx
      .update(JO)
      .set({ state: "expired", updatedAt: sql`now()` })
      .where(
        and(
          eq(JO.companyId, currentContext().companyId),
          inArray(JO.state, ["draft", "sent"]),
          lt(JO.validUntil, today()),
          applicantId ? eq(JO.applicantId, applicantId) : undefined,
        ),
      );
  }

  async list(tx: Db, applicantId: string) {
    await this.applicant(tx, applicantId);
    await this.expire(tx, applicantId);
    const rows = await tx
      .select()
      .from(JO)
      .where(eq(JO.applicantId, applicantId))
      .orderBy(desc(JO.createdAt));
    const required = rows.length ? await this.gate.enabled(tx, rows[0]!.companyId, "offer") : false;
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        approval: { required, request: await this.gate.summary(tx, r.approvalRequestId) },
      })),
    );
  }

  /** Ajukan penawaran draft ke persetujuan sebelum dikirim ke pelamar (bila diwajibkan). */
  async submitApproval(tx: Db, id: string) {
    const offer = await this.find(tx, id);
    if (offer.state !== "draft") throw new BadRequestException("Hanya penawaran draft yang bisa diajukan");
    const state = await this.gate.state(tx, offer.approvalRequestId);
    if (state === "pending" || state === "approved")
      throw new BadRequestException("Penawaran sudah diajukan untuk persetujuan");
    const a = await this.applicant(tx, offer.applicantId);
    const requestId = await this.gate.submit(tx, offer.companyId, "offer", {
      subject: `Penawaran kerja ${a.name}`,
      reference: offer.number ?? a.name,
      date: offer.startDate,
      amount: offer.wage,
      description: [
        `${a.name} — ${offer.contractType.toUpperCase()}, mulai ${offer.startDate}${offer.contractEnd ? ` s.d. ${offer.contractEnd}` : ""}.`,
        `Gaji ditawarkan Rp ${new Decimal(offer.wage).toFixed(0)}; berlaku s.d. ${offer.validUntil}.`,
        offer.benefits ? `Benefit: ${offer.benefits}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    await tx
      .update(JO)
      .set({ approvalRequestId: requestId, updatedAt: sql`now()` })
      .where(eq(JO.id, id));
    return this.find(tx, id);
  }

  async create(tx: Db, applicantId: string, input: z.infer<typeof jobOfferSchema>) {
    const a = await this.applicant(tx, applicantId, true);
    if (a.stage === "hired" || a.stage === "refused")
      throw new BadRequestException("Pelamar sudah diterima/ditolak");
    if (input.validUntil < today()) throw fieldError("validUntil", "Masa berlaku sudah lewat");
    await this.expire(tx, applicantId);
    const [active] = await tx
      .select({ id: JO.id })
      .from(JO)
      .where(and(eq(JO.applicantId, applicantId), inArray(JO.state, ["draft", "sent", "accepted"])));
    if (active) throw new BadRequestException("Pelamar masih punya penawaran aktif; batalkan dulu");
    const contractType = await assertContractType(tx, input.contractType, {
      dateStart: input.startDate,
      dateEnd: input.contractEnd,
      endField: "contractEnd",
    });
    let body = input.body ?? null;
    if (!body) {
      if (!input.templateId) throw fieldError("templateId", "Pilih template atau isi surat penawaran");
      const [template] = await tx
        .select()
        .from(OT)
        .where(and(eq(OT.id, input.templateId), eq(OT.companyId, a.companyId)));
      if (!template) throw fieldError("templateId", "Template penawaran tidak ditemukan");
      const [ctx] = await tx
        .select({ position: schema.jobPositions.name, department: schema.departments.name, opening: OP.name })
        .from(OP)
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, OP.jobId))
        .leftJoin(schema.departments, eq(schema.departments.id, OP.departmentId))
        .where(eq(OP.id, a.openingId));
      body = renderOfferTemplate(template.body, {
        nama: a.name,
        posisi: ctx?.position ?? ctx?.opening ?? "",
        departemen: ctx?.department ?? "—",
        gaji: rupiah(input.wage),
        tunjangan: input.benefits || "—",
        tanggal_mulai: longDate(input.startDate),
        berlaku_sampai: longDate(input.validUntil),
        jenis_kontrak: input.contractEnd
          ? `${contractType.name} s.d. ${longDate(input.contractEnd)}`
          : contractType.name,
        perusahaan: await companyName(tx, a.companyId),
        tanggal: longDate(today()),
      });
    }
    const number = await this.sequences.next(tx, "hr.job_offer", a.companyId, new Date(), "OFR");
    const [row] = await tx
      .insert(JO)
      .values({
        companyId: a.companyId,
        applicantId,
        templateId: input.templateId ?? null,
        number,
        wage: input.wage,
        benefits: input.benefits ?? null,
        contractType: input.contractType,
        contractEnd: input.contractEnd ?? null,
        startDate: input.startDate,
        validUntil: input.validUntil,
        body,
        createdBy: currentContext().userId,
      })
      .returning();
    if (a.stage !== "offer")
      await tx
        .update(AP)
        .set({ stage: "offer", stageChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(AP.id, applicantId));
    return row!;
  }

  async transition(
    tx: Db,
    id: string,
    action: "send" | "accept" | "decline" | "cancel",
    note: string | null = null,
  ) {
    await this.expire(tx);
    const offer = await this.find(tx, id);
    const allowed: Record<typeof action, string[]> = {
      send: ["draft"],
      accept: ["sent"],
      decline: ["sent"],
      cancel: ["draft", "sent"],
    };
    if (!allowed[action].includes(offer.state))
      throw new BadRequestException(
        offer.state === "expired" ? "Penawaran sudah kedaluwarsa" : "Status penawaran tidak sesuai",
      );
    if (action === "send")
      await this.gate.assertApproved(
        tx,
        await this.gate.enabled(tx, offer.companyId, "offer"),
        offer.approvalRequestId,
        "penawaran dikirim",
      );
    const state = { send: "sent", accept: "accepted", decline: "declined", cancel: "cancel" }[action] as
      "sent" | "accepted" | "declined" | "cancel";
    const [row] = await tx
      .update(JO)
      .set({
        state,
        ...(action === "send" ? { sentAt: sql`now()` } : {}),
        ...(action === "accept" || action === "decline"
          ? { respondedAt: sql`now()`, responseNote: note }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(JO.id, id))
      .returning();
    if (action === "decline") {
      // Pelamar menolak penawaran → ditolak dengan alasan bawaan "Menolak penawaran" (bila ada).
      const [reason] = await tx
        .select({ id: RR.id })
        .from(RR)
        .where(and(eq(RR.companyId, offer.companyId), eq(RR.name, "Menolak penawaran")));
      await tx
        .update(AP)
        .set({
          stage: "refused",
          refusedStage: "offer",
          refuseReasonId: reason?.id ?? null,
          refuseReason: note,
          stageChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(AP.id, offer.applicantId));
    }
    await this.activity.log(tx, {
      resModel: "applicant",
      resId: offer.applicantId,
      action: "comment",
      message: `Penawaran ${offer.number}: ${state}`,
    });
    return row!;
  }

  /** Penawaran yang diterima pelamar (dipakai sebagai nilai bawaan saat menerima menjadi karyawan). */
  async accepted(tx: Db, applicantId: string) {
    const [row] = await tx
      .select()
      .from(JO)
      .where(and(eq(JO.applicantId, applicantId), eq(JO.state, "accepted")))
      .orderBy(desc(JO.respondedAt))
      .limit(1);
    return row ?? null;
  }

  async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(JO)
      .where(and(eq(JO.id, id), eq(JO.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Penawaran tidak ditemukan");
    return row;
  }

  private async applicant(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(AP)
      .where(and(eq(AP.id, id), eq(AP.companyId, currentContext().companyId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundException("Pelamar tidak ditemukan");
    return row;
  }
}

@Controller()
class JobOffersController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(JobOfferService) private readonly offers: JobOfferService,
  ) {}

  @Get("applicants/:id/offers")
  @RequirePermission("hr.read")
  list(@Param("id", ParseUUIDPipe) id: string) {
    // Penawaran memuat gaji yang ditawarkan (juga di isi surat): nominalnya hanya untuk pemegang hak gaji.
    return this.tenantDb.run(async (tx) =>
      (await this.offers.list(tx, id)).map((o) => hideSalary(o, ["wage", "benefits", "body"])),
    );
  }

  @Post("applicants/:id/offers")
  @RequirePermission("hr.manage")
  create(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(jobOfferSchema, body);
    return this.tenantDb.run((tx) => this.offers.create(tx, id, input));
  }

  @Post("job-offers/:id/submit-approval")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  submitApproval(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.offers.submitApproval(tx, id));
  }

  // Express 5 tidak mendukung pola regex di path; tiap aksi didaftarkan sebagai path tetap.
  @Post(["job-offers/:id/send", "job-offers/:id/accept", "job-offers/:id/decline", "job-offers/:id/cancel"])
  @HttpCode(200)
  @RequirePermission("hr.manage")
  transition(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Body() body: unknown) {
    const action = req.path.split("/").pop() as "send" | "accept" | "decline" | "cancel";
    const input = parse(offerResponseSchema, body ?? {});
    return this.tenantDb.run((tx) => this.offers.transition(tx, id, action, input.note ?? null));
  }

  @Get("job-offers/:id/pdf")
  @RequirePermission("hr.read")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    assertSalaryVisible();
    const file = await this.tenantDb.run(async (tx) => {
      const offer = await this.offers.find(tx, id);
      return {
        name: `penawaran-${(offer.number ?? offer.id).replace(/[^\w.-]+/g, "_")}.pdf`,
        content: await renderOfferPdf({
          company: await companyName(tx, offer.companyId),
          number: offer.number,
          body: offer.body,
        }),
      };
    });
    res.type("application/pdf").attachment(file.name).send(file.content);
  }
}

/** FPK → lowongan & laporan rekrutmen. */
@Controller()
class RecruitmentPipelineController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  /** Buat lowongan dari Formulir Permintaan Karyawan yang sudah disetujui (sekali per FPK). */
  @Post("job-openings/from-fpk/:id")
  @RequirePermission("hr.manage")
  fromFpk(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const [req] = await tx
        .select({
          request: schema.approvalRequests,
          code: schema.approvalCategories.code,
          departmentId: schema.employees.departmentId,
          jobId: schema.employees.jobId,
        })
        .from(schema.approvalRequests)
        .innerJoin(
          schema.approvalCategories,
          eq(schema.approvalCategories.id, schema.approvalRequests.categoryId),
        )
        .leftJoin(schema.employees, eq(schema.employees.id, schema.approvalRequests.employeeId))
        .where(and(eq(schema.approvalRequests.id, id), eq(schema.approvalRequests.companyId, companyId)));
      if (!req) throw new NotFoundException("Permintaan tidak ditemukan");
      if (req.code !== "FPK" && req.code !== "FPK_NP")
        throw new BadRequestException("Hanya Formulir Permintaan Karyawan (FPK)");
      // FPK dari menu Usulan Penambahan: lowongan memakai data posisinya (jabatan, gaji, baris MPP).
      const [hiring] = await tx
        .select()
        .from(schema.hiringRequests)
        .where(eq(schema.hiringRequests.approvalRequestId, id));
      if (hiring)
        return openingFromHiring(tx, {
          ...hiring,
          state: req.request.state === "approved" ? "approved" : hiring.state,
        });
      if (req.request.state !== "approved") throw new BadRequestException("FPK belum disetujui");
      const [existing] = await tx.select({ id: OP.id }).from(OP).where(eq(OP.approvalRequestId, id));
      if (existing) throw new BadRequestException("Lowongan untuk FPK ini sudah dibuat");
      const [row] = await tx
        .insert(OP)
        .values({
          companyId,
          name: req.request.subject,
          departmentId: req.departmentId ?? null,
          description: req.request.description,
          quota: Math.max(1, Math.round(Number(req.request.quantity ?? 1))),
          targetDate: req.request.date,
          approvalRequestId: id,
        })
        .returning();
      return row!;
    });
  }

  /** Lowongan beserta nomor FPK asal (pelengkap daftar lowongan). */
  @Get("job-openings-fpk")
  @RequirePermission("hr.read")
  fpk() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          openingId: OP.id,
          requestId: schema.approvalRequests.id,
          number: schema.approvalRequests.number,
        })
        .from(OP)
        .innerJoin(schema.approvalRequests, eq(schema.approvalRequests.id, OP.approvalRequestId))
        .where(eq(OP.companyId, currentContext().companyId)),
    );
  }

  /** Time-to-fill, time-to-hire, funnel, sumber, alasan penolakan (lowongan dibuka dalam rentang). */
  @Get("recruitment/reports")
  @RequirePermission("hr.read")
  report(@Query("from") from?: string, @Query("to") to?: string) {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const openings = await tx
        .select()
        .from(OP)
        .where(
          and(
            eq(OP.companyId, companyId),
            from ? gte(OP.dateOpen, from) : undefined,
            to ? lte(OP.dateOpen, to) : undefined,
          ),
        )
        .orderBy(desc(OP.dateOpen));
      const applicants = openings.length
        ? await tx
            .select({ applicant: AP, reason: RR.name })
            .from(AP)
            .leftJoin(RR, eq(RR.id, AP.refuseReasonId))
            .where(
              inArray(
                AP.openingId,
                openings.map((o) => o.id),
              ),
            )
        : [];
      return recruitmentReport({
        openings: openings.map((o) => ({
          id: o.id,
          name: o.name,
          dateOpen: o.dateOpen,
          quota: o.quota,
          state: o.state,
        })),
        applicants: applicants.map(({ applicant: a, reason }) => ({
          openingId: a.openingId,
          stage: a.stage,
          source: a.source,
          createdAt: a.createdAt,
          hiredAt: a.hiredAt,
          refuseReason: reason ?? a.refuseReason,
          lastStage: a.refusedStage,
        })),
      });
    });
  }
}

// ---- Offboarding ----

const OR = schema.offboardingRequests;
const rp = (v: string) => `Rp${new Decimal(v).abs().toFixed(0)}`;

@Injectable()
export class OffboardingService implements OnModuleInit {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(LoanService) private readonly loans: LoanService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(ApprovalGateService) private readonly gate: ApprovalGateService,
    @Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService,
  ) {}

  onModuleInit() {
    // Keputusan persetujuan: keluar yang disetujui langsung diproses (dalam transaksi keputusan).
    this.engine.onOutcome(async (tx, requestId, state) => {
      const [req] = await tx
        .select()
        .from(OR)
        .where(and(eq(OR.approvalRequestId, requestId), eq(OR.state, "pending")));
      if (!req) return;
      await tx
        .update(OR)
        .set({ state, decidedAt: new Date(), updatedAt: sql`now()` })
        .where(eq(OR.id, req.id));
      const what = req.kind === "exit" ? "Pengajuan keluar" : "Full & Final Statement";
      const verdict = state === "approved" ? "disetujui" : state === "refused" ? "ditolak" : "dibatalkan";
      await this.activity.log(tx, {
        resModel: "employee",
        resId: req.employeeId,
        action: "comment",
        message: `${what} ${verdict}`,
      });
      if (state === "approved" && req.kind === "exit")
        await this.offboard(tx, req.employeeId, req.payload as z.infer<typeof offboardSchema>);
    });
  }

  /** Offboarding: langsung diproses, atau diajukan ke persetujuan bila pengaturan payroll mewajibkannya. */
  async offboardOrRequest(tx: Db, employeeId: string, input: z.infer<typeof offboardSchema>) {
    const employee = await this.employees.find(tx, employeeId);
    if (!(await this.gate.enabled(tx, employee.companyId, "offboarding")))
      return { pending: false, ...(await this.offboard(tx, employeeId, input)) };
    if (input.resignDate < employee.joinDate)
      throw fieldError("resignDate", "Tanggal keluar sebelum tanggal masuk");
    const request = await this.submit(tx, employee, "exit", input);
    return { pending: true, employeeId, contractId: null, checklistId: null, request };
  }

  /** Ajukan persetujuan Full & Final Statement (setelah karyawan keluar). */
  async requestSettlement(tx: Db, employeeId: string) {
    const employee = await this.employees.find(tx, employeeId);
    if (!employee.resignDate)
      throw new BadRequestException("Karyawan belum keluar; proses offboarding lebih dulu");
    return this.submit(tx, employee, "settlement", null);
  }

  /** Buat pengajuan dengan cuplikan F&F saat ini lalu ajukan ke mesin persetujuan (kategori OFFBOARD). */
  private async submit(
    tx: Db,
    employee: Awaited<ReturnType<EmployeeService["find"]>>,
    kind: "exit" | "settlement",
    payload: z.infer<typeof offboardSchema> | null,
  ) {
    const [pending] = await tx
      .select({ id: OR.id })
      .from(OR)
      .where(and(eq(OR.employeeId, employee.id), eq(OR.kind, kind), eq(OR.state, "pending")));
    if (pending)
      throw new BadRequestException(
        kind === "exit"
          ? "Pengajuan keluar karyawan ini masih menunggu persetujuan"
          : "Full & Final Statement karyawan ini masih menunggu persetujuan",
      );
    const settlement = await this.finalSettlement(tx, employee.id);
    const lines = settlement.items.map(
      (i) => `${i.direction === "deduct" ? "−" : "+"} ${i.label}: ${rp(i.amount)}`,
    );
    const netText = `${new Decimal(settlement.net).gte(0) ? "Dibayar ke karyawan" : "Ditagih ke karyawan"} ${rp(settlement.net)}`;
    const head =
      kind === "exit" && payload
        ? `Keluar ${payload.resignDate} — ${RESIGN_LABEL[payload.resignReason]}${payload.resignNote ? ` (${payload.resignNote})` : ""}`
        : `Full & Final Statement (keluar ${employee.resignDate})`;
    const requestId = await this.gate.submit(
      tx,
      employee.companyId,
      kind === "exit" ? "offboarding" : "settlement",
      {
        subject: `${kind === "exit" ? "Offboarding" : "Full & Final"} ${employee.name}`,
        reference: employee.employeeNumber,
        date: payload?.resignDate ?? employee.resignDate ?? businessToday(),
        amount: new Decimal(settlement.net).abs().toFixed(2),
        description: [head, ...lines, netText].join("\n").slice(0, 4000),
        employeeId: employee.id,
      },
    );
    const [row] = await tx
      .insert(OR)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        kind,
        payload: payload as Record<string, unknown> | null,
        settlement: settlement as unknown as Record<string, unknown>,
        net: settlement.net,
        approvalRequestId: requestId,
        createdBy: currentContext().userId,
      })
      .returning();
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `${kind === "exit" ? "Pengajuan keluar" : "Full & Final Statement"} diajukan untuk persetujuan: ${head}`,
    });
    return { id: row!.id, kind, state: row!.state, approval: await this.gate.summary(tx, requestId) };
  }

  /** Pengajuan terakhir per jenis (untuk panel offboarding & PDF F&F). */
  async approvals(tx: Db, employeeId: string) {
    const rows = await tx
      .select({
        id: OR.id,
        kind: OR.kind,
        state: OR.state,
        net: OR.net,
        createdAt: OR.createdAt,
        decidedAt: OR.decidedAt,
        payload: OR.payload,
        requestId: OR.approvalRequestId,
        number: schema.approvalRequests.number,
      })
      .from(OR)
      .leftJoin(schema.approvalRequests, eq(schema.approvalRequests.id, OR.approvalRequestId))
      .where(eq(OR.employeeId, employeeId))
      .orderBy(desc(OR.createdAt));
    return {
      exit: rows.find((r) => r.kind === "exit") ?? null,
      settlement: rows.find((r) => r.kind === "settlement") ?? null,
    };
  }

  /**
   * Catat karyawan keluar lewat kontraknya (tanggal keluar hanya diinput di kontrak): kontrak keluar yang sudah ada,
   * kontrak berjalan, atau kontrak terakhir diakhiri per tanggal keluar dengan alasan. Karyawan tanpa kontrak (data lama)
   * dicatat langsung.
   */
  async offboard(tx: Db, employeeId: string, input: z.infer<typeof offboardSchema>) {
    const employee = await this.employees.find(tx, employeeId);
    if (input.resignDate < employee.joinDate)
      throw fieldError("resignDate", "Tanggal keluar sebelum tanggal masuk");
    const C = schema.contracts;
    const contracts = await tx
      .select()
      .from(C)
      .where(and(eq(C.employeeId, employeeId), ne(C.state, "cancel"), ne(C.state, "draft")))
      .orderBy(desc(C.dateStart));
    const target =
      contracts.find((c) => c.endReason) ?? contracts.find((c) => c.state === "running") ?? contracts[0];
    if (target) {
      const { checklistId } = await this.contracts.end(tx, target.id, {
        dateEnd: input.resignDate,
        exit: true,
        resignReason: input.resignReason,
        resignNote: input.resignNote ?? null,
        startChecklist: input.startChecklist,
      });
      return { employeeId, contractId: target.id, checklistId };
    }
    await tx
      .update(schema.employees)
      .set({
        resignDate: input.resignDate,
        resignReason: input.resignReason,
        resignNote: input.resignNote ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.employees.id, employeeId));
    if (employee.resignDate !== input.resignDate)
      await this.history.record(tx, employee, "resign", {
        date: input.resignDate,
        oldValue: employee.resignDate,
        newValue: input.resignDate,
        note: RESIGN_LABEL[input.resignReason],
      });
    const checklist =
      input.startChecklist && !employee.resignDate
        ? await this.checklists.start(tx, { employeeId, kind: "offboarding", baseDate: input.resignDate })
        : null;
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employeeId,
      action: "comment",
      message: `Offboarding: keluar ${input.resignDate} (${RESIGN_LABEL[input.resignReason]})`,
    });
    return { employeeId, contractId: null, checklistId: checklist?.id ?? null };
  }

  async exitInterview(tx: Db, employeeId: string) {
    await this.employees.find(tx, employeeId);
    const [row] = await tx
      .select({ interview: EI, interviewerName: schema.users.name })
      .from(EI)
      .leftJoin(schema.users, eq(schema.users.id, EI.interviewerId))
      .where(eq(EI.employeeId, employeeId));
    return row ? { ...row.interview, interviewerName: row.interviewerName } : null;
  }

  async saveExitInterview(tx: Db, employeeId: string, input: z.infer<typeof exitInterviewSchema>) {
    const employee = await this.employees.find(tx, employeeId);
    const values = {
      date: input.date,
      interviewerId: input.interviewerId ?? null,
      mainReason: input.mainReason,
      scores: input.scores,
      wouldRejoin: input.wouldRejoin ?? null,
      wouldRecommend: input.wouldRecommend ?? null,
      comment: input.comment ?? null,
    };
    await tx
      .insert(EI)
      .values({ ...values, companyId: employee.companyId, employeeId, createdBy: currentContext().userId })
      .onConflictDoUpdate({ target: EI.employeeId, set: { ...values, updatedAt: sql`now()` } });
    return this.exitInterview(tx, employeeId);
  }

  /**
   * Full & Final Statement: gaji yang belum dibayar (payroll draft/belum dibayar, gaji ditahan), hak akhir/pesangon
   * terposting, klaim disetujui yang belum dibayar, dikurangi sisa pinjaman; plus tugas offboarding yang belum selesai.
   */
  async finalSettlement(tx: Db, employeeId: string) {
    const employee = await this.employees.find(tx, employeeId);
    const items: { kind: SettlementKind; label: string; amount: string; direction: "pay" | "deduct" }[] = [];
    const slips = await tx
      .select({ slip: schema.payslips, run: schema.payrollRuns })
      .from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .where(and(eq(schema.payslips.employeeId, employeeId), ne(schema.payrollRuns.state, "cancel")))
      .orderBy(asc(schema.payrollRuns.periodStart));
    for (const { slip, run } of slips) {
      const held = slip.holdReason && !slip.releasedAt;
      const label =
        run.state === "draft"
          ? `${run.name} (belum diposting)`
          : held
            ? `${run.name} (gaji ditahan)`
            : run.state === "done"
              ? `${run.name} (belum dibayar)`
              : null;
      if (label && new Decimal(slip.net).gt(0))
        items.push({ kind: "salary", label, amount: slip.net, direction: "pay" });
    }
    for (const s of await tx
      .select()
      .from(schema.severances)
      .where(and(eq(schema.severances.employeeId, employeeId), eq(schema.severances.state, "posted"))))
      items.push({
        kind: "severance",
        label: `Hak akhir/pesangon (${s.endDate})`,
        amount: s.net,
        direction: "pay",
      });
    for (const c of await tx
      .select({
        name: schema.expenseClaims.name,
        amount: sql<string>`coalesce((select sum(l.amount) from ${schema.expenseClaimLines} l where l.claim_id = ${schema.expenseClaims.id}), 0)::text`,
      })
      .from(schema.expenseClaims)
      .where(
        and(eq(schema.expenseClaims.employeeId, employeeId), eq(schema.expenseClaims.state, "approved")),
      ))
      items.push({ kind: "claim", label: `Klaim ${c.name}`, amount: c.amount, direction: "pay" });
    for (const loan of await this.loans.list(tx, { employeeId, state: "running" }))
      if (new Decimal(loan.remaining).gt(0))
        items.push({
          kind: "loan",
          label: `Sisa pinjaman ${loan.name}`,
          amount: loan.remaining,
          direction: "deduct",
        });
    const tasks = await tx
      .select({ name: schema.hrChecklistTasks.name, dueDate: schema.hrChecklistTasks.dueDate })
      .from(schema.hrChecklistTasks)
      .innerJoin(schema.hrChecklists, eq(schema.hrChecklists.id, schema.hrChecklistTasks.checklistId))
      .where(
        and(
          eq(schema.hrChecklists.employeeId, employeeId),
          eq(schema.hrChecklists.kind, "offboarding"),
          isNull(schema.hrChecklistTasks.doneAt),
        ),
      )
      .orderBy(asc(schema.hrChecklistTasks.sequence));
    return {
      employee: {
        id: employee.id,
        name: employee.name,
        employeeNumber: employee.employeeNumber,
        resignDate: employee.resignDate,
        resignReason: employee.resignReason,
        resignNote: employee.resignNote,
      },
      ...finalSettlement(items),
      openTasks: tasks,
    };
  }

  /** Alasan keluar karyawan (tanggal keluar dalam rentang) + ringkasan exit interview. */
  async exitReport(tx: Db, from?: string, to?: string) {
    const companyId = currentContext().companyId;
    const leavers = await tx
      .select({
        id: schema.employees.id,
        reason: schema.employees.resignReason,
        interview: EI,
      })
      .from(schema.employees)
      .leftJoin(EI, eq(EI.employeeId, schema.employees.id))
      .where(
        and(
          eq(schema.employees.companyId, companyId),
          sql`${schema.employees.resignDate} is not null`,
          from ? gte(schema.employees.resignDate, from) : undefined,
          to ? lte(schema.employees.resignDate, to) : undefined,
        ),
      );
    const byReason = new Map<string, number>();
    for (const l of leavers)
      byReason.set(l.reason ?? "unknown", (byReason.get(l.reason ?? "unknown") ?? 0) + 1);
    return {
      leavers: leavers.length,
      reasons: [...byReason.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      interviews: exitSummary(
        leavers
          .filter((l) => l.interview)
          .map((l) => ({
            mainReason: l.interview!.mainReason,
            scores: l.interview!.scores,
            wouldRejoin: l.interview!.wouldRejoin,
            wouldRecommend: l.interview!.wouldRecommend,
          })),
      ),
    };
  }
}

@Controller()
class OffboardingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(OffboardingService) private readonly offboarding: OffboardingService,
    @Inject(ApprovalGateService) private readonly gate: ApprovalGateService,
  ) {}

  @Post("employees/:id/offboard")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  offboard(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(offboardSchema, body);
    return this.tenantDb.run((tx) => this.offboarding.offboardOrRequest(tx, id, input));
  }

  @Get("employees/:id/exit-interview")
  @RequirePermission("hr.manage")
  exitInterview(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => (await this.offboarding.exitInterview(tx, id)) ?? {});
  }

  @Put("employees/:id/exit-interview")
  @RequirePermission("hr.manage")
  saveExitInterview(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(exitInterviewSchema, body);
    return this.tenantDb.run((tx) => this.offboarding.saveExitInterview(tx, id, input));
  }

  @Get("employees/:id/final-settlement")
  @RequirePermission("hr.manage")
  settlement(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const s = await this.offboarding.finalSettlement(tx, id);
      const [employee] = await tx
        .select({ companyId: schema.employees.companyId })
        .from(schema.employees)
        .where(eq(schema.employees.id, id));
      return {
        ...s,
        approvals: await this.offboarding.approvals(tx, id),
        offboardingApproval: await this.gate.enabled(tx, employee!.companyId, "offboarding"),
      };
    });
  }

  /** Ajukan persetujuan Full & Final Statement (kategori OFFBOARD) dengan cuplikan angka saat ini. */
  @Post("employees/:id/final-settlement/approval")
  @HttpCode(201)
  @RequirePermission("hr.manage")
  requestSettlement(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.offboarding.requestSettlement(tx, id));
  }

  @Get("employees/:id/final-settlement/pdf")
  @RequirePermission("hr.manage")
  async settlementPdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run(async (tx) => {
      const s = await this.offboarding.finalSettlement(tx, id);
      const approval = (await this.offboarding.approvals(tx, id)).settlement;
      const [e] = await tx
        .select({
          companyId: schema.employees.companyId,
          department: schema.departments.name,
          job: schema.jobPositions.name,
        })
        .from(schema.employees)
        .leftJoin(schema.departments, eq(schema.departments.id, schema.employees.departmentId))
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
        .where(eq(schema.employees.id, id));
      return {
        name: `full-final-${s.employee.employeeNumber}.pdf`.replace(/[^\w.-]+/g, "_"),
        content: await renderSettlementPdf({
          company: await companyName(tx, e!.companyId),
          employee: {
            name: s.employee.name,
            number: s.employee.employeeNumber,
            department: e!.department,
            job: e!.job,
          },
          resignDate: s.employee.resignDate,
          resignReason: s.employee.resignReason ? RESIGN_LABEL[s.employee.resignReason]! : null,
          items: s.items,
          totalPay: s.totalPay,
          totalDeduct: s.totalDeduct,
          net: s.net,
          openTasks: s.openTasks.map((t) => `${t.name} (tenggat ${t.dueDate})`),
          approval: approval
            ? `${approval.number ?? ""} — ${{ pending: "menunggu persetujuan", approved: "disetujui", refused: "ditolak", cancel: "dibatalkan" }[approval.state]}${approval.decidedAt ? ` ${approval.decidedAt.toISOString().slice(0, 10)}` : ""}`.trim()
            : null,
        }),
      };
    });
    res.type("application/pdf").attachment(file.name).send(file.content);
  }

  @Get("hr/reports/exit-reasons")
  @RequirePermission("hr.read")
  exitReport(@Query("from") from?: string, @Query("to") to?: string) {
    return this.tenantDb.run((tx) => this.offboarding.exitReport(tx, from, to));
  }
}

@Module({
  imports: [HrModule, PayrollModule],
  controllers: [
    RefuseReasonsController,
    OfferTemplatesController,
    JobOffersController,
    RecruitmentPipelineController,
    OffboardingController,
  ],
  providers: [ActivityService, SequenceService, RecruitmentSetupService, JobOfferService, OffboardingService],
  exports: [JobOfferService],
})
export class RecruitmentAdvancedModule {}
