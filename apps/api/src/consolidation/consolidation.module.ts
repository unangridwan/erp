import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { eq, schema } from "@erp/db";
import {
  accountMappingSchema,
  consolidationComputeSchema,
  consolidationManualEntrySchema,
  consolidationRunSchema,
  groupAccountSchema,
  toCsv,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { MasterModule } from "../master/master.module.js";
import { ConsolidationService } from "./consolidation.service.js";

const GroupAccountsController = createCrudController({
  path: "group-accounts",
  model: "group_account",
  table: schema.groupAccounts,
  schema: groupAccountSchema,
  read: "consolidation.read",
  write: "consolidation.manage",
  searchColumns: [schema.groupAccounts.code, schema.groupAccounts.name],
  orderBy: schema.groupAccounts.code,
  beforeDelete: async (tx, row) => {
    const [used] = await tx
      .select({ id: schema.consolidationAccountMap.accountId })
      .from(schema.consolidationAccountMap)
      .where(eq(schema.consolidationAccountMap.groupAccountId, String(row.id)))
      .limit(1);
    if (used) throw new BadRequestException("Akun grup masih dipakai pemetaan; nonaktifkan saja");
  },
});

const structureQuery = z.object({
  rootCompanyId: z.string().uuid().optional(),
  dateTo: z.string().date(),
  dateFrom: z.string().date().optional(),
});

@Controller("consolidation")
class ConsolidationController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ConsolidationService) private readonly service: ConsolidationService,
  ) {}

  /** Bagan akun grup dari bagan akun perusahaan aktif + akun khusus, lalu pemetaan otomatis. */
  @Post("bootstrap")
  @HttpCode(200)
  @RequirePermission("consolidation.manage")
  bootstrap() {
    return this.tenantDb.run((tx) => this.service.bootstrap(tx));
  }

  @Post("mapping/auto")
  @HttpCode(200)
  @RequirePermission("consolidation.manage")
  autoMap() {
    return this.tenantDb.run((tx) => this.service.autoMap(tx));
  }

  @Get("mapping")
  @RequirePermission("consolidation.read")
  mapping(@Query("companyId") companyId: string | undefined) {
    return this.tenantDb.run((tx) => this.service.mapping(tx, companyId ?? currentContext().companyId));
  }

  @Put("mapping")
  @RequirePermission("consolidation.manage")
  saveMapping(@Body() body: unknown) {
    const input = parse(accountMappingSchema, body);
    return this.tenantDb.run((tx) => this.service.saveMapping(tx, input));
  }

  /** Pratinjau lingkup: entitas, metode, kepemilikan efektif, dan kurs bawaan. */
  @Get("structure")
  @RequirePermission("consolidation.read")
  structure(@Query() query: unknown) {
    const q = parse(structureQuery, query);
    return this.tenantDb.run((tx) =>
      this.service.structure(
        tx,
        q.rootCompanyId ?? currentContext().companyId,
        q.dateFrom ?? q.dateTo,
        q.dateTo,
      ),
    );
  }

  @Get("runs")
  @RequirePermission("consolidation.read")
  list() {
    return this.tenantDb.run((tx) => this.service.list(tx));
  }

  @Post("runs")
  @RequirePermission("consolidation.manage")
  create(@Body() body: unknown) {
    const input = parse(consolidationRunSchema, body);
    return this.tenantDb.run((tx) => this.service.create(tx, input));
  }

  @Get("runs/:id")
  @RequirePermission("consolidation.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.get(tx, id));
  }

  @Post("runs/:id/compute")
  @HttpCode(200)
  @RequirePermission("consolidation.manage")
  compute(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { rates } = parse(consolidationComputeSchema, body ?? {});
    return this.tenantDb.run((tx) => this.service.compute(tx, id, rates));
  }

  @Get("runs/:id/worksheet")
  @RequirePermission("consolidation.read")
  async worksheet(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("format") format: string | undefined,
    @Res() res: Response,
  ) {
    const ws = await this.tenantDb.run((tx) => this.service.worksheet(tx, id));
    if (format !== "csv") return res.json(ws);
    const headers = [
      "Kode",
      "Akun grup",
      ...ws.columns.map((c) => c.name),
      "Jumlah gabungan",
      "Eliminasi & penyesuaian",
      "Konsolidasian",
    ];
    const rows = ws.rows.map((r) => ({
      Kode: r.code,
      "Akun grup": r.name,
      ...Object.fromEntries(ws.columns.map((c) => [c.name, r.byCompany[c.companyId] ?? "0.00"])),
      "Jumlah gabungan": r.total,
      "Eliminasi & penyesuaian": r.adjustments,
      Konsolidasian: r.consolidated,
    }));
    res
      .type("text/csv; charset=utf-8")
      .attachment(`kertas-kerja-konsolidasi-${ws.run.dateTo}.csv`)
      .send("﻿" + toCsv(headers, rows));
  }

  @Get("runs/:id/report")
  @RequirePermission("consolidation.read")
  report(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.report(tx, id));
  }

  @Get("runs/:id/intercompany")
  @RequirePermission("consolidation.read")
  intercompany(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.icReconciliation(tx, id));
  }

  /** Jurnal penyesuaian konsolidasi manual (top-side), mis. laba belum terealisasi atas persediaan. */
  @Post("runs/:id/entries")
  @RequirePermission("consolidation.manage")
  addEntry(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(consolidationManualEntrySchema, body);
    return this.tenantDb.run((tx) => this.service.addManualEntry(tx, id, input));
  }

  @Delete("runs/:id/entries/:entryId")
  @HttpCode(204)
  @RequirePermission("consolidation.manage")
  async deleteEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
  ) {
    await this.tenantDb.run((tx) => this.service.deleteManualEntry(tx, id, entryId));
  }

  @Post("runs/:id/finalize")
  @HttpCode(200)
  @RequirePermission("consolidation.manage")
  finalize(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.finalize(tx, id));
  }

  @Delete("runs/:id")
  @HttpCode(204)
  @RequirePermission("consolidation.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.remove(tx, id));
  }
}

@Module({
  controllers: [GroupAccountsController, ConsolidationController],
  imports: [MasterModule],
  providers: [ActivityService, ConsolidationService],
})
export class ConsolidationModule {}
