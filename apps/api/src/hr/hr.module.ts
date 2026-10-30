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
  Req,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, isNull, lte, ne, schema, sql, type Db } from "@erp/db";
import {
  attendanceSchema,
  checkInSchema,
  contractSchema,
  departmentSchema,
  addDays,
  employeeSchema,
  gradePosition,
  holidaySchema,
  jobPositionSchema,
  leaveAllocationSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  bulkLeaveSchema,
  overtimeSchema,
  approvalDecisionSchema,
  salaryGradeSchema,
  shiftAssignmentSchema,
  workEntrySchema,
  workScheduleSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ApprovalEngineService } from "./approval-engine.service.js";
import { ATTENDANCE_COLUMNS, AttendanceService } from "./attendance.service.js";
import { ApprovalService, beginApproval, type ApprovalModel } from "./approval.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { ChecklistService } from "./checklist.service.js";
import { ContractService } from "./contract.service.js";
import { HistoryService } from "./history.service.js";
import { EmployeeService } from "./employee.service.js";
import { LeaveService } from "./leave.service.js";
import { WorkCalendarController } from "./work-calendar.controller.js";
import { WorkCalendarService } from "./work-calendar.service.js";
import { localDate, ScheduleService } from "./schedule.service.js";

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
  refs: { gradeId: schema.salaryGrades },
});

/** Golongan upah — struktur & skala upah (PP 36/2021). */
const SalaryGradesController = createCrudController({
  path: "salary-grades",
  model: "salary_grade",
  table: schema.salaryGrades,
  schema: salaryGradeSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.salaryGrades.code, schema.salaryGrades.name],
  orderBy: schema.salaryGrades.sequence,
  beforeSave: async (tx, values, id) => {
    let { minWage, maxWage } = values as { minWage?: string; maxWage?: string };
    if (id && (minWage === undefined || maxWage === undefined)) {
      const [row] = await tx.select().from(schema.salaryGrades).where(eq(schema.salaryGrades.id, id));
      minWage ??= row?.minWage;
      maxWage ??= row?.maxWage;
    }
    if (minWage !== undefined && maxWage !== undefined && new Decimal(maxWage).lt(minWage))
      throw fieldError("maxWage", "Upah maksimum di bawah upah minimum");
  },
});

/** Golongan upah karyawan lewat jabatannya. */
async function gradeOf(tx: Db, employeeId: string) {
  const [row] = await tx
    .select({ grade: schema.salaryGrades })
    .from(schema.employees)
    .innerJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
    .innerJoin(schema.salaryGrades, eq(schema.salaryGrades.id, schema.jobPositions.gradeId))
    .where(eq(schema.employees.id, employeeId));
  return row?.grade ?? null;
}

/** Laporan struktur & skala upah: upah kontrak berjalan dibandingkan rentang golongan jabatan. */
@Controller("hr/wage-scale")
class WageScaleController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.manage")
  report() {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({
          employeeId: schema.employees.id,
          employeeNumber: schema.employees.employeeNumber,
          name: schema.employees.name,
          jobName: schema.jobPositions.name,
          wage: schema.contracts.wage,
          wageType: schema.contracts.wageType,
          grade: schema.salaryGrades,
        })
        .from(schema.contracts)
        .innerJoin(schema.employees, eq(schema.employees.id, schema.contracts.employeeId))
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
        .leftJoin(schema.salaryGrades, eq(schema.salaryGrades.id, schema.jobPositions.gradeId))
        .where(
          and(
            eq(schema.contracts.companyId, currentContext().companyId),
            eq(schema.contracts.state, "running"),
            eq(schema.contracts.wageType, "monthly"),
          ),
        )
        .orderBy(asc(schema.salaryGrades.sequence), asc(schema.employees.name));
      const items = rows.map((r) => ({
        employeeId: r.employeeId,
        employeeNumber: r.employeeNumber,
        name: r.name,
        jobName: r.jobName,
        wage: r.wage,
        grade: r.grade ? { id: r.grade.id, code: r.grade.code, name: r.grade.name } : null,
        minWage: r.grade?.minWage ?? null,
        maxWage: r.grade?.maxWage ?? null,
        position: r.grade ? gradePosition(r.wage, r.grade) : null,
      }));
      // Ringkasan per golongan: jumlah karyawan, upah terendah/tertinggi/rata-rata.
      const byGrade = new Map<string, typeof items>();
      for (const i of items) {
        const key = i.grade?.code ?? "";
        byGrade.set(key, [...(byGrade.get(key) ?? []), i]);
      }
      const grades = [...byGrade.entries()].map(([code, list]) => {
        const wages = list.map((i) => new Decimal(i.wage));
        return {
          code: code || null,
          name: list[0]!.grade?.name ?? null,
          minWage: list[0]!.minWage,
          maxWage: list[0]!.maxWage,
          employees: list.length,
          lowest: Decimal.min(...wages).toFixed(0),
          highest: Decimal.max(...wages).toFixed(0),
          average: wages
            .reduce((sum, w) => sum.plus(w), new Decimal(0))
            .div(wages.length)
            .toFixed(0),
          outOfRange: list.filter((i) => i.position && i.position !== "within").length,
        };
      });
      return { grades, items };
    });
  }
}

const HolidaysController = createCrudController({
  path: "public-holidays",
  model: "public_holiday",
  table: schema.publicHolidays,
  schema: holidaySchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.publicHolidays.name],
  orderBy: schema.publicHolidays.date,
  // Kosong = libur semua perusahaan; terisi = libur khusus perusahaan itu.
  companyColumn: schema.publicHolidays.companyId,
  refs: { companyId: schema.companies },
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

/** Lembur baru menunggu persetujuan bila perusahaan mewajibkannya (pengaturan payroll). */
export async function applyOvertimeApproval(tx: Db, row: { id: string; companyId?: unknown }) {
  if (await beginApproval(tx, "overtime", row.id)) return;
  const [s] = await tx
    .select({ levels: schema.payrollSettings.overtimeApprovalLevels })
    .from(schema.payrollSettings)
    .where(eq(schema.payrollSettings.companyId, String(row.companyId)));
  if (s && s.levels > 0)
    await tx
      .update(schema.overtimes)
      .set({ state: "confirm", approvalLevels: s.levels, approvalStep: 1 })
      .where(eq(schema.overtimes.id, row.id));
}

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
  afterCreate: (tx, row) => applyOvertimeApproval(tx, row),
});

const WorkSchedulesController = createCrudController({
  path: "work-schedules",
  model: "work_schedule",
  table: schema.workSchedules,
  schema: workScheduleSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.workSchedules.name],
  orderBy: schema.workSchedules.name,
  companyColumn: schema.workSchedules.companyId,
  perCompany: true,
});

const ShiftAssignmentsController = createCrudController({
  path: "shift-assignments",
  model: "shift_assignment",
  table: schema.shiftAssignments,
  schema: shiftAssignmentSchema,
  read: "hr.read",
  write: "hr.write",
  searchColumns: [],
  orderBy: schema.shiftAssignments.dateFrom,
  companyColumn: schema.shiftAssignments.companyId,
  perCompany: true,
  refs: { scheduleId: schema.workSchedules },
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

/** Hasil kerja borongan (satuan per tanggal) untuk upah borongan di payroll. */
const WorkEntriesController = createCrudController({
  path: "work-entries",
  model: "work_entry",
  table: schema.workEntries,
  schema: workEntrySchema,
  read: "hr.read",
  write: "hr.write",
  searchColumns: [schema.workEntries.description],
  orderBy: schema.workEntries.date,
  companyColumn: schema.workEntries.companyId,
  perCompany: true,
  beforeSave: async (tx, values, id) => {
    await sameCompanyEmployee(tx, values);
    if (id) {
      const [row] = await tx.select().from(schema.workEntries).where(eq(schema.workEntries.id, id));
      if (row?.payslipId) throw new BadRequestException("Hasil kerja sudah dibayar lewat slip gaji");
    }
  },
  beforeDelete: async (_tx, row) => {
    if (row.payslipId) throw new BadRequestException("Hasil kerja sudah dibayar lewat slip gaji");
  },
});

/** Persetujuan berjenjang cuti & lembur. */
@Controller("approvals")
class ApprovalsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
  ) {}

  /** Pengajuan yang menunggu keputusan user ini. */
  @Get("pending")
  pending() {
    return this.tenantDb.run((tx) => this.approvals.pending(tx));
  }

  @Get(":model/:id")
  status(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string) {
    if (
      !["leave_request", "overtime", "expense_claim", "attendance_request", "shift_request"].includes(model)
    )
      throw new NotFoundException();
    return this.tenantDb.run((tx) => this.approvals.status(tx, model as ApprovalModel, id));
  }

  @Post("overtime/:id/:decision")
  @HttpCode(200)
  overtime(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("decision") decision: string,
    @Body() body: unknown,
  ) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) =>
      this.approvals.decide(tx, "overtime", id, decision === "approve" ? "approved" : "refused", input.note),
    );
  }
}

@Controller("employees")
class EmployeesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
    @Inject(HistoryService) private readonly history: HistoryService,
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

  /** Ringkasan untuk kepala form karyawan: statistik, kontrak berjalan, status akun portal. */
  @Get(":id/overview")
  @RequirePermission("hr.read")
  overview(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, id);
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      const [stats] = await tx.execute<{
        appraisals: number;
        open_appraisals: number;
        goals: number;
        hours: string;
        has_photo: boolean;
        projects: number;
        project_hours: string;
      }>(sql`
        select
          (select count(*) from appraisals a where a.employee_id = ${id})::int as appraisals,
          (select count(*) from appraisals a where a.employee_id = ${id} and a.state <> 'done')::int as open_appraisals,
          (select count(*) from performance_goals g where g.employee_id = ${id} and g.state = 'active')::int as goals,
          (select coalesce(sum(extract(epoch from (a.check_out - a.check_in))) / 3600, 0)::numeric(10,2)::text
             from attendances a
            where a.employee_id = ${id} and a.check_out is not null and a.state <> 'refused'
              and a.check_in >= ${monthStart}::date) as hours,
          exists (select 1 from employee_photos p where p.employee_id = ${id}) as has_photo,
          (select count(*) from external_projects p
            where p.status = 'active' and (p.manager_employee_id = ${id}
              or exists (select 1 from external_project_members m where m.project_id = p.id and m.employee_id = ${id})))::int as projects,
          (select coalesce(sum(t.hours), 0)::text from external_timesheets t
            where t.employee_id = ${id} and t.date >= ${monthStart}::date) as project_hours`);
      const [contract] = await tx
        .select()
        .from(C)
        .where(and(eq(C.employeeId, id), eq(C.state, "running")))
        .orderBy(desc(C.dateStart))
        .limit(1);
      let fixedAllowance = "0";
      if (contract) {
        const [row] = await tx
          .select({ total: sql<string>`coalesce(sum(${schema.contractAllowances.amount}), 0)::text` })
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
        fixedAllowance = row?.total ?? "0";
      }
      const [user] = employee.userId
        ? await tx
            .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
            .from(schema.users)
            .where(eq(schema.users.id, employee.userId))
        : [];
      const [invitation] = await tx
        .select({
          email: schema.invitations.email,
          expiresAt: schema.invitations.expiresAt,
          acceptedAt: schema.invitations.acceptedAt,
          createdAt: schema.invitations.createdAt,
        })
        .from(schema.invitations)
        .where(eq(schema.invitations.employeeId, id))
        .orderBy(desc(schema.invitations.createdAt))
        .limit(1);
      const pending = invitation && !invitation.acceptedAt && invitation.expiresAt > new Date();
      return {
        appraisals: stats?.appraisals ?? 0,
        openAppraisals: stats?.open_appraisals ?? 0,
        goals: stats?.goals ?? 0,
        hoursThisMonth: stats?.hours ?? "0",
        hasPhoto: stats?.has_photo ?? false,
        projects: stats?.projects ?? 0,
        projectHoursThisMonth: stats?.project_hours ?? "0",
        contract: contract
          ? {
              id: contract.id,
              name: contract.name,
              contractType: contract.contractType,
              wage: contract.wage,
              wageType: contract.wageType,
              taxMethod: contract.taxMethod,
              dateStart: contract.dateStart,
              dateEnd: contract.dateEnd,
              fixedAllowance,
            }
          : null,
        account: user
          ? { status: "linked" as const, userId: user.id, name: user.name, email: user.email }
          : pending
            ? { status: "invited" as const, email: invitation.email, expiresAt: invitation.expiresAt }
            : { status: "none" as const },
      };
    });
  }

  @Post()
  @RequirePermission("hr.write")
  create(@Body() body: unknown) {
    const input = parse(employeeSchema, body);
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.create(tx, input);
      await this.history.record(tx, employee, "join", {
        date: employee.joinDate,
        newValue: employee.joinDate,
      });
      // Onboarding otomatis untuk karyawan baru (bukan impor data lama).
      if (employee.joinDate >= addDays(new Date().toISOString().slice(0, 10), -30))
        await this.checklists.autoStart(tx, employee.id, "onboarding");
      return employee;
    });
  }

  @Patch(":id")
  @RequirePermission("hr.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const values = parse(employeeSchema.partial().strip(), body);
    const sent = Object.fromEntries(
      Object.entries(values).filter(([k]) => body !== null && typeof body === "object" && k in body),
    );
    return this.tenantDb.run(async (tx) => {
      const before = await this.employees.find(tx, id);
      const employee = await this.employees.update(tx, id, sent);
      await this.history.diff(tx, before, await this.employees.find(tx, id));
      // Tanggal keluar baru diisi → checklist offboarding.
      if (employee.resignDate && !before.resignDate) await this.checklists.autoStart(tx, id, "offboarding");
      return employee;
    });
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
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ContractService) private readonly contracts: ContractService,
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
    return this.tenantDb.run(async (tx) => this.load(tx, await this.contracts.create(tx, input)));
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
          wageType: input.wageType,
          dateStart: input.dateStart,
          dateEnd: input.dateEnd ?? null,
          taxMethod: input.taxMethod,
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
      await this.contracts.start(tx, id);
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

  private find(tx: Db, id: string) {
    return this.contracts.find(tx, id);
  }

  private assertComponents(tx: Db, ids: string[]) {
    return this.contracts.assertComponents(tx, ids);
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
    const grade = await gradeOf(tx, contract.employeeId);
    return {
      ...contract,
      employeeName: employee?.name ?? "",
      allowances,
      // Peringatan struktur & skala upah: upah pokok di luar rentang golongan jabatan.
      grade: grade
        ? {
            code: grade.code,
            name: grade.name,
            minWage: grade.minWage,
            maxWage: grade.maxWage,
            position: contract.wageType === "monthly" ? gradePosition(contract.wage, grade) : null,
          }
        : null,
    };
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

  /** Laporan saldo cuti semua karyawan aktif pada tanggal (termasuk yang akan kedaluwarsa). */
  @Get("balance-report")
  @RequirePermission("hr.read")
  balanceReport(@Query() query: { date?: string; departmentId?: string }) {
    return this.tenantDb.run((tx) => this.leaves.balanceReport(tx, query));
  }

  /** Buku besar cuti satu karyawan × jenis cuti. */
  @Get("ledger")
  @RequirePermission("hr.read")
  ledger(
    @Query("employeeId", ParseUUIDPipe) employeeId: string,
    @Query("leaveTypeId", ParseUUIDPipe) leaveTypeId: string,
  ) {
    return this.tenantDb.run((tx) => this.leaves.ledgerReport(tx, employeeId, leaveTypeId));
  }

  @Get("compensable-overtimes")
  @RequirePermission("hr.read")
  compensable() {
    return this.tenantDb.run((tx) => this.leaves.compensableOvertimes(tx));
  }

  @Get("bulk")
  @RequirePermission("hr.read")
  bulkList() {
    return this.tenantDb.run((tx) => this.leaves.bulkList(tx));
  }

  /** Cuti massal / cuti bersama (langsung disetujui). */
  @Post("bulk")
  @HttpCode(200)
  @RequirePermission("hr.write")
  bulk(@Body() body: unknown) {
    const input = parse(bulkLeaveSchema, body);
    return this.tenantDb.run((tx) => this.leaves.bulk(tx, input));
  }

  @Post("bulk/:bulkId/cancel")
  @HttpCode(200)
  @RequirePermission("hr.write")
  cancelBulk(@Param("bulkId", ParseUUIDPipe) bulkId: string) {
    return this.tenantDb.run((tx) => this.leaves.cancelBulk(tx, bulkId));
  }

  /** Pengajuan cuti (diri sendiri tanpa permission khusus; untuk orang lain butuh hr.write). */
  @Post()
  create(@Body() body: unknown) {
    const input = parse(leaveRequestSchema, body);
    return this.tenantDb.run((tx) => this.leaves.request(tx, input));
  }

  @Get(":id/attachment")
  async attachment(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.leaves.attachment(tx, id));
    res.type(file.type).attachment(file.name).send(file.data);
  }

  /** Persetujuan berjenjang: atasan pada tahapnya, atau HR (hr.write) di tahap mana pun. */
  @Post(":id/approve")
  @HttpCode(200)
  approve(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) => this.leaves.decide(tx, id, "approved", input.note));
  }

  @Post(":id/refuse")
  @HttpCode(200)
  refuse(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) => this.leaves.decide(tx, id, "refused", input.note));
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
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  /** Rekap keterlambatan per karyawan (jadwal/shift & aturan potongan). */
  @Get("lateness")
  @RequirePermission("hr.read")
  lateness(@Query() query: unknown) {
    const q = parse(
      z.object({ from: z.string().date(), to: z.string().date(), employeeId: z.string().uuid().optional() }),
      query,
    );
    return this.tenantDb.run((tx) =>
      this.schedules.lateness(tx, {
        from: q.from,
        to: q.to,
        employeeIds: q.employeeId ? [q.employeeId] : undefined,
      }),
    );
  }

  /** Absen masuk (portal): lokasi & foto opsional, geofence lokasi kerja, IP & perangkat dicatat. */
  @Post("check-in")
  @HttpCode(200)
  checkIn(@Body() body: unknown, @Req() req: Request) {
    const input = parse(checkInSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const [open] = await tx
        .select({ id: AT.id })
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut), ne(AT.state, "refused")));
      if (open) throw new BadRequestException("Anda sudah absen masuk; absen pulang dulu");
      const { attendance } = await this.attendance.punch(tx, employee, new Date(), {
        source: "web",
        latitude: input.latitude,
        longitude: input.longitude,
        photo: input.photo,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      return attendance;
    });
  }

  @Post("check-out")
  @HttpCode(200)
  checkOut(@Body() body: unknown) {
    const input = parse(checkInSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const [open] = await tx
        .select({ id: AT.id })
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut), ne(AT.state, "refused")));
      if (!open) throw new BadRequestException("Belum absen masuk");
      const { attendance } = await this.attendance.punch(tx, employee, new Date(), {
        source: "web",
        latitude: input.latitude,
        longitude: input.longitude,
      });
      return { ...attendance, workedHours: hoursOf(attendance) };
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
        .select({ attendance: ATTENDANCE_COLUMNS, employeeName: schema.employees.name })
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
      const { tz } = await this.attendance.settings(tx, employee.companyId);
      await this.attendance.assertUnlocked(tx, employee.companyId, localDate(new Date(input.checkIn), tz));
      const [row] = await tx
        .insert(AT)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          checkIn: new Date(input.checkIn),
          checkOut: input.checkOut ? new Date(input.checkOut) : null,
          source: "manual",
        })
        .returning(ATTENDANCE_COLUMNS);
      return { ...row!, workedHours: hoursOf(row!) };
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const [row] = await tx
        .select({ checkIn: AT.checkIn })
        .from(AT)
        .where(and(eq(AT.id, id), eq(AT.companyId, companyId)));
      if (!row) return;
      const { tz } = await this.attendance.settings(tx, companyId);
      await this.attendance.assertUnlocked(tx, companyId, localDate(row.checkIn, tz));
      await tx.delete(AT).where(and(eq(AT.id, id), eq(AT.companyId, companyId)));
    });
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
        .select(ATTENDANCE_COLUMNS)
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut), ne(AT.state, "refused")));
      // Data sensitif milik sendiri tetap tersamar di portal.
      return { ...this.employees.reveal(employee, false), openAttendance: open ?? null };
    });
  }

  @Get("attendance")
  attendance() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const rows = await tx
        .select(ATTENDANCE_COLUMNS)
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

  /** Rekan kerja aktif di perusahaan yang sama (pilihan delegasi tugas saat cuti). */
  @Get("colleagues")
  colleagues() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const E = schema.employees;
      return tx
        .select({ id: E.id, name: E.name })
        .from(E)
        .where(and(eq(E.companyId, employee.companyId), eq(E.active, true), sql`${E.id} <> ${employee.id}`))
        .orderBy(asc(E.name));
    });
  }

  @Get("leave-types")
  leaveTypes() {
    return this.tenantDb.run((tx) =>
      tx
        .select()
        .from(schema.leaveTypes)
        .where(and(eq(schema.leaveTypes.active, true), eq(schema.leaveTypes.employeeRequestable, true)))
        .orderBy(asc(schema.leaveTypes.name)),
    );
  }
}

@Module({
  controllers: [
    DepartmentsController,
    JobPositionsController,
    SalaryGradesController,
    WageScaleController,
    WorkCalendarController,
    HolidaysController,
    LeaveTypesController,
    LeaveAllocationsController,
    OvertimesController,
    WorkSchedulesController,
    ShiftAssignmentsController,
    WorkEntriesController,
    ApprovalsController,
    EmployeesController,
    ContractsController,
    LeavesController,
    AttendanceController,
    PortalController,
  ],
  providers: [
    ActivityService,
    SequenceService,
    EmployeeService,
    LeaveService,
    ApprovalService,
    ApprovalEngineService,
    AttendanceService,
    ScheduleService,
    ChecklistService,
    HistoryService,
    ContractService,
    NotificationService,
    WorkCalendarService,
  ],
  exports: [
    WorkCalendarService,
    NotificationService,
    EmployeeService,
    LeaveService,
    ScheduleService,
    ApprovalService,
    ApprovalEngineService,
    AttendanceService,
    ChecklistService,
    HistoryService,
    ContractService,
  ],
})
export class HrModule {}
