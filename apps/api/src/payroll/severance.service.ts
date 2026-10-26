import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { severance, type severanceInputSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { MoveService } from "../accounting/move.service.js";
import { currentContext } from "../common/request-context.js";
import { EmployeeService } from "../hr/employee.service.js";
import { LeaveService } from "../hr/leave.service.js";

type Input = z.infer<typeof severanceInputSchema>;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/**
 * Hak akhir hubungan kerja (PP 35/2021): uang pesangon, UPMK, uang penggantian hak, uang pisah / kompensasi PKWT,
 * dengan PPh 21 final pesangon. Disimpan & dijurnal: Dr beban gaji, Cr utang PPh 21, Cr utang gaji.
 */
@Injectable()
export class SeveranceService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(LeaveService) private readonly leaves: LeaveService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async preview(tx: Db, employeeId: string, input: Input) {
    const employee = await this.employees.find(tx, employeeId);
    if (input.endDate < employee.joinDate)
      throw new BadRequestException("Tanggal berakhir sebelum tanggal masuk");
    const monthlyWage = await this.monthlyWage(tx, employee);
    const unusedLeaveDays =
      input.unusedLeaveDays ??
      (await this.leaves.balances(tx, employee.id, input.endDate))
        .filter((b) => /tahunan/i.test(b.leaveTypeName))
        .reduce((s, b) => s.plus(Decimal.max(d(b.remaining), 0)), d(0))
        .toNumber();
    const result = severance({
      reason: input.reason,
      joinDate: employee.joinDate,
      endDate: input.endDate,
      monthlyWage,
      unusedLeaveDays,
      otherRights: input.otherRights,
      separationPay: input.separationPay,
    });
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      joinDate: employee.joinDate,
      endDate: input.endDate,
      monthlyWage: monthlyWage.toFixed(2),
      unusedLeaveDays: String(unusedLeaveDays),
      ...result,
    };
  }

  /** Simpan & jurnal hak akhir; tanggal berhenti karyawan diisi bila belum ada. */
  async create(tx: Db, employeeId: string, input: Input) {
    const p = await this.preview(tx, employeeId, input);
    const employee = await this.employees.find(tx, employeeId);
    const [settings] = await tx
      .select()
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, employee.companyId));
    if (!settings) throw new BadRequestException("Payroll belum disiapkan");
    if (d(p.gross).lte(0)) throw new BadRequestException("Tidak ada hak akhir yang perlu dibayar");
    const label = `Hak akhir ${employee.name} (${p.article})`;
    const lines = [
      { accountId: settings.salaryExpenseAccountId, name: label, debit: d(p.gross).toFixed(2), credit: "0" },
      { accountId: settings.salaryPayableAccountId, name: label, debit: "0", credit: d(p.net).toFixed(2) },
    ];
    if (d(p.tax).gt(0))
      lines.push({
        accountId: settings.pph21PayableAccountId,
        name: label,
        debit: "0",
        credit: d(p.tax).toFixed(2),
      });
    const moveId = await this.moves.createEntry(
      tx,
      { journalId: settings.journalId, date: input.endDate, ref: label, lines },
      employee.companyId,
    );
    await this.moves.post(tx, moveId);
    const [row] = await tx
      .insert(schema.severances)
      .values({
        companyId: employee.companyId,
        employeeId,
        reason: input.reason,
        endDate: input.endDate,
        monthlyWage: p.monthlyWage,
        unusedLeaveDays: p.unusedLeaveDays,
        otherRights: input.otherRights,
        separationPay: input.separationPay,
        result: p,
        gross: p.gross,
        tax: p.tax,
        net: p.net,
        state: "posted",
        moveId,
        createdBy: currentContext().userId,
      })
      .returning();
    if (!employee.resignDate)
      await tx
        .update(schema.employees)
        .set({ resignDate: input.endDate, updatedAt: sql`now()` })
        .where(eq(schema.employees.id, employeeId));
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employeeId,
      action: "comment",
      message: `${label}: bruto Rp${p.gross}, PPh 21 final Rp${p.tax}`,
    });
    return row!;
  }

  async list(tx: Db, employeeId: string) {
    await this.employees.find(tx, employeeId);
    return tx
      .select({
        severance: schema.severances,
        moveName: schema.accountMoves.name,
      })
      .from(schema.severances)
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.severances.moveId))
      .where(eq(schema.severances.employeeId, employeeId))
      .orderBy(desc(schema.severances.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.severance, moveName: r.moveName })));
  }

  /** Upah sebulan = gaji pokok + tunjangan tetap (harian: × 21 hari; borongan: rata-rata 3 slip terakhir). */
  private async monthlyWage(tx: Db, employee: typeof schema.employees.$inferSelect) {
    const [contract] = await tx
      .select()
      .from(schema.contracts)
      .where(
        and(
          eq(schema.contracts.employeeId, employee.id),
          inArray(schema.contracts.state, ["running", "closed"]),
        ),
      )
      .orderBy(desc(schema.contracts.dateStart))
      .limit(1);
    if (!contract) throw new BadRequestException("Karyawan belum punya kontrak");
    const fixed = await tx
      .select({ amount: schema.contractAllowances.amount })
      .from(schema.contractAllowances)
      .innerJoin(
        schema.salaryComponents,
        eq(schema.salaryComponents.id, schema.contractAllowances.componentId),
      )
      .where(
        and(
          eq(schema.contractAllowances.contractId, contract.id),
          eq(schema.salaryComponents.fixed, true),
          eq(schema.salaryComponents.kind, "allowance"),
        ),
      );
    const allowances = fixed.reduce((s, a) => s.plus(a.amount), d(0));
    if (contract.wageType === "daily") return d(contract.wage).times(21).plus(allowances);
    if (contract.wageType === "piece") {
      const slips = await tx
        .select({ earnings: schema.payslips.earnings })
        .from(schema.payslips)
        .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
        .where(
          and(
            eq(schema.payslips.employeeId, employee.id),
            eq(schema.payrollRuns.kind, "regular"),
            inArray(schema.payrollRuns.state, ["done", "paid"]),
          ),
        )
        .orderBy(desc(schema.payrollRuns.periodStart))
        .limit(3);
      if (!slips.length) return allowances;
      return slips
        .reduce((s, x) => s.plus(x.earnings), d(0))
        .div(slips.length)
        .toDecimalPlaces(0);
    }
    return d(contract.wage).plus(allowances);
  }
}
