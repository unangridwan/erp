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
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { schema } from "@erp/db";
import { billFromOrderSchema, hasPermission, productSupplierSchema, purchaseOrderSchema } from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { MasterModule } from "../master/master.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { PurchaseOrderService, type PurchaseQuery } from "./purchase-order.service.js";
import { ReplenishmentService } from "./replenishment.service.js";

const ProductSuppliersController = createCrudController({
  path: "product-suppliers",
  model: "product_supplier",
  table: schema.productSuppliers,
  schema: productSupplierSchema,
  read: "purchase.read",
  write: "purchase.manage",
  searchColumns: [schema.productSuppliers.productCode],
  orderBy: schema.productSuppliers.sequence,
  companyColumn: schema.productSuppliers.companyId,
  refs: { companyId: schema.companies, partnerId: schema.partners, productId: schema.products },
});

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
  groupBy: z.enum(["partner", "product", "month"]).default("partner"),
});

@Controller("purchase-orders")
class PurchaseOrdersController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PurchaseOrderService) private readonly orders: PurchaseOrderService,
  ) {}

  @Get()
  @RequirePermission("purchase.read")
  list(@Query() query: PurchaseQuery) {
    return this.tenantDb.run((tx) => this.orders.list(tx, query));
  }

  @Get("report")
  @RequirePermission("purchase.read")
  report(@Query() query: unknown) {
    const input = parse(reportSchema, query);
    return this.tenantDb.run((tx) => this.orders.report(tx, input));
  }

  /** Baris PO yang jumlah diterima ≠ ditagih (3-way matching). */
  @Get("matching")
  @RequirePermission("purchase.read")
  matching() {
    return this.tenantDb.run((tx) => this.orders.matching(tx));
  }

  @Post("compute")
  @HttpCode(200)
  @RequirePermission("purchase.read")
  compute(@Body() body: unknown) {
    const input = parse(purchaseOrderSchema, body);
    return this.tenantDb.run((tx) => this.orders.compute(tx, input));
  }

  @Get(":id")
  @RequirePermission("purchase.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.orders.get(tx, id));
  }

  @Get(":id/pdf")
  @RequirePermission("purchase.read")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.orders.pdf(tx, id));
    res.type("application/pdf").attachment(file.filename).send(file.content);
  }

  @Post()
  @RequirePermission("purchase.write")
  create(@Body() body: unknown) {
    const input = parse(purchaseOrderSchema, body);
    return this.tenantDb.run(async (tx) => this.orders.get(tx, (await this.orders.create(tx, input)).id));
  }

  @Put(":id")
  @RequirePermission("purchase.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(purchaseOrderSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.orders.update(tx, id, input);
      return this.orders.get(tx, id);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("purchase.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.orders.remove(tx, id));
  }

  @Post(":id/send")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  send(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(sendSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      await this.orders.send(tx, id, input);
      return this.orders.get(tx, id);
    });
  }

  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  confirm(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.orders.confirm(tx, id);
      return this.orders.get(tx, id);
    });
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermission("purchase.approve")
  approve(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.orders.approve(tx, id);
      return this.orders.get(tx, id);
    });
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.orders.cancel(tx, id);
      return this.orders.get(tx, id);
    });
  }

  @Post(":id/draft")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  draft(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.orders.resetToDraft(tx, id);
      return this.orders.get(tx, id);
    });
  }

  /** Draft tagihan pemasok; membutuhkan hak akuntansi. */
  @Post(":id/bill")
  @RequirePermission("accounting.write")
  bill(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!hasPermission(currentContext().permissions, "purchase.write"))
      throw new ForbiddenException("Butuh permission purchase.write");
    const input = parse(billFromOrderSchema, body ?? {});
    return this.tenantDb.run((tx) => this.orders.createBill(tx, id, input));
  }
}

@Controller("replenishment")
class ReplenishmentController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ReplenishmentService) private readonly replenishment: ReplenishmentService,
  ) {}

  @Get()
  @RequirePermission("inventory.read")
  list() {
    return this.tenantDb.run((tx) => this.replenishment.list(tx));
  }

  @Post("run")
  @HttpCode(200)
  @RequirePermission("purchase.write")
  run(@Body() body: unknown) {
    const input = parse(z.object({ ruleIds: z.array(z.string().uuid()).optional() }), body ?? {});
    return this.tenantDb.run((tx) => this.replenishment.run(tx, input.ruleIds));
  }
}

@Module({
  imports: [MasterModule, AccountingModule, InventoryModule],
  controllers: [ProductSuppliersController, PurchaseOrdersController, ReplenishmentController],
  providers: [ActivityService, SequenceService, PurchaseOrderService, ReplenishmentService],
  exports: [PurchaseOrderService],
})
export class PurchaseModule {}
