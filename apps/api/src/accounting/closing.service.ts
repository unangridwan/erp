import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { eq, schema, sql, type Db } from "@erp/db";
import { PROFIT_LOSS_TYPES } from "@erp/shared";
import { Decimal } from "decimal.js";
import { currentContext } from "../common/request-context.js";
import { loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Rentang tahun fiskal yang berakhir pada tahun `year` untuk awal tahun fiskal bulan `startMonth`. */
export function fiscalYearRange(year: number, startMonth: number) {
  const start = startMonth === 1 ? `${year}-01-01` : `${year - 1}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startMonth === 1 ? year + 1 : year, startMonth - 1, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

@Injectable()
export class ClosingService {
  constructor(@Inject(MoveService) private readonly moves: MoveService) {}

  /**
   * Tutup buku: pindahkan saldo semua akun laba rugi tahun fiskal ke saldo laba dengan entri penutup bertanggal
   * akhir tahun, lalu kunci periode sampai tanggal itu. Hanya sekali per tahun fiskal.
   */
  async closeYear(tx: Db, fiscalYear: number) {
    const companyId = currentContext().companyId;
    const books = await loadBooks(tx, companyId);
    const { start, end } = fiscalYearRange(fiscalYear, books.fiscalYearStartMonth);
    if (books.settings.lockDate && books.settings.lockDate >= end) {
      throw new BadRequestException(
        `Periode sudah dikunci sampai ${books.settings.lockDate}; tahun ini kemungkinan sudah ditutup`,
      );
    }
    const [closed] = await tx.execute<{ id: string }>(
      sql`select id from account_moves where company_id = ${companyId} and closing_year = ${fiscalYear}`,
    );
    if (closed) throw new ConflictException(`Tahun fiskal ${fiscalYear} sudah ditutup`);
    const [drafts] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from account_moves where company_id = ${companyId} and state = 'draft' and date between ${start} and ${end}`,
    );
    if (drafts && drafts.n > 0) {
      throw new BadRequestException(
        `Masih ada ${drafts.n} entri draft di tahun fiskal ini; posting atau hapus dulu`,
      );
    }

    const balances = await tx.execute<{ account_id: string; balance: string }>(sql`
      select l.account_id, sum(l.balance) as balance
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where m.state = 'posted' and m.company_id = ${companyId} and m.closing_year is null
        and m.date between ${start} and ${end} and a.account_type in (${list(PROFIT_LOSS_TYPES)})
      group by l.account_id
      having sum(l.balance) <> 0`);
    if (!balances.length)
      throw new BadRequestException("Tidak ada saldo laba rugi untuk ditutup di tahun fiskal ini");

    const net = balances.reduce((t, b) => t.plus(b.balance), new Decimal(0));
    const label = `Tutup buku tahun fiskal ${fiscalYear}`;
    const side = (balance: Decimal) => ({
      debit: balance.gt(0) ? balance.toFixed(2) : "0",
      credit: balance.lt(0) ? balance.abs().toFixed(2) : "0",
    });
    const lines = balances.map((b) => ({
      accountId: b.account_id,
      name: label,
      ...side(new Decimal(b.balance).negated()),
    }));
    // Laba (saldo P/L kredit, net < 0) menambah saldo laba di sisi kredit.
    if (!net.isZero())
      lines.push({ accountId: books.settings.retainedEarningsAccountId, name: label, ...side(net) });

    const moveId = await this.moves.createEntry(
      tx,
      { journalId: books.settings.generalJournalId, date: end, ref: label, lines },
      companyId,
    );
    await tx
      .update(schema.accountMoves)
      .set({ closingYear: fiscalYear })
      .where(eq(schema.accountMoves.id, moveId));
    const name = await this.moves.post(tx, moveId);
    await tx
      .update(schema.accountingSettings)
      .set({ lockDate: end, updatedAt: sql`now()` })
      .where(eq(schema.accountingSettings.companyId, companyId));
    return { moveId, name, fiscalYear, start, end, netProfit: net.negated().toFixed(2) };
  }
}
