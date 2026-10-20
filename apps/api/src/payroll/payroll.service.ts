import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, lt, ne, or, schema, sql, type Db } from "@erp/db";
import {
  bankTransferFile,
  bpjsProgram,
  computePayslip,
  retroPay,
  thrAmount,
  workingDays,
  type BankFormat,
  type payrollCostQuerySchema,
  type thrComputeSchema,
  type PayslipItem,
  type payrollRunSchema,
  type payrollSettingsSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertCompanyAccounts, assertCompanyJournal, fieldError } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { currentContext } from "../common/request-context.js";
import { EmployeeService } from "../hr/employee.service.js";
import { ExpenseService } from "../hr/expense.service.js";
import { holidaysBetween, LeaveService } from "../hr/leave.service.js";
import { localDate, ScheduleService } from "../hr/schedule.service.js";
import { LoanService } from "./loan.service.js";

const RUN = schema.payrollRuns;
const SLIP = schema.payslips;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
/** Bulan penuh antara dua tanggal. */
const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(m, 0);
};
const lastDay = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

@Injectable()
export class PayrollService {
  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(LeaveService) private readonly leaves: LeaveService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
    @Inject(LoanService) private readonly loans: LoanService,
    @Inject(ExpenseService) private readonly expenses: ExpenseService,
  ) {}

  // ---- Pengaturan ----

  async settings(tx: Db, companyId = currentContext().companyId) {
    const [row] = await tx
      .select()
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    if (!row)
      throw new BadRequestException(
        "Payroll belum disiapkan (pasang bagan akun standar di Pengaturan Akuntansi)",
      );
    return row;
  }

  async updateSettings(tx: Db, input: z.infer<typeof payrollSettingsSchema>) {
    const companyId = currentContext().companyId;
    await this.settings(tx, companyId);
    await assertCompanyAccounts(tx, companyId, [
      { path: "salaryExpenseAccountId", id: input.salaryExpenseAccountId },
      { path: "bpjsKesExpenseAccountId", id: input.bpjsKesExpenseAccountId },
      { path: "bpjsTkExpenseAccountId", id: input.bpjsTkExpenseAccountId },
      { path: "salaryPayableAccountId", id: input.salaryPayableAccountId },
      { path: "pph21PayableAccountId", id: input.pph21PayableAccountId },
      { path: "bpjsKesPayableAccountId", id: input.bpjsKesPayableAccountId },
      { path: "bpjsTkPayableAccountId", id: input.bpjsTkPayableAccountId },
      ...(input.employeeLoanAccountId
        ? [{ path: "employeeLoanAccountId", id: input.employeeLoanAccountId }]
        : []),
    ]);
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone });
      } catch {
        throw fieldError("timezone", "Zona waktu tidak dikenal (contoh: Asia/Jakarta)");
      }
    }
    await assertCompanyJournal(tx, companyId, input.journalId, ["general"]);
    for (const path of ["thrComponentId", "retroComponentId"] as const) {
      const componentId = input[path];
      if (!componentId) continue;
      const [c] = await tx
        .select({ kind: schema.salaryComponents.kind })
        .from(schema.salaryComponents)
        .where(
          and(eq(schema.salaryComponents.id, componentId), eq(schema.salaryComponents.companyId, companyId)),
        );
      if (c?.kind !== "allowance") throw fieldError(path, "Pilih komponen tunjangan perusahaan ini");
    }
    const [row] = await tx
      .update(schema.payrollSettings)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(schema.payrollSettings.companyId, companyId))
      .returning();
    return row!;
  }

  // ---- Payroll run ----

  async list(tx: Db) {
    return tx
      .select({
        run: RUN,
        employees: sql<number>`(select count(*)::int from ${SLIP} s where s.run_id = payroll_runs.id)`,
        net: sql<string>`(select coalesce(sum(s.net), 0)::text from ${SLIP} s where s.run_id = payroll_runs.id)`,
        pph21: sql<string>`(select coalesce(sum(s.pph21), 0)::text from ${SLIP} s where s.run_id = payroll_runs.id)`,
      })
      .from(RUN)
      .where(eq(RUN.companyId, currentContext().companyId))
      .orderBy(desc(RUN.periodStart))
      .then((rows) => rows.map((r) => ({ ...r.run, employees: r.employees, net: r.net, pph21: r.pph21 })));
  }

  async get(tx: Db, id: string) {
    const run = await this.find(tx, id);
    const slips = await tx
      .select({
        slip: SLIP,
        employeeName: schema.employees.name,
        employeeNumber: schema.employees.employeeNumber,
        departmentName: schema.departments.name,
      })
      .from(SLIP)
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .leftJoin(schema.departments, eq(schema.departments.id, schema.employees.departmentId))
      .where(eq(SLIP.runId, id))
      .orderBy(asc(schema.employees.name));
    const payslips = slips.map((r) => ({
      ...r.slip,
      employeeName: r.employeeName,
      employeeNumber: r.employeeNumber,
      departmentName: r.departmentName,
    }));
    const sum = (
      k:
        | "earnings"
        | "gross"
        | "pph21"
        | "kesEmployee"
        | "kesEmployer"
        | "tkEmployee"
        | "tkEmployer"
        | "deductions"
        | "net",
    ) => payslips.reduce((s, p) => s.plus(p[k]), d(0)).toFixed(2);
    const moves = await tx
      .select({ id: schema.accountMoves.id, name: schema.accountMoves.name })
      .from(schema.accountMoves)
      .where(
        inArray(
          schema.accountMoves.id,
          [run.accountMoveId, run.paymentMoveId].filter((x): x is string => Boolean(x)),
        ),
      );
    return {
      ...run,
      payslips,
      totals: {
        earnings: sum("earnings"),
        gross: sum("gross"),
        pph21: sum("pph21"),
        // BPJS Kesehatan & Ketenagakerjaan tidak digabung.
        kesEmployee: sum("kesEmployee"),
        kesEmployer: sum("kesEmployer"),
        tkEmployee: sum("tkEmployee"),
        tkEmployer: sum("tkEmployer"),
        deductions: sum("deductions"),
        net: sum("net"),
      },
      accountMove: moves.find((m) => m.id === run.accountMoveId) ?? null,
      paymentMove: moves.find((m) => m.id === run.paymentMoveId) ?? null,
    };
  }

  /** Buat payroll bulanan untuk semua karyawan dengan kontrak berjalan, lalu hitung. */
  async create(tx: Db, input: z.infer<typeof payrollRunSchema>) {
    const companyId = currentContext().companyId;
    await this.settings(tx, companyId);
    const periodStart = `${input.period}-01`;
    const periodEnd = lastDay(input.period);
    const [existing] = await tx
      .select({ id: RUN.id })
      .from(RUN)
      .where(and(eq(RUN.companyId, companyId), eq(RUN.periodStart, periodStart), ne(RUN.state, "cancel")));
    if (existing) throw new ConflictException("Payroll untuk bulan ini sudah ada");
    const [y, m] = input.period.split("-").map(Number) as [number, number];
    const [run] = await tx
      .insert(RUN)
      .values({
        companyId,
        name: input.name || `Gaji ${MONTHS[m - 1]} ${y}`,
        periodStart,
        periodEnd,
        paymentDate: input.paymentDate,
        createdBy: currentContext().userId,
      })
      .returning();
    await this.compute(tx, run!.id);
    await this.activity.log(tx, { resModel: "payroll_run", resId: run!.id, action: "create" });
    return run!;
  }

  /**
   * Hitung ulang semua slip (hanya draft): karyawan baru yang memenuhi syarat ditambahkan,
   * yang tidak lagi memenuhi syarat dikeluarkan.
   */
  async compute(tx: Db, id: string) {
    const run = await this.find(tx, id, true);
    if (run.state !== "draft")
      throw new BadRequestException("Payroll yang sudah diposting tidak bisa dihitung ulang");
    const settings = await this.settings(tx, run.companyId);
    const holidays = await holidaysBetween(tx, run.periodStart, run.periodEnd);
    const monthDays = workingDays(run.periodStart, run.periodEnd, holidays);
    const eligible = await tx
      .select({ employee: schema.employees, contract: schema.contracts })
      .from(schema.contracts)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.contracts.employeeId))
      .where(
        and(
          eq(schema.contracts.companyId, run.companyId),
          inArray(schema.contracts.state, ["running", "closed"]),
          lte(schema.contracts.dateStart, run.periodEnd),
          or(isNull(schema.contracts.dateEnd), gte(schema.contracts.dateEnd, run.periodStart)),
          lte(schema.employees.joinDate, run.periodEnd),
          or(isNull(schema.employees.resignDate), gte(schema.employees.resignDate, run.periodStart)),
        ),
      )
      .orderBy(desc(schema.contracts.dateStart));
    // Satu kontrak per karyawan: yang terbaru dalam periode.
    const byEmployee = new Map<string, (typeof eligible)[number]>();
    for (const row of eligible) if (!byEmployee.has(row.employee.id)) byEmployee.set(row.employee.id, row);

    const existing = await tx.select().from(SLIP).where(eq(SLIP.runId, id));
    for (const slip of existing.filter((s) => !byEmployee.has(s.employeeId))) {
      await tx.delete(SLIP).where(eq(SLIP.id, slip.id));
    }
    for (const { employee, contract } of byEmployee.values()) {
      let slip = existing.find((s) => s.employeeId === employee.id);
      if (!slip) {
        [slip] = await tx
          .insert(SLIP)
          .values({
            companyId: run.companyId,
            runId: id,
            employeeId: employee.id,
            contractId: contract.id,
            ptkpStatus: employee.ptkpStatus,
            hasNpwp: this.employees.hasTaxId(employee),
            terCategory: "A",
          })
          .returning();
      }
      await this.computeSlip(tx, run, slip!.id, employee, contract, settings, holidays, monthDays);
    }
    return this.get(tx, id);
  }

  private async computeSlip(
    tx: Db,
    run: typeof RUN.$inferSelect,
    slipId: string,
    employee: typeof schema.employees.$inferSelect,
    contract: typeof schema.contracts.$inferSelect,
    settings: typeof schema.payrollSettings.$inferSelect,
    holidays: string[],
    monthDays: number,
  ) {
    const components = await tx
      .select()
      .from(schema.salaryComponents)
      .where(eq(schema.salaryComponents.companyId, run.companyId));
    const comp = new Map(components.map((c) => [c.id, c]));
    const allowanceRows = await tx
      .select()
      .from(schema.contractAllowances)
      .where(eq(schema.contractAllowances.contractId, contract.id));
    const inputs = await tx
      .select()
      .from(schema.payslipInputs)
      .where(eq(schema.payslipInputs.payslipId, slipId));
    const item = (
      componentId: string,
      amount: string,
      suffix?: string | null,
    ): PayslipItem & { componentId: string | null; loanId?: string; expenseClaimId?: string } => {
      const c = comp.get(componentId)!;
      return {
        componentId,
        code: c.code,
        name: suffix ? `${c.name} — ${suffix}` : c.name,
        amount,
        fixed: c.fixed,
        taxable: c.taxable,
      };
    };
    const allowances = [
      ...allowanceRows
        .filter((a) => comp.get(a.componentId)?.kind === "allowance")
        .map((a) => item(a.componentId, a.amount)),
      ...inputs
        .filter((i) => comp.get(i.componentId)?.kind === "allowance")
        .map((i) => ({ ...item(i.componentId, i.amount, i.description), fixed: false })),
      // Klaim biaya disetujui yang dibayar lewat slip (bagian objek PPh 21 dipisah).
      ...(
        await tx
          .select({
            claimId: schema.expenseClaims.id,
            name: schema.expenseClaims.name,
            taxable: schema.expenseCategories.taxable,
            amount: sql<string>`sum(${schema.expenseClaimLines.amount})::text`,
          })
          .from(schema.expenseClaims)
          .innerJoin(schema.expenseClaimLines, eq(schema.expenseClaimLines.claimId, schema.expenseClaims.id))
          .innerJoin(
            schema.expenseCategories,
            eq(schema.expenseCategories.id, schema.expenseClaimLines.categoryId),
          )
          .where(
            and(
              eq(schema.expenseClaims.employeeId, employee.id),
              eq(schema.expenseClaims.state, "approved"),
              eq(schema.expenseClaims.payMethod, "payslip"),
              lte(schema.expenseClaims.date, run.periodEnd),
            ),
          )
          .groupBy(schema.expenseClaims.id, schema.expenseClaims.name, schema.expenseCategories.taxable)
          .orderBy(asc(schema.expenseClaims.name))
      ).map((c) => ({
        componentId: null,
        expenseClaimId: c.claimId,
        code: "RMB",
        name: `Penggantian biaya ${c.name}${c.taxable ? " (objek PPh 21)" : ""}`,
        amount: d(c.amount).toFixed(2),
        fixed: false,
        taxable: c.taxable,
      })),
    ];
    const deductions = [
      ...allowanceRows
        .filter((a) => comp.get(a.componentId)?.kind === "deduction")
        .map((a) => item(a.componentId, a.amount)),
      ...inputs
        .filter((i) => comp.get(i.componentId)?.kind === "deduction")
        .map((i) => item(i.componentId, i.amount, i.description)),
      // Cicilan pinjaman karyawan yang sedang berjalan.
      ...(await this.loans.deductionsFor(tx, employee.id, run.periodStart.slice(0, 7))).map((l) => ({
        componentId: null,
        loanId: l.loanId,
        code: "LOAN",
        name: l.name,
        amount: l.amount,
      })),
    ];

    // Hari tidak dibayar: cuti tanpa upah + hari kerja di luar masa kerja/kontrak (masuk/keluar di tengah bulan).
    const from = [run.periodStart, employee.joinDate, contract.dateStart].sort().at(-1)!;
    const to = [
      run.periodEnd,
      employee.resignDate ?? run.periodEnd,
      contract.dateEnd ?? run.periodEnd,
    ].sort()[0]!;
    const employedDays = from <= to ? workingDays(from, to, holidays) : 0;
    const unpaidLeave = await this.leaves.unpaidDays(tx, employee.id, from, to, holidays);
    const unpaidDays = monthDays - employedDays + unpaidLeave;

    const overtime = await tx
      .select()
      .from(schema.overtimes)
      .where(
        and(
          eq(schema.overtimes.employeeId, employee.id),
          gte(schema.overtimes.date, run.periodStart),
          lte(schema.overtimes.date, run.periodEnd),
          eq(schema.overtimes.state, "approved"),
          or(isNull(schema.overtimes.payslipId), eq(schema.overtimes.payslipId, slipId)),
        ),
      );
    const late =
      from <= to
        ? await this.schedules.lateness(tx, {
            from,
            to,
            employeeIds: [employee.id],
            companyId: run.companyId,
          })
        : [];

    // Pekerja harian lepas (hari hadir × upah harian) / borongan (satuan hasil kerja × tarif).
    let wage = d(contract.wage);
    let casual: Parameters<typeof computePayslip>[0]["casual"];
    if (contract.wageType !== "monthly") {
      let days = 0;
      if (contract.wageType === "daily") {
        const rows = await tx
          .select({ checkIn: schema.attendances.checkIn })
          .from(schema.attendances)
          .where(
            and(
              eq(schema.attendances.employeeId, employee.id),
              gte(schema.attendances.checkIn, new Date(`${from}T00:00:00Z`)),
              lte(schema.attendances.checkIn, new Date(`${to}T23:59:59Z`)),
            ),
          );
        days = new Set(
          rows.map((r) => localDate(r.checkIn, settings.timezone)).filter((x) => x >= from && x <= to),
        ).size;
        wage = d(contract.wage).times(days);
      } else {
        const entries = await tx
          .select()
          .from(schema.workEntries)
          .where(
            and(
              eq(schema.workEntries.employeeId, employee.id),
              gte(schema.workEntries.date, from),
              lte(schema.workEntries.date, to),
              or(isNull(schema.workEntries.payslipId), eq(schema.workEntries.payslipId, slipId)),
            ),
          );
        days = new Set(entries.map((e) => e.date)).size;
        wage = d(contract.wage).times(entries.reduce((sum, e) => sum.plus(e.quantity), d(0)));
      }
      wage = wage.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      // Dasar BPJS borongan: rata-rata upah 3 bulan terakhir (bulan ini + 2 slip sebelumnya).
      let bpjsWage = wage;
      if (contract.wageType === "piece") {
        const prior = await tx
          .select({ earnings: SLIP.earnings })
          .from(SLIP)
          .innerJoin(RUN, eq(RUN.id, SLIP.runId))
          .where(
            and(
              eq(SLIP.employeeId, employee.id),
              inArray(RUN.state, ["done", "paid"]),
              lt(RUN.periodStart, run.periodStart),
            ),
          )
          .orderBy(desc(RUN.periodStart))
          .limit(2);
        const all = [wage, ...prior.map((p) => d(p.earnings))];
        bpjsWage = all
          .reduce((sum, x) => sum.plus(x), d(0))
          .div(all.length)
          .toDecimalPlaces(0);
      }
      casual = {
        kind: contract.wageType,
        days,
        bpjsWage: bpjsWage.toFixed(0),
        onlyJkkJkm: monthsBetween(employee.joinDate, run.periodEnd) < settings.casualFullBpjsMonths,
      };
    }

    // Akumulasi masa sebelumnya dalam tahun pajak yang sama (payroll yang sudah diposting).
    const year = run.periodStart.slice(0, 4);
    const [ytd] = await tx
      .select({
        gross: sql<string>`coalesce(sum(${SLIP.gross}), 0)::text`,
        pph21: sql<string>`coalesce(sum(${SLIP.pph21}), 0)::text`,
        pension: sql<string>`coalesce(sum(${SLIP.employeePension}), 0)::text`,
        months: sql<number>`count(*)::int`,
      })
      .from(SLIP)
      .innerJoin(RUN, eq(RUN.id, SLIP.runId))
      .where(
        and(
          eq(SLIP.employeeId, employee.id),
          eq(SLIP.companyId, run.companyId),
          inArray(RUN.state, ["done", "paid"]),
          gte(RUN.periodStart, `${year}-01-01`),
          lt(RUN.periodStart, run.periodStart),
        ),
      );
    const isFinal =
      run.periodStart.slice(5, 7) === "12" ||
      Boolean(
        employee.resignDate && employee.resignDate >= run.periodStart && employee.resignDate <= run.periodEnd,
      );
    const hasNpwp = this.employees.hasTaxId(employee);

    const result = computePayslip({
      wage: wage.toFixed(2),
      allowances,
      deductions,
      overtime: overtime.map((o) => ({ hours: o.hours, day: o.dayType })),
      unpaidDays,
      workingDays: monthDays,
      status: employee.ptkpStatus,
      hasNpwp,
      bpjs: { jkkRate: settings.jkkRate, kesWageCap: settings.kesWageCap, jpWageCap: settings.jpWageCap },
      isFinal,
      ytd: {
        gross: ytd?.gross ?? 0,
        pph21: ytd?.pph21 ?? 0,
        employeePension: ytd?.pension ?? 0,
        months: ytd?.months ?? 0,
      },
      latePenalty: late[0]?.penalty ?? 0,
      casual,
      enrollment: { kes: employee.bpjsKesEnrolled, tk: employee.bpjsTkEnrolled, jp: employee.bpjsJpEnrolled },
    });

    await tx.delete(schema.payslipLines).where(eq(schema.payslipLines.payslipId, slipId));
    const componentByCode = new Map(
      [...allowances, ...deductions].map((x) => [x.code + x.name, x.componentId]),
    );
    const loanByCode = new Map(deductions.filter((x) => x.loanId).map((x) => [x.code + x.name, x.loanId!]));
    const claimByCode = new Map(
      allowances.filter((x) => x.expenseClaimId).map((x) => [x.code + x.name, x.expenseClaimId!]),
    );
    await tx.insert(schema.payslipLines).values(
      result.lines.map((l, i) => ({
        payslipId: slipId,
        sequence: i,
        code: l.code,
        name: l.name,
        category: l.category,
        amount: l.amount,
        componentId: componentByCode.get(l.code + l.name) ?? null,
        loanId: loanByCode.get(l.code + l.name) ?? null,
        expenseClaimId: claimByCode.get(l.code + l.name) ?? null,
      })),
    );
    await tx
      .update(SLIP)
      .set({
        contractId: contract.id,
        ptkpStatus: employee.ptkpStatus,
        hasNpwp,
        terCategory: result.terCategory,
        terRate: result.terRate,
        isFinal,
        workingDays: monthDays,
        unpaidDays: String(unpaidDays),
        earnings: result.earnings,
        gross: result.gross,
        pph21: result.pph21,
        employeeBpjs: result.employeeBpjs,
        employerBpjs: result.employerBpjs,
        kesEmployee: result.kesEmployee,
        kesEmployer: result.kesEmployer,
        tkEmployee: result.tkEmployee,
        tkEmployer: result.tkEmployer,
        bpjsKesWage: result.kesWage,
        bpjsTkWage: result.tkWage,
        employeePension: result.employeePension,
        deductions: result.deductions,
        net: result.net,
        annual: result.annual,
        branchId: employee.branchId,
        businessUnitId: employee.businessUnitId,
        bpjsWage: casual
          ? d(casual.bpjsWage).toFixed(2)
          : allowances
              .filter((a) => a.fixed)
              .reduce((sum, a) => sum.plus(a.amount), wage)
              .toFixed(2),
        updatedAt: sql`now()`,
      })
      .where(eq(SLIP.id, slipId));
  }

  /** Hitung ulang satu slip draft (setelah input slip berubah). */
  private async recomputeSlip(tx: Db, run: typeof RUN.$inferSelect, slip: typeof SLIP.$inferSelect) {
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, slip.employeeId));
    const [contract] = await tx
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.id, slip.contractId));
    const holidays = await holidaysBetween(tx, run.periodStart, run.periodEnd);
    await this.computeSlip(
      tx,
      run,
      slip.id,
      employee!,
      contract!,
      await this.settings(tx, run.companyId),
      holidays,
      workingDays(run.periodStart, run.periodEnd, holidays),
    );
  }

  /** Ganti input manual (bonus, potongan, dll.) pada slip lalu hitung ulang slip itu. */
  async setInputs(
    tx: Db,
    slipId: string,
    inputs: { componentId: string; amount: string; description?: string | null }[],
  ) {
    const slip = await this.findSlip(tx, slipId);
    const run = await this.find(tx, slip.runId, true);
    if (run.state !== "draft") throw new BadRequestException("Payroll sudah diposting");
    for (const [i, input] of inputs.entries()) {
      const [c] = await tx
        .select({ id: schema.salaryComponents.id })
        .from(schema.salaryComponents)
        .where(
          and(
            eq(schema.salaryComponents.id, input.componentId),
            eq(schema.salaryComponents.companyId, run.companyId),
          ),
        );
      if (!c) throw fieldError(`inputs.${i}.componentId`, "Komponen gaji tidak ditemukan");
    }
    // Input otomatis (THR/rapel) dikelola lewat perhitungannya masing-masing.
    await tx
      .delete(schema.payslipInputs)
      .where(and(eq(schema.payslipInputs.payslipId, slipId), eq(schema.payslipInputs.source, "manual")));
    if (inputs.length)
      await tx
        .insert(schema.payslipInputs)
        .values(inputs.map((x) => ({ ...x, description: x.description ?? null, payslipId: slipId })));
    await this.recomputeSlip(tx, run, slip);
    return this.payslip(tx, slipId);
  }

  /**
   * Posting payroll: jurnal beban gaji & BPJS (per cabang/unit bisnis) vs utang BPJS, utang PPh 21,
   * potongan, dan utang gaji (gaji bersih).
   */
  async post(tx: Db, id: string) {
    const run = await this.find(tx, id, true);
    if (run.state !== "draft") throw new BadRequestException("Payroll sudah diposting");
    const s = await this.settings(tx, run.companyId);
    const slips = await tx.select().from(SLIP).where(eq(SLIP.runId, id));
    if (!slips.length) throw new BadRequestException("Tidak ada slip gaji");
    const lines = await tx
      .select({ line: schema.payslipLines, accountId: schema.salaryComponents.accountId })
      .from(schema.payslipLines)
      .leftJoin(schema.salaryComponents, eq(schema.salaryComponents.id, schema.payslipLines.componentId))
      .where(
        inArray(
          schema.payslipLines.payslipId,
          slips.map((x) => x.id),
        ),
      );

    // Agregasi: key = akun|cabang|unit bisnis|program BPJS; nilai positif = debit. BPJS Kesehatan & Ketenagakerjaan
    // selalu menjadi baris jurnal sendiri walau memakai akun yang sama.
    const entries = new Map<string, Decimal>();
    const add = (
      accountId: string,
      amount: Decimal,
      dims: { branchId: string | null; businessUnitId: string | null } = {
        branchId: null,
        businessUnitId: null,
      },
      program = "",
    ) => {
      const key = `${accountId}|${dims.branchId ?? ""}|${dims.businessUnitId ?? ""}|${program}`;
      entries.set(key, (entries.get(key) ?? d(0)).plus(amount));
    };
    const bpjsAccounts = (code: string) =>
      bpjsProgram(code) === "kes"
        ? { program: "kes", expense: s.bpjsKesExpenseAccountId, payable: s.bpjsKesPayableAccountId }
        : { program: "tk", expense: s.bpjsTkExpenseAccountId, payable: s.bpjsTkPayableAccountId };
    for (const slip of slips) {
      const dims = { branchId: slip.branchId, businessUnitId: slip.businessUnitId };
      for (const { line, accountId } of lines.filter((l) => l.line.payslipId === slip.id)) {
        const amount = d(line.amount);
        switch (line.category) {
          case "basic":
          case "allowance":
          case "overtime":
          case "unpaid":
            // Klaim biaya: debit akun beban kategori klaim (di bawah).
            if (!line.expenseClaimId) add(accountId ?? s.salaryExpenseAccountId, amount, dims);
            break;
          case "bpjs_employer": {
            const b = bpjsAccounts(line.code);
            add(b.expense, amount, dims, b.program);
            add(b.payable, amount.negated(), undefined, b.program);
            break;
          }
          case "bpjs_employee": {
            const b = bpjsAccounts(line.code);
            add(b.payable, amount, undefined, b.program); // baris slip bernilai negatif
            break;
          }
          case "tax":
            add(s.pph21PayableAccountId, amount);
            break;
          case "deduction":
            if (line.loanId) {
              if (!s.employeeLoanAccountId)
                throw new BadRequestException("Akun piutang karyawan belum diatur di pengaturan payroll");
              add(s.employeeLoanAccountId, amount);
            } else add(accountId ?? s.salaryExpenseAccountId, amount);
            break;
        }
      }
      const claimIds = [
        ...new Set(
          lines
            .filter((l) => l.line.payslipId === slip.id && l.line.expenseClaimId)
            .map((l) => l.line.expenseClaimId!),
        ),
      ];
      for (const x of await this.expenses.accountTotals(tx, claimIds)) add(x.accountId, d(x.amount), dims);
      add(s.salaryPayableAccountId, d(slip.net).negated());
    }
    // Klaim yang dibayar lewat slip harus masih disetujui & belum dibayar (mis. tidak dibatalkan setelah dihitung).
    const claimLines = lines.filter((l) => l.line.expenseClaimId);
    if (claimLines.length) {
      const claims = await tx
        .select({
          id: schema.expenseClaims.id,
          name: schema.expenseClaims.name,
          state: schema.expenseClaims.state,
        })
        .from(schema.expenseClaims)
        .where(
          inArray(
            schema.expenseClaims.id,
            claimLines.map((l) => l.line.expenseClaimId!),
          ),
        )
        .for("update");
      const stale = claims.find((c) => c.state !== "approved");
      if (stale) throw new BadRequestException(`Klaim ${stale.name} sudah berubah; hitung ulang payroll`);
    }
    const journalLines = [...entries.entries()]
      .filter(([, v]) => !v.isZero())
      .map(([key, v]) => {
        const [accountId, branchId, businessUnitId, program] = key.split("|") as [
          string,
          string,
          string,
          string,
        ];
        return {
          accountId,
          name:
            program === "kes"
              ? `${run.name} — BPJS Kesehatan`
              : program === "tk"
                ? `${run.name} — BPJS Ketenagakerjaan`
                : run.name,
          debit: v.gt(0) ? v.toFixed(2) : "0",
          credit: v.lt(0) ? v.abs().toFixed(2) : "0",
          branchId: branchId || null,
          businessUnitId: businessUnitId || null,
        };
      });
    const moveId = await this.moves.createEntry(
      tx,
      { journalId: s.journalId, date: run.periodEnd, ref: run.name, lines: journalLines },
      run.companyId,
    );
    await this.moves.post(tx, moveId);
    await tx
      .update(schema.overtimes)
      .set({
        payslipId: sql`(select s.id from ${SLIP} s where s.run_id = ${id} and s.employee_id = overtimes.employee_id)`,
      })
      .where(
        and(
          eq(schema.overtimes.companyId, run.companyId),
          isNull(schema.overtimes.payslipId),
          gte(schema.overtimes.date, run.periodStart),
          lte(schema.overtimes.date, run.periodEnd),
          inArray(
            schema.overtimes.employeeId,
            slips.map((x) => x.employeeId),
          ),
        ),
      );
    // Hasil kerja borongan yang dibayar ditandai dengan slipnya.
    await tx
      .update(schema.workEntries)
      .set({
        payslipId: sql`(select s.id from ${SLIP} s where s.run_id = ${id} and s.employee_id = work_entries.employee_id)`,
      })
      .where(
        and(
          eq(schema.workEntries.companyId, run.companyId),
          isNull(schema.workEntries.payslipId),
          gte(schema.workEntries.date, run.periodStart),
          lte(schema.workEntries.date, run.periodEnd),
          inArray(
            schema.workEntries.employeeId,
            slips.map((x) => x.employeeId),
          ),
        ),
      );
    await tx
      .update(RUN)
      .set({ state: "done", accountMoveId: moveId, updatedAt: sql`now()` })
      .where(eq(RUN.id, id));
    for (const l of claimLines)
      await tx
        .update(schema.expenseClaims)
        .set({ state: "paid", payslipId: l.line.payslipId, updatedAt: sql`now()` })
        .where(eq(schema.expenseClaims.id, l.line.expenseClaimId!));
    await this.loans.closePaid(tx, [
      ...new Set(lines.map((l) => l.line.loanId).filter((x): x is string => Boolean(x))),
    ]);
    await this.activity.log(tx, {
      resModel: "payroll_run",
      resId: id,
      action: "update",
      message: "Payroll diposting",
    });
    return this.get(tx, id);
  }

  /** Bayar gaji bersih: Dr Utang Gaji / Cr kas atau bank. */
  async pay(tx: Db, id: string, input: { journalId: string; date: string }) {
    const run = await this.find(tx, id, true);
    if (run.state !== "done") throw new BadRequestException("Posting payroll sebelum membayar");
    const s = await this.settings(tx, run.companyId);
    const journal = await assertCompanyJournal(tx, run.companyId, input.journalId, ["bank", "cash"]);
    if (!journal.defaultAccountId) throw fieldError("journalId", "Jurnal kas/bank belum punya akun");
    const [total] = await tx
      .select({ net: sql<string>`coalesce(sum(${SLIP.net}), 0)::text` })
      .from(SLIP)
      .where(eq(SLIP.runId, id));
    const amount = d(total?.net);
    if (amount.lte(0)) throw new BadRequestException("Tidak ada gaji bersih yang perlu dibayar");
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: journal.id,
        date: input.date,
        ref: `Pembayaran ${run.name}`,
        lines: [
          { accountId: s.salaryPayableAccountId, name: run.name, debit: amount.toFixed(2), credit: "0" },
          { accountId: journal.defaultAccountId, name: run.name, debit: "0", credit: amount.toFixed(2) },
        ],
      },
      run.companyId,
    );
    await this.moves.post(tx, moveId);
    await tx
      .update(RUN)
      .set({ state: "paid", paymentMoveId: moveId, updatedAt: sql`now()` })
      .where(eq(RUN.id, id));
    return this.get(tx, id);
  }

  async cancel(tx: Db, id: string) {
    const run = await this.find(tx, id, true);
    if (run.state !== "draft")
      throw new BadRequestException("Payroll yang sudah diposting tidak bisa dibatalkan (balik jurnalnya)");
    await tx.delete(SLIP).where(eq(SLIP.runId, id));
    await tx
      .update(RUN)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(RUN.id, id));
  }

  /** Daftar transfer bank (gaji bersih per karyawan) untuk diunggah ke internet banking. */
  async bankTransfer(tx: Db, id: string) {
    await this.find(tx, id);
    const rows = await tx
      .select({ slip: SLIP, employee: schema.employees })
      .from(SLIP)
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .where(eq(SLIP.runId, id))
      .orderBy(asc(schema.employees.name));
    return rows
      .filter((r) => d(r.slip.net).gt(0))
      .map((r) => {
        const e = this.employees.decrypted(r.employee);
        return {
          employeeNumber: r.employee.employeeNumber,
          name: r.employee.name,
          bankName: r.employee.bankName ?? "",
          bankAccount: e.bankAccount ?? "",
          bankAccountName: r.employee.bankAccountName ?? r.employee.name,
          amount: d(r.slip.net).toFixed(0),
        };
      });
  }

  /** Rekap PPh 21 (dasar pengisian e-Bupot 21 / SPT Masa) dan BPJS per karyawan. */
  async recap(tx: Db, id: string) {
    await this.find(tx, id);
    const rows = await tx
      .select({ slip: SLIP, employee: schema.employees })
      .from(SLIP)
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .where(eq(SLIP.runId, id))
      .orderBy(asc(schema.employees.name));
    const lines = rows.length
      ? await tx
          .select()
          .from(schema.payslipLines)
          .where(
            inArray(
              schema.payslipLines.payslipId,
              rows.map((r) => r.slip.id),
            ),
          )
      : [];
    const amount = (slipId: string, code: string) =>
      d(lines.find((l) => l.payslipId === slipId && l.code === code)?.amount ?? 0)
        .abs()
        .toFixed(0);
    return rows.map((r) => {
      const e = this.employees.decrypted(r.employee);
      return {
        employeeNumber: r.employee.employeeNumber,
        name: r.employee.name,
        nik: e.nik,
        npwp: e.npwp,
        ptkpStatus: r.slip.ptkpStatus,
        terCategory: r.slip.terCategory,
        terRate: r.slip.terRate,
        isFinal: r.slip.isFinal,
        gross: r.slip.gross,
        pph21: r.slip.pph21,
        bpjsWage: d(r.slip.bpjsWage).toFixed(0),
        bpjsKesWage: d(r.slip.bpjsKesWage).toFixed(0),
        bpjsTkWage: d(r.slip.bpjsTkWage).toFixed(0),
        bpjsKesEnrolled: r.employee.bpjsKesEnrolled,
        bpjsTkEnrolled: r.employee.bpjsTkEnrolled,
        birthDate: r.employee.birthDate,
        joinDate: r.employee.joinDate,
        bpjsKesNo: r.employee.bpjsKesNo,
        bpjsTkNo: r.employee.bpjsTkNo,
        bpjs: {
          kesEmployer: amount(r.slip.id, "BPJS_KES_ER"),
          kesEmployee: amount(r.slip.id, "BPJS_KES_EE"),
          jhtEmployer: amount(r.slip.id, "JHT_ER"),
          jhtEmployee: amount(r.slip.id, "JHT_EE"),
          jkk: amount(r.slip.id, "JKK"),
          jkm: amount(r.slip.id, "JKM"),
          jpEmployer: amount(r.slip.id, "JP_ER"),
          jpEmployee: amount(r.slip.id, "JP_EE"),
        },
      };
    });
  }

  // ---- THR & rapel ----

  /**
   * THR keagamaan (Permenaker 6/2016) untuk semua slip draft: masuk sebagai input komponen THR (kena PPh 21 lewat
   * TER bulan berjalan / perhitungan setahun di masa terakhir). Dihitung ulang tiap kali dijalankan.
   */
  async computeThr(tx: Db, id: string, input: z.infer<typeof thrComputeSchema>) {
    const run = await this.find(tx, id, true);
    if (run.state !== "draft") throw new BadRequestException("Payroll sudah diposting");
    const s = await this.settings(tx, run.companyId);
    if (!s.thrComponentId) throw new BadRequestException("Komponen THR belum diatur di pengaturan payroll");
    const slips = await tx
      .select({ slip: SLIP, employee: schema.employees, contract: schema.contracts })
      .from(SLIP)
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .innerJoin(schema.contracts, eq(schema.contracts.id, SLIP.contractId))
      .where(eq(SLIP.runId, id));
    const results = [];
    for (const { slip, employee, contract } of slips) {
      const fixed = await this.fixedAllowances(tx, contract.id);
      let history: string[] = [];
      if (contract.wageType !== "monthly")
        history = (
          await tx
            .select({ earnings: SLIP.earnings })
            .from(SLIP)
            .innerJoin(RUN, eq(RUN.id, SLIP.runId))
            .where(
              and(
                eq(SLIP.employeeId, employee.id),
                inArray(RUN.state, ["done", "paid"]),
                lt(RUN.periodStart, run.periodStart),
              ),
            )
            .orderBy(desc(RUN.periodStart))
            .limit(12)
        ).map((r) => r.earnings);
      const thr = thrAmount({
        wageType: contract.wageType,
        monthlyWage: d(contract.wage).plus(fixed),
        joinDate: employee.joinDate,
        holidayDate: input.holidayDate,
        history,
      });
      await this.replaceAutoInput(tx, run, slip, "thr", s.thrComponentId, thr.amount, {
        description: `${input.holiday || "THR"} — masa kerja ${thr.serviceMonths} bulan`,
        detail: { ...thr, holidayDate: input.holidayDate, holiday: input.holiday ?? null },
      });
      results.push({ employeeId: employee.id, name: employee.name, ...thr });
    }
    await this.activity.log(tx, {
      resModel: "payroll_run",
      resId: id,
      action: "update",
      message: `THR dihitung (hari raya ${input.holidayDate})`,
    });
    return { items: results, total: results.reduce((sum, r) => sum.plus(r.amount), d(0)).toFixed(0) };
  }

  /**
   * Rapel kenaikan upah berlaku mundur: selisih upah kontrak berjalan (gaji pokok + tunjangan tetap) terhadap yang
   * sudah dibayar di payroll terposting sejak tanggal mulai kontrak, dikurangi rapel yang sudah dibayar.
   */
  async computeRetro(tx: Db, id: string) {
    const run = await this.find(tx, id, true);
    if (run.state !== "draft") throw new BadRequestException("Payroll sudah diposting");
    const s = await this.settings(tx, run.companyId);
    if (!s.retroComponentId)
      throw new BadRequestException("Komponen rapel belum diatur di pengaturan payroll");
    const slips = await tx
      .select({ slip: SLIP, employee: schema.employees, contract: schema.contracts })
      .from(SLIP)
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .innerJoin(schema.contracts, eq(schema.contracts.id, SLIP.contractId))
      .where(eq(SLIP.runId, id));
    const results = [];
    for (const { slip, employee, contract } of slips) {
      let retro: ReturnType<typeof retroPay> = { lines: [], total: "0" };
      if (contract.wageType === "monthly" && contract.dateStart < run.periodStart) {
        const prior = await tx
          .select({ id: SLIP.id, periodStart: RUN.periodStart })
          .from(SLIP)
          .innerJoin(RUN, eq(RUN.id, SLIP.runId))
          .where(
            and(
              eq(SLIP.employeeId, employee.id),
              inArray(RUN.state, ["done", "paid"]),
              gte(RUN.periodStart, `${contract.dateStart.slice(0, 7)}-01`),
              lt(RUN.periodStart, run.periodStart),
            ),
          );
        if (prior.length) {
          const ids = prior.map((p) => p.id);
          const paidLines = await tx
            .select({
              payslipId: schema.payslipLines.payslipId,
              amount: sql<string>`sum(${schema.payslipLines.amount})::text`,
            })
            .from(schema.payslipLines)
            .leftJoin(
              schema.salaryComponents,
              eq(schema.salaryComponents.id, schema.payslipLines.componentId),
            )
            .where(
              and(
                inArray(schema.payslipLines.payslipId, ids),
                or(
                  eq(schema.payslipLines.category, "basic"),
                  and(eq(schema.payslipLines.category, "allowance"), eq(schema.salaryComponents.fixed, true)),
                ),
              ),
            )
            .groupBy(schema.payslipLines.payslipId);
          // Rapel terdahulu per bulan (dari rincian input rapel slip terposting).
          const earlier = await tx
            .select({ detail: schema.payslipInputs.detail })
            .from(schema.payslipInputs)
            .innerJoin(SLIP, eq(SLIP.id, schema.payslipInputs.payslipId))
            .innerJoin(RUN, eq(RUN.id, SLIP.runId))
            .where(
              and(
                eq(SLIP.employeeId, employee.id),
                eq(schema.payslipInputs.source, "retro"),
                inArray(RUN.state, ["done", "paid"]),
              ),
            );
          const already = new Map<string, Decimal>();
          for (const e of earlier)
            for (const l of (e.detail as { lines?: { period: string; diff: string }[] } | null)?.lines ?? [])
              already.set(l.period, (already.get(l.period) ?? d(0)).plus(l.diff));
          retro = retroPay({
            effectiveDate: contract.dateStart,
            monthlyDue: d(contract.wage).plus(await this.fixedAllowances(tx, contract.id)),
            months: prior.map((p) => {
              const period = p.periodStart.slice(0, 7);
              return {
                period,
                paid: paidLines.find((l) => l.payslipId === p.id)?.amount ?? 0,
                alreadyPaid: already.get(period) ?? 0,
              };
            }),
          });
        }
      }
      await this.replaceAutoInput(tx, run, slip, "retro", s.retroComponentId, retro.total, {
        description: !retro.lines.length
          ? null
          : retro.lines.length === 1
            ? retro.lines[0]!.period
            : `${retro.lines[0]!.period} s.d. ${retro.lines.at(-1)!.period}`,
        detail: { effectiveDate: contract.dateStart, lines: retro.lines },
      });
      if (d(retro.total).gt(0))
        results.push({
          employeeId: employee.id,
          name: employee.name,
          total: retro.total,
          lines: retro.lines,
        });
    }
    return { items: results, total: results.reduce((sum, r) => sum.plus(r.total), d(0)).toFixed(0) };
  }

  private async fixedAllowances(tx: Db, contractId: string) {
    const [row] = await tx
      .select({ amount: sql<string>`coalesce(sum(${schema.contractAllowances.amount}), 0)::text` })
      .from(schema.contractAllowances)
      .innerJoin(
        schema.salaryComponents,
        eq(schema.salaryComponents.id, schema.contractAllowances.componentId),
      )
      .where(
        and(
          eq(schema.contractAllowances.contractId, contractId),
          eq(schema.salaryComponents.kind, "allowance"),
          eq(schema.salaryComponents.fixed, true),
        ),
      );
    return d(row?.amount);
  }

  /** Ganti input otomatis (THR/rapel) satu slip lalu hitung ulang slipnya; nilai nol menghapus input. */
  private async replaceAutoInput(
    tx: Db,
    run: typeof RUN.$inferSelect,
    slip: typeof SLIP.$inferSelect,
    source: "thr" | "retro",
    componentId: string,
    amount: string,
    extra: { description: string | null; detail: unknown },
  ) {
    await tx
      .delete(schema.payslipInputs)
      .where(and(eq(schema.payslipInputs.payslipId, slip.id), eq(schema.payslipInputs.source, source)));
    if (d(amount).gt(0))
      await tx.insert(schema.payslipInputs).values({
        payslipId: slip.id,
        componentId,
        amount,
        source,
        description: extra.description,
        detail: extra.detail,
      });
    await this.recomputeSlip(tx, run, slip);
  }

  // ---- Transfer bank & laporan ----

  /** File transfer gaji per bank (atau CSV umum) beserta karyawan yang tidak termasuk. */
  async bankFile(tx: Db, id: string, format: BankFormat) {
    const run = await this.find(tx, id);
    const s = await this.settings(tx, run.companyId);
    if (format !== "csv" && !s.transferSourceAccount)
      throw new BadRequestException("Rekening sumber transfer gaji belum diatur di pengaturan payroll");
    return bankTransferFile(
      format,
      {
        sourceAccount: s.transferSourceAccount ?? "",
        companyCode: s.transferCompanyCode,
        date: run.paymentDate,
        remark: `Gaji ${run.periodStart.slice(0, 7)}`,
      },
      await this.bankTransfer(tx, id),
    );
  }

  /** Biaya tenaga kerja (payroll terposting) per departemen, cabang, atau bulan. */
  async costReport(tx: Db, q: z.infer<typeof payrollCostQuerySchema>) {
    const companyId = currentContext().companyId;
    const key =
      q.groupBy === "department"
        ? sql<string | null>`${schema.departments.name}`
        : q.groupBy === "branch"
          ? sql<string | null>`${schema.branches.name}`
          : sql<string>`to_char(${RUN.periodStart}, 'YYYY-MM')`;
    const rows = await tx
      .select({
        key,
        employees: sql<number>`count(distinct ${SLIP.employeeId})::int`,
        earnings: sql<string>`sum(${SLIP.earnings})::text`,
        kesEmployer: sql<string>`sum(${SLIP.kesEmployer})::text`,
        tkEmployer: sql<string>`sum(${SLIP.tkEmployer})::text`,
        pph21: sql<string>`sum(${SLIP.pph21})::text`,
        net: sql<string>`sum(${SLIP.net})::text`,
      })
      .from(SLIP)
      .innerJoin(RUN, eq(RUN.id, SLIP.runId))
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .leftJoin(schema.departments, eq(schema.departments.id, schema.employees.departmentId))
      .leftJoin(schema.branches, eq(schema.branches.id, SLIP.branchId))
      .where(
        and(
          eq(SLIP.companyId, companyId),
          inArray(RUN.state, ["done", "paid"]),
          gte(RUN.periodStart, `${q.from}-01`),
          lte(RUN.periodStart, `${q.to}-01`),
        ),
      )
      .groupBy(key)
      .orderBy(key);
    const items = rows.map((r) => ({
      key: r.key,
      employees: r.employees,
      earnings: d(r.earnings).toFixed(0),
      kesEmployer: d(r.kesEmployer).toFixed(0),
      tkEmployer: d(r.tkEmployer).toFixed(0),
      cost: d(r.earnings).plus(r.kesEmployer).plus(r.tkEmployer).toFixed(0),
      pph21: d(r.pph21).toFixed(0),
      net: d(r.net).toFixed(0),
    }));
    const total = (k: "earnings" | "kesEmployer" | "tkEmployer" | "cost" | "pph21" | "net") =>
      items.reduce((sum, r) => sum.plus(r[k]), d(0)).toFixed(0);
    return {
      ...q,
      items,
      totals: {
        earnings: total("earnings"),
        kesEmployer: total("kesEmployer"),
        tkEmployer: total("tkEmployer"),
        cost: total("cost"),
        pph21: total("pph21"),
        net: total("net"),
      },
    };
  }

  /** Slip payroll terposting yang akan dikirim via email (karyawan dengan email kerja). */
  async emailTargets(tx: Db, id: string, onlyPending: boolean) {
    const run = await this.find(tx, id);
    if (run.state !== "done" && run.state !== "paid")
      throw new BadRequestException("Posting payroll sebelum mengirim slip");
    const rows = await tx
      .select({ id: SLIP.id, emailedAt: SLIP.emailedAt, employee: schema.employees })
      .from(SLIP)
      .innerJoin(schema.employees, eq(schema.employees.id, SLIP.employeeId))
      .where(eq(SLIP.runId, id))
      .orderBy(asc(schema.employees.name));
    return rows
      .filter((r) => !onlyPending || !r.emailedAt)
      .map((r) => ({
        slipId: r.id,
        name: r.employee.name,
        email: r.employee.workEmail,
        birthDate: r.employee.birthDate,
      }));
  }

  async markEmailed(tx: Db, slipId: string, error: string | null) {
    await tx
      .update(SLIP)
      .set(error ? { emailError: error } : { emailedAt: sql`now()`, emailError: null })
      .where(eq(SLIP.id, slipId));
  }

  // ---- Slip gaji ----

  async payslip(tx: Db, slipId: string) {
    const slip = await this.findSlip(tx, slipId);
    const [run] = await tx.select().from(RUN).where(eq(RUN.id, slip.runId));
    const [employee] = await tx
      .select({
        employee: schema.employees,
        departmentName: schema.departments.name,
        jobName: schema.jobPositions.name,
      })
      .from(schema.employees)
      .leftJoin(schema.departments, eq(schema.departments.id, schema.employees.departmentId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
      .where(eq(schema.employees.id, slip.employeeId));
    const lines = await tx
      .select()
      .from(schema.payslipLines)
      .where(eq(schema.payslipLines.payslipId, slipId))
      .orderBy(asc(schema.payslipLines.sequence));
    const inputs = await tx
      .select({
        input: schema.payslipInputs,
        code: schema.salaryComponents.code,
        componentName: schema.salaryComponents.name,
      })
      .from(schema.payslipInputs)
      .innerJoin(schema.salaryComponents, eq(schema.salaryComponents.id, schema.payslipInputs.componentId))
      .where(eq(schema.payslipInputs.payslipId, slipId));
    return {
      ...slip,
      run: {
        id: run!.id,
        name: run!.name,
        periodStart: run!.periodStart,
        periodEnd: run!.periodEnd,
        paymentDate: run!.paymentDate,
        state: run!.state,
      },
      employee: {
        id: employee!.employee.id,
        name: employee!.employee.name,
        employeeNumber: employee!.employee.employeeNumber,
        departmentName: employee!.departmentName,
        jobName: employee!.jobName,
        userId: employee!.employee.userId,
      },
      lines,
      inputs: inputs.map((i) => ({ ...i.input, code: i.code, componentName: i.componentName })),
    };
  }

  /** Slip gaji milik user yang login (hanya payroll yang sudah diposting). */
  async mySlips(tx: Db) {
    const employee = await this.employees.mine(tx);
    return tx
      .select({
        id: SLIP.id,
        runName: RUN.name,
        periodStart: RUN.periodStart,
        paymentDate: RUN.paymentDate,
        net: SLIP.net,
        pph21: SLIP.pph21,
      })
      .from(SLIP)
      .innerJoin(RUN, eq(RUN.id, SLIP.runId))
      .where(and(eq(SLIP.employeeId, employee.id), inArray(RUN.state, ["done", "paid"])))
      .orderBy(desc(RUN.periodStart));
  }

  async findSlip(tx: Db, slipId: string) {
    const [slip] = await tx
      .select()
      .from(SLIP)
      .where(and(eq(SLIP.id, slipId), eq(SLIP.companyId, currentContext().companyId)));
    if (!slip) throw new NotFoundException("Slip gaji tidak ditemukan");
    return slip;
  }

  private async find(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(RUN)
      .where(and(eq(RUN.id, id), eq(RUN.companyId, currentContext().companyId)));
    const [run] = lock ? await q.for("update") : await q;
    if (!run) throw new NotFoundException("Payroll tidak ditemukan");
    return run;
  }
}
