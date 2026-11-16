import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, ne, or, schema, sql, type Db, type SQL } from "@erp/db";
import {
  allowedFor,
  duplicateReasons,
  funnelSteps,
  leadProductSubtotal,
  leadProductsTotal,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  salesCycleDays,
  stageDurations,
  weightedRevenue,
  type contactRolesSchema,
  type leadProductsSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertPartner, fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { ownedScope } from "./checks.js";
import { LeadService } from "./lead.service.js";

const L = schema.crmLeads;
const P = schema.partners;
const LP = schema.crmLeadProducts;
const CR = schema.crmContactRoles;
const H = schema.crmStageHistory;
const O = schema.saleOrders;
const M = schema.accountMoves;
const leadScope = () => ownedScope(L.companyId, L.userId, "crm.all");
const round1 = (n: number) => Math.round(n * 10) / 10;
const sum2 = (values: (string | null)[]) =>
  values.reduce((s, v) => s.plus(v ?? 0), new Decimal(0)).toFixed(2);

/** Field lead yang diisi dari duplikat saat digabung (hanya bila di lead tujuan masih kosong). */
const MERGE_FIELDS = [
  "partnerId",
  "contactId",
  "contactName",
  "partnerName",
  "email",
  "phone",
  "source",
  "title",
  "industry",
  "website",
  "employeeCount",
  "annualRevenue",
  "street",
  "city",
  "province",
  "nextStep",
  "expectedClose",
  "teamId",
] as const;

@Injectable()
export class SalesCloudService {
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Lead/peluang lengkap: produk, peran kontak, riwayat tahap & lama di tiap tahap. */
  async detail(tx: Db, id: string) {
    const lead = await this.leads.get(tx, id);
    const products = await tx
      .select({ line: LP, productName: schema.products.name })
      .from(LP)
      .innerJoin(schema.products, eq(schema.products.id, LP.productId))
      .where(eq(LP.leadId, id))
      .orderBy(asc(LP.sequence), asc(LP.createdAt));
    const roles = await tx
      .select({
        role: CR,
        name: P.name,
        email: P.email,
        phone: P.phone,
        jobTitle: P.jobTitle,
      })
      .from(CR)
      .innerJoin(P, eq(P.id, CR.partnerId))
      .where(eq(CR.leadId, id))
      .orderBy(desc(CR.isPrimary), asc(P.name));
    const history = await tx
      .select({ h: H, userName: schema.users.name })
      .from(H)
      .leftJoin(schema.users, eq(schema.users.id, H.userId))
      .where(eq(H.leadId, id))
      .orderBy(asc(H.changedAt));
    const stages = await tx.select().from(schema.crmStages).orderBy(asc(schema.crmStages.sequence));
    const stageName = (sid: string | null) => stages.find((s) => s.id === sid)?.name ?? null;
    const durations = stageDurations(history.map((r) => r.h));
    const names =
      lead.partnerId || lead.contactId ? await this.partnerNames(tx, [lead.partnerId, lead.contactId]) : {};
    return {
      ...lead,
      partnerDisplay: (lead.partnerId && names[lead.partnerId]) || lead.partnerName,
      contactDisplay: (lead.contactId && names[lead.contactId]) || lead.contactName,
      weightedRevenue: weightedRevenue(lead.expectedRevenue, lead.probability),
      products: products.map((r) => ({ ...r.line, productName: r.productName })),
      contactRoles: roles.map((r) => ({
        ...r.role,
        name: r.name,
        email: r.email,
        phone: r.phone,
        jobTitle: r.jobTitle,
      })),
      stageHistory: history.map((r) => ({
        ...r.h,
        fromStageName: stageName(r.h.fromStageId),
        toStageName: stageName(r.h.toStageId),
        userName: r.userName,
      })),
      stageDays: stages
        .filter((s) => durations.has(s.id))
        .map((s) => ({ stageId: s.id, stageName: s.name, days: round1(durations.get(s.id)!) })),
    };
  }

  /** Ganti baris produk peluang; nilai harapan mengikuti jumlah produk. */
  async setProducts(tx: Db, id: string, input: z.infer<typeof leadProductsSchema>) {
    const lead = await this.leads.get(tx, id);
    if (lead.leadType !== "opportunity")
      throw new BadRequestException("Produk hanya untuk peluang; konversi lead ini dulu");
    if (lead.state !== "open") throw new BadRequestException("Peluang sudah ditutup");
    const ids = [...new Set(input.lines.map((l) => l.productId))];
    const products = ids.length
      ? await tx
          .select({
            id: schema.products.id,
            name: schema.products.name,
            salePrice: schema.products.salePrice,
            companyId: schema.products.companyId,
          })
          .from(schema.products)
          .where(inArray(schema.products.id, ids))
      : [];
    const lines = input.lines.map((line, i) => {
      const product = products.find((p) => p.id === line.productId);
      if (!product || (product.companyId && product.companyId !== lead.companyId))
        throw fieldError(`lines.${i}.productId`, "Produk tidak ditemukan");
      const priceUnit = line.priceUnit ?? product.salePrice;
      return {
        leadId: id,
        sequence: (i + 1) * 10,
        productId: line.productId,
        name: line.name || null,
        quantity: line.quantity,
        priceUnit,
        discount: line.discount,
        subtotal: leadProductSubtotal({ quantity: line.quantity, priceUnit, discount: line.discount }),
      };
    });
    await tx.delete(LP).where(eq(LP.leadId, id));
    if (lines.length) {
      await tx.insert(LP).values(lines);
      await tx
        .update(L)
        .set({ expectedRevenue: leadProductsTotal(lines), updatedAt: sql`now()` })
        .where(eq(L.id, id));
    }
    await this.activity.log(tx, {
      resModel: "crm_lead",
      resId: id,
      action: "update",
      message: lines.length ? `Produk diperbarui (${lines.length} baris)` : "Produk dikosongkan",
    });
    return this.detail(tx, id);
  }

  /** Ganti peran kontak peluang; kontak utama ikut menjadi kontak utama lead. */
  async setContactRoles(tx: Db, id: string, input: z.infer<typeof contactRolesSchema>) {
    const lead = await this.leads.get(tx, id);
    for (const [i, r] of input.roles.entries())
      await assertPartner(tx, lead.companyId, r.partnerId, `roles.${i}.partnerId`);
    await tx.delete(CR).where(eq(CR.leadId, id));
    if (input.roles.length)
      await tx.insert(CR).values(
        input.roles.map((r) => ({
          leadId: id,
          partnerId: r.partnerId,
          role: r.role,
          isPrimary: r.isPrimary,
          note: r.note ?? null,
        })),
      );
    const primary = input.roles.find((r) => r.isPrimary);
    if (primary && primary.partnerId !== lead.contactId)
      await tx
        .update(L)
        .set({ contactId: primary.partnerId, updatedAt: sql`now()` })
        .where(eq(L.id, id));
    await this.activity.log(tx, {
      resModel: "crm_lead",
      resId: id,
      action: "update",
      message: "Peran kontak diperbarui",
    });
    return this.detail(tx, id);
  }

  /**
   * Kemungkinan duplikat: lead terbuka lain dan partner di perusahaan ini dengan email, telepon, atau nama perusahaan
   * yang sama. Lead milik salesperson lain tetap tampil (ringkas) agar tidak dikerjakan dua kali.
   */
  async duplicates(tx: Db, id: string) {
    const lead = await this.leads.get(tx, id);
    const email = normalizeEmail(lead.email);
    const phone = normalizePhone(lead.phone);
    const name = normalizeCompanyName(lead.partnerName);
    // Kata terpanjang dari nama dipakai sebagai saringan awal di SQL; pencocokan persisnya di `duplicateReasons`.
    const word = name?.split(" ").sort((a, b) => b.length - a.length)[0];
    const digits = (col: SQL | typeof L.phone | typeof P.phone) =>
      sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g') like ${`%${phone}`}`;
    const leadMatch: SQL[] = [];
    const partnerMatch: SQL[] = [];
    if (email) {
      leadMatch.push(sql`lower(${L.email}) = ${email}`);
      partnerMatch.push(sql`lower(${P.email}) = ${email}`);
    }
    if (phone) {
      leadMatch.push(digits(L.phone));
      partnerMatch.push(digits(P.phone));
    }
    if (word) {
      leadMatch.push(sql`lower(${L.partnerName}) like ${`%${word}%`}`);
      partnerMatch.push(sql`lower(${P.name}) like ${`%${word}%`}`);
    }
    if (!leadMatch.length) return { leads: [], partners: [] };
    const me = { email: lead.email, phone: lead.phone, name: lead.partnerName };

    const leadRows = await tx
      .select({
        id: L.id,
        name: L.name,
        leadType: L.leadType,
        state: L.state,
        email: L.email,
        phone: L.phone,
        partnerName: L.partnerName,
        contactName: L.contactName,
        userId: L.userId,
        userName: schema.users.name,
        createdAt: L.createdAt,
      })
      .from(L)
      .leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(and(eq(L.companyId, lead.companyId), ne(L.id, id), eq(L.state, "open"), or(...leadMatch)))
      .orderBy(desc(L.createdAt))
      .limit(200);
    const ctx = currentContext();
    const seeAll = allowedFor(ctx.permissions, "crm.all", { path: "/leads" });
    const partnerRows = await tx
      .select({ id: P.id, name: P.name, kind: P.kind, email: P.email, phone: P.phone, parentId: P.parentId })
      .from(P)
      .where(
        and(
          eq(P.active, true),
          or(isNull(P.companyId), eq(P.companyId, lead.companyId)),
          lead.partnerId ? ne(P.id, lead.partnerId) : undefined,
          lead.contactId ? ne(P.id, lead.contactId) : undefined,
          or(...partnerMatch),
        ),
      )
      .limit(200);
    return {
      leads: leadRows
        .map((r) => ({
          ...r,
          reasons: duplicateReasons(me, { email: r.email, phone: r.phone, name: r.partnerName }),
          // Boleh dibuka/digabung hanya bila termasuk yang boleh dilihat user ini.
          accessible: seeAll || r.userId === null || r.userId === ctx.userId,
        }))
        .filter((r) => r.reasons.length),
      partners: partnerRows
        .map((r) => ({
          ...r,
          reasons: duplicateReasons(me, { email: r.email, phone: r.phone, name: r.name }),
        }))
        .filter((r) => r.reasons.length),
    };
  }

  /** Gabungkan lead duplikat ke lead ini: field kosong diisi, aktivitas/penawaran/kontak dipindah, sumber dihapus. */
  async merge(tx: Db, id: string, sourceIds: string[]) {
    const target = await this.leads.get(tx, id);
    const ids = [...new Set(sourceIds)];
    if (ids.includes(id)) throw fieldError("sourceIds", "Lead tidak bisa digabung dengan dirinya sendiri");
    const fill: Record<string, unknown> = {};
    const notes: string[] = [];
    let hasProducts = (await tx.select({ id: LP.id }).from(LP).where(eq(LP.leadId, id)).limit(1)).length > 0;
    for (const sourceId of ids) {
      const source = await this.leads.get(tx, sourceId).catch(() => {
        throw fieldError("sourceIds", "Lead duplikat tidak ditemukan");
      });
      if (source.state !== "open") throw fieldError("sourceIds", `Lead "${source.name}" sudah ditutup`);
      for (const f of MERGE_FIELDS)
        if (target[f] == null && fill[f] === undefined && source[f] != null) fill[f] = source[f];
      if (source.description) notes.push(source.description);
      await tx
        .update(schema.scheduledActivities)
        .set({ resId: id })
        .where(
          and(
            eq(schema.scheduledActivities.resModel, "crm_lead"),
            eq(schema.scheduledActivities.resId, sourceId),
          ),
        );
      // Log aktivitas lead sumber tidak dipindah (jejak audit tidak pernah diubah); penggabungan dicatat di sini.
      await tx.update(O).set({ leadId: id }).where(eq(O.leadId, sourceId));
      const roles = await tx.select().from(CR).where(eq(CR.leadId, sourceId));
      if (roles.length)
        await tx
          .insert(CR)
          .values(roles.map((r) => ({ leadId: id, partnerId: r.partnerId, role: r.role, note: r.note })))
          .onConflictDoNothing();
      if (!hasProducts) {
        const moved = await tx.update(LP).set({ leadId: id }).where(eq(LP.leadId, sourceId)).returning();
        if (moved.length) {
          hasProducts = true;
          fill.expectedRevenue = leadProductsTotal(moved);
        }
      }
      if (!hasProducts && Number(target.expectedRevenue) === 0 && Number(source.expectedRevenue) > 0)
        fill.expectedRevenue ??= source.expectedRevenue;
      await tx.delete(L).where(eq(L.id, sourceId));
      await this.activity.log(tx, {
        resModel: "crm_lead",
        resId: id,
        action: "update",
        message: `Digabung dengan lead "${source.name}"`,
      });
    }
    if (notes.length)
      fill.description = [target.description, ...notes].filter(Boolean).join("\n\n").slice(0, 5000);
    if (Object.keys(fill).length)
      await tx
        .update(L)
        .set({ ...fill, updatedAt: sql`now()` })
        .where(eq(L.id, id));
    return this.detail(tx, id);
  }

  /** Corong lead → peluang → menang untuk lead yang dibuat pada periode, plus rincian per sumber & salesperson. */
  async funnel(tx: Db, from?: string, to?: string) {
    const where = and(
      leadScope(),
      from ? sql`${L.createdAt} >= ${from}::date` : undefined,
      to ? sql`${L.createdAt} < ${to}::date + 1` : undefined,
    );
    const rows = await tx
      .select({
        source: L.source,
        campaignId: L.campaignId,
        campaignName: schema.crmCampaigns.name,
        userId: L.userId,
        userName: schema.users.name,
        leadType: L.leadType,
        leadStatus: L.leadStatus,
        state: L.state,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
      })
      .from(L)
      .leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(where)
      .leftJoin(schema.crmCampaigns, eq(schema.crmCampaigns.id, L.campaignId))
      .groupBy(
        L.source,
        L.campaignId,
        schema.crmCampaigns.name,
        L.userId,
        schema.users.name,
        L.leadType,
        L.leadStatus,
        L.state,
      );

    const isOpp = (r: (typeof rows)[number]) => r.leadType === "opportunity";
    const total = (pick: (r: (typeof rows)[number]) => boolean, list = rows) =>
      list.filter(pick).reduce((s, r) => s + r.count, 0);
    const steps = funnelSteps({
      leads: total(() => true),
      contacted: total((r) => isOpp(r) || r.leadStatus === "contacted" || r.leadStatus === "qualified"),
      qualified: total((r) => isOpp(r) || r.leadStatus === "qualified"),
      opportunities: total(isOpp),
      won: total((r) => r.state === "won"),
    });
    const group = <K extends string | null>(
      key: (r: (typeof rows)[number]) => K,
      label: (r: (typeof rows)[number]) => string | null,
    ) => {
      const map = new Map<K, { key: K; label: string | null; rows: typeof rows }>();
      for (const r of rows) {
        const k = key(r);
        if (!map.has(k)) map.set(k, { key: k, label: label(r), rows: [] });
        map.get(k)!.rows.push(r);
      }
      return [...map.values()]
        .map((g) => {
          const won = total((r) => r.state === "won", g.rows);
          const lost = total((r) => r.state === "lost" && isOpp(r), g.rows);
          return {
            key: g.key,
            label: g.label,
            leads: total(() => true, g.rows),
            opportunities: total(isOpp, g.rows),
            won,
            lost,
            winRate: won + lost ? round1((won / (won + lost)) * 100) : null,
            wonAmount: sum2(g.rows.filter((r) => r.state === "won").map((r) => r.amount)),
          };
        })
        .sort((a, b) => b.leads - a.leads);
    };
    return {
      steps,
      unqualified: total((r) => !isOpp(r) && r.leadStatus === "unqualified"),
      bySource: group(
        (r) => r.source,
        (r) => r.source,
      ),
      byCampaign: group(
        (r) => r.campaignId,
        (r) => r.campaignName,
      ).filter((g) => g.key !== null),
      byUser: group(
        (r) => r.userId,
        (r) => r.userName,
      ),
    };
  }

  /** Kecepatan pipeline: rata-rata hari di tiap tahap dan siklus penjualan (peluang yang ditutup pada periode). */
  async velocity(tx: Db, from?: string, to?: string) {
    const rows = await tx
      .select({ h: H, leadState: L.state, amount: L.expectedRevenue })
      .from(H)
      .innerJoin(L, eq(L.id, H.leadId))
      .where(
        and(
          leadScope(),
          eq(L.leadType, "opportunity"),
          to ? sql`${L.createdAt} < ${to}::date + 1` : undefined,
          from ? sql`(${L.closedAt} is null or ${L.closedAt} >= ${from}::date)` : undefined,
        ),
      )
      .orderBy(asc(H.changedAt))
      .limit(50_000);
    const byLead = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byLead.has(r.h.leadId)) byLead.set(r.h.leadId, []);
      byLead.get(r.h.leadId)!.push(r);
    }
    const stages = await tx.select().from(schema.crmStages).orderBy(asc(schema.crmStages.sequence));
    const perStage = new Map<string, number[]>();
    const cycles: Record<"won" | "lost", number[]> = { won: [], lost: [] };
    let wonAmount = new Decimal(0);
    for (const list of byLead.values()) {
      const history = list.map((r) => r.h);
      for (const [stageId, days] of stageDurations(history)) {
        if (!perStage.has(stageId)) perStage.set(stageId, []);
        perStage.get(stageId)!.push(days);
      }
      const state = list[0]!.leadState;
      const cycle = salesCycleDays(history);
      if (cycle !== null && state !== "open") {
        cycles[state].push(cycle);
        if (state === "won") wonAmount = wonAmount.plus(list[0]!.amount);
      }
    }
    const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const decided = cycles.won.length + cycles.lost.length;
    const avgCycle = avg(cycles.won);
    return {
      opportunities: byLead.size,
      stages: stages
        .filter((s) => !s.isWon)
        .map((s) => ({
          stageId: s.id,
          stageName: s.name,
          opportunities: perStage.get(s.id)?.length ?? 0,
          avgDays: avg(perStage.get(s.id) ?? []),
        })),
      won: cycles.won.length,
      lost: cycles.lost.length,
      winRate: decided ? round1((cycles.won.length / decided) * 100) : null,
      avgCycleDays: avgCycle,
      avgLostCycleDays: avg(cycles.lost),
      avgDealSize: cycles.won.length ? wonAmount.div(cycles.won.length).toFixed(2) : null,
      // Nilai yang dimenangkan per hari: peluang × rasio menang × rata-rata nilai ÷ lama siklus.
      velocityPerDay:
        decided && avgCycle !== null && cycles.won.length
          ? new Decimal(byLead.size)
              .times(cycles.won.length / decided)
              .times(wonAmount.div(cycles.won.length))
              .div(Math.max(avgCycle, 1))
              .toFixed(2)
          : null,
    };
  }

  /** Daftar akun (perusahaan pelanggan) atau kontak (perorangan) dengan ringkasan pipeline. */
  async accounts(tx: Db, kind: "company" | "person") {
    const companyId = currentContext().companyId;
    const scope = leadScope();
    const rows = await tx
      .select({
        partner: P,
        parentName: sql<string | null>`(select p2.name from partners p2 where p2.id = ${P.parentId})`,
        salespersonName: schema.users.name,
        openCount: sql<number>`(select count(*)::int from crm_leads where ${scope} and crm_leads.state = 'open'
          and crm_leads.lead_type = 'opportunity'
          and (crm_leads.partner_id = partners.id or crm_leads.contact_id = partners.id))`,
        pipeline: sql<string>`(select coalesce(sum(crm_leads.expected_revenue), 0)::text from crm_leads where ${scope}
          and crm_leads.state = 'open' and crm_leads.lead_type = 'opportunity'
          and (crm_leads.partner_id = partners.id or crm_leads.contact_id = partners.id))`,
        contacts: sql<number>`(select count(*)::int from partners c where c.parent_id = partners.id and c.active)`,
      })
      .from(P)
      .leftJoin(schema.users, eq(schema.users.id, P.salespersonId))
      .where(
        and(
          eq(P.active, true),
          eq(P.kind, kind),
          or(isNull(P.companyId), eq(P.companyId, companyId)),
          kind === "company" ? eq(P.isCustomer, true) : undefined,
        ),
      )
      .orderBy(asc(P.name))
      .limit(5000);
    return {
      items: rows.map((r) => ({
        id: r.partner.id,
        name: r.partner.name,
        kind: r.partner.kind,
        parentId: r.partner.parentId,
        parentName: r.parentName,
        email: r.partner.email,
        phone: r.partner.phone,
        city: r.partner.city,
        industry: r.partner.industry,
        jobTitle: r.partner.jobTitle,
        accountRating: r.partner.accountRating,
        doNotContact: r.partner.doNotContact,
        salespersonName: r.salespersonName,
        openCount: r.openCount,
        pipeline: r.pipeline,
        contacts: r.contacts,
      })),
      total: rows.length,
    };
  }

  /**
   * Tampilan 360° akun/kontak: profil, kontak, peluang, penawaran & pesanan, faktur, aktivitas. Bagian penjualan
   * dan akuntansi hanya diisi bila user punya hak bacanya (selain itu `null`).
   */
  async account360(tx: Db, partnerId: string) {
    const ctx = currentContext();
    const [partner] = await tx.select().from(P).where(eq(P.id, partnerId));
    if (!partner || (partner.companyId && partner.companyId !== ctx.companyId))
      throw new NotFoundException("Akun tidak ditemukan");
    const [parent] = partner.parentId
      ? await tx.select({ id: P.id, name: P.name }).from(P).where(eq(P.id, partner.parentId))
      : [];
    const contacts = await tx
      .select({
        id: P.id,
        name: P.name,
        jobTitle: P.jobTitle,
        email: P.email,
        phone: P.phone,
        doNotContact: P.doNotContact,
      })
      .from(P)
      .where(and(eq(P.parentId, partnerId), eq(P.active, true)))
      .orderBy(asc(P.name));
    const [salesperson] = partner.salespersonId
      ? await tx
          .select({ name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.id, partner.salespersonId))
      : [];

    const leads = await tx
      .select({ lead: L, stageName: schema.crmStages.name, userName: schema.users.name })
      .from(L)
      .leftJoin(schema.crmStages, eq(schema.crmStages.id, L.stageId))
      .leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(and(leadScope(), or(eq(L.partnerId, partnerId), eq(L.contactId, partnerId))))
      .orderBy(desc(L.createdAt))
      .limit(200);
    const opps = leads.filter((r) => r.lead.leadType === "opportunity");
    const open = opps.filter((r) => r.lead.state === "open");
    const won = opps.filter((r) => r.lead.state === "won");
    const lost = opps.filter((r) => r.lead.state === "lost");

    const leadIds = leads.map((r) => r.lead.id);
    const activityFilter = or(
      and(
        eq(schema.scheduledActivities.resModel, "partner"),
        eq(schema.scheduledActivities.resId, partnerId),
      ),
      leadIds.length
        ? and(
            eq(schema.scheduledActivities.resModel, "crm_lead"),
            inArray(schema.scheduledActivities.resId, leadIds),
          )
        : undefined,
    );
    const activities = await tx
      .select({ a: schema.scheduledActivities, userName: schema.users.name })
      .from(schema.scheduledActivities)
      .leftJoin(schema.users, eq(schema.users.id, schema.scheduledActivities.userId))
      .where(activityFilter)
      .orderBy(
        sql`${schema.scheduledActivities.doneAt} is not null`,
        asc(schema.scheduledActivities.dueDate),
        desc(schema.scheduledActivities.doneAt),
      )
      .limit(50);

    let sales: unknown = null;
    if (allowedFor(ctx.permissions, "sales.read", { path: "/sale-orders" })) {
      const orders = await tx
        .select({
          id: O.id,
          name: O.name,
          state: O.state,
          dateOrder: O.dateOrder,
          amountTotal: O.amountTotal,
          currencyCode: O.currencyCode,
          leadId: O.leadId,
        })
        .from(O)
        .where(and(ownedScope(O.companyId, O.userId, "sales.all"), eq(O.partnerId, partnerId)))
        .orderBy(desc(O.dateOrder), desc(O.createdAt))
        .limit(50);
      sales = {
        orders,
        quotations: orders.filter((o) => o.state === "draft" || o.state === "sent").length,
        confirmed: orders.filter((o) => o.state === "sale").length,
        confirmedAmount: sum2(orders.filter((o) => o.state === "sale").map((o) => o.amountTotal)),
      };
    }

    let invoicing: unknown = null;
    if (allowedFor(ctx.permissions, "accounting.read", { path: "/moves" })) {
      const invoices = await tx
        .select({
          id: M.id,
          name: M.name,
          moveType: M.moveType,
          date: M.date,
          dueDate: M.dueDate,
          amountTotal: M.amountTotal,
          amountResidual: M.amountResidual,
          paymentState: M.paymentState,
        })
        .from(M)
        .where(
          and(
            eq(M.companyId, ctx.companyId),
            eq(M.partnerId, partnerId),
            eq(M.state, "posted"),
            inArray(M.moveType, ["out_invoice", "out_refund"]),
          ),
        )
        .orderBy(desc(M.date))
        .limit(50);
      const today = new Date().toISOString().slice(0, 10);
      const unpaid = invoices.filter((i) => i.moveType === "out_invoice" && Number(i.amountResidual) > 0);
      invoicing = {
        invoices,
        invoiced: sum2(invoices.filter((i) => i.moveType === "out_invoice").map((i) => i.amountTotal)),
        outstanding: sum2(unpaid.map((i) => i.amountResidual)),
        overdue: sum2(unpaid.filter((i) => i.dueDate && i.dueDate < today).map((i) => i.amountResidual)),
      };
    }

    return {
      partner: { ...partner, salespersonName: salesperson?.name ?? null },
      parent: parent ?? null,
      contacts,
      summary: {
        openCount: open.length,
        pipeline: sum2(open.map((r) => r.lead.expectedRevenue)),
        weighted: sum2(open.map((r) => weightedRevenue(r.lead.expectedRevenue, r.lead.probability))),
        wonCount: won.length,
        wonAmount: sum2(won.map((r) => r.lead.expectedRevenue)),
        lostCount: lost.length,
        winRate: won.length + lost.length ? round1((won.length / (won.length + lost.length)) * 100) : null,
        openLeads: leads.filter((r) => r.lead.leadType === "lead" && r.lead.state === "open").length,
      },
      leads: leads.map((r) => ({
        id: r.lead.id,
        name: r.lead.name,
        leadType: r.lead.leadType,
        leadStatus: r.lead.leadStatus,
        state: r.lead.state,
        stageName: r.stageName,
        userName: r.userName,
        expectedRevenue: r.lead.expectedRevenue,
        probability: r.lead.probability,
        expectedClose: r.lead.expectedClose,
        nextStep: r.lead.nextStep,
        createdAt: r.lead.createdAt,
      })),
      activities: activities.map((r) => ({ ...r.a, userName: r.userName })),
      sales,
      invoicing,
    };
  }

  private async partnerNames(tx: Db, ids: (string | null)[]) {
    const list = ids.filter((x): x is string => Boolean(x));
    const rows = await tx.select({ id: P.id, name: P.name }).from(P).where(inArray(P.id, list));
    return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<string, string>;
  }
}
