import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, schema, sql, type Db } from "@erp/db";
import {
  averageAfterIn,
  fifoConsume,
  type pickingSchema,
  type returnPickingSchema,
  type stockAdjustmentSchema,
  type validatePickingSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertPartner, fieldError, loadBooks } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { currentContext } from "../common/request-context.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { virtualLocation } from "./setup.js";
import { assertNotTemplate } from "../master/variant.service.js";

type Picking = typeof schema.stockPickings.$inferSelect;
type Move = typeof schema.stockMoves.$inferSelect;
type Product = typeof schema.products.$inferSelect;
type Location = typeof schema.stockLocations.$inferSelect;
type PickingType = Picking["pickingType"];
export type PickingInput = z.infer<typeof pickingSchema>;
export type ValidateInput = z.infer<typeof validatePickingSchema>;
type LotInput = NonNullable<NonNullable<ValidateInput["moves"]>[number]["lots"]>[number];

const d = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const PREFIX: Record<PickingType, string> = {
  incoming: "IN",
  outgoing: "OUT",
  internal: "INT",
  dropship: "DS",
};

/** Data pergerakan baru (untuk transfer dari penjualan/pembelian/retur). */
export interface NewMove {
  productId: string;
  name?: string;
  quantity: string;
  priceUnit?: string | null;
  saleLineId?: string | null;
  purchaseLineId?: string | null;
  originReturnMoveId?: string | null;
}

/** Dokumen yang dibuat otomatis oleh kait validasi (mis. nota kredit retur). */
export interface LinkedDocument {
  model: "account_move";
  id: string;
  moveType: "out_refund" | "in_refund";
  label: string;
}
/** Dipanggil setelah transfer divalidasi, dalam transaksi yang sama. */
export type ValidateHook = (tx: Db, picking: Picking) => Promise<LinkedDocument | null>;

/** Pergerakan yang siap diterapkan beserta rincian lot. */
interface DoneMove {
  move: Move;
  product: Product;
  lots: { lotId: string; quantity: Decimal }[];
}

@Injectable()
export class StockService {
  /** Kait pasca-validasi transfer (didaftarkan modul penjualan/pembelian). */
  readonly validateHooks: ValidateHook[] = [];

  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  // ---- Membuat transfer ----

  /** Lokasi asal & tujuan bawaan menurut jenis transfer. */
  async defaultLocations(tx: Db, companyId: string, type: PickingType, warehouseId: string) {
    const wh = await this.warehouse(tx, warehouseId, companyId);
    if (type === "incoming")
      return {
        locationId: (await virtualLocation(tx, companyId, "supplier")).id,
        locationDestId: wh.lotStockId,
      };
    if (type === "outgoing")
      return {
        locationId: wh.lotStockId,
        locationDestId: (await virtualLocation(tx, companyId, "customer")).id,
      };
    if (type === "dropship")
      return {
        locationId: (await virtualLocation(tx, companyId, "supplier")).id,
        locationDestId: (await virtualLocation(tx, companyId, "customer")).id,
      };
    return { locationId: wh.lotStockId, locationDestId: wh.lotStockId };
  }

  /** Buat transfer beserta pergerakannya. Produk jasa diabaikan (tidak punya stok). */
  async createPicking(
    tx: Db,
    input: {
      companyId: string;
      pickingType: PickingType;
      warehouseId: string;
      partnerId?: string | null;
      locationId?: string;
      locationDestId?: string;
      scheduledDate: string;
      origin?: string | null;
      note?: string | null;
      saleOrderId?: string | null;
      purchaseOrderId?: string | null;
      returnOfId?: string | null;
      backorderOfId?: string | null;
      state?: "draft" | "ready";
      moves: NewMove[];
    },
  ): Promise<Picking | null> {
    const wh = await this.warehouse(tx, input.warehouseId, input.companyId);
    const defaults = await this.defaultLocations(tx, input.companyId, input.pickingType, wh.id);
    const locationId = input.locationId ?? defaults.locationId;
    const locationDestId = input.locationDestId ?? defaults.locationDestId;
    const [src, dest] = await Promise.all([
      this.location(tx, locationId, input.companyId),
      this.location(tx, locationDestId, input.companyId),
    ]);
    if (src.usage === "view" || dest.usage === "view")
      throw fieldError("locationId", "Lokasi induk (view) tidak bisa menyimpan stok");
    if (input.pickingType === "internal" && (src.usage !== "internal" || dest.usage !== "internal"))
      throw fieldError("locationDestId", "Transfer internal harus antar lokasi internal");
    if (src.id === dest.id) throw fieldError("locationDestId", "Lokasi asal dan tujuan sama");

    const productIds = [...new Set(input.moves.map((m) => m.productId))];
    const products = productIds.length
      ? await tx.select().from(schema.products).where(inArray(schema.products.id, productIds))
      : [];
    const stockable = input.moves.filter((m) => {
      const p = products.find((x) => x.id === m.productId);
      if (!p || (p.companyId && p.companyId !== input.companyId))
        throw fieldError("moves", "Produk tidak ditemukan");
      assertNotTemplate(p, "moves");
      return p.productType !== "service" && d(m.quantity).gt(0);
    });
    if (!stockable.length) return null;

    const name = await this.sequences.next(
      tx,
      `stock.${input.pickingType}.${wh.code}`,
      input.companyId,
      new Date(`${input.scheduledDate}T00:00:00Z`),
      `${wh.code}/${PREFIX[input.pickingType]}`,
    );
    const state = input.state ?? "ready";
    const [picking] = await tx
      .insert(schema.stockPickings)
      .values({
        companyId: input.companyId,
        name,
        pickingType: input.pickingType,
        state,
        warehouseId: wh.id,
        partnerId: input.partnerId ?? null,
        locationId,
        locationDestId,
        scheduledDate: input.scheduledDate,
        origin: input.origin ?? null,
        note: input.note ?? null,
        saleOrderId: input.saleOrderId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        returnOfId: input.returnOfId ?? null,
        backorderOfId: input.backorderOfId ?? null,
        createdBy: currentContext().userId,
      })
      .returning();
    await tx.insert(schema.stockMoves).values(
      stockable.map((m) => ({
        companyId: input.companyId,
        pickingId: picking!.id,
        productId: m.productId,
        name: m.name || products.find((p) => p.id === m.productId)!.name,
        quantity: d(m.quantity).toFixed(4),
        locationId,
        locationDestId,
        state,
        priceUnit: m.priceUnit ?? null,
        saleLineId: m.saleLineId ?? null,
        purchaseLineId: m.purchaseLineId ?? null,
        originReturnMoveId: m.originReturnMoveId ?? null,
        reference: name,
      })),
    );
    if (state === "ready") await this.reserve(tx, picking!.id);
    await this.activity.log(tx, { resModel: "stock_picking", resId: picking!.id, action: "create" });
    return picking!;
  }

  /** Transfer manual dari form. */
  async createManual(tx: Db, input: PickingInput) {
    const companyId = currentContext().companyId;
    const warehouseId = input.warehouseId ?? (await this.defaultWarehouse(tx, companyId)).id;
    if (input.partnerId) await assertPartner(tx, companyId, input.partnerId);
    const picking = await this.createPicking(tx, {
      companyId,
      pickingType: input.pickingType,
      warehouseId,
      partnerId: input.partnerId,
      locationId: input.locationId,
      locationDestId: input.locationDestId,
      scheduledDate: input.scheduledDate,
      origin: input.origin,
      note: input.note,
      state: "draft",
      moves: input.moves,
    });
    if (!picking) throw fieldError("moves", "Produk jasa tidak memiliki stok");
    return picking;
  }

  /** Ganti isi transfer draft. */
  async updateDraft(tx: Db, id: string, input: PickingInput) {
    const picking = await this.lockPicking(tx, id);
    if (picking.state !== "draft") throw new BadRequestException("Hanya transfer draft yang bisa diubah");
    if (picking.saleOrderId || picking.purchaseOrderId || picking.pickingType === "dropship")
      throw new BadRequestException("Transfer dari pesanan diubah lewat pesanannya");
    await tx.delete(schema.stockPickings).where(eq(schema.stockPickings.id, id));
    // Nomor lama dipertahankan agar tidak terjadi celah penomoran.
    const created = await this.createManual(tx, { ...input, pickingType: picking.pickingType });
    await tx
      .update(schema.stockPickings)
      .set({ name: picking.name })
      .where(eq(schema.stockPickings.id, created.id));
    await tx
      .update(schema.stockMoves)
      .set({ reference: picking.name })
      .where(eq(schema.stockMoves.pickingId, created.id));
    return created.id;
  }

  async confirm(tx: Db, id: string) {
    const picking = await this.lockPicking(tx, id);
    if (picking.state !== "draft")
      throw new BadRequestException("Hanya transfer draft yang bisa dikonfirmasi");
    await tx
      .update(schema.stockPickings)
      .set({ state: "ready", updatedAt: sql`now()` })
      .where(eq(schema.stockPickings.id, id));
    await tx
      .update(schema.stockMoves)
      .set({ state: "ready" })
      .where(and(eq(schema.stockMoves.pickingId, id), ne(schema.stockMoves.state, "cancel")));
    await this.reserve(tx, id);
  }

  // ---- Reservasi ----

  /**
   * Cadangkan stok untuk pergerakan siap dari lokasi internal (barang stok): sebanyak kebutuhan, dibatasi stok
   * lokasi asal yang belum dicadangkan pergerakan lain. Transfer lain tidak bisa memakai stok yang sudah dicadangkan.
   */
  async reserve(tx: Db, pickingId: string) {
    const rows = await tx
      .select({ move: schema.stockMoves, productType: schema.products.productType })
      .from(schema.stockMoves)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockMoves.productId))
      .innerJoin(schema.stockLocations, eq(schema.stockLocations.id, schema.stockMoves.locationId))
      .where(
        and(
          eq(schema.stockMoves.pickingId, pickingId),
          eq(schema.stockMoves.state, "ready"),
          eq(schema.stockLocations.usage, "internal"),
        ),
      )
      .orderBy(asc(schema.stockMoves.createdAt));
    for (const { move, productType } of rows) {
      if (productType !== "storable") continue;
      const free = await this.freeQty(tx, move.locationId, move.productId, [move.id]);
      const reserved = Decimal.max(0, Decimal.min(move.quantity, free));
      if (!reserved.equals(move.quantityReserved))
        await tx
          .update(schema.stockMoves)
          .set({ quantityReserved: reserved.toFixed(4) })
          .where(eq(schema.stockMoves.id, move.id));
    }
  }

  /** Lepas cadangan transfer (stoknya bisa dipakai transfer lain). */
  async unreserve(tx: Db, pickingId: string) {
    const picking = await this.lockPicking(tx, pickingId);
    if (picking.state !== "ready") throw new BadRequestException("Hanya transfer siap yang punya cadangan");
    await tx
      .update(schema.stockMoves)
      .set({ quantityReserved: "0" })
      .where(and(eq(schema.stockMoves.pickingId, pickingId), eq(schema.stockMoves.state, "ready")));
  }

  /** Stok lokasi yang belum dicadangkan pergerakan siap lain (selain `exclude`). */
  private async freeQty(tx: Db, locationId: string, productId: string, exclude: string[]) {
    const [onHand] = await tx
      .select({ qty: sql<string>`coalesce(sum(${schema.stockQuants.quantity}), 0)` })
      .from(schema.stockQuants)
      .where(and(eq(schema.stockQuants.locationId, locationId), eq(schema.stockQuants.productId, productId)));
    const [reserved] = await tx
      .select({ qty: sql<string>`coalesce(sum(${schema.stockMoves.quantityReserved}), 0)` })
      .from(schema.stockMoves)
      .where(
        and(
          eq(schema.stockMoves.locationId, locationId),
          eq(schema.stockMoves.productId, productId),
          eq(schema.stockMoves.state, "ready"),
          exclude.length ? notInArray(schema.stockMoves.id, exclude) : undefined,
        ),
      );
    return d(onHand?.qty ?? 0).minus(reserved?.qty ?? 0);
  }

  /** Setelah stok bertambah: cadangkan ulang transfer yang masih menunggu, urut jadwal. */
  private async reserveWaiting(tx: Db, companyId: string, productIds: string[]) {
    if (!productIds.length) return;
    const waiting = await tx
      .selectDistinct({
        id: schema.stockPickings.id,
        scheduledDate: schema.stockPickings.scheduledDate,
        createdAt: schema.stockPickings.createdAt,
      })
      .from(schema.stockMoves)
      .innerJoin(schema.stockPickings, eq(schema.stockPickings.id, schema.stockMoves.pickingId))
      .where(
        and(
          eq(schema.stockMoves.companyId, companyId),
          eq(schema.stockMoves.state, "ready"),
          inArray(schema.stockMoves.productId, productIds),
          sql`${schema.stockMoves.quantityReserved} < ${schema.stockMoves.quantity}`,
        ),
      )
      .orderBy(asc(schema.stockPickings.scheduledDate), asc(schema.stockPickings.createdAt));
    for (const p of waiting) await this.reserve(tx, p.id);
  }

  async cancel(tx: Db, id: string) {
    const picking = await this.lockPicking(tx, id);
    if (picking.state === "done")
      throw new BadRequestException("Transfer selesai tidak bisa dibatalkan; buat retur");
    await tx
      .update(schema.stockPickings)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(schema.stockPickings.id, id));
    await tx
      .update(schema.stockMoves)
      .set({ state: "cancel", quantityReserved: "0" })
      .where(eq(schema.stockMoves.pickingId, id));
    await this.activity.log(tx, {
      resModel: "stock_picking",
      resId: id,
      action: "update",
      message: "Dibatalkan",
    });
  }

  async remove(tx: Db, id: string) {
    const picking = await this.lockPicking(tx, id);
    if (picking.state !== "draft" && picking.state !== "cancel")
      throw new BadRequestException("Hanya transfer draft/batal yang bisa dihapus");
    if (picking.saleOrderId || picking.purchaseOrderId)
      throw new BadRequestException("Transfer dari pesanan tidak bisa dihapus; batalkan saja");
    await tx.delete(schema.stockPickings).where(eq(schema.stockPickings.id, id));
  }

  // ---- Validasi ----

  /**
   * Validasi transfer: pindahkan kuantitas yang dikerjakan, perbarui stok & valuasi, buat jurnal persediaan.
   * Sisa kuantitas menjadi backorder (atau dibatalkan bila `createBackorder` false).
   */
  async validate(tx: Db, id: string, input: ValidateInput) {
    const picking = await this.lockPicking(tx, id);
    if (picking.state === "draft") await this.confirm(tx, id);
    else if (picking.state !== "ready")
      throw new BadRequestException("Transfer sudah selesai atau dibatalkan");

    const moves = await tx
      .select()
      .from(schema.stockMoves)
      .where(and(eq(schema.stockMoves.pickingId, id), eq(schema.stockMoves.state, "ready")))
      .orderBy(asc(schema.stockMoves.createdAt));
    const products = await this.products(
      tx,
      moves.map((m) => m.productId),
    );
    const given = new Map((input.moves ?? []).map((m) => [m.id, m]));
    for (const moveId of given.keys())
      if (!moves.some((m) => m.id === moveId)) throw fieldError("moves", "Baris transfer tidak ditemukan");

    const done: DoneMove[] = [];
    const remaining: { move: Move; quantity: Decimal }[] = [];
    for (const [i, move] of moves.entries()) {
      const product = products.get(move.productId)!;
      const entry = given.get(move.id);
      // Tanpa rincian: kerjakan seluruh kuantitas (produk ber-lot wajib diisi).
      const qtyDone = entry ? d(entry.quantityDone) : d(move.quantity);
      // Penerimaan/pengiriman boleh melebihi permintaan; retur tidak boleh melebihi barang aslinya.
      if (move.originReturnMoveId && qtyDone.gt(move.quantity))
        throw fieldError(`moves.${i}.quantityDone`, "Retur melebihi kuantitas");
      const lots = qtyDone.gt(0)
        ? await this.resolveLots(tx, picking, move, product, qtyDone, entry?.lots, `moves.${i}`)
        : [];
      if (qtyDone.gt(0)) done.push({ move: { ...move, quantityDone: qtyDone.toFixed(4) }, product, lots });
      if (qtyDone.lt(move.quantity)) remaining.push({ move, quantity: d(move.quantity).minus(qtyDone) });
    }
    if (!done.length) throw new BadRequestException("Isi kuantitas yang dipindahkan minimal satu baris");
    await this.assertNotReservedElsewhere(tx, picking, moves, done);

    const date = input.date ? new Date(`${input.date}T12:00:00Z`) : new Date();
    if (date.getTime() > Date.now() + 86_400_000)
      throw fieldError("date", "Tanggal transfer tidak boleh di masa depan");
    for (const r of remaining) {
      const qtyDone = d(r.move.quantity).minus(r.quantity);
      await tx
        .update(schema.stockMoves)
        .set(qtyDone.gt(0) ? { quantity: qtyDone.toFixed(4) } : { state: "cancel" })
        .where(eq(schema.stockMoves.id, r.move.id));
    }
    const warehouse = await this.warehouse(tx, picking.warehouseId, picking.companyId);
    const accountMoveId = await this.processMoves(tx, picking.companyId, done, {
      ref: picking.name,
      date,
      branchId: warehouse.branchId,
      partnerId: picking.partnerId,
    });
    await tx
      .update(schema.stockPickings)
      .set({ state: "done", dateDone: date, accountMoveId, updatedAt: sql`now()` })
      .where(eq(schema.stockPickings.id, id));

    let backorderId: string | null = null;
    if (remaining.length && input.createBackorder) {
      const backorder = await this.createPicking(tx, {
        companyId: picking.companyId,
        pickingType: picking.pickingType,
        warehouseId: picking.warehouseId,
        partnerId: picking.partnerId,
        locationId: picking.locationId,
        locationDestId: picking.locationDestId,
        scheduledDate: picking.scheduledDate,
        origin: picking.origin,
        saleOrderId: picking.saleOrderId,
        purchaseOrderId: picking.purchaseOrderId,
        returnOfId: picking.returnOfId,
        backorderOfId: picking.id,
        moves: remaining.map((r) => ({
          productId: r.move.productId,
          name: r.move.name,
          quantity: r.quantity.toFixed(4),
          priceUnit: r.move.priceUnit,
          saleLineId: r.move.saleLineId,
          purchaseLineId: r.move.purchaseLineId,
          originReturnMoveId: r.move.originReturnMoveId,
        })),
      });
      backorderId = backorder?.id ?? null;
    }
    await this.activity.log(tx, {
      resModel: "stock_picking",
      resId: id,
      action: "update",
      message: backorderId ? "Divalidasi sebagian; sisa dibuat sebagai backorder" : "Divalidasi",
    });
    // Stok yang baru masuk dicadangkan untuk transfer yang menunggu.
    await this.reserveWaiting(tx, picking.companyId, [...new Set(done.map((x) => x.product.id))]);
    const documents: LinkedDocument[] = [];
    for (const hook of this.validateHooks) {
      const doc = await hook(tx, { ...picking, state: "done" });
      if (doc) documents.push(doc);
    }
    return { backorderId, documents };
  }

  /** Barang keluar dari lokasi internal tidak boleh memakai stok yang dicadangkan transfer lain. */
  private async assertNotReservedElsewhere(tx: Db, picking: Picking, moves: Move[], done: DoneMove[]) {
    const need = new Map<string, { locationId: string; product: Product; qty: Decimal }>();
    for (const { move, product } of done) {
      if (product.productType !== "storable") continue;
      const key = `${move.locationId}/${product.id}`;
      const entry = need.get(key) ?? { locationId: move.locationId, product, qty: d(0) };
      entry.qty = entry.qty.plus(move.quantityDone);
      need.set(key, entry);
    }
    const own = moves.map((m) => m.id);
    for (const { locationId, product, qty } of need.values()) {
      const location = await this.location(tx, locationId, picking.companyId);
      if (location.usage !== "internal") continue;
      const free = await this.freeQty(tx, locationId, product.id, own);
      if (qty.gt(free))
        throw new BadRequestException(
          `Stok ${product.name} di ${location.completeName} tidak cukup: yang belum dicadangkan transfer lain ${Decimal.max(free, 0).toFixed()}, dibutuhkan ${qty.toFixed()}`,
        );
    }
  }

  /** Retur transfer selesai: barang kembali ke lokasi asal, dinilai dengan biaya pergerakan aslinya. */
  async createReturn(tx: Db, id: string, input: z.infer<typeof returnPickingSchema>) {
    const picking = await this.lockPicking(tx, id);
    if (picking.state !== "done") throw new BadRequestException("Hanya transfer selesai yang bisa diretur");
    if (picking.pickingType === "dropship")
      throw new BadRequestException(
        "Dropship diretur lewat nota kredit pelanggan dan retur ke pemasok secara manual",
      );
    if (picking.pickingType === "internal")
      throw new BadRequestException("Transfer internal dikembalikan dengan transfer internal baru");
    const originals = await tx
      .select()
      .from(schema.stockMoves)
      .where(and(eq(schema.stockMoves.pickingId, id), eq(schema.stockMoves.state, "done")));
    const lines: NewMove[] = [];
    for (const [i, line] of input.lines.entries()) {
      const move = originals.find((m) => m.id === line.moveId);
      if (!move) throw fieldError(`lines.${i}.moveId`, "Baris tidak ditemukan pada transfer ini");
      const returned = await this.returnedQty(tx, move.id);
      if (d(line.quantity).gt(d(move.quantityDone).minus(returned)))
        throw fieldError(`lines.${i}.quantity`, "Melebihi kuantitas yang bisa diretur");
      lines.push({
        productId: move.productId,
        name: move.name,
        quantity: line.quantity,
        priceUnit: move.unitCost,
        saleLineId: move.saleLineId,
        purchaseLineId: move.purchaseLineId,
        originReturnMoveId: move.id,
      });
    }
    const ret = await this.createPicking(tx, {
      companyId: picking.companyId,
      pickingType: picking.pickingType === "incoming" ? "outgoing" : "incoming",
      warehouseId: picking.warehouseId,
      partnerId: picking.partnerId,
      locationId: picking.locationDestId,
      locationDestId: picking.locationId,
      scheduledDate: new Date().toISOString().slice(0, 10),
      origin: `Retur ${picking.name}`,
      saleOrderId: picking.saleOrderId,
      purchaseOrderId: picking.purchaseOrderId,
      returnOfId: picking.id,
      moves: lines,
    });
    return ret!;
  }

  /** Kuantitas yang sudah/akan diretur dari sebuah pergerakan (retur yang tidak dibatalkan). */
  async returnedQty(tx: Db, moveId: string) {
    const [row] = await tx
      .select({
        qty: sql<string>`coalesce(sum(case when ${schema.stockMoves.state} = 'done' then ${schema.stockMoves.quantityDone} else ${schema.stockMoves.quantity} end), 0)`,
      })
      .from(schema.stockMoves)
      .where(and(eq(schema.stockMoves.originReturnMoveId, moveId), ne(schema.stockMoves.state, "cancel")));
    return d(row?.qty ?? 0);
  }

  /** Penyesuaian stok (stock opname): selisih hitung fisik vs sistem dibukukan ke akun Selisih Persediaan. */
  async adjust(tx: Db, input: z.infer<typeof stockAdjustmentSchema>) {
    const companyId = currentContext().companyId;
    const location = await this.location(tx, input.locationId, companyId);
    if (location.usage !== "internal") throw fieldError("locationId", "Pilih lokasi stok internal");
    const inventory = await virtualLocation(tx, companyId, "inventory");
    const products = await this.products(
      tx,
      input.lines.map((l) => l.productId),
    );
    const reference = `Penyesuaian${input.reason ? `: ${input.reason}` : ""}`;
    const done: DoneMove[] = [];
    for (const [i, line] of input.lines.entries()) {
      const product = products.get(line.productId);
      if (
        !product ||
        (product.companyId && product.companyId !== companyId) ||
        product.productType === "service"
      )
        throw fieldError(`lines.${i}.productId`, "Produk stok tidak ditemukan");
      let lotId: string | null = null;
      if (product.tracking !== "none") {
        if (!line.lotId && !line.lotName)
          throw fieldError(`lines.${i}.lotName`, "Produk ini wajib lot/serial");
        lotId = line.lotId ?? (await this.findOrCreateLot(tx, companyId, product.id, line.lotName!, null)).id;
        if (product.tracking === "serial" && d(line.countedQty).gt(1))
          throw fieldError(`lines.${i}.countedQty`, "Nomor serial hanya boleh berjumlah 0 atau 1");
      }
      const current = await this.quantOf(tx, location.id, product.id, lotId);
      const diff = d(line.countedQty).minus(current);
      if (diff.isZero()) continue;
      const incoming = diff.gt(0);
      const [move] = await tx
        .insert(schema.stockMoves)
        .values({
          companyId,
          productId: product.id,
          name: reference,
          quantity: diff.abs().toFixed(4),
          quantityDone: diff.abs().toFixed(4),
          locationId: incoming ? inventory.id : location.id,
          locationDestId: incoming ? location.id : inventory.id,
          state: "ready",
          priceUnit: incoming ? (line.unitCost ?? null) : null,
          isInventory: true,
          reference,
        })
        .returning();
      done.push({ move: move!, product, lots: lotId ? [{ lotId, quantity: diff.abs() }] : [] });
    }
    if (!done.length) return { moves: 0 };
    const warehouseBranch = location.warehouseId
      ? (await this.warehouse(tx, location.warehouseId, companyId)).branchId
      : null;
    const date = input.date ? new Date(`${input.date}T12:00:00Z`) : new Date();
    await this.processMoves(tx, companyId, done, {
      ref: reference,
      date,
      branchId: warehouseBranch,
      partnerId: null,
    });
    return { moves: done.length };
  }

  // ---- Inti: stok & valuasi ----

  /**
   * Terapkan pergerakan selesai: quant per lokasi/lot, lapisan valuasi (barang stok yang keluar/masuk lokasi
   * internal), lalu satu jurnal persediaan untuk semuanya. Mengembalikan id jurnal (atau null).
   */
  private async processMoves(
    tx: Db,
    companyId: string,
    done: DoneMove[],
    ctx: { ref: string; date: Date; branchId: string | null; partnerId: string | null },
  ): Promise<string | null> {
    const locations = new Map<string, Location>();
    const loc = async (id: string) => {
      if (!locations.has(id)) locations.set(id, await this.location(tx, id, companyId));
      return locations.get(id)!;
    };
    const books = await loadBooks(tx, companyId);
    const s = books.settings;
    const journalLines: {
      accountId: string;
      debit: Decimal;
      credit: Decimal;
      name: string;
      partnerId: string | null;
    }[] = [];
    const layerIds: string[] = [];

    for (const { move, product, lots } of done) {
      const qty = d(move.quantityDone);
      const src = await loc(move.locationId);
      const dest = await loc(move.locationDestId);
      // Quant: kurangi asal, tambah tujuan (per lot bila ada).
      const parts = lots.length ? lots : [{ lotId: null as string | null, quantity: qty }];
      for (const part of parts) {
        await this.addQuant(tx, companyId, product, src, part.lotId, part.quantity.negated());
        await this.addQuant(tx, companyId, product, dest, part.lotId, part.quantity);
      }
      if (lots.length) {
        await tx
          .insert(schema.stockMoveLines)
          .values(lots.map((l) => ({ moveId: move.id, lotId: l.lotId, quantity: l.quantity.toFixed(4) })));
      }

      let unitCost: Decimal | null = null;
      let value: Decimal | null = null;
      const incoming = src.usage !== "internal" && dest.usage === "internal";
      const outgoing = src.usage === "internal" && dest.usage !== "internal";
      // Dropship: barang tidak pernah masuk gudang; langsung dibebankan ke HPP sebesar harga beli.
      if (product.productType === "storable" && src.usage === "supplier" && dest.usage === "customer") {
        if (!s.cogsAccountId || !s.stockInputAccountId)
          throw new BadRequestException("Akun persediaan belum diatur di pengaturan akuntansi");
        unitCost = d(move.priceUnit ?? (await this.currentCost(tx, companyId, product)));
        value = money(qty.times(unitCost));
        journalLines.push(
          {
            accountId: s.cogsAccountId,
            debit: value,
            credit: d(0),
            name: `${product.name} (${qty.toFixed(0)}, dropship)`,
            partnerId: null,
          },
          {
            accountId: s.stockInputAccountId,
            debit: d(0),
            credit: value,
            name: product.name,
            partnerId: ctx.partnerId,
          },
        );
      }
      if (product.productType === "storable" && (incoming || outgoing)) {
        await this.lockCost(tx, companyId, product.id);
        const counterpart = (usage: string) => {
          const id =
            usage === "supplier"
              ? s.stockInputAccountId
              : usage === "customer"
                ? s.cogsAccountId
                : s.stockAdjustmentAccountId;
          if (!id || !s.stockValuationAccountId)
            throw new BadRequestException("Akun persediaan belum diatur di pengaturan akuntansi");
          return id;
        };
        if (incoming) {
          unitCost = d(move.priceUnit ?? (await this.currentCost(tx, companyId, product)));
          value = money(qty.times(unitCost));
          const before = await this.valuedTotals(tx, companyId, product.id);
          const [layer] = await tx
            .insert(schema.stockValuationLayers)
            .values({
              companyId,
              productId: product.id,
              stockMoveId: move.id,
              quantity: qty.toFixed(4),
              unitCost: unitCost.toFixed(4),
              value: value.toFixed(2),
              remainingQty: qty.toFixed(4),
              remainingValue: value.toFixed(2),
              description: ctx.ref,
            })
            .returning({ id: schema.stockValuationLayers.id });
          layerIds.push(layer!.id);
          await this.setAverage(
            tx,
            companyId,
            product.id,
            averageAfterIn(before.qty, before.avg, qty, unitCost),
          );
          const account = counterpart(src.usage);
          journalLines.push(
            {
              accountId: s.stockValuationAccountId!,
              debit: value,
              credit: d(0),
              name: `${product.name} (${qty.toFixed(0)})`,
              partnerId: null,
            },
            {
              accountId: account,
              debit: d(0),
              credit: value,
              name: product.name,
              partnerId: src.usage === "supplier" ? ctx.partnerId : null,
            },
          );
        } else {
          value = await this.valueOut(tx, companyId, product, qty);
          unitCost = qty.isZero() ? d(0) : value.div(qty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
          const [layer] = await tx
            .insert(schema.stockValuationLayers)
            .values({
              companyId,
              productId: product.id,
              stockMoveId: move.id,
              quantity: qty.negated().toFixed(4),
              unitCost: unitCost.toFixed(4),
              value: value.negated().toFixed(2),
              description: ctx.ref,
            })
            .returning({ id: schema.stockValuationLayers.id });
          layerIds.push(layer!.id);
          const account = counterpart(dest.usage);
          journalLines.push(
            {
              accountId: account,
              debit: value,
              credit: d(0),
              name: `${product.name} (${qty.toFixed(0)})`,
              partnerId: dest.usage === "supplier" ? ctx.partnerId : null,
            },
            {
              accountId: s.stockValuationAccountId!,
              debit: d(0),
              credit: value,
              name: product.name,
              partnerId: null,
            },
          );
        }
      }
      await tx
        .update(schema.stockMoves)
        .set({
          state: "done",
          quantityDone: qty.toFixed(4),
          date: ctx.date,
          unitCost: unitCost?.toFixed(4) ?? null,
          value: value?.toFixed(2) ?? null,
          quantityReserved: "0",
        })
        .where(eq(schema.stockMoves.id, move.id));
    }

    const lines = journalLines.filter((l) => l.debit.gt(0) || l.credit.gt(0));
    if (!lines.length || !s.stockJournalId) return null;
    const date = ctx.date.toISOString().slice(0, 10);
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: s.stockJournalId,
        date,
        ref: ctx.ref,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          name: l.name,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          partnerId: l.partnerId,
          branchId: ctx.branchId,
        })),
      },
      companyId,
    );
    await this.moves.post(tx, moveId);
    await tx
      .update(schema.stockValuationLayers)
      .set({ accountMoveId: moveId })
      .where(inArray(schema.stockValuationLayers.id, layerIds));
    return moveId;
  }

  /**
   * Nilai barang keluar: FIFO dari lapisan tertua, atau rata-rata (sisa nilai persis bila stok habis).
   * Sisa lapisan masuk selalu dikurangi secara FIFO agar data tetap konsisten bila metode diganti.
   */
  private async valueOut(tx: Db, companyId: string, product: Product, qty: Decimal): Promise<Decimal> {
    const totals = await this.valuedTotals(tx, companyId, product.id);
    {
      const layers = await tx
        .select()
        .from(schema.stockValuationLayers)
        .where(
          and(
            eq(schema.stockValuationLayers.companyId, companyId),
            eq(schema.stockValuationLayers.productId, product.id),
            gt(schema.stockValuationLayers.remainingQty, "0"),
          ),
        )
        .orderBy(asc(schema.stockValuationLayers.createdAt), asc(schema.stockValuationLayers.id));
      const result = fifoConsume(layers, qty);
      for (const take of result.takes) {
        const layer = layers.find((l) => l.id === take.id)!;
        await tx
          .update(schema.stockValuationLayers)
          .set({
            remainingQty: d(layer.remainingQty).minus(take.qty).toFixed(4),
            remainingValue: d(layer.remainingValue).minus(take.value).toFixed(2),
          })
          .where(eq(schema.stockValuationLayers.id, take.id));
      }
      // Kekurangan lapisan (stok tanpa valuasi) dinilai dengan biaya produk.
      if (product.costMethod === "fifo")
        return d(result.value).plus(money(d(result.shortfall).times(product.cost)));
    }
    if (totals.qty.gt(0) && qty.gte(totals.qty))
      return money(totals.value.plus(d(qty).minus(totals.qty).times(totals.avg)));
    return money(qty.times(totals.avg));
  }

  /** Total kuantitas & nilai tervaluasi produk di perusahaan, plus biaya rata-rata tersimpan. */
  private async valuedTotals(tx: Db, companyId: string, productId: string) {
    const [row] = await tx
      .select({
        qty: sql<string>`coalesce(sum(${schema.stockValuationLayers.quantity}), 0)`,
        value: sql<string>`coalesce(sum(${schema.stockValuationLayers.value}), 0)`,
      })
      .from(schema.stockValuationLayers)
      .where(
        and(
          eq(schema.stockValuationLayers.companyId, companyId),
          eq(schema.stockValuationLayers.productId, productId),
        ),
      );
    const [cost] = await tx
      .select({ avg: schema.productCompanyCosts.averageCost })
      .from(schema.productCompanyCosts)
      .where(
        and(
          eq(schema.productCompanyCosts.companyId, companyId),
          eq(schema.productCompanyCosts.productId, productId),
        ),
      );
    return { qty: d(row?.qty ?? 0), value: d(row?.value ?? 0), avg: d(cost?.avg ?? 0) };
  }

  /** Biaya saat ini untuk barang masuk tanpa harga (penyesuaian): rata-rata, lalu biaya produk. */
  async currentCost(tx: Db, companyId: string, product: Product): Promise<string> {
    const totals = await this.valuedTotals(tx, companyId, product.id);
    if (product.costMethod === "fifo" && totals.qty.gt(0))
      return totals.value.div(totals.qty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    if (totals.avg.gt(0)) return totals.avg.toFixed(4);
    return d(product.cost).toFixed(4);
  }

  /** Kunci baris biaya produk sebagai mutex valuasi per produk per perusahaan. */
  private async lockCost(tx: Db, companyId: string, productId: string) {
    await tx.insert(schema.productCompanyCosts).values({ companyId, productId }).onConflictDoNothing();
    await tx
      .select()
      .from(schema.productCompanyCosts)
      .where(
        and(
          eq(schema.productCompanyCosts.companyId, companyId),
          eq(schema.productCompanyCosts.productId, productId),
        ),
      )
      .for("update");
  }

  private async setAverage(tx: Db, companyId: string, productId: string, avg: string) {
    await tx
      .update(schema.productCompanyCosts)
      .set({ averageCost: avg, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.productCompanyCosts.companyId, companyId),
          eq(schema.productCompanyCosts.productId, productId),
        ),
      );
  }

  /** Tambah/kurangi quant; barang stok di lokasi internal tidak boleh minus (barang habis pakai boleh). */
  private async addQuant(
    tx: Db,
    companyId: string,
    product: Product,
    location: Location,
    lotId: string | null,
    delta: Decimal,
  ) {
    await tx
      .insert(schema.stockQuants)
      .values({ companyId, productId: product.id, locationId: location.id, lotId, quantity: "0" })
      .onConflictDoNothing();
    const [quant] = await tx
      .select()
      .from(schema.stockQuants)
      .where(
        and(
          eq(schema.stockQuants.locationId, location.id),
          eq(schema.stockQuants.productId, product.id),
          lotId ? eq(schema.stockQuants.lotId, lotId) : isNull(schema.stockQuants.lotId),
        ),
      )
      .for("update");
    const next = d(quant!.quantity).plus(delta);
    if (location.usage === "internal" && product.productType === "storable" && next.lt(0)) {
      throw new BadRequestException(
        `Stok ${product.name} di ${location.completeName} tidak cukup (tersedia ${d(quant!.quantity).toFixed()}, dibutuhkan ${delta.abs().toFixed()})`,
      );
    }
    if (product.tracking === "serial" && location.usage === "internal" && next.gt(1))
      throw new BadRequestException(`Nomor serial ${product.name} sudah ada di ${location.completeName}`);
    await tx
      .update(schema.stockQuants)
      .set({ quantity: next.toFixed(4), updatedAt: sql`now()` })
      .where(eq(schema.stockQuants.id, quant!.id));
  }

  private async quantOf(tx: Db, locationId: string, productId: string, lotId: string | null) {
    const [quant] = await tx
      .select({ quantity: schema.stockQuants.quantity })
      .from(schema.stockQuants)
      .where(
        and(
          eq(schema.stockQuants.locationId, locationId),
          eq(schema.stockQuants.productId, productId),
          lotId ? eq(schema.stockQuants.lotId, lotId) : isNull(schema.stockQuants.lotId),
        ),
      );
    return d(quant?.quantity ?? 0);
  }

  /** Validasi rincian lot/serial pergerakan; lot baru dibuat untuk penerimaan. */
  private async resolveLots(
    tx: Db,
    picking: Picking,
    move: Move,
    product: Product,
    qtyDone: Decimal,
    lots: LotInput[] | undefined,
    path: string,
  ) {
    if (product.tracking === "none") {
      if (lots?.length) throw fieldError(`${path}.lots`, "Produk ini tidak memakai lot/serial");
      return [];
    }
    if (!lots?.length)
      throw fieldError(
        `${path}.lots`,
        `Isi nomor ${product.tracking === "serial" ? "serial" : "lot"} untuk ${product.name}`,
      );
    const total = lots.reduce((sum, l) => sum.plus(l.quantity), d(0));
    if (!total.eq(qtyDone))
      throw fieldError(`${path}.lots`, "Jumlah per lot harus sama dengan kuantitas dipindahkan");
    const src = await this.location(tx, move.locationId, picking.companyId);
    const result: { lotId: string; quantity: Decimal }[] = [];
    for (const [j, l] of lots.entries()) {
      if (product.tracking === "serial" && !d(l.quantity).eq(1))
        throw fieldError(`${path}.lots.${j}.quantity`, "Setiap nomor serial berjumlah 1");
      let lotId = l.lotId;
      if (lotId) {
        const [lot] = await tx
          .select()
          .from(schema.stockLots)
          .where(and(eq(schema.stockLots.id, lotId), eq(schema.stockLots.productId, product.id)));
        if (!lot) throw fieldError(`${path}.lots.${j}.lotId`, "Lot tidak ditemukan untuk produk ini");
      } else {
        // Lot baru hanya lazim pada barang masuk dari luar; keluar wajib memilih lot yang ada.
        if (src.usage === "internal") throw fieldError(`${path}.lots.${j}.lotId`, "Pilih lot yang tersedia");
        lotId = (
          await this.findOrCreateLot(tx, picking.companyId, product.id, l.lotName!, l.expirationDate ?? null)
        ).id;
      }
      if (result.some((r) => r.lotId === lotId)) throw fieldError(`${path}.lots.${j}`, "Lot/serial ganda");
      result.push({ lotId, quantity: d(l.quantity) });
    }
    return result;
  }

  async findOrCreateLot(
    tx: Db,
    companyId: string,
    productId: string,
    name: string,
    expirationDate: string | null,
  ) {
    await tx
      .insert(schema.stockLots)
      .values({ companyId, productId, name, expirationDate })
      .onConflictDoNothing();
    const [lot] = await tx
      .select()
      .from(schema.stockLots)
      .where(
        and(
          eq(schema.stockLots.companyId, companyId),
          eq(schema.stockLots.productId, productId),
          eq(schema.stockLots.name, name),
        ),
      );
    return lot!;
  }

  // ---- Utilitas ----

  async defaultWarehouse(tx: Db, companyId: string) {
    const [wh] = await tx
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.companyId, companyId), eq(schema.warehouses.active, true)))
      .orderBy(asc(schema.warehouses.createdAt))
      .limit(1);
    if (!wh) throw new BadRequestException("Perusahaan belum punya gudang");
    return wh;
  }

  async warehouse(tx: Db, id: string, companyId: string) {
    const [wh] = await tx
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.companyId, companyId)));
    if (!wh) throw fieldError("warehouseId", "Gudang tidak ditemukan di perusahaan ini");
    return wh;
  }

  async location(tx: Db, id: string, companyId: string) {
    const [loc] = await tx
      .select()
      .from(schema.stockLocations)
      .where(and(eq(schema.stockLocations.id, id), eq(schema.stockLocations.companyId, companyId)));
    if (!loc) throw fieldError("locationId", "Lokasi tidak ditemukan di perusahaan ini");
    return loc;
  }

  private async products(tx: Db, ids: string[]) {
    const unique = [...new Set(ids)];
    const rows = unique.length
      ? await tx.select().from(schema.products).where(inArray(schema.products.id, unique))
      : [];
    return new Map(rows.map((p) => [p.id, p]));
  }

  async lockPicking(tx: Db, id: string): Promise<Picking> {
    const [picking] = await tx
      .select()
      .from(schema.stockPickings)
      .where(
        and(eq(schema.stockPickings.id, id), eq(schema.stockPickings.companyId, currentContext().companyId)),
      )
      .for("update");
    if (!picking) throw new NotFoundException("Transfer tidak ditemukan");
    return picking;
  }
}
