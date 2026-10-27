import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, asc, count, desc, eq, schema, sql, type Db } from "@erp/db";
import {
  addPeriod,
  billingAmounts,
  effectiveStatus,
  isWritable,
  PLAN_MODULES,
  type BillingCycle,
  type EffectiveStatus,
  type PlanModule,
  type adminSubscriptionSchema,
  type planSchema,
} from "@erp/shared";
import type { z } from "zod";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { CONFIG, type AppConfig } from "../config.js";
import { paymentProvider, type PaymentProvider } from "./payment-provider.js";
import { reportError } from "../common/error-reporting.js";

const P = schema.plans;
const S = schema.subscriptions;
const BI = schema.billingInvoices;
const CACHE_MS = 30_000;
const RENEWAL_LEAD_DAYS = 7;
const DAY = 86_400_000;

export interface Access {
  planCode: string;
  planName: string;
  status: EffectiveStatus;
  writable: boolean;
  modules: PlanModule[];
  maxUsers: number | null;
  maxCompanies: number | null;
}

/**
 * Langganan SaaS per tenant: status efektif & batas paket (di-cache singkat untuk AuthGuard),
 * tagihan, pembayaran, dan perpanjangan. Menulis lewat koneksi pemilik karena tabel langganan &
 * tagihan hanya bisa dibaca oleh tenant (app_user).
 */
@Injectable()
export class BillingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly cache = new Map<string, { access: Access; expires: number }>();
  private readonly logger = new Logger("Billing");
  private timer?: NodeJS.Timeout;
  provider: PaymentProvider;

  constructor(
    @Inject(OWNER_DB) private readonly db: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.provider = paymentProvider(config);
  }

  onApplicationBootstrap() {
    if (!this.config.billing.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runRenewals().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "billing-renewals" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  // ---- Akses (dipakai AuthGuard) ----

  async access(tenantId: string): Promise<Access> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.access;
    const [row] = await this.db
      .select({ sub: S, plan: P })
      .from(S)
      .innerJoin(P, eq(P.id, S.planId))
      .where(eq(S.tenantId, tenantId));
    const access: Access = row
      ? this.toAccess(row.sub, row.plan)
      : // Tenant tanpa baris langganan tidak dikunci (baris dibuat saat halaman Langganan dibuka).
        {
          planCode: "legacy",
          planName: "Legacy",
          status: "active",
          writable: true,
          modules: [...PLAN_MODULES],
          maxUsers: null,
          maxCompanies: null,
        };
    this.cache.set(tenantId, { access, expires: Date.now() + CACHE_MS });
    return access;
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  private toAccess(sub: typeof S.$inferSelect, plan: typeof P.$inferSelect): Access {
    const status = effectiveStatus(sub, new Date(), this.config.billing.graceDays);
    return {
      planCode: plan.code,
      planName: plan.name,
      status,
      writable: isWritable(status),
      modules: plan.modules as PlanModule[],
      maxUsers: plan.maxUsers,
      maxCompanies: plan.maxCompanies,
    };
  }

  /** Tolak penulisan saat langganan berakhir (402) — dipanggil AuthGuard. */
  assertWritable(access: Access) {
    if (access.writable) return;
    throw new HttpException(
      {
        statusCode: 402,
        message:
          access.status === "suspended"
            ? "Akun ditangguhkan. Hubungi tim kami."
            : "Langganan berakhir — data hanya bisa dibaca. Perpanjang di menu Langganan.",
        subscriptionStatus: access.status,
      },
      402,
    );
  }

  assertModule(access: Access, module: PlanModule) {
    if (!access.modules.includes(module))
      throw new ForbiddenException({
        statusCode: 403,
        message: `Modul ${module} tidak termasuk paket ${access.planName}. Tingkatkan paket di menu Langganan.`,
        planRequired: true,
      });
  }

  // ---- Siklus langganan ----

  /** Masa uji coba untuk tenant baru (dalam transaksi signup, sebelum beralih ke peran tenant). */
  async startTrial(tx: Db, tenantId: string) {
    const [plan] = await tx.select({ id: P.id }).from(P).where(eq(P.code, this.config.billing.trialPlan));
    if (!plan) throw new Error(`Paket uji coba "${this.config.billing.trialPlan}" tidak ada`);
    await tx.insert(S).values({
      tenantId,
      planId: plan.id,
      status: "trialing",
      trialEndsAt: new Date(Date.now() + this.config.billing.trialDays * DAY),
    });
  }

  private async subscription(
    tenantId: string,
  ): Promise<{ sub: typeof S.$inferSelect; plan: typeof P.$inferSelect }> {
    const [row] = await this.db
      .select({ sub: S, plan: P })
      .from(S)
      .innerJoin(P, eq(P.id, S.planId))
      .where(eq(S.tenantId, tenantId));
    if (row) return row;
    // Tenant lama tanpa langganan: buat masa uji coba.
    await this.db.transaction((tx) => this.startTrial(tx, tenantId));
    this.invalidate(tenantId);
    return this.subscription(tenantId);
  }

  /** Ringkasan untuk halaman Langganan: paket, status, pemakaian, paket tersedia, tagihan. */
  async summary(tenantId: string) {
    const { sub, plan } = await this.subscription(tenantId);
    const usage = await this.tenantDb.runAs(tenantId, async (tx) => {
      const [users] = await tx.select({ n: count() }).from(schema.users).where(eq(schema.users.active, true));
      const [companies] = await tx
        .select({ n: count() })
        .from(schema.companies)
        .where(eq(schema.companies.active, true));
      return { users: users?.n ?? 0, companies: companies?.n ?? 0 };
    });
    const plans = await this.db
      .select()
      .from(P)
      .where(and(eq(P.active, true), eq(P.public, true)))
      .orderBy(asc(P.sort));
    const invoices = await this.invoices(tenantId);
    return {
      subscription: { ...sub, status: this.toAccess(sub, plan).status, storedStatus: sub.status },
      plan,
      usage,
      plans,
      invoices,
    };
  }

  invoices(tenantId: string) {
    return this.db
      .select({ invoice: BI, planName: P.name })
      .from(BI)
      .innerJoin(P, eq(P.id, BI.planId))
      .where(eq(BI.tenantId, tenantId))
      .orderBy(desc(BI.issuedAt))
      .then((rows) => rows.map((r) => ({ ...r.invoice, planName: r.planName })));
  }

  /** Pilih paket: buat tagihan; periode baru dimulai saat tagihan dibayar. */
  async subscribe(
    tenantId: string,
    input: { planCode: string; billingCycle: BillingCycle },
    payerEmail: string,
  ) {
    const [plan] = await this.db
      .select()
      .from(P)
      .where(and(eq(P.code, input.planCode), eq(P.active, true)));
    if (!plan) throw new NotFoundException("Paket tidak ditemukan");
    const price = input.billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
    if (Number(price) <= 0)
      throw new BadRequestException("Paket ini tidak bisa dipesan sendiri; hubungi tim kami");
    const { usage } = await this.summary(tenantId);
    if (plan.maxUsers !== null && usage.users > plan.maxUsers)
      throw new BadRequestException(
        `Paket ${plan.name} maksimal ${plan.maxUsers} pengguna; saat ini ada ${usage.users} pengguna aktif`,
      );
    if (plan.maxCompanies !== null && usage.companies > plan.maxCompanies)
      throw new BadRequestException(
        `Paket ${plan.name} maksimal ${plan.maxCompanies} perusahaan; saat ini ada ${usage.companies}`,
      );
    const invoice = await this.db.transaction(async (tx) => {
      // Satu tagihan terbuka per tenant: tagihan lama yang belum dibayar dibatalkan.
      await tx
        .update(BI)
        .set({ status: "void", updatedAt: sql`now()` })
        .where(and(eq(BI.tenantId, tenantId), eq(BI.status, "open")));
      return this.issueInvoice(
        tx,
        tenantId,
        plan.id,
        input.billingCycle,
        "new",
        price,
        new Date(Date.now() + 7 * DAY),
      );
    });
    return this.attachPayment(invoice, plan.name, payerEmail);
  }

  /** Buat ulang tautan/instruksi pembayaran untuk tagihan terbuka. */
  async pay(tenantId: string, invoiceId: string, payerEmail: string) {
    const [row] = await this.db
      .select({ invoice: BI, planName: P.name })
      .from(BI)
      .innerJoin(P, eq(P.id, BI.planId))
      .where(and(eq(BI.id, invoiceId), eq(BI.tenantId, tenantId)));
    if (!row) throw new NotFoundException("Tagihan tidak ditemukan");
    if (row.invoice.status !== "open") throw new BadRequestException("Tagihan tidak terbuka");
    return this.attachPayment(row.invoice, row.planName, payerEmail);
  }

  private async issueInvoice(
    tx: Db,
    tenantId: string,
    planId: string,
    cycle: BillingCycle,
    purpose: "new" | "renewal",
    price: string,
    dueAt: Date,
  ) {
    const [{ seq } = { seq: "0" }] = await tx.execute<{ seq: string }>(
      sql`select nextval('billing_invoice_seq') as seq`,
    );
    const number = `ERP/${new Date().getUTCFullYear()}/${String(seq).padStart(6, "0")}`;
    const [invoice] = await tx
      .insert(BI)
      .values({ tenantId, number, planId, billingCycle: cycle, purpose, ...billingAmounts(price), dueAt })
      .returning();
    return invoice!;
  }

  private async attachPayment(invoice: typeof BI.$inferSelect, planName: string, payerEmail: string) {
    const link = await this.provider.create({
      invoiceId: invoice.id,
      number: invoice.number,
      amount: invoice.total,
      description: `Langganan ERP paket ${planName} (${invoice.billingCycle === "yearly" ? "tahunan" : "bulanan"})`,
      payerEmail,
      returnUrl: `${this.config.webOrigin}/settings/billing`,
    });
    await this.db
      .update(BI)
      .set({
        provider: link.provider,
        providerRef: link.providerRef,
        paymentUrl: link.paymentUrl,
        updatedAt: sql`now()`,
      })
      .where(eq(BI.id, invoice.id));
    return { invoice: { ...invoice, ...link }, instructions: link.instructions };
  }

  /** Tandai tagihan lunas dan perpanjang/aktifkan langganan. Idempoten. */
  async markPaid(invoiceId: string, paidAt = new Date(), providerRef?: string) {
    const tenantId = await this.db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(BI).where(eq(BI.id, invoiceId)).for("update");
      if (!invoice) throw new NotFoundException("Tagihan tidak ditemukan");
      if (invoice.status === "paid") return invoice.tenantId;
      if (invoice.status === "void") throw new ConflictException("Tagihan sudah dibatalkan");
      const [sub] = await tx.select().from(S).where(eq(S.tenantId, invoice.tenantId)).for("update");
      // Perpanjangan melanjutkan periode berjalan; langganan baru/berakhir mulai saat dibayar.
      const continues =
        invoice.purpose === "renewal" && sub?.currentPeriodEnd && sub.currentPeriodEnd > paidAt
          ? sub.currentPeriodEnd
          : paidAt;
      const values = {
        planId: invoice.planId,
        status: "active" as const,
        billingCycle: invoice.billingCycle,
        currentPeriodStart: continues,
        currentPeriodEnd: addPeriod(continues, invoice.billingCycle),
        cancelAtPeriodEnd: false,
        updatedAt: sql`now()`,
      };
      if (sub) await tx.update(S).set(values).where(eq(S.id, sub.id));
      else await tx.insert(S).values({ tenantId: invoice.tenantId, ...values });
      await tx
        .update(BI)
        .set({
          status: "paid",
          paidAt,
          providerRef: providerRef ?? invoice.providerRef,
          updatedAt: sql`now()`,
        })
        .where(eq(BI.id, invoice.id));
      return invoice.tenantId;
    });
    this.invalidate(tenantId);
    return this.summary(tenantId);
  }

  async setCancelAtPeriodEnd(tenantId: string, cancel: boolean) {
    const { sub } = await this.subscription(tenantId);
    if (sub.status !== "active")
      throw new BadRequestException("Hanya langganan aktif yang bisa dibatalkan/dilanjutkan");
    await this.db
      .update(S)
      .set({ cancelAtPeriodEnd: cancel, updatedAt: sql`now()` })
      .where(eq(S.id, sub.id));
    this.invalidate(tenantId);
    return this.summary(tenantId);
  }

  /** Buat tagihan perpanjangan untuk langganan aktif yang berakhir ≤ 7 hari lagi. */
  async runRenewals(now = new Date()) {
    const due = await this.db.execute<{
      tenant_id: string;
      plan_id: string;
      billing_cycle: BillingCycle;
      end: Date;
      price: string;
    }>(sql`
      select s.tenant_id, s.plan_id, s.billing_cycle, s.current_period_end as end,
             case when s.billing_cycle = 'yearly' then p.price_yearly else p.price_monthly end as price
      from subscriptions s join plans p on p.id = s.plan_id
      where s.status = 'active' and not s.cancel_at_period_end
        and not (s.complimentary and (s.complimentary_until is null or s.complimentary_until > now()))
        and s.current_period_end <= ${new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY).toISOString()}::timestamptz
        and not exists (select 1 from billing_invoices b where b.tenant_id = s.tenant_id and b.status = 'open')`);
    let created = 0;
    for (const row of due) {
      if (Number(row.price) <= 0) continue;
      await this.db.transaction((tx) =>
        this.issueInvoice(
          tx,
          row.tenant_id,
          row.plan_id,
          row.billing_cycle,
          "renewal",
          row.price,
          new Date(row.end),
        ),
      );
      created++;
    }
    if (created) this.logger.log(`${created} tagihan perpanjangan dibuat`);
    return { created };
  }

  // ---- Admin platform ----

  async tenants() {
    const rows = await this.db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        name: schema.tenants.name,
        createdAt: schema.tenants.createdAt,
        sub: S,
        plan: P,
      })
      .from(schema.tenants)
      .leftJoin(S, eq(S.tenantId, schema.tenants.id))
      .leftJoin(P, eq(P.id, S.planId))
      .orderBy(desc(schema.tenants.createdAt));
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      createdAt: r.createdAt,
      planCode: r.plan?.code ?? null,
      planName: r.plan?.name ?? null,
      status: r.sub && r.plan ? this.toAccess(r.sub, r.plan).status : null,
      complimentary: r.sub?.complimentary ?? false,
      complimentaryUntil: r.sub?.complimentaryUntil ?? null,
      complimentaryNote: r.sub?.complimentaryNote ?? null,
      trialEndsAt: r.sub?.trialEndsAt ?? null,
      currentPeriodEnd: r.sub?.currentPeriodEnd ?? null,
    }));
  }

  async adminUpdate(tenantId: string, input: z.infer<typeof adminSubscriptionSchema>, actorUserId?: string) {
    const { sub } = await this.subscription(tenantId);
    const values: Partial<typeof S.$inferInsert> = {};
    if (input.planCode) {
      const [plan] = await this.db.select({ id: P.id }).from(P).where(eq(P.code, input.planCode));
      if (!plan) throw new NotFoundException("Paket tidak ditemukan");
      values.planId = plan.id;
    }
    if (input.status) values.status = input.status;
    if (input.trialEndsAt !== undefined)
      values.trialEndsAt = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
    if (input.currentPeriodEnd !== undefined)
      values.currentPeriodEnd = input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null;
    if (input.complimentary !== undefined) {
      const until = input.complimentaryUntil ? new Date(input.complimentaryUntil) : null;
      if (input.complimentary && until && until <= new Date())
        throw new BadRequestException("Tanggal akhir gratis harus di masa depan");
      values.complimentary = input.complimentary;
      values.complimentaryUntil = input.complimentary ? until : null;
      values.complimentaryNote = input.complimentary ? (input.complimentaryNote ?? null) : null;
      values.complimentaryBy = input.complimentary ? (actorUserId ?? null) : null;
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(S)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(S.id, sub.id));
      // Tenant gratis tidak perlu membayar tagihan yang masih terbuka.
      if (input.complimentary)
        await tx
          .update(BI)
          .set({ status: "void", updatedAt: sql`now()` })
          .where(and(eq(BI.tenantId, tenantId), eq(BI.status, "open")));
    });
    this.invalidate(tenantId);
    return this.summary(tenantId);
  }

  /** Semua paket + jumlah tenant yang memakainya. */
  async allPlans() {
    const rows = await this.db
      .select({
        plan: P,
        tenants: sql<number>`(select count(*) from subscriptions s where s.plan_id = plans.id)::int`,
      })
      .from(P)
      .orderBy(asc(P.sort), asc(P.name));
    return rows.map((r) => ({ ...r.plan, tenantCount: r.tenants }));
  }

  async createPlan(input: z.infer<typeof planSchema>) {
    await this.assertPlanCode(input.code, null);
    const [plan] = await this.db.insert(P).values(input).returning();
    this.cache.clear();
    return plan!;
  }

  async updatePlan(id: string, input: z.infer<typeof planSchema>) {
    await this.findPlan(id);
    await this.assertPlanCode(input.code, id);
    const [plan] = await this.db
      .update(P)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(P.id, id))
      .returning();
    this.cache.clear();
    return plan!;
  }

  /** Hapus paket yang belum pernah dipakai; paket terpakai cukup dinonaktifkan. */
  async removePlan(id: string) {
    const plan = await this.findPlan(id);
    if (plan.code === this.config.billing.trialPlan)
      throw new BadRequestException("Paket uji coba tidak bisa dihapus; nonaktifkan saja");
    const [used] = await this.db.execute<{ n: number }>(sql`
      select (select count(*) from subscriptions where plan_id = ${id})
           + (select count(*) from billing_invoices where plan_id = ${id}) as n`);
    if (Number(used?.n ?? 0) > 0)
      throw new BadRequestException("Paket sudah dipakai tenant atau tagihan; nonaktifkan saja");
    await this.db.delete(P).where(eq(P.id, id));
    this.cache.clear();
  }

  private async findPlan(id: string) {
    const [plan] = await this.db.select().from(P).where(eq(P.id, id));
    if (!plan) throw new NotFoundException("Paket tidak ditemukan");
    return plan;
  }

  private async assertPlanCode(code: string, id: string | null) {
    const [dup] = await this.db.select({ id: P.id }).from(P).where(eq(P.code, code));
    if (dup && dup.id !== id)
      throw new BadRequestException({
        message: "Kode paket sudah dipakai",
        errors: [{ path: "code", message: "Kode paket sudah dipakai" }],
      });
  }

  async savePlan(input: z.infer<typeof planSchema>) {
    const [plan] = await this.db
      .insert(P)
      .values(input)
      .onConflictDoUpdate({ target: P.code, set: { ...input, updatedAt: sql`now()` } })
      .returning();
    this.cache.clear();
    return plan;
  }

  openInvoices() {
    return this.db
      .select({ invoice: BI, tenantSlug: schema.tenants.slug, planName: P.name })
      .from(BI)
      .innerJoin(schema.tenants, eq(schema.tenants.id, BI.tenantId))
      .innerJoin(P, eq(P.id, BI.planId))
      .where(eq(BI.status, "open"))
      .orderBy(asc(BI.dueAt))
      .then((rows) => rows.map((r) => ({ ...r.invoice, tenantSlug: r.tenantSlug, planName: r.planName })));
  }
}
