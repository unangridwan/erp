import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, schema, sql, type Db } from "@erp/db";
import { Decimal } from "decimal.js";
import { currentContext } from "../common/request-context.js";
import { FxService } from "../master/fx.controller.js";
import { loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";

type Line = typeof schema.fxRevaluations.$inferSelect.lines extends (infer T)[] ? T : never;

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const dayAfter = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Revaluasi selisih kurs belum terealisasi per akhir bulan: sisa piutang/utang valas yang masih terbuka per tanggal itu
 * dan saldo rekening berdenominasi valas dinilai ulang dengan kurs tanggal tersebut. Jurnal dibalik sehari kemudian,
 * sehingga selisih kurs terealisasi saat pelunasan tetap dihitung terhadap nilai awal transaksi.
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    @Inject(FxService) private readonly fx: FxService,
    @Inject(MoveService) private readonly moves: MoveService,
  ) {}

  async list(tx: Db) {
    return tx
      .select({
        revaluation: schema.fxRevaluations,
        moveName: schema.accountMoves.name,
      })
      .from(schema.fxRevaluations)
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.fxRevaluations.moveId))
      .where(eq(schema.fxRevaluations.companyId, currentContext().companyId))
      .orderBy(desc(schema.fxRevaluations.date))
      .then((rows) => rows.map((r) => ({ ...r.revaluation, moveName: r.moveName })));
  }

  /** Hitung baris revaluasi per tanggal tanpa menyimpan. */
  async preview(tx: Db, date: string) {
    const companyId = currentContext().companyId;
    const books = await loadBooks(tx, companyId);
    const company = books.currencyCode;
    // Sisa per tanggal = saldo − pelunasan dengan lawan yang bertanggal s.d. tanggal itu; valas proporsional.
    const open = await tx.execute<{
      account_id: string;
      code: string;
      name: string;
      partner_id: string | null;
      partner: string | null;
      currency_code: string;
      residual: string;
      residual_currency: string;
    }>(sql`
      with open_lines as (
        select l.account_id, l.partner_id, l.currency_code, l.balance, l.amount_currency,
          l.balance - coalesce((
            select sum(case when pr.debit_line_id = l.id then pr.amount else -pr.amount end)
            from partial_reconciles pr
            join account_move_lines o on o.id = case when pr.debit_line_id = l.id then pr.credit_line_id
                                                     else pr.debit_line_id end
            join account_moves om on om.id = o.move_id
            where (pr.debit_line_id = l.id or pr.credit_line_id = l.id) and om.date <= ${date}
          ), 0) as residual
        from account_move_lines l
        join account_moves m on m.id = l.move_id
        join accounts a on a.id = l.account_id
        where m.state = 'posted' and l.company_id = ${companyId} and m.date <= ${date} and a.reconcile
          and a.account_type in ('asset_receivable', 'liability_payable')
          and l.currency_code <> ${company} and l.amount_currency <> 0 and l.balance <> 0
      )
      select o.account_id, a.code, a.name, o.partner_id, p.name as partner, o.currency_code,
        sum(o.residual)::text as residual,
        sum(round(o.residual * o.amount_currency / o.balance, 2))::text as residual_currency
      from open_lines o
      join accounts a on a.id = o.account_id
      left join partners p on p.id = o.partner_id
      where o.residual <> 0
      group by o.account_id, a.code, a.name, o.partner_id, p.name, o.currency_code
      order by a.code, p.name`);
    // Rekening berdenominasi valas (mis. bank USD): saldo valas dari baris bermata uang rekening.
    const accounts = await tx.execute<{
      account_id: string;
      code: string;
      name: string;
      currency_code: string;
      residual: string;
      residual_currency: string;
    }>(sql`
      select a.id as account_id, a.code, a.name, a.currency_code,
        coalesce(sum(l.balance), 0)::text as residual,
        coalesce(sum(l.amount_currency), 0)::text as residual_currency
      from accounts a
      -- Hanya baris yang memang dicatat dalam mata uang rekening (jurnal rupiah biasa tidak dinilai ulang).
      join account_move_lines l on l.account_id = a.id and l.currency_code = a.currency_code
      join account_moves m on m.id = l.move_id
      where a.company_id = ${companyId} and a.currency_code is not null and a.currency_code <> ${company}
        and not a.reconcile and m.state = 'posted' and m.date <= ${date}
      group by a.id, a.code, a.name, a.currency_code
      order by a.code`);

    const rates = new Map<string, Decimal>();
    const rateOf = async (currency: string) => {
      if (!rates.has(currency)) {
        try {
          const from = await this.fx.rateOn(tx, currency, date);
          const to = await this.fx.rateOn(tx, company, date);
          rates.set(currency, dec(from.rate).div(to.rate));
        } catch (e) {
          throw new BadRequestException(
            `Kurs ${currency} per ${date} belum tersedia: ${(e as Error).message}`,
          );
        }
      }
      return rates.get(currency)!;
    };
    const lines: Line[] = [];
    for (const r of [...open, ...accounts.map((a) => ({ ...a, partner_id: null, partner: null }))]) {
      const rate = await rateOf(r.currency_code);
      const revalued = dec(r.residual_currency)
        .times(rate)
        .toDecimalPlaces(books.decimals, Decimal.ROUND_HALF_UP);
      const difference = revalued.minus(r.residual);
      if (difference.isZero()) continue;
      lines.push({
        accountId: r.account_id,
        accountCode: r.code,
        accountName: r.name,
        partnerId: r.partner_id,
        partnerName: r.partner,
        currencyCode: r.currency_code,
        amountCurrency: dec(r.residual_currency).toFixed(2),
        bookValue: dec(r.residual).toFixed(2),
        rate: rate.toDecimalPlaces(10).toString(),
        revalued: revalued.toFixed(2),
        difference: difference.toFixed(2),
      });
    }
    const gain = lines.filter((l) => dec(l.difference).gt(0)).reduce((s, l) => s.plus(l.difference), dec(0));
    const loss = lines.filter((l) => dec(l.difference).lt(0)).reduce((s, l) => s.minus(l.difference), dec(0));
    return { date, currencyCode: company, lines, gain: gain.toFixed(2), loss: loss.toFixed(2) };
  }

  /** Posting revaluasi per tanggal (sekali per tanggal) beserta jurnal baliknya pada hari berikutnya. */
  async post(tx: Db, date: string) {
    const companyId = currentContext().companyId;
    const [existing] = await tx
      .select({ id: schema.fxRevaluations.id })
      .from(schema.fxRevaluations)
      .where(and(eq(schema.fxRevaluations.companyId, companyId), eq(schema.fxRevaluations.date, date)));
    if (existing) throw new ConflictException(`Revaluasi kurs per ${date} sudah diposting`);
    const books = await loadBooks(tx, companyId);
    const { unrealizedFxGainAccountId: gainId, unrealizedFxLossAccountId: lossId } = books.settings;
    if (!gainId || !lossId)
      throw new BadRequestException(
        "Akun selisih kurs belum terealisasi belum diatur di pengaturan akuntansi",
      );
    const preview = await this.preview(tx, date);
    if (!preview.lines.length)
      throw new BadRequestException("Tidak ada saldo valas yang perlu dinilai ulang");
    const label = `Revaluasi kurs per ${date}`;
    const entryLines = preview.lines.map((l) => {
      const d = dec(l.difference);
      return {
        accountId: l.accountId,
        partnerId: l.partnerId,
        name: `${label} (${l.currencyCode} ${l.amountCurrency} @ ${Number(l.rate)})`,
        debit: d.gt(0) ? d.toFixed(2) : "0",
        credit: d.lt(0) ? d.negated().toFixed(2) : "0",
      };
    });
    if (dec(preview.gain).gt(0))
      entryLines.push({ accountId: gainId, partnerId: null, name: label, debit: "0", credit: preview.gain });
    if (dec(preview.loss).gt(0))
      entryLines.push({ accountId: lossId, partnerId: null, name: label, debit: preview.loss, credit: "0" });
    const moveId = await this.moves.createEntry(
      tx,
      { journalId: books.settings.generalJournalId, date, ref: label, lines: entryLines },
      companyId,
    );
    await this.moves.post(tx, moveId);
    const reversal = await this.moves.reverse(tx, moveId, dayAfter(date));
    const [row] = await tx
      .insert(schema.fxRevaluations)
      .values({
        companyId,
        date,
        moveId,
        reversalMoveId: reversal.id,
        lines: preview.lines,
        createdBy: currentContext().userId,
      })
      .returning();
    return { ...row!, gain: preview.gain, loss: preview.loss };
  }
}
