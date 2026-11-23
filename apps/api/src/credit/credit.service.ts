import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import {
  creditStatus,
  DEFAULT_DUNNING_LEVELS,
  dunningDue,
  renderDunningText,
  type DunningDue,
  type DunningLevelInput,
  type PartnerCreditInput,
  businessToday,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { Mailer } from "../common/mailer.js";
import { FxService } from "../master/fx.controller.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { renderDunningPdf } from "./dunning-pdf.js";

const L = schema.partnerCreditLimits;
const DL = schema.dunningLevels;
const LT = schema.dunningLetters;
const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const today = () => businessToday();
const fmtMoney = (code: string, v: Decimal.Value) =>
  `${code} ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(v))}`;
const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export type Letter = typeof LT.$inferSelect;

/** Batas kredit pelanggan (peringatan) dan penagihan bertingkat (dunning) per perusahaan. */
@Injectable()
export class CreditService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  // ---------- Batas kredit ----------

  async getLimit(tx: Db, companyId: string, partnerId: string) {
    await this.partner(tx, partnerId);
    const [row] = await tx
      .select()
      .from(L)
      .where(and(eq(L.companyId, companyId), eq(L.partnerId, partnerId)));
    return {
      partnerId,
      creditLimit: row?.creditLimit ?? null,
      overdueWarnDays: row?.overdueWarnDays ?? null,
      dunningExcluded: row?.dunningExcluded ?? false,
      note: row?.note ?? null,
    };
  }

  async saveLimit(tx: Db, companyId: string, partnerId: string, input: PartnerCreditInput) {
    await this.partner(tx, partnerId);
    const values = {
      creditLimit: input.creditLimit ?? null,
      overdueWarnDays: input.overdueWarnDays ?? null,
      dunningExcluded: input.dunningExcluded,
      note: input.note ?? null,
    };
    await tx
      .insert(L)
      .values({ companyId, partnerId, ...values })
      .onConflictDoUpdate({ target: [L.companyId, L.partnerId], set: { ...values, updatedAt: sql`now()` } });
    return this.status(tx, companyId, partnerId);
  }

  /**
   * Paparan kredit pelanggan di perusahaan: piutang terbuka (mata uang perusahaan), SO terkonfirmasi yang belum
   * ditagih, dan faktur draft; ditambah `orderAmount` (pesanan yang sedang diperiksa) bila diberikan.
   */
  async status(tx: Db, companyId: string, partnerId: string, extra?: { orderId?: string; date?: string }) {
    const limit = await this.getLimit(tx, companyId, partnerId);
    const date = extra?.date ?? today();
    const companyCurrency = await this.companyCurrency(tx, companyId);
    const [ar] = await tx.execute<{ receivable: string | null; oldest: string | null }>(sql`
      select sum(l.amount_residual) as receivable,
        min(case when l.amount_residual > 0 and coalesce(m.due_date, m.date) < ${date}::date
          then coalesce(m.due_date, m.date) end)::text as oldest
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where l.company_id = ${companyId} and l.partner_id = ${partnerId} and m.state = 'posted'
        and a.account_type = 'asset_receivable' and not l.reconciled and l.amount_residual <> 0`);
    const drafts = await tx.execute<{ currency_code: string; total: string }>(sql`
      select currency_code, sum(amount_total * currency_rate) as total from account_moves
      where company_id = ${companyId} and partner_id = ${partnerId} and state = 'draft'
        and move_type = 'out_invoice'
      group by currency_code`);
    // SO terkonfirmasi: sisa yang belum ditagih (faktur draft sudah dihitung di atas), termasuk pajak secara
    // proporsional terhadap total pesanan.
    const orders = await tx.execute<{ id: string; currency_code: string; remaining: string }>(sql`
      select o.id, o.currency_code,
        sum(greatest(l.quantity - coalesce((
          select sum(case when m.move_type = 'out_invoice' then aml.quantity else -aml.quantity end)
          from account_move_lines aml join account_moves m on m.id = aml.move_id
          where aml.sale_line_id = l.id and aml.display_type = 'product'), 0), 0)
          / nullif(l.quantity, 0) * l.price_subtotal)
          * (case when o.amount_untaxed = 0 then 1 else o.amount_total / o.amount_untaxed end) as remaining
      from sale_orders o join sale_order_lines l on l.order_id = o.id
      where o.company_id = ${companyId} and o.partner_id = ${partnerId} and o.state = 'sale'
      group by o.id`);
    let uninvoiced = dec(0);
    let orderAmount = dec(0);
    for (const o of orders) {
      const amount = await this.toCompany(tx, o.currency_code, companyCurrency, o.remaining, date);
      if (o.id === extra?.orderId) orderAmount = amount;
      else uninvoiced = uninvoiced.plus(amount);
    }
    // Pesanan yang diperiksa masih draft/terkirim: nilainya ditambahkan penuh.
    if (extra?.orderId && !orders.some((o) => o.id === extra.orderId)) {
      const [order] = await tx
        .select({ amountTotal: schema.saleOrders.amountTotal, currencyCode: schema.saleOrders.currencyCode })
        .from(schema.saleOrders)
        .where(eq(schema.saleOrders.id, extra.orderId));
      if (order)
        orderAmount = await this.toCompany(tx, order.currencyCode, companyCurrency, order.amountTotal, date);
    }
    const draftTotal = drafts.reduce((s, r) => s.plus(r.total), dec(0));
    const oldest = ar?.oldest ?? null;
    const oldestDays = oldest
      ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000)
      : 0;
    const status = creditStatus({
      limit: limit.creditLimit,
      receivable: dec(ar?.receivable).toFixed(2),
      uninvoicedOrders: uninvoiced.toFixed(2),
      draftInvoices: draftTotal.toFixed(2),
      orderAmount: orderAmount.toFixed(2),
      oldestOverdueDays: oldestDays,
      warnDays: limit.overdueWarnDays,
    });
    return {
      ...limit,
      currencyCode: companyCurrency,
      receivable: dec(ar?.receivable).toFixed(2),
      uninvoicedOrders: uninvoiced.toFixed(2),
      draftInvoices: draftTotal.toFixed(2),
      orderAmount: orderAmount.toFixed(2),
      ...status,
    };
  }

  /** Peringatan kredit untuk pesanan penjualan (dipakai form SO dan log konfirmasi). */
  async orderCheck(tx: Db, orderId: string) {
    const [order] = await tx
      .select({
        id: schema.saleOrders.id,
        companyId: schema.saleOrders.companyId,
        partnerId: schema.saleOrders.partnerId,
      })
      .from(schema.saleOrders)
      .where(eq(schema.saleOrders.id, orderId));
    if (!order) throw new NotFoundException("Pesanan tidak ditemukan");
    const status = await this.status(tx, order.companyId, order.partnerId, { orderId });
    return { ...status, warnings: creditWarnings(status) };
  }

  // ---------- Dunning: tingkat & pengaturan ----------

  /** Tingkat dunning perusahaan; tingkat bawaan dibuat otomatis bila belum ada. */
  async levels(tx: Db, companyId: string) {
    const rows = await tx.select().from(DL).where(eq(DL.companyId, companyId)).orderBy(asc(DL.sequence));
    if (rows.length) return rows;
    await tx
      .insert(DL)
      .values(DEFAULT_DUNNING_LEVELS.map((l) => ({ ...l, companyId })))
      .onConflictDoNothing();
    return tx.select().from(DL).where(eq(DL.companyId, companyId)).orderBy(asc(DL.sequence));
  }

  async saveLevel(tx: Db, companyId: string, id: string | null, input: DunningLevelInput) {
    await this.levels(tx, companyId);
    const clash = await tx
      .select({ id: DL.id })
      .from(DL)
      .where(and(eq(DL.companyId, companyId), eq(DL.sequence, input.sequence)));
    if (clash.some((c) => c.id !== id)) {
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: [{ path: "sequence", message: "Urutan tingkat sudah dipakai" }],
      });
    }
    if (id) {
      const [row] = await tx
        .update(DL)
        .set({ ...input, updatedAt: sql`now()` })
        .where(and(eq(DL.id, id), eq(DL.companyId, companyId)))
        .returning();
      if (!row) throw new NotFoundException("Tingkat dunning tidak ditemukan");
      return row;
    }
    const [row] = await tx
      .insert(DL)
      .values({ ...input, companyId })
      .returning();
    return row!;
  }

  async removeLevel(tx: Db, companyId: string, id: string) {
    const [row] = await tx
      .delete(DL)
      .where(and(eq(DL.id, id), eq(DL.companyId, companyId)))
      .returning({ id: DL.id });
    if (!row) throw new NotFoundException("Tingkat dunning tidak ditemukan");
  }

  async settings(tx: Db, companyId: string) {
    const [row] = await tx
      .select({
        dunningEnabled: schema.accountingSettings.dunningEnabled,
        dunningMinAmount: schema.accountingSettings.dunningMinAmount,
      })
      .from(schema.accountingSettings)
      .where(eq(schema.accountingSettings.companyId, companyId));
    if (!row) throw new BadRequestException("Akuntansi belum disiapkan untuk perusahaan ini");
    return row;
  }

  async saveSettings(
    tx: Db,
    companyId: string,
    input: { dunningEnabled: boolean; dunningMinAmount: string },
  ) {
    await this.settings(tx, companyId);
    await tx
      .update(schema.accountingSettings)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(schema.accountingSettings.companyId, companyId));
    return this.settings(tx, companyId);
  }

  // ---------- Dunning: pratinjau & kirim ----------

  /** Pelanggan yang perlu ditagih pada tanggal `date` beserta tingkat dan faktur tertunggaknya. */
  async preview(tx: Db, companyId: string, date = today()) {
    const levels = await this.levels(tx, companyId);
    const { dunningMinAmount } = await this.settings(tx, companyId);
    const rows = await tx.execute<{
      move_id: string;
      partner_id: string;
      name: string | null;
      date: string;
      due_date: string;
      amount_total: string;
      residual: string;
      dunning_level: number;
    }>(sql`
      select m.id as move_id, m.partner_id, m.name, m.date::text as date,
        coalesce(m.due_date, m.date)::text as due_date, (m.amount_total * m.currency_rate) as amount_total,
        sum(l.amount_residual) as residual, m.dunning_level
      from account_moves m
      join account_move_lines l on l.move_id = m.id
      join accounts a on a.id = l.account_id
      join partners p on p.id = m.partner_id
      left join partner_credit_limits c on c.company_id = m.company_id and c.partner_id = m.partner_id
      where m.company_id = ${companyId} and m.state = 'posted' and m.move_type = 'out_invoice'
        and a.account_type = 'asset_receivable' and not l.reconciled
        and coalesce(m.due_date, m.date) < ${date}::date
        and p.ic_company_id is null and not coalesce(c.dunning_excluded, false)
      group by m.id
      having sum(l.amount_residual) > 0`);
    const due = dunningDue(
      rows.map((r) => ({
        moveId: r.move_id,
        partnerId: r.partner_id,
        name: r.name ?? "",
        date: r.date,
        dueDate: r.due_date,
        amountTotal: r.amount_total,
        residual: r.residual,
        dunningLevel: Number(r.dunning_level),
      })),
      levels,
      date,
      dunningMinAmount,
    );
    const partners = due.length
      ? await tx
          .select({ id: schema.partners.id, name: schema.partners.name, email: schema.partners.email })
          .from(schema.partners)
          .where(
            inArray(
              schema.partners.id,
              due.map((d) => d.partnerId),
            ),
          )
      : [];
    const byId = new Map(partners.map((p) => [p.id, p]));
    return due
      .map((d) => ({
        ...d,
        partner: byId.get(d.partnerId)?.name ?? "—",
        email: byId.get(d.partnerId)?.email ?? null,
      }))
      .sort((a, b) => a.partner.localeCompare(b.partner));
  }

  /**
   * Kirim surat teguran ke pelanggan yang jatuh tempo (semua, atau `partnerIds`). Email gagal/tanpa alamat tetap
   * dicatat (status gagal) dan tingkat faktur tetap naik agar tidak dikirim berulang; surat bisa dicetak/dikirim ulang.
   */
  async send(
    tx: Db,
    companyId: string,
    opts: { date?: string; partnerIds?: string[]; userId: string | null },
  ) {
    const date = opts.date ?? today();
    let due = await this.preview(tx, companyId, date);
    if (opts.partnerIds) due = due.filter((d) => opts.partnerIds!.includes(d.partnerId));
    const levels = await this.levels(tx, companyId);
    const letters: Letter[] = [];
    for (const item of due)
      letters.push(await this.createLetter(tx, companyId, item, levels, date, opts.userId));
    return letters;
  }

  private async createLetter(
    tx: Db,
    companyId: string,
    item: DunningDue & { partner: string; email: string | null },
    levels: (typeof DL.$inferSelect)[],
    date: string,
    userId: string | null,
  ) {
    const level = levels.find((l) => l.sequence === item.level.sequence)!;
    const company = await this.company(tx, companyId);
    const vars = {
      pelanggan: item.partner,
      perusahaan: company.name,
      total: fmtMoney(company.currencyCode, item.totalOverdue),
      tanggal: fmtDate(date),
      tingkat: level.name,
      daftar_faktur: item.invoices
        .map(
          (i) =>
            `- ${i.name} (jatuh tempo ${fmtDate(i.dueDate)}, ${i.daysOverdue} hari): ${fmtMoney(company.currencyCode, i.residual)}`,
        )
        .join("\n"),
    };
    const name = await this.sequences.next(tx, "dunning", companyId, new Date(`${date}T00:00:00Z`), "DUN");
    const [letter] = await tx
      .insert(LT)
      .values({
        companyId,
        partnerId: item.partnerId,
        levelId: level.id,
        levelSequence: level.sequence,
        levelName: level.name,
        name,
        date,
        state: "failed",
        emailTo: item.email,
        currencyCode: company.currencyCode,
        totalOverdue: item.totalOverdue,
        invoices: item.invoices.map((i) => ({
          moveId: i.moveId,
          name: i.name,
          date: i.date,
          dueDate: i.dueDate,
          amountTotal: i.amountTotal,
          residual: i.residual,
          daysOverdue: i.daysOverdue,
        })),
        subject: renderDunningText(level.emailSubject, vars),
        body: renderDunningText(level.body, vars),
        sentBy: userId,
      })
      .returning();
    // Faktur naik ke tingkat yang dicapainya (tidak turun) agar tingkat yang sama tidak dikirim lagi.
    for (const inv of item.invoices) {
      if (inv.targetLevel <= inv.dunningLevel) continue;
      await tx
        .update(schema.accountMoves)
        .set({ dunningLevel: inv.targetLevel, lastDunningAt: sql`now()` })
        .where(eq(schema.accountMoves.id, inv.moveId));
    }
    return this.deliver(tx, letter!, level.attachPdf, userId);
  }

  /** Kirim (ulang) email surat; hasil dicatat di surat. */
  private async deliver(tx: Db, letter: Letter, attachPdf: boolean, userId: string | null) {
    let state: Letter["state"] = "sent";
    let error: string | null = null;
    if (!letter.emailTo) {
      state = "failed";
      error = "Email pelanggan kosong; cetak surat dan kirim manual";
    } else {
      try {
        const attachments = attachPdf
          ? [
              {
                filename: `${letter.name.replace(/[^\w.-]+/g, "_")}.pdf`,
                content: await this.pdf(tx, letter),
                contentType: "application/pdf",
              },
            ]
          : undefined;
        await this.mailer.send({
          to: letter.emailTo,
          subject: letter.subject,
          text: letter.body,
          attachments,
        });
      } catch (e) {
        state = "failed";
        error = e instanceof Error ? e.message.slice(0, 300) : "Gagal mengirim email";
      }
    }
    const [row] = await tx
      .update(LT)
      .set({
        state,
        error,
        sentAt: state === "sent" ? sql`now()` : null,
        sentBy: userId,
        updatedAt: sql`now()`,
      })
      .where(eq(LT.id, letter.id))
      .returning();
    return row!;
  }

  async letters(tx: Db, companyId: string, q: { partnerId?: string; state?: string }) {
    const where = [eq(LT.companyId, companyId)];
    if (q.partnerId) where.push(eq(LT.partnerId, q.partnerId));
    if (q.state === "sent" || q.state === "failed" || q.state === "printed")
      where.push(eq(LT.state, q.state));
    return tx
      .select({
        id: LT.id,
        name: LT.name,
        date: LT.date,
        partnerId: LT.partnerId,
        partner: schema.partners.name,
        levelSequence: LT.levelSequence,
        levelName: LT.levelName,
        state: LT.state,
        emailTo: LT.emailTo,
        currencyCode: LT.currencyCode,
        totalOverdue: LT.totalOverdue,
        invoiceCount: sql<number>`jsonb_array_length(${LT.invoices})`,
        automatic: sql<boolean>`${LT.sentBy} is null`,
        sentAt: LT.sentAt,
        error: LT.error,
      })
      .from(LT)
      .leftJoin(schema.partners, eq(schema.partners.id, LT.partnerId))
      .where(and(...where))
      .orderBy(desc(LT.date), desc(LT.createdAt))
      .limit(5000);
  }

  async letter(tx: Db, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(LT)
      .where(and(eq(LT.id, id), eq(LT.companyId, companyId)));
    if (!row) throw new NotFoundException("Surat teguran tidak ditemukan");
    return row;
  }

  async resend(tx: Db, companyId: string, id: string, to: string | null | undefined, userId: string) {
    const letter = await this.letter(tx, companyId, id);
    const emailTo = to || letter.emailTo || (await this.partner(tx, letter.partnerId)).email;
    const [level] = letter.levelId ? await tx.select().from(DL).where(eq(DL.id, letter.levelId)) : [];
    return this.deliver(tx, { ...letter, emailTo: emailTo ?? null }, level?.attachPdf ?? true, userId).then(
      async (row) => {
        if (emailTo !== letter.emailTo) {
          await tx.update(LT).set({ emailTo }).where(eq(LT.id, id));
          return { ...row, emailTo: emailTo ?? null };
        }
        return row;
      },
    );
  }

  /** PDF surat; surat gagal kirim yang dicetak ditandai "dicetak". */
  async letterPdf(tx: Db, companyId: string, id: string) {
    const letter = await this.letter(tx, companyId, id);
    const content = await this.pdf(tx, letter);
    if (letter.state === "failed") {
      await tx
        .update(LT)
        .set({ state: "printed", updatedAt: sql`now()` })
        .where(eq(LT.id, id));
    }
    return { filename: `${letter.name.replace(/[^\w.-]+/g, "_")}.pdf`, content };
  }

  private async pdf(tx: Db, letter: Letter) {
    const company = await this.company(tx, letter.companyId);
    const partner = await this.partner(tx, letter.partnerId);
    return renderDunningPdf({
      name: letter.name,
      date: letter.date,
      levelName: letter.levelName,
      company,
      partner,
      currencyCode: letter.currencyCode,
      body: letter.body,
      invoices: letter.invoices,
      totalOverdue: letter.totalOverdue,
    });
  }

  // ---------- Bantuan ----------

  private async partner(tx: Db, id: string) {
    const [row] = await tx.select().from(schema.partners).where(eq(schema.partners.id, id));
    if (!row) throw new NotFoundException("Kontak tidak ditemukan");
    return row;
  }

  private async company(tx: Db, id: string) {
    const [row] = await tx
      .select({
        name: schema.companies.name,
        npwp: schema.companies.npwp,
        street: schema.companies.street,
        city: schema.companies.city,
        phone: schema.companies.phone,
        email: schema.companies.email,
        currencyCode: schema.companies.currencyCode,
      })
      .from(schema.companies)
      .where(eq(schema.companies.id, id));
    if (!row) throw new NotFoundException("Perusahaan tidak ditemukan");
    return row;
  }

  private async companyCurrency(tx: Db, companyId: string) {
    return (await this.company(tx, companyId)).currencyCode;
  }

  private async toCompany(tx: Db, from: string, to: string, amount: Decimal.Value, date: string) {
    if (from === to) return dec(amount);
    try {
      const a = await this.fx.rateOn(tx, from, date);
      const b = await this.fx.rateOn(tx, to, date);
      return dec(amount).times(a.rate).div(b.rate).toDecimalPlaces(2);
    } catch {
      return dec(amount);
    }
  }
}

/** Pesan peringatan kredit yang ditampilkan ke pengguna. */
export function creditWarnings(s: {
  exceeded: boolean;
  overdueWarning: boolean;
  limit: string | null;
  exposure: string;
  oldestOverdueDays: number;
  overdueWarnDays: number | null;
  currencyCode: string;
}) {
  const out: string[] = [];
  if (s.exceeded) {
    out.push(
      `Melebihi batas kredit: paparan ${fmtMoney(s.currencyCode, s.exposure)} dari batas ${fmtMoney(s.currencyCode, s.limit ?? 0)}`,
    );
  }
  if (s.overdueWarning) {
    out.push(`Ada faktur menunggak ${s.oldestOverdueDays} hari (batas peringatan ${s.overdueWarnDays} hari)`);
  }
  return out;
}
