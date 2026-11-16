import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { and, desc, eq, schema } from "@erp/db";
import {
  inputTaxCreditSchema,
  inputTaxImportSchema,
  inputTaxUpdateSchema,
  nsfpRangeSchema,
  taxDocApproveSchema,
  taxDocExportSchema,
  taxInvoiceGenerateSchema,
  taxInvoiceUpdateSchema,
  taxReturnGenerateSchema,
  taxReturnUpdateSchema,
  withholdingGenerateSchema,
  withholdingUpdateSchema,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { HrModule } from "../hr/hr.module.js";
import { drilldownQuery, ReportService } from "../accounting/reports.service.js";
import { periodRange } from "./company-tax.js";
import { TaxInvoiceService } from "./tax-invoice.service.js";
import { TaxReturnService } from "./tax-return.service.js";
import { WithholdingService } from "./withholding.service.js";

const sendXml = (res: Response, file: { fileName: string; content: string }) =>
  res.type("application/xml; charset=utf-8").attachment(file.fileName).send(file.content);
const sendCsv = (res: Response, file: { fileName: string; content: string }) =>
  res.type("text/csv; charset=utf-8").attachment(file.fileName).send(file.content);

const periodQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

@Controller()
class TaxController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(TaxInvoiceService) private readonly invoices: TaxInvoiceService,
    @Inject(WithholdingService) private readonly withholding: WithholdingService,
    @Inject(TaxReturnService) private readonly returns: TaxReturnService,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  // ---- Faktur pajak keluaran ----

  @Get("tax-invoices")
  @RequirePermission("tax.read")
  list(@Query() query: Record<string, string>) {
    return this.tenantDb.run((tx) => this.invoices.list(tx, query));
  }

  @Post("tax-invoices/generate")
  @HttpCode(200)
  @RequirePermission("tax.write")
  generate(@Body() body: unknown) {
    const input = parse(taxInvoiceGenerateSchema, body);
    return this.tenantDb.run((tx) => this.invoices.generate(tx, input));
  }

  /** Berkas XML memuat NIK/NPWP pembeli, khusus tax.manage. */
  @Post("tax-invoices/export")
  @RequirePermission("tax.manage")
  async export(@Body() body: unknown, @Res() res: Response) {
    const { ids } = parse(taxDocExportSchema, body);
    sendXml(res, await this.tenantDb.run((tx) => this.invoices.export(tx, ids)));
  }

  /** Periksa faktur terhadap ketentuan template impor Coretax (DJP tidak menerbitkan XSD). */
  @Post("tax-invoices/check")
  @HttpCode(200)
  @RequirePermission("tax.read")
  check(@Body() body: unknown) {
    const { ids } = parse(taxDocExportSchema, body);
    return this.tenantDb.run((tx) => this.invoices.check(tx, ids));
  }

  /** CSV impor e-Faktur 3.x (pra-Coretax); NSFP diambil dari rentang terdaftar. */
  @Post("tax-invoices/export-legacy")
  @RequirePermission("tax.manage")
  async exportLegacy(@Body() body: unknown, @Res() res: Response) {
    const { ids } = parse(taxDocExportSchema, body);
    sendCsv(res, await this.tenantDb.run((tx) => this.invoices.exportLegacy(tx, ids)));
  }

  @Get("tax/nsfp-ranges")
  @RequirePermission("tax.read")
  listNsfp() {
    return this.tenantDb.run((tx) => this.invoices.listNsfp(tx));
  }

  @Post("tax/nsfp-ranges")
  @RequirePermission("tax.manage")
  createNsfp(@Body() body: unknown) {
    const input = parse(nsfpRangeSchema, body);
    return this.tenantDb.run((tx) => this.invoices.createNsfp(tx, input));
  }

  @Delete("tax/nsfp-ranges/:id")
  @RequirePermission("tax.manage")
  async deleteNsfp(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.invoices.deleteNsfp(tx, id));
    return { ok: true };
  }

  @Post("tax-invoices/import-numbers")
  @HttpCode(200)
  @RequirePermission("tax.write")
  importNumbers(@Body() body: unknown) {
    const { csv } = parse(inputTaxImportSchema, body);
    return this.tenantDb.run((tx) => this.invoices.importNumbers(tx, csv));
  }

  @Get("tax-invoices/:id")
  @RequirePermission("tax.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.invoices.get(tx, id));
  }

  @Patch("tax-invoices/:id")
  @RequirePermission("tax.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(taxInvoiceUpdateSchema, body);
    return this.tenantDb.run((tx) => this.invoices.update(tx, id, input));
  }

  @Post("tax-invoices/:id/approve")
  @HttpCode(200)
  @RequirePermission("tax.write")
  approve(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { number } = parse(taxDocApproveSchema, body);
    return this.tenantDb.run((tx) => this.invoices.approve(tx, id, number));
  }

  @Post("tax-invoices/:id/replace")
  @HttpCode(200)
  @RequirePermission("tax.write")
  replace(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.invoices.replace(tx, id));
  }

  @Post("tax-invoices/:id/cancel")
  @HttpCode(200)
  @RequirePermission("tax.write")
  async cancel(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.invoices.cancel(tx, id));
    return { ok: true };
  }

  // ---- Faktur pajak masukan ----

  @Get("input-tax-invoices")
  @RequirePermission("tax.read")
  listInput(@Query() query: Record<string, string>) {
    return this.tenantDb.run((tx) => this.invoices.listInput(tx, query));
  }

  @Post("input-tax-invoices/import")
  @HttpCode(200)
  @RequirePermission("tax.write")
  importInput(@Body() body: unknown) {
    const { csv } = parse(inputTaxImportSchema, body);
    return this.tenantDb.run((tx) => this.invoices.importInput(tx, csv));
  }

  @Post("input-tax-invoices/credit")
  @HttpCode(200)
  @RequirePermission("tax.write")
  credit(@Body() body: unknown) {
    const input = parse(inputTaxCreditSchema, body);
    return this.tenantDb.run((tx) => this.invoices.creditInput(tx, input));
  }

  @Patch("input-tax-invoices/:id")
  @RequirePermission("tax.write")
  updateInput(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(inputTaxUpdateSchema, body);
    return this.tenantDb.run((tx) => this.invoices.updateInput(tx, id, input));
  }

  // ---- Nota retur pajak masukan ----

  @Get("tax-returns")
  @RequirePermission("tax.read")
  listReturns(@Query() query: Record<string, string>) {
    return this.tenantDb.run((tx) => this.returns.list(tx, query));
  }

  @Post("tax-returns/generate")
  @HttpCode(200)
  @RequirePermission("tax.write")
  generateReturns(@Body() body: unknown) {
    const input = parse(taxReturnGenerateSchema, body);
    return this.tenantDb.run((tx) => this.returns.generate(tx, input));
  }

  @Post("tax-returns/export-legacy")
  @RequirePermission("tax.manage")
  async exportReturns(@Body() body: unknown, @Res() res: Response) {
    const { ids } = parse(taxDocExportSchema, body);
    sendCsv(res, await this.tenantDb.run((tx) => this.returns.exportLegacy(tx, ids)));
  }

  @Patch("tax-returns/:id")
  @RequirePermission("tax.write")
  updateReturn(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { inputTaxInvoiceId } = parse(taxReturnUpdateSchema, body);
    return this.tenantDb.run((tx) => this.returns.update(tx, id, inputTaxInvoiceId));
  }

  @Post("tax-returns/:id/approve")
  @HttpCode(200)
  @RequirePermission("tax.write")
  approveReturn(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { number } = parse(taxDocApproveSchema, body);
    return this.tenantDb.run((tx) => this.returns.approve(tx, id, number));
  }

  @Post("tax-returns/:id/cancel")
  @HttpCode(200)
  @RequirePermission("tax.write")
  async cancelReturn(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.returns.cancel(tx, id));
    return { ok: true };
  }

  // ---- Bukti potong ----

  @Get("withholding-slips")
  @RequirePermission("tax.read")
  listSlips(@Query() query: Record<string, string>) {
    return this.tenantDb.run((tx) => this.withholding.list(tx, query));
  }

  @Post("withholding-slips/generate")
  @HttpCode(200)
  @RequirePermission("tax.write")
  generateSlips(@Body() body: unknown) {
    const input = parse(withholdingGenerateSchema, body);
    return this.tenantDb.run((tx) => this.withholding.generate(tx, input));
  }

  @Post("withholding-slips/export")
  @RequirePermission("tax.manage")
  async exportSlips(@Body() body: unknown, @Res() res: Response) {
    const { ids } = parse(taxDocExportSchema, body);
    sendXml(res, await this.tenantDb.run((tx) => this.withholding.export(tx, ids)));
  }

  @Get("withholding-slips/:id")
  @RequirePermission("tax.read")
  getSlip(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.withholding.get(tx, id));
  }

  @Patch("withholding-slips/:id")
  @RequirePermission("tax.write")
  updateSlip(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(withholdingUpdateSchema, body);
    return this.tenantDb.run((tx) => this.withholding.update(tx, id, input));
  }

  @Post("withholding-slips/:id/approve")
  @HttpCode(200)
  @RequirePermission("tax.write")
  approveSlip(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { number } = parse(taxDocApproveSchema, body);
    return this.tenantDb.run((tx) => this.withholding.approve(tx, id, number));
  }

  @Post("withholding-slips/:id/cancel")
  @HttpCode(200)
  @RequirePermission("tax.write")
  async cancelSlip(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.withholding.cancel(tx, id));
    return { ok: true };
  }

  // ---- Laporan & riwayat ekspor ----

  /** Rincian baris jurnal PPN keluaran/masukan satu masa (angka "menurut buku besar" di laporan PPN). */
  @Get("tax/vat-report/drilldown")
  @RequirePermission("tax.read")
  vatDrilldown(@Query() query: unknown) {
    const { year, month, use, limit, offset } = parse(
      periodQuery.extend({
        use: z.enum(["sale", "purchase"]),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      query,
    );
    const { from, to } = periodRange(year, month);
    return this.tenantDb.run((tx) =>
      this.reports.drilldown(
        tx,
        parse(drilldownQuery, { dateFrom: from, dateTo: to, vatUse: use, limit, offset }),
      ),
    );
  }

  @Get("tax/vat-report")
  @RequirePermission("tax.read")
  vatReport(@Query() query: unknown) {
    const { year, month } = parse(periodQuery, query);
    return this.tenantDb.run((tx) => this.invoices.vatReport(tx, year, month));
  }

  @Get("tax/exports")
  @RequirePermission("tax.read")
  exports() {
    const B = schema.taxExportBatches;
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: B.id,
          kind: B.kind,
          fileName: B.fileName,
          recordCount: B.recordCount,
          createdAt: B.createdAt,
        })
        .from(B)
        .where(eq(B.companyId, currentContext().companyId))
        .orderBy(desc(B.createdAt))
        .limit(200),
    );
  }

  @Get("tax/exports/:id")
  @RequirePermission("tax.manage")
  async exportFile(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const B = schema.taxExportBatches;
    const [file] = await this.tenantDb.run((tx) =>
      tx
        .select({ fileName: B.fileName, content: B.content })
        .from(B)
        .where(and(eq(B.id, id), eq(B.companyId, currentContext().companyId))),
    );
    if (!file) return res.status(404).json({ statusCode: 404, message: "Berkas tidak ditemukan" });
    (file.fileName.endsWith(".csv") ? sendCsv : sendXml)(res, file);
  }
}

@Module({
  imports: [HrModule],
  controllers: [TaxController],
  providers: [ActivityService, TaxInvoiceService, WithholdingService, TaxReturnService, ReportService],
})
export class TaxModule {}
