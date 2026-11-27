import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, ne, schema, sql, type Db } from "@erp/db";
import {
  approvalDecisionSchema,
  EMPLOYEE_CHANGE_FIELDS,
  employeeChangeSchema,
  expenseCategorySchema,
  effectiveClaimLimit,
  expenseCategoryLimitsSchema,
  expenseClaimSchema,
  hasPermission,
  overtimeSchema,
  payClaimSchema,
  LIST_LOAD_LIMIT,
  advanceDisburseSchema,
  advanceSchema,
  advanceSettleSchema,
} from "@erp/shared";
import type { Response } from "express";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertCompanyAccounts } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { assertRefsVisible, createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ApprovalService } from "./approval.service.js";
import { assertOvertimeAllowed } from "./contract-types.module.js";
import { EmployeeService } from "./employee.service.js";
import { ExpenseService } from "./expense.service.js";
import { AdvanceService } from "./advance.service.js";
import { HrModule } from "./hr.module.js";

const ExpenseCategoriesController = createCrudController({
  path: "expense-categories",
  model: "expense_category",
  table: schema.expenseCategories,
  schema: expenseCategorySchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.expenseCategories.name],
  orderBy: schema.expenseCategories.name,
  companyColumn: schema.expenseCategories.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    if (typeof values.accountId === "string")
      await assertCompanyAccounts(tx, String(values.companyId), [
        { path: "accountId", id: values.accountId },
      ]);
  },
});

/** Klaim biaya karyawan: dibuat dari portal (milik sendiri) atau oleh HR (hr.write). */
/** Plafon klaim per golongan untuk satu kategori (menimpa plafon tahunan kategori). */
@Controller("expense-categories/:id/limits")
class ExpenseCategoryLimitsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.category(tx, id);
      return tx
        .select({
          gradeId: schema.expenseCategoryLimits.gradeId,
          gradeCode: schema.salaryGrades.code,
          gradeName: schema.salaryGrades.name,
          annualLimit: schema.expenseCategoryLimits.annualLimit,
        })
        .from(schema.expenseCategoryLimits)
        .innerJoin(schema.salaryGrades, eq(schema.salaryGrades.id, schema.expenseCategoryLimits.gradeId))
        .where(eq(schema.expenseCategoryLimits.categoryId, id))
        .orderBy(asc(schema.salaryGrades.sequence), asc(schema.salaryGrades.code));
    });
  }

  @Put()
  @RequirePermission("hr.manage")
  replace(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { limits } = parse(expenseCategoryLimitsSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.category(tx, id);
      for (const l of limits)
        await assertRefsVisible(tx, { gradeId: schema.salaryGrades }, { gradeId: l.gradeId });
      await tx.delete(schema.expenseCategoryLimits).where(eq(schema.expenseCategoryLimits.categoryId, id));
      if (limits.length)
        await tx
          .insert(schema.expenseCategoryLimits)
          .values(limits.map((l) => ({ categoryId: id, gradeId: l.gradeId, annualLimit: l.annualLimit })));
      return this.list(id);
    });
  }

  private async category(tx: Db, id: string) {
    const [row] = await tx
      .select({ id: schema.expenseCategories.id })
      .from(schema.expenseCategories)
      .where(
        and(
          eq(schema.expenseCategories.id, id),
          eq(schema.expenseCategories.companyId, currentContext().companyId),
        ),
      );
    if (!row) throw new NotFoundException("Kategori klaim tidak ditemukan");
  }
}

@Controller("expense-claims")
class ExpenseClaimsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ExpenseService) private readonly expenses: ExpenseService,
  ) {}

  /** `mine=1` = klaim milik sendiri (portal); selain itu butuh hr.read. */
  @Get()
  list(@Query() query: { employeeId?: string; state?: string; mine?: string }) {
    return this.tenantDb.run(async (tx) => {
      if (query.mine) {
        const own = await this.expenses.ownEmployeeId(tx);
        if (!own)
          throw new NotFoundException("Akun Anda belum terhubung dengan data karyawan di perusahaan ini");
        return this.expenses.list(tx, { employeeId: own, state: query.state });
      }
      if (!hasPermission(currentContext().permissions, "hr.read"))
        throw new ForbiddenException("Butuh permission hr.read");
      return this.expenses.list(tx, query);
    });
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.expenses.assertCanSee(tx, id);
      return this.expenses.get(tx, id);
    });
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(expenseClaimSchema, body);
    return this.tenantDb.run((tx) => this.expenses.create(tx, input));
  }

  @Put(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(expenseClaimSchema, body);
    return this.tenantDb.run((tx) => this.expenses.update(tx, id, input));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.expenses.remove(tx, id));
  }

  @Post(":id/submit")
  @HttpCode(200)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.expenses.submit(tx, id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.expenses.cancel(tx, id));
  }

  @Post(":id/pay")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  pay(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(payClaimSchema, body);
    return this.tenantDb.run((tx) => this.expenses.pay(tx, id, input));
  }

  @Get(":id/lines/:lineId/attachment")
  async attachment(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("lineId", ParseUUIDPipe) lineId: string,
    @Res() res: Response,
  ) {
    const file = await this.tenantDb.run(async (tx) => {
      await this.expenses.assertCanSee(tx, id);
      return this.expenses.attachment(tx, id, lineId);
    });
    res.type(file.type).attachment(file.name).send(file.data);
  }

  /** Penyetuju tahap berjalan (atasan/HR) — diperiksa ApprovalService. */
  @Post(":id/:decision")
  @HttpCode(200)
  decide(@Param("id", ParseUUIDPipe) id: string, @Param("decision") decision: string, @Body() body: unknown) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) =>
      this.expenses.decide(tx, id, decision === "approve" ? "approved" : "refused", input.note),
    );
  }
}

/** Kasbon (uang muka karyawan): karyawan sendiri (portal, `mine=1`) atau HR/payroll. */
@Controller("employee-advances")
class AdvancesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AdvanceService) private readonly advances: AdvanceService,
  ) {}

  @Get()
  list(@Query() query: { employeeId?: string; state?: string; mine?: string }) {
    return this.tenantDb.run(async (tx) => {
      if (query.mine) {
        const own = await this.advances.ownEmployeeId(tx);
        if (!own)
          throw new NotFoundException("Akun Anda belum terhubung dengan data karyawan di perusahaan ini");
        return this.advances.list(tx, { employeeId: own, state: query.state });
      }
      const p = currentContext().permissions;
      if (!hasPermission(p, "hr.read") && !hasPermission(p, "payroll.read"))
        throw new ForbiddenException("Butuh permission hr.read");
      return this.advances.list(tx, query);
    });
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.advances.assertCanSee(tx, id);
      return this.advances.get(tx, id);
    });
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(advanceSchema, body);
    return this.tenantDb.run((tx) => this.advances.create(tx, input));
  }

  @Put(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(advanceSchema, body);
    return this.tenantDb.run((tx) => this.advances.update(tx, id, input));
  }

  @Post(":id/submit")
  @HttpCode(200)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.advances.submit(tx, id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.advances.cancel(tx, id));
  }

  @Post(":id/disburse")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  disburse(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(advanceDisburseSchema, body);
    return this.tenantDb.run((tx) => this.advances.disburse(tx, id, input));
  }

  @Post(":id/settle")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  settle(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(advanceSettleSchema, body);
    return this.tenantDb.run((tx) => this.advances.settle(tx, id, input));
  }
}

const CR = schema.employeeChangeRequests;

/** Tampilan pengajuan perubahan data: nomor rekening dibuka hanya untuk hr.manage. */
function shapeChanges(employees: EmployeeService, changes: Record<string, string | null>, full: boolean) {
  const { bankAccountEnc, ...rest } = changes;
  return {
    ...rest,
    ...(bankAccountEnc !== undefined
      ? { bankAccount: bankAccountEnc ? employees.open(bankAccountEnc, full) : null }
      : {}),
  };
}

/** Pengajuan perubahan data pribadi dari portal, diputuskan HR (hr.manage). */
@Controller("employee-change-requests")
class ChangeRequestsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get()
  @RequirePermission("hr.manage")
  list(@Query("state") state?: string) {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({ request: CR, employee: schema.employees })
        .from(CR)
        .innerJoin(schema.employees, eq(schema.employees.id, CR.employeeId))
        .where(
          and(
            eq(CR.companyId, currentContext().companyId),
            state ? eq(CR.state, state as "confirm") : undefined,
          ),
        )
        .orderBy(desc(CR.createdAt));
      return rows.map(({ request, employee }) => {
        const current = this.employees.reveal(employee, true) as Record<string, unknown>;
        const changes = shapeChanges(this.employees, request.changes, true);
        return {
          ...request,
          changes,
          employeeName: employee.name,
          current: Object.fromEntries(Object.keys(changes).map((k) => [k, current[k] ?? null])),
        };
      });
    });
  }

  @Post(":id/:decision")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  decide(@Param("id", ParseUUIDPipe) id: string, @Param("decision") decision: string, @Body() body: unknown) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const [request] = await tx
        .select()
        .from(CR)
        .where(and(eq(CR.id, id), eq(CR.companyId, currentContext().companyId)))
        .for("update");
      if (!request) throw new NotFoundException("Pengajuan perubahan data tidak ditemukan");
      if (request.state !== "confirm") throw new BadRequestException("Pengajuan sudah diproses");
      const ctx = currentContext();
      const [employee] = await tx
        .select({ userId: schema.employees.userId })
        .from(schema.employees)
        .where(eq(schema.employees.id, request.employeeId));
      if (employee?.userId === ctx.userId)
        throw new ForbiddenException("Tidak bisa menyetujui pengajuan sendiri");
      if (decision === "approve") await this.employees.applyChanges(tx, request.employeeId, request.changes);
      const [row] = await tx
        .update(CR)
        .set({
          state: decision === "approve" ? "approved" : "refused",
          decidedBy: ctx.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(CR.id, id))
        .returning();
      return { ...row!, changes: shapeChanges(this.employees, row!.changes, true) };
    });
  }
}

/** Portal karyawan: kategori klaim, lembur, perubahan data, bukti potong A1 milik sendiri. */
@Controller("me")
class PortalExtrasController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
  ) {}

  /** Kategori klaim + plafon yang berlaku untuk golongan saya, terpakai & sisa tahun ini. */
  @Get("expense-categories")
  categories() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx).catch(() => null);
      const year = new Date().toISOString().slice(0, 4);
      const rows = await tx.execute<{
        id: string;
        name: string;
        annual_limit: string | null;
        grade_limit: string | null;
        used: string;
        receipt_required: boolean;
      }>(sql`
        select c.id, c.name, c.annual_limit::text, c.receipt_required,
          (select l.annual_limit::text from expense_category_limits l
            where l.category_id = c.id and l.grade_id = ${employee?.gradeId ?? null}::uuid) as grade_limit,
          (select coalesce(sum(cl.amount), 0)::text from expense_claim_lines cl
             join expense_claims x on x.id = cl.claim_id
            where cl.category_id = c.id and x.employee_id = ${employee?.id ?? null}::uuid
              and x.state in ('confirm', 'approved', 'paid')
              and x.date between ${`${year}-01-01`}::date and ${`${year}-12-31`}::date) as used
        from expense_categories c
        where c.company_id = ${currentContext().companyId} and c.active
        order by c.name`);
      return rows.map((r) => {
        const annualLimit = effectiveClaimLimit(r.annual_limit, r.grade_limit);
        return {
          id: r.id,
          name: r.name,
          annualLimit,
          receiptRequired: r.receipt_required,
          used: r.used,
          remaining:
            annualLimit === null ? null : Math.max(Number(annualLimit) - Number(r.used), 0).toFixed(2),
        };
      });
    });
  }

  @Get("overtimes")
  overtimes() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      return tx
        .select()
        .from(schema.overtimes)
        .where(eq(schema.overtimes.employeeId, employee.id))
        .orderBy(desc(schema.overtimes.date))
        .limit(LIST_LOAD_LIMIT);
    });
  }

  /** Ajukan lembur sendiri: selalu menunggu persetujuan (minimal atasan langsung). */
  @Post("overtimes")
  requestOvertime(@Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const input = parse(overtimeSchema, { ...(body as object), employeeId: employee.id });
      await assertOvertimeAllowed(tx, employee.id);
      const [s] = await tx
        .select({ levels: schema.payrollSettings.overtimeApprovalLevels })
        .from(schema.payrollSettings)
        .where(eq(schema.payrollSettings.companyId, employee.companyId));
      const [row] = await tx
        .insert(schema.overtimes)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          date: input.date,
          hours: input.hours,
          dayType: input.dayType,
          description: input.description ?? null,
          state: "confirm",
          approvalStep: 1,
          approvalLevels: Math.max(s?.levels ?? 1, 1),
        })
        .returning();
      await this.approvals.submitted(
        tx,
        "overtime",
        row!.id,
        employee,
        "Lembur",
        `${input.date} (${input.hours} jam)`,
      );
      const [fresh] = await tx.select().from(schema.overtimes).where(eq(schema.overtimes.id, row!.id));
      return fresh!;
    });
  }

  @Get("change-requests")
  changeRequests() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const rows = await tx
        .select()
        .from(CR)
        .where(eq(CR.employeeId, employee.id))
        .orderBy(desc(CR.createdAt));
      return rows.map((r) => ({ ...r, changes: shapeChanges(this.employees, r.changes, false) }));
    });
  }

  @Post("change-requests")
  requestChange(@Body() body: unknown) {
    const input = parse(employeeChangeSchema, body);
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const [pending] = await tx
        .select({ id: CR.id })
        .from(CR)
        .where(and(eq(CR.employeeId, employee.id), eq(CR.state, "confirm")));
      if (pending)
        throw new BadRequestException("Masih ada pengajuan perubahan data yang menunggu persetujuan");
      const changes: Record<string, string | null> = {};
      for (const field of EMPLOYEE_CHANGE_FIELDS) {
        const value = input[field];
        if (value === undefined) continue;
        if (field === "bankAccount") {
          const digits = value?.replace(/\D/g, "") || null;
          changes.bankAccountEnc = digits ? this.employees.seal(digits) : null;
        } else changes[field] = value;
      }
      const [row] = await tx
        .insert(CR)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          changes,
          note: input.note ?? null,
          createdBy: currentContext().userId,
        })
        .returning();
      return { ...row!, changes: shapeChanges(this.employees, row!.changes, false) };
    });
  }

  /** Bukti potong PPh 21 tahunan (A1) milik sendiri. */
  @Get("withholding-slips")
  withholdingSlips() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const W = schema.withholdingSlips;
      return tx
        .select({
          id: W.id,
          periodYear: W.periodYear,
          monthStart: W.monthStart,
          monthEnd: W.monthEnd,
          bupotNumber: W.bupotNumber,
          state: W.state,
          taxBase: W.taxBase,
          taxAmount: W.taxAmount,
          details: W.details,
        })
        .from(W)
        .where(and(eq(W.employeeId, employee.id), eq(W.kind, "bpa1"), ne(W.state, "cancelled")))
        .orderBy(desc(W.periodYear));
    });
  }
}

/** Klaim biaya, perubahan data pribadi, dan fitur portal karyawan tambahan. */
@Module({
  imports: [AccountingModule, HrModule],
  controllers: [
    ExpenseCategoriesController,
    ExpenseCategoryLimitsController,
    ExpenseClaimsController,
    AdvancesController,
    ChangeRequestsController,
    PortalExtrasController,
  ],
  providers: [ActivityService, SequenceService, ExpenseService, AdvanceService],
  exports: [ExpenseService, AdvanceService],
})
export class ExpenseModule {}
