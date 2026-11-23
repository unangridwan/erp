import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, or, schema, sql, type Db } from "@erp/db";
import { pickSupplier, reorderQuantity, businessToday } from "@erp/shared";
import { Decimal } from "decimal.js";
import { currentContext } from "../common/request-context.js";
import { PurchaseOrderService } from "./purchase-order.service.js";

const d = (v: Decimal.Value) => new Decimal(v ?? 0);
const today = () => businessToday();

/**
 * Pemesanan ulang otomatis (min/max): perkiraan stok gudang = tersedia + akan masuk − akan keluar + RFQ terbuka.
 * Di bawah minimum → RFQ ke pemasok utama hingga maksimum.
 */
@Injectable()
export class ReplenishmentService {
  constructor(@Inject(PurchaseOrderService) private readonly orders: PurchaseOrderService) {}

  async list(tx: Db) {
    const companyId = currentContext().companyId;
    const R = schema.stockReorderRules;
    // Nama kolom ditulis lengkap: lihat catatan di StockQueryService.
    const inWarehouse = (column: string) =>
      sql`${sql.raw(column)} in (select l.id from ${schema.stockLocations} l where l.usage = 'internal' and l.warehouse_id = stock_reorder_rules.warehouse_id)`;
    const rows = await tx
      .select({
        rule: R,
        productName: schema.products.name,
        sku: schema.products.sku,
        uomId: schema.products.uomId,
        warehouseCode: schema.warehouses.code,
        onHand: sql<string>`coalesce((select sum(q.quantity) from ${schema.stockQuants} q
          where q.product_id = stock_reorder_rules.product_id and ${inWarehouse("q.location_id")}), 0)::text`,
        incoming: sql<string>`coalesce((select sum(m.quantity) from ${schema.stockMoves} m
          where m.product_id = stock_reorder_rules.product_id and m.state = 'ready'
            and ${inWarehouse("m.location_dest_id")} and not ${inWarehouse("m.location_id")}), 0)::text`,
        outgoing: sql<string>`coalesce((select sum(m.quantity) from ${schema.stockMoves} m
          where m.product_id = stock_reorder_rules.product_id and m.state in ('draft', 'ready')
            and ${inWarehouse("m.location_id")} and not ${inWarehouse("m.location_dest_id")}), 0)::text`,
        rfq: sql<string>`coalesce((select sum(pl.quantity * pl.uom_ratio) from ${schema.purchaseOrderLines} pl
          join ${schema.purchaseOrders} po on po.id = pl.order_id
          where pl.product_id = stock_reorder_rules.product_id and po.warehouse_id = stock_reorder_rules.warehouse_id
            and po.state in ('draft', 'sent', 'to_approve')), 0)::text`,
      })
      .from(R)
      .innerJoin(schema.products, eq(schema.products.id, R.productId))
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, R.warehouseId))
      .where(and(eq(R.companyId, companyId), eq(R.active, true)));
    const suppliers = rows.length
      ? await tx
          .select({ supplier: schema.productSuppliers, partnerName: schema.partners.name })
          .from(schema.productSuppliers)
          .innerJoin(schema.partners, eq(schema.partners.id, schema.productSuppliers.partnerId))
          .where(
            and(
              inArray(
                schema.productSuppliers.productId,
                rows.map((r) => r.rule.productId),
              ),
              or(isNull(schema.productSuppliers.companyId), eq(schema.productSuppliers.companyId, companyId)),
            ),
          )
      : [];
    return rows.map((r) => {
      const forecast = d(r.onHand).plus(r.incoming).minus(r.outgoing).plus(r.rfq);
      const toOrder = reorderQuantity({
        forecast,
        minQty: r.rule.minQty,
        maxQty: r.rule.maxQty,
        qtyMultiple: r.rule.qtyMultiple,
      });
      const options = suppliers.filter((s) => s.supplier.productId === r.rule.productId);
      const best = pickSupplier(
        options.map((s) => s.supplier),
        d(toOrder).gt(0) ? toOrder : 1,
      );
      return {
        ...r.rule,
        productName: r.productName,
        sku: r.sku,
        uomId: r.uomId,
        warehouseCode: r.warehouseCode,
        onHand: d(r.onHand).toFixed(4),
        incoming: d(r.incoming).toFixed(4),
        outgoing: d(r.outgoing).toFixed(4),
        rfq: d(r.rfq).toFixed(4),
        forecast: forecast.toFixed(4),
        toOrder,
        supplierId: best?.partnerId ?? null,
        supplierName: options.find((s) => s.supplier.id === best?.id)?.partnerName ?? null,
        delayDays: best?.delayDays ?? 0,
      };
    });
  }

  /** Buat/tambah RFQ draft per pemasok & gudang untuk aturan yang perlu dipesan. */
  async run(tx: Db, ruleIds?: string[]) {
    const needs = (await this.list(tx)).filter(
      (r) => d(r.toOrder).gt(0) && (!ruleIds?.length || ruleIds.includes(r.id)),
    );
    const skipped = needs
      .filter((r) => !r.supplierId)
      .map((r) => ({ ruleId: r.id, productName: r.productName }));
    const groups = new Map<string, typeof needs>();
    for (const r of needs.filter((x) => x.supplierId)) {
      const key = `${r.supplierId}/${r.warehouseId}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const orderIds: string[] = [];
    for (const rules of groups.values()) {
      const first = rules[0]!;
      const delay = Math.max(...rules.map((r) => r.delayDays));
      const planned = businessToday(new Date(Date.now() + delay * 86_400_000));
      const order = await this.orders.create(tx, {
        partnerId: first.supplierId!,
        dateOrder: today(),
        datePlanned: planned,
        warehouseId: first.warehouseId,
        note: "Dibuat otomatis dari aturan pemesanan ulang",
        // Kuantitas aturan dalam satuan produk (bukan satuan beli).
        lines: rules.map((r) => ({
          productId: r.productId,
          quantity: r.toOrder,
          discount: "0",
          uomId: r.uomId,
        })),
      });
      orderIds.push(order.id);
    }
    return { orderIds, skipped };
  }
}
