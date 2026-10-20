import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, ne, or, schema, sql, type Db } from "@erp/db";
import {
  ALL_PERMISSIONS,
  computeInvoice,
  type portalInviteSchema,
  type portalLoginSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { jwtVerify, SignJWT } from "jose";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { issueTenantToken, parseTenantToken } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { Mailer } from "../common/mailer.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { currentContext, runWithContext } from "../common/request-context.js";
import { CONFIG, type AppConfig } from "../config.js";
import { renderOrderPdf } from "../sales/order-pdf.js";
import { SaleOrderService } from "../sales/sale-order.service.js";

const MINUTE = 60_000;
const INVITE_TTL_DAYS = 7;
const SESSION_TTL = "8h";
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** Pemanggil portal yang sudah diverifikasi (diisi PortalGuard). */
export interface PortalPrincipal {
  tenantId: string;
  portalUserId: string;
  partnerId: string;
  name: string;
  email: string;
}

/**
 * Portal pelanggan: kontak pelanggan masuk dengan akun terpisah dari user internal dan hanya melihat dokumen
 * partnernya (beserta kontak di bawahnya): penawaran & pesanan, faktur & nota kredit, unduh PDF, dan menyetujui
 * penawaran yang dikirim.
 */
@Injectable()
export class PortalService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SaleOrderService) private readonly sales: SaleOrderService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  // ---- Administrasi (user internal) ----

  async status(tx: Db, partnerId: string) {
    await this.partner(tx, partnerId);
    const [row] = await tx
      .select()
      .from(schema.portalUsers)
      .where(eq(schema.portalUsers.partnerId, partnerId));
    return row ? this.publicUser(row) : null;
  }

  /** Undang (atau undang ulang) kontak pelanggan; tautan undangan juga dikembalikan agar bisa dibagikan manual. */
  async invite(tx: Db, partnerId: string, input: z.infer<typeof portalInviteSchema>) {
    const partner = await this.partner(tx, partnerId);
    if (!partner.isCustomer) throw new BadRequestException("Portal hanya untuk pelanggan");
    const email = input.email ?? partner.email?.toLowerCase();
    if (!email)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: [{ path: "email", message: "Pelanggan belum punya email; isi email portal" }],
      });
    const [taken] = await tx
      .select({ id: schema.portalUsers.id })
      .from(schema.portalUsers)
      .where(
        and(sql`lower(${schema.portalUsers.email}) = ${email}`, ne(schema.portalUsers.partnerId, partnerId)),
      );
    if (taken) throw new ConflictException("Email sudah dipakai akun portal pelanggan lain");
    const { tenantId, userId } = currentContext();
    const { token, hash } = issueTenantToken(tenantId);
    const values = {
      email,
      name: input.name ?? partner.name,
      inviteTokenHash: hash,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      invitedBy: userId,
      active: true,
      updatedAt: sql`now()`,
    };
    const [row] = await tx
      .insert(schema.portalUsers)
      .values({ partnerId, ...values })
      .onConflictDoUpdate({ target: schema.portalUsers.partnerId, set: values })
      .returning();
    const inviteUrl = `${this.config.webOrigin}/portal/accept#token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: email,
      subject: "Akses portal pelanggan",
      text: `Yth. ${row!.name},\n\nAnda diundang ke portal pelanggan untuk melihat penawaran, pesanan, dan faktur. Buka tautan berikut untuk membuat password (berlaku ${INVITE_TTL_DAYS} hari):\n\n${inviteUrl}\n`,
    });
    await this.activity.log(tx, {
      resModel: "partner",
      resId: partnerId,
      action: "comment",
      message: `Undangan portal dikirim ke ${email}`,
    });
    return { ...this.publicUser(row!), inviteUrl };
  }

  async revoke(tx: Db, partnerId: string) {
    await this.partner(tx, partnerId);
    await tx
      .update(schema.portalUsers)
      .set({ active: false, inviteTokenHash: null, updatedAt: sql`now()` })
      .where(eq(schema.portalUsers.partnerId, partnerId));
    return this.status(tx, partnerId);
  }

  // ---- Autentikasi portal ----

  async login(input: z.infer<typeof portalLoginSchema>, ip: string) {
    const key = `portal-login:${input.tenantSlug}:${input.email}`;
    await this.limiter.consume(`portal-ip:${ip}`, 50, 15 * MINUTE);
    await this.limiter.consume(key, 10, 15 * MINUTE);
    const invalid = new UnauthorizedException("Tenant, email, atau password salah");
    const [tenant] = await this.ownerDb
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, input.tenantSlug));
    if (!tenant) throw invalid;
    const session = await this.tenantDb.runAs(tenant.id, async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.portalUsers)
        .where(
          and(sql`lower(${schema.portalUsers.email}) = ${input.email}`, eq(schema.portalUsers.active, true)),
        );
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw invalid;
      await tx
        .update(schema.portalUsers)
        .set({ lastLoginAt: sql`now()` })
        .where(eq(schema.portalUsers.id, user.id));
      return this.session(tx, tenant.id, user);
    });
    await this.limiter.reset(key);
    return session;
  }

  /** Terima undangan: atur password lalu langsung masuk. */
  async accept(input: { token: string; password: string }, ip: string) {
    await this.limiter.consume(`portal-accept:${ip}`, 20, 15 * MINUTE);
    const invalid = new BadRequestException("Undangan tidak valid atau kedaluwarsa");
    const parsed = parseTenantToken(input.token);
    if (!parsed) throw invalid;
    return this.tenantDb.runAs(parsed.tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.portalUsers)
        .where(
          and(
            eq(schema.portalUsers.inviteTokenHash, parsed.hash),
            eq(schema.portalUsers.active, true),
            gt(schema.portalUsers.inviteExpiresAt, sql`now()`),
          ),
        )
        .for("update");
      if (!user) throw invalid;
      const [updated] = await tx
        .update(schema.portalUsers)
        .set({
          passwordHash: await hashPassword(input.password),
          inviteTokenHash: null,
          inviteExpiresAt: null,
          lastLoginAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.portalUsers.id, user.id))
        .returning();
      return this.session(tx, parsed.tenantId, updated!);
    });
  }

  /** Verifikasi token portal (dipakai PortalGuard). */
  async principal(token: string): Promise<PortalPrincipal> {
    const invalid = new UnauthorizedException("Sesi portal tidak valid atau kedaluwarsa");
    let claims: { sub: string; tid: string };
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { algorithms: ["HS256"] });
      if (payload.typ !== "portal" || typeof payload.sub !== "string" || typeof payload.tid !== "string")
        throw invalid;
      claims = { sub: payload.sub, tid: payload.tid };
    } catch {
      throw invalid;
    }
    const user = await this.tenantDb.runAs(claims.tid, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.portalUsers)
        .where(and(eq(schema.portalUsers.id, claims.sub), eq(schema.portalUsers.active, true)));
      return row;
    });
    if (!user) throw invalid;
    return {
      tenantId: claims.tid,
      portalUserId: user.id,
      partnerId: user.partnerId,
      name: user.name,
      email: user.email,
    };
  }

  // ---- Data portal ----

  async me(tx: Db, p: PortalPrincipal) {
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, p.partnerId));
    const ids = await this.partnerIds(tx, p);
    const [open] = await tx
      .select({
        residual: sql<string>`coalesce(sum(case when ${schema.accountMoves.moveType} = 'out_refund'
          then -${schema.accountMoves.amountResidual} else ${schema.accountMoves.amountResidual} end), 0)::text`,
      })
      .from(schema.accountMoves)
      .where(
        and(
          inArray(schema.accountMoves.partnerId, ids),
          eq(schema.accountMoves.state, "posted"),
          inArray(schema.accountMoves.moveType, ["out_invoice", "out_refund"]),
        ),
      );
    return {
      name: p.name,
      email: p.email,
      partner: { id: partner!.id, name: partner!.name, city: partner!.city, npwp: partner!.npwp },
      openBalance: d(open?.residual).toFixed(2),
    };
  }

  async orders(tx: Db, p: PortalPrincipal) {
    const O = schema.saleOrders;
    return tx
      .select({
        id: O.id,
        name: O.name,
        state: O.state,
        dateOrder: O.dateOrder,
        validityDate: O.validityDate,
        currencyCode: O.currencyCode,
        amountTotal: O.amountTotal,
        companyName: schema.companies.name,
      })
      .from(O)
      .innerJoin(schema.companies, eq(schema.companies.id, O.companyId))
      .where(and(inArray(O.partnerId, await this.partnerIds(tx, p)), inArray(O.state, ["sent", "sale"])))
      .orderBy(desc(O.dateOrder), desc(O.name));
  }

  async order(tx: Db, p: PortalPrincipal, id: string) {
    const order = await this.findOrder(tx, p, id);
    const lines = await tx
      .select({
        name: schema.saleOrderLines.name,
        quantity: schema.saleOrderLines.quantity,
        uomName: schema.uoms.name,
        priceUnit: schema.saleOrderLines.priceUnit,
        discount: schema.saleOrderLines.discount,
        priceSubtotal: schema.saleOrderLines.priceSubtotal,
        isDownpayment: schema.saleOrderLines.isDownpayment,
      })
      .from(schema.saleOrderLines)
      .leftJoin(schema.uoms, eq(schema.uoms.id, schema.saleOrderLines.uomId))
      .where(eq(schema.saleOrderLines.orderId, id))
      .orderBy(asc(schema.saleOrderLines.sequence));
    const [company] = await tx
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, order.companyId));
    return {
      id: order.id,
      name: order.name,
      state: order.state,
      dateOrder: order.dateOrder,
      validityDate: order.validityDate,
      currencyCode: order.currencyCode,
      clientOrderRef: order.clientOrderRef,
      note: order.note,
      amountUntaxed: order.amountUntaxed,
      amountTax: order.amountTax,
      amountTotal: order.amountTotal,
      companyName: company?.name ?? "",
      canAccept: this.acceptable(order),
      lines: lines.filter((l) => !l.isDownpayment),
    };
  }

  /** Pelanggan menyetujui penawaran terkirim: dikonfirmasi atas nama penjual/pembuat penawaran. */
  async acceptOrder(tx: Db, p: PortalPrincipal, id: string) {
    const order = await this.findOrder(tx, p, id);
    if (!this.acceptable(order))
      throw new BadRequestException(
        "Penawaran ini tidak bisa disetujui (bukan penawaran terkirim atau sudah kedaluwarsa)",
      );
    const staff = order.userId ?? order.createdBy;
    if (!staff) throw new BadRequestException("Penawaran tidak punya penanggung jawab; hubungi penjual");
    await runWithContext(
      {
        tenantId: p.tenantId,
        userId: staff,
        companyIds: [order.companyId],
        companyId: order.companyId,
        permissions: [ALL_PERMISSIONS],
      },
      async () => {
        await this.sales.confirm(tx, id);
        await this.activity.log(tx, {
          resModel: "sale_order",
          resId: id,
          action: "comment",
          message: `Disetujui pelanggan lewat portal oleh ${p.name} (${p.email})`,
        });
      },
    );
    return this.order(tx, p, id);
  }

  async orderPdf(tx: Db, p: PortalPrincipal, id: string) {
    const order = await this.order(tx, p, id);
    const raw = await this.findOrder(tx, p, id);
    const taxes = await this.orderTaxes(tx, id);
    return this.pdf(tx, raw.companyId, raw.partnerId, {
      title: order.state === "sale" ? "Pesanan Penjualan" : "Penawaran",
      name: order.name,
      dateOrder: order.dateOrder,
      validityDate: order.validityDate,
      clientOrderRef: order.clientOrderRef,
      currencyCode: order.currencyCode,
      lines: order.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        priceUnit: l.priceUnit,
        discount: l.discount,
        subtotal: l.priceSubtotal,
      })),
      taxes,
      amountUntaxed: order.amountUntaxed,
      amountTotal: order.amountTotal,
      note: order.note,
    });
  }

  async invoices(tx: Db, p: PortalPrincipal) {
    const M = schema.accountMoves;
    return tx
      .select({
        id: M.id,
        name: M.name,
        moveType: M.moveType,
        date: M.date,
        dueDate: M.dueDate,
        currencyCode: M.currencyCode,
        amountTotal: M.amountTotal,
        amountResidual: M.amountResidual,
        paymentState: M.paymentState,
        companyName: schema.companies.name,
      })
      .from(M)
      .innerJoin(schema.companies, eq(schema.companies.id, M.companyId))
      .where(this.invoiceFilter(await this.partnerIds(tx, p)))
      .orderBy(desc(M.date), desc(M.name));
  }

  async invoice(tx: Db, p: PortalPrincipal, id: string) {
    const M = schema.accountMoves;
    const [move] = await tx
      .select()
      .from(M)
      .where(and(eq(M.id, id), this.invoiceFilter(await this.partnerIds(tx, p))));
    if (!move) throw new NotFoundException("Faktur tidak ditemukan");
    const lines = await tx
      .select()
      .from(schema.accountMoveLines)
      .where(
        and(
          eq(schema.accountMoveLines.moveId, id),
          inArray(schema.accountMoveLines.displayType, ["product", "tax"]),
        ),
      )
      .orderBy(asc(schema.accountMoveLines.sequence));
    const uoms = await tx.select({ id: schema.uoms.id, name: schema.uoms.name }).from(schema.uoms);
    return {
      ...move,
      lines: lines
        .filter((l) => l.displayType === "product")
        .map((l) => ({
          name: l.name ?? "",
          quantity: d(l.quantity).toFixed(4),
          uomName: uoms.find((u) => u.id === l.uomId)?.name ?? null,
          priceUnit: d(l.priceUnit).toFixed(4),
          discount: l.discount,
          subtotal: d(l.amountCurrency).abs().toFixed(2),
        })),
      taxes: lines
        .filter((l) => l.displayType === "tax")
        .map((l) => ({ name: l.name ?? "", amount: d(l.amountCurrency).abs().toFixed(2) })),
    };
  }

  async invoicePdf(tx: Db, p: PortalPrincipal, id: string) {
    const inv = await this.invoice(tx, p, id);
    return this.pdf(tx, inv.companyId, inv.partnerId!, {
      title: inv.moveType === "out_refund" ? "Nota Kredit" : "Faktur",
      name: inv.name ?? "",
      dateOrder: inv.date,
      validityDate: inv.dueDate,
      clientOrderRef: inv.ref,
      currencyCode: inv.currencyCode,
      lines: inv.lines,
      taxes: inv.taxes,
      amountUntaxed: inv.amountUntaxed,
      amountTotal: inv.amountTotal,
      note: inv.narration,
    });
  }

  // ---- Internal ----

  private invoiceFilter(partnerIds: string[]) {
    const M = schema.accountMoves;
    return and(
      inArray(M.partnerId, partnerIds),
      eq(M.state, "posted"),
      inArray(M.moveType, ["out_invoice", "out_refund"]),
    );
  }

  /** Partner portal beserta kontak di bawahnya. */
  private async partnerIds(tx: Db, p: PortalPrincipal) {
    const rows = await tx
      .select({ id: schema.partners.id })
      .from(schema.partners)
      .where(or(eq(schema.partners.id, p.partnerId), eq(schema.partners.parentId, p.partnerId)));
    return rows.map((r) => r.id);
  }

  private async findOrder(tx: Db, p: PortalPrincipal, id: string) {
    const [order] = await tx
      .select()
      .from(schema.saleOrders)
      .where(
        and(
          eq(schema.saleOrders.id, id),
          inArray(schema.saleOrders.partnerId, await this.partnerIds(tx, p)),
          inArray(schema.saleOrders.state, ["sent", "sale"]),
        ),
      );
    if (!order) throw new NotFoundException("Pesanan tidak ditemukan");
    return order;
  }

  private acceptable(order: typeof schema.saleOrders.$inferSelect) {
    const today = new Date().toISOString().slice(0, 10);
    return order.state === "sent" && (!order.validityDate || order.validityDate >= today);
  }

  private async orderTaxes(tx: Db, orderId: string) {
    const lines = await tx
      .select({
        quantity: schema.saleOrderLines.quantity,
        priceUnit: schema.saleOrderLines.priceUnit,
        discount: schema.saleOrderLines.discount,
        taxIds: schema.saleOrderLines.taxIds,
      })
      .from(schema.saleOrderLines)
      .where(and(eq(schema.saleOrderLines.orderId, orderId), eq(schema.saleOrderLines.isDownpayment, false)));
    const ids = [...new Set(lines.flatMap((l) => l.taxIds))];
    if (!ids.length) return [];
    const taxes = await tx.select().from(schema.taxes).where(inArray(schema.taxes.id, ids));
    return computeInvoice(lines, taxes, 2)
      .taxes.filter((t) => !d(t.amount).isZero())
      .map((t) => ({
        name: taxes.find((x) => x.id === t.taxId)?.name ?? "",
        amount: d(t.amount).toFixed(2),
      }));
  }

  private async pdf(
    tx: Db,
    companyId: string,
    partnerId: string,
    data: Omit<Parameters<typeof renderOrderPdf>[0], "company" | "partner" | "paymentTerm" | "salesperson">,
  ) {
    const [company] = await tx
      .select({ name: schema.companies.name, npwp: schema.companies.npwp })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId));
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, partnerId));
    const content = await renderOrderPdf({
      ...data,
      company: { name: company?.name ?? "", npwp: company?.npwp ?? null },
      partner: {
        name: partner?.name ?? "",
        street: partner?.street ?? null,
        city: partner?.city ?? null,
        npwp: partner?.npwp ?? null,
      },
      paymentTerm: null,
      salesperson: null,
    });
    return { filename: `${data.name.replace(/[^\w.-]+/g, "_")}.pdf`, content };
  }

  private async partner(tx: Db, id: string) {
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, id));
    const ctx = currentContext();
    if (!partner || (partner.companyId && !ctx.companyIds.includes(partner.companyId)))
      throw new NotFoundException("Partner tidak ditemukan");
    return partner;
  }

  private async session(tx: Db, tenantId: string, user: typeof schema.portalUsers.$inferSelect) {
    const token = await new SignJWT({ tid: tenantId, typ: "portal" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(SESSION_TTL)
      .sign(this.config.jwtSecret);
    const [partner] = await tx
      .select({ name: schema.partners.name })
      .from(schema.partners)
      .where(eq(schema.partners.id, user.partnerId));
    return { token, name: user.name, email: user.email, partnerName: partner?.name ?? "" };
  }

  private publicUser(row: typeof schema.portalUsers.$inferSelect) {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      active: row.active,
      hasPassword: Boolean(row.passwordHash),
      invitePending: Boolean(row.inviteTokenHash),
      inviteExpiresAt: row.inviteExpiresAt,
      lastLoginAt: row.lastLoginAt,
    };
  }
}
