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
import { RateLimiter } from "../common/rate-limiter.js";
import { and, asc, desc, eq, inArray, ne, or, schema, sql, type Db } from "@erp/db";
import {
  CONTRACT_PLACEHOLDERS,
  contractDocumentSchema,
  contractSignedUploadSchema,
  contractSignSchema,
  contractTemplateSchema,
} from "@erp/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public, RequirePermission } from "../auth/decorators.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ContractDocumentService, type PdfMode } from "./contract-document.service.js";
import { ContractService } from "./contract.service.js";
import { EmployeeService } from "./employee.service.js";
import { HrModule } from "./hr.module.js";
import { assertContractType } from "./contract-types.module.js";

const C = schema.contracts;
const T = schema.contractTemplates;
const S = schema.contractSignatures;

const pdfQuery = z.object({ mode: z.enum(["print", "esign", "signed"]).default("print") });
const signBody = contractSignSchema.extend({ role: z.enum(["company", "employee"]).default("company") });
const previewBody = contractTemplateSchema
  .pick({ title: true, body: true, contractType: true, signerName: true, signerTitle: true, city: true })
  .extend({ employeeId: z.string().uuid().nullish() });

const meta = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const sendPdf = (res: Response, file: { name: string; content: Buffer }) =>
  res.type("application/pdf").attachment(file.name).send(file.content);

/** Template kontrak kerja: isi berplaceholder yang diisi otomatis dari data karyawan & kontrak. */
@Controller("contract-templates")
class ContractTemplatesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ContractDocumentService) private readonly docs: ContractDocumentService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  async list() {
    const rows = await this.tenantDb.run(async (tx) => {
      const templates = await this.docs.templates(tx);
      const usage = templates.length
        ? await tx
            .select({ id: C.templateId, n: sql<number>`count(*)::int` })
            .from(C)
            .where(
              inArray(
                C.templateId,
                templates.map((t) => t.id),
              ),
            )
            .groupBy(C.templateId)
        : [];
      return templates.map((t) => ({ ...t, contracts: usage.find((u) => u.id === t.id)?.n ?? 0 }));
    });
    return { items: rows, total: rows.length };
  }

  @Get("placeholders")
  @RequirePermission("hr.read")
  placeholders() {
    return CONTRACT_PLACEHOLDERS.map(([key, label, labelEn]) => ({ key, label, labelEn }));
  }

  /** Pratinjau PDF (data karyawan terpilih atau contoh) — isi editor belum perlu disimpan. */
  @Post("preview")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  async preview(@Body() body: unknown, @Res() res: Response) {
    const input = parse(previewBody, body);
    const content = await this.tenantDb.run((tx) => this.docs.previewPdf(tx, input, input.employeeId));
    sendPdf(res, { name: "pratinjau-kontrak.pdf", content });
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.docs.template(tx, id));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(contractTemplateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      await this.docs.ensureTemplates(tx, companyId);
      if (input.contractType) await assertContractType(tx, input.contractType);
      const [row] = await tx
        .insert(T)
        .values({ ...input, companyId })
        .returning();
      if (row!.isDefault) await this.docs.clearOtherDefaults(tx, companyId, row!.contractType, row!.id);
      return row!;
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(contractTemplateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const current = await this.docs.template(tx, id);
      if (input.contractType)
        await assertContractType(tx, input.contractType, undefined, current.contractType);
      const [row] = await tx
        .update(T)
        .set({ ...input, contractType: input.contractType ?? null, updatedAt: sql`now()` })
        .where(eq(T.id, current.id))
        .returning();
      if (row!.isDefault) await this.docs.clearOtherDefaults(tx, row!.companyId, row!.contractType, row!.id);
      return row!;
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const current = await this.docs.template(tx, id);
      const [used] = await tx.select({ id: C.id }).from(C).where(eq(C.templateId, current.id)).limit(1);
      if (used)
        throw new BadRequestException(
          "Template sudah dipakai kontrak; nonaktifkan saja agar tidak dipilih lagi",
        );
      await tx.delete(T).where(eq(T.id, current.id));
    });
  }
}

/** Dokumen kontrak: isi dari template, PDF cetak / e-sign luar / bertanda tangan, tanda tangan & unggah hasil. */
@Controller("contracts")
class ContractDocumentController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ContractDocumentService) private readonly docs: ContractDocumentService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get(":id/document")
  @RequirePermission("hr.manage")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => this.docs.summary(tx, await this.contracts.find(tx, id)));
  }

  @Put(":id/document")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(contractDocumentSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.docs.update(tx, await this.contracts.find(tx, id), input);
      return this.docs.summary(tx, await this.contracts.find(tx, id));
    });
  }

  @Get(":id/pdf")
  @RequirePermission("hr.manage")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const { mode } = parse(pdfQuery, query);
    sendPdf(
      res,
      await this.tenantDb.run(async (tx) => this.docs.pdf(tx, await this.contracts.find(tx, id), mode)),
    );
  }

  /** Minta karyawan menandatangani di portal (isi dibekukan, karyawan mendapat notifikasi). */
  @Post(":id/request-signature")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  requestSignature(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const contract = await this.contracts.find(tx, id);
      const employee = await this.employees.find(tx, contract.employeeId);
      if (!employee.userId)
        throw new BadRequestException(
          "Karyawan belum punya akun portal; undang dulu atau tanda tangani langsung di hadapan HR",
        );
      await this.docs.requestSignature(tx, contract);
      return this.docs.summary(tx, await this.contracts.find(tx, id));
    });
  }

  /**
   * Tanda tangan di aplikasi oleh HR: pihak perusahaan (nama penandatangan dokumen) atau karyawan yang menandatangani
   * langsung di perangkat HR (wajib `inPerson`).
   */
  @Post(":id/sign")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  sign(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const input = parse(signBody, body);
    return this.tenantDb.run(async (tx) => {
      const contract = await this.contracts.find(tx, id);
      const doc = await this.docs.document(tx, contract);
      if (input.role === "employee" && !input.inPerson)
        throw new BadRequestException(
          "Karyawan menandatangani sendiri lewat portal; tanda tangan oleh HR hanya bila karyawan hadir langsung",
        );
      if (input.role === "company" && !doc.signer.name)
        throw new BadRequestException("Isi nama penandatangan perusahaan dulu");
      await this.docs.sign(tx, contract, {
        role: input.role,
        image: input.image,
        inPerson: input.role === "employee",
        signerName: input.role === "company" ? doc.signer.name! : doc.employee.name,
        signerTitle: input.role === "company" ? doc.signer.title : null,
        ...meta(req),
      });
      return this.docs.summary(tx, await this.contracts.find(tx, id));
    });
  }

  /** Unggah kontrak bertanda tangan: scan tanda tangan basah atau hasil e-sign layanan luar (PrivyID, Peruri, …). */
  @Post(":id/signed-file")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  upload(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(contractSignedUploadSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.docs.uploadSigned(tx, await this.contracts.find(tx, id), input);
      return this.docs.summary(tx, await this.contracts.find(tx, id));
    });
  }

  @Get(":id/signed-file")
  @RequirePermission("hr.manage")
  async download(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run(async (tx) =>
      this.docs.signedFile(tx, await this.contracts.find(tx, id)),
    );
    res.type(file.type).attachment(file.name).send(file.content);
  }

  /** Batalkan tanda tangan & berkas bertanda tangan agar isi/syarat kontrak bisa diubah lagi. */
  @Delete(":id/signatures")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  reset(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.docs.resetSignatures(tx, await this.contracts.find(tx, id));
      return this.docs.summary(tx, await this.contracts.find(tx, id));
    });
  }
}

/** Portal: karyawan membaca & menandatangani kontraknya sendiri. */
@Controller("me")
class MyContractsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ContractDocumentService) private readonly docs: ContractDocumentService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get("contracts")
  contracts() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const rows = await tx
        .select({
          id: C.id,
          name: C.name,
          contractType: C.contractType,
          contractTypeName: schema.contractTypes.name,
          state: C.state,
          dateStart: C.dateStart,
          dateEnd: C.dateEnd,
          signState: C.signState,
          signMethod: C.signMethod,
          signRequestedAt: C.signRequestedAt,
          verifyCode: C.verifyCode,
          hasSignedFile: sql<boolean>`${C.signedFileName} is not null`,
        })
        .from(C)
        .leftJoin(
          schema.contractTypes,
          and(eq(schema.contractTypes.tenantId, C.tenantId), eq(schema.contractTypes.code, C.contractType)),
        )
        .where(
          and(
            eq(C.employeeId, employee.id),
            or(inArray(C.state, ["running", "closed"]), ne(C.signState, "unsigned")),
          ),
        )
        .orderBy(desc(C.dateStart));
      const signatures = rows.length
        ? await tx
            .select({ contractId: S.contractId, role: S.role, signedAt: S.signedAt })
            .from(S)
            .where(
              inArray(
                S.contractId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(S.signedAt))
        : [];
      return rows.map((r) => ({
        ...r,
        signatures: signatures.filter((s) => s.contractId === r.id).map(({ contractId: _, ...s }) => s),
        canSign:
          (r.signState === "pending" || r.signState === "partial") &&
          !signatures.some((s) => s.contractId === r.id && s.role === "employee"),
      }));
    });
  }

  @Get("contracts/:id")
  contract(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const contract = await this.mine(tx, id);
      const { employeeHasAccount: _, ...summary } = await this.docs.summary(tx, contract);
      return { ...summary, name: contract.name, state: contract.state };
    });
  }

  @Get("contracts/:id/pdf")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const { mode } = parse(pdfQuery, query);
    const file = await this.tenantDb.run(async (tx) => {
      const contract = await this.mine(tx, id);
      return this.docs.pdf(tx, contract, (mode === "esign" ? "print" : mode) as PdfMode);
    });
    sendPdf(res, file);
  }

  @Get("contracts/:id/signed-file")
  async signedFile(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run(async (tx) => this.docs.signedFile(tx, await this.mine(tx, id)));
    res.type(file.type).attachment(file.name).send(file.content);
  }

  @Post("contracts/:id/sign")
  @HttpCode(200)
  sign(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const input = parse(contractSignSchema, body);
    return this.tenantDb.run(async (tx) => {
      const contract = await this.mine(tx, id);
      if (contract.signState !== "pending" && contract.signState !== "partial")
        throw new BadRequestException("Kontrak ini tidak sedang menunggu tanda tangan Anda");
      const employee = await this.employees.find(tx, contract.employeeId);
      await this.docs.sign(tx, contract, {
        role: "employee",
        image: input.image,
        inPerson: false,
        signerName: employee.name,
        signerTitle: null,
        ...meta(req),
      });
      return { ok: true };
    });
  }

  private async mine(tx: Db, id: string) {
    const employee = await this.employees.mine(tx);
    const [row] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.employeeId, employee.id)));
    if (!row) throw new NotFoundException("Kontrak tidak ditemukan");
    return row;
  }
}

/** Nama disamarkan untuk halaman verifikasi publik: "Budi Santoso Putra" → "Budi S. P.". */
function maskName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return [first, ...rest.map((w) => `${w[0]}.`)].join(" ");
}

/** Verifikasi keaslian kontrak dari kode di PDF (tanpa login; tanpa gaji, NIK, atau isi kontrak). */
@Controller("public/contracts")
class ContractVerifyController {
  constructor(
    @Inject(OWNER_DB) private readonly db: Db,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Get("verify/:code")
  async verify(@Param("code") code: string, @Req() req: Request) {
    await this.limiter.consume(`contract-verify:${req.ip ?? "unknown"}`, 30, 15 * 60_000);
    if (!/^[A-Z0-9]{6,20}$/.test(code.toUpperCase()))
      throw new NotFoundException("Kode verifikasi tidak dikenal");
    const [row] = await this.db
      .select({
        id: C.id,
        name: C.name,
        contractType: C.contractType,
        dateStart: C.dateStart,
        dateEnd: C.dateEnd,
        state: C.state,
        signState: C.signState,
        signMethod: C.signMethod,
        documentHash: C.documentHash,
        title: C.documentTitle,
        contractTypeName: schema.contractTypes.name,
        company: schema.companies.name,
        employee: schema.employees.name,
      })
      .from(C)
      .innerJoin(schema.companies, eq(schema.companies.id, C.companyId))
      .innerJoin(schema.employees, eq(schema.employees.id, C.employeeId))
      .leftJoin(
        schema.contractTypes,
        and(eq(schema.contractTypes.tenantId, C.tenantId), eq(schema.contractTypes.code, C.contractType)),
      )
      .where(eq(C.verifyCode, code.toUpperCase()));
    if (!row) throw new NotFoundException("Kode verifikasi tidak dikenal");
    const signatures = await this.db
      .select({ role: S.role, signerName: S.signerName, signedAt: S.signedAt, documentHash: S.documentHash })
      .from(S)
      .where(eq(S.contractId, row.id))
      .orderBy(asc(S.signedAt));
    return {
      number: row.name,
      title: row.title,
      company: row.company,
      employee: maskName(row.employee),
      contractType: row.contractType,
      contractTypeName: row.contractTypeName,
      dateStart: row.dateStart,
      dateEnd: row.dateEnd,
      cancelled: row.state === "cancel",
      signState: row.signState,
      signMethod: row.signMethod,
      documentHash: row.documentHash,
      signatures: signatures.map((s) => ({
        role: s.role,
        signerName: s.role === "employee" ? maskName(s.signerName) : s.signerName,
        signedAt: s.signedAt,
        // Tanda tangan dibubuhkan pada isi yang sama dengan dokumen saat ini.
        intact: s.documentHash === row.documentHash,
      })),
    };
  }
}

@Module({
  imports: [HrModule],
  controllers: [
    ContractTemplatesController,
    ContractDocumentController,
    MyContractsController,
    ContractVerifyController,
  ],
  providers: [RateLimiter],
})
export class ContractDocumentModule {}
