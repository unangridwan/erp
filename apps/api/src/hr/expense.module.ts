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
import { and, asc, desc, eq, ne, schema, sql } from "@erp/db";
import {
  approvalDecisionSchema,
  EMPLOYEE_CHANGE_FIELDS,
  employeeChangeSchema,
  expenseCategorySchema,
  expenseClaimSchema,
  hasPermission,
  overtimeSchema,
  payClaimSchema,
} from "@erp/shared";
import type { Response } from "express";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertCompanyAccounts } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ApprovalService } from "./approval.service.js";
import { EmployeeService } from "./employee.service.js";
import { ExpenseService } from "./expense.service.js";
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

  @Get("expense-categories")
  categories() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: schema.expenseCategories.id,
          name: schema.expenseCategories.name,
          annualLimit: schema.expenseCategories.annualLimit,
        })
        .from(schema.expenseCategories)
        .where(
          and(
            eq(schema.expenseCategories.companyId, currentContext().companyId),
            eq(schema.expenseCategories.active, true),
          ),
        )
        .orderBy(asc(schema.expenseCategories.name)),
    );
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
        .limit(100);
    });
  }

  /** Ajukan lembur sendiri: selalu menunggu persetujuan (minimal atasan langsung). */
  @Post("overtimes")
  requestOvertime(@Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const input = parse(overtimeSchema, { ...(body as object), employeeId: employee.id });
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
    ExpenseClaimsController,
    ChangeRequestsController,
    PortalExtrasController,
  ],
  providers: [ActivityService, SequenceService, ExpenseService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
