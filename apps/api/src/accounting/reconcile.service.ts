import { BadRequestException, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { Decimal } from "decimal.js";
import { currentContext } from "../common/request-context.js";

const dec = (v: Decimal.Value) => new Decimal(v);

@Injectable()
export class ReconcileService {
  /**
   * Rekonsiliasi baris debit dan kredit pada akun yang sama (mis. piutang faktur ↔ penerimaan kas).
   * Pemasangan FIFO berdasarkan tanggal; nilai dalam mata uang perusahaan. Mengembalikan sisa per baris.
   */
  async reconcileLines(tx: Db, lineIds: string[], opts: { reversal?: boolean } = {}) {
    const lines = await tx
      .select({
        id: schema.accountMoveLines.id,
        moveId: schema.accountMoveLines.moveId,
        accountId: schema.accountMoveLines.accountId,
        partnerId: schema.accountMoveLines.partnerId,
        residual: schema.accountMoveLines.amountResidual,
        reconciled: schema.accountMoveLines.reconciled,
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

    if (lines.length !== new Set(lineIds).size) throw new BadRequestException("Baris jurnal tidak ditemukan");
    const first = lines[0]!;
    for (const l of lines) {
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

    const residual = new Map(lines.map((l) => [l.id, dec(l.residual)]));
    const debits = lines.filter((l) => residual.get(l.id)!.gt(0));
    const credits = lines.filter((l) => residual.get(l.id)!.lt(0));
    for (const d of debits) {
      for (const c of credits) {
        const dr = residual.get(d.id)!;
        const cr = residual.get(c.id)!;
        if (dr.isZero()) break;
        if (cr.isZero()) continue;
        const amount = Decimal.min(dr, cr.abs());
        await tx
          .insert(schema.partialReconciles)
          .values({ debitLineId: d.id, creditLineId: c.id, amount: amount.toFixed(2) });
        residual.set(d.id, dr.minus(amount));
        residual.set(c.id, cr.plus(amount));
      }
    }

    for (const l of lines) {
      const r = residual.get(l.id)!;
      if (r.equals(l.residual)) continue;
      await tx
        .update(schema.accountMoveLines)
        .set({ amountResidual: r.toFixed(2), reconciled: r.isZero() })
        .where(eq(schema.accountMoveLines.id, l.id));
    }
    await this.refreshPaymentState(tx, [...new Set(lines.map((l) => l.moveId))], opts.reversal ?? false);
    return Object.fromEntries([...residual].map(([id, r]) => [id, r.toFixed(2)]));
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
