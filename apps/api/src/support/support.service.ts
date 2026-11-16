import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  schema,
  sql,
  type Db,
  type SQL,
} from "@erp/db";
import {
  DEFAULT_SLA_HOURS,
  LIST_LOAD_LIMIT,
  nextAssignee,
  parseEmailAddress,
  slaDueDates,
  slaState,
  ticketNumberFromSubject,
  ticketStats,
  type inboundEmailSchema,
  type portalTicketSchema,
  type supportSettingsSchema,
  type ticketMessageSchema,
  type ticketSchema,
  type TicketPriority,
} from "@erp/shared";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertPartner, fieldError } from "../accounting/context.js";
import { issueTenantToken } from "../common/crypto.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import { assertCompanyUser } from "../crm/checks.js";
import { SequenceService } from "../sequences/sequence.service.js";

const T = schema.supportTickets;
const TM = schema.supportTicketMessages;
const Q = schema.supportTeams;
const SP = schema.supportSlaPolicies;
const ST = schema.supportSettings;
type Ticket = typeof T.$inferSelect;
export type TicketInput = z.infer<typeof ticketSchema>;
const OPEN_STATUSES = ["new", "open", "pending"] as const;

/** Notifikasi langsung (dipakai juga oleh job tanpa konteks request). */
async function notifyUsers(
  tx: Db,
  companyId: string,
  userIds: (string | null | undefined)[],
  input: { title: string; body?: string | null; link: string },
  except?: string,
) {
  const targets = [...new Set(userIds.filter((u): u is string => !!u))].filter((u) => u !== except);
  if (!targets.length) return;
  await tx.insert(schema.notifications).values(
    targets.map((userId) => ({
      companyId,
      userId,
      kind: "support",
      title: input.title.slice(0, 300),
      body: input.body?.slice(0, 2000) ?? null,
      link: input.link,
    })),
  );
}

export interface TicketQuery {
  q?: string;
  status?: string;
  userId?: string;
  teamId?: string;
  partnerId?: string;
}

@Injectable()
export class SupportService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(Mailer) private readonly mailer: Mailer,
  ) {}

  // ---- Bantuan ----

  async settings(tx: Db, companyId: string) {
    const [row] = await tx.select().from(ST).where(eq(ST.companyId, companyId));
    return row ?? null;
  }

  /** Kebijakan SLA yang berlaku: khusus tim lebih dulu, lalu umum; tanpa kebijakan pakai target bawaan. */
  private async policy(tx: Db, companyId: string, priority: TicketPriority, teamId: string | null) {
    const rows = await tx
      .select()
      .from(SP)
      .where(and(eq(SP.companyId, companyId), eq(SP.priority, priority), eq(SP.active, true)));
    const policy = rows.find((r) => teamId && r.teamId === teamId) ?? rows.find((r) => !r.teamId) ?? null;
    const [first, resolution] = DEFAULT_SLA_HOURS[priority];
    return {
      id: policy?.id ?? null,
      firstResponseHours: policy?.firstResponseHours ?? first,
      resolutionHours: policy?.resolutionHours ?? resolution,
    };
  }

  /** Agen antrean dengan beban tiket terbuka paling sedikit. */
  private async pickAgent(tx: Db, teamId: string | null) {
    if (!teamId) return null;
    const [team] = await tx.select().from(Q).where(eq(Q.id, teamId));
    if (!team?.autoAssign || !team.memberIds.length) return null;
    const rows = await tx
      .select({ userId: T.userId, count: sql<number>`count(*)::int` })
      .from(T)
      .where(and(inArray(T.userId, team.memberIds), inArray(T.status, [...OPEN_STATUSES])))
      .groupBy(T.userId);
    const load: Record<string, number> = {};
    for (const r of rows) if (r.userId) load[r.userId] = r.count;
    return nextAssignee(team.memberIds, load);
  }

  private async assertRefs(tx: Db, companyId: string, input: Partial<TicketInput>) {
    if (input.partnerId) await assertPartner(tx, companyId, input.partnerId);
    if (input.contactId) await assertPartner(tx, companyId, input.contactId, "contactId");
    if (input.userId) await assertCompanyUser(tx, input.userId);
    if (input.teamId) {
      const [team] = await tx.select({ companyId: Q.companyId }).from(Q).where(eq(Q.id, input.teamId));
      if (!team || team.companyId !== companyId) throw fieldError("teamId", "Antrean tidak ditemukan");
    }
    if (input.leadId) {
      const [lead] = await tx
        .select({ companyId: schema.crmLeads.companyId })
        .from(schema.crmLeads)
        .where(eq(schema.crmLeads.id, input.leadId));
      if (!lead || lead.companyId !== companyId) throw fieldError("leadId", "Peluang tidak ditemukan");
    }
  }

  // ---- Tiket ----

  /**
   * Buat tiket: nomor urut, antrean bawaan, penanggung jawab bergiliran, tenggat SLA dari prioritas. Dipakai juga
   * oleh portal dan email masuk (tanpa konteks user internal).
   */
  async create(
    tx: Db,
    input: Partial<TicketInput> & { subject: string },
    opts: { companyId: string; createdBy?: string | null; skipChecks?: boolean },
  ) {
    if (!opts.skipChecks) await this.assertRefs(tx, opts.companyId, input);
    const settings = await this.settings(tx, opts.companyId);
    const teamId = input.teamId ?? settings?.defaultTeamId ?? null;
    const priority = input.priority ?? "normal";
    const policy = await this.policy(tx, opts.companyId, priority, teamId);
    const now = new Date();
    const due = slaDueDates(now, policy);
    // Lengkapi kontak dari akun bila belum diisi.
    let { email, phone, contactName } = input;
    if (input.contactId || input.partnerId) {
      const [p] = await tx
        .select()
        .from(schema.partners)
        .where(eq(schema.partners.id, (input.contactId ?? input.partnerId)!));
      email ??= p?.email ?? null;
      phone ??= p?.phone ?? null;
      if (input.contactId) contactName ??= p?.name ?? null;
    }
    const userId = input.userId ?? (await this.pickAgent(tx, teamId));
    const number = await this.sequences.next(tx, "support.ticket", opts.companyId, now, "TKT");
    const [ticket] = await tx
      .insert(T)
      .values({
        companyId: opts.companyId,
        createdAt: now,
        number,
        subject: input.subject,
        description: input.description ?? null,
        partnerId: input.partnerId ?? null,
        contactId: input.contactId ?? null,
        contactName: contactName ?? null,
        email: email ?? null,
        phone: phone ?? null,
        channel: input.channel ?? "phone",
        category: input.category ?? null,
        priority,
        status: input.status && input.status !== "new" ? input.status : userId ? "open" : "new",
        teamId,
        userId,
        leadId: input.leadId ?? null,
        slaPolicyId: policy.id,
        firstResponseDue: due.firstResponseDue,
        resolveDue: due.resolveDue,
        createdBy: opts.createdBy ?? null,
      })
      .returning();
    await tx.insert(schema.activityLogs).values({
      resModel: "support_ticket",
      resId: ticket!.id,
      action: "create",
      userId: opts.createdBy ?? null,
      message: `Tiket dibuat lewat ${ticket!.channel}`,
    });
    if (userId)
      await notifyUsers(
        tx,
        opts.companyId,
        [userId],
        {
          title: `Tiket ${number}: ${ticket!.subject}`,
          body: "Ditugaskan kepada Anda",
          link: `/support/tickets/${ticket!.id}`,
        },
        opts.createdBy ?? undefined,
      );
    return ticket!;
  }

  private async find(tx: Db, id: string) {
    const [ticket] = await tx
      .select()
      .from(T)
      .where(and(eq(T.id, id), eq(T.companyId, currentContext().companyId)));
    if (!ticket) throw new NotFoundException("Tiket tidak ditemukan");
    return ticket;
  }

  private withSla(t: Ticket, now = new Date()) {
    return {
      ...t,
      firstResponseState: slaState(t.createdAt, t.firstResponseDue, t.firstRespondedAt, now),
      resolutionState: slaState(t.createdAt, t.resolveDue, t.resolvedAt ?? t.closedAt, now),
    };
  }

  async list(tx: Db, query: TicketQuery) {
    const ctx = currentContext();
    const filters: (SQL | undefined)[] = [eq(T.companyId, ctx.companyId)];
    if (query.q) {
      const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(
        or(ilike(T.subject, term), ilike(T.number, term), ilike(T.email, term), ilike(T.contactName, term)),
      );
    }
    const statuses = (query.status ?? "")
      .split(",")
      .filter((s): s is Ticket["status"] => ["new", "open", "pending", "resolved", "closed"].includes(s));
    if (statuses.length) filters.push(inArray(T.status, statuses));
    if (query.userId === "me") filters.push(eq(T.userId, ctx.userId));
    else if (query.userId === "none") filters.push(isNull(T.userId));
    else if (query.userId) filters.push(eq(T.userId, query.userId));
    if (query.teamId) filters.push(eq(T.teamId, query.teamId));
    if (query.partnerId) filters.push(or(eq(T.partnerId, query.partnerId), eq(T.contactId, query.partnerId)));
    const rows = await tx
      .select({ t: T, partnerName: schema.partners.name, userName: schema.users.name, teamName: Q.name })
      .from(T)
      .leftJoin(schema.partners, eq(schema.partners.id, T.partnerId))
      .leftJoin(schema.users, eq(schema.users.id, T.userId))
      .leftJoin(Q, eq(Q.id, T.teamId))
      .where(and(...filters))
      .orderBy(desc(T.createdAt))
      .limit(LIST_LOAD_LIMIT);
    const now = new Date();
    return {
      items: rows.map((r) => ({
        ...this.withSla(r.t, now),
        partnerName: r.partnerName,
        userName: r.userName,
        teamName: r.teamName,
      })),
      total: rows.length,
    };
  }

  async get(tx: Db, id: string) {
    const ticket = await this.find(tx, id);
    const messages = await tx
      .select({ m: TM, userName: schema.users.name })
      .from(TM)
      .leftJoin(schema.users, eq(schema.users.id, TM.authorUserId))
      .where(eq(TM.ticketId, id))
      .orderBy(asc(TM.createdAt));
    const names = await tx
      .select({ id: schema.partners.id, name: schema.partners.name })
      .from(schema.partners)
      .where(
        inArray(
          schema.partners.id,
          [ticket.partnerId, ticket.contactId]
            .filter((x): x is string => !!x)
            .concat(["00000000-0000-0000-0000-000000000000"]),
        ),
      );
    const [lead] = ticket.leadId
      ? await tx
          .select({ name: schema.crmLeads.name })
          .from(schema.crmLeads)
          .where(eq(schema.crmLeads.id, ticket.leadId))
      : [];
    return {
      ...this.withSla(ticket),
      partnerName: names.find((n) => n.id === ticket.partnerId)?.name ?? null,
      contactDisplay: names.find((n) => n.id === ticket.contactId)?.name ?? ticket.contactName,
      leadName: lead?.name ?? null,
      messages: messages.map((r) => ({ ...r.m, authorName: r.userName ?? r.m.authorName })),
    };
  }

  /** Ubah tiket; prioritas/antrean berubah = tenggat SLA dihitung ulang dari waktu tiket dibuat. */
  async update(tx: Db, id: string, sent: Partial<TicketInput>) {
    const ctx = currentContext();
    const before = await this.find(tx, id);
    await this.assertRefs(tx, before.companyId, sent);
    const values: Partial<typeof T.$inferInsert> = { ...sent };
    if (sent.priority !== undefined || sent.teamId !== undefined) {
      const policy = await this.policy(
        tx,
        before.companyId,
        sent.priority ?? before.priority,
        sent.teamId === undefined ? before.teamId : sent.teamId,
      );
      const due = slaDueDates(before.createdAt, policy);
      values.slaPolicyId = policy.id;
      if (!before.firstRespondedAt) values.firstResponseDue = due.firstResponseDue;
      if (!before.resolvedAt) values.resolveDue = due.resolveDue;
    }
    Object.assign(values, this.statusChange(before, sent.status));
    if (sent.status === "new" && (sent.userId ?? before.userId)) values.status = "open";
    const [row] = await tx
      .update(T)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(T.id, id))
      .returning();
    const changes = Object.fromEntries(
      Object.entries(sent)
        .filter(([k, v]) => String(before[k as keyof Ticket] ?? "") !== String(v ?? ""))
        .map(([k, v]) => [k, { from: before[k as keyof Ticket], to: v }]),
    );
    if (Object.keys(changes).length)
      await this.activity.log(tx, { resModel: "support_ticket", resId: id, action: "update", changes });
    if (sent.userId && sent.userId !== before.userId)
      await notifyUsers(
        tx,
        row!.companyId,
        [sent.userId],
        {
          title: `Tiket ${row!.number}: ${row!.subject}`,
          body: "Ditugaskan kepada Anda",
          link: `/support/tickets/${id}`,
        },
        ctx.userId,
      );
    return this.get(tx, id);
  }

  /** Cap waktu saat status berubah: selesai, ditutup, atau dibuka kembali. */
  private statusChange(before: Ticket, status: Ticket["status"] | null | undefined) {
    if (!status || status === before.status) return {};
    const now = new Date();
    if (status === "resolved") return { status, resolvedAt: now, closedAt: null };
    if (status === "closed") return { status, closedAt: now, resolvedAt: before.resolvedAt ?? now };
    return { status, resolvedAt: null, closedAt: null };
  }

  /**
   * Balasan agen ke pelanggan (dikirim ke email tiket) atau catatan internal. Balasan pertama mencatat respons
   * pertama SLA; tanpa status eksplisit, balasan publik menjadikan tiket "menunggu pelanggan".
   */
  async addMessage(tx: Db, id: string, input: z.infer<typeof ticketMessageSchema>) {
    const ctx = currentContext();
    const ticket = await this.find(tx, id);
    const [user] = await tx
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.userId));
    await tx.insert(TM).values({
      ticketId: id,
      kind: input.kind,
      body: input.body,
      authorUserId: ctx.userId,
      authorName: user?.name ?? null,
    });
    const values: Partial<typeof T.$inferInsert> = {};
    if (input.kind === "public") {
      if (!ticket.firstRespondedAt) values.firstRespondedAt = new Date();
      if (!ticket.userId) values.userId = ctx.userId;
    }
    const status =
      input.status ??
      (input.kind === "public" && (ticket.status === "new" || ticket.status === "open")
        ? "pending"
        : undefined);
    Object.assign(values, this.statusChange(ticket, status));
    if (Object.keys(values).length)
      await tx
        .update(T)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(T.id, id));
    let emailed = false;
    if (input.kind === "public" && ticket.email) {
      await this.mailer.send({
        to: ticket.email,
        subject: `[${ticket.number}] ${ticket.subject}`,
        text: `${input.body}\n\n—\n${user?.name ?? ""}\nBalas email ini untuk menanggapi tiket ${ticket.number}.`,
      });
      emailed = true;
    }
    return { ...(await this.get(tx, id)), emailed };
  }

  /**
   * Pesan dari pelanggan (portal / email masuk): tiket "menunggu" atau "selesai" dibuka kembali, penanggung jawab
   * diberi notifikasi.
   */
  private async customerMessage(tx: Db, ticket: Ticket, body: string, authorName: string | null) {
    await tx.insert(TM).values({ ticketId: ticket.id, kind: "customer", body, authorName });
    if (ticket.status === "pending" || ticket.status === "resolved")
      await tx
        .update(T)
        .set({ status: "open", resolvedAt: null, updatedAt: sql`now()` })
        .where(eq(T.id, ticket.id));
    await notifyUsers(tx, ticket.companyId, [ticket.userId], {
      title: `Balasan pelanggan pada tiket ${ticket.number}`,
      body: body.slice(0, 300),
      link: `/support/tickets/${ticket.id}`,
    });
  }

  // ---- Portal pelanggan ----

  async portalPartnerIds(tx: Db, partnerId: string) {
    const rows = await tx
      .select({ id: schema.partners.id })
      .from(schema.partners)
      .where(or(eq(schema.partners.id, partnerId), eq(schema.partners.parentId, partnerId)));
    return rows.map((r) => r.id);
  }

  async portalList(tx: Db, partnerId: string) {
    const ids = await this.portalPartnerIds(tx, partnerId);
    const rows = await tx
      .select({
        id: T.id,
        number: T.number,
        subject: T.subject,
        status: T.status,
        priority: T.priority,
        createdAt: T.createdAt,
        updatedAt: T.updatedAt,
        companyName: schema.companies.name,
      })
      .from(T)
      .innerJoin(schema.companies, eq(schema.companies.id, T.companyId))
      .where(or(inArray(T.partnerId, ids), inArray(T.contactId, ids)))
      .orderBy(desc(T.createdAt))
      .limit(500);
    return rows;
  }

  private async portalFind(tx: Db, partnerId: string, id: string) {
    const ids = await this.portalPartnerIds(tx, partnerId);
    const [ticket] = await tx
      .select()
      .from(T)
      .where(and(eq(T.id, id), or(inArray(T.partnerId, ids), inArray(T.contactId, ids))));
    if (!ticket) throw new NotFoundException("Tiket tidak ditemukan");
    return ticket;
  }

  /** Detail untuk pelanggan: tanpa catatan internal dan tanpa data agen selain nama. */
  async portalGet(tx: Db, partnerId: string, id: string) {
    const t = await this.portalFind(tx, partnerId, id);
    const messages = await tx
      .select({ kind: TM.kind, body: TM.body, authorName: TM.authorName, createdAt: TM.createdAt })
      .from(TM)
      .where(and(eq(TM.ticketId, id), inArray(TM.kind, ["public", "customer"])))
      .orderBy(asc(TM.createdAt));
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      satisfaction: t.satisfaction,
      satisfactionNote: t.satisfactionNote,
      messages,
    };
  }

  /** Perusahaan penerima tiket portal: perusahaan pemilik akun, perusahaan pesanan terakhirnya, atau yang pertama. */
  private async portalCompany(tx: Db, partnerId: string) {
    const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, partnerId));
    if (partner?.companyId) return partner.companyId;
    const ids = await this.portalPartnerIds(tx, partnerId);
    const [order] = await tx
      .select({ companyId: schema.saleOrders.companyId })
      .from(schema.saleOrders)
      .where(inArray(schema.saleOrders.partnerId, ids))
      .orderBy(desc(schema.saleOrders.createdAt))
      .limit(1);
    if (order) return order.companyId;
    const [company] = await tx
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .orderBy(asc(schema.companies.createdAt))
      .limit(1);
    if (!company) throw new BadRequestException("Perusahaan tidak ditemukan");
    return company.id;
  }

  async portalCreate(
    tx: Db,
    p: { partnerId: string; name: string; email: string },
    input: z.infer<typeof portalTicketSchema>,
  ) {
    const companyId = await this.portalCompany(tx, p.partnerId);
    const ticket = await this.create(
      tx,
      {
        ...input,
        channel: "portal",
        partnerId: p.partnerId,
        contactName: p.name,
        email: p.email,
      },
      { companyId, skipChecks: true },
    );
    return this.portalGet(tx, p.partnerId, ticket.id);
  }

  async portalReply(tx: Db, p: { partnerId: string; name: string }, id: string, body: string) {
    const ticket = await this.portalFind(tx, p.partnerId, id);
    if (ticket.status === "closed")
      throw new BadRequestException("Tiket sudah ditutup; buat tiket baru untuk masalah lain");
    await this.customerMessage(tx, ticket, body, p.name);
    return this.portalGet(tx, p.partnerId, id);
  }

  async portalRate(tx: Db, partnerId: string, id: string, satisfaction: number, note: string | null) {
    const ticket = await this.portalFind(tx, partnerId, id);
    if (ticket.status !== "resolved" && ticket.status !== "closed")
      throw new BadRequestException("Penilaian hanya untuk tiket yang sudah selesai");
    await tx
      .update(T)
      .set({ satisfaction, satisfactionNote: note, updatedAt: sql`now()` })
      .where(eq(T.id, id));
    return this.portalGet(tx, partnerId, id);
  }

  async portalArticles(tx: Db, partnerId: string, q?: string) {
    const companyId = await this.portalCompany(tx, partnerId);
    const term = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    return tx
      .select({
        id: schema.supportArticles.id,
        title: schema.supportArticles.title,
        category: schema.supportArticles.category,
        body: schema.supportArticles.body,
        publishedAt: schema.supportArticles.publishedAt,
      })
      .from(schema.supportArticles)
      .where(
        and(
          eq(schema.supportArticles.companyId, companyId),
          eq(schema.supportArticles.published, true),
          term
            ? or(ilike(schema.supportArticles.title, term), ilike(schema.supportArticles.body, term))
            : undefined,
        ),
      )
      .orderBy(asc(schema.supportArticles.category), asc(schema.supportArticles.title))
      .limit(500);
  }

  async portalArticleViewed(tx: Db, partnerId: string, id: string) {
    const companyId = await this.portalCompany(tx, partnerId);
    await tx
      .update(schema.supportArticles)
      .set({ views: sql`${schema.supportArticles.views} + 1` })
      .where(
        and(
          eq(schema.supportArticles.id, id),
          eq(schema.supportArticles.companyId, companyId),
          eq(schema.supportArticles.published, true),
        ),
      );
  }

  // ---- Email masuk ----

  /**
   * Email masuk (diteruskan layanan email ke webhook): subjek memuat nomor tiket → balasan pada tiket itu (bila
   * pengirimnya cocok); selain itu tiket baru. Pengirim dicocokkan ke kontak/akun lewat email.
   */
  async inbound(tx: Db, companyId: string, input: z.infer<typeof inboundEmailSchema>) {
    const { email, name } = parseEmailAddress(input.from);
    if (!email) throw fieldError("from", "Alamat pengirim tidak valid");
    const body = input.text.trim() || "(tanpa isi)";
    const number = ticketNumberFromSubject(input.subject);
    if (number) {
      const [ticket] = await tx
        .select()
        .from(T)
        .where(and(eq(T.companyId, companyId), eq(T.number, number)));
      if (ticket && ticket.status !== "closed" && ticket.email?.toLowerCase() === email) {
        await this.customerMessage(tx, ticket, body, name ?? email);
        return { ticketId: ticket.id, number: ticket.number, created: false };
      }
    }
    const [contact] = await tx
      .select()
      .from(schema.partners)
      .where(
        and(
          sql`lower(${schema.partners.email}) = ${email}`,
          or(isNull(schema.partners.companyId), eq(schema.partners.companyId, companyId)),
        ),
      )
      .orderBy(asc(schema.partners.createdAt))
      .limit(1);
    const isPerson = contact?.kind === "person";
    const ticket = await this.create(
      tx,
      {
        subject: (input.subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "") || "(tanpa subjek)").slice(0, 200),
        description: body,
        channel: "email",
        email,
        contactName: name ?? (isPerson ? contact!.name : null),
        partnerId: contact ? ((isPerson ? contact.parentId : null) ?? contact.id) : null,
        contactId: isPerson ? contact!.id : null,
      },
      { companyId, skipChecks: true },
    );
    return { ticketId: ticket.id, number: ticket.number, created: true };
  }

  // ---- Pengaturan ----

  async getSettings(tx: Db) {
    const companyId = currentContext().companyId;
    const row = await this.settings(tx, companyId);
    return {
      defaultTeamId: row?.defaultTeamId ?? null,
      autoCloseDays: row?.autoCloseDays ?? 7,
      inboundConfigured: Boolean(row?.inboundKeyHash),
    };
  }

  async saveSettings(tx: Db, input: z.infer<typeof supportSettingsSchema>) {
    const companyId = currentContext().companyId;
    if (input.defaultTeamId) await this.assertRefs(tx, companyId, { teamId: input.defaultTeamId });
    await tx
      .insert(ST)
      .values({ companyId, defaultTeamId: input.defaultTeamId ?? null, autoCloseDays: input.autoCloseDays })
      .onConflictDoUpdate({
        target: ST.companyId,
        set: {
          defaultTeamId: input.defaultTeamId ?? null,
          autoCloseDays: input.autoCloseDays,
          updatedAt: sql`now()`,
        },
      });
    return this.getSettings(tx);
  }

  /** Kunci webhook email masuk baru (ditampilkan sekali); kunci lama tidak berlaku. */
  async rotateInboundKey(tx: Db) {
    const ctx = currentContext();
    const { token, hash } = issueTenantToken(ctx.tenantId);
    await tx
      .insert(ST)
      .values({ companyId: ctx.companyId, inboundKeyHash: hash })
      .onConflictDoUpdate({ target: ST.companyId, set: { inboundKeyHash: hash, updatedAt: sql`now()` } });
    return { key: token };
  }

  async companyForInboundKey(tx: Db, keyHash: string) {
    const [row] = await tx.select({ companyId: ST.companyId }).from(ST).where(eq(ST.inboundKeyHash, keyHash));
    if (!row) throw new NotFoundException("Kunci email masuk tidak dikenal");
    return row.companyId;
  }

  // ---- Laporan ----

  async report(tx: Db, from?: string, to?: string) {
    const companyId = currentContext().companyId;
    const rows = await tx
      .select({ t: T, userName: schema.users.name, teamName: Q.name })
      .from(T)
      .leftJoin(schema.users, eq(schema.users.id, T.userId))
      .leftJoin(Q, eq(Q.id, T.teamId))
      .where(
        and(
          eq(T.companyId, companyId),
          from ? gte(T.createdAt, new Date(`${from}T00:00:00Z`)) : undefined,
          to ? lt(T.createdAt, new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000)) : undefined,
        ),
      )
      .limit(50_000);
    const count = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
      const out: Record<string, number> = {};
      for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
      return out;
    };
    const groupStats = (
      key: (r: (typeof rows)[number]) => string | null,
      label: (r: (typeof rows)[number]) => string | null,
    ) => {
      const map = new Map<string | null, { key: string | null; label: string | null; list: typeof rows }>();
      for (const r of rows) {
        const k = key(r);
        if (!map.has(k)) map.set(k, { key: k, label: label(r), list: [] });
        map.get(k)!.list.push(r);
      }
      return [...map.values()]
        .map((g) => ({
          key: g.key,
          label: g.label,
          open: g.list.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.t.status)).length,
          ...ticketStats(g.list.map((r) => r.t)),
        }))
        .sort((a, b) => b.total - a.total);
    };
    const now = new Date();
    return {
      summary: {
        ...ticketStats(rows.map((r) => r.t)),
        open: rows.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.t.status)).length,
        breachedOpen: rows.filter(
          (r) =>
            (OPEN_STATUSES as readonly string[]).includes(r.t.status) &&
            (slaState(r.t.createdAt, r.t.firstResponseDue, r.t.firstRespondedAt, now) === "breached" ||
              slaState(r.t.createdAt, r.t.resolveDue, r.t.resolvedAt, now) === "breached"),
        ).length,
      },
      byStatus: count((r) => r.t.status),
      byPriority: count((r) => r.t.priority),
      byChannel: count((r) => r.t.channel),
      byAgent: groupStats(
        (r) => r.t.userId,
        (r) => r.userName,
      ),
      byTeam: groupStats(
        (r) => r.t.teamId,
        (r) => r.teamName,
      ),
      byCategory: groupStats(
        (r) => r.t.category,
        (r) => r.t.category,
      ),
    };
  }

  // ---- Job ----

  /**
   * Tandai pelanggaran SLA tiket terbuka dan eskalasikan: notifikasi ke penanggung jawab, pemimpin antrean, dan
   * (bila belum ditugaskan) seluruh agen antrean. Tiket "selesai" yang tidak dibalas pelanggan ditutup otomatis.
   */
  async checkSla(tx: Db, now = new Date()) {
    const open = await tx
      .select({ t: T, leaderId: Q.leaderId, memberIds: Q.memberIds })
      .from(T)
      .leftJoin(Q, eq(Q.id, T.teamId))
      .where(
        and(
          inArray(T.status, [...OPEN_STATUSES]),
          or(
            and(eq(T.firstResponseBreached, false), isNull(T.firstRespondedAt), lte(T.firstResponseDue, now)),
            and(eq(T.resolutionBreached, false), lte(T.resolveDue, now)),
          ),
        ),
      );
    let escalated = 0;
    for (const { t, leaderId, memberIds } of open) {
      const first =
        !t.firstResponseBreached && !t.firstRespondedAt && t.firstResponseDue && t.firstResponseDue <= now;
      const resolution = !t.resolutionBreached && t.resolveDue && t.resolveDue <= now;
      await tx
        .update(T)
        .set({
          firstResponseBreached: t.firstResponseBreached || Boolean(first),
          resolutionBreached: t.resolutionBreached || Boolean(resolution),
          escalatedAt: now,
        })
        .where(eq(T.id, t.id));
      await notifyUsers(tx, t.companyId, [t.userId, leaderId, ...(t.userId ? [] : (memberIds ?? []))], {
        title: `SLA terlewati: tiket ${t.number}`,
        body: `${first ? "Belum ada respons pertama" : "Belum selesai"} — ${t.subject}`,
        link: `/support/tickets/${t.id}`,
      });
      escalated++;
    }
    // Tutup otomatis: tiket selesai yang tidak ditanggapi pelanggan selama N hari (bawaan 7, 0 = mati).
    const closedRows = await tx
      .update(T)
      .set({ status: "closed", closedAt: now, updatedAt: sql`now()` })
      .where(
        and(
          eq(T.status, "resolved"),
          sql`coalesce((select s.auto_close_days from support_settings s where s.company_id = ${T.companyId}), 7) > 0`,
          sql`${T.resolvedAt} <= ${now.toISOString()}::timestamptz - make_interval(days =>
            coalesce((select s.auto_close_days from support_settings s where s.company_id = ${T.companyId}), 7))`,
        ),
      )
      .returning({ id: T.id });
    const closed = closedRows.length;
    return { escalated, closed };
  }
}
