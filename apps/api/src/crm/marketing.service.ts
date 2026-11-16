import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, schema, sql, type Db } from "@erp/db";
import {
  WEB_FORM_FIELDS,
  campaignRoi,
  renderTemplate,
  webFormError,
  webFormSubmissionSchema,
  type campaignEmailSchema,
  type campaignMembersSchema,
  type webFormSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { issueTenantToken, parseTenantToken } from "../common/crypto.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { assignLead, leadScore, openLeadLoad } from "./scoring.js";
import { resolveTerritory } from "./territory.js";

const L = schema.crmLeads;
const P = schema.partners;
const C = schema.crmCampaigns;
const M = schema.crmCampaignMembers;
const F = schema.crmWebForms;
const MAX_RECIPIENTS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MarketingService {
  constructor(
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- Kampanye ----

  private async campaign(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Kampanye tidak ditemukan");
    return row;
  }

  /** Hasil per kampanye: anggota, lead, peluang, menang, nilai menang, ROI. */
  async stats(tx: Db, campaignId?: string) {
    const companyId = currentContext().companyId;
    const campaigns = await tx
      .select()
      .from(C)
      .where(and(eq(C.companyId, companyId), campaignId ? eq(C.id, campaignId) : undefined))
      .orderBy(desc(C.createdAt));
    if (!campaigns.length) return [];
    const ids = campaigns.map((c) => c.id);
    const leadRows = await tx
      .select({
        campaignId: L.campaignId,
        leadType: L.leadType,
        state: L.state,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${L.expectedRevenue}), 0)::text`,
      })
      .from(L)
      .where(and(eq(L.companyId, companyId), inArray(L.campaignId, ids)))
      .groupBy(L.campaignId, L.leadType, L.state);
    const memberRows = await tx
      .select({ campaignId: M.campaignId, status: M.status, count: sql<number>`count(*)::int` })
      .from(M)
      .where(inArray(M.campaignId, ids))
      .groupBy(M.campaignId, M.status);
    return campaigns.map((c) => {
      const mine = leadRows.filter((r) => r.campaignId === c.id);
      const count = (pick: (r: (typeof mine)[number]) => boolean) =>
        mine.filter(pick).reduce((s, r) => s + r.count, 0);
      const wonAmount = mine
        .filter((r) => r.state === "won")
        .reduce((s, r) => s.plus(r.amount), new Decimal(0));
      const pipeline = mine
        .filter((r) => r.state === "open" && r.leadType === "opportunity")
        .reduce((s, r) => s.plus(r.amount), new Decimal(0));
      const members = memberRows.filter((r) => r.campaignId === c.id);
      const leads = count(() => true);
      return {
        ...c,
        members: members.reduce((s, r) => s + r.count, 0),
        sent: members
          .filter((r) => r.status !== "targeted" && r.status !== "failed")
          .reduce((s, r) => s + r.count, 0),
        responded: members.find((r) => r.status === "responded")?.count ?? 0,
        unsubscribed: members.find((r) => r.status === "unsubscribed")?.count ?? 0,
        leads,
        opportunities: count((r) => r.leadType === "opportunity"),
        won: count((r) => r.state === "won"),
        wonAmount: wonAmount.toFixed(2),
        pipeline: pipeline.toFixed(2),
        ...campaignRoi({ cost: c.actualCost, wonAmount, leads }),
      };
    });
  }

  async detail(tx: Db, id: string) {
    await this.campaign(tx, id);
    const [stats] = await this.stats(tx, id);
    const members = await tx
      .select({
        member: M,
        leadName: L.name,
        leadContact: L.contactName,
        leadCompany: L.partnerName,
        leadEmail: L.email,
        leadBlocked: L.doNotContact,
        partnerName: P.name,
        partnerEmail: P.email,
        partnerBlocked: P.doNotContact,
      })
      .from(M)
      .leftJoin(L, eq(L.id, M.leadId))
      .leftJoin(P, eq(P.id, M.partnerId))
      .where(eq(M.campaignId, id))
      .orderBy(desc(M.createdAt))
      .limit(5000);
    const blasts = await tx
      .select({ blast: schema.crmEmailBlasts, userName: schema.users.name })
      .from(schema.crmEmailBlasts)
      .leftJoin(schema.users, eq(schema.users.id, schema.crmEmailBlasts.sentBy))
      .where(eq(schema.crmEmailBlasts.campaignId, id))
      .orderBy(desc(schema.crmEmailBlasts.sentAt));
    return {
      ...stats!,
      memberList: members.map((r) => ({
        ...r.member,
        kind: r.member.leadId ? ("lead" as const) : ("partner" as const),
        name: r.member.leadId ? (r.leadContact ?? r.leadCompany ?? r.leadName) : r.partnerName,
        company: r.member.leadId ? r.leadCompany : null,
        email: r.member.leadId ? r.leadEmail : r.partnerEmail,
        doNotContact: Boolean(r.member.leadId ? r.leadBlocked : r.partnerBlocked),
      })),
      emails: blasts.map((r) => ({ ...r.blast, userName: r.userName })),
    };
  }

  /** Tambah penerima: lead/kontak terpilih, atau segmen lead terbuka. Yang sudah menjadi anggota dilewati. */
  async addMembers(tx: Db, id: string, input: z.infer<typeof campaignMembersSchema>) {
    const campaign = await this.campaign(tx, id);
    const leadIds = new Set(input.leadIds);
    if (input.segment) {
      const s = input.segment;
      const rows = await tx
        .select({ id: L.id })
        .from(L)
        .where(
          and(
            eq(L.companyId, campaign.companyId),
            eq(L.state, "open"),
            s.source ? sql`${L.source} = ${s.source}` : undefined,
            s.leadStatus ? sql`${L.leadStatus} = ${s.leadStatus}` : undefined,
            s.territoryId ? eq(L.territoryId, s.territoryId) : undefined,
            s.minScore ? gte(L.score, s.minScore) : undefined,
          ),
        )
        .limit(MAX_RECIPIENTS);
      for (const r of rows) leadIds.add(r.id);
    }
    const validLeads = leadIds.size
      ? await tx
          .select({ id: L.id })
          .from(L)
          .where(and(eq(L.companyId, campaign.companyId), inArray(L.id, [...leadIds])))
      : [];
    const validPartners = input.partnerIds.length
      ? await tx
          .select({ id: P.id })
          .from(P)
          .where(
            and(
              inArray(P.id, input.partnerIds),
              or(isNull(P.companyId), eq(P.companyId, campaign.companyId)),
            ),
          )
      : [];
    const values = [
      ...validLeads.map((l) => ({ campaignId: id, leadId: l.id })),
      ...validPartners.map((p) => ({ campaignId: id, partnerId: p.id })),
    ];
    const added = values.length
      ? await tx.insert(M).values(values).onConflictDoNothing().returning({ id: M.id })
      : [];
    return { added: added.length, skipped: values.length - added.length };
  }

  private async member(tx: Db, campaignId: string, memberId: string) {
    await this.campaign(tx, campaignId);
    const [row] = await tx
      .select()
      .from(M)
      .where(and(eq(M.id, memberId), eq(M.campaignId, campaignId)));
    if (!row) throw new NotFoundException("Anggota kampanye tidak ditemukan");
    return row;
  }

  async removeMember(tx: Db, campaignId: string, memberId: string) {
    await this.member(tx, campaignId, memberId);
    await tx.delete(M).where(eq(M.id, memberId));
  }

  async setMemberStatus(
    tx: Db,
    campaignId: string,
    memberId: string,
    status: "targeted" | "sent" | "responded",
  ) {
    await this.member(tx, campaignId, memberId);
    const [row] = await tx
      .update(M)
      .set({ status, respondedAt: status === "responded" ? new Date() : null })
      .where(eq(M.id, memberId))
      .returning();
    return row!;
  }

  // ---- Email massal ----

  private unsubscribeToken(tenantId: string, memberId: string) {
    const sig = createHmac("sha256", Buffer.from(this.config.jwtSecret))
      .update(`crm-unsubscribe:${tenantId}:${memberId}`)
      .digest("base64url")
      .slice(0, 32);
    return `${tenantId}.${memberId}.${sig}`;
  }

  /** Urai & verifikasi token berhenti langganan; `null` bila tidak sah. */
  parseUnsubscribeToken(token: string) {
    const [tenantId, memberId, sig] = token.split(".");
    if (!tenantId || !memberId || !sig || !UUID.test(tenantId) || !UUID.test(memberId)) return null;
    const expected = this.unsubscribeToken(tenantId, memberId).split(".")[2]!;
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
    return { tenantId, memberId };
  }

  /**
   * Kirim email ke anggota kampanye. Dilewati: tanpa email, bertanda "jangan dihubungi", atau sudah berhenti
   * langganan. Placeholder: `{{name}}`, `{{company}}`, `{{campaign}}`, `{{unsubscribe}}` (ditambahkan otomatis di
   * akhir bila tidak dipakai).
   */
  async sendEmail(tx: Db, id: string, input: z.infer<typeof campaignEmailSchema>) {
    const ctx = currentContext();
    const detail = await this.detail(tx, id);
    const targets = detail.memberList.filter(
      (m) => m.status !== "unsubscribed" && (!input.onlyStatus || m.status === input.onlyStatus),
    );
    if (targets.length > MAX_RECIPIENTS)
      throw new BadRequestException(
        `Maksimal ${MAX_RECIPIENTS} penerima per pengiriman; persempit dengan status`,
      );
    if (!targets.length) throw new BadRequestException("Tidak ada anggota kampanye untuk dikirimi");
    const body = input.body.includes("{{unsubscribe}}")
      ? input.body
      : `${input.body}\n\n—\nBerhenti menerima email ini: {{unsubscribe}}`;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const m of targets) {
      if (!m.email || m.doNotContact) {
        skipped++;
        continue;
      }
      const extra = {
        name: m.name ?? "",
        company: m.company ?? "",
        campaign: detail.name,
        unsubscribe: `${this.config.apiOrigin}/public/crm/unsubscribe/${this.unsubscribeToken(ctx.tenantId, m.id)}`,
      };
      try {
        await this.mailer.send({
          to: m.email,
          subject: renderTemplate(input.subject, {}, extra),
          text: renderTemplate(body, {}, extra),
        });
        sent++;
        // Yang sudah merespons tetap "merespons".
        await tx
          .update(M)
          .set({ status: m.status === "responded" ? "responded" : "sent", sentAt: new Date(), error: null })
          .where(eq(M.id, m.id));
      } catch (e) {
        failed++;
        await tx
          .update(M)
          .set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
          .where(eq(M.id, m.id));
      }
    }
    const [blast] = await tx
      .insert(schema.crmEmailBlasts)
      .values({
        campaignId: id,
        subject: input.subject,
        body: input.body,
        sentCount: sent,
        failedCount: failed,
        skippedCount: skipped,
        sentBy: ctx.userId,
      })
      .returning();
    return blast!;
  }

  /** Publik (tanpa login): anggota berhenti langganan dan lead/kontaknya ditandai jangan dihubungi. */
  async unsubscribe(tx: Db, memberId: string) {
    const [member] = await tx.select().from(M).where(eq(M.id, memberId));
    if (!member) return false;
    await tx.update(M).set({ status: "unsubscribed" }).where(eq(M.id, memberId));
    if (member.leadId) await tx.update(L).set({ doNotContact: true }).where(eq(L.id, member.leadId));
    if (member.partnerId) await tx.update(P).set({ doNotContact: true }).where(eq(P.id, member.partnerId));
    return true;
  }

  // ---- Skor & penugasan ----

  /** Hitung ulang skor semua lead/peluang terbuka perusahaan aktif. */
  async recomputeScores(tx: Db) {
    const companyId = currentContext().companyId;
    const leads = await tx
      .select()
      .from(L)
      .where(and(eq(L.companyId, companyId), eq(L.state, "open")))
      .limit(50_000);
    let changed = 0;
    for (const lead of leads) {
      const score = await leadScore(tx, companyId, lead);
      if (score === lead.score) continue;
      await tx.update(L).set({ score }).where(eq(L.id, lead.id));
      changed++;
    }
    return { leads: leads.length, changed };
  }

  /** Terapkan aturan penugasan ke lead terbuka yang belum punya penanggung jawab. */
  async applyAssignment(tx: Db) {
    const companyId = currentContext().companyId;
    const leads = await tx
      .select()
      .from(L)
      .where(and(eq(L.companyId, companyId), eq(L.state, "open"), isNull(L.userId)))
      .orderBy(asc(L.createdAt))
      .limit(20_000);
    const load = await openLeadLoad(tx, companyId);
    let assigned = 0;
    for (const lead of leads) {
      const { userId, teamId } = await assignLead(tx, companyId, lead, load);
      if (!userId) continue;
      await tx
        .update(L)
        .set({ userId, teamId: lead.teamId ?? teamId, updatedAt: sql`now()` })
        .where(eq(L.id, lead.id));
      assigned++;
    }
    return { unassigned: leads.length, assigned };
  }

  // ---- Formulir web ----

  private async assertForm(tx: Db, values: Partial<z.infer<typeof webFormSchema>>) {
    if (values.campaignId)
      await this.campaign(tx, values.campaignId).catch(() => {
        throw fieldError("campaignId", "Kampanye tidak ditemukan");
      });
  }

  async forms(tx: Db) {
    const rows = await tx
      .select({ form: F, campaignName: C.name })
      .from(F)
      .leftJoin(C, eq(C.id, F.campaignId))
      .where(eq(F.companyId, currentContext().companyId))
      .orderBy(asc(F.name));
    return {
      items: rows.map(({ form: { keyHash: _k, ...form }, campaignName }) => ({ ...form, campaignName })),
    };
  }

  /** Buat formulir; kunci publik hanya dikembalikan sekali di sini (yang disimpan hash-nya). */
  async createForm(tx: Db, input: z.infer<typeof webFormSchema>) {
    const ctx = currentContext();
    const error = webFormError(input);
    if (error) throw fieldError(error[0], error[1]);
    await this.assertForm(tx, input);
    const { token, hash } = issueTenantToken(ctx.tenantId);
    const [row] = await tx
      .insert(F)
      .values({ ...input, companyId: ctx.companyId, keyHash: hash })
      .returning();
    const { keyHash: _k, ...form } = row!;
    return { ...form, key: token };
  }

  private async form(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(F)
      .where(and(eq(F.id, id), eq(F.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Formulir tidak ditemukan");
    return row;
  }

  async updateForm(tx: Db, id: string, values: Partial<z.infer<typeof webFormSchema>>) {
    const before = await this.form(tx, id);
    const error = webFormError({
      fields: values.fields ?? before.fields,
      requiredFields: values.requiredFields ?? before.requiredFields,
    });
    if (error) throw fieldError(error[0], error[1]);
    await this.assertForm(tx, values);
    const [row] = await tx
      .update(F)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(F.id, id))
      .returning();
    const { keyHash: _k, ...form } = row!;
    return form;
  }

  async removeForm(tx: Db, id: string) {
    await this.form(tx, id);
    await tx.delete(F).where(eq(F.id, id));
  }

  /** Ganti kunci: kunci lama langsung tidak berlaku. */
  async rotateKey(tx: Db, id: string) {
    await this.form(tx, id);
    const { token, hash } = issueTenantToken(currentContext().tenantId);
    await tx
      .update(F)
      .set({ keyHash: hash, updatedAt: sql`now()` })
      .where(eq(F.id, id));
    return { id, key: token };
  }

  /** Tenant & hash dari kunci formulir publik. */
  parseKey(key: string) {
    const parsed = parseTenantToken(key);
    if (!parsed) throw new NotFoundException("Formulir tidak ditemukan");
    return parsed;
  }

  private async publicForm(tx: Db, keyHash: string) {
    const [form] = await tx
      .select()
      .from(F)
      .where(and(eq(F.keyHash, keyHash), eq(F.active, true)));
    if (!form) throw new NotFoundException("Formulir tidak ditemukan");
    return form;
  }

  /** Konfigurasi yang boleh dilihat publik (untuk merender formulir). */
  async publicConfig(tx: Db, keyHash: string) {
    const form = await this.publicForm(tx, keyHash);
    const [company] = await tx
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, form.companyId));
    return {
      name: form.name,
      company: company?.name ?? "",
      fields: WEB_FORM_FIELDS.filter((f) => form.fields.includes(f)),
      requiredFields: form.requiredFields,
      successMessage: form.successMessage,
    };
  }

  /**
   * Kiriman formulir publik → lead baru (sumber, kampanye, wilayah, skor, penugasan otomatis). Kiriman dengan email
   * yang sama dengan lead terbuka tidak membuat lead baru, hanya dicatat pada lead itu.
   */
  async submit(tx: Db, keyHash: string, body: unknown) {
    const form = await this.publicForm(tx, keyHash);
    const input = parse(webFormSubmissionSchema, body ?? {});
    const done = { ok: true, message: form.successMessage, redirectUrl: form.redirectUrl };
    // Honeypot terisi = bot: jawab sukses tanpa menyimpan apa pun.
    if (input.website_url) return done;

    const data = Object.fromEntries(
      WEB_FORM_FIELDS.map((f) => [f, form.fields.includes(f) ? (input[f] ?? null) : null]),
    ) as Record<(typeof WEB_FORM_FIELDS)[number], string | null>;
    const missing = form.requiredFields.filter((f) => !data[f as keyof typeof data]);
    if (missing.length)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: missing.map((path) => ({ path, message: "Wajib diisi" })),
      });
    if (!data.email && !data.phone)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: [{ path: "email", message: "Isi email atau telepon" }],
      });

    await tx
      .update(F)
      .set({ submissionCount: sql`${F.submissionCount} + 1`, lastSubmittedAt: new Date() })
      .where(eq(F.id, form.id));
    const note = `Kiriman formulir web "${form.name}"`;
    const [existing] = data.email
      ? await tx
          .select({ id: L.id })
          .from(L)
          .where(
            and(
              eq(L.companyId, form.companyId),
              eq(L.state, "open"),
              sql`lower(${L.email}) = ${data.email.toLowerCase()}`,
            ),
          )
          .orderBy(desc(L.createdAt))
          .limit(1)
      : [];
    let leadId = existing?.id;
    if (leadId) {
      await tx.insert(schema.activityLogs).values({
        resModel: "crm_lead",
        resId: leadId,
        action: "update",
        message: `${note} (lagi)${data.description ? `: ${data.description.slice(0, 500)}` : ""}`,
      });
    } else {
      const territory = await resolveTerritory(tx, form.companyId, data);
      const draft = {
        ...data,
        leadType: "lead" as const,
        leadStatus: "new" as const,
        source: form.source,
        name: `${form.name}: ${data.partnerName ?? data.contactName ?? data.email ?? data.phone}`.slice(
          0,
          200,
        ),
        territoryId: territory?.id ?? null,
      };
      const { userId, teamId } = await assignLead(
        tx,
        form.companyId,
        draft,
        await openLeadLoad(tx, form.companyId),
      );
      const [lead] = await tx
        .insert(L)
        .values({
          ...draft,
          companyId: form.companyId,
          campaignId: form.campaignId,
          userId,
          teamId,
          score: await leadScore(tx, form.companyId, draft),
        })
        .returning({ id: L.id });
      leadId = lead!.id;
      await tx
        .insert(schema.activityLogs)
        .values({ resModel: "crm_lead", resId: leadId, action: "create", message: note });
    }
    if (form.campaignId) {
      const [member] = await tx
        .insert(M)
        .values({ campaignId: form.campaignId, leadId, status: "responded", respondedAt: new Date() })
        .onConflictDoNothing()
        .returning({ id: M.id });
      if (!member)
        await tx
          .update(M)
          .set({ status: "responded", respondedAt: new Date() })
          .where(and(eq(M.campaignId, form.campaignId), eq(M.leadId, leadId), ne(M.status, "unsubscribed")));
    }
    return done;
  }
}
