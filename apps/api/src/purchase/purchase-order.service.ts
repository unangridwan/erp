import {
  BadRequestException,
  ForbiddenException,
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
  hasPermission,
  limitFor,
  pickSupplier,
  withinLimit,
  type billFromOrderSchema,
  type purchaseOrderSchema,
} from "@erp/shared";
import { customPdfRows, normalizeCustom } from "../customization/custom-values.js";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertDimensions, assertPartner, fieldError, loadBooks } from "../accounting/context.js";
import { MoveService, type PostedMove } from "../accounting/move.service.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import { assertCompanyUser, assertPaymentTerm } from "../crm/checks.js";
import { StockService, type LinkedDocument } from "../inventory/stock.service.js";
import { FxService } from "../master/fx.controller.js";
import { uomRatio } from "../master/uom.js";
import { assertNotTemplate } from "../master/variant.service.js";
import { renderOrderPdf } from "../sales/order-pdf.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { orderContractWarnings, resolveContract } from "./contract-check.js";
import {
  actsForAny,
  limitsFor,
  planSteps,
  roleNames,
  saveSteps,
  stepUsers,
  storedSteps,
  userRoleIds,
} from "../approval-rules/resolver.js";
import { companyToday } from "../common/company-date.js";

export type PurchaseInput = z.infer<typeof purchaseOrderSchema>;
export type Order = typeof schema.purchaseOrders.$inferSelect;
/** Dipanggil setelah PO dikonfirmasi/disetujui, dalam transaksi yang sama (mis. SO antar perusahaan). */
export type ConfirmHook = (tx: Db, order: Order) => Promise<void>;

const O = schema.purchaseOrders;
const OL = schema.purchaseOrderLines;
const d = (v: Decimal.Value) => new Decimal(v ?? 0);

/**
 * Kuantitas diterima per baris PO dalam satuan baris: penerimaan menambah, retur ke pemasok mengurangi
 * (pergerakan stok dalam satuan produk, dibagi rasio satuan baris).
 */
export const qtyReceived = (lineId: PgColumn | SQL) => sql<string>`(coalesce((
  select sum(case when m.origin_return_move_id is null then m.quantity_done else -m.quantity_done end)
  from ${schema.stockMoves} m where m.purchase_line_id = ${lineId} and m.state = 'done'), 0)
  / coalesce((select x.uom_ratio from ${schema.purchaseOrderLines} x where x.id = ${lineId}), 1))`;

/** Kuantitas ditagih per baris PO: tagihan menambah, nota debit (retur tagihan) mengurangi. */
export const qtyBilled = (lineId: PgColumn | SQL) => sql<string>`coalesce((
  select sum(case when am.move_type = 'in_invoice' then aml.quantity else -aml.quantity end)
  from ${schema.accountMoveLines} aml join ${schema.accountMoves} am on am.id = aml.move_id
  where aml.purchase_line_id = ${lineId} and aml.display_type = 'product'), 0)`;

/** Barang (stok/habis pakai) ditagih sebanyak yang diterima; jasa sebanyak yang dipesan. */
const isGoods = (alias: string) =>
  sql.raw(
    `exists (select 1 from products p where p.id = ${alias}.product_id and p.product_type <> 'service')`,
  );

/** Status penagihan PO (nama kolom lengkap karena query tanpa join tidak menyertakan nama tabel). */
const billStatus = sql<"no" | "to_invoice" | "invoiced">`case
  when purchase_orders.state <> 'purchase' then 'no'
  when exists (select 1 from ${OL} l where l.order_id = purchase_orders.id and
    (case when ${isGoods("l")} then ${qtyReceived(sql`l.id`)} else l.quantity end) - ${qtyBilled(sql`l.id`)} > 0)
    then 'to_invoice'
  when not exists (select 1 from ${OL} l where l.order_id = purchase_orders.id and ${qtyBilled(sql`l.id`)} < l.quantity)
    then 'invoiced'
  else 'no' end`;

/** Status penerimaan barang PO. */
const receiptStatus = sql<"no" | "pending" | "partial" | "full">`case
  when purchase_orders.state <> 'purchase' or not exists (select 1 from ${OL} l where l.order_id = purchase_orders.id and ${isGoods("l")}) then 'no'
  when not exists (select 1 from ${OL} l where l.order_id = purchase_orders.id and ${isGoods("l")} and ${qtyReceived(sql`l.id`)} < l.quantity) then 'full'
  when exists (select 1 from ${OL} l where l.order_id = purchase_orders.id and ${qtyReceived(sql`l.id`)} > 0) then 'partial'
  else 'pending' end`;

export interface PurchaseQuery {
  q?: string;
  state?: string;
  billStatus?: string;
  partnerId?: string;
  limit?: string;
  offset?: string;
}

@Injectable()
export class PurchaseOrderService implements OnModuleInit {
  readonly confirmHooks: ConfirmHook[] = [];

  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.stock.validateHooks.push((tx, picking) => this.refundFromReturn(tx, picking));
    this.moves.postHooks.push((tx, move) => this.priceDifference(tx, move));
  }

  async list(tx: Db, query: PurchaseQuery) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), LIST_LOAD_LIMIT);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters: (SQL | undefined)[] = [eq(O.companyId, currentContext().companyId)];
    if (query.q) {
      const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(O.name, term), ilike(schema.partners.name, term), ilike(O.partnerRef, term)));
    }
    const states = (query.state ?? "")
      .split(",")
      .filter((s): s is Order["state"] => ["draft", "sent", "to_approve", "purchase", "cancel"].includes(s));
    if (states.length) filters.push(inArray(O.state, states));
    if (query.billStatus && ["no", "to_invoice", "invoiced"].includes(query.billStatus))
      filters.push(sql`${billStatus} = ${query.billStatus}`);
    if (query.partnerId) filters.push(eq(O.partnerId, query.partnerId));
    const where = and(...filters);
    const rows = await tx
      .select({ order: O, partnerName: schema.partners.name, billStatus, receiptStatus })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
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
        billStatus: r.billStatus,
        receiptStatus: r.receiptStatus,
      })),
      total,
      limit,
      offset,
    };
  }

  async get(tx: Db, id: string) {
    const order = await this.find(tx, id);
    const lines = await this.lines(tx, id);
    const [extra] = await tx
      .select({
        partnerName: schema.partners.name,
        partnerEmail: schema.partners.email,
        paymentTermName: schema.paymentTerms.name,
        userName: schema.users.name,
        warehouseName: schema.warehouses.name,
        billStatus,
        receiptStatus,
      })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .leftJoin(schema.paymentTerms, eq(schema.paymentTerms.id, O.paymentTermId))
      .leftJoin(schema.users, eq(schema.users.id, O.userId))
      .leftJoin(schema.warehouses, eq(schema.warehouses.id, O.warehouseId))
      .where(eq(O.id, id));
    const rules = await this.taxRules(
      tx,
      lines.flatMap((l) => l.taxIds),
    );
    const taxes = computeInvoice(lines, rules, 2)
      .taxes.filter((t) => !d(t.amount).isZero())
      .map((t) => ({
        taxId: t.taxId,
        name: rules.find((r) => r.id === t.taxId)?.name ?? "",
        amount: d(t.amount).toFixed(2),
      }));
    const pickings = await tx
      .select({
        id: schema.stockPickings.id,
        name: schema.stockPickings.name,
        state: schema.stockPickings.state,
        pickingType: schema.stockPickings.pickingType,
        scheduledDate: schema.stockPickings.scheduledDate,
      })
      .from(schema.stockPickings)
      .where(eq(schema.stockPickings.purchaseOrderId, id))
      .orderBy(asc(schema.stockPickings.createdAt));
    const bills = await tx
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
      .innerJoin(OL, eq(OL.id, schema.accountMoveLines.purchaseLineId))
      .where(eq(OL.orderId, id))
      .orderBy(asc(schema.accountMoves.date));
    const [contract] = order.contractId
      ? await tx
          .select({ id: schema.purchaseContracts.id, name: schema.purchaseContracts.name })
          .from(schema.purchaseContracts)
          .where(eq(schema.purchaseContracts.id, order.contractId))
      : [];
    return {
      ...order,
      ...extra,
      lines,
      taxes,
      pickings,
      bills,
      contract: contract ?? null,
      contractWarnings:
        order.state === "draft" || order.state === "sent" || order.state === "to_approve"
          ? await orderContractWarnings(tx, order)
          : order.contractWarning
            ? order.contractWarning.split("\n")
            : [],
      approval: await this.approvalInfo(tx, order),
    };
  }

  /** PO yang menunggu persetujuan user login (untuk Kotak Persetujuan bersama dokumen lain). */
  async pendingApproval(tx: Db) {
    const rows = await tx
      .select({ order: O, partnerName: schema.partners.name })
      .from(O)
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .where(and(eq(O.companyId, currentContext().companyId), eq(O.state, "to_approve")))
      .orderBy(asc(O.dateOrder), asc(O.name));
    const out = [];
    for (const { order, partnerName } of rows) {
      const ok = await this.canApprove(tx, order).then(
        () => true,
        () => false,
      );
      if (!ok) continue;
      out.push({
        id: order.id,
        name: order.name,
        partnerName,
        amountTotal: order.amountTotal,
        currencyCode: order.currencyCode,
        step: order.approvalStep,
        levels: order.approvalLevels,
      });
    }
    return out;
  }

  /** Tahap persetujuan PO (aturan) & apakah user login boleh menyetujui. */
  private async approvalInfo(tx: Db, order: Order) {
    if (order.state !== "to_approve") return null;
    const ctx = currentContext();
    const steps = await storedSteps(tx, "purchase_order", order.id);
    const names = await roleNames(
      tx,
      steps.flatMap((s) => (s.approverRoleId ? [s.approverRoleId] : [])),
    );
    const users = new Map(
      (
        await tx
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(
            inArray(
              schema.users.id,
              steps.flatMap((s) => (s.approverUserId ? [s.approverUserId] : [])).concat(ctx.userId),
            ),
          )
      ).map((u) => [u.id, u.name]),
    );
    return {
      step: order.approvalStep,
      levels: order.approvalLevels,
      steps: steps.map((s) => ({
        step: s.step,
        label: s.label,
        approver: s.approverUserId
          ? (users.get(s.approverUserId) ?? "—")
          : s.approverRoleId
            ? `Peran ${names.get(s.approverRoleId) ?? ""}`.trim()
            : "Pemegang hak Setujui PO",
      })),
      canApprove: await this.canApprove(tx, order).then(
        () => true,
        () => false,
      ),
    };
  }

  async compute(tx: Db, input: PurchaseInput) {
    const prepared = await this.prepare(tx, input);
    return { ...prepared.header, lines: prepared.lines, taxes: prepared.taxes };
  }

  async create(tx: Db, input: PurchaseInput) {
    const companyId = currentContext().companyId;
    const { header, lines } = await this.prepare(tx, input);
    const name = await this.sequences.next(
      tx,
      "purchase.order",
      companyId,
      new Date(`${input.dateOrder}T00:00:00Z`),
    );
    const custom = await normalizeCustom(tx, "purchase_order", input.custom, null, companyId);
    const [order] = await tx
      .insert(O)
      .values({ ...header, companyId, name, custom, createdBy: currentContext().userId })
      .returning();
    await tx.insert(OL).values(lines.map(({ productName: _p, ...l }) => ({ ...l, orderId: order!.id })));
    await this.activity.log(tx, { resModel: "purchase_order", resId: order!.id, action: "create" });
    return order!;
  }

  async update(tx: Db, id: string, input: PurchaseInput) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "sent")
      throw new BadRequestException("Hanya RFQ (draft/terkirim) yang bisa diubah");
    const { header, lines } = await this.prepare(tx, input);
    const custom =
      input.custom === undefined
        ? undefined
        : await normalizeCustom(tx, "purchase_order", input.custom, order.custom, order.companyId);
    await tx
      .update(O)
      .set({ ...header, ...(custom ? { custom } : {}), updatedAt: sql`now()` })
      .where(eq(O.id, id));
    await tx.delete(OL).where(eq(OL.orderId, id));
    await tx.insert(OL).values(lines.map(({ productName: _p, ...l }) => ({ ...l, orderId: id })));
    await this.activity.log(tx, { resModel: "purchase_order", resId: id, action: "update" });
  }

  async remove(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "cancel")
      throw new BadRequestException("Hanya RFQ draft atau PO batal yang bisa dihapus");
    const [picking] = await tx
      .select({ id: schema.stockPickings.id })
      .from(schema.stockPickings)
      .where(and(eq(schema.stockPickings.purchaseOrderId, id), ne(schema.stockPickings.state, "cancel")))
      .limit(1);
    if (picking) throw new BadRequestException("PO sudah punya penerimaan barang");
    await tx.delete(schema.stockPickings).where(eq(schema.stockPickings.purchaseOrderId, id));
    await tx.delete(O).where(eq(O.id, id));
    await this.activity.log(tx, { resModel: "purchase_order", resId: id, action: "delete" });
  }

  async send(tx: Db, id: string, input: { to?: string | null; message?: string | null }) {
    const order = await this.find(tx, id, true);
    if (order.state === "cancel") throw new BadRequestException("PO batal tidak bisa dikirim");
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, order.partnerId));
    const to = input.to || partner?.email;
    if (!to) throw fieldError("to", "Pemasok belum punya email; isi alamat tujuan");
    const pdf = await this.pdf(tx, id);
    const title = order.state === "purchase" ? "Pesanan Pembelian" : "Permintaan Penawaran";
    await this.mailer.send({
      to,
      subject: `${title} ${order.name}`,
      text:
        input.message ||
        `Yth. ${partner?.name ?? "Pemasok"},\n\nTerlampir ${title.toLowerCase()} ${order.name}.\n\nTerima kasih.`,
      attachments: [{ filename: pdf.filename, content: pdf.content, contentType: "application/pdf" }],
    });
    if (order.state === "draft")
      await tx
        .update(O)
        .set({ state: "sent", updatedAt: sql`now()` })
        .where(eq(O.id, id));
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: id,
      action: "comment",
      message: `${title} dikirim ke ${to}`,
    });
  }

  /**
   * Konfirmasi RFQ menjadi PO. Bila Pembelian punya aturan persetujuan, tahapnya dibentuk dari nominal (mata uang
   * perusahaan). Tanpa aturan: PO di atas batas wewenang pembuat menunggu persetujuan. Batas pembuat = batas
   * pengguna/peran-nya; tanpa itu pemegang `purchase.approve` tanpa batas, lainnya batas default perusahaan (Aturan
   * Persetujuan, atau batas di Pengaturan Akuntansi).
   */
  async confirm(tx: Db, id: string) {
    const ctx = currentContext();
    const order = await this.find(tx, id, true);
    if (order.state !== "draft" && order.state !== "sent")
      throw new BadRequestException("Hanya RFQ yang bisa dikonfirmasi");
    const lines = await this.lines(tx, id);
    if (!lines.some((l) => d(l.quantity).gt(0)))
      throw new BadRequestException("PO harus punya minimal satu baris dengan kuantitas");
    const books = await loadBooks(tx, order.companyId);
    const amount = await this.companyAmount(tx, order, books.currencyCode);
    const requester = order.createdBy ?? ctx.userId;
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.userId, requester), eq(schema.employees.companyId, order.companyId)));
    const steps = await planSteps(tx, {
      companyId: order.companyId,
      docType: "purchase_order",
      value: amount.toFixed(2),
      employee: employee ?? null,
      requesterUserId: requester,
    });
    let levels = 0;
    if (steps) {
      if (steps.length) {
        await saveSteps(tx, "purchase_order", id, steps);
        levels = steps.length;
      }
    } else {
      const limits = await limitsFor(tx, order.companyId, "purchase_order");
      const roleIds = await userRoleIds(tx, ctx.userId, order.companyId);
      const own = limitFor(
        limits.filter((l) => l.userId || l.roleId),
        { userId: ctx.userId, roleIds },
      );
      const fallback = limitFor(
        limits.filter((l) => !l.userId && !l.roleId),
        { userId: ctx.userId, roleIds },
      );
      const legacy = books.settings.purchaseApprovalAmount;
      const limit =
        own !== undefined
          ? own
          : hasPermission(ctx.permissions, "purchase.approve")
            ? null
            : fallback !== undefined
              ? fallback
              : legacy === null
                ? undefined
                : Number(legacy);
      if (!withinLimit(limit, amount.toFixed(2))) levels = -1;
    }
    // PO yang melebihi sisa/plafon kontrak atau di luar masa kontrak wajib disetujui.
    const contractIssues = await orderContractWarnings(tx, order);
    if (order.contractId) {
      await tx
        .update(O)
        .set({ contractWarning: contractIssues.length ? contractIssues.join("\n") : null })
        .where(eq(O.id, id));
      if (contractIssues.length) {
        await this.activity.log(tx, {
          resModel: "purchase_order",
          resId: id,
          action: "update",
          message: `Di luar kontrak: ${contractIssues.join("; ")}`.slice(0, 1000),
        });
        if (levels === 0) levels = -1;
      }
    }
    if (levels !== 0) {
      await tx
        .update(O)
        .set({
          state: "to_approve",
          approvalRequestedAt: sql`now()`,
          approvalStep: 1,
          approvalLevels: Math.max(levels, 0),
          updatedAt: sql`now()`,
        })
        .where(eq(O.id, id));
      await this.activity.log(tx, {
        resModel: "purchase_order",
        resId: id,
        action: "update",
        message: levels > 0 ? `Menunggu persetujuan (${levels} tahap)` : "Menunggu persetujuan",
      });
      await this.notifyApprovers(tx, { ...order, approvalStep: 1, approvalLevels: Math.max(levels, 0) });
      return "to_approve" as const;
    }
    await this.toPurchase(tx, order, lines, books.currencyCode, null);
    return "purchase" as const;
  }

  /** Setujui tahap berjalan; tahap terakhir menjadikan PO. */
  async approve(tx: Db, id: string) {
    const ctx = currentContext();
    const order = await this.find(tx, id, true);
    if (order.state !== "to_approve") throw new BadRequestException("PO tidak sedang menunggu persetujuan");
    const { delegated } = await this.canApprove(tx, order);
    const books = await loadBooks(tx, order.companyId);
    const last = order.approvalStep >= order.approvalLevels;
    if (last) {
      // Penyetuju akhir harus punya batas wewenang yang cukup (bila batas pengguna/perannya diatur).
      const limits = (await limitsFor(tx, order.companyId, "purchase_order")).filter(
        (l) => l.userId || l.roleId,
      );
      const own = limitFor(limits, {
        userId: ctx.userId,
        roleIds: await userRoleIds(tx, ctx.userId, order.companyId),
      });
      const amount = await this.companyAmount(tx, order, books.currencyCode);
      if (!withinLimit(own, amount.toFixed(2)))
        throw new ForbiddenException(
          `Nominal melebihi batas wewenang Anda (Rp ${Number(own).toLocaleString("id-ID")})`,
        );
    }
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: id,
      action: "comment",
      message: `Tahap ${order.approvalStep}${order.approvalLevels ? `/${order.approvalLevels}` : ""} disetujui${
        delegated ? " sebagai delegasi" : ""
      }`,
    });
    if (!last) {
      await tx
        .update(O)
        .set({ approvalStep: order.approvalStep + 1, updatedAt: sql`now()` })
        .where(eq(O.id, id));
      await this.notifyApprovers(tx, { ...order, approvalStep: order.approvalStep + 1 });
      return;
    }
    await this.toPurchase(tx, order, await this.lines(tx, id), books.currencyCode, ctx.userId);
  }

  /** Penyetuju tahap berjalan: pengguna/pemegang peran tahap (atau delegasinya); tahap admin = `purchase.approve`. */
  private async canApprove(tx: Db, order: Order) {
    const ctx = currentContext();
    const step =
      order.approvalLevels > 0
        ? (await storedSteps(tx, "purchase_order", order.id)).find((s) => s.step === order.approvalStep)
        : undefined;
    if (step && (step.approverUserId || step.approverRoleId)) {
      const users = (await stepUsers(tx, step, order.companyId)).filter((u) => u !== order.createdBy);
      const acting = await actsForAny(tx, users, ctx.userId);
      if (!acting.ok) throw new ForbiddenException("Menunggu persetujuan penyetuju lain pada tahap ini");
      return acting;
    }
    if (!hasPermission(ctx.permissions, "purchase.approve"))
      throw new ForbiddenException("Butuh permission purchase.approve");
    if (order.createdBy === ctx.userId && order.approvalLevels > 0)
      throw new ForbiddenException("Tidak bisa menyetujui PO sendiri");
    return { ok: true, delegated: false };
  }

  /** Beri tahu penyetuju tahap berjalan (tahap admin: tidak ada penerima khusus). */
  private async notifyApprovers(tx: Db, order: Order) {
    if (order.approvalLevels === 0) return;
    const step = (await storedSteps(tx, "purchase_order", order.id)).find(
      (s) => s.step === order.approvalStep,
    );
    if (!step) return;
    const users = (await stepUsers(tx, step, order.companyId)).filter((u) => u !== order.createdBy);
    await this.notifications.notify(tx, users, {
      kind: "approval.pending",
      title: `PO ${order.name} menunggu persetujuan Anda`,
      body: `Rp ${d(order.amountTotal).toNumber().toLocaleString("id-ID")} ${order.currencyCode}`,
      link: `/purchase/orders/${order.id}`,
      companyId: order.companyId,
    });
  }

  /** Total PO dalam mata uang perusahaan. */
  private async companyAmount(tx: Db, order: Order, companyCurrency: string) {
    return d(order.amountTotal).times(
      await this.rate(tx, order.currencyCode, companyCurrency, order.dateOrder),
    );
  }

  /** Batalkan PO; ditolak bila sudah ada barang diterima atau tagihan. Penerimaan terbuka ikut dibatalkan. */
  async cancel(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state === "cancel") return;
    const lines = await this.lines(tx, id);
    if (lines.some((l) => !d(l.qtyReceived).isZero()))
      throw new BadRequestException("Barang sudah diterima; buat retur terlebih dahulu");
    if (lines.some((l) => !d(l.qtyBilled).isZero()))
      throw new BadRequestException("PO sudah ditagih; batalkan tagihannya terlebih dahulu");
    const [billDraft] = await tx
      .select({ id: schema.accountMoveLines.id })
      .from(schema.accountMoveLines)
      .innerJoin(OL, eq(OL.id, schema.accountMoveLines.purchaseLineId))
      .where(eq(OL.orderId, id))
      .limit(1);
    if (billDraft) throw new BadRequestException("Hapus draft tagihan PO ini terlebih dahulu");
    const open = await tx
      .select({ id: schema.stockPickings.id })
      .from(schema.stockPickings)
      .where(
        and(
          eq(schema.stockPickings.purchaseOrderId, id),
          inArray(schema.stockPickings.state, ["draft", "ready"]),
        ),
      );
    for (const p of open) await this.stock.cancel(tx, p.id);
    await tx
      .update(O)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(O.id, id));
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: id,
      action: "update",
      message: "PO dibatalkan",
    });
  }

  async resetToDraft(tx: Db, id: string) {
    const order = await this.find(tx, id, true);
    if (order.state !== "cancel") throw new BadRequestException("Hanya PO batal yang bisa dijadikan draft");
    await tx
      .update(O)
      .set({
        state: "draft",
        confirmedAt: null,
        approvedAt: null,
        approvedBy: null,
        approvalStep: 1,
        approvalLevels: 0,
        updatedAt: sql`now()`,
      })
      .where(eq(O.id, id));
  }

  /**
   * Draft tagihan pemasok dari PO (3-way matching): barang ditagih sebanyak yang sudah diterima dan belum
   * ditagih; jasa sebanyak yang dipesan. Barang stok dibebankan ke akun Barang Diterima Belum Ditagih.
   */
  async createBill(tx: Db, id: string, input: z.infer<typeof billFromOrderSchema>) {
    const order = await this.find(tx, id, true);
    if (order.state !== "purchase") throw new BadRequestException("Konfirmasi PO sebelum membuat tagihan");
    const books = await loadBooks(tx, order.companyId);
    const lines = await this.lines(tx, id);
    const billLines = lines.map((l) => ({ l, qty: d(l.qtyToBill) })).filter((x) => x.qty.gt(0));
    if (!billLines.length)
      throw new BadRequestException("Tidak ada kuantitas yang perlu ditagih (barang belum diterima?)");
    if (billLines.some((x) => x.l.productType === "storable") && !books.settings.stockInputAccountId)
      throw new BadRequestException("Akun Barang Diterima Belum Ditagih belum diatur");
    const date = input.date ?? (await companyToday(tx, order.companyId));
    const term = order.paymentTermId ? await assertPaymentTerm(tx, order.paymentTermId) : null;
    const moveId = await this.moves.createInvoice(
      tx,
      {
        moveType: "in_invoice",
        partnerId: order.partnerId,
        date,
        dueDate: addDays(date, term?.days ?? 0),
        ref: order.partnerRef ?? order.name,
        narration: null,
        currencyCode: order.currencyCode,
        lines: billLines.map(({ l, qty }) => ({
          productId: l.productId,
          accountId: l.productType === "storable" ? books.settings.stockInputAccountId : null,
          name: l.name,
          quantity: qty.toFixed(4),
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds,
          businessUnitId: order.businessUnitId,
          costCenterId: order.costCenterId,
          branchId: order.branchId,
          uomId: l.uomId,
        })),
      },
      order.companyId,
      { invoiceOrigin: order.name, purchaseLineIds: billLines.map(({ l }) => l.id) },
    );
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: id,
      action: "comment",
      message: "Tagihan dibuat",
    });
    return { moveId };
  }

  /** Baris PO dengan selisih diterima vs ditagih (3-way matching) pada PO terkonfirmasi. */
  async matching(tx: Db) {
    const rows = await tx
      .select({
        orderId: O.id,
        orderName: O.name,
        partnerName: schema.partners.name,
        lineId: OL.id,
        name: OL.name,
        quantity: OL.quantity,
        productType: schema.products.productType,
        received: qtyReceived(OL.id),
        billed: qtyBilled(OL.id),
      })
      .from(OL)
      .innerJoin(O, eq(O.id, OL.orderId))
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .leftJoin(schema.products, eq(schema.products.id, OL.productId))
      .where(and(eq(O.companyId, currentContext().companyId), eq(O.state, "purchase")))
      .orderBy(desc(O.dateOrder), asc(OL.sequence));
    return rows
      .map((r) => {
        const goods = r.productType !== null && r.productType !== "service";
        const received = d(r.received);
        const billed = d(r.billed);
        const basis = goods ? received : d(r.quantity);
        return {
          ...r,
          received: received.toFixed(4),
          billed: billed.toFixed(4),
          status: billed.gt(basis)
            ? ("over_billed" as const)
            : billed.lt(basis)
              ? ("to_bill" as const)
              : ("matched" as const),
        };
      })
      .filter((r) => r.status !== "matched");
  }

  async pdf(tx: Db, id: string) {
    const order = await this.get(tx, id);
    const [company] = await tx
      .select({ name: schema.companies.name, npwp: schema.companies.npwp })
      .from(schema.companies)
      .where(eq(schema.companies.id, order.companyId));
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, order.partnerId));
    const content = await renderOrderPdf({
      title: order.state === "purchase" ? "Pesanan Pembelian" : "Permintaan Penawaran",
      name: order.name,
      company: { name: company?.name ?? "", npwp: company?.npwp ?? null },
      partner: {
        name: partner?.name ?? "",
        street: partner?.street ?? null,
        city: partner?.city ?? null,
        npwp: partner?.npwp ?? null,
      },
      dateOrder: order.dateOrder,
      validityDate: order.datePlanned,
      paymentTerm: order.paymentTermName ?? null,
      salesperson: order.userName ?? null,
      clientOrderRef: order.partnerRef,
      currencyCode: order.currencyCode,
      lines: order.lines.map((l) => ({
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
      extra: await customPdfRows(tx, "purchase_order", order.custom, order.companyId),
    });
    return { filename: `${order.name.replace(/[^\w.-]+/g, "_")}.pdf`, content };
  }

  /** Analisis pembelian (PO terkonfirmasi) per pemasok/produk/bulan. */
  async report(tx: Db, input: { from: string; to: string; groupBy: "partner" | "product" | "month" }) {
    const where = and(
      eq(O.companyId, currentContext().companyId),
      eq(O.state, "purchase"),
      sql`${O.dateOrder} between ${input.from} and ${input.to}`,
    );
    const group =
      input.groupBy === "partner"
        ? { key: sql<string>`${O.partnerId}::text`, label: sql<string>`max(${schema.partners.name})` }
        : input.groupBy === "product"
          ? {
              key: sql<string | null>`${OL.productId}::text`,
              label: sql<string>`max(coalesce(${schema.products.name}, ${OL.name}))`,
            }
          : {
              key: sql<string>`to_char(${O.dateOrder}, 'YYYY-MM')`,
              label: sql<string>`to_char(${O.dateOrder}, 'YYYY-MM')`,
            };
    return tx
      .select({
        key: group.key,
        label: group.label,
        quantity: sql<string>`sum(${OL.quantity})::text`,
        amount: sql<string>`sum(${OL.priceSubtotal})::text`,
        orders: sql<number>`count(distinct ${O.id})::int`,
      })
      .from(OL)
      .innerJoin(O, eq(O.id, OL.orderId))
      .innerJoin(schema.partners, eq(schema.partners.id, O.partnerId))
      .leftJoin(schema.products, eq(schema.products.id, OL.productId))
      .where(where)
      .groupBy(group.key)
      .orderBy(input.groupBy === "month" ? asc(group.key) : sql`sum(${OL.priceSubtotal}) desc`);
  }

  // ---- Internal ----

  /** Ubah ke PO dan buat penerimaan barang (harga dalam mata uang perusahaan untuk valuasi). */
  private async toPurchase(
    tx: Db,
    order: Order,
    lines: Awaited<ReturnType<PurchaseOrderService["lines"]>>,
    companyCurrency: string,
    approvedBy: string | null,
  ) {
    await tx
      .update(O)
      .set({
        state: "purchase",
        confirmedAt: new Date(),
        ...(approvedBy ? { approvedBy, approvedAt: new Date() } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(O.id, order.id));
    const rate = await this.rate(tx, order.currencyCode, companyCurrency, order.dateOrder);
    const warehouseId = order.warehouseId ?? (await this.stock.defaultWarehouse(tx, order.companyId)).id;
    const goods = lines.filter((l) => l.productId && l.productType !== "service" && d(l.quantity).gt(0));
    if (goods.length) {
      // PO dropship: pemasok mengirim langsung ke pelanggan pesanan penjualannya.
      const [dropship] = order.dropshipSaleOrderId
        ? await tx
            .select({ id: schema.saleOrders.id })
            .from(schema.saleOrders)
            .where(eq(schema.saleOrders.id, order.dropshipSaleOrderId))
        : [];
      await this.stock.createPicking(tx, {
        companyId: order.companyId,
        pickingType: dropship ? "dropship" : "incoming",
        warehouseId,
        partnerId: order.partnerId,
        scheduledDate: order.datePlanned ?? order.dateOrder,
        origin: order.name,
        purchaseOrderId: order.id,
        saleOrderId: dropship?.id ?? null,
        // Kuantitas & harga dalam satuan produk.
        moves: goods.map((l) => ({
          productId: l.productId!,
          name: l.name,
          quantity: d(l.quantity).times(l.uomRatio).toDecimalPlaces(4).toFixed(4),
          // Harga bersih setelah diskon, dikonversi ke mata uang perusahaan.
          priceUnit: d(l.priceUnit)
            .times(d(100).minus(l.discount))
            .div(100)
            .times(rate)
            .div(l.uomRatio)
            .toDecimalPlaces(4)
            .toFixed(4),
          purchaseLineId: l.id,
          saleLineId: l.saleLineId,
        })),
      });
    }
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: order.id,
      action: "update",
      message: approvedBy ? "PO disetujui" : "PO dikonfirmasi",
    });
    for (const hook of this.confirmHooks) await hook(tx, { ...order, state: "purchase" });
  }

  /**
   * Retur ke pemasok atas barang yang sudah ditagih: draft nota debit (retur tagihan) sebanyak kelebihan
   * tagihan (ditagih − diterima setelah retur), dengan harga PO.
   */
  private async refundFromReturn(
    tx: Db,
    picking: typeof schema.stockPickings.$inferSelect,
  ): Promise<LinkedDocument | null> {
    if (!picking.purchaseOrderId || !picking.returnOfId) return null;
    const [order] = await tx.select().from(O).where(eq(O.id, picking.purchaseOrderId));
    if (!order) return null;
    const books = await loadBooks(tx, order.companyId);
    const returned = await tx
      .select({ purchaseLineId: schema.stockMoves.purchaseLineId, qty: schema.stockMoves.quantityDone })
      .from(schema.stockMoves)
      .where(and(eq(schema.stockMoves.pickingId, picking.id), eq(schema.stockMoves.state, "done")));
    const lines = await this.lines(tx, order.id);
    const refund = lines.flatMap((l) => {
      // Pergerakan dalam satuan produk → satuan baris.
      const qty = returned
        .filter((r) => r.purchaseLineId === l.id)
        .reduce((sum, r) => sum.plus(r.qty), d(0))
        .div(l.uomRatio)
        .toDecimalPlaces(4);
      const over = Decimal.min(qty, d(l.qtyBilled).minus(l.qtyReceived));
      return qty.gt(0) && over.gt(0) ? [{ l, qty: over }] : [];
    });
    if (!refund.length) return null;
    const date = await companyToday(tx, order.companyId);
    const moveId = await this.moves.createInvoice(
      tx,
      {
        moveType: "in_refund",
        partnerId: order.partnerId,
        date,
        dueDate: date,
        ref: `Retur ${picking.name}`,
        narration: null,
        currencyCode: order.currencyCode,
        lines: refund.map(({ l, qty }) => ({
          productId: l.productId,
          accountId: l.productType === "storable" ? books.settings.stockInputAccountId : null,
          name: l.name,
          quantity: qty.toFixed(4),
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds,
          businessUnitId: order.businessUnitId,
          costCenterId: order.costCenterId,
          branchId: order.branchId,
          uomId: l.uomId,
        })),
      },
      order.companyId,
      { invoiceOrigin: order.name, purchaseLineIds: refund.map(({ l }) => l.id) },
    );
    await this.activity.log(tx, {
      resModel: "purchase_order",
      resId: order.id,
      action: "comment",
      message: `Draft nota debit dibuat dari retur ${picking.name}`,
    });
    return { model: "account_move", id: moveId, moveType: "in_refund", label: "Draft nota debit" };
  }

  /**
   * Selisih harga pembelian: barang stok dinilai dengan harga PO saat diterima (kredit Barang Diterima Belum
   * Ditagih). Bila tagihan berbeda (harga/kurs), selisihnya dipindahkan dari akun itu ke akun Selisih Harga
   * Pembelian sehingga saldo barang diterima belum ditagih kembali nol.
   */
  private async priceDifference(tx: Db, move: PostedMove) {
    if (move.moveType !== "in_invoice" && move.moveType !== "in_refund") return;
    const books = await loadBooks(tx, move.companyId);
    const { stockInputAccountId: grni, priceDifferenceAccountId: diffAccount } = books.settings;
    if (!grni || !diffAccount) return;
    const rows = await tx
      .select({
        balance: schema.accountMoveLines.balance,
        quantity: schema.accountMoveLines.quantity,
        productName: schema.products.name,
        priceUnit: OL.priceUnit,
        discount: OL.discount,
        currencyCode: O.currencyCode,
        dateOrder: O.dateOrder,
      })
      .from(schema.accountMoveLines)
      .innerJoin(OL, eq(OL.id, schema.accountMoveLines.purchaseLineId))
      .innerJoin(O, eq(O.id, OL.orderId))
      .innerJoin(schema.products, eq(schema.products.id, schema.accountMoveLines.productId))
      .where(
        and(
          eq(schema.accountMoveLines.moveId, move.id),
          eq(schema.accountMoveLines.displayType, "product"),
          eq(schema.accountMoveLines.accountId, grni),
          eq(schema.products.productType, "storable"),
        ),
      );
    const sign = move.moveType === "in_invoice" ? 1 : -1;
    const lines: { accountId: string; name: string; debit: string; credit: string }[] = [];
    let total = d(0);
    for (const r of rows) {
      // Nilai penerimaan = kuantitas × harga bersih PO × kurs tanggal PO (sama seperti saat barang diterima).
      const rate = await this.rate(tx, r.currencyCode, books.currencyCode, r.dateOrder);
      const unit = d(r.priceUnit).times(d(100).minus(r.discount)).div(100).times(rate).toDecimalPlaces(4);
      const expected = d(r.quantity ?? 0)
        .times(unit)
        .times(sign)
        .toDecimalPlaces(books.decimals, Decimal.ROUND_HALF_UP);
      const diff = d(r.balance ?? 0).minus(expected);
      if (diff.isZero()) continue;
      total = total.plus(diff);
      lines.push({
        accountId: diffAccount,
        name: `Selisih harga ${r.productName}`,
        debit: diff.gt(0) ? diff.toFixed(2) : "0",
        credit: diff.lt(0) ? diff.negated().toFixed(2) : "0",
      });
    }
    if (!lines.length) return;
    lines.push({
      accountId: grni,
      name: `Selisih harga ${move.name}`,
      debit: total.lt(0) ? total.negated().toFixed(2) : "0",
      credit: total.gt(0) ? total.toFixed(2) : "0",
    });
    const [bill] = await tx
      .select({ date: schema.accountMoves.date })
      .from(schema.accountMoves)
      .where(eq(schema.accountMoves.id, move.id));
    const entryId = await this.moves.createEntry(
      tx,
      {
        journalId: books.settings.stockJournalId ?? books.settings.generalJournalId,
        date: bill!.date,
        ref: `Selisih harga ${move.name}`,
        lines: lines.filter((l) => l.debit !== "0" || l.credit !== "0"),
      },
      move.companyId,
    );
    await this.moves.post(tx, entryId);
  }

  private async rate(tx: Db, from: string, to: string, date: string) {
    if (from === to) return d(1);
    const a = await this.fx.rateOn(tx, from, date);
    const b = await this.fx.rateOn(tx, to, date);
    return d(a.rate).div(b.rate);
  }

  private async find(tx: Db, id: string, lock = false): Promise<Order> {
    const query = tx
      .select()
      .from(O)
      .where(and(eq(O.id, id), eq(O.companyId, currentContext().companyId)));
    const [order] = lock ? await query.for("update") : await query;
    if (!order) throw new NotFoundException("Pesanan pembelian tidak ditemukan");
    return order;
  }

  async lines(tx: Db, orderId: string) {
    const rows = await tx
      .select({
        line: OL,
        productName: schema.products.name,
        productType: schema.products.productType,
        uomName: schema.uoms.name,
        qtyReceived: qtyReceived(sql`purchase_order_lines.id`),
        qtyBilled: qtyBilled(sql`purchase_order_lines.id`),
      })
      .from(OL)
      .leftJoin(schema.products, eq(schema.products.id, OL.productId))
      .leftJoin(schema.uoms, eq(schema.uoms.id, OL.uomId))
      .where(eq(OL.orderId, orderId))
      .orderBy(asc(OL.sequence));
    return rows.map((r) => {
      const goods = r.productType !== null && r.productType !== "service";
      const basis = goods ? d(r.qtyReceived) : d(r.line.quantity);
      return {
        ...r.line,
        productName: r.productName,
        productType: r.productType,
        uomName: r.uomName,
        qtyReceived: d(r.qtyReceived).toFixed(4),
        qtyBilled: d(r.qtyBilled).toFixed(4),
        qtyToBill: basis.minus(r.qtyBilled).toFixed(4),
      };
    });
  }

  private async taxRules(tx: Db, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    return tx.select().from(schema.taxes).where(inArray(schema.taxes.id, unique));
  }

  /** Validasi & lengkapi: harga dari daftar harga pemasok (atau biaya produk), pajak pembelian bawaan, total. */
  private async prepare(tx: Db, input: PurchaseInput) {
    const ctx = currentContext();
    const companyId = ctx.companyId;
    const books = await loadBooks(tx, companyId);
    const partner = await assertPartner(tx, companyId, input.partnerId);
    const userId = input.userId === undefined ? ctx.userId : input.userId;
    if (userId) await assertCompanyUser(tx, userId);
    const warehouseId = input.warehouseId ?? (await this.stock.defaultWarehouse(tx, companyId)).id;
    await this.stock.warehouse(tx, warehouseId, companyId);
    await assertDimensions(tx, companyId, [
      { businessUnitId: input.businessUnitId, branchId: input.branchId, costCenterId: input.costCenterId },
    ]);
    const found = await resolveContract(tx, {
      companyId,
      partnerId: partner.id,
      currencyCode: input.currencyCode,
      dateOrder: input.dateOrder,
      contractId: input.contractId,
    });
    const currencyCode = input.currencyCode ?? found?.contract.currencyCode ?? books.currencyCode;
    if (found && !found.explicit && found.contract.currencyCode !== currencyCode) found.lines = [];
    const [currency] = await tx
      .select()
      .from(schema.currencies)
      .where(eq(schema.currencies.code, currencyCode));
    if (!currency) throw fieldError("currencyCode", "Mata uang tidak dikenal");
    let usedContract = false;
    const paymentTermId =
      input.paymentTermId === undefined
        ? ((found?.explicit ? found.contract.paymentTermId : null) ?? partner.paymentTermId)
        : input.paymentTermId;
    if (paymentTermId) await assertPaymentTerm(tx, paymentTermId);

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
    const suppliers = productIds.length
      ? await tx
          .select()
          .from(schema.productSuppliers)
          .where(
            and(
              inArray(schema.productSuppliers.productId, productIds),
              or(isNull(schema.productSuppliers.companyId), eq(schema.productSuppliers.companyId, companyId)),
            ),
          )
      : [];
    const defaultTaxIds = books.settings.defaultPurchaseTaxId ? [books.settings.defaultPurchaseTaxId] : [];

    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const product = l.productId ? products.find((p) => p.id === l.productId) : undefined;
      if (l.productId && !product) throw fieldError(`lines.${i}.productId`, "Produk tidak ditemukan");
      if (product) assertNotTemplate(product, `lines.${i}.productId`);
      const name = l.name || product?.name;
      if (!name) throw fieldError(`lines.${i}.name`, "Isi deskripsi atau pilih produk");
      // Baris kontrak: dipilih langsung, atau produk yang sama di kontrak (kontrak dipilih / harga kosong).
      let contractLine = l.contractLineId
        ? found?.lines.find((c) => c.id === l.contractLineId)
        : product && (found?.explicit || l.priceUnit == null)
          ? found?.lines.find((c) => c.productId === product.id)
          : undefined;
      if (l.contractLineId && !contractLine)
        throw fieldError(`lines.${i}.contractLineId`, "Baris kontrak tidak ada di kontrak PO ini");
      if (contractLine && product && contractLine.productId !== product.id)
        throw fieldError(`lines.${i}.productId`, "Produk berbeda dengan baris kontrak");
      if (contractLine && !product) contractLine = undefined;
      // Satuan baris: input → satuan kontrak → satuan beli produk → satuan produk.
      const uomId = product
        ? (l.uomId ?? contractLine?.uomId ?? product.purchaseUomId ?? product.uomId)
        : (l.uomId ?? null);
      const ratio = product ? await uomRatio(tx, product.uomId, uomId, `lines.${i}.uomId`) : d(1);
      let priceUnit = l.priceUnit;
      let discount = l.discount;
      let lineTaxIds = l.taxIds;
      if (priceUnit == null && contractLine) {
        // Harga kontrak per satuan baris kontrak → per satuan baris PO.
        priceUnit = d(contractLine.priceUnit).div(contractLine.uomRatio).times(ratio).toFixed(4);
        discount = contractLine.discount;
        lineTaxIds = lineTaxIds ?? (contractLine.taxIds.length ? contractLine.taxIds : undefined);
      }
      if (contractLine) usedContract = true;
      if (priceUnit == null) {
        if (!product) throw fieldError(`lines.${i}.priceUnit`, "Isi harga satuan");
        // Harga pemasok & biaya produk berlaku per satuan produk.
        const supplier = pickSupplier(
          suppliers.filter((s) => s.productId === product.id),
          d(l.quantity).times(ratio).toFixed(4),
          partner.id,
        );
        priceUnit = (
          supplier
            ? d(supplier.price).times(
                await this.rate(tx, supplier.currencyCode, currencyCode, input.dateOrder),
              )
            : d(product.cost).times(await this.rate(tx, books.currencyCode, currencyCode, input.dateOrder))
        )
          .times(ratio)
          .toFixed(4);
      }
      lines.push({
        sequence: i,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        name,
        quantity: l.quantity,
        priceUnit: d(priceUnit).toFixed(4),
        discount,
        taxIds: lineTaxIds ?? defaultTaxIds,
        priceSubtotal: "0",
        datePlanned: l.datePlanned ?? input.datePlanned ?? null,
        uomId,
        uomRatio: ratio.toFixed(6),
        contractLineId: contractLine?.id ?? null,
      });
    }
    const rules = await this.taxRules(
      tx,
      lines.flatMap((l) => l.taxIds),
    );
    for (const [i, l] of lines.entries()) {
      for (const taxId of l.taxIds) {
        const tax = rules.find((t) => t.id === taxId);
        if (!tax || tax.companyId !== companyId || tax.typeTaxUse !== "purchase" || !tax.active)
          throw fieldError(`lines.${i}.taxIds`, "Pajak tidak ditemukan atau bukan pajak pembelian");
      }
    }
    const result = computeInvoice(lines, rules, currency.decimals);
    lines.forEach((l, i) => (l.priceSubtotal = d(result.lines[i]!.subtotal).toFixed(2)));
    return {
      header: {
        partnerId: partner.id,
        partnerRef: input.partnerRef ?? null,
        dateOrder: input.dateOrder,
        datePlanned: input.datePlanned ?? null,
        paymentTermId,
        currencyCode,
        userId,
        warehouseId,
        note: input.note ?? null,
        branchId: input.branchId ?? null,
        businessUnitId: input.businessUnitId ?? null,
        costCenterId: input.costCenterId ?? null,
        contractId: found && (found.explicit || usedContract) ? found.contract.id : null,
        amountUntaxed: d(result.amountUntaxed).toFixed(2),
        amountTax: d(result.amountTax).toFixed(2),
        amountTotal: d(result.amountTotal).toFixed(2),
      },
      lines,
      taxes: result.taxes
        .filter((t) => !d(t.amount).isZero())
        .map((t) => ({
          taxId: t.taxId,
          name: rules.find((r) => r.id === t.taxId)!.name,
          amount: d(t.amount).toFixed(2),
        })),
    };
  }
}
