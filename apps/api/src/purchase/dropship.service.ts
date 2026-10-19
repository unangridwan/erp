import { BadRequestException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or, schema, type Db } from "@erp/db";
import { pickSupplier } from "@erp/shared";
import { Decimal } from "decimal.js";
import { ActivityService } from "../activity/activity.service.js";
import { SaleOrderService, type Order as SaleOrder } from "../sales/sale-order.service.js";
import { PurchaseOrderService } from "./purchase-order.service.js";

/**
 * Dropship: baris SO bertanda dropship tidak dikirim dari gudang. Saat SO dikonfirmasi dibuat draft RFQ ke
 * pemasok utama tiap produk; setelah PO dikonfirmasi, transfer dropship membawa barang dari pemasok langsung ke
 * pelanggan (HPP dibebankan sebesar harga beli, tanpa melewati persediaan).
 */
@Injectable()
export class DropshipService implements OnModuleInit {
  constructor(
    @Inject(SaleOrderService) private readonly sales: SaleOrderService,
    @Inject(PurchaseOrderService) private readonly purchases: PurchaseOrderService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    this.sales.confirmHooks.push((tx, order) => this.purchaseForSale(tx, order));
  }

  async purchaseForSale(tx: Db, order: SaleOrder) {
    const lines = await tx
      .select()
      .from(schema.saleOrderLines)
      .where(and(eq(schema.saleOrderLines.orderId, order.id), eq(schema.saleOrderLines.dropship, true)))
      .orderBy(asc(schema.saleOrderLines.sequence));
    const goods = lines.filter((l) => l.productId && new Decimal(l.quantity).gt(0));
    if (!goods.length) return;
    const productIds = [...new Set(goods.map((l) => l.productId!))];
    const suppliers = await tx
      .select({ supplier: schema.productSuppliers, productName: schema.products.name })
      .from(schema.productSuppliers)
      .innerJoin(schema.products, eq(schema.products.id, schema.productSuppliers.productId))
      .where(
        and(
          inArray(schema.productSuppliers.productId, productIds),
          or(
            isNull(schema.productSuppliers.companyId),
            eq(schema.productSuppliers.companyId, order.companyId),
          ),
        ),
      );
    const groups = new Map<string, typeof goods>();
    for (const l of goods) {
      const options = suppliers.filter((s) => s.supplier.productId === l.productId).map((s) => s.supplier);
      const best = pickSupplier(options, new Decimal(l.quantity).times(l.uomRatio).toFixed(4));
      if (!best)
        throw new BadRequestException(
          `${l.name} ditandai dropship tetapi belum punya pemasok (atur di harga pemasok produk)`,
        );
      groups.set(best.partnerId, [...(groups.get(best.partnerId) ?? []), l]);
    }
    const names: string[] = [];
    for (const [partnerId, group] of groups) {
      const po = await this.purchases.create(tx, {
        partnerId,
        dateOrder: order.dateOrder,
        warehouseId: order.warehouseId,
        userId: null,
        note: `Dropship untuk ${order.name}`,
        lines: group.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          uomId: l.uomId,
          discount: "0",
        })),
      });
      await tx
        .update(schema.purchaseOrders)
        .set({ dropshipSaleOrderId: order.id })
        .where(eq(schema.purchaseOrders.id, po.id));
      // Urutan baris PO sama dengan urutan baris grup.
      for (const [i, l] of group.entries())
        await tx
          .update(schema.purchaseOrderLines)
          .set({ saleLineId: l.id })
          .where(
            and(eq(schema.purchaseOrderLines.orderId, po.id), eq(schema.purchaseOrderLines.sequence, i)),
          );
      names.push(po.name);
    }
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: order.id,
      action: "comment",
      message: `RFQ dropship dibuat: ${names.join(", ")}`,
    });
  }
}
