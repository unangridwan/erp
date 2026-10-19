import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, lte, schema, sql, type Db } from "@erp/db";
import type { employeeLoanSchema, loanDisburseSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertCompanyJournal, fieldError } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { currentContext } from "../common/request-context.js";
import { EmployeeService } from "../hr/employee.service.js";

const L = schema.employeeLoans;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** Cicilan yang sudah dipotong lewat payroll yang diposting (baris slip bernilai negatif). */
const paidSql = sql<string>`coalesce((select -sum(pl.amount) from ${schema.payslipLines} pl
  join ${schema.payslips} s on s.id = pl.payslip_id
  join ${schema.payrollRuns} r on r.id = s.run_id
  where pl.loan_id = employee_loans.id and r.state in ('done', 'paid')), 0)::text`;

/**
 * Pinjaman karyawan: dicairkan lewat jurnal kas/bank (Dr Piutang Karyawan), lalu dicicil otomatis sebagai potongan
 * slip gaji mulai bulan yang ditentukan sampai lunas (Cr Piutang Karyawan saat payroll diposting).
 */
@Injectable()
export class LoanService {
  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async list(tx: Db, query: { employeeId?: string; state?: string }) {
    const rows = await tx
      .select({ loan: L, employeeName: schema.employees.name, paid: paidSql })
      .from(L)
      .innerJoin(schema.employees, eq(schema.employees.id, L.employeeId))
      .where(
        and(
          eq(L.companyId, currentContext().companyId),
          query.employeeId ? eq(L.employeeId, query.employeeId) : undefined,
          query.state ? eq(L.state, query.state as "running") : undefined,
        ),
      )
      .orderBy(desc(L.createdAt));
    return rows.map((r) => this.shape(r.loan, r.paid, r.employeeName));
  }

  async get(tx: Db, id: string) {
    const [row] = await tx
      .select({ loan: L, employeeName: schema.employees.name, paid: paidSql })
      .from(L)
      .innerJoin(schema.employees, eq(schema.employees.id, L.employeeId))
      .where(and(eq(L.id, id), eq(L.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Pinjaman tidak ditemukan");
    const installments = await tx
      .select({
        runId: schema.payrollRuns.id,
        runName: schema.payrollRuns.name,
        periodStart: schema.payrollRuns.periodStart,
        state: schema.payrollRuns.state,
        amount: sql<string>`(-${schema.payslipLines.amount})::text`,
      })
      .from(schema.payslipLines)
      .innerJoin(schema.payslips, eq(schema.payslips.id, schema.payslipLines.payslipId))
      .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .where(eq(schema.payslipLines.loanId, id))
      .orderBy(asc(schema.payrollRuns.periodStart));
    const [move] = row.loan.disbursementMoveId
      ? await tx
          .select({ id: schema.accountMoves.id, name: schema.accountMoves.name })
          .from(schema.accountMoves)
          .where(eq(schema.accountMoves.id, row.loan.disbursementMoveId))
      : [];
    return {
      ...this.shape(row.loan, row.paid, row.employeeName),
      installments,
      disbursementMove: move ?? null,
    };
  }

  async create(tx: Db, input: z.infer<typeof employeeLoanSchema>) {
    const employee = await this.employees.find(tx, input.employeeId);
    if (d(input.installment).gt(input.principal))
      throw fieldError("installment", "Cicilan melebihi pokok pinjaman");
    const [row] = await tx
      .insert(L)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        name: input.name,
        principal: input.principal,
        installment: input.installment,
        startPeriod: input.startPeriod,
        note: input.note ?? null,
        createdBy: currentContext().userId,
      })
      .returning();
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Pinjaman ${input.name} Rp${d(input.principal).toFixed(0)} dibuat`,
    });
    return this.get(tx, row!.id);
  }

  /** Cairkan: Dr Piutang Karyawan / Cr kas atau bank; pinjaman mulai dicicil. */
  async disburse(tx: Db, id: string, input: z.infer<typeof loanDisburseSchema>) {
    const loan = await this.find(tx, id);
    if (loan.state !== "draft") throw new BadRequestException("Hanya pinjaman draft yang bisa dicairkan");
    const [settings] = await tx
      .select()
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, loan.companyId));
    if (!settings?.employeeLoanAccountId)
      throw new BadRequestException("Akun piutang karyawan belum diatur di pengaturan payroll");
    const journal = await assertCompanyJournal(tx, loan.companyId, input.journalId, ["bank", "cash"]);
    if (!journal.defaultAccountId) throw fieldError("journalId", "Jurnal kas/bank belum punya akun");
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, loan.employeeId));
    const label = `Pinjaman ${employee!.name} — ${loan.name}`;
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: journal.id,
        date: input.date,
        ref: label,
        lines: [
          { accountId: settings.employeeLoanAccountId, name: label, debit: loan.principal, credit: "0" },
          { accountId: journal.defaultAccountId, name: label, debit: "0", credit: loan.principal },
        ],
      },
      loan.companyId,
    );
    await this.moves.post(tx, moveId);
    await tx
      .update(L)
      .set({
        state: "running",
        disbursementDate: input.date,
        disbursementMoveId: moveId,
        updatedAt: sql`now()`,
      })
      .where(eq(L.id, id));
    return this.get(tx, id);
  }

  /** Batalkan pinjaman yang belum dicicil (pencairan dibalik). */
  async cancel(tx: Db, id: string) {
    const loan = await this.get(tx, id);
    if (loan.state !== "draft" && loan.state !== "running")
      throw new BadRequestException("Pinjaman sudah selesai atau batal");
    if (loan.installments.length)
      throw new BadRequestException("Pinjaman sudah dicicil; tidak bisa dibatalkan");
    if (loan.disbursementMoveId) await this.moves.reverse(tx, loan.disbursementMoveId);
    await tx
      .update(L)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(L.id, id));
    return this.get(tx, id);
  }

  /** Potongan cicilan untuk payroll bulan `period` (YYYY-MM). */
  async deductionsFor(tx: Db, employeeId: string, period: string) {
    const loans = await tx
      .select({ loan: L, paid: paidSql })
      .from(L)
      .where(and(eq(L.employeeId, employeeId), eq(L.state, "running"), lte(L.startPeriod, period)))
      .orderBy(asc(L.createdAt));
    return loans.flatMap(({ loan, paid }) => {
      const remaining = d(loan.principal).minus(paid);
      const amount = Decimal.min(loan.installment, remaining);
      return amount.gt(0)
        ? [{ loanId: loan.id, name: `Cicilan ${loan.name}`, amount: amount.toFixed(0) }]
        : [];
    });
  }

  /** Setelah payroll diposting: pinjaman yang lunas ditutup. */
  async closePaid(tx: Db, loanIds: string[]) {
    if (!loanIds.length) return;
    const rows = await tx.select({ loan: L, paid: paidSql }).from(L).where(inArray(L.id, loanIds));
    for (const { loan, paid } of rows)
      if (d(paid).gte(loan.principal))
        await tx
          .update(L)
          .set({ state: "done", updatedAt: sql`now()` })
          .where(eq(L.id, loan.id));
  }

  private shape(loan: typeof L.$inferSelect, paid: string, employeeName: string) {
    const p = d(paid);
    return {
      ...loan,
      employeeName,
      paid: p.toFixed(2),
      remaining: Decimal.max(d(loan.principal).minus(p), 0).toFixed(2),
    };
  }

  private async find(tx: Db, id: string) {
    const [loan] = await tx
      .select()
      .from(L)
      .where(and(eq(L.id, id), eq(L.companyId, currentContext().companyId)))
      .for("update");
    if (!loan) throw new NotFoundException("Pinjaman tidak ditemukan");
    return loan;
  }
}
