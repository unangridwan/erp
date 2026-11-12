import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { eq, schema } from "@erp/db";
import {
  assetDisposeSchema,
  budgetSchema,
  closeYearSchema,
  depreciateSchema,
  fxRevaluationSchema,
  statementImportSchema,
  statementReconcileSchema,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { AssetService } from "./asset.service.js";
import { BankService } from "./bank.service.js";
import { BudgetService } from "./budget.service.js";
import { ClosingService } from "./closing.service.js";
import { FxRevaluationService } from "./fx-revaluation.service.js";
import { reportSheet, toXlsx } from "./report-export.js";
import { reportQuery, ReportService } from "./reports.service.js";

@Controller()
export class BankController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(BankService) private readonly bank: BankService,
  ) {}

  @Get("bank-statements")
  @RequirePermission("accounting.read")
  list() {
    return this.tenantDb.run((tx) => this.bank.list(tx));
  }

  @Post("bank-statements/import")
  @RequirePermission("accounting.write")
  import(@Body() body: unknown) {
    const input = parse(statementImportSchema, body);
    return this.tenantDb.run((tx) => this.bank.import(tx, input));
  }

  @Get("bank-statements/:id")
  @RequirePermission("accounting.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.bank.get(tx, id));
  }

  @Delete("bank-statements/:id")
  @HttpCode(204)
  @RequirePermission("accounting.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.bank.remove(tx, id));
  }

  @Get("bank-statement-lines/:id/suggestions")
  @RequirePermission("accounting.read")
  suggestions(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.bank.suggestions(tx, id));
  }

  @Post("bank-statement-lines/:id/reconcile")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  reconcile(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(statementReconcileSchema, body);
    return this.tenantDb.run((tx) => this.bank.reconcileLine(tx, id, input));
  }

  @Post("bank-statement-lines/:id/undo")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  undo(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.bank.undo(tx, id));
  }
}

@Controller("assets")
export class AssetActionsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AssetService) private readonly assets: AssetService,
  ) {}

  /** Posting penyusutan semua aset berjalan sampai tanggal tertentu. Didaftarkan sebelum rute `:id`. */
  @Post("depreciate")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  depreciate(@Body() body: unknown) {
    const { date } = parse(depreciateSchema, body);
    return this.tenantDb.run((tx) => this.assets.depreciate(tx, date));
  }

  @Get(":id/schedule")
  @RequirePermission("accounting.read")
  schedule(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.assets.get(tx, id));
  }

  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  confirm(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.assets.confirm(tx, id));
  }

  /** Jual atau hapus buku aset (jurnal pelepasan + faktur penjualan bila dijual). */
  @Post(":id/dispose")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  dispose(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(assetDisposeSchema, body);
    return this.tenantDb.run((tx) => this.assets.dispose(tx, id, input));
  }
}

@Controller("accounting/fx-revaluations")
export class FxRevaluationController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FxRevaluationService) private readonly revaluation: FxRevaluationService,
  ) {}

  @Get()
  @RequirePermission("accounting.read")
  list() {
    return this.tenantDb.run((tx) => this.revaluation.list(tx));
  }

  @Get("preview")
  @RequirePermission("accounting.read")
  preview(@Query() query: unknown) {
    const { date } = parse(fxRevaluationSchema, query);
    return this.tenantDb.run((tx) => this.revaluation.preview(tx, date));
  }

  @Post()
  @RequirePermission("accounting.post")
  post(@Body() body: unknown) {
    const { date } = parse(fxRevaluationSchema, body);
    return this.tenantDb.run((tx) => this.revaluation.post(tx, date));
  }
}

@Controller("budgets")
export class BudgetsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(BudgetService) private readonly budgets: BudgetService,
  ) {}

  @Get()
  @RequirePermission("accounting.read")
  list() {
    return this.tenantDb.run((tx) => this.budgets.list(tx));
  }

  @Get(":id")
  @RequirePermission("accounting.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.budgets.get(tx, id));
  }

  @Post()
  @RequirePermission("accounting.write")
  create(@Body() body: unknown) {
    const input = parse(budgetSchema, body);
    return this.tenantDb.run((tx) => this.budgets.save(tx, input));
  }

  @Patch(":id")
  @RequirePermission("accounting.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(budgetSchema, body);
    return this.tenantDb.run((tx) => this.budgets.save(tx, input, id));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("accounting.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.budgets.remove(tx, id));
  }
}

const exportQuery = z.object({ budgetId: z.string().uuid().optional() });
const REPORTS = [
  "trial-balance",
  "general-ledger",
  "balance-sheet",
  "profit-loss",
  "aged",
  "branch-clearing",
  "cash-flow",
  "budget",
] as const;

@Controller()
export class ClosingAndExportController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ClosingService) private readonly closing: ClosingService,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(BudgetService) private readonly budgets: BudgetService,
  ) {}

  @Post("accounting/close-year")
  @HttpCode(200)
  @RequirePermission("accounting.manage")
  closeYear(@Body() body: unknown) {
    const { fiscalYear } = parse(closeYearSchema, body);
    return this.tenantDb.run((tx) => this.closing.closeYear(tx, fiscalYear));
  }

  @Get("reports/budget")
  @RequirePermission("accounting.read")
  budget(@Query() query: unknown) {
    const { budgetId } = parse(z.object({ budgetId: z.string().uuid() }), query);
    return this.tenantDb.run((tx) => this.budgets.report(tx, budgetId));
  }

  /** Ekspor laporan ke Excel dengan parameter yang sama seperti versi JSON-nya. */
  @Get("reports/:name/export")
  @RequirePermission("accounting.read")
  async export(@Param("name") name: string, @Query() query: Record<string, string>, @Res() res: Response) {
    const report = parse(z.enum(REPORTS), name);
    const { buffer } = await this.tenantDb.run(async (tx) => {
      const data =
        report === "budget"
          ? await this.budgets.report(tx, parse(exportQuery.required(), query).budgetId)
          : await this.run(tx, report, query);
      const [company] = await tx
        .select({ name: schema.companies.name })
        .from(schema.companies)
        .where(eq(schema.companies.id, currentContext().companyId));
      return { buffer: await toXlsx(reportSheet(report, data), company?.name ?? "") };
    });
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment(`${report}.xlsx`)
      .send(buffer);
  }

  private run(
    tx: Parameters<ReportService["trialBalance"]>[0],
    report: Exclude<(typeof REPORTS)[number], "budget">,
    query: unknown,
  ) {
    const q = parse(reportQuery, query);
    switch (report) {
      case "trial-balance":
        return this.reports.trialBalance(tx, q);
      case "general-ledger":
        return this.reports.generalLedger(tx, q);
      case "balance-sheet":
        return this.reports.balanceSheet(tx, q);
      case "profit-loss":
        return this.reports.profitLoss(tx, q);
      case "aged":
        return this.reports.aged(tx, q);
      case "branch-clearing":
        return this.reports.branchClearing(tx, q);
      case "cash-flow":
        return this.reports.cashFlow(tx, q);
    }
  }
}
