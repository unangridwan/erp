import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  Req,
  Res,
} from "@nestjs/common";
import { hideSalary, personalVisible } from "./privacy.js";
import { and, asc, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import {
  employeeEducationSchema,
  employeeExperienceSchema,
  employeeFamilySchema,
  employeeMovementSchema,
  employeePhotoSchema,
  employeeWarningSchema,
  highestEducation,
  profileCompleteness,
  suggestedPtkp,
  warningActive,
  warningValidUntil,
  businessToday,
} from "@erp/shared";
import type { Request, Response } from "express";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ContractService } from "./contract.service.js";
import { ApprovalGateService } from "./approval-gate.service.js";
import { EmployeeService } from "./employee.service.js";
import { HistoryService } from "./history.service.js";
import { HrModule } from "./hr.module.js";

const E = schema.employees;
const PH = schema.employeePhotos;
const FA = schema.employeeFamily;
const ED = schema.employeeEducation;
const EX = schema.employeeExperiences;
const MV = schema.employeeMovements;
const WR = schema.employeeWarnings;
const today = () => businessToday();
const companyId = () => currentContext().companyId;

type Family = typeof FA.$inferSelect;

// ---- Foto ----

async function sendPhoto(tx: Db, employeeId: string, req: Request, res: Response) {
  const [row] = await tx.select().from(PH).where(eq(PH.employeeId, employeeId));
  if (!row) throw new NotFoundException("Foto belum diunggah");
  const etag = `"${row.updatedAt.getTime().toString(36)}"`;
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) return void res.status(304).end();
  res.type(row.photoType).send(row.photo);
}

async function savePhoto(tx: Db, employeeId: string, body: unknown) {
  const input = parse(employeePhotoSchema, body);
  const photo = Buffer.from(input.data, "base64");
  // Tanda tangan berkas harus cocok dengan tipe yang diklaim.
  const magic: Record<string, (b: Buffer) => boolean> = {
    "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
    "image/png": (b) => b.subarray(0, 4).toString("hex") === "89504e47",
    "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  };
  if (!magic[input.type]!(photo)) throw fieldError("data", "Berkas bukan gambar yang valid");
  await tx
    .insert(PH)
    .values({ employeeId, photo, photoType: input.type })
    .onConflictDoUpdate({
      target: PH.employeeId,
      set: { photo, photoType: input.type, updatedAt: sql`now()` },
    });
  return { ok: true };
}

@Controller("employees")
class EmployeePhotoController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get(":id/photo")
  @RequirePermission("hr.read")
  async get(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    await this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, id);
      await sendPhoto(tx, id, req, res);
    });
  }

  @Put(":id/photo")
  @RequirePermission("hr.manage")
  put(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, id);
      return savePhoto(tx, id, body);
    });
  }

  @Delete(":id/photo")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, id);
      await tx.delete(PH).where(eq(PH.employeeId, id));
    });
  }
}

// ---- Keluarga, pendidikan, pengalaman kerja ----

/** Keluarga: NIK anggota keluarga dienkripsi; tersamar untuk selain hr.manage. */
function shapeFamily(employees: EmployeeService, row: Family, full = personalVisible()) {
  const { nikEnc, ...rest } = row;
  return { ...rest, nik: nikEnc ? employees.open(nikEnc, full) : null };
}

function familyValues(employees: EmployeeService, input: Partial<z.infer<typeof employeeFamilySchema>>) {
  const { nik, ...rest } = input;
  const values: Record<string, unknown> = { ...rest };
  if (nik !== undefined && !(typeof nik === "string" && nik.startsWith("••••")))
    values.nikEnc = nik ? employees.seal(nik) : null;
  return values;
}

@Controller("employees/:employeeId")
class EmployeeProfileController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  private run<T>(employeeId: string, fn: (tx: Db) => Promise<T>) {
    return this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, employeeId);
      return fn(tx);
    });
  }

  private log(tx: Db, employeeId: string, message: string) {
    return this.activity.log(tx, { resModel: "employee", resId: employeeId, action: "comment", message });
  }

  @Get("family")
  @RequirePermission("hr.read")
  family(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.run(employeeId, async (tx) =>
      (await tx.select().from(FA).where(eq(FA.employeeId, employeeId)).orderBy(asc(FA.createdAt))).map((r) =>
        shapeFamily(this.employees, r),
      ),
    );
  }

  @Post("family")
  @RequirePermission("hr.manage")
  addFamily(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body() body: unknown) {
    const input = parse(employeeFamilySchema, body);
    return this.run(employeeId, async (tx) => {
      const [row] = await tx
        .insert(FA)
        .values({ ...(familyValues(this.employees, input) as typeof FA.$inferInsert), employeeId })
        .returning();
      await this.log(tx, employeeId, `Data keluarga ditambahkan: ${row!.name}`);
      return shapeFamily(this.employees, row!);
    });
  }

  @Put("family/:id")
  @RequirePermission("hr.manage")
  updateFamily(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(employeeFamilySchema, body);
    return this.run(employeeId, async (tx) => {
      const [row] = await tx
        .update(FA)
        .set({ ...familyValues(this.employees, input), updatedAt: sql`now()` })
        .where(and(eq(FA.id, id), eq(FA.employeeId, employeeId)))
        .returning();
      if (!row) throw new NotFoundException("Data keluarga tidak ditemukan");
      return shapeFamily(this.employees, row);
    });
  }

  @Delete("family/:id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async removeFamily(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.run(employeeId, (tx) =>
      tx.delete(FA).where(and(eq(FA.id, id), eq(FA.employeeId, employeeId))),
    );
  }

  @Get("education")
  @RequirePermission("hr.read")
  education(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.run(employeeId, (tx) => listEducation(tx, employeeId));
  }

  @Post("education")
  @RequirePermission("hr.manage")
  addEducation(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body() body: unknown) {
    const input = parse(employeeEducationSchema, body);
    return this.run(employeeId, async (tx) => {
      await assertDocument(tx, employeeId, input.documentId);
      const [row] = await tx
        .insert(ED)
        .values({ ...input, gpa: input.gpa == null ? null : String(input.gpa), employeeId })
        .returning();
      return row!;
    });
  }

  @Put("education/:id")
  @RequirePermission("hr.manage")
  updateEducation(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(employeeEducationSchema, body);
    return this.run(employeeId, async (tx) => {
      await assertDocument(tx, employeeId, input.documentId);
      const [row] = await tx
        .update(ED)
        .set({ ...input, gpa: input.gpa == null ? null : String(input.gpa), updatedAt: sql`now()` })
        .where(and(eq(ED.id, id), eq(ED.employeeId, employeeId)))
        .returning();
      if (!row) throw new NotFoundException("Riwayat pendidikan tidak ditemukan");
      return row;
    });
  }

  @Delete("education/:id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async removeEducation(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.run(employeeId, (tx) =>
      tx.delete(ED).where(and(eq(ED.id, id), eq(ED.employeeId, employeeId))),
    );
  }

  @Get("experiences")
  @RequirePermission("hr.read")
  experiences(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.run(employeeId, (tx) =>
      tx.select().from(EX).where(eq(EX.employeeId, employeeId)).orderBy(desc(EX.dateStart)),
    );
  }

  @Post("experiences")
  @RequirePermission("hr.manage")
  addExperience(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body() body: unknown) {
    const input = parse(employeeExperienceSchema, body);
    return this.run(employeeId, async (tx) => {
      const [row] = await tx
        .insert(EX)
        .values({ ...input, employeeId })
        .returning();
      return row!;
    });
  }

  @Put("experiences/:id")
  @RequirePermission("hr.manage")
  updateExperience(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = parse(employeeExperienceSchema, body);
    return this.run(employeeId, async (tx) => {
      const [row] = await tx
        .update(EX)
        .set({ ...input, updatedAt: sql`now()` })
        .where(and(eq(EX.id, id), eq(EX.employeeId, employeeId)))
        .returning();
      if (!row) throw new NotFoundException("Pengalaman kerja tidak ditemukan");
      return row;
    });
  }

  @Delete("experiences/:id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async removeExperience(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.run(employeeId, (tx) =>
      tx.delete(EX).where(and(eq(EX.id, id), eq(EX.employeeId, employeeId))),
    );
  }

  /** Ringkasan profil: kelengkapan, saran PTKP dari data keluarga, pendidikan tertinggi, SP yang berlaku. */
  @Get("profile-summary")
  @RequirePermission("hr.read")
  summary(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.tenantDb.run(async (tx) =>
      profileSummary(tx, this.employees, await this.employees.find(tx, employeeId)),
    );
  }
}

const listEducation = (tx: Db, employeeId: string) =>
  tx
    .select({ education: ED, documentName: schema.hrDocuments.name })
    .from(ED)
    .leftJoin(schema.hrDocuments, eq(schema.hrDocuments.id, ED.documentId))
    .where(eq(ED.employeeId, employeeId))
    .orderBy(desc(ED.yearEnd))
    .then((rows) => rows.map((r) => ({ ...r.education, documentName: r.documentName })));

async function assertDocument(tx: Db, employeeId: string, documentId: string | null | undefined) {
  if (!documentId) return;
  const [doc] = await tx
    .select({ id: schema.hrDocuments.id })
    .from(schema.hrDocuments)
    .where(and(eq(schema.hrDocuments.id, documentId), eq(schema.hrDocuments.employeeId, employeeId)));
  if (!doc) throw fieldError("documentId", "Dokumen bukan milik karyawan ini");
}

async function profileSummary(tx: Db, employees: EmployeeService, employee: typeof E.$inferSelect) {
  const [photo] = await tx.select({ at: PH.updatedAt }).from(PH).where(eq(PH.employeeId, employee.id));
  const family = await tx.select().from(FA).where(eq(FA.employeeId, employee.id));
  const education = await tx.select().from(ED).where(eq(ED.employeeId, employee.id));
  const docs = await tx
    .selectDistinct({ kind: schema.hrDocuments.kind })
    .from(schema.hrDocuments)
    .where(eq(schema.hrDocuments.employeeId, employee.id));
  const warnings = await tx.select().from(WR).where(eq(WR.employeeId, employee.id)).orderBy(desc(WR.date));
  const ptkp = suggestedPtkp(employee.gender, employee.maritalStatus, family);
  return {
    completeness: profileCompleteness(employees.decrypted(employee), {
      photo: Boolean(photo),
      family: family.length,
      education: education.length,
      documents: docs.map((d) => d.kind),
    }),
    hasPhoto: Boolean(photo),
    suggestedPtkp: ptkp,
    ptkpMismatch: ptkp !== employee.ptkpStatus,
    highestEducation: highestEducation(education),
    activeWarnings: warnings.filter((w) => warningActive(w, today())),
  };
}

// ---- Surat peringatan ----

@Controller("employee-warnings")
class WarningsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  @Get()
  @RequirePermission("hr.manage")
  list(@Query("employeeId") employeeId?: string, @Query("active") active?: string) {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({ warning: WR, employeeName: E.name, documentName: schema.hrDocuments.name })
        .from(WR)
        .innerJoin(E, eq(E.id, WR.employeeId))
        .leftJoin(schema.hrDocuments, eq(schema.hrDocuments.id, WR.documentId))
        .where(
          and(
            eq(WR.companyId, companyId()),
            employeeId ? eq(WR.employeeId, employeeId) : undefined,
            active ? sql`${WR.validUntil} >= current_date and ${WR.date} <= current_date` : undefined,
          ),
        )
        .orderBy(desc(WR.date));
      return rows.map((r) => ({
        ...r.warning,
        employeeName: r.employeeName,
        documentName: r.documentName,
        active: warningActive(r.warning, today()),
      }));
    });
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(employeeWarningSchema, body);
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, input.employeeId);
      await assertDocument(tx, employee.id, input.documentId);
      const [row] = await tx
        .insert(WR)
        .values({
          ...input,
          companyId: employee.companyId,
          validUntil: input.validUntil ?? warningValidUntil(input.date),
          createdBy: currentContext().userId,
        })
        .returning();
      await this.history.record(tx, employee, "warning", {
        date: row!.date,
        newValue: row!.level.toUpperCase(),
        note: [row!.decreeNo, row!.reason].filter(Boolean).join(" — "),
      });
      return row!;
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(employeeWarningSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [current] = await tx
        .select()
        .from(WR)
        .where(and(eq(WR.id, id), eq(WR.companyId, companyId())));
      if (!current) throw new NotFoundException("Surat peringatan tidak ditemukan");
      if (input.employeeId !== current.employeeId)
        throw fieldError("employeeId", "Karyawan surat peringatan tidak bisa diganti");
      await assertDocument(tx, current.employeeId, input.documentId);
      const [row] = await tx
        .update(WR)
        .set({
          ...input,
          validUntil: input.validUntil ?? warningValidUntil(input.date),
          updatedAt: sql`now()`,
        })
        .where(eq(WR.id, id))
        .returning();
      return row!;
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => tx.delete(WR).where(and(eq(WR.id, id), eq(WR.companyId, companyId()))));
  }
}

// ---- Promosi, demosi, mutasi ----

type MovementInput = z.infer<typeof employeeMovementSchema>;

const MOVE_FIELDS = [
  ["toJobId", "fromJobId", "jobId", schema.jobPositions],
  ["toDepartmentId", "fromDepartmentId", "departmentId", schema.departments],
  ["toBranchId", "fromBranchId", "branchId", schema.branches],
  ["toManagerId", "fromManagerId", "managerId", schema.employees],
  ["toGradeId", "fromGradeId", "gradeId", schema.salaryGrades],
] as const;

const MOVEMENT_SUBJECT: Record<string, string> = {
  promotion: "Promosi",
  demotion: "Demosi",
  wage_adjustment: "Penyesuaian upah",
};

@Controller("employee-movements")
class MovementsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ApprovalGateService) private readonly gate: ApprovalGateService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query("employeeId") employeeId?: string, @Query("state") state?: string) {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({ movement: MV, employeeName: E.name, employeeNumber: E.employeeNumber })
        .from(MV)
        .innerJoin(E, eq(E.id, MV.employeeId))
        .where(
          and(
            eq(MV.companyId, companyId()),
            employeeId ? eq(MV.employeeId, employeeId) : undefined,
            state ? eq(MV.state, state as "draft") : undefined,
          ),
        )
        .orderBy(desc(MV.effectiveDate), desc(MV.createdAt));
      const required = await this.gate.enabled(tx, companyId(), "movement");
      const named = await this.withNames(
        tx,
        rows.map((r) => ({ ...r.movement, employeeName: r.employeeName, employeeNumber: r.employeeNumber })),
      );
      return Promise.all(
        named.map(async (m) =>
          hideSalary(
            { ...m, approval: { required, request: await this.gate.summary(tx, m.approvalRequestId) } },
            ["newWage", "oldWage"],
          ),
        ),
      );
    });
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const m = await this.find(tx, id);
      return hideSalary(
        {
          ...(await this.withNames(tx, [m]))[0]!,
          approval: {
            required: await this.gate.enabled(tx, m.companyId, "movement"),
            request: await this.gate.summary(tx, m.approvalRequestId),
          },
        },
        ["newWage", "oldWage"],
      );
    });
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(employeeMovementSchema, body);
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, input.employeeId);
      await this.validate(tx, employee.id, input);
      const [row] = await tx
        .insert(MV)
        .values({ ...this.values(input), employeeId: employee.id, companyId: employee.companyId })
        .returning();
      return row!;
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(employeeMovementSchema, body);
    return this.tenantDb.run(async (tx) => {
      const current = await this.find(tx, id);
      if (current.state !== "draft") throw new BadRequestException("Hanya mutasi draft yang bisa diubah");
      if (input.employeeId !== current.employeeId)
        throw fieldError("employeeId", "Karyawan mutasi tidak bisa diganti");
      await this.validate(tx, current.employeeId, input);
      // SK berubah setelah diajukan: persetujuan lama tidak berlaku (wajib ajukan ulang).
      await this.gate.withdraw(tx, current.approvalRequestId);
      const [row] = await tx
        .update(MV)
        .set({ ...this.values(input), approvalRequestId: null, updatedAt: sql`now()` })
        .where(eq(MV.id, id))
        .returning();
      return row!;
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const current = await this.find(tx, id);
      if (current.state !== "draft") throw new BadRequestException("Hanya mutasi draft yang bisa dihapus");
      await tx.delete(MV).where(eq(MV.id, id));
    });
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const current = await this.find(tx, id);
      if (current.state !== "draft") throw new BadRequestException("Hanya mutasi draft yang bisa dibatalkan");
      const [row] = await tx
        .update(MV)
        .set({ state: "cancel", updatedAt: sql`now()` })
        .where(eq(MV.id, id))
        .returning();
      return row!;
    });
  }

  /**
   * Terapkan SK: perbarui jabatan/departemen/cabang/atasan/golongan karyawan, catat riwayat karir (promosi/demosi/
   * mutasi), dan bila ada upah baru: akhiri kontrak berjalan sehari sebelum tanggal efektif lalu mulai kontrak baru
   * (tunjangan disalin) sehingga payroll memakai upah baru sejak tanggal efektif.
   */
  /** Ajukan SK mutasi/promosi ke persetujuan (bila diwajibkan di Pengaturan Payroll). */
  @Post(":id/submit-approval")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  submitApproval(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const m = await this.find(tx, id);
      if (m.state !== "draft") throw new BadRequestException("Mutasi sudah diterapkan atau dibatalkan");
      const state = await this.gate.state(tx, m.approvalRequestId);
      if (state === "pending" || state === "approved")
        throw new BadRequestException("Mutasi sudah diajukan untuk persetujuan");
      const [named] = await this.withNames(tx, [m]);
      const employee = await this.employees.find(tx, m.employeeId);
      const n = named!.names;
      const lines = [
        `${employee.name} (${employee.employeeNumber}) — ${m.kind}, efektif ${m.effectiveDate}.`,
        n.toJobId ? `Jabatan: ${n.fromJobId ?? "—"} → ${n.toJobId}` : null,
        n.toDepartmentId ? `Departemen: ${n.fromDepartmentId ?? "—"} → ${n.toDepartmentId}` : null,
        n.toGradeId ? `Golongan: ${n.fromGradeId ?? "—"} → ${n.toGradeId}` : null,
        m.newWage ? `Upah: ${m.oldWage ?? "—"} → ${m.newWage}` : null,
        m.reason ? `Alasan: ${m.reason}` : null,
      ].filter((l): l is string => !!l);
      const requestId = await this.gate.submit(tx, m.companyId, "movement", {
        subject: `${MOVEMENT_SUBJECT[m.kind] ?? "Mutasi"} ${employee.name}`,
        reference: m.decreeNo ?? employee.employeeNumber,
        date: m.effectiveDate,
        amount: m.newWage ?? "0",
        description: lines.join("\n"),
      });
      await tx
        .update(MV)
        .set({ approvalRequestId: requestId, updatedAt: sql`now()` })
        .where(eq(MV.id, id));
      return this.find(tx, id);
    });
  }

  @Post(":id/apply")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  apply(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const m = await this.find(tx, id);
      if (m.state !== "draft") throw new BadRequestException("Mutasi sudah diterapkan atau dibatalkan");
      await this.gate.assertApproved(
        tx,
        await this.gate.enabled(tx, m.companyId, "movement"),
        m.approvalRequestId,
        "mutasi diterapkan",
      );
      const employee = await this.employees.find(tx, m.employeeId);
      if (employee.resignDate && employee.resignDate < m.effectiveDate)
        throw new BadRequestException("Karyawan sudah keluar sebelum tanggal efektif");
      const changes: Record<string, string> = {};
      const from: Record<string, string | null> = {};
      for (const [to, fromKey, field] of MOVE_FIELDS) {
        const value = m[to];
        from[fromKey] = employee[field];
        if (value && value !== employee[field]) changes[field] = value;
      }
      let contractId: string | null = null;
      let oldWage: string | null = null;
      if (m.newWage != null) {
        const contract = await this.contracts.renewWage(tx, employee, {
          effectiveDate: m.effectiveDate,
          newWage: m.newWage,
          note: m.decreeNo && `SK ${m.decreeNo}`,
        });
        contractId = contract.id;
        oldWage = contract.oldWage;
      }
      if (!Object.keys(changes).length && !contractId)
        throw new BadRequestException("Tidak ada perubahan dibanding data karyawan saat ini");
      if (Object.keys(changes).length) await this.employees.update(tx, employee.id, changes);
      const [row] = await tx
        .update(MV)
        .set({
          ...from,
          oldWage,
          contractId,
          state: "done",
          appliedAt: sql`now()`,
          appliedBy: currentContext().userId,
          updatedAt: sql`now()`,
        })
        .where(eq(MV.id, id))
        .returning();
      const [named] = await this.withNames(tx, [row!]);
      const describe = (side: "from" | "to") =>
        MOVE_FIELDS.filter(([, , field]) => changes[field])
          .map(([to, fromKey]) => named!.names[side === "to" ? to : fromKey])
          .filter(Boolean)
          .join(", ") || null;
      // Penyesuaian upah saja: riwayat upah sudah dicatat oleh renewWage.
      if (m.kind !== "wage_adjustment")
        await this.history.record(tx, employee, m.kind === "rotation" ? "transfer" : m.kind, {
          date: m.effectiveDate,
          oldValue: describe("from"),
          newValue: describe("to"),
          note: [m.decreeNo && `SK ${m.decreeNo}`, m.reason].filter(Boolean).join(" — ") || null,
        });
      return named;
    });
  }

  private values(input: MovementInput) {
    return {
      kind: input.kind,
      decreeNo: input.decreeNo ?? null,
      effectiveDate: input.effectiveDate,
      toJobId: input.toJobId ?? null,
      toDepartmentId: input.toDepartmentId ?? null,
      toBranchId: input.toBranchId ?? null,
      toManagerId: input.toManagerId ?? null,
      toGradeId: input.toGradeId ?? null,
      newWage: input.newWage ?? null,
      reason: input.reason ?? null,
      documentId: input.documentId ?? null,
    };
  }

  private async validate(tx: Db, employeeId: string, input: MovementInput) {
    if (input.toManagerId === employeeId) throw fieldError("toManagerId", "Atasan tidak boleh diri sendiri");
    for (const [to, , , table] of MOVE_FIELDS) {
      const value = input[to];
      if (!value) continue;
      const company = "companyId" in table ? eq(table.companyId, companyId()) : undefined;
      const [row] = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, value), company));
      if (!row) throw fieldError(to, "Data rujukan tidak ditemukan");
    }
    await assertDocument(tx, employeeId, input.documentId);
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(MV)
      .where(and(eq(MV.id, id), eq(MV.companyId, companyId())));
    if (!row) throw new NotFoundException("Mutasi tidak ditemukan");
    return row;
  }

  /** Lengkapi nama jabatan/departemen/cabang/atasan/golongan asal & tujuan. */
  private async withNames<T extends typeof MV.$inferSelect>(tx: Db, rows: T[]) {
    const names = new Map<string, string>();
    for (const [to, fromKey, , table] of MOVE_FIELDS) {
      const ids = [...new Set(rows.flatMap((r) => [r[to], r[fromKey]]).filter((v): v is string => !!v))];
      if (!ids.length) continue;
      const found = await tx
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(inArray(table.id, ids));
      for (const f of found) names.set(f.id, f.name);
    }
    return rows.map((r) => ({
      ...r,
      names: Object.fromEntries(
        MOVE_FIELDS.flatMap(([to, fromKey]) => [
          [to, r[to] ? (names.get(r[to]) ?? null) : null],
          [fromKey, r[fromKey] ? (names.get(r[fromKey]) ?? null) : null],
        ]),
      ) as Record<string, string | null>,
    }));
  }
}

// ---- Portal ----

@Controller("me")
class PortalProfileController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  /** Profil sendiri (read-only): keluarga, pendidikan, pengalaman, mutasi & SP; perubahan lewat HR. */
  @Get("profile")
  profile() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const family = await tx
        .select()
        .from(FA)
        .where(eq(FA.employeeId, employee.id))
        .orderBy(asc(FA.createdAt));
      const [photo] = await tx.select({ at: PH.updatedAt }).from(PH).where(eq(PH.employeeId, employee.id));
      return {
        hasPhoto: Boolean(photo),
        family: family.map((f) => shapeFamily(this.employees, f, false)),
        education: await listEducation(tx, employee.id),
        experiences: await tx
          .select()
          .from(EX)
          .where(eq(EX.employeeId, employee.id))
          .orderBy(desc(EX.dateStart)),
        warnings: (
          await tx.select().from(WR).where(eq(WR.employeeId, employee.id)).orderBy(desc(WR.date))
        ).map(({ createdBy: _c, ...w }) => ({ ...w, active: warningActive(w, today()) })),
      };
    });
  }

  @Get("photo")
  async photo(@Req() req: Request, @Res() res: Response) {
    await this.tenantDb.run(async (tx) => sendPhoto(tx, (await this.employees.mine(tx)).id, req, res));
  }

  @Put("photo")
  setPhoto(@Body() body: unknown) {
    return this.tenantDb.run(async (tx) => savePhoto(tx, (await this.employees.mine(tx)).id, body));
  }
}

/** Profil karyawan lengkap: foto, keluarga, pendidikan, pengalaman kerja, promosi/demosi/mutasi, surat peringatan. */
@Module({
  imports: [HrModule],
  controllers: [
    EmployeePhotoController,
    EmployeeProfileController,
    WarningsController,
    MovementsController,
    PortalProfileController,
  ],
  providers: [ActivityService, SequenceService],
})
export class ProfileModule {}
