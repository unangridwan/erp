import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq, schema, type Db } from "@erp/db";
import type { paymentSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { FxService } from "../master/fx.controller.js";
import { assertCompanyJournal, assertPartner, fieldError, loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";
import { ReconcileService } from "./reconcile.service.js";

export type PaymentInput = z.infer<typeof paymentSchema>;

@Injectable()
export class PaymentService {
  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ReconcileService) private readonly reconcile: ReconcileService,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  /**
   * Catat & posting pembayaran (penerimaan: Dr kas/bank, Cr piutang; pengeluaran: Dr utang, Cr kas/bank),
   * lalu lunasi faktur/tagihan yang dipilih secara berurutan.
   */
  async register(tx: Db, input: PaymentInput) {
    const companyId = currentContext().companyId;
    const books = await loadBooks(tx, companyId);
    const journal = await assertCompanyJournal(tx, companyId, input.journalId, ["bank", "cash"]);
    if (!journal.defaultAccountId) throw fieldError("journalId", "Jurnal kas/bank belum punya akun");
    const partner = await assertPartner(tx, companyId, input.partnerId);
    const inbound = input.paymentType === "inbound";
    const counterpartAccountId = partner.icCompanyId
      ? inbound
        ? books.settings.icReceivableAccountId
        : books.settings.icPayableAccountId
      : inbound
        ? books.settings.receivableAccountId
        : books.settings.payableAccountId;

    const currencyCode = input.currencyCode ?? books.currencyCode;
    let amount = new Decimal(input.amount);
    if (currencyCode !== books.currencyCode) {
      const from = await this.fx.rateOn(tx, currencyCode, input.date);
      const to = await this.fx.rateOn(tx, books.currencyCode, input.date);
      amount = amount.times(from.rate).div(to.rate).toDecimalPlaces(books.decimals, Decimal.ROUND_HALF_UP);
    }

    const value = amount.toFixed(2);
    const memo = input.memo ?? (inbound ? "Penerimaan pembayaran" : "Pembayaran");
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: journal.id,
        date: input.date,
        ref: memo,
        lines: [
          {
            accountId: journal.defaultAccountId,
            name: memo,
            debit: inbound ? value : "0",
            credit: inbound ? "0" : value,
            partnerId: partner.id,
          },
          {
            accountId: counterpartAccountId,
            name: memo,
            debit: inbound ? "0" : value,
            credit: inbound ? value : "0",
            partnerId: partner.id,
          },
        ],
      },
      companyId,
    );
    const name = await this.moves.post(tx, moveId);
    const [payment] = await tx
      .insert(schema.payments)
      .values({
        companyId,
        journalId: journal.id,
        partnerId: partner.id,
        paymentType: input.paymentType,
        amount: input.amount,
        currencyCode,
        date: input.date,
        memo: input.memo ?? null,
        moveId,
      })
      .returning();

    const [paymentLine] = await tx
      .select({ id: schema.accountMoveLines.id })
      .from(schema.accountMoveLines)
      .where(
        and(
          eq(schema.accountMoveLines.moveId, moveId),
          eq(schema.accountMoveLines.accountId, counterpartAccountId),
        ),
      );

    for (const [i, invoiceId] of input.moveIds.entries()) {
      const [invoice] = await tx
        .select()
        .from(schema.accountMoves)
        .where(eq(schema.accountMoves.id, invoiceId));
      if (
        !invoice ||
        invoice.companyId !== companyId ||
        invoice.partnerId !== partner.id ||
        invoice.state !== "posted"
      ) {
        throw fieldError(
          `moveIds.${i}`,
          "Faktur/tagihan tidak ditemukan, belum diposting, atau partner berbeda",
        );
      }
      const expected = inbound ? ["out_invoice", "in_refund"] : ["in_invoice", "out_refund"];
      if (!expected.includes(invoice.moveType))
        throw fieldError(`moveIds.${i}`, "Jenis dokumen tidak sesuai arah pembayaran");
      const termLines = await tx
        .select({ id: schema.accountMoveLines.id })
        .from(schema.accountMoveLines)
        .where(
          and(
            eq(schema.accountMoveLines.moveId, invoiceId),
            eq(schema.accountMoveLines.displayType, "payment_term"),
            eq(schema.accountMoveLines.reconciled, false),
          ),
        );
      if (!termLines.length) continue;
      const residuals = await this.reconcile.reconcileLines(tx, [
        paymentLine!.id,
        ...termLines.map((l) => l.id),
      ]);
      if (new Decimal(residuals[paymentLine!.id]!).isZero()) break;
    }
    if (!paymentLine) throw new BadRequestException("Baris pembayaran tidak ditemukan");
    return { ...payment!, moveName: name };
  }
}
