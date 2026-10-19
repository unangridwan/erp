import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { and, asc, eq, isNull, or, schema, type Db } from "@erp/db";
import { Decimal } from "decimal.js";
import { ActivityService } from "../activity/activity.service.js";
import { loadBooks } from "../accounting/context.js";
import { MoveService, type PostedMove } from "../accounting/move.service.js";
import { currentContext, withCompany } from "../common/request-context.js";
import { FxService } from "../master/fx.controller.js";
import { PurchaseOrderService, type Order as PurchaseOrder } from "../purchase/purchase-order.service.js";
import { SaleOrderService, type Order as SaleOrder } from "../sales/sale-order.service.js";

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/**
 * Aturan antar perusahaan (mirip Odoo): bila perusahaan sumber mengaktifkan `ic_auto_documents`,
 * - SO terkonfirmasi ke perusahaan grup → draft RFQ di perusahaan itu;
 * - PO terkonfirmasi ke perusahaan grup → draft penawaran di perusahaan itu;
 * - faktur/nota kredit penjualan diposting ke perusahaan grup → draft tagihan/nota debit di perusahaan itu,
 *   terhubung ke baris PO pasangan (barang stok lewat akun Barang Diterima Belum Ditagih).
 * Dokumen hanya dibuat bila user punya akses ke perusahaan tujuan; pasangan ditautkan dua arah sehingga
 * dokumen hasil otomatis tidak memicu dokumen balik.
 */
@Injectable()
export class IntercompanyService implements OnModuleInit {
  constructor(
    @Inject(SaleOrderService) private readonly sales: SaleOrderService,
    @Inject(PurchaseOrderService) private readonly purchases: PurchaseOrderService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    this.sales.confirmHooks.push((tx, order) => this.purchaseFromSale(tx, order));
    this.purchases.confirmHooks.push((tx, order) => this.saleFromPurchase(tx, order));
    this.moves.postHooks.push((tx, move) => this.billFromInvoice(tx, move));
  }

  /** SO di A ke perusahaan grup B → draft RFQ di B dengan baris & harga yang sama. */
  async purchaseFromSale(tx: Db, order: SaleOrder) {
    if (order.icPurchaseOrderId) return;
    const target = await this.target(tx, order.companyId, order.partnerId);
    if (!target) return;
    const [linked] = await tx
      .select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.icSaleOrderId, order.id));
    if (linked) return;
    const vendorId = await this.partnerOf(tx, order.companyId, target);
    if (!vendorId) return;
    const lines = await tx
      .select()
      .from(schema.saleOrderLines)
      .where(and(eq(schema.saleOrderLines.orderId, order.id), eq(schema.saleOrderLines.isDownpayment, false)))
      .orderBy(asc(schema.saleOrderLines.sequence));
    const books = await loadBooks(tx, target);
    const tax = books.settings.defaultPurchaseTaxId;
    const po = await withCompany(target, () =>
      this.purchases.create(tx, {
        partnerId: vendorId,
        partnerRef: order.name,
        dateOrder: order.dateOrder,
        // User belum tentu terdaftar di perusahaan tujuan (mis. admin dengan akses penuh).
        userId: null,
        currencyCode: order.currencyCode,
        note: `Dibuat otomatis dari ${order.name}`,
        lines: lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds.length && tax ? [tax] : [],
        })),
      }),
    );
    await this.link(tx, order.id, po.id);
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: order.id,
      action: "comment",
      message: `RFQ antar perusahaan ${po.name} dibuat`,
    });
  }

  /** PO di B ke perusahaan grup A → draft penawaran di A (harga dikonversi ke mata uang A bila perlu). */
  async saleFromPurchase(tx: Db, order: PurchaseOrder) {
    if (order.icSaleOrderId) return;
    const target = await this.target(tx, order.companyId, order.partnerId);
    if (!target) return;
    const [linked] = await tx
      .select({ id: schema.saleOrders.id })
      .from(schema.saleOrders)
      .where(eq(schema.saleOrders.icPurchaseOrderId, order.id));
    if (linked) return;
    const customerId = await this.partnerOf(tx, order.companyId, target);
    if (!customerId) return;
    const lines = await tx
      .select()
      .from(schema.purchaseOrderLines)
      .where(eq(schema.purchaseOrderLines.orderId, order.id))
      .orderBy(asc(schema.purchaseOrderLines.sequence));
    const books = await loadBooks(tx, target);
    const rate = await this.rate(tx, order.currencyCode, books.currencyCode, order.dateOrder);
    const tax = books.settings.defaultSaleTaxId;
    const so = await withCompany(target, () =>
      this.sales.create(tx, {
        partnerId: customerId,
        dateOrder: order.dateOrder,
        pricelistId: null,
        userId: null,
        clientOrderRef: order.name,
        note: `Dibuat otomatis dari ${order.name}`,
        lines: lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          priceUnit: d(l.priceUnit).times(rate).toDecimalPlaces(4).toFixed(4),
          discount: l.discount,
          taxIds: l.taxIds.length && tax ? [tax] : [],
        })),
      }),
    );
    await this.link(tx, so.id, order.id);
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: order.id,
      action: "comment",
      message: `Penawaran antar perusahaan ${so.name} dibuat`,
    });
  }

  /** Faktur/nota kredit penjualan A ke perusahaan grup B → draft tagihan/nota debit di B. */
  async billFromInvoice(tx: Db, move: PostedMove) {
    if (move.moveType !== "out_invoice" && move.moveType !== "out_refund") return;
    const [invoice] = await tx.select().from(schema.accountMoves).where(eq(schema.accountMoves.id, move.id));
    if (!invoice?.partnerId) return;
    const target = await this.target(tx, move.companyId, invoice.partnerId);
    if (!target) return;
    const [existing] = await tx
      .select({ id: schema.accountMoves.id })
      .from(schema.accountMoves)
      .where(eq(schema.accountMoves.icSourceMoveId, move.id));
    if (existing) return;
    const vendorId = await this.partnerOf(tx, move.companyId, target);
    if (!vendorId) return;
    const lines = await tx
      .select({
        line: schema.accountMoveLines,
        productType: schema.products.productType,
        soLine: schema.saleOrderLines,
        icPurchaseOrderId: schema.saleOrders.icPurchaseOrderId,
      })
      .from(schema.accountMoveLines)
      .leftJoin(schema.products, eq(schema.products.id, schema.accountMoveLines.productId))
      .leftJoin(schema.saleOrderLines, eq(schema.saleOrderLines.id, schema.accountMoveLines.saleLineId))
      .leftJoin(schema.saleOrders, eq(schema.saleOrders.id, schema.saleOrderLines.orderId))
      .where(
        and(eq(schema.accountMoveLines.moveId, move.id), eq(schema.accountMoveLines.displayType, "product")),
      )
      .orderBy(asc(schema.accountMoveLines.sequence));
    if (!lines.length) return;
    const books = await loadBooks(tx, target);
    const tax = books.settings.defaultPurchaseTaxId;

    // Baris PO pasangan: urutan baris PO otomatis sama dengan urutan baris SO.
    const purchaseLineIds: (string | null)[] = [];
    for (const r of lines) {
      let purchaseLineId: string | null = null;
      if (r.soLine) {
        const [po] = await tx
          .select({ id: schema.purchaseOrders.id })
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.companyId, target),
              r.icPurchaseOrderId
                ? eq(schema.purchaseOrders.id, r.icPurchaseOrderId)
                : eq(schema.purchaseOrders.icSaleOrderId, r.soLine.orderId),
            ),
          );
        if (po) {
          const [pl] = await tx
            .select({ id: schema.purchaseOrderLines.id, productId: schema.purchaseOrderLines.productId })
            .from(schema.purchaseOrderLines)
            .where(
              and(
                eq(schema.purchaseOrderLines.orderId, po.id),
                eq(schema.purchaseOrderLines.sequence, r.soLine.sequence),
              ),
            );
          if (pl && pl.productId === r.line.productId) purchaseLineId = pl.id;
        }
      }
      purchaseLineIds.push(purchaseLineId);
    }
    const billId = await withCompany(target, () =>
      this.moves.createInvoice(
        tx,
        {
          moveType: move.moveType === "out_invoice" ? "in_invoice" : "in_refund",
          partnerId: vendorId,
          date: invoice.date,
          dueDate: invoice.dueDate ?? invoice.date,
          ref: invoice.name,
          narration: `Dibuat otomatis dari ${invoice.name}`,
          currencyCode: invoice.currencyCode,
          lines: lines.map((r, i) => ({
            productId: r.line.productId,
            accountId:
              purchaseLineIds[i] && r.productType === "storable" ? books.settings.stockInputAccountId : null,
            name: r.line.name ?? "",
            quantity: d(r.line.quantity ?? 1).toFixed(4),
            priceUnit: d(r.line.priceUnit).toFixed(4),
            discount: r.line.discount,
            taxIds: r.line.taxIds.length && tax ? [tax] : [],
            businessUnitId: null,
            branchId: null,
          })),
        },
        target,
        { invoiceOrigin: invoice.invoiceOrigin ?? invoice.name ?? undefined, purchaseLineIds },
      ),
    );
    await tx
      .update(schema.accountMoves)
      .set({ icSourceMoveId: move.id })
      .where(eq(schema.accountMoves.id, billId));
    await this.activity.log(tx, {
      resModel: "account_move",
      resId: billId,
      action: "comment",
      message: `Dibuat otomatis dari ${invoice.name}`,
    });
  }

  // ---- Internal ----

  /** Perusahaan grup tujuan bila aturan aktif di perusahaan sumber dan user punya akses ke tujuan. */
  private async target(tx: Db, companyId: string, partnerId: string) {
    const [row] = await tx
      .select({ icCompanyId: schema.partners.icCompanyId, enabled: schema.companies.icAutoDocuments })
      .from(schema.partners)
      .innerJoin(schema.companies, eq(schema.companies.id, companyId))
      .where(eq(schema.partners.id, partnerId));
    const target = row?.icCompanyId;
    if (!row?.enabled || !target || target === companyId) return null;
    return currentContext().companyIds.includes(target) ? target : null;
  }

  /** Partner antar perusahaan yang mewakili `companyId` di buku `target`. */
  private async partnerOf(tx: Db, companyId: string, target: string) {
    const [partner] = await tx
      .select({ id: schema.partners.id })
      .from(schema.partners)
      .where(
        and(
          eq(schema.partners.icCompanyId, companyId),
          eq(schema.partners.active, true),
          or(isNull(schema.partners.companyId), eq(schema.partners.companyId, target)),
        ),
      )
      .limit(1);
    return partner?.id ?? null;
  }

  private async link(tx: Db, saleOrderId: string, purchaseOrderId: string) {
    await tx
      .update(schema.saleOrders)
      .set({ icPurchaseOrderId: purchaseOrderId })
      .where(eq(schema.saleOrders.id, saleOrderId));
    await tx
      .update(schema.purchaseOrders)
      .set({ icSaleOrderId: saleOrderId })
      .where(eq(schema.purchaseOrders.id, purchaseOrderId));
  }

  private async rate(tx: Db, from: string, to: string, date: string) {
    if (from === to) return d(1);
    const a = await this.fx.rateOn(tx, from, date);
    const b = await this.fx.rateOn(tx, to, date);
    return d(a.rate).div(b.rate);
  }
}
