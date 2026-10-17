import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { computeInvoice, type invoiceSchema, type journalEntrySchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { FxService } from "../master/fx.controller.js";
import { SequenceService } from "../sequences/sequence.service.js";
import {
  assertCompanyAccounts,
  assertCompanyJournal,
  assertDimensions,
  assertPartner,
  fieldError,
  loadBooks,
  type CompanyBooks,
} from "./context.js";
import { ReconcileService } from "./reconcile.service.js";

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;
type MoveType = (typeof schema.MOVE_TYPES)[number];
type NewLine = Omit<typeof schema.accountMoveLines.$inferInsert, "moveId">;

const SALE_TYPES: MoveType[] = ["out_invoice", "out_refund"];
const REVERSAL: Record<MoveType, MoveType> = {
  entry: "entry",
  out_invoice: "out_refund",
  out_refund: "out_invoice",
  in_invoice: "in_refund",
  in_refund: "in_invoice",
};

export const isInvoice = (t: MoveType) => t !== "entry";

const dec = (v: Decimal.Value) => new Decimal(v);
const sideOf = (balance: Decimal, decimals: number) => ({
  debit: balance.gt(0) ? balance.toFixed(decimals) : "0",
  credit: balance.lt(0) ? balance.abs().toFixed(decimals) : "0",
});

@Injectable()
export class MoveService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(FxService) private readonly fx: FxService,
    // Pick: lihat catatan di ReconcileService tentang ketergantungan melingkar.
    @Inject(forwardRef(() => ReconcileService))
    private readonly reconcile: Pick<ReconcileService, "reconcileLines">,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  // ---- Membuat & mengubah draft ----

  /**
   * Buat draft jurnal umum. `opts.lineCurrency` (internal) memberi mata uang & jumlah valas per baris,
   * dipakai pembayaran valas dan jurnal selisih kurs.
   */
  async createEntry(
    tx: Db,
    input: JournalEntryInput,
    companyId = currentContext().companyId,
    opts: { lineCurrency?: ({ currencyCode: string; amountCurrency: string } | undefined)[] } = {},
  ) {
    const books = await loadBooks(tx, companyId);
    const journalId = input.journalId ?? books.settings.generalJournalId;
    await assertCompanyJournal(tx, companyId, journalId, ["general", "bank", "cash", "sale", "purchase"]);
    const lines = (await this.entryLines(tx, books, input)).map((l, i) => ({
      ...l,
      ...(opts.lineCurrency?.[i] ?? {}),
    }));
    const [move] = await tx
      .insert(schema.accountMoves)
      .values({
        companyId,
        journalId,
        moveType: "entry",
        date: input.date,
        ref: input.ref ?? null,
        narration: input.narration ?? null,
        currencyCode: books.currencyCode,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.accountMoves.id });
    await tx.insert(schema.accountMoveLines).values(lines.map((l) => ({ ...l, moveId: move!.id })));
    await this.activity.log(tx, { resModel: "account_move", resId: move!.id, action: "create" });
    return move!.id;
  }

  /**
   * Buat draft faktur/tagihan. `opts` (internal) dipakai modul penjualan & pembelian: dokumen asal dan
   * tautan baris barang ke baris pesanan (indeks sama dengan `input.lines`).
   */
  async createInvoice(
    tx: Db,
    input: InvoiceInput,
    companyId = currentContext().companyId,
    opts: {
      invoiceOrigin?: string;
      saleLineIds?: (string | null)[];
      purchaseLineIds?: (string | null)[];
    } = {},
  ) {
    const books = await loadBooks(tx, companyId);
    const { header, lines } = await this.invoiceDraft(tx, books, input);
    const [move] = await tx
      .insert(schema.accountMoves)
      .values({
        ...header,
        companyId,
        invoiceOrigin: opts.invoiceOrigin ?? null,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.accountMoves.id });
    await tx.insert(schema.accountMoveLines).values(
      lines.map((l) => ({
        ...l,
        moveId: move!.id,
        saleLineId: l.displayType === "product" ? (opts.saleLineIds?.[l.sequence ?? -1] ?? null) : null,
        purchaseLineId:
          l.displayType === "product" ? (opts.purchaseLineIds?.[l.sequence ?? -1] ?? null) : null,
      })),
    );
    await this.activity.log(tx, { resModel: "account_move", resId: move!.id, action: "create" });
    return move!.id;
  }

  /** Ganti isi draft (baris dihitung ulang). */
  async updateDraft(tx: Db, id: string, input: JournalEntryInput | InvoiceInput) {
    const move = await this.lockDraft(tx, id);
    const books = await loadBooks(tx, move.companyId);
    // Tautan ke baris pesanan penjualan/pembelian dipertahankan bila baris di posisi yang sama masih produk yang sama.
    const oldLines = await tx
      .select({
        sequence: schema.accountMoveLines.sequence,
        productId: schema.accountMoveLines.productId,
        saleLineId: schema.accountMoveLines.saleLineId,
        purchaseLineId: schema.accountMoveLines.purchaseLineId,
      })
      .from(schema.accountMoveLines)
      .where(and(eq(schema.accountMoveLines.moveId, id), eq(schema.accountMoveLines.displayType, "product")));
    await tx.delete(schema.accountMoveLines).where(eq(schema.accountMoveLines.moveId, id));
    if ("moveType" in input) {
      if (input.moveType !== move.moveType) throw fieldError("moveType", "Jenis dokumen tidak bisa diubah");
      const { header, lines } = await this.invoiceDraft(tx, books, input);
      await tx
        .update(schema.accountMoves)
        .set({ ...header, updatedAt: sql`now()` })
        .where(eq(schema.accountMoves.id, id));
      await tx.insert(schema.accountMoveLines).values(
        lines.map((l) => {
          const old = l.displayType === "product" && oldLines.find((o) => o.sequence === l.sequence);
          const keep = old && old.productId === (l.productId ?? null);
          return {
            ...l,
            moveId: id,
            saleLineId: keep ? old.saleLineId : null,
            purchaseLineId: keep ? old.purchaseLineId : null,
          };
        }),
      );
    } else {
      if (move.moveType !== "entry") throw fieldError("moveType", "Dokumen ini adalah faktur/tagihan");
      const journalId = input.journalId ?? move.journalId;
      await assertCompanyJournal(tx, move.companyId, journalId, [
        "general",
        "bank",
        "cash",
        "sale",
        "purchase",
      ]);
      const lines = await this.entryLines(tx, books, input);
      await tx
        .update(schema.accountMoves)
        .set({
          journalId,
          date: input.date,
          ref: input.ref ?? null,
          narration: input.narration ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.accountMoves.id, id));
      await tx.insert(schema.accountMoveLines).values(lines.map((l) => ({ ...l, moveId: id })));
    }
    await this.activity.log(tx, { resModel: "account_move", resId: id, action: "update" });
  }

  async deleteDraft(tx: Db, id: string) {
    await this.lockDraft(tx, id);
    await tx.delete(schema.accountMoves).where(eq(schema.accountMoves.id, id));
    await this.activity.log(tx, { resModel: "account_move", resId: id, action: "delete" });
  }

  // ---- Posting & pembalikan ----

  /** Posting draft: validasi saldo & lock date, beri nomor dari sequence jurnal, siapkan sisa untuk rekonsiliasi. */
  async post(tx: Db, id: string) {
    const move = await this.lockDraft(tx, id);
    const books = await loadBooks(tx, move.companyId);
    const lines = await tx
      .select()
      .from(schema.accountMoveLines)
      .where(eq(schema.accountMoveLines.moveId, id));

    const debit = lines.reduce((s, l) => s.plus(l.debit), dec(0));
    const credit = lines.reduce((s, l) => s.plus(l.credit), dec(0));
    if (lines.length < 2 || debit.isZero() || !debit.equals(credit)) {
      throw new BadRequestException(
        `Entri tidak seimbang: debit ${debit.toFixed(2)}, kredit ${credit.toFixed(2)}`,
      );
    }
    const lock = books.settings.lockDate;
    if (lock && move.date <= lock) {
      throw new BadRequestException(
        `Periode sudah dikunci sampai ${lock}; ubah tanggal entri atau buka kunci periode`,
      );
    }

    const [journal] = await tx.select().from(schema.journals).where(eq(schema.journals.id, move.journalId));
    // Tengah hari waktu lokal agar tahun tidak bergeser karena zona waktu.
    const date = new Date(`${move.date}T12:00:00`);
    const name = await this.sequences.next(
      tx,
      `journal:${move.journalId}`,
      move.companyId,
      date,
      journal!.code,
    );

    // Baris pada akun yang direkonsiliasi (piutang/utang) membawa sisa = saldonya.
    const accounts = await tx
      .select({ id: schema.accounts.id, reconcile: schema.accounts.reconcile })
      .from(schema.accounts)
      .where(inArray(schema.accounts.id, [...new Set(lines.map((l) => l.accountId))]));
    const reconcilable = new Set(accounts.filter((a) => a.reconcile).map((a) => a.id));
    for (const line of lines.filter((l) => reconcilable.has(l.accountId))) {
      await tx
        .update(schema.accountMoveLines)
        .set({
          amountResidual: dec(line.debit).minus(line.credit).toFixed(2),
          amountResidualCurrency: line.amountCurrency,
        })
        .where(eq(schema.accountMoveLines.id, line.id));
    }
    const residual = lines
      .filter((l) => l.displayType === "payment_term")
      .reduce((s, l) => s.plus(l.debit).minus(l.credit), dec(0))
      .abs();

    await tx
      .update(schema.accountMoves)
      .set({
        state: "posted",
        name,
        amountResidual: residual.toFixed(2),
        postedAt: sql`now()`,
        postedBy: currentContext().userId,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.accountMoves.id, id));
    await this.activity.log(tx, {
      resModel: "account_move",
      resId: id,
      action: "update",
      message: `Diposting sebagai ${name}`,
    });
    return name;
  }

  /**
   * Buat jurnal balik (credit note untuk faktur) yang langsung diposting, lalu rekonsiliasi
   * piutang/utang keduanya sehingga dokumen asal lunas.
   */
  async reverse(tx: Db, id: string, date?: string) {
    const [move] = await tx
      .select()
      .from(schema.accountMoves)
      .where(eq(schema.accountMoves.id, id))
      .for("update");
    if (!move) throw new NotFoundException("Entri tidak ditemukan");
    if (move.state !== "posted")
      throw new BadRequestException("Hanya entri yang sudah diposting yang bisa dibalik");
    const [already] = await tx
      .select({ id: schema.accountMoves.id })
      .from(schema.accountMoves)
      .where(eq(schema.accountMoves.reversedEntryId, id));
    if (already) throw new ConflictException("Entri ini sudah pernah dibalik");

    const lines = await tx
      .select()
      .from(schema.accountMoveLines)
      .where(eq(schema.accountMoveLines.moveId, id))
      .orderBy(asc(schema.accountMoveLines.sequence));
    const [reversal] = await tx
      .insert(schema.accountMoves)
      .values({
        companyId: move.companyId,
        journalId: move.journalId,
        moveType: REVERSAL[move.moveType],
        date: date ?? move.date,
        dueDate: date ?? move.date,
        partnerId: move.partnerId,
        ref: `Pembalikan ${move.name}`,
        currencyCode: move.currencyCode,
        currencyRate: move.currencyRate,
        amountUntaxed: move.amountUntaxed,
        amountTax: move.amountTax,
        amountTotal: move.amountTotal,
        reversedEntryId: id,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.accountMoves.id });
    const reversedLines = await tx
      .insert(schema.accountMoveLines)
      .values(
        lines.map(
          ({
            id: _id,
            moveId: _m,
            balance: _b,
            createdAt: _c,
            amountResidual: _r,
            amountResidualCurrency: _rcur,
            reconciled: _rc,
            ...l
          }) => ({
            ...l,
            moveId: reversal!.id,
            debit: l.credit,
            credit: l.debit,
            amountCurrency: dec(l.amountCurrency).negated().toFixed(2),
            tenantId: undefined,
          }),
        ),
      )
      .returning({ id: schema.accountMoveLines.id, sequence: schema.accountMoveLines.sequence });
    const name = await this.post(tx, reversal!.id);

    // Pasangkan baris yang direkonsiliasi (urutan baris sama dengan dokumen asal).
    const reconcilable = await tx
      .select({ id: schema.accountMoveLines.id, sequence: schema.accountMoveLines.sequence })
      .from(schema.accountMoveLines)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMoveLines.accountId))
      .where(and(eq(schema.accountMoveLines.moveId, id), eq(schema.accounts.reconcile, true)));
    for (const original of reconcilable) {
      const counterpart = reversedLines.find((r) => r.sequence === original.sequence);
      if (counterpart)
        await this.reconcile.reconcileLines(tx, [original.id, counterpart.id], { reversal: true });
    }
    return { id: reversal!.id, name };
  }

  // ---- Membaca ----

  async get(tx: Db, id: string) {
    const [move] = await tx
      .select()
      .from(schema.accountMoves)
      .where(
        and(
          eq(schema.accountMoves.id, id),
          inArray(schema.accountMoves.companyId, currentContext().companyIds),
        ),
      );
    if (!move) throw new NotFoundException("Entri tidak ditemukan");
    const lines = await tx
      .select()
      .from(schema.accountMoveLines)
      .where(eq(schema.accountMoveLines.moveId, id))
      .orderBy(asc(schema.accountMoveLines.sequence));
    return { ...move, lines };
  }

  // ---- Internal ----

  private async lockDraft(tx: Db, id: string) {
    const [move] = await tx
      .select()
      .from(schema.accountMoves)
      .where(
        and(
          eq(schema.accountMoves.id, id),
          inArray(schema.accountMoves.companyId, currentContext().companyIds),
        ),
      )
      .for("update");
    if (!move) throw new NotFoundException("Entri tidak ditemukan");
    if (move.state !== "draft")
      throw new BadRequestException("Entri sudah diposting; gunakan pembalikan untuk koreksi");
    return move;
  }

  private async entryLines(tx: Db, books: CompanyBooks, input: JournalEntryInput): Promise<NewLine[]> {
    await assertCompanyAccounts(
      tx,
      books.companyId,
      input.lines.map((l, i) => ({ path: `lines.${i}.accountId`, id: l.accountId })),
    );
    await assertDimensions(tx, books.companyId, input.lines);
    const lines: NewLine[] = [];
    for (const [i, l] of input.lines.entries()) {
      const debit = dec(l.debit);
      const credit = dec(l.credit);
      if (debit.gt(0) && credit.gt(0))
        throw fieldError(`lines.${i}`, "Isi debit atau kredit, tidak keduanya");
      if (debit.isZero() && credit.isZero()) throw fieldError(`lines.${i}`, "Debit atau kredit harus diisi");
      const partner = l.partnerId
        ? await assertPartner(tx, books.companyId, l.partnerId, `lines.${i}.partnerId`)
        : null;
      lines.push({
        companyId: books.companyId,
        sequence: i,
        displayType: "line",
        accountId: l.accountId,
        partnerId: l.partnerId ?? null,
        name: l.name ?? null,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        currencyCode: books.currencyCode,
        amountCurrency: debit.minus(credit).toFixed(2),
        businessUnitId: l.businessUnitId ?? null,
        branchId: l.branchId ?? null,
        icCompanyId: partner?.icCompanyId ?? null,
      });
    }
    return lines;
  }

  /** Susun header & baris jurnal faktur/tagihan dari input baris barang. */
  private async invoiceDraft(tx: Db, books: CompanyBooks, input: InvoiceInput) {
    const sale = SALE_TYPES.includes(input.moveType);
    const journalId =
      input.journalId ?? (sale ? books.settings.saleJournalId : books.settings.purchaseJournalId);
    const journal = await assertCompanyJournal(tx, books.companyId, journalId, [sale ? "sale" : "purchase"]);
    const partner = await assertPartner(tx, books.companyId, input.partnerId);
    await assertDimensions(tx, books.companyId, input.lines);

    // Mata uang & kurs dokumen → mata uang perusahaan.
    const currencyCode = input.currencyCode ?? books.currencyCode;
    const [currency] = await tx
      .select()
      .from(schema.currencies)
      .where(eq(schema.currencies.code, currencyCode));
    if (!currency) throw fieldError("currencyCode", "Mata uang tidak dikenal");
    let rate = dec(1);
    if (currencyCode !== books.currencyCode) {
      const from = await this.fx.rateOn(tx, currencyCode, input.date);
      const to = await this.fx.rateOn(tx, books.currencyCode, input.date);
      rate = dec(from.rate).div(to.rate);
    }
    const toCompany = (amount: Decimal) =>
      amount.times(rate).toDecimalPlaces(books.decimals, Decimal.ROUND_HALF_UP);

    // Pajak harus milik perusahaan ini dan sesuai jenis (penjualan/pembelian).
    const taxIds = [...new Set(input.lines.flatMap((l) => l.taxIds))];
    const taxes = taxIds.length
      ? await tx
          .select()
          .from(schema.taxes)
          .where(
            and(
              inArray(schema.taxes.id, taxIds),
              eq(schema.taxes.companyId, books.companyId),
              eq(schema.taxes.active, true),
            ),
          )
      : [];
    for (const [i, line] of input.lines.entries()) {
      for (const taxId of line.taxIds) {
        const tax = taxes.find((t) => t.id === taxId);
        if (!tax || tax.typeTaxUse !== (sale ? "sale" : "purchase")) {
          throw fieldError(`lines.${i}.taxIds`, "Pajak tidak ditemukan atau tidak sesuai jenis dokumen");
        }
      }
    }

    // Akun baris: dari input, atau akun bawaan jurnal.
    const lineAccounts = input.lines.map((l, i) => {
      const id = l.accountId ?? journal.defaultAccountId;
      if (!id) throw fieldError(`lines.${i}.accountId`, "Pilih akun (jurnal tidak punya akun bawaan)");
      return { path: `lines.${i}.accountId`, id };
    });
    const termAccountId = partner.icCompanyId
      ? sale
        ? books.settings.icReceivableAccountId
        : books.settings.icPayableAccountId
      : sale
        ? books.settings.receivableAccountId
        : books.settings.payableAccountId;
    await assertCompanyAccounts(tx, books.companyId, [
      ...lineAccounts,
      ...taxes.map((t) => ({ path: "taxIds", id: t.accountId })),
    ]);
    for (const [i, l] of input.lines.entries()) {
      if (l.productId) {
        const [product] = await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(eq(schema.products.id, l.productId));
        if (!product) throw fieldError(`lines.${i}.productId`, "Produk tidak ditemukan");
      }
    }

    const result = computeInvoice(
      input.lines,
      taxes.map((t) => ({ id: t.id, amount: t.amount, baseRatio: t.baseRatio })),
      currency.decimals,
    );

    // Tanda saldo baris barang: pendapatan (kredit) untuk faktur penjualan & retur pembelian.
    const sign = input.moveType === "out_invoice" || input.moveType === "in_refund" ? -1 : 1;
    const common = {
      companyId: books.companyId,
      partnerId: partner.id,
      currencyCode,
      icCompanyId: partner.icCompanyId ?? null,
    };
    const lines: NewLine[] = [];
    let companyTotal = dec(0);
    const push = (
      line: Omit<NewLine, "debit" | "credit" | "amountCurrency" | "companyId" | "currencyCode" | "moveId">,
      docAmount: Decimal,
    ) => {
      const signed = docAmount.times(sign);
      const companyAmount = toCompany(signed);
      companyTotal = companyTotal.plus(companyAmount);
      lines.push({
        ...common,
        ...line,
        ...sideOf(companyAmount, 2),
        amountCurrency: signed.toFixed(2),
      });
    };

    input.lines.forEach((l, i) => {
      push(
        {
          sequence: i,
          displayType: "product",
          accountId: lineAccounts[i]!.id,
          name: l.name,
          productId: l.productId ?? null,
          quantity: l.quantity,
          priceUnit: l.priceUnit,
          discount: l.discount,
          taxIds: l.taxIds,
          businessUnitId: l.businessUnitId ?? null,
          branchId: l.branchId ?? null,
        },
        dec(result.lines[i]!.subtotal),
      );
    });
    result.taxes.forEach((t, i) => {
      const tax = taxes.find((x) => x.id === t.taxId)!;
      if (dec(t.amount).isZero()) return;
      push(
        {
          sequence: input.lines.length + i,
          displayType: "tax",
          accountId: tax.accountId,
          name: tax.name,
          taxLineId: tax.id,
          taxBaseAmount: t.taxBase,
        },
        dec(t.amount),
      );
    });
    // Piutang/utang menyeimbangkan seluruh baris (selisih pembulatan kurs ikut di sini).
    const termBalance = companyTotal.negated();
    lines.push({
      ...common,
      sequence: 999,
      displayType: "payment_term",
      accountId: termAccountId,
      name: input.ref ?? null,
      ...sideOf(termBalance, 2),
      amountCurrency: dec(result.amountTotal).times(-sign).toFixed(2),
    });
    if (termBalance.isZero()) throw new BadRequestException("Total dokumen tidak boleh nol");

    return {
      header: {
        journalId,
        moveType: input.moveType,
        date: input.date,
        dueDate: input.dueDate ?? input.date,
        partnerId: partner.id,
        ref: input.ref ?? null,
        narration: input.narration ?? null,
        currencyCode,
        currencyRate: rate.toFixed(10),
        amountUntaxed: result.amountUntaxed,
        amountTax: result.amountTax,
        amountTotal: result.amountTotal,
      },
      lines,
    };
  }
}
