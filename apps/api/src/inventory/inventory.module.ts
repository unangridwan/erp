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
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, eq, schema, sql, type Db } from "@erp/db";
import {
  locationSchema,
  pickingSchema,
  reorderRuleSchema,
  returnPickingSchema,
  stockAdjustmentSchema,
  validatePickingSchema,
  warehouseSchema,
  businessToday,
} from "@erp/shared";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertDimensions, fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse, parsePartial } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { createWarehouse } from "./setup.js";
import { StockQueryService, type PickingQuery } from "./stock-query.service.js";
import { StockService } from "./stock.service.js";

const date = z.string().date();

@Controller("warehouses")
class WarehousesController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("inventory.read")
  async list() {
    const items = await this.tenantDb.run((tx) =>
      tx
        .select({ warehouse: schema.warehouses, stockLocationName: schema.stockLocations.completeName })
        .from(schema.warehouses)
        .innerJoin(schema.stockLocations, eq(schema.stockLocations.id, schema.warehouses.lotStockId))
        .where(eq(schema.warehouses.companyId, currentContext().companyId))
        .orderBy(asc(schema.warehouses.code)),
    );
    return {
      items: items.map((r) => ({ ...r.warehouse, stockLocationName: r.stockLocationName })),
      total: items.length,
    };
  }

  @Get(":id")
  @RequirePermission("inventory.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.find(tx, id));
  }

  @Post()
  @RequirePermission("inventory.manage")
  create(@Body() body: unknown) {
    const input = parse(warehouseSchema, body);
    const companyId = currentContext().companyId;
    return this.tenantDb.run(async (tx) => {
      await assertDimensions(tx, companyId, [{ branchId: input.branchId }]);
      return createWarehouse(tx, companyId, input);
    });
  }

  /** Kode gudang dipakai pada nama lokasi & nomor transfer, jadi tidak bisa diubah. */
  @Patch(":id")
  @RequirePermission("inventory.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parsePartial(warehouseSchema.omit({ code: true }), body);
    return this.tenantDb.run(async (tx) => {
      const wh = await this.find(tx, id);
      if (input.branchId) await assertDimensions(tx, wh.companyId, [{ branchId: input.branchId }]);
      const [row] = await tx
        .update(schema.warehouses)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(schema.warehouses.id, id))
        .returning();
      return row;
    });
  }

  private async find(tx: Db, id: string) {
    const [wh] = await tx
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.companyId, currentContext().companyId)));
    if (!wh) throw new NotFoundException("Gudang tidak ditemukan");
    return wh;
  }
}

@Controller("stock-locations")
class LocationsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("inventory.read")
  async list(@Query("usage") usage?: string, @Query("active") active?: string) {
    const items = await this.tenantDb.run((tx) =>
      tx
        .select()
        .from(schema.stockLocations)
        .where(
          and(
            eq(schema.stockLocations.companyId, currentContext().companyId),
            usage ? eq(schema.stockLocations.usage, usage as "internal") : undefined,
            active === "all" ? undefined : eq(schema.stockLocations.active, true),
          ),
        )
        .orderBy(asc(schema.stockLocations.completeName)),
    );
    return { items, total: items.length };
  }

  @Post()
  @RequirePermission("inventory.manage")
  create(@Body() body: unknown) {
    const input = parse(locationSchema, body);
    const companyId = currentContext().companyId;
    return this.tenantDb.run(async (tx) => {
      const [parent] = await tx
        .select()
        .from(schema.stockLocations)
        .where(
          and(eq(schema.stockLocations.id, input.parentId), eq(schema.stockLocations.companyId, companyId)),
        );
      if (!parent || !["view", "internal"].includes(parent.usage))
        throw fieldError("parentId", "Lokasi induk harus lokasi gudang");
      const [row] = await tx
        .insert(schema.stockLocations)
        .values({
          companyId,
          parentId: parent.id,
          name: input.name,
          completeName: `${parent.completeName}/${input.name}`,
          usage: input.usage,
          warehouseId: parent.warehouseId,
          active: input.active,
        })
        .returning();
      return row;
    });
  }

  /** Hanya status aktif yang bisa diubah; lokasi berisi stok tidak bisa dinonaktifkan. */
  @Patch(":id")
  @RequirePermission("inventory.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(z.object({ active: z.boolean() }), body);
    return this.tenantDb.run(async (tx) => {
      const [loc] = await tx
        .select()
        .from(schema.stockLocations)
        .where(
          and(
            eq(schema.stockLocations.id, id),
            eq(schema.stockLocations.companyId, currentContext().companyId),
          ),
        );
      if (!loc) throw new NotFoundException("Lokasi tidak ditemukan");
      if (loc.usage !== "internal" && loc.usage !== "view")
        throw new BadRequestException("Lokasi sistem tidak bisa diubah");
      if (!input.active) {
        const [stock] = await tx
          .select({ id: schema.stockQuants.id })
          .from(schema.stockQuants)
          .where(and(eq(schema.stockQuants.locationId, id), sql`${schema.stockQuants.quantity} <> 0`))
          .limit(1);
        if (stock) throw new BadRequestException("Lokasi masih berisi stok");
      }
      const [row] = await tx
        .update(schema.stockLocations)
        .set({ active: input.active, updatedAt: sql`now()` })
        .where(eq(schema.stockLocations.id, id))
        .returning();
      return row;
    });
  }
}

const ReorderRulesController = createCrudController({
  path: "reorder-rules",
  model: "stock_reorder_rule",
  table: schema.stockReorderRules,
  schema: reorderRuleSchema,
  read: "inventory.read",
  write: "inventory.manage",
  searchColumns: [],
  orderBy: schema.stockReorderRules.createdAt,
  companyColumn: schema.stockReorderRules.companyId,
  perCompany: true,
  refs: { productId: schema.products },
  beforeSave: async (tx, values) => {
    if (typeof values.warehouseId === "string") {
      const [wh] = await tx
        .select({ id: schema.warehouses.id })
        .from(schema.warehouses)
        .where(
          and(
            eq(schema.warehouses.id, values.warehouseId),
            eq(schema.warehouses.companyId, String(values.companyId)),
          ),
        );
      if (!wh) throw fieldError("warehouseId", "Gudang tidak ditemukan di perusahaan ini");
    }
    if (
      values.minQty !== undefined &&
      values.maxQty !== undefined &&
      Number(values.maxQty) < Number(values.minQty)
    )
      throw fieldError("maxQty", "Maksimum harus ≥ minimum");
  },
});

@Controller("pickings")
class PickingsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(StockQueryService) private readonly query: StockQueryService,
  ) {}

  @Get()
  @RequirePermission("inventory.read")
  list(@Query() query: PickingQuery) {
    return this.tenantDb.run((tx) => this.query.pickings(tx, query));
  }

  @Get(":id")
  @RequirePermission("inventory.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.query.picking(tx, id));
  }

  @Post()
  @RequirePermission("inventory.write")
  create(@Body() body: unknown) {
    const input = parse(pickingSchema, body);
    return this.tenantDb.run(async (tx) =>
      this.query.picking(tx, (await this.stock.createManual(tx, input)).id),
    );
  }

  @Put(":id")
  @RequirePermission("inventory.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(pickingSchema, body);
    return this.tenantDb.run(async (tx) =>
      this.query.picking(tx, await this.stock.updateDraft(tx, id, input)),
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("inventory.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.stock.remove(tx, id));
  }

  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  confirm(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.stock.confirm(tx, id);
      return this.query.picking(tx, id);
    });
  }

  @Post(":id/validate")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  validate(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(validatePickingSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const { backorderId, documents } = await this.stock.validate(tx, id, input);
      return { ...(await this.query.picking(tx, id)), backorderId, documents };
    });
  }

  /** Cek ketersediaan: cadangkan stok lokasi asal untuk transfer siap. */
  @Post(":id/reserve")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  reserve(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const picking = await this.stock.lockPicking(tx, id);
      if (picking.state !== "ready")
        throw new BadRequestException("Hanya transfer siap yang bisa dicadangkan");
      await this.stock.reserve(tx, id);
      return this.query.picking(tx, id);
    });
  }

  @Post(":id/unreserve")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  unreserve(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.stock.unreserve(tx, id);
      return this.query.picking(tx, id);
    });
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.stock.cancel(tx, id);
      return this.query.picking(tx, id);
    });
  }

  @Post(":id/return")
  @RequirePermission("inventory.write")
  createReturn(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(returnPickingSchema, body);
    return this.tenantDb.run(async (tx) =>
      this.query.picking(tx, (await this.stock.createReturn(tx, id, input)).id),
    );
  }
}

@Controller("stock")
class StockController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(StockQueryService) private readonly query: StockQueryService,
  ) {}

  @Get("overview")
  @RequirePermission("inventory.read")
  overview(@Query() query: { q?: string; warehouseId?: string; limit?: string; offset?: string }) {
    return this.tenantDb.run((tx) => this.query.overview(tx, query));
  }

  @Get("quants")
  @RequirePermission("inventory.read")
  quants(@Query() query: { productId?: string; locationId?: string; warehouseId?: string; q?: string }) {
    return this.tenantDb.run((tx) => this.query.quants(tx, query));
  }

  @Get("card")
  @RequirePermission("inventory.read")
  card(@Query() query: unknown) {
    const input = parse(
      z.object({
        productId: z.string().uuid(),
        from: date,
        to: date,
        locationId: z.string().uuid().optional(),
      }),
      query,
    );
    return this.tenantDb.run((tx) => this.query.card(tx, input));
  }

  @Get("valuation")
  @RequirePermission("inventory.read")
  valuation(@Query("date") at?: string) {
    const input = parse(
      date.default(() => businessToday()),
      at,
    );
    return this.tenantDb.run((tx) => this.query.valuation(tx, input));
  }

  @Get("lots")
  @RequirePermission("inventory.read")
  lots(@Query() query: { productId?: string; q?: string; available?: string }) {
    return this.tenantDb.run((tx) => this.query.lots(tx, query));
  }

  @Patch("lots/:id")
  @RequirePermission("inventory.write")
  updateLot(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(
      z.object({ expirationDate: date.nullish(), note: z.string().max(2000).nullish() }).partial(),
      body,
    );
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .update(schema.stockLots)
        .set(input)
        .where(and(eq(schema.stockLots.id, id), eq(schema.stockLots.companyId, currentContext().companyId)))
        .returning();
      if (!row) throw new NotFoundException("Lot tidak ditemukan");
      return row;
    });
  }

  @Post("adjustments")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  adjust(@Body() body: unknown) {
    const input = parse(stockAdjustmentSchema, body);
    return this.tenantDb.run((tx) => this.stock.adjust(tx, input));
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [
    WarehousesController,
    LocationsController,
    ReorderRulesController,
    PickingsController,
    StockController,
  ],
  providers: [ActivityService, SequenceService, StockService, StockQueryService],
  exports: [StockService, StockQueryService],
})
export class InventoryModule {}
