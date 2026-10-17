import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, or, schema, sql, type Db, type SQL } from "@erp/db";
import { Decimal } from "decimal.js";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";

const P = schema.stockPickings;
const M = schema.stockMoves;
const d = (v: Decimal.Value) => new Decimal(v ?? 0);
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export interface PickingQuery {
  pickingType?: string;
  state?: string;
  q?: string;
  saleOrderId?: string;
  purchaseOrderId?: string;
  limit?: string;
  offset?: string;
}

/**
 * Kueri baca persediaan. Nama kolom di dalam subquery SQL ditulis lengkap (tabel.kolom) karena Drizzle
 * tidak menyertakan nama tabel pada query tanpa join.
 */
@Injectable()
export class StockQueryService {
  async pickings(tx: Db, query: PickingQuery) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters: (SQL | undefined)[] = [eq(P.companyId, currentContext().companyId)];
    if (query.pickingType && ["incoming", "outgoing", "internal"].includes(query.pickingType))
      filters.push(eq(P.pickingType, query.pickingType as "incoming"));
    const states = (query.state ?? "")
      .split(",")
      .filter((s): s is "draft" => ["draft", "ready", "done", "cancel"].includes(s));
    if (states.length) filters.push(inArray(P.state, states));
    if (query.q)
      filters.push(
        or(
          ilike(P.name, like(query.q)),
          ilike(P.origin, like(query.q)),
          ilike(schema.partners.name, like(query.q)),
        ),
      );
    if (query.saleOrderId) filters.push(eq(P.saleOrderId, query.saleOrderId));
    if (query.purchaseOrderId) filters.push(eq(P.purchaseOrderId, query.purchaseOrderId));
    const where = and(...filters);
    const items = await tx
      .select({ picking: P, partnerName: schema.partners.name, warehouseCode: schema.warehouses.code })
      .from(P)
      .leftJoin(schema.partners, eq(schema.partners.id, P.partnerId))
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, P.warehouseId))
      .where(where)
      .orderBy(desc(P.scheduledDate), desc(P.name))
      .limit(limit)
      .offset(offset);
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(P)
      .leftJoin(schema.partners, eq(schema.partners.id, P.partnerId))
      .where(where);
    return {
      items: items.map((r) => ({ ...r.picking, partnerName: r.partnerName, warehouseCode: r.warehouseCode })),
      total,
      limit,
      offset,
    };
  }

  async picking(tx: Db, id: string) {
    const [row] = await tx
      .select({ picking: P, partnerName: schema.partners.name })
      .from(P)
      .leftJoin(schema.partners, eq(schema.partners.id, P.partnerId))
      .where(and(eq(P.id, id), eq(P.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Transfer tidak ditemukan");
    const locations = await tx
      .select({ id: schema.stockLocations.id, completeName: schema.stockLocations.completeName })
      .from(schema.stockLocations)
      .where(inArray(schema.stockLocations.id, [row.picking.locationId, row.picking.locationDestId]));
    const moves = await tx
      .select({
        move: M,
        productName: schema.products.name,
        sku: schema.products.sku,
        tracking: schema.products.tracking,
        productType: schema.products.productType,
        uomName: schema.uoms.name,
        returnedQty: sql<string>`coalesce((select sum(case when r.state = 'done' then r.quantity_done else r.quantity end)
          from ${M} r where r.origin_return_move_id = stock_moves.id and r.state <> 'cancel'), 0)::text`,
      })
      .from(M)
      .innerJoin(schema.products, eq(schema.products.id, M.productId))
      .innerJoin(schema.uoms, eq(schema.uoms.id, schema.products.uomId))
      .where(eq(M.pickingId, id))
      .orderBy(asc(M.createdAt));
    const lots = moves.length
      ? await tx
          .select({
            moveId: schema.stockMoveLines.moveId,
            lotId: schema.stockMoveLines.lotId,
            lotName: schema.stockLots.name,
            quantity: schema.stockMoveLines.quantity,
          })
          .from(schema.stockMoveLines)
          .innerJoin(schema.stockLots, eq(schema.stockLots.id, schema.stockMoveLines.lotId))
          .where(
            inArray(
              schema.stockMoveLines.moveId,
              moves.map((m) => m.move.id),
            ),
          )
      : [];
    const related = await tx
      .select({
        id: P.id,
        name: P.name,
        state: P.state,
        pickingType: P.pickingType,
        returnOfId: P.returnOfId,
        backorderOfId: P.backorderOfId,
      })
      .from(P)
      .where(
        or(
          eq(P.returnOfId, id),
          eq(P.backorderOfId, id),
          eq(P.id, row.picking.returnOfId ?? id),
          eq(P.id, row.picking.backorderOfId ?? id),
        ),
      );
    const origin = row.picking.saleOrderId
      ? await tx
          .select({ id: schema.saleOrders.id, name: schema.saleOrders.name })
          .from(schema.saleOrders)
          .where(eq(schema.saleOrders.id, row.picking.saleOrderId))
      : row.picking.purchaseOrderId
        ? await tx
            .select({ id: schema.purchaseOrders.id, name: schema.purchaseOrders.name })
            .from(schema.purchaseOrders)
            .where(eq(schema.purchaseOrders.id, row.picking.purchaseOrderId))
        : [];
    const accountMove = row.picking.accountMoveId
      ? (
          await tx
            .select({ id: schema.accountMoves.id, name: schema.accountMoves.name })
            .from(schema.accountMoves)
            .where(eq(schema.accountMoves.id, row.picking.accountMoveId))
        )[0]
      : null;
    return {
      ...row.picking,
      partnerName: row.partnerName,
      locationName: locations.find((l) => l.id === row.picking.locationId)?.completeName ?? "",
      locationDestName: locations.find((l) => l.id === row.picking.locationDestId)?.completeName ?? "",
      moves: moves.map((m) => ({
        ...m.move,
        productName: m.productName,
        sku: m.sku,
        tracking: m.tracking,
        uomName: m.uomName,
        returnedQty: d(m.returnedQty).toFixed(4),
        lots: lots.filter((l) => l.moveId === m.move.id),
      })),
      related: related.filter((r) => r.id !== id),
      order: origin[0] ?? null,
      accountMove,
    };
  }

  /** Ringkasan stok per produk: tersedia, akan masuk, akan keluar, perkiraan, dan nilai persediaan. */
  async overview(tx: Db, query: { q?: string; warehouseId?: string; limit?: string; offset?: string }) {
    const ctx = currentContext();
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const wh = query.warehouseId ?? null;
    // Lokasi internal perusahaan (opsional: hanya gudang tertentu).
    const internal = (column: string) =>
      sql`${sql.raw(column)} in (select l.id from ${schema.stockLocations} l where l.usage = 'internal'
        and l.company_id = ${ctx.companyId}${wh ? sql` and l.warehouse_id = ${wh}` : sql``})`;
    const filters: (SQL | undefined)[] = [
      inArray(schema.products.productType, ["storable", "consumable"]),
      eq(schema.products.active, true),
      sql`(products.company_id is null or products.company_id = ${ctx.companyId})`,
    ];
    if (query.q)
      filters.push(or(ilike(schema.products.name, like(query.q)), ilike(schema.products.sku, like(query.q))));
    const rows = await tx
      .select({
        id: schema.products.id,
        sku: schema.products.sku,
        name: schema.products.name,
        productType: schema.products.productType,
        tracking: schema.products.tracking,
        costMethod: schema.products.costMethod,
        uomName: schema.uoms.name,
        onHand: sql<string>`coalesce((select sum(q.quantity) from ${schema.stockQuants} q
          where q.product_id = products.id and ${internal("q.location_id")}), 0)::text`,
        incoming: sql<string>`coalesce((select sum(m.quantity) from ${M} m
          where m.product_id = products.id and m.state = 'ready' and ${internal("m.location_dest_id")}
            and not ${internal("m.location_id")}), 0)::text`,
        outgoing: sql<string>`coalesce((select sum(m.quantity) from ${M} m
          where m.product_id = products.id and m.state = 'ready' and ${internal("m.location_id")}
            and not ${internal("m.location_dest_id")}), 0)::text`,
        value: sql<string>`coalesce((select sum(v.value) from ${schema.stockValuationLayers} v
          where v.product_id = products.id and v.company_id = ${ctx.companyId}), 0)::text`,
        valuedQty: sql<string>`coalesce((select sum(v.quantity) from ${schema.stockValuationLayers} v
          where v.product_id = products.id and v.company_id = ${ctx.companyId}), 0)::text`,
      })
      .from(schema.products)
      .innerJoin(schema.uoms, eq(schema.uoms.id, schema.products.uomId))
      .where(and(...filters))
      .orderBy(asc(schema.products.name))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      ...r,
      forecast: d(r.onHand).plus(r.incoming).minus(r.outgoing).toFixed(4),
      averageCost: d(r.valuedQty).gt(0) ? d(r.value).div(r.valuedQty).toDecimalPlaces(4).toFixed(4) : null,
      // Nilai per gudang tidak dihitung: valuasi berlaku per perusahaan.
      value: wh ? null : d(r.value).toFixed(2),
    }));
  }

  /** Stok per lokasi & lot. */
  async quants(tx: Db, query: { productId?: string; locationId?: string; warehouseId?: string; q?: string }) {
    const ctx = currentContext();
    const filters: (SQL | undefined)[] = [
      eq(schema.stockQuants.companyId, ctx.companyId),
      eq(schema.stockLocations.usage, "internal"),
      sql`${schema.stockQuants.quantity} <> 0`,
    ];
    if (query.productId) filters.push(eq(schema.stockQuants.productId, query.productId));
    if (query.locationId) filters.push(eq(schema.stockQuants.locationId, query.locationId));
    if (query.warehouseId) filters.push(eq(schema.stockLocations.warehouseId, query.warehouseId));
    if (query.q)
      filters.push(
        or(
          ilike(schema.products.name, like(query.q)),
          ilike(schema.products.sku, like(query.q)),
          ilike(schema.stockLots.name, like(query.q)),
        ),
      );
    return tx
      .select({
        id: schema.stockQuants.id,
        productId: schema.stockQuants.productId,
        sku: schema.products.sku,
        productName: schema.products.name,
        locationId: schema.stockQuants.locationId,
        locationName: schema.stockLocations.completeName,
        lotId: schema.stockQuants.lotId,
        lotName: schema.stockLots.name,
        expirationDate: schema.stockLots.expirationDate,
        quantity: schema.stockQuants.quantity,
      })
      .from(schema.stockQuants)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockQuants.productId))
      .innerJoin(schema.stockLocations, eq(schema.stockLocations.id, schema.stockQuants.locationId))
      .leftJoin(schema.stockLots, eq(schema.stockLots.id, schema.stockQuants.lotId))
      .where(and(...filters))
      .orderBy(asc(schema.products.name), asc(schema.stockLocations.completeName), asc(schema.stockLots.name))
      .limit(1000);
  }

  /**
   * Kartu stok: saldo awal, mutasi masuk/keluar dengan saldo berjalan, dan nilai (bila tanpa filter lokasi,
   * karena valuasi berlaku per perusahaan).
   */
  async card(tx: Db, query: { productId: string; from: string; to: string; locationId?: string }) {
    const ctx = currentContext();
    const [product] = await tx
      .select({ id: schema.products.id, name: schema.products.name, sku: schema.products.sku })
      .from(schema.products)
      .where(eq(schema.products.id, query.productId));
    if (!product) throw fieldError("productId", "Produk tidak ditemukan");
    const loc = query.locationId ?? null;
    const inside = (col: string) =>
      loc
        ? sql`${sql.raw(col)} = ${loc}`
        : sql`${sql.raw(col)} in (select l.id from ${schema.stockLocations} l where l.usage = 'internal' and l.company_id = ${ctx.companyId})`;
    const direction = sql<number>`(case when ${inside("stock_moves.location_dest_id")} then 1 else 0 end)
      - (case when ${inside("stock_moves.location_id")} then 1 else 0 end)`;
    const base = and(
      eq(M.companyId, ctx.companyId),
      eq(M.productId, query.productId),
      eq(M.state, "done"),
      sql`${direction} <> 0`,
    );
    const [opening] = await tx
      .select({
        qty: sql<string>`coalesce(sum(${direction} * ${M.quantityDone}), 0)::text`,
        value: sql<string>`coalesce(sum(${direction} * coalesce(${M.value}, 0)), 0)::text`,
      })
      .from(M)
      .where(and(base, sql`${M.date} < ${query.from}::date`));
    const rows = await tx
      .select({
        move: M,
        direction,
        pickingName: P.name,
        partnerName: schema.partners.name,
      })
      .from(M)
      .leftJoin(P, eq(P.id, M.pickingId))
      .leftJoin(schema.partners, eq(schema.partners.id, P.partnerId))
      .where(and(base, sql`${M.date} >= ${query.from}::date`, sql`${M.date} < ${query.to}::date + 1`))
      .orderBy(asc(M.date), asc(M.createdAt));
    let qty = d(opening?.qty ?? 0);
    let value = d(opening?.value ?? 0);
    const lines = rows.map((r) => {
      const q = d(r.move.quantityDone).times(r.direction);
      const v = d(r.move.value ?? 0).times(r.direction);
      qty = qty.plus(q);
      value = value.plus(v);
      return {
        id: r.move.id,
        date: r.move.date,
        reference: r.pickingName ?? r.move.reference,
        pickingId: r.move.pickingId,
        partnerName: r.partnerName,
        qtyIn: q.gt(0) ? q.toFixed(4) : "0.0000",
        qtyOut: q.lt(0) ? q.abs().toFixed(4) : "0.0000",
        unitCost: r.move.unitCost,
        value: loc ? null : v.toFixed(2),
        balanceQty: qty.toFixed(4),
        balanceValue: loc ? null : value.toFixed(2),
      };
    });
    return {
      product,
      opening: {
        qty: d(opening?.qty ?? 0).toFixed(4),
        value: loc ? null : d(opening?.value ?? 0).toFixed(2),
      },
      lines,
      closing: { qty: qty.toFixed(4), value: loc ? null : value.toFixed(2) },
    };
  }

  /** Nilai persediaan per produk pada akhir tanggal tertentu (dari lapisan valuasi). */
  async valuation(tx: Db, date: string) {
    const ctx = currentContext();
    const V = schema.stockValuationLayers;
    const rows = await tx
      .select({
        productId: V.productId,
        sku: schema.products.sku,
        name: schema.products.name,
        costMethod: schema.products.costMethod,
        quantity: sql<string>`sum(${V.quantity})::text`,
        value: sql<string>`sum(${V.value})::text`,
      })
      .from(V)
      .innerJoin(schema.products, eq(schema.products.id, V.productId))
      .where(and(eq(V.companyId, ctx.companyId), sql`${V.createdAt} < ${date}::date + 1`))
      .groupBy(V.productId, schema.products.sku, schema.products.name, schema.products.costMethod)
      .orderBy(asc(schema.products.name));
    const items = rows
      .filter((r) => !d(r.quantity).isZero() || !d(r.value).isZero())
      .map((r) => ({
        ...r,
        quantity: d(r.quantity).toFixed(4),
        value: d(r.value).toFixed(2),
        averageCost: d(r.quantity).gt(0) ? d(r.value).div(r.quantity).toDecimalPlaces(4).toFixed(4) : null,
      }));
    return { date, items, total: items.reduce((s, r) => s.plus(r.value), d(0)).toFixed(2) };
  }

  /** Lot/serial dengan stok tersedia di lokasi internal. */
  async lots(tx: Db, query: { productId?: string; q?: string; available?: string }) {
    const ctx = currentContext();
    const filters: (SQL | undefined)[] = [eq(schema.stockLots.companyId, ctx.companyId)];
    if (query.productId) filters.push(eq(schema.stockLots.productId, query.productId));
    if (query.q) filters.push(ilike(schema.stockLots.name, like(query.q)));
    const rows = await tx
      .select({
        lot: schema.stockLots,
        productName: schema.products.name,
        sku: schema.products.sku,
        onHand: sql<string>`coalesce((select sum(q.quantity) from ${schema.stockQuants} q
          join ${schema.stockLocations} l on l.id = q.location_id
          where q.lot_id = stock_lots.id and l.usage = 'internal'), 0)::text`,
      })
      .from(schema.stockLots)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockLots.productId))
      .where(and(...filters))
      .orderBy(asc(schema.stockLots.expirationDate), asc(schema.stockLots.name))
      .limit(500);
    return rows
      .map((r) => ({ ...r.lot, productName: r.productName, sku: r.sku, onHand: d(r.onHand).toFixed(4) }))
      .filter((r) => query.available !== "true" || d(r.onHand).gt(0));
  }
}
