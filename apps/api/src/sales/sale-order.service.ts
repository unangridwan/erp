import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  schema,
  sql,
  type Db,
  type PgColumn,
  type SQL,
} from "@erp/db";
import {
  LIST_LOAD_LIMIT,
  addDays,
  computeInvoice,
  type createInvoiceFromOrderSchema,
  type saleOrderSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import {
  assertDimensions,
  assertPartner,
  fieldError,
  loadBooks,
  type CompanyBooks,
} from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import {
  assertCompanyUser,
  assertPaymentTerm,
  assertPricelist,
  assertTeam,
  ownedScope,
} from "../crm/checks.js";
import { LeadService } from "../crm/lead.service.js";
import { uomRatio } from "../master/uom.js";
import { assertNotTemplate } from "../master/variant.service.js";
import { StockService, type LinkedDocument } from "../inventory/stock.service.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { renderOrderPdf } from "./order-pdf.js";
import { PricelistService } from "./pricelist.service.js";

export type OrderInput = z.infer<typeof saleOrderSchema>;
export type InvoiceFromOrderInput = z.infer<typeof createInvoiceFromOrderSchema>;
export type Order = typeof schema.saleOrders.$inferSelect;
/** Dipanggil setelah pesanan dikonfirmasi, dalam transaksi yang sama (mis. PO antar perusahaan). */
export type ConfirmHook = (tx: Db, order: Order) => Promise<void>;

const O = schema.saleOrders;
const OL = schema.saleOrderLines;
const scope = () => ownedScope(O.companyId, O.userId, "sales.all");
const dec = (v: Decimal.Value) => new Decimal(v);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Kuantitas tertagih per baris pesanan: faktur menambah, nota kredit (termasuk pembalikan faktur) mengurangi.
 * Draft ikut dihitung agar baris yang sama tidak ditagih dua kali.
 */
const qtyInvoiced = (lineId: PgColumn | SQL) => sql<string>`coalesce((
  select sum(case when m.move_type = 'out_invoice' then aml.quantity else -aml.quantity end)
  from ${schema.accountMoveLines} aml join ${schema.accountMoves} m on m.id = aml.move_id
  where aml.sale_line_id = ${lineId} and aml.display_type = 'product'), 0)`;

/**
 * Kuantitas terkirim per baris pesanan dalam satuan baris: pengiriman menambah, retur pelanggan mengurangi
 * (pergerakan stok dalam satuan produk, dibagi rasio satuan baris).
 */
const qtyDelivered = (lineId: PgColumn | SQL) => sql<string>`(coalesce((
  select sum(case when sm.origin_return_move_id is null then sm.quantity_done else -sm.quantity_done end)
  from ${schema.stockMoves} sm where sm.sale_line_id = ${lineId} and sm.state = 'done'), 0)
  / coalesce((select x.uom_ratio from ${OL} x where x.id = ${lineId}), 1))`;

/** Barang (stok/habis pakai) ditagih sebanyak yang terkirim; jasa sebanyak yang dipesan. */
const isGoods = sql.raw(
  `exists (select 1 from products p where p.id = l.product_id and p.product_type <> 'service')`,
);

/**
 * Status penagihan dihitung dari kuantitas terkirim/tertagih (selalu mutakhir walau faktur diubah di modul
 * akuntansi). Kolom ditulis lengkap dengan nama tabel: Drizzle tidak menyertakan nama tabel pada query tanpa
 * join, sehingga "id" di dalam subquery akan merujuk baris pesanan.
 */
const invoiceStatus = sql<Order["invoiceStatus"]>`case
  when sale_orders.state <> 'sale' then 'no'
  when exists (
    select 1 from ${OL} l where l.order_id = sale_orders.id and not l.is_downpayment
      and (case when ${isGoods} then ${qtyDelivered(sql`l.id`)} else l.quantity end) - ${qtyInvoiced(sql`l.id`)} > 0
  ) then 'to_invoice'
  when not exists (
    select 1 from ${OL} l where l.order_id = sale_orders.id and not l.is_downpayment
      and ${qtyInvoiced(sql`l.id`)} < l.quantity
  ) then 'invoiced'
  else 'no' end`;

/** Status pengiriman barang pesanan. */
const deliveryStatus = sql<"no" | "pending" | "partial" | "full">`case
  when sale_orders.state <> 'sale' or not exists (select 1 from ${OL} l where l.order_id = sale_orders.id
    and not l.is_downpayment and ${isGoods}) then 'no'
  when not exists (select 1 from ${OL} l where l.order_id = sale_orders.id and not l.is_downpayment and ${isGoods}
    and ${qtyDelivered(sql`l.id`)} < l.quantity) then 'full'
  when exists (select 1 from ${OL} l where l.order_id = sale_orders.id and ${qtyDelivered(sql`l.id`)} > 0) then 'partial'
  else 'pending' end`;

export interface OrderQuery {
  q?: string;
  state?: string;
  invoiceStatus?: string;
  partnerId?: string;
  leadId?: string;
  userId?: string;
  limit?: string;
  offset?: string;
}

@Injectable()
export class SaleOrderService implements OnModuleInit {
  readonly confirmHooks: ConfirmHook[] = [];

  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(PricelistService) private readonly pricelists: PricelistService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.stock.validateHooks.push((tx, picking) => this.refundFromReturn(tx, picking));
  }

  // ---- Baca ----

  async list(tx: Db, query: OrderQuery) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), LIST_LOAD_LIMIT);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters: (SQL | undefined)[] = [scope()];
    if (query.q) {
      const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(O.name, term), ilike(schema.partners.name, term), ilike(O.clientOrderRef, term)));
    }
    const states = (query.state ?? "")
      .split(",")
      .filter((s): s is Order["state"] => ["draft", "sent", "sale", "cancel"].includes(s));
    if (states.length) filters.push(inArray(O.state, states));
    if (query.invoiceStatus && ["no", "to_invoice", "invoiced"].includes(query.invoiceStatus))
      filters.push(sql`${invoiceStatus} = ${query.invoiceStatus}`);
    if (query.partnerId) filters.push(eq(O.partnerId, query.partnerId));
    if (query.leadId) filters.push(eq(O.leadId, query.leadId));
    if (query.userId === "me") filters.push(eq(O.userId, currentContext().userId));
    else if (query.userId) filters.push(eq(O.userId, query.userId));
    const where = and(...filters);

    const rows = await tx
      .select({
        order: O,
        partnerName: schema.partners.name,
        userName: schema.users.name,
        invoiceStatus,
        deliveryStatus,
      })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .leftJoin(schema.users, eq(schema.users.id, O.userId))
      .where(where)
      .orderBy(desc(O.dateOrder), desc(O.name))
      .limit(limit)
      .offset(offset);
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .where(where);
    return {
      items: rows.map((r) => ({
        ...r.order,
        partnerName: r.partnerName,
        userName: r.userName,
        invoiceStatus: r.invoiceStatus,
        deliveryStatus: r.deliveryStatus,
      })),
      total,
      limit,
      offset,
    };
  }

  async get(tx: Db, id: string) {
    const order = await this.find(tx, id);
    const lines = await this.lines(tx, id);
    const books = await loadBooks(tx, order.companyId);
    const taxes = await this.taxBreakdown(tx, order, lines, books);
    const [names] = await tx
      .select({
        partnerName: schema.partners.name,
        userName: schema.users.name,
        paymentTermName: schema.paymentTerms.name,
        pricelistName: schema.pricelists.name,
        leadName: schema.crmLeads.name,
        warehouseName: schema.warehouses.name,
        deliveryStatus,
      })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .leftJoin(schema.users, eq(schema.users.id, O.userId))
      .leftJoin(schema.paymentTerms, eq(schema.paymentTerms.id, O.paymentTermId))
      .leftJoin(schema.pricelists, eq(schema.pricelists.id, O.pricelistId))
      .leftJoin(schema.crmLeads, eq(schema.crmLeads.id, O.leadId))
      .leftJoin(schema.warehouses, eq(schema.warehouses.id, O.warehouseId))
      .where(eq(O.id, id));
    const pickings = await tx
      .select({
        id: schema.stockPickings.id,
        name: schema.stockPickings.name,
        state: schema.stockPickings.state,
        pickingType: schema.stockPickings.pickingType,
        scheduledDate: schema.stockPickings.scheduledDate,
      })
      .from(schema.stockPickings)
      .where(eq(schema.stockPickings.saleOrderId, id))
      .orderBy(asc(schema.stockPickings.createdAt));
    const invoices = await tx
      .selectDistinct({
        id: schema.accountMoves.id,
        name: schema.accountMoves.name,
        moveType: schema.accountMoves.moveType,
        state: schema.accountMoves.state,
        date: schema.accountMoves.date,
        amountTotal: schema.accountMoves.amountTotal,
        paymentState: schema.accountMoves.paymentState,
      })
      .from(schema.accountMoves)
      .innerJoin(schema.accountMoveLines, eq(schema.accountMoveLines.moveId, schema.accountMoves.id))
      .innerJoin(OL, eq(OL.id, schema.accountMoveLines.saleLineId))
      .where(eq(OL.orderId, id))
      .orderBy(asc(schema.accountMoves.date));
    const dropshipOrders = await tx
      .select({
        id: schema.purchaseOrders.id,
        name: schema.purchaseOrders.name,
        state: schema.purchaseOrders.state,
      })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.dropshipSaleOrderId, id));
    const status = await this.refreshInvoiceStatus(tx, order);
    return { ...order, ...names, invoiceStatus: status, lines, taxes, invoices, pickings, dropshipOrders };
  }

  /** Pratinjau harga & total (onchange form) tanpa menyimpan. */
  async compute(tx: Db, input: OrderInput) {
    const prepared = await this.prepare(tx, input);
    return {
      currencyCode: prepared.header.currencyCode,
      paymentTermId: prepared.header.paymentTermId,
      pricelistId: prepared.header.pricelistId,
      userId: prepared.header.userId,
      lines: prepared.lines,
      taxes: prepared.taxes,
      amountUntaxed: prepared.header.amountUntaxed,
      amountTax: prepared.header.amountTax,
      amountTotal: prepared.header.amountTotal,
    };
  }

  // ---- Tulis ----

  async create(tx: Db, input: OrderInput) {
    const companyId = currentContext().companyId;
    const { header, lines } = await this.prepare(tx, input);
    const name = await this.sequences.next(
      tx,
      "sale.order",
      companyId,
      new Date(`${input.dateOrder}T00:00:00Z`),
    );
    const [order] = await tx
      .insert(O)
      .values({ ...header, companyId, name, createdBy: currentContext().userId })
      .returning();
    await tx.insert(OL).values(lines.map(({ productName: _p, ...l }) => ({ ...l, orderId: order!.id })));
    await this.activity.log(tx, { resModel: "sale_order", resId: order!.id, action: "create" });
    return this.get(tx, order!.id);
  }

  /** Ganti isi penawaran (hanya draft/terkirim). */
  async update(tx: Db, id: string, input: OrderInput) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "sent")
      throw new BadRequestException("Hanya penawaran (draft/terkirim) yang bisa diubah");
    const { header, lines } = await this.prepare(tx, input);
    await tx
      .update(O)
      .set({ ...header, updatedAt: sql`now()` })
      .where(eq(O.id, id));
    await tx.delete(OL).where(eq(OL.orderId, id));
    await tx.insert(OL).values(lines.map(({ productName: _p, ...l }) => ({ ...l, orderId: id })));
    await this.activity.log(tx, { resModel: "sale_order", resId: id, action: "update" });
    return this.get(tx, id);
  }

  async remove(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "cancel")
      throw new BadRequestException("Hanya penawaran draft atau pesanan batal yang bisa dihapus");
    if (await this.hasInvoiceLines(tx, id))
      throw new BadRequestException("Pesanan sudah punya faktur dan tidak bisa dihapus");
    const [picking] = await tx
      .select({ id: schema.stockPickings.id })
      .from(schema.stockPickings)
      .where(and(eq(schema.stockPickings.saleOrderId, id), ne(schema.stockPickings.state, "cancel")))
      .limit(1);
    if (picking) throw new BadRequestException("Pesanan sudah punya pengiriman");
    await tx.delete(schema.stockPickings).where(eq(schema.stockPickings.saleOrderId, id));
    await tx.delete(O).where(eq(O.id, id));
    await tx
      .delete(schema.scheduledActivities)
      .where(
        and(eq(schema.scheduledActivities.resModel, "sale_order"), eq(schema.scheduledActivities.resId, id)),
      );
    await this.activity.log(tx, { resModel: "sale_order", resId: id, action: "delete" });
  }

  /** Kirim penawaran via email (PDF terlampir); draft menjadi "terkirim". */
  async send(tx: Db, id: string, input: { to?: string | null; message?: string | null }) {
    const order = await this.find(tx, id, true);
    if (order.state === "cancel") throw new BadRequestException("Pesanan batal tidak bisa dikirim");
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, order.partnerId));
    const to = input.to || partner?.email;
    if (!to) throw fieldError("to", "Pelanggan belum punya email; isi alamat tujuan");
    const pdf = await this.pdf(tx, id);
    const title = order.state === "sale" ? "Pesanan Penjualan" : "Penawaran";
    await this.mailer.send({
      to,
      subject: `${title} ${order.name}`,
      text:
        input.message ||
        `Yth. ${partner?.name ?? "Pelanggan"},\n\nTerlampir ${title.toLowerCase()} ${order.name} ` +
          `senilai ${order.currencyCode} ${new Intl.NumberFormat("id-ID").format(Number(order.amountTotal))}.\n\nTerima kasih.`,
      attachments: [{ filename: pdf.filename, content: pdf.content, contentType: "application/pdf" }],
    });
    if (order.state === "draft") {
      await tx
        .update(O)
        .set({ state: "sent", updatedAt: sql`now()` })
        .where(eq(O.id, id));
    }
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: id,
      action: "comment",
      message: `${title} dikirim ke ${to}`,
    });
    return this.get(tx, id);
  }

  /**
   * Konfirmasi penawaran menjadi pesanan: pengiriman barang dibuat otomatis dan peluang CRM terkait
   * ditandai menang.
   */
  async confirm(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "sent")
      throw new BadRequestException("Hanya penawaran yang bisa dikonfirmasi");
    const lines = await this.lines(tx, id);
    if (!lines.some((l) => dec(l.quantity).gt(0)))
      throw new BadRequestException("Pesanan harus punya minimal satu baris dengan kuantitas");
    await tx
      .update(O)
      .set({ state: "sale", confirmedAt: new Date(), invoiceStatus: "to_invoice", updatedAt: sql`now()` })
      .where(eq(O.id, id));
    const goods = lines.filter(
      (l) =>
        !l.isDownpayment &&
        !l.dropship &&
        l.productId &&
        l.productType !== "service" &&
        dec(l.quantity).gt(0),
    );
    if (goods.length) {
      await this.stock.createPicking(tx, {
        companyId: order.companyId,
        pickingType: "outgoing",
        warehouseId: order.warehouseId ?? (await this.stock.defaultWarehouse(tx, order.companyId)).id,
        partnerId: order.partnerId,
        scheduledDate: order.dateOrder,
        origin: order.name,
        saleOrderId: order.id,
        // Pergerakan stok dalam satuan produk.
        moves: goods.map((l) => ({
          productId: l.productId!,
          name: l.name,
          quantity: dec(l.quantity).times(l.uomRatio).toDecimalPlaces(4).toFixed(4),
          saleLineId: l.id,
        })),
      });
    }
    if (order.leadId) await this.leads.winFromOrder(tx, order.leadId, order.name);
    for (const hook of this.confirmHooks) await hook(tx, { ...order, state: "sale" });
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: id,
      action: "update",
      message: "Pesanan dikonfirmasi",
    });
    return this.get(tx, id);
  }

  /** Batalkan; ditolak bila masih ada faktur draft atau kuantitas tertagih (buat nota kredit dulu). */
  async cancel(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state === "cancel") return this.get(tx, id);
    const [draftInvoice] = await tx
      .select({ id: schema.accountMoves.id })
      .from(schema.accountMoves)
      .innerJoin(schema.accountMoveLines, eq(schema.accountMoveLines.moveId, schema.accountMoves.id))
      .innerJoin(OL, eq(OL.id, schema.accountMoveLines.saleLineId))
      .where(and(eq(OL.orderId, id), eq(schema.accountMoves.state, "draft")))
      .limit(1);
    if (draftInvoice) throw new BadRequestException("Hapus draft faktur pesanan ini terlebih dahulu");
    const lines = await this.lines(tx, id);
    if (lines.some((l) => !dec(l.qtyInvoiced).isZero()))
      throw new BadRequestException("Pesanan sudah ditagih; buat nota kredit sebelum membatalkan");
    if (lines.some((l) => !dec(l.qtyDelivered).isZero()))
      throw new BadRequestException("Barang sudah dikirim; buat retur sebelum membatalkan");
    const open = await tx
      .select({ id: schema.stockPickings.id })
      .from(schema.stockPickings)
      .where(
        and(
          eq(schema.stockPickings.saleOrderId, id),
          inArray(schema.stockPickings.state, ["draft", "ready"]),
        ),
      );
    for (const p of open) await this.stock.cancel(tx, p.id);
    await tx
      .update(O)
      .set({ state: "cancel", invoiceStatus: "no", updatedAt: sql`now()` })
      .where(eq(O.id, id));
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: id,
      action: "update",
      message: "Pesanan dibatalkan",
    });
    return this.get(tx, id);
  }

  async resetToDraft(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "cancel")
      throw new BadRequestException("Hanya pesanan batal yang bisa dijadikan draft");
    await tx
      .update(O)
      .set({ state: "draft", confirmedAt: null, updatedAt: sql`now()` })
      .where(eq(O.id, id));
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: id,
      action: "update",
      message: "Dijadikan draft",
    });
    return this.get(tx, id);
  }

  /**
   * Buat draft faktur dari pesanan.
   * - regular: sisa kuantitas yang belum ditagih + potongan uang muka yang sudah ditagih.
   * - percentage/fixed: faktur uang muka (baris DP baru di pesanan, akun uang muka pelanggan),
   *   dibagi per kombinasi pajak sebanding subtotalnya.
   */
  async createInvoice(tx: Db, id: string, input: InvoiceFromOrderInput) {
    const order = await this.find(tx, id, true);
    if (order.state !== "sale") throw new BadRequestException("Konfirmasi pesanan sebelum membuat faktur");
    const books = await loadBooks(tx, order.companyId);
    const lines = await this.lines(tx, id);
    const date = input.date ?? today();
    const decimals = await this.currencyDecimals(tx, order.currencyCode);

    type InvLine = {
      saleLineId: string;
      uomId?: string | null;
      productId: string | null;
      accountId: string | null;
      name: string;
      quantity: string;
      priceUnit: string;
      discount: string;
      taxIds: string[];
    };
    const invLines: InvLine[] = [];
    const dpAccount = () => {
      const accountId = books.settings.downPaymentAccountId;
      if (!accountId)
        throw new BadRequestException("Akun uang muka pelanggan belum diatur di pengaturan akuntansi");
      return accountId;
    };

    if (input.method === "regular") {
      for (const l of lines.filter((x) => !x.isDownpayment)) {
        // Barang: sebanyak yang sudah terkirim; jasa: sebanyak yang dipesan.
        const basis = l.productId && l.productType !== "service" ? l.qtyDelivered : l.quantity;
        const remaining = dec(basis).minus(l.qtyInvoiced);
        if (remaining.lte(0)) continue;
        invLines.push({
          saleLineId: l.id,
          uomId: l.uomId,
          productId: l.productId,
          accountId: null,
          name: l.name,
          quantity: remaining.toFixed(4),
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds,
        });
      }
      if (!invLines.length) throw new BadRequestException("Tidak ada kuantitas yang perlu ditagih");
      // Potong uang muka yang sudah ditagih (kuantitas negatif → kuantitas tertagih DP kembali 0).
      for (const l of lines.filter((x) => x.isDownpayment && dec(x.qtyInvoiced).gt(0))) {
        invLines.push({
          saleLineId: l.id,
          productId: null,
          accountId: dpAccount(),
          name: `Potongan ${l.name}`,
          quantity: dec(l.qtyInvoiced).negated().toFixed(4),
          priceUnit: l.priceUnit,
          discount: "0",
          taxIds: l.taxIds,
        });
      }
    } else {
      const regular = lines.filter((l) => !l.isDownpayment);
      const untaxed = regular.reduce((sum, l) => sum.plus(l.priceSubtotal), dec(0));
      if (untaxed.lte(0)) throw new BadRequestException("Nilai pesanan nol");
      const target =
        input.method === "percentage" ? untaxed.times(input.percentage).div(100) : dec(input.amount);
      if (target.gt(untaxed)) throw fieldError("amount", "Uang muka melebihi nilai pesanan sebelum pajak");
      // Kelompokkan per kombinasi pajak agar PPN uang muka sesuai baris pesanannya.
      const groups = new Map<string, { taxIds: string[]; subtotal: Decimal }>();
      for (const l of regular) {
        const key = [...l.taxIds].sort().join(",");
        const g = groups.get(key) ?? { taxIds: l.taxIds, subtotal: dec(0) };
        g.subtotal = g.subtotal.plus(l.priceSubtotal);
        groups.set(key, g);
      }
      const label = input.method === "percentage" ? `Uang muka ${input.percentage}%` : "Uang muka";
      let allocated = dec(0);
      const entries = [...groups.values()].filter((g) => g.subtotal.gt(0));
      const maxSeq = Math.max(0, ...lines.map((l) => l.sequence));
      for (const [i, g] of entries.entries()) {
        // Sisa pembulatan masuk ke kelompok terakhir agar jumlahnya tepat.
        const amount =
          i === entries.length - 1
            ? target.minus(allocated)
            : target.times(g.subtotal).div(untaxed).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
        allocated = allocated.plus(amount);
        const [dpLine] = await tx
          .insert(OL)
          .values({
            orderId: id,
            sequence: maxSeq + 1 + i,
            name: `${label} — ${order.name}`,
            quantity: "0",
            priceUnit: amount.toFixed(4),
            discount: "0",
            taxIds: g.taxIds,
            priceSubtotal: "0",
            isDownpayment: true,
          })
          .returning({ id: OL.id, name: OL.name });
        invLines.push({
          saleLineId: dpLine!.id,
          productId: null,
          accountId: dpAccount(),
          name: dpLine!.name,
          quantity: "1",
          priceUnit: amount.toFixed(4),
          discount: "0",
          taxIds: g.taxIds,
        });
      }
    }

    const preview = computeInvoice(
      invLines,
      await this.taxRules(
        tx,
        invLines.flatMap((l) => l.taxIds),
      ),
      decimals,
    );
    if (dec(preview.amountTotal).lte(0))
      throw new BadRequestException("Total faktur tidak positif (uang muka melebihi sisa tagihan)");

    const term = order.paymentTermId ? await assertPaymentTerm(tx, order.paymentTermId) : null;
    const moveId = await this.moves.createInvoice(
      tx,
      {
        moveType: "out_invoice",
        partnerId: order.partnerId,
        date,
        dueDate: addDays(date, term?.days ?? 0),
        ref: order.clientOrderRef ?? order.name,
        narration: null,
        currencyCode: order.currencyCode,
        lines: invLines.map((l) => ({
          productId: l.productId,
          accountId: l.accountId,
          name: l.name,
          quantity: l.quantity,
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds,
          businessUnitId: order.businessUnitId,
          branchId: order.branchId,
          uomId: l.uomId ?? null,
        })),
      },
      order.companyId,
      { invoiceOrigin: order.name, saleLineIds: invLines.map((l) => l.saleLineId) },
    );
    await this.refreshInvoiceStatus(tx, order);
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: id,
      action: "comment",
      message: input.method === "regular" ? "Faktur dibuat" : "Faktur uang muka dibuat",
    });
    return { moveId };
  }

  /**
   * Retur pelanggan atas barang yang sudah ditagih: draft nota kredit sebanyak kelebihan tagihan
   * (kuantitas tertagih − terkirim setelah retur), dengan harga pesanan.
   */
  private async refundFromReturn(
    tx: Db,
    picking: typeof schema.stockPickings.$inferSelect,
  ): Promise<LinkedDocument | null> {
    if (!picking.saleOrderId || !picking.returnOfId) return null;
    const [order] = await tx.select().from(O).where(eq(O.id, picking.saleOrderId));
    if (!order) return null;
    const returned = await tx
      .select({ saleLineId: schema.stockMoves.saleLineId, qty: schema.stockMoves.quantityDone })
      .from(schema.stockMoves)
      .where(and(eq(schema.stockMoves.pickingId, picking.id), eq(schema.stockMoves.state, "done")));
    const lines = await this.lines(tx, order.id);
    const refund = lines.flatMap((l) => {
      // Pergerakan dalam satuan produk → satuan baris.
      const qty = returned
        .filter((r) => r.saleLineId === l.id)
        .reduce((sum, r) => sum.plus(r.qty), dec(0))
        .div(l.uomRatio)
        .toDecimalPlaces(4);
      const over = Decimal.min(qty, dec(l.qtyInvoiced).minus(l.qtyDelivered));
      return qty.gt(0) && over.gt(0) ? [{ l, qty: over }] : [];
    });
    if (!refund.length) return null;
    const date = today();
    const moveId = await this.moves.createInvoice(
      tx,
      {
        moveType: "out_refund",
        partnerId: order.partnerId,
        date,
        dueDate: date,
        ref: `Retur ${picking.name}`,
        narration: null,
        currencyCode: order.currencyCode,
        lines: refund.map(({ l, qty }) => ({
          productId: l.productId,
          accountId: null,
          name: l.name,
          quantity: qty.toFixed(4),
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds,
          businessUnitId: order.businessUnitId,
          branchId: order.branchId,
          uomId: l.uomId,
        })),
      },
      order.companyId,
      { invoiceOrigin: order.name, saleLineIds: refund.map(({ l }) => l.id) },
    );
    await this.refreshInvoiceStatus(tx, order);
    await this.activity.log(tx, {
      resModel: "sale_order",
      resId: order.id,
      action: "comment",
      message: `Draft nota kredit dibuat dari retur ${picking.name}`,
    });
    return { model: "account_move", id: moveId, moveType: "out_refund", label: "Draft nota kredit" };
  }

  /** PDF penawaran/pesanan. */
  async pdf(tx: Db, id: string) {
    const order = await this.get(tx, id);
    const [company] = await tx
      .select({ name: schema.companies.name, npwp: schema.companies.npwp })
      .from(schema.companies)
      .where(eq(schema.companies.id, order.companyId));
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, order.partnerId));
    const title = order.state === "sale" ? "Pesanan Penjualan" : "Penawaran";
    const content = await renderOrderPdf({
      title,
      name: order.name,
      company: { name: company?.name ?? "", npwp: company?.npwp ?? null },
      partner: {
        name: partner?.name ?? "",
        street: partner?.street ?? null,
        city: partner?.city ?? null,
        npwp: partner?.npwp ?? null,
      },
      dateOrder: order.dateOrder,
      validityDate: order.validityDate,
      paymentTerm: order.paymentTermName ?? null,
      salesperson: order.userName ?? null,
      clientOrderRef: order.clientOrderRef,
      currencyCode: order.currencyCode,
      lines: order.lines
        .filter((l) => !l.isDownpayment)
        .map((l) => ({
          name: l.name,
          quantity: l.quantity,
          priceUnit: l.priceUnit,
          discount: l.discount,
          subtotal: l.priceSubtotal,
        })),
      taxes: order.taxes,
      amountUntaxed: order.amountUntaxed,
      amountTotal: order.amountTotal,
      note: order.note,
    });
    return { filename: `${order.name.replace(/[^\w.-]+/g, "_")}.pdf`, content };
  }

  // ---- Laporan ----

  /** Analisis penjualan dari pesanan terkonfirmasi, dikelompokkan per produk/pelanggan/penjual/bulan. */
  async report(
    tx: Db,
    input: { from: string; to: string; groupBy: "product" | "partner" | "salesperson" | "month" },
  ) {
    const where = and(
      scope(),
      eq(O.state, "sale"),
      sql`${O.dateOrder} between ${input.from} and ${input.to}`,
    );
    if (input.groupBy === "product") {
      return tx
        .select({
          key: sql<string | null>`${OL.productId}::text`,
          label: sql<string>`coalesce(${schema.products.name}, ${OL.name})`,
          quantity: sql<string>`sum(${OL.quantity})::text`,
          amount: sql<string>`sum(${OL.priceSubtotal})::text`,
          orders: sql<number>`count(distinct ${O.id})::int`,
        })
        .from(OL)
        .innerJoin(O, eq(O.id, OL.orderId))
        .leftJoin(schema.products, eq(schema.products.id, OL.productId))
        .where(and(where, eq(OL.isDownpayment, false)))
        .groupBy(OL.productId, sql`coalesce(${schema.products.name}, ${OL.name})`)
        .orderBy(sql`sum(${OL.priceSubtotal}) desc`);
    }
    const group =
      input.groupBy === "partner"
        ? { key: sql<string>`${O.partnerId}::text`, label: sql<string>`max(${schema.partners.name})` }
        : input.groupBy === "salesperson"
          ? {
              key: sql<string | null>`${O.userId}::text`,
              label: sql<string>`coalesce(max(${schema.users.name}), '—')`,
            }
          : {
              key: sql<string>`to_char(${O.dateOrder}, 'YYYY-MM')`,
              label: sql<string>`to_char(${O.dateOrder}, 'YYYY-MM')`,
            };
    return tx
      .select({
        key: group.key,
        label: group.label,
        amount: sql<string>`sum(${O.amountUntaxed})::text`,
        amountTotal: sql<string>`sum(${O.amountTotal})::text`,
        orders: sql<number>`count(*)::int`,
      })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .leftJoin(schema.users, eq(schema.users.id, O.userId))
      .where(where)
      .groupBy(group.key)
      .orderBy(input.groupBy === "month" ? asc(group.key) : sql`sum(${O.amountUntaxed}) desc`);
  }

  // ---- Internal ----

  private async find(tx: Db, id: string, lock = false): Promise<Order> {
    const query = tx
      .select()
      .from(O)
      .where(and(eq(O.id, id), scope()));
    const [order] = lock ? await query.for("update") : await query;
    if (!order) throw new NotFoundException("Pesanan tidak ditemukan");
    return order;
  }

  private async lines(tx: Db, orderId: string) {
    const rows = await tx
      .select({
        line: OL,
        productName: schema.products.name,
        productType: schema.products.productType,
        uomName: schema.uoms.name,
        qtyInvoiced: qtyInvoiced(sql`sale_order_lines.id`),
        qtyDelivered: qtyDelivered(sql`sale_order_lines.id`),
      })
      .from(OL)
      .leftJoin(schema.products, eq(schema.products.id, OL.productId))
      .leftJoin(schema.uoms, eq(schema.uoms.id, OL.uomId))
      .where(eq(OL.orderId, orderId))
      .orderBy(asc(OL.sequence));
    return rows.map((r) => ({
      ...r.line,
      productName: r.productName,
      productType: r.productType,
      uomName: r.uomName,
      qtyInvoiced: dec(r.qtyInvoiced).toFixed(4),
      qtyDelivered: dec(r.qtyDelivered).toFixed(4),
    }));
  }

  private async hasInvoiceLines(tx: Db, orderId: string) {
    const [row] = await tx
      .select({ id: schema.accountMoveLines.id })
      .from(schema.accountMoveLines)
      .innerJoin(OL, eq(OL.id, schema.accountMoveLines.saleLineId))
      .where(eq(OL.orderId, orderId))
      .limit(1);
    return Boolean(row);
  }

  /** Simpan status penagihan terhitung bila berubah (kolom dipakai laporan/indeks). */
  private async refreshInvoiceStatus(tx: Db, order: Order) {
    const [row] = await tx.select({ status: invoiceStatus }).from(O).where(eq(O.id, order.id));
    const status = row?.status ?? order.invoiceStatus;
    if (status !== order.invoiceStatus) {
      await tx.update(O).set({ invoiceStatus: status }).where(eq(O.id, order.id));
    }
    return status;
  }

  /**
   * Pajak bawaan barang mewah: PPN barang mewah (DPP = harga jual, PMK 131/2024) + PPnBM perusahaan bertarif sama
   * dengan tarif PPnBM produk.
   */
  private async luxuryTaxes(tx: Db, companyId: string, products: { luxuryTaxRate: string | null }[]) {
    if (!products.some((p) => p.luxuryTaxRate)) return () => [] as string[];
    const taxes = await tx
      .select({ id: schema.taxes.id, amount: schema.taxes.amount, kind: schema.taxes.taxKind })
      .from(schema.taxes)
      .where(
        and(
          eq(schema.taxes.companyId, companyId),
          eq(schema.taxes.typeTaxUse, "sale"),
          eq(schema.taxes.active, true),
          inArray(schema.taxes.taxKind, ["vat_luxury", "ppnbm"]),
        ),
      )
      .orderBy(asc(schema.taxes.name));
    const vat = taxes.find((t) => t.kind === "vat_luxury");
    return (rate: string, i: number) => {
      const ppnbm = taxes.find((t) => t.kind === "ppnbm" && dec(t.amount).eq(rate));
      if (!ppnbm)
        throw fieldError(
          `lines.${i}.taxIds`,
          `Pajak PPnBM ${dec(rate).toString()}% belum ada di perusahaan ini (buat di Akuntansi → Pajak, jenis PPnBM)`,
        );
      return vat ? [vat.id, ppnbm.id] : [ppnbm.id];
    };
  }

  private async currencyDecimals(tx: Db, code: string) {
    const [currency] = await tx.select().from(schema.currencies).where(eq(schema.currencies.code, code));
    if (!currency) throw fieldError("currencyCode", "Mata uang tidak dikenal");
    return currency.decimals;
  }

  private async taxRules(tx: Db, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    return tx
      .select({
        id: schema.taxes.id,
        name: schema.taxes.name,
        amount: schema.taxes.amount,
        baseRatio: schema.taxes.baseRatio,
        accountId: schema.taxes.accountId,
        companyId: schema.taxes.companyId,
        typeTaxUse: schema.taxes.typeTaxUse,
        active: schema.taxes.active,
      })
      .from(schema.taxes)
      .where(inArray(schema.taxes.id, unique));
  }

  private async taxBreakdown(
    tx: Db,
    order: Order,
    lines: { quantity: string; priceUnit: string; discount: string; taxIds: string[] }[],
    books: CompanyBooks,
  ) {
    const rules = await this.taxRules(
      tx,
      lines.flatMap((l) => l.taxIds),
    );
    const decimals = await this.currencyDecimals(tx, order.currencyCode).catch(() => books.decimals);
    const result = computeInvoice(lines, rules, decimals);
    return result.taxes
      .filter((t) => !dec(t.amount).isZero())
      .map((t) => ({
        taxId: t.taxId,
        name: rules.find((r) => r.id === t.taxId)?.name ?? "",
        base: dec(t.base).toFixed(2),
        amount: dec(t.amount).toFixed(2),
      }));
  }

  /** Validasi & lengkapi input: default dari pelanggan, harga dari daftar harga, pajak bawaan, total. */
  private async prepare(tx: Db, input: OrderInput) {
    const ctx = currentContext();
    const companyId = ctx.companyId;
    const books = await loadBooks(tx, companyId);
    const partner = await assertPartner(tx, companyId, input.partnerId);

    const pick = <T>(sent: T | null | undefined, fallback: T | null): T | null =>
      sent === undefined ? fallback : sent;
    const paymentTermId = pick(input.paymentTermId, partner.paymentTermId);
    const pricelistId = pick(input.pricelistId, partner.pricelistId);
    const userId = pick(input.userId, partner.salespersonId ?? ctx.userId);
    if (paymentTermId) await assertPaymentTerm(tx, paymentTermId);
    const pricelist = pricelistId ? await assertPricelist(tx, pricelistId) : null;
    if (userId) await assertCompanyUser(tx, userId);
    if (input.teamId) await assertTeam(tx, input.teamId);
    if (input.leadId)
      await this.leads.get(tx, input.leadId).catch(() => {
        throw fieldError("leadId", "Peluang tidak ditemukan");
      });
    await assertDimensions(tx, companyId, [
      { businessUnitId: input.businessUnitId, branchId: input.branchId },
    ]);
    const warehouseId = input.warehouseId ?? (await this.stock.defaultWarehouse(tx, companyId)).id;
    await this.stock.warehouse(tx, warehouseId, companyId);
    if (input.validityDate && input.validityDate < input.dateOrder)
      throw fieldError("validityDate", "Tanggal berlaku sebelum tanggal penawaran");

    const currencyCode = pricelist?.currencyCode ?? books.currencyCode;
    const decimals = await this.currencyDecimals(tx, currencyCode);

    const productIds = [...new Set(input.lines.flatMap((l) => (l.productId ? [l.productId] : [])))];
    const products = productIds.length
      ? await tx
          .select()
          .from(schema.products)
          .where(
            and(
              inArray(schema.products.id, productIds),
              or(isNull(schema.products.companyId), eq(schema.products.companyId, companyId)),
            ),
          )
      : [];
    const defaultTaxIds = books.settings.defaultSaleTaxId ? [books.settings.defaultSaleTaxId] : [];
    const luxuryTaxes = await this.luxuryTaxes(tx, companyId, products);

    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const product = l.productId ? products.find((p) => p.id === l.productId) : undefined;
      if (l.productId && !product) throw fieldError(`lines.${i}.productId`, "Produk tidak ditemukan");
      if (product) assertNotTemplate(product, `lines.${i}.productId`);
      const name = l.name || product?.name;
      if (!name) throw fieldError(`lines.${i}.name`, "Isi deskripsi atau pilih produk");
      // Satuan baris: input → satuan jual produk → satuan produk.
      const uomId = product ? (l.uomId ?? product.saleUomId ?? product.uomId) : (l.uomId ?? null);
      const ratio = product ? await uomRatio(tx, product.uomId, uomId, `lines.${i}.uomId`) : dec(1);
      let priceUnit = l.priceUnit;
      if (priceUnit == null) {
        if (!product) throw fieldError(`lines.${i}.priceUnit`, "Isi harga satuan");
        // Daftar harga berlaku per satuan produk.
        const base = await this.pricelists.priceFor(
          tx,
          pricelist,
          product,
          dec(l.quantity).times(ratio).toFixed(4),
          input.dateOrder,
          books.currencyCode,
        );
        priceUnit = dec(base).times(ratio).toFixed(4);
      }
      const dropship = l.dropship ?? product?.dropship ?? false;
      if (dropship && (!product || product.productType === "service"))
        throw fieldError(`lines.${i}.dropship`, "Dropship hanya untuk barang");
      lines.push({
        sequence: i,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        name,
        quantity: l.quantity,
        priceUnit: dec(priceUnit).toFixed(4),
        discount: l.discount,
        taxIds: l.taxIds ?? (product?.luxuryTaxRate ? luxuryTaxes(product.luxuryTaxRate, i) : defaultTaxIds),
        priceSubtotal: "0",
        isDownpayment: false,
        uomId,
        uomRatio: ratio.toFixed(6),
        dropship,
      });
    }

    const rules = await this.taxRules(
      tx,
      lines.flatMap((l) => l.taxIds),
    );
    for (const [i, l] of lines.entries()) {
      for (const taxId of l.taxIds) {
        const tax = rules.find((t) => t.id === taxId);
        if (!tax || tax.companyId !== companyId || tax.typeTaxUse !== "sale" || !tax.active)
          throw fieldError(`lines.${i}.taxIds`, "Pajak tidak ditemukan atau bukan pajak penjualan");
      }
    }
    const result = computeInvoice(lines, rules, decimals);
    lines.forEach((l, i) => (l.priceSubtotal = dec(result.lines[i]!.subtotal).toFixed(2)));

    return {
      header: {
        partnerId: partner.id,
        dateOrder: input.dateOrder,
        validityDate: input.validityDate ?? null,
        paymentTermId,
        pricelistId,
        currencyCode,
        userId,
        teamId: input.teamId ?? null,
        leadId: input.leadId ?? null,
        warehouseId,
        clientOrderRef: input.clientOrderRef ?? null,
        note: input.note ?? null,
        branchId: input.branchId ?? null,
        businessUnitId: input.businessUnitId ?? null,
        amountUntaxed: dec(result.amountUntaxed).toFixed(2),
        amountTax: dec(result.amountTax).toFixed(2),
        amountTotal: dec(result.amountTotal).toFixed(2),
      },
      lines,
      taxes: result.taxes
        .filter((t) => !dec(t.amount).isZero())
        .map((t) => ({
          taxId: t.taxId,
          name: rules.find((r) => r.id === t.taxId)!.name,
          base: dec(t.base).toFixed(2),
          amount: dec(t.amount).toFixed(2),
        })),
    };
  }
}
