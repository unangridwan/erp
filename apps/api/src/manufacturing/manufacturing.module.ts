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
} from "@erp/shared";
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
const today = () => new Date().toISOString().slice(0, 10);

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
  private async bomIndex(tx: Db, companyId: string) {
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
          date: date.toISOString().slice(0, 10),
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
    // Sisa pembulatan biaya per unit (4 desimal) diselesaikan ke WIP via biaya konversi agar WIP nol.
    const finishedValue = d(finished.moves[0]?.value);
    const residual = material.plus(conversion).minus(finishedValue);
    if (!residual.isZero() && s.stockJournalId) {
      const up = residual.gt(0);
      const moveId = await this.moves.createEntry(
        tx,
        {
          journalId: s.stockJournalId,
          date: date.toISOString().slice(0, 10),
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

@Controller()
export class ManufacturingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ManufacturingService) private readonly service: ManufacturingService,
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
  imports: [AccountingModule, InventoryModule],
  controllers: [WorkCentersController, ManufacturingController],
  providers: [ManufacturingService, SequenceService, ActivityService],
})
export class ManufacturingModule {}
