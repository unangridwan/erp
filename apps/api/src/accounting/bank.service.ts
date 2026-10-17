import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import {
  mapStatementRows,
  parseCsv,
  type statementImportSchema,
  type statementReconcileSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { assertCompanyAccounts, assertCompanyJournal, assertPartner, fieldError } from "./context.js";
import { MoveService } from "./move.service.js";
import { ReconcileService } from "./reconcile.service.js";

const dec = (v: Decimal.Value) => new Decimal(v);

@Injectable()
export class BankService {
  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ReconcileService) private readonly reconcile: ReconcileService,
  ) {}

  async list(tx: Db) {
    const s = schema.bankStatements;
    const l = schema.bankStatementLines;
    return tx
      .select({
        id: s.id,
        name: s.name,
        date: s.date,
        journalId: s.journalId,
        journalName: schema.journals.name,
        balanceStart: s.balanceStart,
        balanceEnd: s.balanceEnd,
        lineCount: sql<number>`count(${l.id})::int`,
        openCount: sql<number>`count(${l.id}) filter (where ${l.moveId} is null)::int`,
        total: sql<string>`coalesce(sum(${l.amount}), 0)`,
      })
      .from(s)
      .innerJoin(schema.journals, eq(schema.journals.id, s.journalId))
      .leftJoin(l, eq(l.statementId, s.id))
      .where(eq(s.companyId, currentContext().companyId))
      .groupBy(s.id, schema.journals.name)
      .orderBy(desc(s.date), desc(s.createdAt));
  }

  async get(tx: Db, id: string) {
    const [statement] = await tx
      .select()
      .from(schema.bankStatements)
      .where(
        and(
          eq(schema.bankStatements.id, id),
          eq(schema.bankStatements.companyId, currentContext().companyId),
        ),
      );
    if (!statement) throw new NotFoundException("Mutasi bank tidak ditemukan");
    const lines = await tx
      .select({
        line: schema.bankStatementLines,
        partnerName: schema.partners.name,
        moveName: schema.accountMoves.name,
      })
      .from(schema.bankStatementLines)
      .leftJoin(schema.partners, eq(schema.partners.id, schema.bankStatementLines.partnerId))
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.bankStatementLines.moveId))
      .where(eq(schema.bankStatementLines.statementId, id))
      .orderBy(asc(schema.bankStatementLines.sequence));
    return {
      ...statement,
      lines: lines.map((r) => ({ ...r.line, matchedPartnerName: r.partnerName, moveName: r.moveName })),
    };
  }

  /** Impor CSV mutasi rekening dengan pemetaan kolom; partner dicocokkan otomatis dari nama bila persis sama. */
  async import(tx: Db, input: z.infer<typeof statementImportSchema>) {
    const companyId = currentContext().companyId;
    await assertCompanyJournal(tx, companyId, input.journalId, ["bank", "cash"]);
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(input.csv);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "CSV tidak valid");
    }
    const { lines, errors } = mapStatementRows(rows, input.mapping);
    if (errors.length) {
      throw new BadRequestException({
        message: "Impor dibatalkan: ada baris tidak valid",
        errors: errors.map((e) => ({ ...e, path: "" })),
      });
    }
    if (!lines.length) throw new BadRequestException("Tidak ada transaksi di file");

    const [statement] = await tx
      .insert(schema.bankStatements)
      .values({
        companyId,
        journalId: input.journalId,
        name: input.name,
        date: lines.reduce((m, l) => (l.date > m ? l.date : m), lines[0]!.date),
        balanceStart: input.balanceStart ?? null,
        balanceEnd: input.balanceEnd ?? null,
      })
      .returning();

    const names = [
      ...new Set(lines.map((l) => l.partnerName?.toLowerCase()).filter((n): n is string => !!n)),
    ];
    const partners = names.length
      ? await tx
          .select({ id: schema.partners.id, name: schema.partners.name })
          .from(schema.partners)
          .where(inArray(sql`lower(${schema.partners.name})`, names))
      : [];
    await tx.insert(schema.bankStatementLines).values(
      lines.map((l, i) => ({
        statementId: statement!.id,
        sequence: i,
        date: l.date,
        paymentRef: l.paymentRef,
        partnerName: l.partnerName,
        amount: l.amount,
        partnerId: partners.find((p) => p.name.toLowerCase() === l.partnerName?.toLowerCase())?.id ?? null,
      })),
    );
    return this.get(tx, statement!.id);
  }

  /**
   * Saran pasangan untuk baris mutasi: baris piutang (uang masuk) atau utang (uang keluar) yang masih terbuka,
   * diurutkan berdasarkan kecocokan nomor dokumen di keterangan, jumlah persis, dan partner.
   */
  async suggestions(tx: Db, lineId: string) {
    const line = await this.openLine(tx, lineId);
    const inbound = dec(line.amount).gt(0);
    const rows = await tx
      .select({
        id: schema.accountMoveLines.id,
        moveId: schema.accountMoves.id,
        moveName: schema.accountMoves.name,
        ref: schema.accountMoves.ref,
        date: schema.accountMoves.date,
        dueDate: schema.accountMoves.dueDate,
        partnerId: schema.accountMoveLines.partnerId,
        partnerName: schema.partners.name,
        residual: schema.accountMoveLines.amountResidual,
      })
      .from(schema.accountMoveLines)
      .innerJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.accountMoveLines.moveId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMoveLines.accountId))
      .leftJoin(schema.partners, eq(schema.partners.id, schema.accountMoveLines.partnerId))
      .where(
        and(
          eq(schema.accountMoves.companyId, currentContext().companyId),
          eq(schema.accountMoves.state, "posted"),
          eq(schema.accountMoveLines.reconciled, false),
          eq(schema.accounts.accountType, inbound ? "asset_receivable" : "liability_payable"),
          inbound
            ? sql`${schema.accountMoveLines.amountResidual} > 0`
            : sql`${schema.accountMoveLines.amountResidual} < 0`,
        ),
      )
      .limit(500);
    const ref = line.paymentRef.toUpperCase();
    const amount = dec(line.amount).abs();
    return rows
      .map((r) => {
        let score = 0;
        if (r.moveName && ref.includes(r.moveName.toUpperCase())) score += 4;
        if (r.ref && r.ref.length >= 4 && ref.includes(r.ref.toUpperCase())) score += 2;
        if (dec(r.residual).abs().equals(amount)) score += 3;
        if (line.partnerId && r.partnerId === line.partnerId) score += 2;
        else if (r.partnerName && ref.includes(r.partnerName.toUpperCase())) score += 1;
        return { ...r, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
      .slice(0, 10);
  }

  /**
   * Rekonsiliasi satu baris mutasi: buat & posting entri di jurnal bank (kas/bank vs pasangan), lunasi baris
   * piutang/utang terpilih, dan bukukan sisa (mis. biaya bank) ke akun pilihan.
   */
  async reconcileLine(tx: Db, lineId: string, input: z.infer<typeof statementReconcileSchema>) {
    const line = await this.openLine(tx, lineId);
    const [statement] = await tx
      .select()
      .from(schema.bankStatements)
      .where(eq(schema.bankStatements.id, line.statementId));
    const companyId = statement!.companyId;
    const journal = await assertCompanyJournal(tx, companyId, statement!.journalId, ["bank", "cash"]);
    if (!journal.defaultAccountId) throw new BadRequestException("Jurnal kas/bank belum punya akun");

    const amount = dec(line.amount);
    const open = input.moveLineIds.length
      ? await tx
          .select({
            id: schema.accountMoveLines.id,
            accountId: schema.accountMoveLines.accountId,
            partnerId: schema.accountMoveLines.partnerId,
            residual: schema.accountMoveLines.amountResidual,
            reconciled: schema.accountMoveLines.reconciled,
            companyId: schema.accountMoveLines.companyId,
          })
          .from(schema.accountMoveLines)
          .where(inArray(schema.accountMoveLines.id, input.moveLineIds))
      : [];
    if (open.length !== new Set(input.moveLineIds).size)
      throw fieldError("moveLineIds", "Baris jurnal tidak ditemukan");
    // Partner: pilihan user, hasil pencocokan nama saat impor, atau partner dokumen yang dilunasi.
    const partnerId =
      input.partnerId ?? line.partnerId ?? open.find((o) => o.id === input.moveLineIds[0])?.partnerId ?? null;
    if (partnerId) await assertPartner(tx, companyId, partnerId);

    // Alokasikan jumlah mutasi ke baris terbuka sesuai urutan pilihan.
    let remaining = amount;
    const fmt = (v: Decimal) => v.abs().toFixed(2);
    const entryLines: {
      accountId: string;
      partnerId?: string | null;
      name: string;
      debit: string;
      credit: string;
    }[] = [
      {
        accountId: journal.defaultAccountId,
        name: line.paymentRef,
        debit: amount.gt(0) ? fmt(amount) : "0",
        credit: amount.lt(0) ? fmt(amount) : "0",
      },
    ];
    const pairs: { openLineId: string; index: number }[] = [];
    for (const id of input.moveLineIds) {
      const o = open.find((x) => x.id === id)!;
      const residual = dec(o.residual);
      if (o.reconciled || o.companyId !== companyId || residual.isZero() || residual.gt(0) !== amount.gt(0)) {
        throw fieldError("moveLineIds", "Baris jurnal sudah lunas atau tidak sesuai arah mutasi");
      }
      if (remaining.isZero()) break;
      const take = Decimal.min(remaining.abs(), residual.abs());
      pairs.push({ openLineId: o.id, index: entryLines.length });
      entryLines.push({
        accountId: o.accountId,
        partnerId: o.partnerId,
        name: line.paymentRef,
        debit: residual.lt(0) ? take.toFixed(2) : "0",
        credit: residual.gt(0) ? take.toFixed(2) : "0",
      });
      remaining = remaining.gt(0) ? remaining.minus(take) : remaining.plus(take);
    }
    if (!remaining.isZero()) {
      if (!input.accountId) {
        throw fieldError(
          "accountId",
          `Sisa ${remaining.toFixed(2)} belum dialokasikan; pilih akun untuk sisanya`,
        );
      }
      await assertCompanyAccounts(tx, companyId, [{ path: "accountId", id: input.accountId }]);
      entryLines.push({
        accountId: input.accountId,
        partnerId,
        name: input.label ?? line.paymentRef,
        debit: remaining.lt(0) ? fmt(remaining) : "0",
        credit: remaining.gt(0) ? fmt(remaining) : "0",
      });
    }

    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: journal.id,
        date: line.date,
        ref: line.paymentRef,
        lines: entryLines.map((l, i) => ({ ...l, partnerId: i === 0 ? partnerId : l.partnerId })),
      },
      companyId,
    );
    await this.moves.post(tx, moveId);
    const created = await tx
      .select({ id: schema.accountMoveLines.id, sequence: schema.accountMoveLines.sequence })
      .from(schema.accountMoveLines)
      .where(eq(schema.accountMoveLines.moveId, moveId));
    for (const pair of pairs) {
      const counterpart = created.find((c) => c.sequence === pair.index)!;
      await this.reconcile.reconcileLines(tx, [counterpart.id, pair.openLineId]);
    }
    await tx
      .update(schema.bankStatementLines)
      .set({ moveId, partnerId: partnerId ?? null })
      .where(eq(schema.bankStatementLines.id, lineId));
    return this.get(tx, line.statementId);
  }

  /** Batalkan rekonsiliasi baris mutasi: lepas pelunasan, balik entrinya, dan buka kembali barisnya. */
  async undo(tx: Db, lineId: string) {
    const [line] = await this.lineWithStatement(tx, lineId);
    if (!line?.moveId) throw new BadRequestException("Baris mutasi belum direkonsiliasi");
    await this.reconcile.unreconcileMove(tx, line.moveId);
    await this.moves.reverse(tx, line.moveId, line.date);
    await tx
      .update(schema.bankStatementLines)
      .set({ moveId: null })
      .where(eq(schema.bankStatementLines.id, lineId));
    return this.get(tx, line.statementId);
  }

  async remove(tx: Db, id: string) {
    const statement = await this.get(tx, id);
    if (statement.lines.some((l) => l.moveId)) {
      throw new BadRequestException("Batalkan rekonsiliasi semua baris sebelum menghapus mutasi");
    }
    await tx.delete(schema.bankStatements).where(eq(schema.bankStatements.id, id));
  }

  private async lineWithStatement(tx: Db, lineId: string) {
    const rows = await tx
      .select({ line: schema.bankStatementLines })
      .from(schema.bankStatementLines)
      .innerJoin(schema.bankStatements, eq(schema.bankStatements.id, schema.bankStatementLines.statementId))
      .where(
        and(
          eq(schema.bankStatementLines.id, lineId),
          eq(schema.bankStatements.companyId, currentContext().companyId),
        ),
      )
      .for("update", { of: schema.bankStatementLines });
    return rows.map((r) => r.line);
  }

  private async openLine(tx: Db, lineId: string) {
    const [line] = await this.lineWithStatement(tx, lineId);
    if (!line) throw new NotFoundException("Baris mutasi tidak ditemukan");
    if (line.moveId) throw new BadRequestException("Baris mutasi sudah direkonsiliasi");
    return line;
  }
}
