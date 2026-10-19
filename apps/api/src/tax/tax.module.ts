import {
  Body,
  Controller,
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
  taxDocApproveSchema,
  taxDocExportSchema,
  taxInvoiceGenerateSchema,
  taxInvoiceUpdateSchema,
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
import { TaxInvoiceService } from "./tax-invoice.service.js";
import { WithholdingService } from "./withholding.service.js";

const sendXml = (res: Response, file: { fileName: string; content: string }) =>
  res.type("application/xml; charset=utf-8").attachment(file.fileName).send(file.content);

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
    sendXml(res, file);
  }
}

@Module({
  imports: [HrModule],
  controllers: [TaxController],
  providers: [ActivityService, TaxInvoiceService, WithholdingService],
})
export class TaxModule {}
