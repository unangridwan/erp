import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, ne, schema, sql, type Db } from "@erp/db";
import {
  BANK_FORMATS,
  bankTransferFile,
  groupRunLines,
  lineAmountError,
  PARTNER_BANK_LABEL,
  partnerBankAccountSchema,
  paymentRunCreateSchema,
  paymentRunUpdateSchema,
  type TransferRow,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { Response } from "express";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ApprovalEngineService } from "../hr/approval-engine.service.js";
import { HrModule } from "../hr/hr.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { AccountingModule } from "./accounting.module.js";
import { assertCompanyJournal, fieldError, loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";
import { PaymentService } from "./payment.service.js";
import { ReconcileService } from "./reconcile.service.js";

const RUN = schema.paymentRuns;
const LINE = schema.paymentRunLines;
const BANK = schema.partnerBankAccounts;
const M = schema.accountMoves;
const REQ = schema.approvalRequests;
const CAT = schema.approvalCategories;
const CATEGORY = {
  code: "PAYRUN",
  name: "Pembayaran Pemasok",
  prefix: "PAY",
  description: "Persetujuan payment run: daftar tagihan pemasok yang akan dibayar dan totalnya.",
  fields: { amount: "required", description: "required" } as const,
};
type Run = typeof RUN.$inferSelect;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

@Injectable()
export class PaymentRunService {
  constructor(
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(PaymentService) private readonly payments: PaymentService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ReconcileService) private readonly reconcile: ReconcileService,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
  ) {}

  // ---- Rekening bank kontak ----

  private async partner(tx: Db, id: string) {
    const [p] = await tx
      .select({ id: schema.partners.id, name: schema.partners.name })
      .from(schema.partners)
      .where(eq(schema.partners.id, id));
    if (!p) throw new NotFoundException("Kontak tidak ditemukan");
    return p;
  }

  async bankAccounts(tx: Db, partnerId: string) {
    await this.partner(tx, partnerId);
    return tx
      .select()
      .from(BANK)
      .where(eq(BANK.partnerId, partnerId))
      .orderBy(desc(BANK.isDefault), desc(BANK.active), asc(BANK.bankName));
  }

  async saveBankAccount(tx: Db, partnerId: string, body: unknown, id?: string) {
    await this.partner(tx, partnerId);
    const input = parse(partnerBankAccountSchema, body);
    if (id) {
      const [row] = await tx
        .select({ id: BANK.id })
        .from(BANK)
        .where(and(eq(BANK.id, id), eq(BANK.partnerId, partnerId)));
      if (!row) throw new NotFoundException("Rekening tidak ditemukan");
    }
    const [dup] = await tx
      .select({ id: BANK.id })
      .from(BANK)
      .where(
        and(
          eq(BANK.partnerId, partnerId),
          eq(BANK.accountNumber, input.accountNumber),
          id ? ne(BANK.id, id) : undefined,
        ),
      );
    if (dup) throw fieldError("accountNumber", "Nomor rekening sudah terdaftar untuk kontak ini");
    const existing = await tx
      .select({ id: BANK.id })
      .from(BANK)
      .where(and(eq(BANK.partnerId, partnerId), eq(BANK.active, true), eq(BANK.isDefault, true)));
    // Rekening pertama otomatis menjadi utama.
    const isDefault = input.active && (input.isDefault || !existing.some((e) => e.id !== id));
    if (isDefault)
      await tx
        .update(BANK)
        .set({ isDefault: false })
        .where(and(eq(BANK.partnerId, partnerId), id ? ne(BANK.id, id) : undefined));
    const values = { ...input, bankIdentifier: input.bankIdentifier ?? null, isDefault };
    if (id) {
      await tx
        .update(BANK)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(BANK.id, id));
    } else {
      await tx.insert(BANK).values({ partnerId, ...values });
    }
    return this.bankAccounts(tx, partnerId);
  }

  async deleteBankAccount(tx: Db, partnerId: string, id: string) {
    const [used] = await tx.select({ id: LINE.id }).from(LINE).where(eq(LINE.bankAccountId, id)).limit(1);
    if (used) throw new BadRequestException("Rekening sudah dipakai payment run; nonaktifkan saja");
    await tx.delete(BANK).where(and(eq(BANK.id, id), eq(BANK.partnerId, partnerId)));
  }

  // ---- Payment run ----

  private async find(tx: Db, id: string): Promise<Run> {
    const [run] = await tx
      .select()
      .from(RUN)
      .where(and(eq(RUN.id, id), eq(RUN.companyId, currentContext().companyId)));
    if (!run) throw new NotFoundException("Payment run tidak ditemukan");
    return this.sync(tx, run);
  }

  /** Status mengikuti permintaan persetujuan: disetujui → approved; ditolak/dibatalkan → kembali draft. */
  private async sync(tx: Db, run: Run): Promise<Run> {
    if (run.state !== "in_approval" || !run.approvalRequestId) return run;
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, run.approvalRequestId));
    const next =
      req?.state === "approved"
        ? "approved"
        : req?.state === "refused" || req?.state === "cancel"
          ? "draft"
          : null;
    if (!next) return run;
    const [row] = await tx
      .update(RUN)
      .set({ state: next, ...(next === "draft" ? { approvalRequestId: null } : {}), updatedAt: sql`now()` })
      .where(eq(RUN.id, run.id))
      .returning();
    return row!;
  }

  /** Tagihan pemasok terbuka (posted, sisa > 0, mata uang perusahaan) yang belum ada di run aktif lain. */
  private async openBills(
    tx: Db,
    companyId: string,
    opts: { dueUntil?: string; moveIds?: string[] },
    runId?: string,
  ) {
    const books = await loadBooks(tx, companyId);
    return tx
      .select({
        id: M.id,
        name: M.name,
        partnerId: M.partnerId,
        date: M.date,
        dueDate: M.dueDate,
        ref: M.ref,
        residual: M.amountResidual,
        total: M.amountTotal,
        currencyCode: M.currencyCode,
      })
      .from(M)
      .where(
        and(
          eq(M.companyId, companyId),
          eq(M.moveType, "in_invoice"),
          eq(M.state, "posted"),
          sql`${M.amountResidual} > 0`,
          eq(M.currencyCode, books.currencyCode),
          opts.dueUntil ? sql`coalesce(${M.dueDate}, ${M.date}) <= ${opts.dueUntil}` : undefined,
          opts.moveIds ? inArray(M.id, opts.moveIds) : undefined,
          sql`not exists (
            select 1 from payment_run_lines l join payment_runs r on r.id = l.run_id
            where l.move_id = ${M.id} and l.included and l.state = 'pending'
              and r.state in ('draft', 'in_approval', 'approved')
              ${runId ? sql`and r.id <> ${runId}` : sql``})`,
        ),
      )
      .orderBy(asc(sql`coalesce(${M.dueDate}, ${M.date})`), asc(M.name));
  }

  async list(tx: Db) {
    const companyId = currentContext().companyId;
    const runs = await tx
      .select()
      .from(RUN)
      .where(eq(RUN.companyId, companyId))
      .orderBy(desc(RUN.createdAt))
      .limit(500);
    const out = [];
    for (const r of runs) {
      const run = await this.sync(tx, r);
      const [agg] = await tx
        .select({
          total: sql<string>`coalesce(sum(${LINE.amount}) filter (where ${LINE.included}), 0)::text`,
          vendors: sql<number>`count(distinct ${LINE.partnerId}) filter (where ${LINE.included})::int`,
          bills: sql<number>`count(*) filter (where ${LINE.included})::int`,
        })
        .from(LINE)
        .where(eq(LINE.runId, run.id));
      out.push({
        ...run,
        total: d(agg?.total).toFixed(2),
        vendors: agg?.vendors ?? 0,
        bills: agg?.bills ?? 0,
      });
    }
    return out;
  }

  async create(tx: Db, body: unknown) {
    const input = parse(paymentRunCreateSchema, body);
    const companyId = currentContext().companyId;
    await assertCompanyJournal(tx, companyId, input.journalId, ["bank"]);
    const bills = (await this.openBills(tx, companyId, { dueUntil: input.dueUntil })).filter(
      (b) => !input.partnerIds?.length || (b.partnerId && input.partnerIds.includes(b.partnerId)),
    );
    if (!bills.length)
      throw new BadRequestException("Tidak ada tagihan pemasok terbuka yang jatuh tempo sampai tanggal itu");
    const name = await this.sequences.next(
      tx,
      "payment.run",
      companyId,
      new Date(`${input.paymentDate}T12:00:00`),
      "PAYRUN",
    );
    const [run] = await tx
      .insert(RUN)
      .values({
        companyId,
        name,
        paymentDate: input.paymentDate,
        dueUntil: input.dueUntil,
        journalId: input.journalId,
        note: input.note ?? null,
        createdBy: currentContext().userId,
      })
      .returning({ id: RUN.id });
    const partnerIds = [...new Set(bills.map((b) => b.partnerId!))];
    const banks = await tx
      .select({ id: BANK.id, partnerId: BANK.partnerId })
      .from(BANK)
      .where(and(inArray(BANK.partnerId, partnerIds), eq(BANK.active, true), eq(BANK.isDefault, true)));
    const bankOf = new Map(banks.map((b) => [b.partnerId, b.id]));
    await tx.insert(LINE).values(
      bills.map((b) => ({
        runId: run!.id,
        partnerId: b.partnerId!,
        bankAccountId: bankOf.get(b.partnerId!) ?? null,
        moveId: b.id,
        amount: d(b.residual).toFixed(2),
      })),
    );
    return this.detail(tx, run!.id);
  }

  async detail(tx: Db, id: string) {
    const run = await this.find(tx, id);
    const lines = await tx
      .select({
        id: LINE.id,
        partnerId: LINE.partnerId,
        partnerName: schema.partners.name,
        bankAccountId: LINE.bankAccountId,
        moveId: LINE.moveId,
        moveName: M.name,
        ref: M.ref,
        date: M.date,
        dueDate: M.dueDate,
        residual: M.amountResidual,
        moveTotal: M.amountTotal,
        amount: LINE.amount,
        included: LINE.included,
        state: LINE.state,
        paymentId: LINE.paymentId,
        error: LINE.error,
      })
      .from(LINE)
      .innerJoin(M, eq(M.id, LINE.moveId))
      .innerJoin(schema.partners, eq(schema.partners.id, LINE.partnerId))
      .where(eq(LINE.runId, id))
      .orderBy(asc(schema.partners.name), asc(sql`coalesce(${M.dueDate}, ${M.date})`), asc(M.name));
    const partnerIds = [...new Set(lines.map((l) => l.partnerId))];
    const banks = partnerIds.length
      ? await tx.select().from(BANK).where(inArray(BANK.partnerId, partnerIds)).orderBy(desc(BANK.isDefault))
      : [];
    const [journal] = await tx.select().from(schema.journals).where(eq(schema.journals.id, run.journalId));
    const [request] = run.approvalRequestId
      ? await tx
          .select({ id: REQ.id, number: REQ.number, state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, run.approvalRequestId))
      : [];
    const groups = groupRunLines(lines).map((g) => {
      const bank = banks.find((b) => b.id === g.bankAccountId) ?? null;
      return {
        partnerId: g.partnerId,
        partnerName: g.lines[0]!.partnerName,
        bankAccount: bank,
        bills: g.lines.length,
        total: g.total.toFixed(2),
        state: g.lines.every((l) => l.state === "paid")
          ? "paid"
          : g.lines.some((l) => l.state === "failed")
            ? "failed"
            : "pending",
      };
    });
    const total = groups.reduce((s, g) => s.plus(g.total), d(0));
    return {
      ...run,
      journal: journal
        ? {
            id: journal.id,
            code: journal.code,
            name: journal.name,
            bankAccountNumber: journal.bankAccountNumber,
          }
        : null,
      approvalRequest: request ?? null,
      total: total.toFixed(2),
      lines: lines.map((l) => ({
        ...l,
        banks: banks.filter((b) => b.partnerId === l.partnerId && b.active),
      })),
      groups,
      warnings: groups
        .filter((g) => !g.bankAccount)
        .map(
          (g) => `${g.partnerName}: belum ada rekening bank (bayar manual atau tambahkan rekening di kontak)`,
        ),
    };
  }

  async update(tx: Db, id: string, body: unknown) {
    const run = await this.find(tx, id);
    if (run.state !== "draft") throw new BadRequestException("Hanya payment run draft yang bisa diubah");
    const input = parse(paymentRunUpdateSchema, body);
    if (input.journalId) await assertCompanyJournal(tx, run.companyId, input.journalId, ["bank"]);
    const current = await tx
      .select({ id: LINE.id, partnerId: LINE.partnerId, residual: M.amountResidual })
      .from(LINE)
      .innerJoin(M, eq(M.id, LINE.moveId))
      .where(eq(LINE.runId, id));
    for (const [i, l] of input.lines.entries()) {
      const line = current.find((c) => c.id === l.id);
      if (!line) throw fieldError(`lines.${i}.id`, "Baris tidak ditemukan di payment run ini");
      if (l.amount !== undefined) {
        const err = lineAmountError(l.amount, line.residual);
        if (err) throw fieldError(`lines.${i}.amount`, err);
      }
      if (l.bankAccountId) {
        const [bank] = await tx
          .select({ id: BANK.id })
          .from(BANK)
          .where(
            and(eq(BANK.id, l.bankAccountId), eq(BANK.partnerId, line.partnerId), eq(BANK.active, true)),
          );
        if (!bank)
          throw fieldError(`lines.${i}.bankAccountId`, "Rekening bukan milik pemasok ini atau tidak aktif");
      }
      await tx
        .update(LINE)
        .set({
          ...(l.included !== undefined ? { included: l.included } : {}),
          ...(l.amount !== undefined ? { amount: l.amount } : {}),
          ...(l.bankAccountId !== undefined ? { bankAccountId: l.bankAccountId ?? null } : {}),
        })
        .where(eq(LINE.id, l.id));
    }
    await tx
      .update(RUN)
      .set({
        ...(input.paymentDate ? { paymentDate: input.paymentDate } : {}),
        ...(input.journalId ? { journalId: input.journalId } : {}),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(RUN.id, id));
    return this.detail(tx, id);
  }

  async submit(tx: Db, id: string) {
    const run = await this.find(tx, id);
    if (run.state !== "draft") throw new BadRequestException("Payment run sudah diajukan");
    const detail = await this.detail(tx, id);
    if (!detail.groups.length) throw new BadRequestException("Tidak ada tagihan yang diikutkan");
    const categoryId = await this.category(tx, run.companyId);
    const bills = detail.lines.filter((l) => l.included).length;
    const request = await this.approvals.createRequest(tx, {
      categoryId,
      subject: `Payment run ${run.name}`,
      reference: run.name,
      location: null,
      contact: null,
      date: run.paymentDate,
      quantity: String(bills),
      amount: detail.total,
      description: [
        `Tanggal bayar ${run.paymentDate} dari ${detail.journal?.name ?? "jurnal bank"}; ${detail.groups.length} pemasok, ${bills} tagihan.`,
        ...detail.groups.map((g) => `- ${g.partnerName}: Rp ${g.total} (${g.bills} tagihan)`),
        ...detail.warnings,
      ]
        .join("\n")
        .slice(0, 5000),
    });
    await this.approvals.submit(tx, request.id);
    await tx
      .update(RUN)
      .set({ state: "in_approval", approvalRequestId: request.id, updatedAt: sql`now()` })
      .where(eq(RUN.id, id));
    return this.detail(tx, id);
  }

  async cancel(tx: Db, id: string) {
    const run = await this.find(tx, id);
    if (run.state === "done" || run.state === "cancel")
      throw new BadRequestException(
        "Payment run yang sudah dieksekusi atau dibatalkan tidak bisa dibatalkan",
      );
    if (run.approvalRequestId && run.state === "in_approval")
      await this.approvals.cancel(tx, run.approvalRequestId).catch(() => undefined);
    await tx
      .update(RUN)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(RUN.id, id));
    return this.detail(tx, id);
  }

  /**
   * Eksekusi run yang disetujui: per pemasok satu pembayaran (Dr utang / Cr bank) yang melunasi tagihannya;
   * pelunasan sebagian dicatat sebagai pembayaran terpisah per tagihan. Tagihan yang berubah sejak diusulkan
   * (sudah lunas/sisa berkurang) ditandai gagal dan tidak dibayar.
   */
  async execute(tx: Db, id: string) {
    const run = await this.find(tx, id);
    if (run.state !== "approved")
      throw new BadRequestException("Payment run harus disetujui sebelum dieksekusi");
    const lines = await tx
      .select({
        id: LINE.id,
        partnerId: LINE.partnerId,
        bankAccountId: LINE.bankAccountId,
        moveId: LINE.moveId,
        amount: LINE.amount,
        included: LINE.included,
        residual: M.amountResidual,
        moveState: M.state,
      })
      .from(LINE)
      .innerJoin(M, eq(M.id, LINE.moveId))
      .where(and(eq(LINE.runId, id), eq(LINE.state, "pending")));
    for (const group of groupRunLines(lines)) {
      const valid = [];
      for (const l of group.lines) {
        if (l.moveState !== "posted" || d(l.residual).lt(l.amount)) {
          await tx
            .update(LINE)
            .set({
              state: "failed",
              error: "Sisa tagihan berubah sejak disetujui (sudah dibayar/dibatalkan)",
            })
            .where(eq(LINE.id, l.id));
        } else valid.push(l);
      }
      // Tagihan dibayar penuh digabung dalam satu pembayaran; yang dibayar sebagian masing-masing terpisah
      // agar pelunasan berurutan tidak menghabiskan sisa ke tagihan yang salah.
      const full = valid.filter((l) => d(l.amount).equals(l.residual));
      const partial = valid.filter((l) => !d(l.amount).equals(l.residual));
      const batches = [...(full.length ? [full] : []), ...partial.map((l) => [l])];
      for (const batch of batches) {
        const amount = batch.reduce((s, l) => s.plus(l.amount), d(0));
        const payment = await this.payments.register(tx, {
          paymentType: "outbound",
          partnerId: group.partnerId,
          journalId: run.journalId,
          amount: amount.toFixed(2),
          date: run.paymentDate,
          memo: run.name,
          moveIds: batch.map((l) => l.moveId),
        });
        await tx
          .update(LINE)
          .set({ state: "paid", paymentId: payment.id, error: null })
          .where(
            inArray(
              LINE.id,
              batch.map((l) => l.id),
            ),
          );
      }
    }
    await tx
      .update(RUN)
      .set({
        state: "done",
        executedAt: sql`now()`,
        executedBy: currentContext().userId,
        updatedAt: sql`now()`,
      })
      .where(eq(RUN.id, id));
    return this.detail(tx, id);
  }

  /** Transfer ke pemasok gagal: lepas pelunasan, balik pembayarannya, tagihan terbuka kembali. */
  async failPartner(tx: Db, id: string, partnerId: string, reason?: string) {
    const run = await this.find(tx, id);
    if (run.state !== "done") throw new BadRequestException("Payment run belum dieksekusi");
    const lines = await tx
      .select({ id: LINE.id, paymentId: LINE.paymentId })
      .from(LINE)
      .where(and(eq(LINE.runId, id), eq(LINE.partnerId, partnerId), eq(LINE.state, "paid")));
    if (!lines.length)
      throw new BadRequestException("Tidak ada pembayaran terposting untuk pemasok ini di run ini");
    const paymentIds = [...new Set(lines.map((l) => l.paymentId!).filter(Boolean))];
    const payments = await tx
      .select({ id: schema.payments.id, moveId: schema.payments.moveId })
      .from(schema.payments)
      .where(inArray(schema.payments.id, paymentIds));
    for (const p of payments) {
      await this.reconcile.unreconcileMove(tx, p.moveId);
      await this.moves.reverse(tx, p.moveId, run.paymentDate);
    }
    await tx
      .update(LINE)
      .set({ state: "failed", error: reason?.slice(0, 300) || "Transfer gagal" })
      .where(
        inArray(
          LINE.id,
          lines.map((l) => l.id),
        ),
      );
    return this.detail(tx, id);
  }

  /** File transfer massal per bank (sesama bank) atau CSV semua; pemasok lain/tanpa rekening dilewati. */
  async bankFile(tx: Db, id: string, format: (typeof BANK_FORMATS)[number]) {
    const detail = await this.detail(tx, id);
    if (detail.state !== "approved" && detail.state !== "done")
      throw new BadRequestException("File bank tersedia setelah payment run disetujui");
    if (format !== "csv" && !detail.journal?.bankAccountNumber)
      throw new BadRequestException("Nomor rekening perusahaan belum diisi di jurnal bank ini");
    const [journal] = await tx.select().from(schema.journals).where(eq(schema.journals.id, detail.journalId));
    const rows: TransferRow[] = detail.groups
      .filter((g) => g.state !== "failed")
      .map((g) => ({
        employeeNumber: detail.name,
        name: g.partnerName,
        bankName: g.bankAccount
          ? g.bankAccount.bankCode === "other"
            ? g.bankAccount.bankName
            : PARTNER_BANK_LABEL[g.bankAccount.bankCode]
          : "",
        bankAccount: g.bankAccount?.accountNumber ?? "",
        bankAccountName: g.bankAccount?.accountHolder ?? g.partnerName,
        amount: g.total,
      }));
    return bankTransferFile(
      format,
      {
        sourceAccount: journal?.bankAccountNumber ?? "",
        companyCode: journal?.bankCompanyCode ?? null,
        date: detail.paymentDate,
        remark: `BAYAR ${detail.name}`,
      },
      rows,
      {
        filePrefix: `pembayaran-${detail.name.replace(/[^\w-]+/g, "-")}`,
        referenceLabel: "Referensi",
        zeroReason: "Jumlah nol",
      },
    );
  }

  private async category(tx: Db, companyId: string) {
    const [found] = await tx
      .select({ id: CAT.id })
      .from(CAT)
      .where(and(eq(CAT.companyId, companyId), eq(CAT.code, CATEGORY.code)));
    if (found) return found.id;
    await this.approvals.ensureDefaults(tx, companyId);
    const [created] = await tx
      .insert(CAT)
      .values({ ...CATEGORY, companyId, managerFirst: false, sequence: 910 })
      .returning({ id: CAT.id });
    return created!.id;
  }
}

const failSchema = z.object({ partnerId: z.string().uuid(), reason: z.string().trim().max(300).nullish() });

@Controller()
export class PaymentRunController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PaymentRunService) private readonly service: PaymentRunService,
  ) {}

  @Get("partners/:id/bank-accounts")
  @RequirePermission("accounting.read")
  bankAccounts(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.bankAccounts(tx, id));
  }

  @Post("partners/:id/bank-accounts")
  @RequirePermission("accounting.manage")
  addBankAccount(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.saveBankAccount(tx, id, body));
  }

  @Put("partners/:id/bank-accounts/:accountId")
  @RequirePermission("accounting.manage")
  updateBankAccount(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Body() body: unknown,
  ) {
    return this.tenantDb.run((tx) => this.service.saveBankAccount(tx, id, body, accountId));
  }

  @Delete("partners/:id/bank-accounts/:accountId")
  @HttpCode(204)
  @RequirePermission("accounting.manage")
  async deleteBankAccount(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
  ) {
    await this.tenantDb.run((tx) => this.service.deleteBankAccount(tx, id, accountId));
  }

  @Get("payment-runs")
  @RequirePermission("accounting.read")
  list() {
    return this.tenantDb.run((tx) => this.service.list(tx));
  }

  @Post("payment-runs")
  @RequirePermission("accounting.write")
  create(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.create(tx, body));
  }

  @Get("payment-runs/:id")
  @RequirePermission("accounting.read")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.detail(tx, id));
  }

  @Put("payment-runs/:id")
  @RequirePermission("accounting.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.update(tx, id, body));
  }

  @Post("payment-runs/:id/submit")
  @HttpCode(200)
  @RequirePermission("accounting.write")
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.submit(tx, id));
  }

  @Post("payment-runs/:id/cancel")
  @HttpCode(200)
  @RequirePermission("accounting.write")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.cancel(tx, id));
  }

  @Post("payment-runs/:id/execute")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  execute(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.execute(tx, id));
  }

  @Post("payment-runs/:id/fail")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  fail(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(failSchema, body);
    return this.tenantDb.run((tx) =>
      this.service.failPartner(tx, id, input.partnerId, input.reason ?? undefined),
    );
  }

  @Get("payment-runs/:id/bank-file")
  @RequirePermission("accounting.read")
  async bankFile(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("format") format: string,
    @Query("info") info: string | undefined,
    @Res() res: Response,
  ) {
    const kind = parse(z.enum(BANK_FORMATS), format);
    const file = await this.tenantDb.run((tx) => this.service.bankFile(tx, id, kind));
    if (info)
      return res.json({
        filename: file.filename,
        count: file.count,
        total: file.total,
        skipped: file.skipped,
      });
    res
      .type(file.contentType)
      .attachment(file.filename)
      .setHeader("X-Transfer-Count", String(file.count))
      .setHeader("X-Transfer-Total", file.total)
      .setHeader("X-Transfer-Skipped", String(file.skipped.length))
      .send(kind === "csv" ? "\uFEFF" + file.content : file.content);
  }
}

@Module({
  imports: [AccountingModule, HrModule],
  controllers: [PaymentRunController],
  providers: [PaymentRunService, SequenceService],
})
export class PaymentRunModule {}
