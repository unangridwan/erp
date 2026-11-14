import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, schema, type Db } from "@erp/db";
import {
  defectRate,
  evaluateResults,
  qualityAlertSchema,
  qualityDecisionSchema,
  qualityPhotoSchema,
  qualityPointSchema,
  qualityResultsSchema,
  sampleQuantity,
  type QualityItemDef,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { fieldError, loadBooks } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { StockService, type DoneMove } from "../inventory/stock.service.js";
import { SequenceService } from "../sequences/sequence.service.js";

const QP = schema.qualityPoints;
const QC = schema.qualityChecks;
const QA = schema.qualityAlerts;
const PH = schema.qualityCheckPhotos;

type Check = typeof QC.$inferSelect;
type Point = typeof QP.$inferSelect;

// ---- Titik kontrol (CRUD) ----

const PointsController = createCrudController({
  path: "quality-points",
  model: "quality_point",
  table: QP,
  schema: qualityPointSchema,
  read: "quality.read",
  write: "quality.manage",
  searchColumns: [QP.name],
  orderBy: QP.name,
  companyColumn: QP.companyId,
  perCompany: true,
  refs: { productId: schema.products, categoryId: schema.productCategories, partnerId: schema.partners },
  beforeSave: async (_tx, values) => {
    if (values.trigger === "production" && values.partnerId)
      throw fieldError("partnerId", "Pemasok hanya untuk titik kontrol penerimaan");
    if (values.sampling && values.sampling !== "all" && !(Number(values.sampleValue) > 0))
      throw fieldError("sampleValue", "Isi nilai sampel");
  },
});

@Injectable()
export class QualityService implements OnModuleInit {
  constructor(
    @Inject(StockService) private readonly stock: StockService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
  ) {}

  onModuleInit() {
    this.stock.movedHooks.push((tx, picking, done) => this.onReceipt(tx, picking, done));
    this.stock.producedHooks.push((tx, order, move) => this.onProduced(tx, order, move));
  }

  /** Lokasi karantina gudang (anak lokasi tampilan gudang), dibuat saat pertama dibutuhkan. */
  async quarantine(tx: Db, warehouseId: string) {
    const W = schema.warehouses;
    const [wh] = await tx.select().from(W).where(eq(W.id, warehouseId));
    if (!wh) throw new NotFoundException("Gudang tidak ditemukan");
    if (wh.quarantineLocationId) return wh.quarantineLocationId;
    const L = schema.stockLocations;
    const [view] = await tx.select().from(L).where(eq(L.id, wh.viewLocationId));
    const [loc] = await tx
      .insert(L)
      .values({
        companyId: wh.companyId,
        parentId: view!.id,
        name: "Karantina",
        completeName: `${view!.completeName}/Karantina`,
        usage: "internal",
        warehouseId: wh.id,
      })
      .returning({ id: L.id });
    await tx.update(W).set({ quarantineLocationId: loc!.id }).where(eq(W.id, wh.id));
    return loc!.id;
  }

  /** Titik kontrol aktif paling spesifik: produk > kategori > semua; pemasok cocok atau kosong. */
  async findPoint(
    tx: Db,
    companyId: string,
    trigger: "receipt" | "production",
    productId: string,
    partnerId: string | null,
  ): Promise<Point | null> {
    const [product] = await tx
      .select({ categoryId: schema.products.categoryId, type: schema.products.productType })
      .from(schema.products)
      .where(eq(schema.products.id, productId));
    if (!product || product.type !== "storable") return null;
    const points = await tx
      .select()
      .from(QP)
      .where(
        and(
          eq(QP.companyId, companyId),
          eq(QP.trigger, trigger),
          eq(QP.active, true),
          or(isNull(QP.productId), eq(QP.productId, productId)),
          product.categoryId
            ? or(isNull(QP.categoryId), eq(QP.categoryId, product.categoryId))
            : isNull(QP.categoryId),
          partnerId ? or(isNull(QP.partnerId), eq(QP.partnerId, partnerId)) : isNull(QP.partnerId),
        ),
      );
    const score = (p: Point) => (p.productId ? 4 : 0) + (p.categoryId ? 2 : 0) + (p.partnerId ? 1 : 0);
    return points.sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  private async createCheck(
    tx: Db,
    point: Point,
    input: {
      companyId: string;
      trigger: "receipt" | "production";
      warehouseId: string;
      productId: string;
      partnerId: string | null;
      pickingId?: string | null;
      stockMoveId?: string | null;
      productionOrderId?: string | null;
      quantity: string;
      destLocationId: string;
      lots: { lotId: string; quantity: string }[];
      ref: string;
    },
  ) {
    let locationId = input.destLocationId;
    if (point.quarantine) {
      locationId = await this.quarantine(tx, input.warehouseId);
      await this.stock.moveInternal(
        tx,
        input.companyId,
        [
          {
            productId: input.productId,
            quantity: input.quantity,
            locationId: input.destLocationId,
            locationDestId: locationId,
            lots: input.lots,
          },
        ],
        { ref: `Karantina ${input.ref}` },
      );
    }
    const qty = Number(input.quantity);
    const sample = sampleQuantity(qty, point.sampling, point.sampleValue ? Number(point.sampleValue) : null);
    const name = await this.sequences.next(tx, "quality.check", input.companyId, new Date(), "QC");
    await tx.insert(QC).values({
      companyId: input.companyId,
      name,
      pointId: point.id,
      trigger: input.trigger,
      pickingId: input.pickingId ?? null,
      stockMoveId: input.stockMoveId ?? null,
      productionOrderId: input.productionOrderId ?? null,
      productId: input.productId,
      partnerId: input.partnerId,
      lots: input.lots,
      quantity: input.quantity,
      sampleQty: String(sample),
      locationId,
      destLocationId: input.destLocationId,
      results: point.items.map((i) => ({ ...i, value: null, passed: null })),
    });
  }

  /** Penerimaan dari pemasok: barang dengan titik kontrol masuk karantina & dibuatkan pemeriksaan. */
  async onReceipt(tx: Db, picking: typeof schema.stockPickings.$inferSelect, done: DoneMove[]) {
    if (picking.pickingType !== "incoming" || picking.returnOfId) return;
    for (const { move, product, lots } of done) {
      const point = await this.findPoint(tx, picking.companyId, "receipt", product.id, picking.partnerId);
      if (!point) continue;
      await this.createCheck(tx, point, {
        companyId: picking.companyId,
        trigger: "receipt",
        warehouseId: picking.warehouseId,
        productId: product.id,
        partnerId: picking.partnerId,
        pickingId: picking.id,
        stockMoveId: move.id,
        quantity: move.quantityDone,
        destLocationId: move.locationDestId,
        lots: lots.map((l) => ({ lotId: l.lotId, quantity: l.quantity.toFixed(4) })),
        ref: picking.name,
      });
    }
  }

  /** Hasil produksi: barang jadi dengan titik kontrol masuk karantina & dibuatkan pemeriksaan. */
  async onProduced(
    tx: Db,
    order: { id: string; name: string; companyId: string; warehouseId: string },
    move: typeof schema.stockMoves.$inferSelect,
  ) {
    const point = await this.findPoint(tx, order.companyId, "production", move.productId, null);
    if (!point) return;
    const lots = await tx
      .select({ lotId: schema.stockMoveLines.lotId, quantity: schema.stockMoveLines.quantity })
      .from(schema.stockMoveLines)
      .where(eq(schema.stockMoveLines.moveId, move.id));
    await this.createCheck(tx, point, {
      companyId: order.companyId,
      trigger: "production",
      warehouseId: order.warehouseId,
      productId: move.productId,
      partnerId: null,
      productionOrderId: order.id,
      stockMoveId: move.id,
      quantity: move.quantityDone,
      destLocationId: move.locationDestId,
      lots: lots.filter((l) => l.lotId).map((l) => ({ lotId: l.lotId!, quantity: l.quantity })),
      ref: order.name,
    });
  }

  async find(tx: Db, id: string): Promise<Check> {
    const [row] = await tx.select().from(QC).where(eq(QC.id, id));
    if (!row || !currentContext().companyIds.includes(row.companyId))
      throw new NotFoundException("Pemeriksaan mutu tidak ditemukan");
    return row;
  }

  private async photoItems(tx: Db, id: string) {
    const rows = await tx.select({ itemIndex: PH.itemIndex }).from(PH).where(eq(PH.checkId, id));
    return new Set(rows.filter((r) => r.itemIndex !== null).map((r) => r.itemIndex!));
  }

  async detail(tx: Db, id: string) {
    const check = await this.find(tx, id);
    const [product] = await tx
      .select({ name: schema.products.name, sku: schema.products.sku, tracking: schema.products.tracking })
      .from(schema.products)
      .where(eq(schema.products.id, check.productId));
    const [partner] = check.partnerId
      ? await tx
          .select({ name: schema.partners.name })
          .from(schema.partners)
          .where(eq(schema.partners.id, check.partnerId))
      : [];
    const [picking] = check.pickingId
      ? await tx
          .select({ name: schema.stockPickings.name })
          .from(schema.stockPickings)
          .where(eq(schema.stockPickings.id, check.pickingId))
      : [];
    const [order] = check.productionOrderId
      ? await tx
          .select({ name: schema.productionOrders.name })
          .from(schema.productionOrders)
          .where(eq(schema.productionOrders.id, check.productionOrderId))
      : [];
    const [point] = check.pointId
      ? await tx
          .select({ name: QP.name, instructions: QP.instructions })
          .from(QP)
          .where(eq(QP.id, check.pointId))
      : [];
    const lotIds = check.lots.map((l) => l.lotId);
    const lots = lotIds.length
      ? await tx
          .select({ id: schema.stockLots.id, name: schema.stockLots.name })
          .from(schema.stockLots)
          .where(inArray(schema.stockLots.id, lotIds))
      : [];
    const L = schema.stockLocations;
    const locs = await tx
      .select({ id: L.id, name: L.completeName })
      .from(L)
      .where(inArray(L.id, [check.locationId, check.destLocationId]));
    const photos = await tx
      .select({ id: PH.id, itemIndex: PH.itemIndex, fileName: PH.fileName, createdAt: PH.createdAt })
      .from(PH)
      .where(eq(PH.checkId, id))
      .orderBy(asc(PH.createdAt));
    const alerts = await tx
      .select({ id: QA.id, name: QA.name, state: QA.state })
      .from(QA)
      .where(eq(QA.checkId, id));
    const evaluation = evaluateResults(
      check.results as QualityItemDef[],
      check.results.map((r) => ({ value: r.value, note: r.note })),
      await this.photoItems(tx, id),
    );
    return {
      ...check,
      product: product ?? null,
      partner: partner?.name ?? null,
      picking: picking?.name ?? null,
      productionOrder: order?.name ?? null,
      point: point ?? null,
      lots: check.lots.map((l) => ({ ...l, name: lots.find((x) => x.id === l.lotId)?.name ?? null })),
      location: locs.find((l) => l.id === check.locationId)?.name ?? null,
      destLocation: locs.find((l) => l.id === check.destLocationId)?.name ?? null,
      photos,
      alerts,
      evaluation: { complete: evaluation.complete, passed: evaluation.passed },
    };
  }

  async saveResults(tx: Db, id: string, input: z.infer<typeof qualityResultsSchema>) {
    const check = await this.find(tx, id);
    if (check.state !== "pending") throw new BadRequestException("Pemeriksaan sudah diputuskan");
    const items = check.results as QualityItemDef[];
    if (input.results.length !== items.length)
      throw fieldError("results", "Jumlah hasil tidak sesuai butir pemeriksaan");
    const evaluation = evaluateResults(items, input.results, await this.photoItems(tx, id));
    await tx
      .update(QC)
      .set({
        results: evaluation.results,
        note: input.note ?? check.note,
        inspectorId: currentContext().userId,
        updatedAt: new Date(),
      })
      .where(eq(QC.id, id));
    return this.detail(tx, id);
  }

  async addPhoto(tx: Db, id: string, input: z.infer<typeof qualityPhotoSchema>) {
    const check = await this.find(tx, id);
    if (check.state !== "pending") throw new BadRequestException("Pemeriksaan sudah diputuskan");
    if (input.itemIndex != null && input.itemIndex >= check.results.length)
      throw fieldError("itemIndex", "Butir pemeriksaan tidak ditemukan");
    const data = Buffer.from(input.data, "base64");
    if (!data.length || data.length > 2 * 1024 * 1024) throw fieldError("data", "Foto maksimal 2 MB");
    const [row] = await tx
      .insert(PH)
      .values({
        checkId: id,
        itemIndex: input.itemIndex ?? null,
        fileName: input.fileName,
        contentType: input.contentType,
        data,
        createdBy: currentContext().userId,
      })
      .returning({ id: PH.id });
    // Hasil butir wajib foto dievaluasi ulang.
    const evaluation = evaluateResults(
      check.results as QualityItemDef[],
      check.results.map((r) => ({ value: r.value, note: r.note })),
      await this.photoItems(tx, id),
    );
    await tx.update(QC).set({ results: evaluation.results }).where(eq(QC.id, id));
    return { id: row!.id };
  }

  /**
   * Keputusan: terima (lulus) / terima bersyarat → pindah dari karantina ke gudang; retur → kembali ke gudang lalu
   * transfer retur ke pemasok divalidasi (nota kredit dibuat modul pembelian); scrap → keluar ke lokasi penyesuaian
   * dengan jurnal selisih persediaan. Keputusan selain terima membuat NCR.
   */
  async decide(tx: Db, id: string, input: z.infer<typeof qualityDecisionSchema>) {
    const check = await this.find(tx, id);
    if (check.state !== "pending") throw new BadRequestException("Pemeriksaan sudah diputuskan");
    const evaluation = evaluateResults(
      check.results as QualityItemDef[],
      check.results.map((r) => ({ value: r.value, note: r.note })),
      await this.photoItems(tx, id),
    );
    if (!evaluation.complete) throw new BadRequestException("Lengkapi semua butir pemeriksaan dulu");
    if (input.decision === "accept" && !evaluation.passed)
      throw fieldError("decision", "Pemeriksaan tidak lulus; pilih terima bersyarat, retur, atau scrap");
    if (
      input.decision === "return" &&
      (check.trigger !== "receipt" || !check.pickingId || !check.stockMoveId)
    )
      throw fieldError("decision", "Retur hanya untuk barang dari penerimaan pemasok");
    const ctx = currentContext();
    const lots = check.lots;
    const back = async () => {
      if (check.locationId !== check.destLocationId)
        await this.stock.moveInternal(
          tx,
          check.companyId,
          [
            {
              productId: check.productId,
              quantity: check.quantity,
              locationId: check.locationId,
              locationDestId: check.destLocationId,
              lots,
            },
          ],
          { ref: `Lepas karantina ${check.name}` },
        );
    };
    let returnPickingId: string | null = null;
    let scrapMoveId: string | null = null;
    if (input.decision === "accept" || input.decision === "conditional") await back();
    if (input.decision === "return") {
      await back();
      const ret = await this.stock.createReturn(tx, check.pickingId!, {
        lines: [{ moveId: check.stockMoveId!, quantity: check.quantity }],
      });
      returnPickingId = ret.id;
      const [move] = await tx
        .select({ id: schema.stockMoves.id })
        .from(schema.stockMoves)
        .where(eq(schema.stockMoves.pickingId, ret.id));
      await this.stock.validate(tx, ret.id, {
        moves: [
          {
            id: move!.id,
            quantityDone: check.quantity,
            lots: lots.length ? lots.map((l) => ({ lotId: l.lotId, quantity: l.quantity })) : undefined,
          },
        ],
        createBackorder: false,
      });
    }
    if (input.decision === "scrap") {
      const books = await loadBooks(tx, check.companyId);
      const account = books.settings.stockAdjustmentAccountId;
      if (!account)
        throw new BadRequestException("Akun selisih persediaan belum diatur di pengaturan akuntansi");
      const lotNames = lots.length
        ? await tx
            .select({ id: schema.stockLots.id, name: schema.stockLots.name })
            .from(schema.stockLots)
            .where(
              inArray(
                schema.stockLots.id,
                lots.map((l) => l.lotId),
              ),
            )
        : [];
      const result = await this.stock.consume(
        tx,
        check.companyId,
        lots.length
          ? lots.map((l, i) => ({
              productId: check.productId,
              quantity: l.quantity,
              locationId: check.locationId,
              lotName: lotNames.find((x) => x.id === l.lotId)?.name ?? null,
              path: `lots.${i}`,
            }))
          : [
              {
                productId: check.productId,
                quantity: check.quantity,
                locationId: check.locationId,
                path: "quantity",
              },
            ],
        {
          ref: `Scrap ${check.name}`,
          date: new Date(),
          expenseAccountId: account,
          costCenterId: null,
          branchId: null,
        },
      );
      scrapMoveId = result.accountMoveId;
    }
    const state =
      input.decision === "accept" ? "passed" : input.decision === "conditional" ? "conditional" : "failed";
    await tx
      .update(QC)
      .set({
        state,
        decision: input.decision,
        note: input.note ?? check.note,
        inspectorId: check.inspectorId ?? ctx.userId,
        decidedAt: new Date(),
        returnPickingId,
        scrapMoveId,
        updatedAt: new Date(),
      })
      .where(eq(QC.id, id));
    if (input.decision !== "accept") {
      const [product] = await tx
        .select({ name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, check.productId));
      const failed = evaluation.results
        .filter((r) => r.passed === false)
        .map((r) => `- ${r.label}: ${r.value ?? "-"}${r.unit ? ` ${r.unit}` : ""}`);
      const name = await this.sequences.next(tx, "quality.alert", check.companyId, new Date(), "NCR");
      await tx.insert(QA).values({
        companyId: check.companyId,
        name,
        checkId: id,
        productId: check.productId,
        partnerId: check.partnerId,
        title: `${product?.name ?? "Produk"} tidak sesuai (${check.name})`.slice(0, 200),
        description: [`Keputusan: ${input.decision}`, ...failed, input.note ?? ""].filter(Boolean).join("\n"),
        createdBy: ctx.userId,
      });
    }
    return this.detail(tx, id);
  }

  async report(tx: Db, companyId: string, from: string, to: string) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    const rows = await tx
      .select({
        state: QC.state,
        trigger: QC.trigger,
        quantity: QC.quantity,
        productId: QC.productId,
        product: schema.products.name,
        partnerId: QC.partnerId,
        partner: schema.partners.name,
      })
      .from(QC)
      .innerJoin(schema.products, eq(schema.products.id, QC.productId))
      .leftJoin(schema.partners, eq(schema.partners.id, QC.partnerId))
      .where(and(eq(QC.companyId, companyId), gte(QC.createdAt, start), lte(QC.createdAt, end)));
    const group = (
      key: (r: (typeof rows)[number]) => string | null,
      label: (r: (typeof rows)[number]) => string,
    ) => {
      const map = new Map<
        string,
        {
          id: string;
          name: string;
          checks: number;
          pending: number;
          passed: number;
          conditional: number;
          failed: number;
          failedQty: number;
        }
      >();
      for (const r of rows) {
        const k = key(r);
        if (!k) continue;
        const g = map.get(k) ?? {
          id: k,
          name: label(r),
          checks: 0,
          pending: 0,
          passed: 0,
          conditional: 0,
          failed: 0,
          failedQty: 0,
        };
        g.checks++;
        g[r.state]++;
        if (r.state === "failed") g.failedQty += Number(r.quantity);
        map.set(k, g);
      }
      return [...map.values()]
        .map((g) => ({
          ...g,
          defectRate: defectRate(g.failed + g.conditional, g.checks - g.pending),
        }))
        .sort((a, b) => (b.defectRate ?? -1) - (a.defectRate ?? -1));
    };
    return {
      from,
      to,
      totals: {
        checks: rows.length,
        pending: rows.filter((r) => r.state === "pending").length,
        failed: rows.filter((r) => r.state === "failed").length,
        conditional: rows.filter((r) => r.state === "conditional").length,
        passed: rows.filter((r) => r.state === "passed").length,
      },
      bySupplier: group(
        (r) => r.partnerId,
        (r) => r.partner ?? "-",
      ),
      byProduct: group(
        (r) => r.productId,
        (r) => r.product,
      ),
    };
  }
}

// ---- Controller ----

const listQuery = z.object({
  state: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});
const reportQuery = z.object({ from: z.string().date(), to: z.string().date() });

@Controller()
class QualityController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(QualityService) private readonly svc: QualityService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
  ) {}

  @Get("quality-checks")
  @RequirePermission("quality.read")
  list(@Query() query: Record<string, string>) {
    const q = parse(listQuery, query);
    const states = q.state?.split(",").filter(Boolean) as Check["state"][] | undefined;
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: QC.id,
          name: QC.name,
          trigger: QC.trigger,
          state: QC.state,
          decision: QC.decision,
          quantity: QC.quantity,
          sampleQty: QC.sampleQty,
          product: schema.products.name,
          sku: schema.products.sku,
          partner: schema.partners.name,
          picking: schema.stockPickings.name,
          createdAt: QC.createdAt,
          decidedAt: QC.decidedAt,
        })
        .from(QC)
        .innerJoin(schema.products, eq(schema.products.id, QC.productId))
        .leftJoin(schema.partners, eq(schema.partners.id, QC.partnerId))
        .leftJoin(schema.stockPickings, eq(schema.stockPickings.id, QC.pickingId))
        .where(
          and(
            eq(QC.companyId, currentContext().companyId),
            states?.length ? inArray(QC.state, states) : undefined,
          ),
        )
        .orderBy(desc(QC.createdAt))
        .limit(q.limit),
    );
  }

  @Get("quality-checks/:id")
  @RequirePermission("quality.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.svc.detail(tx, id));
  }

  /** Pemeriksaan untuk satu transfer / order produksi (panel di dokumen asal). */
  @Get("quality-checks-for")
  @RequirePermission("quality.read")
  forDocument(
    @Query("pickingId") pickingId?: string,
    @Query("productionOrderId") productionOrderId?: string,
  ) {
    if (!pickingId && !productionOrderId) return [];
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: QC.id,
          name: QC.name,
          state: QC.state,
          decision: QC.decision,
          quantity: QC.quantity,
          productId: QC.productId,
        })
        .from(QC)
        .where(
          and(
            eq(QC.companyId, currentContext().companyId),
            pickingId ? eq(QC.pickingId, pickingId) : eq(QC.productionOrderId, productionOrderId!),
          ),
        )
        .orderBy(asc(QC.createdAt)),
    );
  }

  @Put("quality-checks/:id/results")
  @RequirePermission("quality.write")
  results(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(qualityResultsSchema, body);
    return this.tenantDb.run((tx) => this.svc.saveResults(tx, id, input));
  }

  @Post("quality-checks/:id/photos")
  @RequirePermission("quality.write")
  photo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(qualityPhotoSchema, body);
    return this.tenantDb.run((tx) => this.svc.addPhoto(tx, id, input));
  }

  @Get("quality-checks/:id/photos/:photoId")
  @RequirePermission("quality.read")
  async photoFile(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("photoId", ParseUUIDPipe) photoId: string,
    @Res() res: Response,
  ) {
    const photo = await this.tenantDb.run(async (tx) => {
      await this.svc.find(tx, id);
      const [row] = await tx
        .select()
        .from(PH)
        .where(and(eq(PH.id, photoId), eq(PH.checkId, id)));
      return row;
    });
    if (!photo) throw new NotFoundException("Foto tidak ditemukan");
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(photo.data);
  }

  @Post("quality-checks/:id/decide")
  @RequirePermission("quality.write")
  decide(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(qualityDecisionSchema, body);
    return this.tenantDb.run((tx) => this.svc.decide(tx, id, input));
  }

  // ---- NCR ----

  @Get("quality-alerts")
  @RequirePermission("quality.read")
  alerts() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: QA.id,
          name: QA.name,
          title: QA.title,
          state: QA.state,
          product: schema.products.name,
          partner: schema.partners.name,
          responsible: schema.users.name,
          createdAt: QA.createdAt,
          closedAt: QA.closedAt,
        })
        .from(QA)
        .leftJoin(schema.products, eq(schema.products.id, QA.productId))
        .leftJoin(schema.partners, eq(schema.partners.id, QA.partnerId))
        .leftJoin(schema.users, eq(schema.users.id, QA.responsibleUserId))
        .where(eq(QA.companyId, currentContext().companyId))
        .orderBy(desc(QA.createdAt))
        .limit(5000),
    );
  }

  private async findAlert(tx: Db, id: string) {
    const [row] = await tx.select().from(QA).where(eq(QA.id, id));
    if (!row || !currentContext().companyIds.includes(row.companyId))
      throw new NotFoundException("Catatan ketidaksesuaian tidak ditemukan");
    return row;
  }

  @Get("quality-alerts/:id")
  @RequirePermission("quality.read")
  alert(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const row = await this.findAlert(tx, id);
      const [check] = row.checkId
        ? await tx.select({ id: QC.id, name: QC.name }).from(QC).where(eq(QC.id, row.checkId))
        : [];
      return { ...row, check: check ?? null };
    });
  }

  @Post("quality-alerts")
  @RequirePermission("quality.write")
  createAlert(@Body() body: unknown) {
    const input = parse(qualityAlertSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const name = await this.sequences.next(tx, "quality.alert", ctx.companyId, new Date(), "NCR");
      const [row] = await tx
        .insert(QA)
        .values({
          ...input,
          companyId: ctx.companyId,
          name,
          closedAt: input.state === "closed" ? new Date() : null,
          createdBy: ctx.userId,
        })
        .returning();
      return row;
    });
  }

  @Put("quality-alerts/:id")
  @RequirePermission("quality.write")
  updateAlert(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(qualityAlertSchema, body);
    return this.tenantDb.run(async (tx) => {
      const row = await this.findAlert(tx, id);
      if (input.state === "closed" && !input.correctiveAction && !row.correctiveAction)
        throw fieldError("correctiveAction", "Isi tindakan perbaikan sebelum menutup NCR");
      const [updated] = await tx
        .update(QA)
        .set({
          ...input,
          closedAt: input.state === "closed" ? (row.closedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(QA.id, id))
        .returning();
      return updated;
    });
  }

  @Get("quality/reports")
  @RequirePermission("quality.read")
  report(@Query() query: Record<string, string>) {
    const q = parse(reportQuery, query);
    if (q.to < q.from) throw fieldError("to", "Tanggal akhir sebelum tanggal awal");
    return this.tenantDb.run((tx) => this.svc.report(tx, currentContext().companyId, q.from, q.to));
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [PointsController, QualityController],
  providers: [QualityService, SequenceService, ActivityService],
})
export class QualityModule {}
