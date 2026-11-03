import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, or, schema, sql, type Db, type SQL } from "@erp/db";
import {
  LIST_LOAD_LIMIT,
  weightedRevenue,
  type convertLeadSchema,
  type leadSchema,
  type markLostSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertDimensions, assertPartner, fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { assertCompanyUser, assertTeam, ownedScope } from "./checks.js";

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
        companyId: ctx.companyId,
        stageId,
        // Tanpa penugasan eksplisit, lead milik pembuatnya.
        userId: input.userId === undefined ? ctx.userId : input.userId,
        probability: input.probability ?? stage?.probability ?? "10",
      })
      .returning();
    await this.activity.log(tx, { resModel: "crm_lead", resId: lead!.id, action: "create" });
    return lead!;
  }

  /** Perbarui sebagian field. Pindah tahap mengikuti probabilitas tahap; tahap "menang" = tandai menang. */
  async update(tx: Db, id: string, sent: Partial<LeadInput>) {
    const before = await this.get(tx, id);
    await this.validate(tx, sent);
    const values: Partial<typeof L.$inferInsert> = { ...sent };
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
    await this.activity.log(tx, {
      resModel: "crm_lead",
      resId: id,
      action: "update",
      message: "Dibuka kembali",
    });
    return row!;
  }

  /** Konversi lead menjadi peluang, sekaligus menautkan/membuat pelanggan. */
  async convert(tx: Db, id: string, input: z.infer<typeof convertLeadSchema>) {
    const lead = await this.get(tx, id);
    if (lead.state !== "open") throw new BadRequestException("Hanya lead terbuka yang bisa dikonversi");
    let partnerId = lead.partnerId;
    if (input.partner === "existing") {
      if (!input.partnerId) throw fieldError("partnerId", "Pilih pelanggan");
      partnerId = (await assertPartner(tx, lead.companyId, input.partnerId)).id;
    } else if (input.partner === "create" && !partnerId) {
      const [partner] = await tx
        .insert(schema.partners)
        .values({
          name: lead.partnerName || lead.contactName || lead.name,
          kind: lead.partnerName ? "company" : "person",
          isCustomer: true,
          email: lead.email,
          phone: lead.phone,
        })
        .returning({ id: schema.partners.id });
      partnerId = partner!.id;
      await this.activity.log(tx, {
        resModel: "partner",
        resId: partnerId,
        action: "create",
        message: `Dibuat dari lead "${lead.name}"`,
      });
    }
    const stage = lead.stageId ? await this.stage(tx, lead.stageId) : await this.firstStage(tx);
    const [row] = await tx
      .update(L)
      .set({
        leadType: "opportunity",
        partnerId,
        stageId: stage?.id ?? null,
        probability: lead.stageId ? lead.probability : (stage?.probability ?? lead.probability),
        updatedAt: sql`now()`,
      })
      .where(eq(L.id, id))
      .returning();
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
    await this.activity.log(tx, { resModel: "crm_lead", resId: lead.id, action: "update", message });
    return row!;
  }

  private async validate(tx: Db, input: Partial<LeadInput>) {
    const companyId = currentContext().companyId;
    if (input.partnerId) await assertPartner(tx, companyId, input.partnerId);
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
