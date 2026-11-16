import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, or, schema, sql, type Db, type SQL } from "@erp/db";
import {
  LIST_LOAD_LIMIT,
  weightedRevenue,
  type convertLeadSchema,
  type leadSchema,
  type markLostSchema,
} from "@erp/shared";
import { normalizeCustom } from "../customization/custom-values.js";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertDimensions, assertPartner, fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { assertCompanyUser, assertTeam, ownedScope } from "./checks.js";
import { leadScore } from "./scoring.js";
import { resolveTerritory } from "./territory.js";

export type LeadInput = z.infer<typeof leadSchema>;
type Lead = typeof schema.crmLeads.$inferSelect;

const L = schema.crmLeads;
const scope = () => ownedScope(L.companyId, L.userId, "crm.all");

export interface LeadQuery {
  q?: string;
  leadType?: string;
  /** Satu atau beberapa state dipisah koma (open,won,lost). */
  state?: string;
  stageId?: string;
  userId?: string;
  limit?: string;
  offset?: string;
}

@Injectable()
export class LeadService {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  async list(tx: Db, query: LeadQuery) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), LIST_LOAD_LIMIT);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters: (SQL | undefined)[] = [scope()];
    if (query.q) {
      const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(
        or(ilike(L.name, term), ilike(L.partnerName, term), ilike(L.contactName, term), ilike(L.email, term)),
      );
    }
    if (query.leadType === "lead" || query.leadType === "opportunity")
      filters.push(eq(L.leadType, query.leadType));
    const states = (query.state ?? "")
      .split(",")
      .filter((s): s is Lead["state"] => s === "open" || s === "won" || s === "lost");
    if (states.length) filters.push(inArray(L.state, states));
    if (query.stageId) filters.push(eq(L.stageId, query.stageId));
    if (query.userId === "me") filters.push(eq(L.userId, currentContext().userId));
    else if (query.userId) filters.push(eq(L.userId, query.userId));
    const where = and(...filters);

    const items = await tx
      .select({
        lead: L,
        stageName: schema.crmStages.name,
        partnerDisplay: schema.partners.name,
        userName: schema.users.name,
        // Aktivitas terjadwal terdekat yang belum selesai (untuk penanda di kanban/list).
        nextActivity: sql<string | null>`(
          select min(a.due_date)::text from ${schema.scheduledActivities} a
          where a.res_model = 'crm_lead' and a.res_id = crm_leads.id and a.done_at is null)`,
      })
      .from(L)
      .leftJoin(schema.crmStages, eq(schema.crmStages.id, L.stageId))
      .leftJoin(schema.partners, eq(schema.partners.id, L.partnerId))
      .leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(where)
      .orderBy(desc(L.priority), desc(L.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(L).where(where);
    return {
      items: items.map((r) => ({
        ...r.lead,
        stageName: r.stageName,
        partnerDisplay: r.partnerDisplay ?? r.lead.partnerName,
        userName: r.userName,
        nextActivity: r.nextActivity,
        weightedRevenue: weightedRevenue(r.lead.expectedRevenue, r.lead.probability),
      })),
      total,
      limit,
      offset,
    };
  }

  async get(tx: Db, id: string): Promise<Lead> {
    const [lead] = await tx
      .select()
      .from(L)
      .where(and(eq(L.id, id), scope()));
    if (!lead) throw new NotFoundException("Lead tidak ditemukan");
    return lead;
  }

  async create(tx: Db, input: LeadInput) {
    const ctx = currentContext();
    await this.validate(tx, input);
    let stageId = input.stageId ?? null;
    if (!stageId && input.leadType === "opportunity") stageId = (await this.firstStage(tx))?.id ?? null;
    const stage = stageId ? await this.stage(tx, stageId) : null;
    if (stage?.isWon) throw fieldError("stageId", "Gunakan aksi 'Tandai menang' untuk tahap menang");
    const [lead] = await tx
      .insert(L)
      .values({
        ...input,
        custom: await normalizeCustom(tx, "crm_lead", input.custom, null, ctx.companyId),
        companyId: ctx.companyId,
        stageId,
        // Tanpa penugasan eksplisit, lead milik pembuatnya.
        userId: input.userId === undefined ? ctx.userId : input.userId,
        probability: input.probability ?? stage?.probability ?? "10",
        // Peluang yang dibuat langsung dianggap sudah terkualifikasi.
        leadStatus: input.leadType === "opportunity" ? "qualified" : input.leadStatus,
        territoryId: input.territoryId ?? (await this.territoryFor(tx, ctx.companyId, input)),
        score: await leadScore(tx, ctx.companyId, input),
      })
      .returning();
    if (lead!.campaignId) await this.joinCampaign(tx, lead!.campaignId, lead!.id);
    if (lead!.leadType === "opportunity") await this.track(tx, lead!, null);
    await this.activity.log(tx, { resModel: "crm_lead", resId: lead!.id, action: "create" });
    return lead!;
  }

  /** Perbarui sebagian field. Pindah tahap mengikuti probabilitas tahap; tahap "menang" = tandai menang. */
  async update(tx: Db, id: string, sent: Partial<LeadInput>) {
    const before = await this.get(tx, id);
    await this.validate(tx, sent);
    const values: Partial<typeof L.$inferInsert> = { ...sent };
    if (sent.custom !== undefined)
      values.custom = await normalizeCustom(tx, "crm_lead", sent.custom, before.custom, before.companyId);
    else delete values.custom;
    // Nilai peluang yang punya baris produk selalu = jumlah produknya.
    if (sent.expectedRevenue !== undefined && (await this.hasProducts(tx, id))) delete values.expectedRevenue;
    if (sent.stageId !== undefined && sent.stageId !== before.stageId) {
      if (before.state === "lost")
        throw new BadRequestException("Pulihkan lead yang kalah sebelum memindah tahap");
      const stage = sent.stageId ? await this.stage(tx, sent.stageId) : null;
      if (sent.probability === undefined && stage) values.probability = stage.probability;
      if (stage?.isWon) Object.assign(values, { state: "won", probability: "100", closedAt: new Date() });
      else if (before.state === "won") Object.assign(values, { state: "open", closedAt: null });
    }
    if (Object.keys(values).length === 0) return before;
    const [row] = await tx
      .update(L)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(L.id, id))
      .returning();
    const score = await leadScore(tx, row!.companyId, row!);
    if (score !== row!.score) {
      await tx.update(L).set({ score }).where(eq(L.id, id));
      row!.score = score;
    }
    if (row!.campaignId && row!.campaignId !== before.campaignId)
      await this.joinCampaign(tx, row!.campaignId, id);
    if (row!.leadType === "opportunity" && (row!.stageId !== before.stageId || row!.state !== before.state))
      await this.track(tx, row!, before.stageId);
    const changes = Object.fromEntries(
      Object.entries(values)
        .filter(([k, v]) => String(before[k as keyof Lead] ?? "") !== String(v ?? ""))
        .map(([k, v]) => [k, { from: before[k as keyof Lead], to: v }]),
    );
    await this.activity.log(tx, { resModel: "crm_lead", resId: id, action: "update", changes });
    return row!;
  }

  async remove(tx: Db, id: string) {
    await this.get(tx, id);
    const [order] = await tx
      .select({ id: schema.saleOrders.id })
      .from(schema.saleOrders)
      .where(eq(schema.saleOrders.leadId, id))
      .limit(1);
    if (order) throw new BadRequestException("Lead sudah punya penawaran; tandai kalah alih-alih menghapus");
    await tx
      .delete(schema.scheduledActivities)
      .where(
        and(eq(schema.scheduledActivities.resModel, "crm_lead"), eq(schema.scheduledActivities.resId, id)),
      );
    await tx.delete(L).where(eq(L.id, id));
    await this.activity.log(tx, { resModel: "crm_lead", resId: id, action: "delete" });
  }

  async markWon(tx: Db, id: string) {
    const lead = await this.get(tx, id);
    if (lead.state === "won") return lead;
    const [wonStage] = await tx
      .select()
      .from(schema.crmStages)
      .where(eq(schema.crmStages.isWon, true))
      .orderBy(asc(schema.crmStages.sequence))
      .limit(1);
    return this.close(
      tx,
      lead,
      {
        state: "won",
        probability: "100",
        leadType: "opportunity",
        stageId: wonStage?.id ?? lead.stageId,
        lostReasonId: null,
        lostNote: null,
      },
      "Ditandai menang",
    );
  }

  /**
   * Dipanggil saat pesanan penjualan dikonfirmasi: peluang terbuka ditandai menang tanpa aturan rekaman
   * (penjual boleh mengonfirmasi pesanan dari peluang yang ditugaskan ke orang lain).
   */
  async winFromOrder(tx: Db, leadId: string, orderName: string) {
    const [lead] = await tx.select().from(L).where(eq(L.id, leadId));
    if (!lead || lead.state !== "open") return;
    const [wonStage] = await tx
      .select()
      .from(schema.crmStages)
      .where(eq(schema.crmStages.isWon, true))
      .orderBy(asc(schema.crmStages.sequence))
      .limit(1);
    await this.close(
      tx,
      lead,
      { state: "won", probability: "100", leadType: "opportunity", stageId: wonStage?.id ?? lead.stageId },
      `Menang: pesanan ${orderName} dikonfirmasi`,
    );
  }

  async markLost(tx: Db, id: string, input: z.infer<typeof markLostSchema>) {
    const lead = await this.get(tx, id);
    if (input.lostReasonId) {
      const [reason] = await tx
        .select({ id: schema.crmLostReasons.id })
        .from(schema.crmLostReasons)
        .where(eq(schema.crmLostReasons.id, input.lostReasonId));
      if (!reason) throw fieldError("lostReasonId", "Alasan kalah tidak ditemukan");
    }
    return this.close(
      tx,
      lead,
      {
        state: "lost",
        probability: "0",
        lostReasonId: input.lostReasonId ?? null,
        lostNote: input.lostNote ?? null,
      },
      `Ditandai kalah${input.lostNote ? `: ${input.lostNote}` : ""}`,
    );
  }

  /** Buka kembali lead yang menang/kalah; probabilitas kembali ke tahapnya. */
  async reopen(tx: Db, id: string) {
    const lead = await this.get(tx, id);
    if (lead.state === "open") return lead;
    let stage = lead.stageId ? await this.stage(tx, lead.stageId) : null;
    // Lead menang berada di tahap menang; kembalikan ke tahap terbuka pertama.
    if (stage?.isWon) stage = (await this.firstStage(tx)) ?? null;
    const [row] = await tx
      .update(L)
      .set({
        state: "open",
        stageId: stage?.id ?? null,
        probability: stage?.probability ?? "10",
        lostReasonId: null,
        lostNote: null,
        closedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(L.id, id))
      .returning();
    if (row!.leadType === "opportunity") await this.track(tx, row!, lead.stageId);
    await this.activity.log(tx, {
      resModel: "crm_lead",
      resId: id,
      action: "update",
      message: "Dibuka kembali",
    });
    return row!;
  }

  /**
   * Konversi lead menjadi peluang: menautkan/membuat akun (pelanggan), kontak di bawah akun itu, dan mencatat
   * kontak sebagai kontak utama peluang.
   */
  async convert(tx: Db, id: string, input: z.infer<typeof convertLeadSchema>) {
    const lead = await this.get(tx, id);
    if (lead.state !== "open") throw new BadRequestException("Hanya lead terbuka yang bisa dikonversi");
    if (lead.leadType !== "lead") throw new BadRequestException("Lead ini sudah menjadi peluang");
    let partnerId = lead.partnerId;
    let accountKind: "company" | "person" | null = null;
    if (input.partner === "existing") {
      if (!input.partnerId) throw fieldError("partnerId", "Pilih pelanggan");
      const partner = await assertPartner(tx, lead.companyId, input.partnerId);
      partnerId = partner.id;
      accountKind = partner.kind;
    } else if (input.partner === "create" && !partnerId) {
      accountKind = lead.partnerName ? "company" : "person";
      const [partner] = await tx
        .insert(schema.partners)
        .values({
          name: lead.partnerName || lead.contactName || lead.name,
          kind: accountKind,
          isCustomer: true,
          email: lead.email,
          phone: lead.phone,
          street: lead.street,
          city: lead.city,
          province: lead.province,
          industry: lead.industry,
          website: lead.website,
          employeeCount: lead.employeeCount,
          annualRevenue: lead.annualRevenue,
          jobTitle: accountKind === "person" ? lead.title : null,
          salespersonId: lead.userId,
          territoryId: lead.territoryId ?? (await this.territoryFor(tx, lead.companyId, lead)),
        })
        .returning({ id: schema.partners.id });
      partnerId = partner!.id;
      await this.activity.log(tx, {
        resModel: "partner",
        resId: partnerId,
        action: "create",
        message: `Dibuat dari lead "${lead.name}"`,
      });
    } else if (partnerId) {
      accountKind = (await assertPartner(tx, lead.companyId, partnerId)).kind;
    }

    // Wilayah peluang & kontak mengikuti akun; tanpa akun, dari aturan wilayah atas data lead.
    const territoryId =
      lead.territoryId ?? (await this.territoryFor(tx, lead.companyId, { ...lead, partnerId }));
    let contactId = lead.contactId;
    if (input.contact === "existing") {
      if (!input.contactId) throw fieldError("contactId", "Pilih kontak");
      contactId = (await assertPartner(tx, lead.companyId, input.contactId, "contactId")).id;
    } else if (input.contact === "create" && !contactId && partnerId) {
      if (accountKind === "person") contactId = partnerId;
      else if (lead.contactName) {
        // Kontak yang sama (nama + akun) tidak dibuat dua kali.
        const [existing] = await tx
          .select({ id: schema.partners.id })
          .from(schema.partners)
          .where(
            and(
              eq(schema.partners.parentId, partnerId),
              sql`lower(${schema.partners.name}) = lower(${lead.contactName})`,
            ),
          )
          .limit(1);
        if (existing) contactId = existing.id;
        else {
          const [contact] = await tx
            .insert(schema.partners)
            .values({
              name: lead.contactName,
              kind: "person",
              parentId: partnerId,
              isCustomer: true,
              email: lead.email,
              phone: lead.phone,
              jobTitle: lead.title,
              territoryId,
            })
            .returning({ id: schema.partners.id });
          contactId = contact!.id;
          await this.activity.log(tx, {
            resModel: "partner",
            resId: contactId,
            action: "create",
            message: `Kontak dibuat dari lead "${lead.name}"`,
          });
        }
      }
    }

    const stage = lead.stageId ? await this.stage(tx, lead.stageId) : await this.firstStage(tx);
    const [row] = await tx
      .update(L)
      .set({
        leadType: "opportunity",
        leadStatus: "qualified",
        name: input.opportunityName ?? lead.name,
        partnerId,
        contactId,
        territoryId,
        convertedAt: new Date(),
        stageId: stage?.id ?? null,
        probability: lead.stageId ? lead.probability : (stage?.probability ?? lead.probability),
        updatedAt: sql`now()`,
      })
      .where(eq(L.id, id))
      .returning();
    if (contactId)
      await tx
        .insert(schema.crmContactRoles)
        .values({ leadId: id, partnerId: contactId, role: "decision_maker", isPrimary: true })
        .onConflictDoNothing();
    await this.track(tx, row!, null);
    await this.activity.log(tx, {
      resModel: "crm_lead",
      resId: id,
      action: "update",
      message: "Dikonversi menjadi peluang",
    });
    return row!;
  }

  /** Ringkasan pipeline per tahap (peluang terbuka) beserta statistik menang/kalah pada rentang tanggal. */
  async pipeline(tx: Db, from?: string, to?: string) {
    const stages = await tx.select().from(schema.crmStages).orderBy(asc(schema.crmStages.sequence));
    const open = await tx
      .select({
        stageId: L.stageId,
        count: count(),
        expected: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
        weighted: sql<string>`coalesce(sum(${L.expectedRevenue} * ${L.probability} / 100), 0)::text`,
      })
      .from(L)
      .where(and(scope(), eq(L.leadType, "opportunity"), eq(L.state, "open")))
      .groupBy(L.stageId);
    const closedFilter = and(
      scope(),
      inArray(L.state, ["won", "lost"]),
      from ? sql`${L.closedAt} >= ${from}::date` : undefined,
      to ? sql`${L.closedAt} < ${to}::date + 1` : undefined,
    );
    const closed = await tx
      .select({
        state: L.state,
        count: count(),
        amount: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
      })
      .from(L)
      .where(closedFilter)
      .groupBy(L.state);
    const lostByReason = await tx
      .select({ reason: schema.crmLostReasons.name, count: count() })
      .from(L)
      .leftJoin(schema.crmLostReasons, eq(schema.crmLostReasons.id, L.lostReasonId))
      .where(and(closedFilter, eq(L.state, "lost")))
      .groupBy(schema.crmLostReasons.name);
    const round2 = (v: string) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    const won = closed.find((c) => c.state === "won");
    const lost = closed.find((c) => c.state === "lost");
    const decided = (won?.count ?? 0) + (lost?.count ?? 0);
    const rows = [...stages.map((s) => ({ id: s.id, name: s.name })), { id: null, name: null }].map((s) => {
      const r = open.find((o) => o.stageId === s.id);
      return {
        stageId: s.id,
        stageName: s.name,
        count: r?.count ?? 0,
        expected: round2(r?.expected ?? "0"),
        weighted: round2(r?.weighted ?? "0"),
      };
    });
    return {
      stages: rows.filter((r) => r.stageId || r.count),
      won: { count: won?.count ?? 0, amount: round2(won?.amount ?? "0") },
      lost: { count: lost?.count ?? 0, amount: round2(lost?.amount ?? "0") },
      winRate: decided ? new Decimal(won?.count ?? 0).div(decided).times(100).toFixed(1) : null,
      lostByReason,
    };
  }

  private async close(tx: Db, lead: Lead, values: Partial<typeof L.$inferInsert>, message: string) {
    const [row] = await tx
      .update(L)
      .set({ ...values, closedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(L.id, lead.id))
      .returning();
    await this.track(tx, row!, lead.stageId);
    await this.activity.log(tx, { resModel: "crm_lead", resId: lead.id, action: "update", message });
    return row!;
  }

  /** Lead yang ditautkan ke kampanye otomatis menjadi anggota kampanye itu (status merespons). */
  private async joinCampaign(tx: Db, campaignId: string, leadId: string) {
    await tx
      .insert(schema.crmCampaignMembers)
      .values({ campaignId, leadId, status: "responded", respondedAt: new Date() })
      .onConflictDoNothing();
  }

  /** Wilayah dari akun (bila sudah ditetapkan) atau dari aturan wilayah atas provinsi/kota/industri. */
  private async territoryFor(
    tx: Db,
    companyId: string,
    subject: {
      partnerId?: string | null;
      province?: string | null;
      city?: string | null;
      industry?: string | null;
    },
  ) {
    if (subject.partnerId) {
      const [partner] = await tx
        .select()
        .from(schema.partners)
        .where(eq(schema.partners.id, subject.partnerId));
      if (partner?.territoryId) return partner.territoryId;
      if (partner) return (await resolveTerritory(tx, companyId, partner))?.id ?? null;
    }
    return (await resolveTerritory(tx, companyId, subject))?.id ?? null;
  }

  /** Catat perpindahan tahap/status untuk laporan kecepatan pipeline. */
  private async track(tx: Db, lead: Lead, fromStageId: string | null) {
    await tx.insert(schema.crmStageHistory).values({
      leadId: lead.id,
      fromStageId,
      toStageId: lead.stageId,
      state: lead.state,
      expectedRevenue: lead.expectedRevenue,
      probability: lead.probability,
      userId: currentContext().userId,
    });
  }

  private async hasProducts(tx: Db, leadId: string) {
    const [row] = await tx
      .select({ id: schema.crmLeadProducts.id })
      .from(schema.crmLeadProducts)
      .where(eq(schema.crmLeadProducts.leadId, leadId))
      .limit(1);
    return Boolean(row);
  }

  private async validate(tx: Db, input: Partial<LeadInput>) {
    const companyId = currentContext().companyId;
    if (input.partnerId) await assertPartner(tx, companyId, input.partnerId);
    if (input.contactId) await assertPartner(tx, companyId, input.contactId, "contactId");
    if (input.campaignId) {
      const [c] = await tx
        .select({ companyId: schema.crmCampaigns.companyId })
        .from(schema.crmCampaigns)
        .where(eq(schema.crmCampaigns.id, input.campaignId));
      if (!c || c.companyId !== companyId) throw fieldError("campaignId", "Kampanye tidak ditemukan");
    }
    if (input.territoryId) {
      const [t] = await tx
        .select({ companyId: schema.crmTerritories.companyId })
        .from(schema.crmTerritories)
        .where(eq(schema.crmTerritories.id, input.territoryId));
      if (!t || t.companyId !== companyId) throw fieldError("territoryId", "Wilayah tidak ditemukan");
    }
    if (input.stageId) await this.stage(tx, input.stageId);
    if (input.userId) await assertCompanyUser(tx, input.userId);
    if (input.teamId) await assertTeam(tx, input.teamId);
    await assertDimensions(tx, companyId, [input]).catch((e: unknown) => {
      // Pesan dimensi memakai path baris jurnal; sesuaikan untuk form lead.
      if (e instanceof BadRequestException) {
        const res = e.getResponse() as { errors?: { path: string; message: string }[] };
        throw fieldError(
          res.errors?.[0]?.path.replace(/^lines\.0\./, "") ?? "",
          res.errors?.[0]?.message ?? "",
        );
      }
      throw e;
    });
  }

  private async stage(tx: Db, id: string) {
    const [stage] = await tx.select().from(schema.crmStages).where(eq(schema.crmStages.id, id));
    if (!stage) throw fieldError("stageId", "Tahap tidak ditemukan");
    return stage;
  }

  private async firstStage(tx: Db) {
    const [stage] = await tx
      .select()
      .from(schema.crmStages)
      .where(eq(schema.crmStages.isWon, false))
      .orderBy(asc(schema.crmStages.sequence))
      .limit(1);
    return stage;
  }
}
