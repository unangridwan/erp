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
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNull, or, schema, sql, type Db } from "@erp/db";
import {
  COUNT_SHEET_COLUMNS,
  countSummary,
  lineVariance,
  parseCountSheetRow,
  parseCsv,
  stockCountAddLineSchema,
  stockCountLinesSchema,
  stockCountScanSchema,
  stockCountSchema,
  stockCountSubmitSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { Response } from "express";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { parseXlsx, toXlsxBook } from "../common/csv-import.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ApprovalEngineService } from "../hr/approval-engine.service.js";
import { HrModule } from "../hr/hr.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { renderLabelsPdf, type Label } from "./labels-pdf.js";
import { InventoryModule } from "./inventory.module.js";
import { StockService } from "./stock.service.js";

const C = schema.stockCounts;
const L = schema.stockCountLines;
const P = schema.products;
const LOT = schema.stockLots;
const LOC = schema.stockLocations;
const REQ = schema.approvalRequests;
const CAT = schema.approvalCategories;
const CATEGORY = {
  code: "OPNAME",
  name: "Selisih Stock Opname",
  prefix: "SOP",
  description: "Persetujuan selisih hitung fisik persediaan sebelum diposting sebagai penyesuaian.",
  fields: { amount: "required", description: "required" } as const,
};
type Count = typeof C.$inferSelect;
type Line = typeof L.$inferSelect;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

@Injectable()
export class StockCountService {
  constructor(
    @Inject(StockService) private readonly stock: StockService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  private async find(tx: Db, id: string, lock = false): Promise<Count> {
    const query = tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundException("Sesi stock opname tidak ditemukan");
    return this.sync(tx, row);
  }

  /** Status mengikuti permintaan persetujuan: disetujui → approved; ditolak/dibatalkan → kembali dihitung. */
  private async sync(tx: Db, c: Count): Promise<Count> {
    if (c.state !== "in_approval" || !c.approvalRequestId) return c;
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, c.approvalRequestId));
    const next =
      req?.state === "approved"
        ? "approved"
        : req?.state === "refused" || req?.state === "cancel"
          ? "counting"
          : null;
    if (!next) return c;
    const [row] = await tx
      .update(C)
      .set({ state: next, updatedAt: sql`now()` })
      .where(eq(C.id, c.id))
      .returning();
    return row!;
  }

  /** Id lokasi internal di bawah lokasi akar (termasuk dirinya). */
  private async locationTree(tx: Db, rootId: string) {
    const rows = await tx.execute<{ id: string }>(sql`
      with recursive t as (
        select id from stock_locations where id = ${rootId}
        union all
        select l.id from stock_locations l join t on l.parent_id = t.id
      )
      select t.id from t join stock_locations l on l.id = t.id where l.usage = 'internal'`);
    return rows.map((r) => r.id);
  }

  private async categoryTree(tx: Db, rootId: string) {
    const rows = await tx.execute<{ id: string }>(sql`
      with recursive t as (
        select id from product_categories where id = ${rootId}
        union all
        select c.id from product_categories c join t on c.parent_id = t.id
      )
      select id from t`);
    return rows.map((r) => r.id);
  }

  async create(tx: Db, body: unknown) {
    const input = parse(stockCountSchema, body);
    const companyId = currentContext().companyId;
    const warehouse = await this.stock.warehouse(tx, input.warehouseId, companyId);
    const locationId = input.locationId ?? warehouse.lotStockId;
    const location = await this.stock.location(tx, locationId, companyId);
    if (location.usage !== "internal") throw fieldError("locationId", "Pilih lokasi stok internal");
    if (location.warehouseId && location.warehouseId !== warehouse.id)
      throw fieldError("locationId", "Lokasi bukan milik gudang ini");
    if (input.categoryId) {
      const [cat] = await tx
        .select({ id: schema.productCategories.id })
        .from(schema.productCategories)
        .where(eq(schema.productCategories.id, input.categoryId));
      if (!cat) throw fieldError("categoryId", "Kategori produk tidak ditemukan");
    }
    const name = await this.sequences.next(
      tx,
      "stock.count",
      companyId,
      new Date(`${input.date}T00:00:00Z`),
      "OPN",
    );
    const [row] = await tx
      .insert(C)
      .values({
        companyId,
        name,
        warehouseId: warehouse.id,
        locationId,
        categoryId: input.categoryId ?? null,
        date: input.date,
        note: input.note ?? null,
        createdBy: currentContext().userId,
      })
      .returning({ id: C.id });
    await this.activity.log(tx, { resModel: "stock_count", resId: row!.id, action: "create" });
    return this.detail(tx, row!.id);
  }

  /** Mulai hitung: ambil snapshot stok sistem (lokasi & kategori sesi) sebagai baris hitung. */
  async start(tx: Db, id: string) {
    const count = await this.find(tx, id, true);
    if (count.state !== "draft") throw new BadRequestException("Sesi sudah dimulai");
    const companyId = count.companyId;
    const locations = await this.locationTree(tx, count.locationId);
    const categories = count.categoryId ? await this.categoryTree(tx, count.categoryId) : null;
    const quants = await tx
      .select({
        productId: schema.stockQuants.productId,
        locationId: schema.stockQuants.locationId,
        lotId: schema.stockQuants.lotId,
        quantity: schema.stockQuants.quantity,
      })
      .from(schema.stockQuants)
      .innerJoin(P, eq(P.id, schema.stockQuants.productId))
      .where(
        and(
          eq(schema.stockQuants.companyId, companyId),
          inArray(schema.stockQuants.locationId, locations),
          sql`${schema.stockQuants.quantity} <> 0`,
          eq(P.productType, "storable"),
          categories ? inArray(P.categoryId, categories) : undefined,
        ),
      );
    // Cycle count per kategori: produk stok tanpa saldo tetap masuk di lokasi akar (hitung 0 atau temuan).
    const zero = categories
      ? await tx
          .select({ id: P.id })
          .from(P)
          .where(
            and(
              inArray(P.categoryId, categories),
              eq(P.productType, "storable"),
              eq(P.active, true),
              or(isNull(P.companyId), eq(P.companyId, companyId)),
              sql`${P.tracking} = 'none'`,
            ),
          )
      : [];
    const productIds = [...new Set([...quants.map((q) => q.productId), ...zero.map((z) => z.id)])];
    const cost = new Map<string, string>();
    if (productIds.length) {
      const products = await tx.select().from(P).where(inArray(P.id, productIds));
      for (const p of products) cost.set(p.id, await this.stock.currentCost(tx, companyId, p));
    }
    const rows = quants.map((q) => ({
      countId: id,
      productId: q.productId,
      locationId: q.locationId,
      lotId: q.lotId,
      systemQty: d(q.quantity).toFixed(4),
      unitCost: cost.get(q.productId) ?? "0",
    }));
    for (const z of zero)
      if (!quants.some((q) => q.productId === z.id))
        rows.push({
          countId: id,
          productId: z.id,
          locationId: count.locationId,
          lotId: null,
          systemQty: "0.0000",
          unitCost: cost.get(z.id) ?? "0",
        });
    for (let i = 0; i < rows.length; i += 500) await tx.insert(L).values(rows.slice(i, i + 500));
    await tx
      .update(C)
      .set({ state: "counting", startedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.activity.log(tx, {
      resModel: "stock_count",
      resId: id,
      action: "update",
      message: `Hitung dimulai: ${rows.length} baris`,
    });
    return this.detail(tx, id);
  }

  private assertCounting(count: Count) {
    if (count.state !== "counting") throw new BadRequestException("Sesi tidak sedang dalam tahap hitung");
  }

  async setLines(tx: Db, id: string, body: unknown) {
    const count = await this.find(tx, id, true);
    this.assertCounting(count);
    const input = parse(stockCountLinesSchema, body);
    const ids = input.lines.map((l) => l.id);
    const existing = ids.length
      ? await tx
          .select({ id: L.id, productId: L.productId })
          .from(L)
          .where(and(eq(L.countId, id), inArray(L.id, ids)))
      : [];
    const tracking = await this.trackingOf(
      tx,
      existing.map((e) => e.productId),
    );
    const userId = currentContext().userId;
    for (const [i, l] of input.lines.entries()) {
      const row = existing.find((e) => e.id === l.id);
      if (!row) throw fieldError(`lines.${i}.id`, "Baris hitung tidak ditemukan");
      if (tracking.get(row.productId) === "serial" && l.countedQty != null && d(l.countedQty).gt(1))
        throw fieldError(`lines.${i}.countedQty`, "Nomor serial hanya boleh berjumlah 0 atau 1");
      await tx
        .update(L)
        .set({
          countedQty: l.countedQty,
          ...(l.note !== undefined ? { note: l.note ?? null } : {}),
          countedBy: l.countedQty == null ? null : userId,
          countedAt: l.countedQty == null ? null : sql`now()`,
        })
        .where(eq(L.id, l.id));
    }
    return this.detail(tx, id);
  }

  private async trackingOf(tx: Db, productIds: string[]) {
    if (!productIds.length) return new Map<string, string>();
    const rows = await tx
      .select({ id: P.id, tracking: P.tracking })
      .from(P)
      .where(inArray(P.id, [...new Set(productIds)]));
    return new Map(rows.map((r) => [r.id, r.tracking]));
  }

  /** Lokasi hitung: harus di bawah lokasi akar sesi. */
  private async countLocation(tx: Db, count: Count, locationId?: string | null) {
    const id = locationId ?? count.locationId;
    if (id !== count.locationId && !(await this.locationTree(tx, count.locationId)).includes(id))
      throw fieldError("locationId", "Lokasi di luar cakupan sesi opname");
    return id;
  }

  /** Baris untuk produk+lokasi+lot: yang ada, atau baru (stok sistem saat ini sebagai pembanding). */
  private async lineFor(
    tx: Db,
    count: Count,
    product: typeof P.$inferSelect,
    locationId: string,
    lot: { id: string | null; name: string | null },
  ): Promise<Line> {
    const [found] = await tx
      .select()
      .from(L)
      .where(
        and(
          eq(L.countId, count.id),
          eq(L.productId, product.id),
          eq(L.locationId, locationId),
          lot.id ? eq(L.lotId, lot.id) : isNull(L.lotId),
          lot.id || !lot.name ? isNull(L.lotName) : eq(L.lotName, lot.name),
        ),
      );
    if (found) return found;
    const [quant] = await tx
      .select({ quantity: sql<string>`coalesce(sum(${schema.stockQuants.quantity}), 0)::text` })
      .from(schema.stockQuants)
      .where(
        and(
          eq(schema.stockQuants.locationId, locationId),
          eq(schema.stockQuants.productId, product.id),
          lot.id ? eq(schema.stockQuants.lotId, lot.id) : isNull(schema.stockQuants.lotId),
        ),
      );
    const [row] = await tx
      .insert(L)
      .values({
        countId: count.id,
        productId: product.id,
        locationId,
        lotId: lot.id,
        lotName: lot.id ? null : lot.name,
        systemQty: lot.id || !lot.name ? d(quant?.quantity).toFixed(4) : "0.0000",
        unitCost: await this.stock.currentCost(tx, count.companyId, product),
      })
      .returning();
    return row!;
  }

  private async productFor(tx: Db, companyId: string, productId: string) {
    const [product] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, productId), or(isNull(P.companyId), eq(P.companyId, companyId))));
    if (!product || product.productType !== "storable")
      throw fieldError("productId", "Produk stok tidak ditemukan");
    return product;
  }

  private async lotByName(tx: Db, companyId: string, productId: string, name: string) {
    const [lot] = await tx
      .select({ id: LOT.id, name: LOT.name })
      .from(LOT)
      .where(and(eq(LOT.companyId, companyId), eq(LOT.productId, productId), eq(LOT.name, name)));
    return lot ?? null;
  }

  /** Tambah baris temuan (produk/lot yang tidak ada di snapshot). */
  async addLine(tx: Db, id: string, body: unknown) {
    const count = await this.find(tx, id, true);
    this.assertCounting(count);
    const input = parse(stockCountAddLineSchema, body);
    const product = await this.productFor(tx, count.companyId, input.productId);
    if (product.tracking !== "none" && !input.lotName)
      throw fieldError("lotName", "Produk ini wajib lot/serial");
    if (product.tracking === "serial" && d(input.countedQty).gt(1))
      throw fieldError("countedQty", "Nomor serial hanya boleh berjumlah 0 atau 1");
    const locationId = await this.countLocation(tx, count, input.locationId);
    const lot =
      product.tracking !== "none" && input.lotName
        ? ((await this.lotByName(tx, count.companyId, product.id, input.lotName)) ?? {
            id: null,
            name: input.lotName,
          })
        : { id: null, name: null };
    const line = await this.lineFor(tx, count, product, locationId, lot);
    await tx
      .update(L)
      .set({
        countedQty: d(input.countedQty).toFixed(4),
        countedBy: currentContext().userId,
        countedAt: sql`now()`,
      })
      .where(eq(L.id, line.id));
    return this.detail(tx, id);
  }

  /** Scan barcode (produk/SKU/lot): tambah hitungan baris terkait. */
  async scan(tx: Db, id: string, body: unknown) {
    const count = await this.find(tx, id, true);
    this.assertCounting(count);
    const input = parse(stockCountScanSchema, body);
    const hit = await lookupBarcode(tx, count.companyId, input.code);
    if (!hit) throw fieldError("code", `Barcode "${input.code}" tidak dikenali`);
    if (hit.product.productType !== "storable") throw fieldError("code", "Produk ini bukan produk stok");
    if (hit.product.tracking !== "none" && !hit.lot)
      throw fieldError("code", "Produk ini ber-lot/serial: scan nomor lot/serialnya");
    const locationId = await this.countLocation(tx, count, input.locationId);
    const line = await this.lineFor(tx, count, hit.product, locationId, {
      id: hit.lot?.id ?? null,
      name: hit.lot?.name ?? null,
    });
    const next = hit.product.tracking === "serial" ? d(1) : d(line.countedQty ?? 0).plus(d(input.quantity));
    await tx
      .update(L)
      .set({ countedQty: next.toFixed(4), countedBy: currentContext().userId, countedAt: sql`now()` })
      .where(eq(L.id, line.id));
    return {
      lineId: line.id,
      product: { id: hit.product.id, sku: hit.product.sku, name: hit.product.name },
      lot: hit.lot,
      countedQty: next.toFixed(4),
    };
  }

  async removeLine(tx: Db, id: string, lineId: string) {
    const count = await this.find(tx, id, true);
    this.assertCounting(count);
    const [line] = await tx
      .select()
      .from(L)
      .where(and(eq(L.id, lineId), eq(L.countId, id)));
    if (!line) throw new NotFoundException("Baris hitung tidak ditemukan");
    if (!d(line.systemQty).isZero())
      throw new BadRequestException(
        "Baris dari stok sistem tidak bisa dihapus; isi hitungan 0 bila barang tidak ada",
      );
    await tx.delete(L).where(eq(L.id, lineId));
    return this.detail(tx, id);
  }

  async rows(tx: Db, id: string) {
    return tx
      .select({
        line: L,
        sku: P.sku,
        barcode: P.barcode,
        productName: P.name,
        tracking: P.tracking,
        locationName: LOC.completeName,
        lotName: LOT.name,
      })
      .from(L)
      .innerJoin(P, eq(P.id, L.productId))
      .innerJoin(LOC, eq(LOC.id, L.locationId))
      .leftJoin(LOT, eq(LOT.id, L.lotId))
      .where(eq(L.countId, id))
      .orderBy(asc(LOC.completeName), asc(P.sku), asc(LOT.name));
  }

  async detail(tx: Db, id: string) {
    const count = await this.find(tx, id);
    const rows = await this.rows(tx, id);
    const [extra] = await tx
      .select({
        warehouseName: schema.warehouses.name,
        locationName: LOC.completeName,
        categoryName: schema.productCategories.name,
      })
      .from(C)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, C.warehouseId))
      .innerJoin(LOC, eq(LOC.id, C.locationId))
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, C.categoryId))
      .where(eq(C.id, id));
    let approval = null;
    if (count.approvalRequestId) {
      const [req] = await tx
        .select({ id: REQ.id, number: REQ.number, state: REQ.state })
        .from(REQ)
        .where(eq(REQ.id, count.approvalRequestId));
      approval = req ?? null;
    }
    const lines = rows.map((r) => {
      const v = lineVariance(r.line);
      return {
        ...r.line,
        sku: r.sku,
        barcode: r.barcode,
        productName: r.productName,
        tracking: r.tracking,
        locationName: r.locationName,
        lotName: r.lotName ?? r.line.lotName,
        newLot: !r.line.lotId && !!r.line.lotName,
        varianceQty: v.qty,
        varianceValue: v.value,
      };
    });
    return { ...count, ...extra, approval, summary: countSummary(rows.map((r) => r.line)), lines };
  }

  async list(tx: Db) {
    const companyId = currentContext().companyId;
    const rows = await tx
      .select({ c: C, warehouseName: schema.warehouses.name, locationName: LOC.completeName })
      .from(C)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, C.warehouseId))
      .innerJoin(LOC, eq(LOC.id, C.locationId))
      .where(eq(C.companyId, companyId))
      .orderBy(desc(C.date), desc(C.createdAt))
      .limit(1000);
    const out = [];
    for (const r of rows) {
      const c = await this.sync(tx, r.c);
      const lines = await tx
        .select({ systemQty: L.systemQty, countedQty: L.countedQty, unitCost: L.unitCost })
        .from(L)
        .where(eq(L.countId, c.id));
      out.push({
        ...c,
        warehouseName: r.warehouseName,
        locationName: r.locationName,
        summary: countSummary(lines),
      });
    }
    return out;
  }

  /** Ajukan selisih: tanpa selisih langsung siap posting; dengan selisih lewat mesin persetujuan. */
  async submit(tx: Db, id: string, body: unknown) {
    const count = await this.find(tx, id, true);
    this.assertCounting(count);
    const input = parse(stockCountSubmitSchema, body ?? {});
    let detail = await this.detail(tx, id);
    if (detail.summary.uncounted) {
      if (!input.uncountedAsZero)
        throw new BadRequestException(
          `Masih ada ${detail.summary.uncounted} baris yang belum dihitung; isi atau anggap nol`,
        );
      await tx
        .update(L)
        .set({ countedQty: "0", countedBy: currentContext().userId, countedAt: sql`now()` })
        .where(and(eq(L.countId, id), isNull(L.countedQty)));
      detail = await this.detail(tx, id);
    }
    if (!detail.summary.withVariance) {
      await tx
        .update(C)
        .set({ state: "approved", updatedAt: sql`now()` })
        .where(eq(C.id, id));
      return this.detail(tx, id);
    }
    const categoryId = await this.category(tx, count.companyId);
    const top = detail.lines
      .filter((l) => !d(l.varianceQty).isZero())
      .sort((a, b) => d(b.varianceValue).abs().comparedTo(d(a.varianceValue).abs()))
      .slice(0, 30);
    const request = await this.approvals.createRequest(tx, {
      categoryId,
      subject: `Selisih stock opname ${count.name} — ${detail.warehouseName}`,
      reference: count.name,
      location: detail.locationName ?? null,
      contact: null,
      date: count.date,
      quantity: String(detail.summary.withVariance),
      amount: detail.summary.absValue,
      description: [
        `${detail.summary.withVariance} dari ${detail.summary.lines} baris berselisih. Lebih ${detail.summary.gainValue}, kurang ${detail.summary.lossValue}, bersih ${detail.summary.netValue}.`,
        ...top.map(
          (l) =>
            `- ${l.sku} ${l.productName}${l.lotName ? ` (${l.lotName})` : ""} @ ${l.locationName}: sistem ${d(l.systemQty).toString()}, hitung ${d(l.countedQty).toString()}, selisih ${d(l.varianceQty).toString()} (${l.varianceValue})`,
        ),
      ]
        .join("\n")
        .slice(0, 5000),
    });
    await this.approvals.submit(tx, request.id);
    await tx
      .update(C)
      .set({ state: "in_approval", approvalRequestId: request.id, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.activity.log(tx, {
      resModel: "stock_count",
      resId: id,
      action: "update",
      message: `Selisih diajukan (${detail.summary.withVariance} baris, nilai ${detail.summary.absValue})`,
    });
    return this.detail(tx, id);
  }

  /** Posting: stok tiap baris diset ke hasil hitung lewat penyesuaian persediaan (jurnal selisih otomatis). */
  async post(tx: Db, id: string) {
    const count = await this.find(tx, id, true);
    if (count.state !== "approved") throw new BadRequestException("Selisih opname belum disetujui");
    const rows = await this.rows(tx, id);
    const byLocation = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.line.countedQty == null) continue;
      byLocation.set(r.line.locationId, [...(byLocation.get(r.line.locationId) ?? []), r]);
    }
    let moves = 0;
    for (const [locationId, list] of byLocation) {
      const res = await this.stock.adjust(tx, {
        locationId,
        date: count.date,
        reason: `Stock opname ${count.name}`,
        lines: list.map((r) => ({
          productId: r.line.productId,
          ...(r.line.lotId ? { lotId: r.line.lotId } : r.line.lotName ? { lotName: r.line.lotName } : {}),
          countedQty: d(r.line.countedQty).toFixed(4),
          unitCost: d(r.line.unitCost).gt(0) ? d(r.line.unitCost).toFixed(4) : null,
        })),
      });
      moves += res.moves;
    }
    await tx
      .update(C)
      .set({ state: "done", postedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.activity.log(tx, {
      resModel: "stock_count",
      resId: id,
      action: "update",
      message: `Diposting: ${moves} penyesuaian stok`,
    });
    return { ...(await this.detail(tx, id)), adjustments: moves };
  }

  async cancel(tx: Db, id: string) {
    const count = await this.find(tx, id, true);
    if (count.state === "done" || count.state === "cancel")
      throw new BadRequestException("Sesi yang sudah diposting atau dibatalkan tidak bisa dibatalkan");
    if (count.state === "in_approval" && count.approvalRequestId) {
      const [req] = await tx
        .select({ state: REQ.state })
        .from(REQ)
        .where(eq(REQ.id, count.approvalRequestId));
      if (req && (req.state === "draft" || req.state === "submitted"))
        await this.approvals.cancel(tx, count.approvalRequestId);
    }
    await tx
      .update(C)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(C.id, id));
    return this.detail(tx, id);
  }

  /** Kembali ke tahap hitung (mis. setelah disetujui tetapi perlu hitung ulang). */
  async recount(tx: Db, id: string) {
    const count = await this.find(tx, id, true);
    if (count.state !== "approved")
      throw new BadRequestException("Hanya sesi yang disetujui yang bisa dihitung ulang");
    await tx
      .update(C)
      .set({ state: "counting", approvalRequestId: null, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    return this.detail(tx, id);
  }

  async remove(tx: Db, id: string) {
    const count = await this.find(tx, id, true);
    if (count.state !== "draft" && count.state !== "cancel")
      throw new BadRequestException("Hanya sesi draft atau batal yang bisa dihapus");
    await tx.delete(C).where(eq(C.id, id));
  }

  /** Lembar hitung Excel (untuk diisi di gudang lalu diimpor). */
  async sheet(tx: Db, id: string) {
    const detail = await this.detail(tx, id);
    return toXlsxBook([
      {
        name: detail.name,
        columns: COUNT_SHEET_COLUMNS.map((key) => ({
          key,
          width: key === "Produk" || key === "Lokasi" ? 32 : key === "Baris" ? 38 : 14,
          numeric: key === "Sistem" || key === "Hitung",
        })),
        rows: detail.lines.map((l) => ({
          Baris: l.id,
          SKU: l.sku,
          Barcode: l.barcode ?? "",
          Produk: l.productName,
          Lokasi: l.locationName,
          "Lot/Serial": l.lotName ?? "",
          Sistem: l.systemQty,
          Hitung: l.countedQty ?? "",
        })),
      },
    ]);
  }

  /** Impor hasil hitung (Excel/CSV): per id baris, atau SKU/barcode + lot (baris baru bila belum ada). */
  async importSheet(tx: Db, id: string, body: unknown) {
    const count = await this.find(tx, id, true);
    this.assertCounting(count);
    const input = parse(
      z
        .object({ csv: z.string().max(5_000_000).optional(), xlsx: z.string().max(10_000_000).optional() })
        .refine((v) => v.csv || v.xlsx, "Lampirkan berkas CSV atau Excel"),
      body,
    );
    let raw: Record<string, string>[];
    try {
      raw = input.xlsx ? await parseXlsx(input.xlsx) : parseCsv(input.csv!);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const lines = await tx.select().from(L).where(eq(L.countId, id));
    const errors: { row: number; message: string }[] = [];
    let updated = 0;
    for (const [i, r] of raw.entries()) {
      const row = parseCountSheetRow(r);
      if (row.countedQty == null) continue;
      if (!/^\d+(\.\d{1,4})?$/.test(row.countedQty)) {
        errors.push({ row: i + 2, message: "Hitung tidak valid" });
        continue;
      }
      let line = row.lineId ? lines.find((l) => l.id === row.lineId) : undefined;
      if (!line) {
        if (!row.code) {
          errors.push({ row: i + 2, message: "Isi kolom Baris atau SKU/Barcode" });
          continue;
        }
        const hit = await lookupBarcode(tx, count.companyId, row.lotName ?? row.code);
        const product =
          hit && (!row.lotName || hit.lot)
            ? hit.product
            : (await lookupBarcode(tx, count.companyId, row.code))?.product;
        if (!product || product.productType !== "storable") {
          errors.push({ row: i + 2, message: `Produk "${row.code}" tidak ditemukan` });
          continue;
        }
        if (product.tracking !== "none" && !row.lotName) {
          errors.push({ row: i + 2, message: `${product.sku}: isi Lot/Serial` });
          continue;
        }
        const lot = row.lotName
          ? ((await this.lotByName(tx, count.companyId, product.id, row.lotName)) ?? {
              id: null,
              name: row.lotName,
            })
          : { id: null, name: null };
        line = await this.lineFor(tx, count, product, count.locationId, lot);
        lines.push(line);
      }
      const tracking = (await this.trackingOf(tx, [line.productId])).get(line.productId);
      if (tracking === "serial" && d(row.countedQty).gt(1)) {
        errors.push({ row: i + 2, message: "Nomor serial hanya boleh berjumlah 0 atau 1" });
        continue;
      }
      await tx
        .update(L)
        .set({
          countedQty: d(row.countedQty).toFixed(4),
          countedBy: currentContext().userId,
          countedAt: sql`now()`,
        })
        .where(eq(L.id, line.id));
      updated++;
    }
    return { updated, errors, count: await this.detail(tx, id) };
  }

  private async category(tx: Db, companyId: string) {
    const [found] = await tx
      .select({ id: CAT.id })
      .from(CAT)
      .where(and(eq(CAT.companyId, companyId), eq(CAT.code, CATEGORY.code)));
    if (found) return found.id;
    await this.approvals.ensureDefaults(tx, companyId);
    const [again] = await tx
      .select({ id: CAT.id })
      .from(CAT)
      .where(and(eq(CAT.companyId, companyId), eq(CAT.code, CATEGORY.code)));
    if (again) return again.id;
    const [created] = await tx
      .insert(CAT)
      .values({ ...CATEGORY, companyId, managerFirst: false, sequence: 930 })
      .returning({ id: CAT.id });
    return created!.id;
  }

  // ---- Barcode & lacak lot/serial ----

  async lookup(tx: Db, code: string) {
    const hit = await lookupBarcode(tx, currentContext().companyId, code);
    if (!hit) throw new NotFoundException(`Barcode "${code}" tidak dikenali`);
    return {
      product: {
        id: hit.product.id,
        sku: hit.product.sku,
        name: hit.product.name,
        barcode: hit.product.barcode,
        tracking: hit.product.tracking,
        productType: hit.product.productType,
      },
      lot: hit.lot,
    };
  }

  async labels(tx: Db, query: { productIds?: string; lotIds?: string; copies?: string }) {
    const companyId = currentContext().companyId;
    const ids = (v?: string) => (v ? v.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : []);
    const copies = Math.min(Math.max(Number(query.copies) || 1, 1), 100);
    const labels: Label[] = [];
    const productIds = ids(query.productIds);
    if (productIds.length) {
      const products = await tx
        .select()
        .from(P)
        .where(and(inArray(P.id, productIds), or(isNull(P.companyId), eq(P.companyId, companyId))));
      for (const p of products)
        for (let i = 0; i < copies; i++)
          labels.push({ title: p.name, subtitle: p.sku, code: p.barcode || p.sku });
    }
    const lotIds = ids(query.lotIds);
    if (lotIds.length) {
      const lots = await tx
        .select({ lot: LOT, sku: P.sku, name: P.name })
        .from(LOT)
        .innerJoin(P, eq(P.id, LOT.productId))
        .where(and(inArray(LOT.id, lotIds), eq(LOT.companyId, companyId)));
      for (const l of lots)
        for (let i = 0; i < copies; i++)
          labels.push({
            title: l.name,
            subtitle: `${l.sku}${l.lot.expirationDate ? ` · ED ${l.lot.expirationDate}` : ""}`,
            code: l.lot.name,
          });
    }
    if (!labels.length) throw new BadRequestException("Pilih produk atau lot untuk dicetak labelnya");
    return renderLabelsPdf(labels);
  }

  /** Riwayat nomor lot/serial: penerimaan, perpindahan, pengiriman (mitra & dokumen), dan posisi stok sekarang. */
  async trace(tx: Db, lotId: string) {
    const companyId = currentContext().companyId;
    const [lot] = await tx
      .select({ lot: LOT, sku: P.sku, productName: P.name, tracking: P.tracking })
      .from(LOT)
      .innerJoin(P, eq(P.id, LOT.productId))
      .where(and(eq(LOT.id, lotId), eq(LOT.companyId, companyId)));
    if (!lot) throw new NotFoundException("Lot tidak ditemukan");
    const SRC = schema.stockLocations;
    const moves = await tx.execute<{
      id: string;
      date: string | null;
      quantity: string;
      reference: string | null;
      picking_id: string | null;
      picking_name: string | null;
      picking_type: string | null;
      partner_name: string | null;
      origin: string | null;
      from_name: string;
      from_usage: string;
      to_name: string;
      to_usage: string;
      is_inventory: boolean;
    }>(sql`
      select m.id, coalesce(m.date, m.created_at) as date, ml.quantity, m.reference, p.id as picking_id,
        p.name as picking_name, p.picking_type, pa.name as partner_name, p.origin,
        f.complete_name as from_name, f.usage as from_usage, t.complete_name as to_name, t.usage as to_usage,
        m.is_inventory
      from stock_move_lines ml
      join stock_moves m on m.id = ml.move_id
      join ${SRC} f on f.id = m.location_id
      join ${SRC} t on t.id = m.location_dest_id
      left join stock_pickings p on p.id = m.picking_id
      left join partners pa on pa.id = p.partner_id
      where ml.lot_id = ${lotId} and m.state = 'done'
      order by coalesce(m.date, m.created_at), m.created_at`);
    const quants = await tx
      .select({ locationName: LOC.completeName, quantity: schema.stockQuants.quantity })
      .from(schema.stockQuants)
      .innerJoin(LOC, eq(LOC.id, schema.stockQuants.locationId))
      .where(
        and(
          eq(schema.stockQuants.lotId, lotId),
          eq(LOC.usage, "internal"),
          sql`${schema.stockQuants.quantity} <> 0`,
        ),
      );
    return {
      ...lot.lot,
      sku: lot.sku,
      productName: lot.productName,
      tracking: lot.tracking,
      onHand: quants.reduce((s, q) => s.plus(q.quantity), new Decimal(0)).toFixed(4),
      locations: quants,
      moves: moves.map((m) => ({
        id: m.id,
        date: m.date ? new Date(m.date).toISOString().slice(0, 10) : null,
        quantity: m.quantity,
        reference: m.reference,
        pickingId: m.picking_id,
        pickingName: m.picking_name,
        pickingType: m.picking_type,
        partnerName: m.partner_name,
        origin: m.origin,
        from: m.from_name,
        fromUsage: m.from_usage,
        to: m.to_name,
        toUsage: m.to_usage,
        isInventory: m.is_inventory,
      })),
    };
  }
}

/** Cari produk/lot dari kode barcode: barcode produk, SKU (tanpa beda huruf), lalu nomor lot/serial. */
export async function lookupBarcode(tx: Db, companyId: string, code: string) {
  const own = or(isNull(P.companyId), eq(P.companyId, companyId));
  const [byBarcode] = await tx
    .select()
    .from(P)
    .where(and(eq(P.barcode, code), own, eq(P.active, true)))
    .limit(1);
  if (byBarcode) return { product: byBarcode, lot: null };
  const [bySku] = await tx
    .select()
    .from(P)
    .where(
      and(
        ilike(
          P.sku,
          code.replace(/[%_\\]/g, (c) => `\\${c}`),
        ),
        own,
        eq(P.active, true),
      ),
    )
    .limit(1);
  if (bySku) return { product: bySku, lot: null };
  const [byLot] = await tx
    .select({ lot: LOT, product: P })
    .from(LOT)
    .innerJoin(P, eq(P.id, LOT.productId))
    .where(and(eq(LOT.companyId, companyId), eq(LOT.name, code)))
    .limit(1);
  if (byLot) return { product: byLot.product, lot: { id: byLot.lot.id, name: byLot.lot.name } };
  return null;
}

@Controller()
export class StockCountController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(StockCountService) private readonly service: StockCountService,
  ) {}

  @Get("stock-counts")
  @RequirePermission("inventory.read")
  list() {
    return this.tenantDb.run((tx) => this.service.list(tx));
  }

  @Post("stock-counts")
  @RequirePermission("inventory.manage")
  create(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.create(tx, body));
  }

  @Get("stock-counts/:id")
  @RequirePermission("inventory.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.detail(tx, id));
  }

  @Delete("stock-counts/:id")
  @HttpCode(204)
  @RequirePermission("inventory.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.remove(tx, id));
  }

  @Post("stock-counts/:id/start")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  start(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.start(tx, id));
  }

  @Put("stock-counts/:id/lines")
  @RequirePermission("inventory.write")
  setLines(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.setLines(tx, id, body));
  }

  @Post("stock-counts/:id/lines")
  @RequirePermission("inventory.write")
  addLine(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.addLine(tx, id, body));
  }

  @Delete("stock-counts/:id/lines/:lineId")
  @RequirePermission("inventory.write")
  removeLine(@Param("id", ParseUUIDPipe) id: string, @Param("lineId", ParseUUIDPipe) lineId: string) {
    return this.tenantDb.run((tx) => this.service.removeLine(tx, id, lineId));
  }

  @Post("stock-counts/:id/scan")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  scan(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.scan(tx, id, body));
  }

  @Get("stock-counts/:id/sheet")
  @RequirePermission("inventory.read")
  async sheet(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.service.sheet(tx, id));
    res
      .setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .setHeader("Content-Disposition", `attachment; filename="lembar-opname.xlsx"`)
      .send(file);
  }

  @Post("stock-counts/:id/import")
  @HttpCode(200)
  @RequirePermission("inventory.write")
  importSheet(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.importSheet(tx, id, body));
  }

  @Post("stock-counts/:id/submit")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  submit(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.submit(tx, id, body));
  }

  @Post("stock-counts/:id/post")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  post(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.post(tx, id));
  }

  @Post("stock-counts/:id/recount")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  recount(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.recount(tx, id));
  }

  @Post("stock-counts/:id/cancel")
  @HttpCode(200)
  @RequirePermission("inventory.manage")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.cancel(tx, id));
  }

  @Get("barcode/lookup")
  @RequirePermission("inventory.read")
  lookup(@Query("code") code?: string) {
    const input = parse(z.string().trim().min(1).max(100), code);
    return this.tenantDb.run((tx) => this.service.lookup(tx, input));
  }

  @Get("barcode/labels")
  @RequirePermission("inventory.read")
  async labels(
    @Query() query: { productIds?: string; lotIds?: string; copies?: string },
    @Res() res: Response,
  ) {
    const pdf = await this.tenantDb.run((tx) => this.service.labels(tx, query));
    res
      .setHeader("Content-Type", "application/pdf")
      .setHeader("Content-Disposition", `inline; filename="label-barcode.pdf"`)
      .send(pdf);
  }

  @Get("stock-lots/:id/trace")
  @RequirePermission("inventory.read")
  trace(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.trace(tx, id));
  }
}

@Module({
  imports: [AccountingModule, InventoryModule, HrModule],
  controllers: [StockCountController],
  providers: [StockCountService, SequenceService, ActivityService],
})
export class StockCountModule {}
