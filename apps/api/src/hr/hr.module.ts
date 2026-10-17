import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, isNull, lte, schema, sql, type Db } from "@erp/db";
import {
  attendanceSchema,
  checkInSchema,
  contractSchema,
  departmentSchema,
  employeeSchema,
  holidaySchema,
  jobPositionSchema,
  leaveAllocationSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  overtimeSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { EmployeeService } from "./employee.service.js";
import { LeaveService } from "./leave.service.js";

/** Karyawan yang dirujuk harus milik perusahaan yang sama. */
const sameCompanyEmployee = async (tx: Db, values: Record<string, unknown>) => {
  if (typeof values.employeeId !== "string") return;
  const [row] = await tx
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.id, values.employeeId),
        eq(schema.employees.companyId, String(values.companyId)),
      ),
    );
  if (!row) throw fieldError("employeeId", "Karyawan tidak ditemukan di perusahaan ini");
};

const DepartmentsController = createCrudController({
  path: "departments",
  model: "department",
  table: schema.departments,
  schema: departmentSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.departments.name],
  orderBy: schema.departments.name,
  companyColumn: schema.departments.companyId,
  perCompany: true,
  refs: { parentId: schema.departments, managerId: schema.employees },
});

const JobPositionsController = createCrudController({
  path: "job-positions",
  model: "job_position",
  table: schema.jobPositions,
  schema: jobPositionSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.jobPositions.name],
  orderBy: schema.jobPositions.name,
});

const HolidaysController = createCrudController({
  path: "public-holidays",
  model: "public_holiday",
  table: schema.publicHolidays,
  schema: holidaySchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.publicHolidays.name],
  orderBy: schema.publicHolidays.date,
});

const LeaveTypesController = createCrudController({
  path: "leave-types",
  model: "leave_type",
  table: schema.leaveTypes,
  schema: leaveTypeSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.leaveTypes.name],
  orderBy: schema.leaveTypes.name,
});

const LeaveAllocationsController = createCrudController({
  path: "leave-allocations",
  model: "leave_allocation",
  table: schema.leaveAllocations,
  schema: leaveAllocationSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [],
  orderBy: schema.leaveAllocations.dateFrom,
  companyColumn: schema.leaveAllocations.companyId,
  perCompany: true,
  refs: { leaveTypeId: schema.leaveTypes },
  beforeSave: async (tx, values) => {
    await sameCompanyEmployee(tx, values);
    if (
      typeof values.dateFrom === "string" &&
      typeof values.dateTo === "string" &&
      values.dateTo < values.dateFrom
    )
      throw fieldError("dateTo", "Tanggal akhir sebelum tanggal mulai");
  },
});

const OvertimesController = createCrudController({
  path: "overtimes",
  model: "overtime",
  table: schema.overtimes,
  schema: overtimeSchema,
  read: "hr.read",
  write: "hr.write",
  searchColumns: [schema.overtimes.description],
  orderBy: schema.overtimes.date,
  companyColumn: schema.overtimes.companyId,
  perCompany: true,
  beforeSave: async (tx, values, id) => {
    await sameCompanyEmployee(tx, values);
    if (id) {
      const [row] = await tx.select().from(schema.overtimes).where(eq(schema.overtimes.id, id));
      if (row?.payslipId) throw new BadRequestException("Lembur sudah dibayar lewat slip gaji");
    }
  },
  beforeDelete: async (_tx, row) => {
    if (row.payslipId) throw new BadRequestException("Lembur sudah dibayar lewat slip gaji");
  },
});

@Controller("employees")
class EmployeesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(
    @Query() query: { q?: string; departmentId?: string; active?: string; limit?: string; offset?: string },
  ) {
    return this.tenantDb.run((tx) => this.employees.list(tx, query));
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => this.employees.reveal(await this.employees.find(tx, id)));
  }

  @Post()
  @RequirePermission("hr.write")
  create(@Body() body: unknown) {
    const input = parse(employeeSchema, body);
    return this.tenantDb.run((tx) => this.employees.create(tx, input));
  }

  @Patch(":id")
  @RequirePermission("hr.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const values = parse(employeeSchema.partial().strip(), body);
    const sent = Object.fromEntries(
      Object.entries(values).filter(([k]) => body !== null && typeof body === "object" && k in body),
    );
    return this.tenantDb.run((tx) => this.employees.update(tx, id, sent));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.employees.remove(tx, id));
  }
}

const C = schema.contracts;

/** Kontrak kerja (PKWT/PKWTT) beserta tunjangan tetap/tidak tetap bulanan. */
@Controller("contracts")
class ContractsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  @RequirePermission("hr.manage")
  async list(@Query("employeeId") employeeId?: string, @Query("state") state?: string) {
    const items = await this.tenantDb.run((tx) =>
      tx
        .select({ contract: C, employeeName: schema.employees.name })
        .from(C)
        .innerJoin(schema.employees, eq(schema.employees.id, C.employeeId))
        .where(
          and(
            eq(C.companyId, currentContext().companyId),
            employeeId ? eq(C.employeeId, employeeId) : undefined,
            state ? eq(C.state, state as "running") : undefined,
          ),
        )
        .orderBy(desc(C.dateStart)),
    );
    return {
      items: items.map((r) => ({ ...r.contract, employeeName: r.employeeName })),
      total: items.length,
    };
  }

  @Get(":id")
  @RequirePermission("hr.manage")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.load(tx, id));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(contractSchema, body);
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, input.employeeId);
      await this.assertComponents(
        tx,
        input.allowances.map((a) => a.componentId),
      );
      const name = await this.sequences.next(
        tx,
        "hr.contract",
        employee.companyId,
        new Date(`${input.dateStart}T00:00:00Z`),
        "KTR",
      );
      const [row] = await tx
        .insert(C)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          name,
          contractType: input.contractType,
          dateStart: input.dateStart,
          dateEnd: input.dateEnd ?? null,
          wage: input.wage,
          note: input.note ?? null,
        })
        .returning();
      if (input.allowances.length)
        await tx
          .insert(schema.contractAllowances)
          .values(input.allowances.map((a) => ({ ...a, contractId: row!.id })));
      await this.activity.log(tx, {
        resModel: "employee",
        resId: employee.id,
        action: "comment",
        message: `Kontrak ${name} dibuat`,
      });
      return this.load(tx, row!.id);
    });
  }

  /** Ubah kontrak draft/berjalan (gaji baru berlaku pada payroll berikutnya). */
  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(contractSchema, body);
    return this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      if (contract.state !== "draft" && contract.state !== "running")
        throw new BadRequestException("Kontrak selesai/batal tidak bisa diubah");
      if (input.employeeId !== contract.employeeId)
        throw fieldError("employeeId", "Karyawan kontrak tidak bisa diganti");
      await this.assertComponents(
        tx,
        input.allowances.map((a) => a.componentId),
      );
      await tx
        .update(C)
        .set({
          contractType: input.contractType,
          dateStart: input.dateStart,
          dateEnd: input.dateEnd ?? null,
          wage: input.wage,
          note: input.note ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(C.id, id));
      await tx.delete(schema.contractAllowances).where(eq(schema.contractAllowances.contractId, id));
      if (input.allowances.length)
        await tx
          .insert(schema.contractAllowances)
          .values(input.allowances.map((a) => ({ ...a, contractId: id })));
      await this.activity.log(tx, {
        resModel: "employee",
        resId: contract.employeeId,
        action: "comment",
        message: `Kontrak ${contract.name} diubah (gaji pokok ${new Decimal(input.wage).toFixed(0)})`,
      });
      return this.load(tx, id);
    });
  }

  /** Mulai berlaku; hanya satu kontrak berjalan per karyawan. */
  @Post(":id/start")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  start(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      if (contract.state !== "draft") throw new BadRequestException("Hanya kontrak draft yang bisa dimulai");
      const [running] = await tx
        .select({ name: C.name })
        .from(C)
        .where(and(eq(C.employeeId, contract.employeeId), eq(C.state, "running")));
      if (running)
        throw new BadRequestException(`Karyawan masih punya kontrak berjalan (${running.name}); akhiri dulu`);
      await tx
        .update(C)
        .set({ state: "running", updatedAt: sql`now()` })
        .where(eq(C.id, id));
      return this.load(tx, id);
    });
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  close(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { dateEnd } = parse(z.object({ dateEnd: z.string().date().optional() }), body ?? {});
    return this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      if (contract.state !== "running")
        throw new BadRequestException("Hanya kontrak berjalan yang bisa diakhiri");
      const end = dateEnd ?? contract.dateEnd ?? new Date().toISOString().slice(0, 10);
      if (end < contract.dateStart) throw fieldError("dateEnd", "Tanggal berakhir sebelum mulai");
      await tx
        .update(C)
        .set({ state: "closed", dateEnd: end, updatedAt: sql`now()` })
        .where(eq(C.id, id));
      return this.load(tx, id);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      if (contract.state !== "draft") throw new BadRequestException("Hanya kontrak draft yang bisa dihapus");
      await tx.delete(C).where(eq(C.id, id));
    });
  }

  private async assertComponents(tx: Db, ids: string[]) {
    for (const [i, id] of ids.entries()) {
      const [row] = await tx
        .select({ kind: schema.salaryComponents.kind })
        .from(schema.salaryComponents)
        .where(
          and(
            eq(schema.salaryComponents.id, id),
            eq(schema.salaryComponents.companyId, currentContext().companyId),
          ),
        );
      if (!row) throw fieldError(`allowances.${i}.componentId`, "Komponen gaji tidak ditemukan");
    }
    if (new Set(ids).size !== ids.length) throw fieldError("allowances", "Komponen ganda");
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Kontrak tidak ditemukan");
    return row;
  }

  private async load(tx: Db, id: string) {
    const contract = await this.find(tx, id);
    const allowances = await tx
      .select({
        id: schema.contractAllowances.id,
        componentId: schema.contractAllowances.componentId,
        amount: schema.contractAllowances.amount,
        code: schema.salaryComponents.code,
        name: schema.salaryComponents.name,
        kind: schema.salaryComponents.kind,
        fixed: schema.salaryComponents.fixed,
      })
      .from(schema.contractAllowances)
      .innerJoin(
        schema.salaryComponents,
        eq(schema.salaryComponents.id, schema.contractAllowances.componentId),
      )
      .where(eq(schema.contractAllowances.contractId, id))
      .orderBy(asc(schema.salaryComponents.code));
    const [employee] = await tx
      .select({ name: schema.employees.name })
      .from(schema.employees)
      .where(eq(schema.employees.id, contract.employeeId));
    return { ...contract, employeeName: employee?.name ?? "", allowances };
  }
}

@Controller("leaves")
class LeavesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LeaveService) private readonly leaves: LeaveService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query() query: { employeeId?: string; state?: string }) {
    return this.tenantDb.run((tx) => this.leaves.list(tx, query));
  }

  @Get("balances")
  @RequirePermission("hr.read")
  balances(@Query("employeeId", ParseUUIDPipe) employeeId: string, @Query("date") date?: string) {
    return this.tenantDb.run((tx) => this.leaves.balances(tx, employeeId, date));
  }

  /** Pengajuan cuti (diri sendiri tanpa permission khusus; untuk orang lain butuh hr.write). */
  @Post()
  create(@Body() body: unknown) {
    const input = parse(leaveRequestSchema, body);
    return this.tenantDb.run((tx) => this.leaves.request(tx, input));
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermission("hr.write")
  approve(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leaves.decide(tx, id, "approved"));
  }

  @Post(":id/refuse")
  @HttpCode(200)
  @RequirePermission("hr.write")
  refuse(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leaves.decide(tx, id, "refused"));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leaves.cancel(tx, id));
  }
}

const AT = schema.attendances;
const hoursOf = (a: { checkIn: Date; checkOut: Date | null }) =>
  a.checkOut
    ? new Decimal(a.checkOut.getTime() - a.checkIn.getTime()).div(3_600_000).toDecimalPlaces(2).toFixed(2)
    : null;

@Controller("attendance")
class AttendanceController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  /** Absen masuk untuk karyawan yang terhubung dengan user ini. */
  @Post("check-in")
  @HttpCode(200)
  checkIn(@Body() body: unknown) {
    const input = parse(checkInSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const [open] = await tx
        .select({ id: AT.id })
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut)));
      if (open) throw new BadRequestException("Anda sudah absen masuk; absen pulang dulu");
      const [row] = await tx
        .insert(AT)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          checkIn: new Date(),
          latitude: input.latitude?.toString() ?? null,
          longitude: input.longitude?.toString() ?? null,
        })
        .returning();
      return row!;
    });
  }

  @Post("check-out")
  @HttpCode(200)
  checkOut() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const [open] = await tx
        .select()
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut)));
      if (!open) throw new BadRequestException("Belum absen masuk");
      const [row] = await tx.update(AT).set({ checkOut: new Date() }).where(eq(AT.id, open.id)).returning();
      return { ...row!, workedHours: hoursOf(row!) };
    });
  }

  @Get()
  @RequirePermission("hr.read")
  async list(@Query() query: unknown) {
    const q = parse(
      z.object({ employeeId: z.string().uuid().optional(), from: z.string().date(), to: z.string().date() }),
      query,
    );
    const rows = await this.tenantDb.run((tx) =>
      tx
        .select({ attendance: AT, employeeName: schema.employees.name })
        .from(AT)
        .innerJoin(schema.employees, eq(schema.employees.id, AT.employeeId))
        .where(
          and(
            eq(AT.companyId, currentContext().companyId),
            q.employeeId ? eq(AT.employeeId, q.employeeId) : undefined,
            gte(AT.checkIn, new Date(`${q.from}T00:00:00Z`)),
            lte(AT.checkIn, new Date(`${q.to}T23:59:59Z`)),
          ),
        )
        .orderBy(desc(AT.checkIn))
        .limit(1000),
    );
    return rows.map((r) => ({
      ...r.attendance,
      employeeName: r.employeeName,
      workedHours: hoursOf(r.attendance),
    }));
  }

  /** Input/koreksi manual oleh HR. */
  @Post()
  @RequirePermission("hr.write")
  create(@Body() body: unknown) {
    const input = parse(attendanceSchema, body);
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, input.employeeId);
      const [row] = await tx
        .insert(AT)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          checkIn: new Date(input.checkIn),
          checkOut: input.checkOut ? new Date(input.checkOut) : null,
          source: "manual",
        })
        .returning();
      return { ...row!, workedHours: hoursOf(row!) };
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) =>
      tx.delete(AT).where(and(eq(AT.id, id), eq(AT.companyId, currentContext().companyId))),
    );
  }
}

/** Portal karyawan: data diri, absensi, dan saldo cuti milik user yang login. */
@Controller("me")
class PortalController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(LeaveService) private readonly leaves: LeaveService,
  ) {}

  @Get("employee")
  employee() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const [open] = await tx
        .select()
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut)));
      // Data sensitif milik sendiri tetap tersamar di portal.
      return { ...this.employees.reveal(employee, false), openAttendance: open ?? null };
    });
  }

  @Get("attendance")
  attendance() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const rows = await tx
        .select()
        .from(AT)
        .where(eq(AT.employeeId, employee.id))
        .orderBy(desc(AT.checkIn))
        .limit(31);
      return rows.map((r) => ({ ...r, workedHours: hoursOf(r) }));
    });
  }

  @Get("leaves")
  myLeaves() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      return {
        requests: await this.leaves.list(tx, { employeeId: employee.id }),
        balances: await this.leaves.balances(tx, employee.id),
      };
    });
  }

  @Get("leave-types")
  leaveTypes() {
    return this.tenantDb.run((tx) =>
      tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.active, true))
        .orderBy(asc(schema.leaveTypes.name)),
    );
  }
}

@Module({
  controllers: [
    DepartmentsController,
    JobPositionsController,
    HolidaysController,
    LeaveTypesController,
    LeaveAllocationsController,
    OvertimesController,
    EmployeesController,
    ContractsController,
    LeavesController,
    AttendanceController,
    PortalController,
  ],
  providers: [ActivityService, SequenceService, EmployeeService, LeaveService],
  exports: [EmployeeService, LeaveService],
})
export class HrModule {}
