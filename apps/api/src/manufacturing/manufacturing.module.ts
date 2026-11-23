import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, schema, sql, type Db } from "@erp/db";
import {
  bomCostEstimate,
  mrpConfirmSchema,
  mrpPlan,
  mrpRunSchema,
  pickSupplier,
  type MrpDemand,
  type MrpItem,
  bomCycle,
  bomSchema,
  explodeBom,
  operationCost,
  produceSchema,
  productionOperationSchema,
  productionOrderSchema,
  productionUnitCost,
  workCenterSchema,
  type BomNode,
  businessToday,
} from "@erp/shared";
import { normalizeCustom } from "../customization/custom-values.js";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { fieldError, loadBooks } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { virtualLocation } from "../inventory/setup.js";
import { StockService } from "../inventory/stock.service.js";
import { uomRatio } from "../master/uom.js";
import { assertNotTemplate } from "../master/variant.service.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { PurchaseModule } from "../purchase/purchase.module.js";
import { PurchaseOrderService } from "../purchase/purchase-order.service.js";

const WC = schema.workCenters;
const B = schema.boms;
const BL = schema.bomLines;
const BO = schema.bomOperations;
const MO = schema.productionOrders;
const MC = schema.productionComponents;
const MOP = schema.productionOperations;
const P = schema.products;
type Order = typeof MO.$inferSelect;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const today = () => businessToday();

const WorkCentersController = createCrudController({
  path: "work-centers",
  model: "work_center",
  table: WC,
  schema: workCenterSchema,
  read: "mrp.read",
  write: "mrp.manage",
  searchColumns: [WC.code, WC.name],
  orderBy: WC.code,
  companyColumn: WC.companyId,
  perCompany: true,
  beforeDelete: async (tx, row) => {
    const [used] = await tx
      .select({ id: BO.id })
      .from(BO)
      .where(eq(BO.workCenterId, row.id as string))
      .limit(1);
    if (used) throw new BadRequestException("Stasiun kerja dipakai di BOM; nonaktifkan saja");
  },
});

@Injectable()
export class ManufacturingService {
  constructor(
    @Inject(StockService) private readonly stock: StockService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  // ---- BOM ----

  /** Semua BOM aktif perusahaan sebagai node (kuantitas komponen dalam satuan produk). */
  async bomIndex(tx: Db, companyId: string) {
    const boms = await tx
      .select()
      .from(B)
      .where(and(eq(B.companyId, companyId), eq(B.active, true)))
      .orderBy(asc(B.createdAt));
    const ids = boms.map((b) => b.id);
    const lines = ids.length ? await tx.select().from(BL).where(inArray(BL.bomId, ids)) : [];
    const ops = ids.length ? await tx.select().from(BO).where(inArray(BO.bomId, ids)) : [];
    const nodes = boms.map((b): BomNode => ({
      id: b.id,
      productId: b.productId,
      quantity: b.quantity,
      bomType: b.bomType,
      lines: lines
        .filter((l) => l.bomId === b.id)
        .sort((x, y) => x.sequence - y.sequence)
        .map((l) => ({ productId: l.productId, quantity: d(l.quantity).times(l.uomRatio).toFixed(6) })),
      operations: ops
        .filter((o) => o.bomId === b.id)
        .sort((x, y) => x.sequence - y.sequence)
        .map((o) => ({ name: o.name, workCenterId: o.workCenterId, minutes: o.minutes })),
    }));
    // BOM yang dipakai per produk = BOM aktif pertama.
    const first = new Map<string, BomNode>();
    const all = new Map<string, BomNode[]>();
    for (const n of nodes) {
      if (!first.has(n.productId)) first.set(n.productId, n);
      all.set(n.productId, [...(all.get(n.productId) ?? []), n]);
    }
    return { nodes, first, all };
  }

  private async findBom(tx: Db, id: string) {
    const [bom] = await tx
      .select()
      .from(B)
      .where(and(eq(B.id, id), eq(B.companyId, currentContext().companyId)));
    if (!bom) throw new NotFoundException("BOM tidak ditemukan");
    return bom;
  }

  private async prepareBom(tx: Db, input: z.infer<typeof bomSchema>, bomId?: string) {
    const companyId = currentContext().companyId;
    const ids = [input.productId, ...input.lines.map((l) => l.productId)];
    const products = await tx
      .select()
      .from(P)
      .where(and(inArray(P.id, ids), or(isNull(P.companyId), eq(P.companyId, companyId))));
    const product = products.find((p) => p.id === input.productId);
    if (!product) throw fieldError("productId", "Produk tidak ditemukan");
    assertNotTemplate(product, "productId");
    if (product.productType === "service") throw fieldError("productId", "Produk jadi tidak boleh jasa");
    const lines = [];
    const seen = new Set<string>();
    for (const [i, l] of input.lines.entries()) {
      const c = products.find((p) => p.id === l.productId);
      if (!c) throw fieldError(`lines.${i}.productId`, "Produk tidak ditemukan");
      assertNotTemplate(c, `lines.${i}.productId`);
      if (seen.has(c.id)) throw fieldError(`lines.${i}.productId`, "Komponen ganda dalam BOM");
      seen.add(c.id);
      const uomId = l.uomId ?? c.uomId;
      const ratio = await uomRatio(tx, c.uomId, uomId, `lines.${i}.uomId`);
      lines.push({
        sequence: i,
        productId: c.id,
        quantity: d(l.quantity).toFixed(4),
        uomId,
        uomRatio: ratio.toFixed(6),
      });
    }
    const wcIds = [...new Set(input.operations.map((o) => o.workCenterId))];
    const centers = wcIds.length
      ? await tx
          .select({ id: WC.id })
          .from(WC)
          .where(and(inArray(WC.id, wcIds), eq(WC.companyId, companyId)))
      : [];
    input.operations.forEach((o, i) => {
      if (!centers.some((c) => c.id === o.workCenterId))
        throw fieldError(`operations.${i}.workCenterId`, "Stasiun kerja tidak ditemukan");
    });
    // Siklus lewat BOM lain (produk jadi muncul di bawah komponennya sendiri).
    const index = await this.bomIndex(tx, companyId);
    const others = new Map(
      [...index.all.entries()].map(([k, v]) => [k, v.filter((n) => n.id !== bomId)] as const),
    );
    if (
      bomCycle(
        input.productId,
        lines.map((l) => l.productId),
        others,
      )
    )
      throw fieldError("lines", "BOM berputar: salah satu komponen memakai produk jadi ini");
    return {
      header: {
        productId: input.productId,
        code: input.code ?? null,
        quantity: d(input.quantity).toFixed(4),
        bomType: input.bomType,
        leadDays: input.leadDays,
        active: input.active,
        note: input.note ?? null,
      },
      lines,
      operations: input.operations.map((o, i) => ({
        sequence: i,
        name: o.name,
        workCenterId: o.workCenterId,
        minutes: d(o.minutes).toFixed(2),
      })),
    };
  }

  async createBom(tx: Db, body: unknown) {
    const input = parse(bomSchema, body);
    const { header, lines, operations } = await this.prepareBom(tx, input);
    const [bom] = await tx
      .insert(B)
      .values({ ...header, companyId: currentContext().companyId })
      .returning({ id: B.id });
    await tx.insert(BL).values(lines.map((l) => ({ ...l, bomId: bom!.id })));
    if (operations.length) await tx.insert(BO).values(operations.map((o) => ({ ...o, bomId: bom!.id })));
    return this.bomDetail(tx, bom!.id);
  }

  async updateBom(tx: Db, id: string, body: unknown) {
    await this.findBom(tx, id);
    const input = parse(bomSchema, body);
    const { header, lines, operations } = await this.prepareBom(tx, input, id);
    await tx
      .update(B)
      .set({ ...header, updatedAt: sql`now()` })
      .where(eq(B.id, id));
    await tx.delete(BL).where(eq(BL.bomId, id));
    await tx.delete(BO).where(eq(BO.bomId, id));
    await tx.insert(BL).values(lines.map((l) => ({ ...l, bomId: id })));
    if (operations.length) await tx.insert(BO).values(operations.map((o) => ({ ...o, bomId: id })));
    return this.bomDetail(tx, id);
  }

  async removeBom(tx: Db, id: string) {
    await this.findBom(tx, id);
    const [used] = await tx.select({ id: MO.id }).from(MO).where(eq(MO.bomId, id)).limit(1);
    if (used) throw new BadRequestException("BOM sudah dipakai order produksi; nonaktifkan saja");
    await tx.delete(B).where(eq(B.id, id));
  }

  async listBoms(tx: Db) {
    return tx
      .select({
        id: B.id,
        code: B.code,
        productId: B.productId,
        productName: P.name,
        sku: P.sku,
        quantity: B.quantity,
        bomType: B.bomType,
        active: B.active,
        lines: sql<number>`(select count(*)::int from bom_lines l where l.bom_id = ${B.id})`,
        operations: sql<number>`(select count(*)::int from bom_operations o where o.bom_id = ${B.id})`,
      })
      .from(B)
      .innerJoin(P, eq(P.id, B.productId))
      .where(eq(B.companyId, currentContext().companyId))
      .orderBy(asc(P.sku));
  }

  async bomDetail(tx: Db, id: string) {
    const bom = await this.findBom(tx, id);
    const lines = await tx
      .select({ line: BL, sku: P.sku, productName: P.name, uomName: schema.uoms.name })
      .from(BL)
      .innerJoin(P, eq(P.id, BL.productId))
      .leftJoin(schema.uoms, eq(schema.uoms.id, BL.uomId))
      .where(eq(BL.bomId, id))
      .orderBy(asc(BL.sequence));
    const operations = await tx
      .select({ op: BO, workCenterName: WC.name, costPerHour: WC.costPerHour })
      .from(BO)
      .innerJoin(WC, eq(WC.id, BO.workCenterId))
      .where(eq(BO.bomId, id))
      .orderBy(asc(BO.sequence));
    const [product] = await tx
      .select({ name: P.name, sku: P.sku, uomId: P.uomId })
      .from(P)
      .where(eq(P.id, bom.productId));
    return {
      ...bom,
      productName: product?.name ?? null,
      sku: product?.sku ?? null,
      lines: lines.map((l) => ({ ...l.line, sku: l.sku, productName: l.productName, uomName: l.uomName })),
      operations: operations.map((o) => ({
        ...o.op,
        workCenterName: o.workCenterName,
        costPerHour: o.costPerHour,
        cost: operationCost(o.op.minutes, o.costPerHour),
      })),
      cost: await this.bomCost(tx, id, bom.quantity),
    };
  }

  /** Estimasi biaya BOM untuk kuantitas tertentu (biaya rata-rata bahan + operasi × tarif). */
  async bomCost(tx: Db, id: string, qty: string) {
    const companyId = currentContext().companyId;
    const index = await this.bomIndex(tx, companyId);
    const node = index.nodes.find((n) => n.id === id);
    if (!node) return null;
    const explosion = explodeBom(node, qty, index.first);
    const products = explosion.components.length
      ? await tx
          .select()
          .from(P)
          .where(
            inArray(
              P.id,
              explosion.components.map((c) => c.productId),
            ),
          )
      : [];
    const costs = new Map<string, string>();
    for (const p of products) costs.set(p.id, await this.stock.currentCost(tx, companyId, p));
    const centers = await tx.select().from(WC).where(eq(WC.companyId, companyId));
    return {
      quantity: qty,
      ...bomCostEstimate(explosion, qty, costs, new Map(centers.map((c) => [c.id, c.costPerHour]))),
      components: explosion.components.map((c) => {
        const p = products.find((x) => x.id === c.productId);
        return {
          ...c,
          sku: p?.sku ?? null,
          productName: p?.name ?? null,
          unitCost: costs.get(c.productId) ?? "0",
        };
      }),
      operations: explosion.operations.map((o) => ({
        ...o,
        workCenterName: centers.find((c) => c.id === o.workCenterId)?.name ?? null,
      })),
    };
  }

  // ---- Order produksi ----

  private async find(tx: Db, id: string, lock = false): Promise<Order> {
    const query = tx
      .select()
      .from(MO)
      .where(and(eq(MO.id, id), eq(MO.companyId, currentContext().companyId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundException("Order produksi tidak ditemukan");
    return row;
  }

  async createOrder(tx: Db, body: unknown) {
    const input = parse(productionOrderSchema, body);
    const companyId = currentContext().companyId;
    const index = await this.bomIndex(tx, companyId);
    let node: BomNode | undefined;
    if (input.bomId) {
      node = index.nodes.find((n) => n.id === input.bomId);
      if (!node || node.productId !== input.productId)
        throw fieldError("bomId", "BOM tidak ditemukan untuk produk ini");
    } else node = index.all.get(input.productId)?.find((n) => n.bomType === "normal");
    if (!node) throw fieldError("productId", "Produk ini belum punya BOM aktif");
    if (node.bomType !== "normal")
      throw fieldError("bomId", "BOM kit/phantom tidak diproduksi lewat order produksi");
    const [product] = await tx.select().from(P).where(eq(P.id, input.productId));
    if (!product || product.productType !== "storable")
      throw fieldError("productId", "Produk jadi harus produk stok");
    const warehouse = input.warehouseId
      ? await this.stock.warehouse(tx, input.warehouseId, companyId)
      : await this.stock.defaultWarehouse(tx, companyId);
    let explosion: ReturnType<typeof explodeBom>;
    try {
      explosion = explodeBom(node, input.quantity, index.first);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const name = await this.sequences.next(
      tx,
      "mrp.production",
      companyId,
      new Date(`${input.datePlanned}T00:00:00Z`),
      "MO",
    );
    const [order] = await tx
      .insert(MO)
      .values({
        companyId,
        name,
        productId: product.id,
        bomId: node.id,
        quantity: d(input.quantity).toFixed(4),
        warehouseId: warehouse.id,
        locationId: warehouse.lotStockId,
        locationDestId: warehouse.lotStockId,
        datePlanned: input.datePlanned,
        origin: input.origin ?? null,
        note: input.note ?? null,
        custom: await normalizeCustom(tx, "production_order", input.custom, null, companyId),
        createdBy: currentContext().userId,
      })
      .returning({ id: MO.id });
    const id = order!.id;
    if (explosion.components.length)
      await tx.insert(MC).values(
        explosion.components.map((c, i) => ({
          orderId: id,
          sequence: i,
          productId: c.productId,
          qtyRequired: c.quantity,
        })),
      );
    if (explosion.operations.length) {
      const centers = await tx.select().from(WC).where(eq(WC.companyId, companyId));
      await tx.insert(MOP).values(
        explosion.operations.map((o, i) => ({
          orderId: id,
          sequence: i,
          name: o.name,
          workCenterId: o.workCenterId,
          plannedMinutes: o.minutes,
          costPerHour: centers.find((c) => c.id === o.workCenterId)?.costPerHour ?? "0",
        })),
      );
    }
    await this.activity.log(tx, { resModel: "production_order", resId: id, action: "create" });
    return this.detail(tx, id);
  }

  async detail(tx: Db, id: string) {
    const order = await this.find(tx, id);
    const [product] = await tx
      .select({ name: P.name, sku: P.sku, tracking: P.tracking })
      .from(P)
      .where(eq(P.id, order.productId));
    const components = await tx
      .select({ c: MC, sku: P.sku, productName: P.name, tracking: P.tracking, productType: P.productType })
      .from(MC)
      .innerJoin(P, eq(P.id, MC.productId))
      .where(eq(MC.orderId, id))
      .orderBy(asc(MC.sequence));
    const operations = await tx
      .select({ op: MOP, workCenterName: WC.name })
      .from(MOP)
      .innerJoin(WC, eq(WC.id, MOP.workCenterId))
      .where(eq(MOP.orderId, id))
      .orderBy(asc(MOP.sequence));
    const [warehouse] = await tx
      .select({ name: schema.warehouses.name })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, order.warehouseId));
    const open = order.state !== "done" && order.state !== "cancel";
    const rows = [];
    for (const r of components) {
      const available =
        open && r.productType === "storable"
          ? (await this.stock.onHand(tx, order.locationId, r.c.productId)).toFixed(4)
          : null;
      rows.push({
        ...r.c,
        sku: r.sku,
        productName: r.productName,
        tracking: r.tracking,
        productType: r.productType,
        available,
        short:
          available != null && d(available).lt(r.c.qtyRequired)
            ? d(r.c.qtyRequired).minus(available).toFixed(4)
            : null,
      });
    }
    const ops = operations.map((o) => ({
      ...o.op,
      workCenterName: o.workCenterName,
      plannedCost: operationCost(o.op.plannedMinutes, o.op.costPerHour),
    }));
    const plannedConversion = ops.reduce((s, o) => s.plus(o.plannedCost), new Decimal(0)).toFixed(2);
    return {
      ...order,
      productName: product?.name ?? null,
      sku: product?.sku ?? null,
      tracking: product?.tracking ?? "none",
      warehouseName: warehouse?.name ?? null,
      components: rows,
      operations: ops,
      plannedConversion,
      shortages: rows.filter((r) => r.short).length,
    };
  }

  async list(tx: Db, query: { state?: string }) {
    return tx
      .select({
        id: MO.id,
        name: MO.name,
        state: MO.state,
        productId: MO.productId,
        sku: P.sku,
        productName: P.name,
        quantity: MO.quantity,
        qtyProduced: MO.qtyProduced,
        datePlanned: MO.datePlanned,
        origin: MO.origin,
        unitCost: MO.unitCost,
        materialCost: MO.materialCost,
        conversionCost: MO.conversionCost,
        custom: MO.custom,
      })
      .from(MO)
      .innerJoin(P, eq(P.id, MO.productId))
      .where(
        and(
          eq(MO.companyId, currentContext().companyId),
          query.state ? eq(MO.state, query.state as Order["state"]) : undefined,
        ),
      )
      .orderBy(desc(MO.datePlanned), desc(MO.createdAt))
      .limit(5000);
  }

  async confirm(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft")
      throw new BadRequestException("Hanya order produksi draft yang bisa dikonfirmasi");
    await tx
      .update(MO)
      .set({ state: "confirmed", updatedAt: sql`now()` })
      .where(eq(MO.id, id));
    return this.detail(tx, id);
  }

  async operation(tx: Db, id: string, opId: string, body: unknown) {
    const order = await this.find(tx, id, true);
    if (order.state !== "confirmed" && order.state !== "in_progress")
      throw new BadRequestException("Order produksi belum dikonfirmasi atau sudah selesai");
    const input = parse(productionOperationSchema, body);
    const [op] = await tx
      .select()
      .from(MOP)
      .where(and(eq(MOP.id, opId), eq(MOP.orderId, id)));
    if (!op) throw new NotFoundException("Operasi tidak ditemukan");
    const now = new Date();
    if (input.action === "start") {
      if (op.state !== "pending") throw new BadRequestException("Operasi sudah dimulai");
      await tx.update(MOP).set({ state: "running", startedAt: now }).where(eq(MOP.id, opId));
    } else {
      let minutes = input.actualMinutes;
      if (minutes == null && input.action === "finish") {
        minutes = op.startedAt
          ? Math.max(0, (now.getTime() - op.startedAt.getTime()) / 60000).toFixed(2)
          : op.plannedMinutes;
      }
      if (minutes == null) throw fieldError("actualMinutes", "Isi menit aktual");
      await tx
        .update(MOP)
        .set({
          actualMinutes: d(minutes).toFixed(2),
          cost: operationCost(minutes, op.costPerHour),
          ...(input.action === "finish"
            ? { state: "done" as const, finishedAt: now, startedAt: op.startedAt ?? now }
            : {}),
        })
        .where(eq(MOP.id, opId));
    }
    if (order.state === "confirmed")
      await tx
        .update(MO)
        .set({ state: "in_progress", updatedAt: sql`now()` })
        .where(eq(MO.id, id));
    return this.detail(tx, id);
  }

  /**
   * Selesaikan produksi: bahan keluar ke lokasi Produksi (Dr WIP / Cr Persediaan, nilai FIFO/rata-rata aktual),
   * biaya konversi (menit × tarif) Dr WIP / Cr Biaya Konversi Dibebankan, barang jadi masuk dengan biaya = (bahan +
   * konversi) / kuantitas (Dr Persediaan / Cr WIP) sehingga WIP per order kembali nol.
   */
  async produce(tx: Db, id: string, body: unknown) {
    const order = await this.find(tx, id, true);
    if (order.state !== "confirmed" && order.state !== "in_progress")
      throw new BadRequestException("Order produksi belum dikonfirmasi atau sudah selesai");
    const input = parse(produceSchema, body ?? {});
    const companyId = order.companyId;
    const books = await loadBooks(tx, companyId);
    const s = books.settings;
    if (!s.wipAccountId || !s.productionAbsorptionAccountId || !s.stockValuationAccountId)
      throw new BadRequestException(
        "Akun barang dalam proses & biaya konversi belum diatur di pengaturan akuntansi",
      );
    const qty = d(input.qtyProduced ?? order.quantity);
    const factor = qty.div(order.quantity);
    const [product] = await tx.select().from(P).where(eq(P.id, order.productId));
    // Lot/serial barang jadi.
    let finishedLots: { lotId: string; quantity: Decimal }[] = [];
    if (product!.tracking === "lot") {
      if (!input.lotName) throw fieldError("lotName", "Isi nomor lot barang jadi");
      const lot = await this.stock.findOrCreateLot(tx, companyId, product!.id, input.lotName, null);
      finishedLots = [{ lotId: lot.id, quantity: qty }];
    } else if (product!.tracking === "serial") {
      const names = input.serialNames ?? [];
      if (!qty.isInteger() || names.length !== qty.toNumber() || new Set(names).size !== names.length)
        throw fieldError("serialNames", "Isi satu nomor serial unik untuk setiap unit");
      for (const n of names) {
        const lot = await this.stock.findOrCreateLot(tx, companyId, product!.id, n, null);
        const onHand = await tx
          .select({ q: schema.stockQuants.quantity })
          .from(schema.stockQuants)
          .innerJoin(schema.stockLocations, eq(schema.stockLocations.id, schema.stockQuants.locationId))
          .where(
            and(
              eq(schema.stockQuants.lotId, lot.id),
              eq(schema.stockLocations.usage, "internal"),
              sql`${schema.stockQuants.quantity} > 0`,
            ),
          );
        if (onHand.length) throw fieldError("serialNames", `Nomor serial ${n} sudah ada di stok`);
        finishedLots.push({ lotId: lot.id, quantity: new Decimal(1) });
      }
    }

    // Bahan yang dipakai.
    const components = await tx
      .select({ c: MC, product: P })
      .from(MC)
      .innerJoin(P, eq(P.id, MC.productId))
      .where(eq(MC.orderId, id))
      .orderBy(asc(MC.sequence));
    const given = new Map((input.components ?? []).map((c) => [c.id, c]));
    for (const id2 of given.keys())
      if (!components.some((c) => c.c.id === id2)) throw fieldError("components", "Komponen tidak ditemukan");
    const production = await virtualLocation(tx, companyId, "production");
    const shortages: string[] = [];
    const lines = [];
    for (const [i, r] of components.entries()) {
      const entry = given.get(r.c.id);
      const consumed = entry ? d(entry.qtyConsumed) : d(r.c.qtyRequired).times(factor).toDecimalPlaces(4);
      if (consumed.isZero()) continue;
      if (r.product.productType === "storable") {
        const available = await this.stock.onHand(tx, order.locationId, r.product.id);
        if (available.lt(consumed))
          shortages.push(
            `${r.product.sku} ${r.product.name}: perlu ${consumed.toString()}, ada ${available.toString()}`,
          );
      }
      let lots: { lotId: string; quantity: Decimal }[] = [];
      if (r.product.tracking !== "none") {
        if (entry?.lots?.length) {
          lots = entry.lots.map((l) => ({ lotId: l.lotId, quantity: d(l.quantity) }));
          const total = lots.reduce((s2, l) => s2.plus(l.quantity), new Decimal(0));
          if (!total.eq(consumed))
            throw fieldError(`components.${i}.lots`, "Jumlah lot harus sama dengan kuantitas terpakai");
        } else {
          // Pilih otomatis: kedaluwarsa paling dekat, lalu tertua.
          let left = consumed;
          for (const q of await this.stock.availableLots(tx, order.locationId, r.product.id)) {
            if (left.lte(0)) break;
            const take = Decimal.min(left, q.quantity);
            lots.push({ lotId: q.lotId!, quantity: take });
            left = left.minus(take);
          }
          if (left.gt(0)) shortages.push(`${r.product.sku}: lot/serial tersedia kurang ${left.toString()}`);
        }
      }
      lines.push({ component: r.c, consumed, lots, productId: r.product.id });
    }
    if (shortages.length)
      throw new BadRequestException(`Stok bahan tidak cukup: ${shortages.join("; ")}`.slice(0, 1000));

    const date = input.date ? new Date(`${input.date}T12:00:00Z`) : new Date();
    const warehouse = await this.stock.warehouse(tx, order.warehouseId, companyId);
    const ctx = { ref: order.name, date, branchId: warehouse.branchId };
    const consumedRes = await this.stock.moveForProduction(
      tx,
      companyId,
      lines.map((l) => ({
        productId: l.productId,
        quantity: l.consumed,
        locationId: order.locationId,
        locationDestId: production.id,
        lots: l.lots,
        productionOrderId: id,
      })),
      ctx,
    );
    let material = new Decimal(0);
    for (const l of lines) {
      const move = consumedRes.moves.find((m) => m.productId === l.productId);
      const value = d(move?.value);
      material = material.plus(value);
      await tx
        .update(MC)
        .set({
          qtyConsumed: l.consumed.toFixed(4),
          lots: l.lots.map((x) => ({ lotId: x.lotId, quantity: x.quantity.toFixed(4) })),
          value: value.toFixed(2),
          stockMoveId: move?.id ?? null,
        })
        .where(eq(MC.id, l.component.id));
    }

    // Biaya konversi: menit aktual (atau rencana × proporsi hasil bila belum dicatat) × tarif.
    const ops = await tx.select().from(MOP).where(eq(MOP.orderId, id));
    let conversion = new Decimal(0);
    for (const op of ops) {
      const minutes = op.actualMinutes != null ? d(op.actualMinutes) : d(op.plannedMinutes).times(factor);
      const cost = d(operationCost(minutes, op.costPerHour));
      conversion = conversion.plus(cost);
      await tx
        .update(MOP)
        .set({
          actualMinutes: minutes.toFixed(2),
          cost: cost.toFixed(2),
          state: "done",
          finishedAt: op.finishedAt ?? date,
          startedAt: op.startedAt ?? date,
        })
        .where(eq(MOP.id, op.id));
    }
    if (conversion.gt(0) && s.stockJournalId) {
      const moveId = await this.moves.createEntry(
        tx,
        {
          journalId: s.stockJournalId,
          date: businessToday(date),
          ref: `${order.name}: biaya konversi`,
          lines: [
            {
              accountId: s.wipAccountId,
              name: `${order.name} biaya tenaga kerja & overhead`,
              debit: conversion.toFixed(2),
              credit: "0",
              partnerId: null,
              branchId: warehouse.branchId,
            },
            {
              accountId: s.productionAbsorptionAccountId,
              name: `${order.name} biaya konversi dibebankan`,
              debit: "0",
              credit: conversion.toFixed(2),
              partnerId: null,
              branchId: warehouse.branchId,
            },
          ],
        },
        companyId,
      );
      await this.moves.post(tx, moveId);
    }

    // Barang jadi.
    const unitCost = productionUnitCost(material, conversion, qty);
    const finished = await this.stock.moveForProduction(
      tx,
      companyId,
      [
        {
          productId: order.productId,
          quantity: qty,
          locationId: production.id,
          locationDestId: order.locationDestId,
          priceUnit: unitCost,
          lots: finishedLots,
          productionOrderId: id,
        },
      ],
      ctx,
    );
    for (const hook of this.stock.producedHooks) for (const m of finished.moves) await hook(tx, order, m);
    // Sisa pembulatan biaya per unit (4 desimal) diselesaikan ke WIP via biaya konversi agar WIP nol.
    const finishedValue = d(finished.moves[0]?.value);
    const residual = material.plus(conversion).minus(finishedValue);
    if (!residual.isZero() && s.stockJournalId) {
      const up = residual.gt(0);
      const moveId = await this.moves.createEntry(
        tx,
        {
          journalId: s.stockJournalId,
          date: businessToday(date),
          ref: `${order.name}: selisih pembulatan`,
          lines: [
            {
              accountId: s.stockAdjustmentAccountId ?? s.productionAbsorptionAccountId,
              name: `${order.name} selisih pembulatan biaya`,
              debit: up ? residual.abs().toFixed(2) : "0",
              credit: up ? "0" : residual.abs().toFixed(2),
              partnerId: null,
              branchId: warehouse.branchId,
            },
            {
              accountId: s.wipAccountId,
              name: `${order.name} selisih pembulatan biaya`,
              debit: up ? "0" : residual.abs().toFixed(2),
              credit: up ? residual.abs().toFixed(2) : "0",
              partnerId: null,
              branchId: warehouse.branchId,
            },
          ],
        },
        companyId,
      );
      await this.moves.post(tx, moveId);
    }
    await tx
      .update(MO)
      .set({
        state: "done",
        qtyProduced: qty.toFixed(4),
        lotName:
          input.lotName ?? (input.serialNames?.length ? input.serialNames.join(", ").slice(0, 100) : null),
        materialCost: material.toFixed(2),
        conversionCost: conversion.toFixed(2),
        unitCost,
        accountMoveId: finished.accountMoveId,
        dateDone: date,
        updatedAt: sql`now()`,
      })
      .where(eq(MO.id, id));
    await this.activity.log(tx, {
      resModel: "production_order",
      resId: id,
      action: "update",
      message: `Selesai: ${qty.toString()} unit, bahan ${material.toFixed(2)}, konversi ${conversion.toFixed(2)}`,
    });
    return this.detail(tx, id);
  }

  async cancel(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state === "done" || order.state === "cancel")
      throw new BadRequestException("Order produksi yang selesai atau batal tidak bisa dibatalkan");
    await tx
      .update(MO)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(MO.id, id));
    return this.detail(tx, id);
  }

  async remove(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "cancel")
      throw new BadRequestException("Hanya order produksi draft atau batal yang bisa dihapus");
    await tx.delete(MO).where(eq(MO.id, id));
  }

  /** Laporan biaya produksi per produk (order selesai dalam periode). */
  async costReport(tx: Db, from: string, to: string) {
    const rows = await tx
      .select({
        productId: MO.productId,
        sku: P.sku,
        productName: P.name,
        orders: sql<number>`count(*)::int`,
        quantity: sql<string>`sum(${MO.qtyProduced})::text`,
        material: sql<string>`sum(${MO.materialCost})::text`,
        conversion: sql<string>`sum(${MO.conversionCost})::text`,
      })
      .from(MO)
      .innerJoin(P, eq(P.id, MO.productId))
      .where(
        and(
          eq(MO.companyId, currentContext().companyId),
          eq(MO.state, "done"),
          gte(sql`${MO.dateDone}::date`, from),
          lte(sql`${MO.dateDone}::date`, to),
        ),
      )
      .groupBy(MO.productId, P.sku, P.name)
      .orderBy(asc(P.sku));
    return rows.map((r) => {
      const total = d(r.material).plus(r.conversion);
      return {
        ...r,
        material: d(r.material).toFixed(2),
        conversion: d(r.conversion).toFixed(2),
        total: total.toFixed(2),
        unitCost: d(r.quantity).isZero() ? "0.0000" : total.div(r.quantity).toDecimalPlaces(4).toFixed(4),
      };
    });
  }
}

const RUN = schema.mrpRuns;
const PR = schema.mrpProposals;
const plusDays = (days: number) => businessToday(new Date(Date.now() + days * 86_400_000));

/** Perencanaan kebutuhan bahan (MRP) per gudang: usulan order produksi & pembelian dari kebutuhan bersih. */
@Injectable()
export class MrpService {
  constructor(
    @Inject(StockService) private readonly stock: StockService,
    @Inject(ManufacturingService) private readonly manufacturing: ManufacturingService,
    @Inject(PurchaseOrderService) private readonly orders: PurchaseOrderService,
  ) {}

  async run(tx: Db, body: unknown) {
    const input = parse(mrpRunSchema, body ?? {});
    const ctx = currentContext();
    const companyId = ctx.companyId;
    const warehouse = input.warehouseId
      ? await this.stock.warehouse(tx, input.warehouseId, companyId)
      : await this.stock.defaultWarehouse(tx, companyId);
    const horizon = input.horizonDate ?? plusDays(30);
    const wh = warehouse.id;
    const internal = sql`(select l.id from stock_locations l where l.usage = 'internal' and l.warehouse_id = ${wh})`;

    // Permintaan: pengiriman (SO) belum selesai dari gudang ini, dan bahan order produksi terbuka.
    const shipments = await tx.execute<{ product_id: string; qty: string; date: string; ref: string }>(sql`
      select m.product_id, m.quantity::text as qty, p.scheduled_date::text as date, coalesce(p.origin, p.name) as ref
      from stock_moves m join stock_pickings p on p.id = m.picking_id
      where m.company_id = ${companyId} and m.state in ('draft', 'ready')
        and m.location_id in ${internal} and m.location_dest_id not in ${internal}
        and p.picking_type = 'outgoing' and p.scheduled_date <= ${horizon}`);
    const moComponents = await tx.execute<{ product_id: string; qty: string; date: string; ref: string }>(sql`
      select c.product_id, c.qty_required::text as qty, o.date_planned::text as date, o.name as ref
      from production_components c join production_orders o on o.id = c.order_id
      where o.company_id = ${companyId} and o.warehouse_id = ${wh}
        and o.state in ('draft', 'confirmed', 'in_progress') and o.date_planned <= ${horizon}`);
    const demands: MrpDemand[] = [...shipments, ...moComponents].map((r) => ({
      productId: r.product_id,
      quantity: r.qty,
      date: r.date < today() ? today() : r.date,
      source: r.ref,
    }));

    // Stok & pasokan per produk di gudang ini.
    const onHand = await tx.execute<{ product_id: string; qty: string }>(sql`
      select q.product_id, sum(q.quantity)::text as qty from stock_quants q
      where q.company_id = ${companyId} and q.location_id in ${internal} group by q.product_id`);
    const supply = await tx.execute<{ product_id: string; qty: string }>(sql`
      select product_id, sum(qty)::text as qty from (
        select m.product_id, m.quantity as qty from stock_moves m
        where m.company_id = ${companyId} and m.state = 'ready'
          and m.location_dest_id in ${internal} and m.location_id not in ${internal}
        union all
        select pl.product_id, pl.quantity * pl.uom_ratio from purchase_order_lines pl
        join purchase_orders po on po.id = pl.order_id
        where po.company_id = ${companyId} and po.warehouse_id = ${wh} and pl.product_id is not null
          and po.state in ('draft', 'sent', 'to_approve')
        union all
        select o.product_id, o.quantity from production_orders o
        where o.company_id = ${companyId} and o.warehouse_id = ${wh} and o.state in ('draft', 'confirmed', 'in_progress')
      ) s group by product_id`);
    const rules = await tx
      .select()
      .from(schema.stockReorderRules)
      .where(
        and(
          eq(schema.stockReorderRules.companyId, companyId),
          eq(schema.stockReorderRules.warehouseId, wh),
          eq(schema.stockReorderRules.active, true),
        ),
      );
    const index = await this.manufacturing.bomIndex(tx, companyId);
    const bomLead = new Map(
      (
        await tx
          .select({ id: schema.boms.id, leadDays: schema.boms.leadDays })
          .from(schema.boms)
          .where(eq(schema.boms.companyId, companyId))
      ).map((b) => [b.id, b.leadDays]),
    );
    const productIds = new Set<string>([
      ...demands.map((x) => x.productId),
      ...rules.map((r) => r.productId),
      ...index.nodes.flatMap((n) => [n.productId, ...n.lines.map((l) => l.productId)]),
    ]);
    const products = productIds.size
      ? await tx
          .select()
          .from(P)
          .where(and(inArray(P.id, [...productIds]), or(isNull(P.companyId), eq(P.companyId, companyId))))
      : [];
    const suppliers = productIds.size
      ? await tx
          .select()
          .from(schema.productSuppliers)
          .where(
            and(
              inArray(schema.productSuppliers.productId, [...productIds]),
              or(isNull(schema.productSuppliers.companyId), eq(schema.productSuppliers.companyId, companyId)),
            ),
          )
      : [];
    const items = new Map<string, MrpItem>();
    for (const p of products) {
      if (p.productType === "service") continue;
      const supplier = pickSupplier(
        suppliers.filter((s) => s.productId === p.id),
        "1",
      );
      const rule = rules.find((r) => r.productId === p.id);
      const bom = index.first.get(p.id);
      items.set(p.id, {
        productId: p.id,
        onHand: onHand.find((r) => r.product_id === p.id)?.qty ?? "0",
        supply: supply.find((r) => r.product_id === p.id)?.qty ?? "0",
        rule: rule ? { minQty: rule.minQty, maxQty: rule.maxQty, qtyMultiple: rule.qtyMultiple } : null,
        supplierId: supplier?.partnerId ?? null,
        purchaseLeadDays: supplier?.delayDays ?? 0,
        produceLeadDays: bom ? (bomLead.get(bom.id) ?? 0) : 0,
      });
    }
    let plan;
    try {
      plan = mrpPlan({
        items,
        demands: demands.filter((x) => items.has(x.productId)),
        boms: index.first,
        today: today(),
      }).filter((x) => items.has(x.productId));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const [run] = await tx
      .insert(RUN)
      .values({
        companyId,
        warehouseId: wh,
        horizonDate: horizon,
        proposals: plan.length,
        createdBy: ctx.userId,
      })
      .returning({ id: RUN.id });
    // Sumber "bahan <id produk induk>" ditampilkan dengan SKU induk.
    const skuOf = new Map(products.map((p) => [p.id, p.sku]));
    const label = (reason: string) =>
      reason.replace(/bahan ([0-9a-f-]{36})/g, (_, id: string) => `bahan ${skuOf.get(id) ?? id}`);
    if (plan.length)
      await tx.insert(PR).values(plan.map((x) => ({ ...x, reason: label(x.reason), runId: run!.id })));
    return this.detail(tx, run!.id);
  }

  private async find(tx: Db, id: string) {
    const [run] = await tx
      .select()
      .from(RUN)
      .where(and(eq(RUN.id, id), eq(RUN.companyId, currentContext().companyId)));
    if (!run) throw new NotFoundException("Hasil MRP tidak ditemukan");
    return run;
  }

  async list(tx: Db) {
    return tx
      .select({
        id: RUN.id,
        createdAt: RUN.createdAt,
        horizonDate: RUN.horizonDate,
        proposals: RUN.proposals,
        warehouseName: schema.warehouses.name,
        done: sql<number>`(select count(*)::int from mrp_proposals p where p.run_id = ${RUN.id} and p.state = 'done')`,
      })
      .from(RUN)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, RUN.warehouseId))
      .where(eq(RUN.companyId, currentContext().companyId))
      .orderBy(desc(RUN.createdAt))
      .limit(100);
  }

  async detail(tx: Db, id: string) {
    const run = await this.find(tx, id);
    const proposals = await tx
      .select({
        p: PR,
        sku: P.sku,
        productName: P.name,
        supplierName: schema.partners.name,
        moName: schema.productionOrders.name,
        poName: schema.purchaseOrders.name,
      })
      .from(PR)
      .innerJoin(P, eq(P.id, PR.productId))
      .leftJoin(schema.partners, eq(schema.partners.id, PR.supplierId))
      .leftJoin(schema.productionOrders, eq(schema.productionOrders.id, PR.productionOrderId))
      .leftJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, PR.purchaseOrderId))
      .where(eq(PR.runId, id))
      .orderBy(asc(PR.level), asc(PR.dateStart), asc(P.sku));
    const [wh] = await tx
      .select({ name: schema.warehouses.name })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, run.warehouseId));
    return {
      ...run,
      warehouseName: wh?.name ?? null,
      proposals: proposals.map((r) => ({
        ...r.p,
        sku: r.sku,
        productName: r.productName,
        supplierName: r.supplierName,
        productionOrderName: r.moName,
        purchaseOrderName: r.poName,
      })),
    };
  }

  /** Konfirmasi usulan: order produksi draft per usulan produksi, RFQ per pemasok untuk usulan pembelian. */
  async confirm(tx: Db, id: string, body: unknown) {
    const run = await this.find(tx, id);
    const input = parse(mrpConfirmSchema, body);
    const rows = await tx
      .select({ p: PR, uomId: P.uomId })
      .from(PR)
      .innerJoin(P, eq(P.id, PR.productId))
      .where(and(eq(PR.runId, id), inArray(PR.id, input.proposalIds), eq(PR.state, "proposed")));
    const skipped: { id: string; reason: string }[] = [];
    const created = { productionOrders: [] as string[], purchaseOrders: [] as string[] };
    for (const r of rows.filter((x) => x.p.kind === "manufacture")) {
      const mo = await this.manufacturing.createOrder(tx, {
        productId: r.p.productId,
        bomId: r.p.bomId,
        quantity: d(r.p.quantity).toFixed(4),
        warehouseId: run.warehouseId,
        datePlanned: r.p.dateStart,
        origin: `MRP ${run.createdAt.toISOString().slice(0, 10)}`,
      });
      created.productionOrders.push(mo.id);
      await tx.update(PR).set({ state: "done", productionOrderId: mo.id }).where(eq(PR.id, r.p.id));
    }
    const groups = new Map<string, typeof rows>();
    for (const r of rows.filter((x) => x.p.kind === "purchase")) {
      if (!r.p.supplierId) {
        skipped.push({ id: r.p.id, reason: "Produk belum punya pemasok (Harga Pemasok)" });
        continue;
      }
      groups.set(r.p.supplierId, [...(groups.get(r.p.supplierId) ?? []), r]);
    }
    for (const [supplierId, list] of groups) {
      const dates = list.map((x) => x.p.dateNeeded).sort();
      const po = await this.orders.create(tx, {
        partnerId: supplierId,
        dateOrder: today(),
        datePlanned: dates[0]!,
        warehouseId: run.warehouseId,
        note: "Dibuat dari usulan MRP",
        lines: list.map((x) => ({
          productId: x.p.productId,
          quantity: d(x.p.quantity).toFixed(4),
          discount: "0",
          uomId: x.uomId,
          datePlanned: x.p.dateNeeded,
        })),
      });
      created.purchaseOrders.push(po.id);
      await tx
        .update(PR)
        .set({ state: "done", purchaseOrderId: po.id })
        .where(
          inArray(
            PR.id,
            list.map((x) => x.p.id),
          ),
        );
    }
    return { ...created, skipped, run: await this.detail(tx, id) };
  }

  async ignore(tx: Db, id: string, body: unknown) {
    await this.find(tx, id);
    const input = parse(mrpConfirmSchema, body);
    await tx
      .update(PR)
      .set({ state: "ignored" })
      .where(and(eq(PR.runId, id), inArray(PR.id, input.proposalIds), eq(PR.state, "proposed")));
    return this.detail(tx, id);
  }
}

@Controller()
export class ManufacturingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ManufacturingService) private readonly service: ManufacturingService,
    @Inject(MrpService) private readonly mrp: MrpService,
  ) {}

  @Get("boms")
  @RequirePermission("mrp.read")
  listBoms() {
    return this.tenantDb.run((tx) => this.service.listBoms(tx));
  }

  @Post("boms")
  @RequirePermission("mrp.manage")
  createBom(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.createBom(tx, body));
  }

  @Get("boms/:id")
  @RequirePermission("mrp.read")
  bom(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.bomDetail(tx, id));
  }

  @Get("boms/:id/cost")
  @RequirePermission("mrp.read")
  bomCost(@Param("id", ParseUUIDPipe) id: string, @Query("qty") qty?: string) {
    const quantity = parse(
      z
        .string()
        .regex(/^\d+(\.\d{1,4})?$/)
        .default("1"),
      qty,
    );
    return this.tenantDb.run((tx) => this.service.bomCost(tx, id, quantity));
  }

  @Put("boms/:id")
  @RequirePermission("mrp.manage")
  updateBom(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.updateBom(tx, id, body));
  }

  @Delete("boms/:id")
  @HttpCode(204)
  @RequirePermission("mrp.manage")
  async removeBom(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.removeBom(tx, id));
  }

  @Get("production-orders")
  @RequirePermission("mrp.read")
  list(@Query("state") state?: string) {
    return this.tenantDb.run((tx) => this.service.list(tx, { state }));
  }

  @Post("production-orders")
  @RequirePermission("mrp.write")
  create(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.createOrder(tx, body));
  }

  @Get("production-orders/:id")
  @RequirePermission("mrp.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.detail(tx, id));
  }

  @Delete("production-orders/:id")
  @HttpCode(204)
  @RequirePermission("mrp.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.remove(tx, id));
  }

  @Post("production-orders/:id/confirm")
  @HttpCode(200)
  @RequirePermission("mrp.write")
  confirm(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.confirm(tx, id));
  }

  @Post("production-orders/:id/operations/:opId")
  @HttpCode(200)
  @RequirePermission("mrp.write")
  operation(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("opId", ParseUUIDPipe) opId: string,
    @Body() body: unknown,
  ) {
    return this.tenantDb.run((tx) => this.service.operation(tx, id, opId, body));
  }

  @Post("production-orders/:id/produce")
  @HttpCode(200)
  @RequirePermission("mrp.manage")
  produce(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.produce(tx, id, body));
  }

  @Post("production-orders/:id/cancel")
  @HttpCode(200)
  @RequirePermission("mrp.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.cancel(tx, id));
  }

  @Get("mrp/runs")
  @RequirePermission("mrp.read")
  mrpRuns() {
    return this.tenantDb.run((tx) => this.mrp.list(tx));
  }

  @Post("mrp/runs")
  @RequirePermission("mrp.write")
  mrpRun(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.mrp.run(tx, body));
  }

  @Get("mrp/runs/:id")
  @RequirePermission("mrp.read")
  mrpRunDetail(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.mrp.detail(tx, id));
  }

  @Post("mrp/runs/:id/confirm")
  @HttpCode(200)
  @RequirePermission("mrp.write")
  mrpConfirm(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.mrp.confirm(tx, id, body));
  }

  @Post("mrp/runs/:id/ignore")
  @HttpCode(200)
  @RequirePermission("mrp.write")
  mrpIgnore(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.mrp.ignore(tx, id, body));
  }

  @Get("manufacturing/reports/costs")
  @RequirePermission("mrp.read")
  costReport(@Query("from") from?: string, @Query("to") to?: string) {
    const input = parse(
      z.object({
        from: z
          .string()
          .date()
          .default(`${today().slice(0, 4)}-01-01`),
        to: z.string().date().default(today()),
      }),
      { from, to },
    );
    return this.tenantDb.run((tx) => this.service.costReport(tx, input.from, input.to));
  }
}

@Module({
  imports: [AccountingModule, InventoryModule, PurchaseModule],
  controllers: [WorkCentersController, ManufacturingController],
  providers: [ManufacturingService, MrpService, SequenceService, ActivityService],
})
export class ManufacturingModule {}
