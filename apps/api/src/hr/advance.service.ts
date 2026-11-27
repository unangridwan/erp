import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, schema, sql, type Db } from "@erp/db";
import {
  advanceSettlement,
  businessToday,
  hasPermission,
  type AdvanceInput,
  type advanceDisburseSchema,
  type advanceSettleSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { employeeCostCenters } from "../accounting/cost-center-source.js";
import { assertCompanyJournal, fieldError } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ApprovalEngineService } from "./approval-engine.service.js";
import { ApprovalGateService } from "./approval-gate.service.js";
import { EmployeeService } from "./employee.service.js";
import { ExpenseService } from "./expense.service.js";

const A = schema.employeeAdvances;
const C = schema.expenseClaims;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const rp = (v: Decimal.Value) => `Rp${d(v).toFixed(0)}`;

/**
 * Kasbon (uang muka karyawan): diajukan karyawan (portal) atau HR, disetujui lewat mesin persetujuan (kategori sistem
 * KASBON: atasan lalu penyetuju yang diatur), dicairkan ke akun Uang Muka Karyawan, lalu dipertanggungjawabkan dengan
 * klaim biaya. Penyelesaian membebankan klaim, membayar selisih bila klaim melebihi kasbon, dan sisa kasbon dikembalikan
 * tunai atau dipotong di payroll berikutnya.
 */
@Injectable()
export class AdvanceService implements OnModuleInit {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ApprovalGateService) private readonly gate: ApprovalGateService,
    @Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService,
    @Inject(ExpenseService) private readonly expenses: ExpenseService,
  ) {}

  onModuleInit() {
    // Keputusan persetujuan langsung memperbarui status kasbon (dalam transaksi keputusan).
    this.engine.onOutcome(async (tx, requestId, state) => {
      const [adv] = await tx
        .select()
        .from(A)
        .where(and(eq(A.approvalRequestId, requestId), eq(A.state, "confirm")));
      if (!adv) return;
      await tx
        .update(A)
        .set({
          state: state === "cancel" ? "draft" : state,
          approvalRequestId: state === "cancel" ? null : adv.approvalRequestId,
          updatedAt: sql`now()`,
        })
        .where(eq(A.id, adv.id));
      await this.log(
        tx,
        adv.employeeId,
        `Kasbon ${adv.name} ${state === "approved" ? "disetujui" : state === "refused" ? "ditolak" : "ditarik kembali"}`,
      );
    });
  }

  async list(tx: Db, query: { employeeId?: string; state?: string }) {
    const rows = await tx
      .select({ adv: A, employeeName: schema.employees.name, claimed: this.claimedSql() })
      .from(A)
      .innerJoin(schema.employees, eq(schema.employees.id, A.employeeId))
      .where(
        and(
          eq(A.companyId, currentContext().companyId),
          query.employeeId ? eq(A.employeeId, query.employeeId) : undefined,
          query.state === "open"
            ? inArray(A.state, ["confirm", "approved", "paid"])
            : query.state
              ? eq(A.state, query.state as "paid")
              : undefined,
        ),
      )
      .orderBy(desc(A.date), desc(A.createdAt));
    const today = businessToday();
    return rows.map((r) => this.shape(r.adv, r.employeeName, r.claimed, today));
  }

  async get(tx: Db, id: string) {
    const [row] = await tx
      .select({ adv: A, employeeName: schema.employees.name, claimed: this.claimedSql() })
      .from(A)
      .innerJoin(schema.employees, eq(schema.employees.id, A.employeeId))
      .where(and(eq(A.id, id), eq(A.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Kasbon tidak ditemukan");
    const claims = await tx
      .select({ id: C.id, name: C.name, date: C.date, state: C.state, total: C.total })
      .from(C)
      .where(eq(C.advanceId, id))
      .orderBy(C.date);
    const moveIds = [row.adv.disbursementMoveId, row.adv.settlementMoveId].filter((x): x is string => !!x);
    const moves = moveIds.length
      ? await tx
          .select({ id: schema.accountMoves.id, name: schema.accountMoves.name })
          .from(schema.accountMoves)
          .where(inArray(schema.accountMoves.id, moveIds))
      : [];
    const move = (mid: string | null) => moves.find((m) => m.id === mid) ?? null;
    const approved = claims
      .filter((c) => c.state === "approved" || c.state === "paid")
      .reduce((s, c) => s.plus(c.total), d(0));
    return {
      ...this.shape(row.adv, row.employeeName, row.claimed, businessToday()),
      claims,
      approval: await this.gate.summary(tx, row.adv.approvalRequestId),
      disbursementMove: move(row.adv.disbursementMoveId),
      settlementMove: move(row.adv.settlementMoveId),
      /** Pratinjau penyelesaian dari klaim yang sudah disetujui. */
      settlement: { claims: approved.toFixed(2), ...advanceSettlement(row.adv.amount, approved) },
    };
  }

  async create(tx: Db, input: AdvanceInput) {
    const employee = await this.employeeFor(tx, input.employeeId);
    const [overdue] = await tx
      .select({ name: A.name })
      .from(A)
      .where(
        and(
          eq(A.employeeId, employee.id),
          eq(A.state, "paid"),
          isNull(A.settlementDate),
          lt(A.settleBy, businessToday()),
        ),
      )
      .limit(1);
    if (overdue)
      throw new BadRequestException(
        `Kasbon ${overdue.name} sudah lewat batas pertanggungjawaban; selesaikan dulu sebelum mengajukan kasbon baru`,
      );
    const name = await this.sequences.next(
      tx,
      "hr.advance",
      employee.companyId,
      new Date(`${input.date}T00:00:00Z`),
      "KSB",
    );
    const [row] = await tx
      .insert(A)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        name,
        date: input.date,
        purpose: input.purpose,
        amount: input.amount,
        settleBy: input.settleBy,
        createdBy: currentContext().userId,
      })
      .returning();
    await this.log(tx, employee.id, `Kasbon ${name} ${rp(input.amount)} dibuat: ${input.purpose}`);
    return this.get(tx, row!.id);
  }

  async update(tx: Db, id: string, input: AdvanceInput) {
    const adv = await this.editable(tx, id);
    await tx
      .update(A)
      .set({
        date: input.date,
        purpose: input.purpose,
        amount: input.amount,
        settleBy: input.settleBy,
        updatedAt: sql`now()`,
      })
      .where(eq(A.id, adv.id));
    return this.get(tx, id);
  }

  /** Ajukan ke mesin persetujuan (atasan karyawan lebih dulu, lalu penyetuju kategori KASBON). */
  async submit(tx: Db, id: string) {
    const adv = await this.editable(tx, id);
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, adv.employeeId));
    const requestId = await this.gate.submit(tx, adv.companyId, "advance", {
      subject: `Kasbon ${employee!.name}: ${adv.purpose}`,
      reference: adv.name,
      date: adv.date,
      amount: d(adv.amount).toFixed(2),
      description: `${adv.purpose}\nBatas pertanggungjawaban: ${adv.settleBy}`,
      employeeId: adv.employeeId,
    });
    await tx
      .update(A)
      .set({ state: "confirm", approvalRequestId: requestId, updatedAt: sql`now()` })
      .where(eq(A.id, id));
    await this.log(tx, adv.employeeId, `Kasbon ${adv.name} ${rp(adv.amount)} diajukan`);
    return this.get(tx, id);
  }

  /** Batalkan sebelum dicairkan (permintaan persetujuan yang berjalan ditarik). */
  async cancel(tx: Db, id: string) {
    const adv = await this.find(tx, id, true);
    this.assertOwnerOrHr(adv.employeeId, await this.ownEmployeeId(tx));
    if (!["draft", "confirm", "approved"].includes(adv.state))
      throw new BadRequestException("Kasbon yang sudah dicairkan, selesai, atau batal tidak bisa dibatalkan");
    // Status kasbon diubah lebih dulu agar penarikan permintaan tidak mengembalikannya ke draft.
    await tx
      .update(A)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(A.id, id));
    await this.gate.withdraw(tx, adv.approvalRequestId);
    await this.log(tx, adv.employeeId, `Kasbon ${adv.name} dibatalkan`);
    return this.get(tx, id);
  }

  /** Cairkan kasbon yang disetujui: Dr Uang Muka Karyawan / Cr kas atau bank. */
  async disburse(tx: Db, id: string, input: z.infer<typeof advanceDisburseSchema>) {
    const adv = await this.find(tx, id, true);
    if (adv.state !== "approved")
      throw new BadRequestException("Hanya kasbon yang sudah disetujui bisa dicairkan");
    const account = await this.advanceAccount(tx, adv.companyId);
    const journal = await assertCompanyJournal(tx, adv.companyId, input.journalId, ["bank", "cash"]);
    if (!journal.defaultAccountId) throw fieldError("journalId", "Jurnal kas/bank belum punya akun");
    const employee = await this.employees.find(tx, adv.employeeId);
    const label = `Kasbon ${employee.name} — ${adv.name}`;
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: journal.id,
        date: input.date,
        ref: adv.name,
        lines: [
          { accountId: account, name: label, debit: d(adv.amount).toFixed(2), credit: "0" },
          { accountId: journal.defaultAccountId, name: label, debit: "0", credit: d(adv.amount).toFixed(2) },
        ],
      },
      adv.companyId,
    );
    await this.moves.post(tx, moveId);
    await tx
      .update(A)
      .set({ state: "paid", disbursementDate: input.date, disbursementMoveId: moveId, updatedAt: sql`now()` })
      .where(eq(A.id, id));
    await this.log(tx, adv.employeeId, `Kasbon ${adv.name} ${rp(adv.amount)} dicairkan`);
    return this.get(tx, id);
  }

  /**
   * Selesaikan kasbon dengan klaim pertanggungjawaban yang disetujui: Dr beban per kategori / Cr Uang Muka Karyawan;
   * klaim melebihi kasbon → selisih dibayar (Cr kas/bank); sisa kasbon → dikembalikan tunai (Dr kas/bank) atau
   * dipotong di payroll berikutnya.
   */
  async settle(tx: Db, id: string, input: z.infer<typeof advanceSettleSchema>) {
    const adv = await this.find(tx, id, true);
    if (adv.state !== "paid" || adv.settlementDate)
      throw new BadRequestException("Hanya kasbon yang sudah dicairkan & belum diselesaikan");
    if (adv.disbursementDate && input.date < adv.disbursementDate)
      throw fieldError("date", "Tanggal penyelesaian sebelum tanggal pencairan");
    const claims = await tx
      .select({ id: C.id, name: C.name, state: C.state, total: C.total })
      .from(C)
      .where(and(eq(C.advanceId, id), ne(C.state, "cancel"), ne(C.state, "refused")));
    const pending = claims.filter((c) => c.state === "draft" || c.state === "confirm");
    if (pending.length)
      throw new BadRequestException(
        `Klaim ${pending.map((c) => c.name).join(", ")} belum disetujui; selesaikan persetujuannya atau batalkan`,
      );
    const approved = claims.filter((c) => c.state === "approved");
    const total = approved.reduce((s, c) => s.plus(c.total), d(0));
    const s = advanceSettlement(adv.amount, total);
    const needsCash = d(s.payOut).gt(0) || (d(s.remainder).gt(0) && input.remainderMethod === "return");
    const account = await this.advanceAccount(tx, adv.companyId);
    const employee = await this.employees.find(tx, adv.employeeId);
    const label = `Penyelesaian kasbon ${employee.name} — ${adv.name}`;
    let cash: { id: string; account: string } | null = null;
    if (needsCash) {
      if (!input.journalId) throw fieldError("journalId", "Pilih jurnal kas/bank untuk selisih kasbon");
      const journal = await assertCompanyJournal(tx, adv.companyId, input.journalId, ["bank", "cash"]);
      if (!journal.defaultAccountId) throw fieldError("journalId", "Jurnal kas/bank belum punya akun");
      cash = { id: journal.id, account: journal.defaultAccountId };
    }
    const costCenter = (await employeeCostCenters(tx, [employee.id])).get(employee.id) ?? null;
    const dims = {
      branchId: employee.branchId,
      businessUnitId: employee.businessUnitId,
      costCenterId: costCenter,
    };
    const lines = [
      ...(
        await this.expenses.accountTotals(
          tx,
          approved.map((c) => c.id),
        )
      ).map((x) => ({
        accountId: x.accountId,
        name: label,
        debit: d(x.amount).toFixed(2),
        credit: "0",
        ...dims,
      })),
      ...(d(s.used).gt(0) ? [{ accountId: account, name: label, debit: "0", credit: s.used }] : []),
      ...(d(s.payOut).gt(0) ? [{ accountId: cash!.account, name: label, debit: "0", credit: s.payOut }] : []),
      ...(d(s.remainder).gt(0) && input.remainderMethod === "return"
        ? [
            { accountId: cash!.account, name: `${label} (pengembalian)`, debit: s.remainder, credit: "0" },
            { accountId: account, name: `${label} (pengembalian)`, debit: "0", credit: s.remainder },
          ]
        : []),
    ];
    let moveId: string | null = null;
    if (lines.length) {
      const journalId = cash?.id ?? (await this.payrollJournal(tx, adv.companyId));
      moveId = await this.moves.createEntry(
        tx,
        { journalId, date: input.date, ref: adv.name, lines },
        adv.companyId,
      );
      await this.moves.post(tx, moveId);
    }
    if (approved.length)
      await tx
        .update(C)
        .set({ state: "paid", moveId, updatedAt: sql`now()` })
        .where(
          inArray(
            C.id,
            approved.map((c) => c.id),
          ),
        );
    const viaPayslip = d(s.remainder).gt(0) && input.remainderMethod === "payslip";
    await tx
      .update(A)
      .set({
        state: viaPayslip ? "paid" : "settled",
        settlementDate: input.date,
        settlementMoveId: moveId,
        remainderMethod: d(s.remainder).gt(0) ? input.remainderMethod : null,
        remainder: s.remainder,
        updatedAt: sql`now()`,
      })
      .where(eq(A.id, id));
    await this.log(
      tx,
      adv.employeeId,
      `Kasbon ${adv.name} diselesaikan: klaim ${rp(total)}` +
        (d(s.payOut).gt(0) ? `, selisih ${rp(s.payOut)} dibayar ke karyawan` : "") +
        (d(s.remainder).gt(0)
          ? `, sisa ${rp(s.remainder)} ${viaPayslip ? "dipotong di payroll berikutnya" : "dikembalikan"}`
          : ""),
    );
    return this.get(tx, id);
  }

  /** Sisa kasbon yang dipotong di payroll (kasbon diselesaikan dengan metode slip & belum dipotong). */
  async deductionsFor(tx: Db, employeeId: string, periodEnd: string) {
    const rows = await tx
      .select({ id: A.id, name: A.name, remainder: A.remainder })
      .from(A)
      .where(
        and(
          eq(A.employeeId, employeeId),
          eq(A.state, "paid"),
          eq(A.remainderMethod, "payslip"),
          isNotNull(A.settlementDate),
          sql`${A.settlementDate} <= ${periodEnd}::date`,
          isNull(A.payslipId),
          gt(A.remainder, "0"),
        ),
      );
    return rows.map((r) => ({
      advanceId: r.id,
      name: `Sisa kasbon ${r.name}`,
      amount: d(r.remainder).toFixed(2),
    }));
  }

  /** Setelah payroll diposting: kasbon yang sisanya terpotong menjadi selesai. */
  async closeDeducted(tx: Db, lines: { advanceId: string; payslipId: string }[]) {
    for (const l of lines)
      await tx
        .update(A)
        .set({ state: "settled", payslipId: l.payslipId, updatedAt: sql`now()` })
        .where(and(eq(A.id, l.advanceId), eq(A.state, "paid")));
  }

  /** Akun Uang Muka Karyawan (kasbon); bawaan akun piutang karyawan. */
  async advanceAccount(tx: Db, companyId: string) {
    const [s] = await tx
      .select({
        advance: schema.payrollSettings.employeeAdvanceAccountId,
        loan: schema.payrollSettings.employeeLoanAccountId,
      })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    const account = s?.advance ?? s?.loan;
    if (!account) throw new BadRequestException("Akun uang muka karyawan belum diatur di pengaturan payroll");
    return account;
  }

  /** Klaim pertanggungjawaban: kasbon milik karyawan yang sama, sudah dicairkan, dan belum diselesaikan. */
  async assertClaimable(tx: Db, advanceId: string, employeeId: string) {
    const [adv] = await tx.select().from(A).where(eq(A.id, advanceId));
    if (!adv || adv.employeeId !== employeeId)
      throw fieldError("advanceId", "Kasbon tidak ditemukan untuk karyawan ini");
    if (adv.state !== "paid" || adv.settlementDate)
      throw fieldError("advanceId", "Kasbon belum dicairkan atau sudah diselesaikan");
  }

  /** Boleh melihat: pemegang hr.read/payroll.read atau karyawan pemilik. */
  async assertCanSee(tx: Db, id: string) {
    const ctx = currentContext();
    if (hasPermission(ctx.permissions, "hr.read") || hasPermission(ctx.permissions, "payroll.read")) return;
    const adv = await this.find(tx, id);
    if (adv.employeeId === (await this.ownEmployeeId(tx))) return;
    throw new ForbiddenException("Butuh permission hr.read");
  }

  async ownEmployeeId(tx: Db) {
    return this.employees.mine(tx).then(
      (e) => e.id,
      () => null,
    );
  }

  private claimedSql() {
    return sql<string>`coalesce((select sum(c.total) from ${C} c where c.advance_id = ${A.id}
      and c.state in ('confirm', 'approved', 'paid')), 0)::text`;
  }

  private shape(adv: typeof A.$inferSelect, employeeName: string, claimed: string, today: string) {
    return {
      ...adv,
      employeeName,
      claimed: d(claimed).toFixed(2),
      /** Menunggu dipotong di payroll berikutnya. */
      awaitingPayslip: adv.state === "paid" && adv.remainderMethod === "payslip" && !adv.payslipId,
      overdue: adv.state === "paid" && !adv.settlementDate && adv.settleBy < today,
    };
  }

  private async payrollJournal(tx: Db, companyId: string) {
    const [s] = await tx
      .select({ journalId: schema.payrollSettings.journalId })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    if (!s?.journalId) throw new BadRequestException("Jurnal payroll belum diatur di pengaturan payroll");
    return s.journalId;
  }

  private assertOwnerOrHr(employeeId: string, own: string | null) {
    if (employeeId === own) return;
    if (!hasPermission(currentContext().permissions, "hr.write"))
      throw new ForbiddenException("Butuh permission hr.write");
  }

  private async employeeFor(tx: Db, employeeId?: string) {
    const own = await this.ownEmployeeId(tx);
    if (!employeeId || employeeId === own) {
      if (!own) throw fieldError("employeeId", "Pilih karyawan");
      return this.employees.find(tx, own);
    }
    this.assertOwnerOrHr(employeeId, own);
    return this.employees.find(tx, employeeId);
  }

  private async editable(tx: Db, id: string) {
    const adv = await this.find(tx, id, true);
    this.assertOwnerOrHr(adv.employeeId, await this.ownEmployeeId(tx));
    if (adv.state !== "draft")
      throw new BadRequestException("Hanya kasbon draft yang bisa diubah atau diajukan");
    return adv;
  }

  private async find(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(A)
      .where(and(eq(A.id, id), eq(A.companyId, currentContext().companyId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundException("Kasbon tidak ditemukan");
    return row;
  }

  private log(tx: Db, employeeId: string, message: string) {
    return this.activity.log(tx, { resModel: "employee", resId: employeeId, action: "comment", message });
  }
}
