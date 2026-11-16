import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { eq, schema } from "@erp/db";
import {
  commissionPlanSchema,
  commissionReportSchema,
  createInvoiceFromOrderSchema,
  hasPermission,
  paymentTermSchema,
  pricelistSchema,
  leadQuotationSchema,
  saleOrderSchema,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { fieldError } from "../accounting/context.js";
import { toXlsxBook } from "../accounting/report-export.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CrmModule } from "../crm/crm.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { MasterModule } from "../master/master.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { CommissionService } from "./commission.service.js";
import { PricelistService } from "./pricelist.service.js";
import { SaleOrderService, type OrderQuery } from "./sale-order.service.js";

const PaymentTermsController = createCrudController({
  path: "payment-terms",
  model: "payment_term",
  table: schema.paymentTerms,
  schema: paymentTermSchema,
  read: "sales.read",
  write: "sales.manage",
  searchColumns: [schema.paymentTerms.name],
  orderBy: schema.paymentTerms.days,
});

const CommissionPlansController = createCrudController({
  path: "commission-plans",
  model: "commission_plan",
  table: schema.commissionPlans,
  schema: commissionPlanSchema,
  read: "sales.read",
  write: "sales.manage",
  searchColumns: [schema.commissionPlans.name],
  orderBy: schema.commissionPlans.name,
  companyColumn: schema.commissionPlans.companyId,
  perCompany: true,
  refs: { userId: schema.users, teamId: schema.salesTeams },
  beforeSave: async (_tx, values) => {
    if (values.userId && values.teamId) throw fieldError("teamId", "Pilih penjual atau tim, tidak keduanya");
  },
});

@Controller("sales/commissions")
class CommissionsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(CommissionService) private readonly commissions: CommissionService,
  ) {}

  @Get()
  @RequirePermission("sales.read")
  report(@Query() query: unknown) {
    const input = parse(commissionReportSchema, query);
    return this.tenantDb.run((tx) => this.commissions.report(tx, input));
  }

  @Get("export")
  @RequirePermission("sales.read")
  async export(@Query() query: unknown, @Res() res: Response) {
    const input = parse(commissionReportSchema, query);
    const buffer = await this.tenantDb.run(async (tx) => {
      const data = await this.commissions.report(tx, input);
      const [company] = await tx
        .select({ name: schema.companies.name })
        .from(schema.companies)
        .where(eq(schema.companies.id, currentContext().companyId));
      return toXlsxBook(this.commissions.sheets(data), company?.name ?? "");
    });
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment(`komisi-${input.dateFrom}-${input.dateTo}.xlsx`)
      .send(buffer);
  }
}

@Controller("pricelists")
class PricelistsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PricelistService) private readonly pricelists: PricelistService,
  ) {}

  @Get()
  @RequirePermission("sales.read")
  async list(@Query("active") active?: string) {
    const items = await this.tenantDb.run((tx) => this.pricelists.list(tx, active === "all"));
    return { items, total: items.length };
  }

  @Get(":id")
  @RequirePermission("sales.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.pricelists.get(tx, id));
  }

  @Post()
  @RequirePermission("sales.manage")
  create(@Body() body: unknown) {
    const input = parse(pricelistSchema, body);
    return this.tenantDb.run((tx) => this.pricelists.create(tx, input));
  }

  @Patch(":id")
  @RequirePermission("sales.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const values = parse(pricelistSchema.partial().strip(), body);
    const sent = Object.fromEntries(
      Object.entries(values).filter(([k]) => body !== null && typeof body === "object" && k in body),
    );
    return this.tenantDb.run((tx) => this.pricelists.update(tx, id, sent));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("sales.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.pricelists.remove(tx, id));
  }
}

const sendSchema = z.object({
  to: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  message: z.string().max(5000).nullish(),
});

const reportSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  groupBy: z.enum(["product", "partner", "salesperson", "month"]).default("product"),
});

@Controller("sale-orders")
class SaleOrdersController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SaleOrderService) private readonly orders: SaleOrderService,
  ) {}

  @Get()
  @RequirePermission("sales.read")
  list(@Query() query: OrderQuery) {
    return this.tenantDb.run((tx) => this.orders.list(tx, query));
  }

  /** Analisis penjualan. Didaftarkan sebelum `:id`. */
  @Get("report")
  @RequirePermission("sales.read")
  report(@Query() query: unknown) {
    const input = parse(reportSchema, query);
    return this.tenantDb.run((tx) => this.orders.report(tx, input));
  }

  @Post("compute")
  @HttpCode(200)
  @RequirePermission("sales.read")
  compute(@Body() body: unknown) {
    const input = parse(saleOrderSchema, body);
    return this.tenantDb.run((tx) => this.orders.compute(tx, input));
  }

  @Get(":id")
  @RequirePermission("sales.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.orders.get(tx, id));
  }

  @Get(":id/pdf")
  @RequirePermission("sales.read")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.orders.pdf(tx, id));
    res.type("application/pdf").attachment(file.filename).send(file.content);
  }

  @Post()
  @RequirePermission("sales.write")
  create(@Body() body: unknown) {
    const input = parse(saleOrderSchema, body);
    return this.tenantDb.run((tx) => this.orders.create(tx, input));
  }

  /** Penawaran draft dari peluang CRM: baris diisi dari produk peluang. */
  @Post("from-lead/:leadId")
  @RequirePermission("sales.write")
  fromLead(@Param("leadId", ParseUUIDPipe) leadId: string, @Body() body: unknown) {
    const input = parse(leadQuotationSchema, body ?? {});
    return this.tenantDb.run((tx) => this.orders.createFromLead(tx, leadId, input));
  }

  @Put(":id")
  @RequirePermission("sales.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(saleOrderSchema, body);
    return this.tenantDb.run((tx) => this.orders.update(tx, id, input));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("sales.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.orders.remove(tx, id));
  }

  @Post(":id/send")
  @HttpCode(200)
  @RequirePermission("sales.write")
  send(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(sendSchema, body ?? {});
    return this.tenantDb.run((tx) => this.orders.send(tx, id, input));
  }

  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermission("sales.write")
  confirm(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.orders.confirm(tx, id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("sales.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.orders.cancel(tx, id));
  }

  @Post(":id/draft")
  @HttpCode(200)
  @RequirePermission("sales.write")
  draft(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.orders.resetToDraft(tx, id));
  }

  /** Membuat draft faktur memerlukan hak menulis penjualan dan akuntansi. */
  @Post(":id/invoice")
  @RequirePermission("accounting.write")
  invoice(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!hasPermission(currentContext().permissions, "sales.write"))
      throw new ForbiddenException("Butuh permission sales.write");
    const input = parse(createInvoiceFromOrderSchema, body);
    return this.tenantDb.run((tx) => this.orders.createInvoice(tx, id, input));
  }
}

@Module({
  imports: [MasterModule, AccountingModule, CrmModule, InventoryModule],
  controllers: [
    PaymentTermsController,
    PricelistsController,
    SaleOrdersController,
    CommissionPlansController,
    CommissionsController,
  ],
  providers: [ActivityService, SequenceService, PricelistService, SaleOrderService, CommissionService],
  exports: [SaleOrderService],
})
export class SalesModule {}
