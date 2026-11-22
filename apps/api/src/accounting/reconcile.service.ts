import { BadRequestException, forwardRef, Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, or, schema, sql, type Db } from "@erp/db";
import { Decimal } from "decimal.js";
import { currentContext } from "../common/request-context.js";
import { loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";

const dec = (v: Decimal.Value) => new Decimal(v);
const round2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

interface OpenLine {
  id: string;
  moveId: string;
  accountId: string;
  partnerId: string | null;
  currencyCode: string;
  res: Decimal;
  resCur: Decimal;
  date: string;
  changed: boolean;
}

@Injectable()
export class ReconcileService {
  // Tipe Pick (bukan kelas) agar metadata dekorator tidak merujuk MoveService saat modul belum selesai dimuat
  // (MoveService dan ReconcileService saling bergantung).
  constructor(
    @Inject(forwardRef(() => MoveService)) private readonly moves: Pick<MoveService, "createEntry" | "post">,
  ) {}

  /**
   * Rekonsiliasi baris debit dan kredit pada akun yang sama (mis. piutang faktur ↔ penerimaan kas), FIFO per tanggal.
   * Bila semua baris memakai valas yang sama, pemasangan dilakukan dalam valas; baris yang lunas dalam valas tetapi
   * masih bersisa dalam mata uang perusahaan ditutup dengan jurnal selisih kurs otomatis.
   * Mengembalikan sisa (mata uang perusahaan) per baris.
   */
  async reconcileLines(tx: Db, lineIds: string[], opts: { reversal?: boolean } = {}) {
    const rows = await tx
      .select({
        id: schema.accountMoveLines.id,
        moveId: schema.accountMoveLines.moveId,
        accountId: schema.accountMoveLines.accountId,
        partnerId: schema.accountMoveLines.partnerId,
        currencyCode: schema.accountMoveLines.currencyCode,
        residual: schema.accountMoveLines.amountResidual,
        residualCurrency: schema.accountMoveLines.amountResidualCurrency,
        date: schema.accountMoves.date,
        state: schema.accountMoves.state,
        companyId: schema.accountMoves.companyId,
        accountReconcile: schema.accounts.reconcile,
      })
      .from(schema.accountMoveLines)
      .innerJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.accountMoveLines.moveId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMoveLines.accountId))
      .where(inArray(schema.accountMoveLines.id, lineIds))
      .orderBy(asc(schema.accountMoves.date), asc(schema.accountMoveLines.createdAt))
      .for("update", { of: schema.accountMoveLines });

    if (rows.length !== new Set(lineIds).size) throw new BadRequestException("Baris jurnal tidak ditemukan");
    const first = rows[0]!;
    for (const l of rows) {
      if (!currentContext().companyIds.includes(l.companyId))
        throw new BadRequestException("Baris jurnal tidak ditemukan");
      if (l.state !== "posted") throw new BadRequestException("Hanya baris dari entri yang sudah diposting");
      if (!l.accountReconcile) throw new BadRequestException("Akun tidak dapat direkonsiliasi");
      if (
        l.accountId !== first.accountId ||
        l.partnerId !== first.partnerId ||
        l.companyId !== first.companyId
      ) {
        throw new BadRequestException("Baris harus pada akun, partner, dan perusahaan yang sama");
      }
    }

    const books = await loadBooks(tx, first.companyId);
    const lines: OpenLine[] = rows.map((r) => ({
      id: r.id,
      moveId: r.moveId,
      accountId: r.accountId,
      partnerId: r.partnerId,
      currencyCode: r.currencyCode,
      res: dec(r.residual),
      resCur: dec(r.residualCurrency),
      date: r.date,
      changed: false,
    }));
    // Pemasangan dalam valas hanya bila semua baris memakai valas yang sama.
    const foreign =
      lines.every((l) => l.currencyCode === first.currencyCode) && first.currencyCode !== books.currencyCode;
    const debits = lines.filter((l) => (foreign ? l.resCur : l.res).gt(0));
    const credits = lines.filter((l) => (foreign ? l.resCur : l.res).lt(0));

    for (const d of debits) {
      for (const c of credits) {
        let amount: Decimal;
        let amountCur: Decimal;
        if (foreign) {
          if (d.resCur.lte(0)) break;
          if (c.resCur.gte(0)) continue;
          amountCur = Decimal.min(d.resCur, c.resCur.abs());
          const dPart = amountCur.equals(d.resCur) ? d.res : round2(d.res.times(amountCur).div(d.resCur));
          const cPart = amountCur.equals(c.resCur.abs())
            ? c.res.abs()
            : round2(c.res.abs().times(amountCur).div(c.resCur.abs()));
          amount = Decimal.max(0, Decimal.min(dPart, cPart));
        } else {
          if (d.res.lte(0)) break;
          if (c.res.gte(0)) continue;
          amount = Decimal.min(d.res, c.res.abs());
          amountCur = amount;
        }
        if (amount.gt(0)) {
          await tx
            .insert(schema.partialReconciles)
            .values({ debitLineId: d.id, creditLineId: c.id, amount: amount.toFixed(2) });
        }
        const before = { d: d.res, c: c.res };
        d.res = d.res.minus(amount);
        c.res = c.res.plus(amount);
        if (foreign) {
          d.resCur = d.resCur.minus(amountCur);
          c.resCur = c.resCur.plus(amountCur);
        } else {
          d.resCur = this.syncCurrencyResidual(d, before.d, books.currencyCode);
          c.resCur = this.syncCurrencyResidual(c, before.c, books.currencyCode);
        }
        d.changed = c.changed = true;
      }
    }

    // Lunas dalam valas tetapi masih bersisa rupiah → jurnal selisih kurs.
    if (foreign) {
      for (const l of lines) {
        if (l.changed && l.resCur.isZero() && !l.res.isZero()) {
          await this.writeExchangeDifference(
            tx,
            books,
            l,
            lines.reduce((m, x) => (x.date > m ? x.date : m), l.date),
          );
          l.res = dec(0);
        }
      }
    }

    for (const l of lines.filter((x) => x.changed)) {
      await tx
        .update(schema.accountMoveLines)
        .set({
          amountResidual: l.res.toFixed(2),
          amountResidualCurrency: l.resCur.toFixed(2),
          reconciled: l.res.isZero() && l.resCur.isZero(),
        })
        .where(eq(schema.accountMoveLines.id, l.id));
    }
    await this.refreshPaymentState(tx, [...new Set(lines.map((l) => l.moveId))], opts.reversal ?? false);
    return Object.fromEntries(lines.map((l) => [l.id, l.res.toFixed(2)]));
  }

  /** Sisa valas mengikuti sisa rupiah secara proporsional (pemasangan campuran mata uang). */
  private syncCurrencyResidual(l: OpenLine, resBefore: Decimal, companyCurrency: string): Decimal {
    if (l.currencyCode === companyCurrency) return l.res;
    if (l.res.isZero()) return dec(0);
    if (resBefore.isZero()) return l.resCur;
    return round2(l.resCur.times(l.res).div(resBefore));
  }

  private async writeExchangeDifference(
    tx: Db,
    books: Awaited<ReturnType<typeof loadBooks>>,
    line: OpenLine,
    date: string,
  ) {
    const { fxGainAccountId, fxLossAccountId, generalJournalId } = books.settings;
    if (!fxGainAccountId || !fxLossAccountId) {
      throw new BadRequestException("Akun laba/rugi selisih kurs belum diatur di pengaturan akuntansi");
    }
    // Sisa debit (piutang lebih besar dari kas diterima) = rugi; sisa kredit = laba.
    const r = line.res;
    const value = r.abs().toFixed(2);
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: generalJournalId,
        date,
        ref: "Selisih kurs",
        lines: [
          {
            accountId: line.accountId,
            partnerId: line.partnerId,
            name: "Selisih kurs",
            debit: r.lt(0) ? value : "0",
            credit: r.gt(0) ? value : "0",
          },
          {
            accountId: r.gt(0) ? fxLossAccountId : fxGainAccountId,
            name: "Selisih kurs",
            debit: r.gt(0) ? value : "0",
            credit: r.lt(0) ? value : "0",
          },
        ],
      },
      books.companyId,
      { lineCurrency: [{ currencyCode: line.currencyCode, amountCurrency: "0" }] },
    );
    await this.moves.post(tx, moveId);
    const [fxLine] = await tx
      .select({ id: schema.accountMoveLines.id })
      .from(schema.accountMoveLines)
      .where(and(eq(schema.accountMoveLines.moveId, moveId), eq(schema.accountMoveLines.sequence, 0)));
    await tx.insert(schema.partialReconciles).values({
      debitLineId: r.gt(0) ? line.id : fxLine!.id,
      creditLineId: r.gt(0) ? fxLine!.id : line.id,
      amount: value,
    });
    await tx
      .update(schema.accountMoveLines)
      .set({ amountResidual: "0", amountResidualCurrency: "0", reconciled: true })
      .where(eq(schema.accountMoveLines.id, fxLine!.id));
  }

  /**
   * Batalkan semua rekonsiliasi yang melibatkan baris-baris entri ini, lalu hitung ulang sisa baris pasangan
   * dan status faktur terkait. Dipakai sebelum membalik entri pembayaran/mutasi bank.
   */
  async unreconcileMove(tx: Db, moveId: string) {
    const own = await tx
      .select({ id: schema.accountMoveLines.id })
      .from(schema.accountMoveLines)
      .where(eq(schema.accountMoveLines.moveId, moveId));
    const ownIds = own.map((l) => l.id);
    if (!ownIds.length) return;
    const partials = await tx
      .select()
      .from(schema.partialReconciles)
      .where(
        or(
          inArray(schema.partialReconciles.debitLineId, ownIds),
          inArray(schema.partialReconciles.creditLineId, ownIds),
        ),
      );
    if (!partials.length) return;
    const affected = [...new Set(partials.flatMap((p) => [p.debitLineId, p.creditLineId]))];
    await tx.delete(schema.partialReconciles).where(
      inArray(
        schema.partialReconciles.id,
        partials.map((p) => p.id),
      ),
    );

    const lines = await tx
      .select()
      .from(schema.accountMoveLines)
      .where(inArray(schema.accountMoveLines.id, affected));
    for (const line of lines) {
      const remaining = await tx
        .select()
        .from(schema.partialReconciles)
        .where(
          or(
            eq(schema.partialReconciles.debitLineId, line.id),
            eq(schema.partialReconciles.creditLineId, line.id),
          ),
        );
      const settled = remaining.reduce(
        (t, p) => (p.debitLineId === line.id ? t.minus(p.amount) : t.plus(p.amount)),
        dec(0),
      );
      const balance = dec(line.debit).minus(line.credit);
      const res = balance.plus(settled);
      const resCur = balance.isZero() ? dec(0) : round2(dec(line.amountCurrency).times(res).div(balance));
      await tx
        .update(schema.accountMoveLines)
        .set({
          amountResidual: res.toFixed(2),
          amountResidualCurrency: resCur.toFixed(2),
          reconciled: res.isZero(),
        })
        .where(eq(schema.accountMoveLines.id, line.id));
    }
    await this.refreshPaymentState(tx, [...new Set(lines.map((l) => l.moveId))], false);
  }

  /** Perbarui sisa & status pembayaran faktur dari sisa baris piutang/utangnya. */
  async refreshPaymentState(tx: Db, moveIds: string[], reversal: boolean) {
    for (const moveId of moveIds) {
      const [move] = await tx.select().from(schema.accountMoves).where(eq(schema.accountMoves.id, moveId));
      if (!move || move.moveType === "entry") continue;
      const [agg] = await tx
        .select({
          total: sql<string>`coalesce(abs(sum(${schema.accountMoveLines.balance})), 0)`,
          residual: sql<string>`coalesce(abs(sum(${schema.accountMoveLines.amountResidual})), 0)`,
        })
        .from(schema.accountMoveLines)
        .where(
          and(
            eq(schema.accountMoveLines.moveId, moveId),
            eq(schema.accountMoveLines.displayType, "payment_term"),
          ),
        );
      const residual = dec(agg!.residual);
      const paymentState = residual.isZero()
        ? reversal
          ? "reversed"
          : "paid"
        : residual.lessThan(agg!.total)
          ? "partial"
          : "not_paid";
      await tx
        .update(schema.accountMoves)
        .set({ amountResidual: residual.toFixed(2), paymentState, updatedAt: sql`now()` })
        .where(eq(schema.accountMoves.id, moveId));
    }
  }
}
