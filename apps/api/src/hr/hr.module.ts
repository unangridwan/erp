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
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne, schema, sql, type Db } from "@erp/db";
import {
  attendanceSchema,
  checkInSchema,
  contractEndSchema,
  contractSchema,
  departmentSchema,
  addDays,
  employeeSchema,
  gradePosition,
  gradeWageStatus,
  hasPermission,
  probationDecisionSchema,
  applyGradeBaseWageSchema,
  newEmployeeContractSchema,
  holidaySchema,
  jobPositionSchema,
  leaveAllocationSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  bulkLeaveSchema,
  overtimeSchema,
  overtimeDecisionSchema,
  overtimeGenerateSchema,
  approvalDecisionSchema,
  salaryGradeSchema,
  shiftAssignmentSchema,
  workEntrySchema,
  workScheduleSchema,
  LIST_LOAD_LIMIT,
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
import { ApprovalGateService } from "./approval-gate.service.js";
import { ATTENDANCE_COLUMNS, AttendanceService } from "./attendance.service.js";
import { ApprovalService, beginApproval, type ApprovalModel } from "./approval.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { ChecklistService } from "./checklist.service.js";
import { filledPersonalFields, logPersonalDataAccess } from "./privacy.js";
import { ContractDocumentService } from "./contract-document.service.js";
import { renderOfferPdf } from "./letters-pdf.js";
import {
  assertDatesUnchanged,
  ContractService,
  contractGradeWage,
  contractProbation,
  effectiveGrade,
} from "./contract.service.js";
import { HistoryService } from "./history.service.js";
import { EmployeeService } from "./employee.service.js";
import { LeaveService } from "./leave.service.js";
import { OvertimeService } from "./overtime.service.js";
import { WorkCalendarController } from "./work-calendar.controller.js";
import { WorkCalendarService } from "./work-calendar.service.js";
import { localDate, ScheduleService } from "./schedule.service.js";
import { assertContractType, assertOvertimeAllowed } from "./contract-types.module.js";
import { assertBeforeRetirement, retirementOf } from "./retirement.module.js";

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
    let { minWage, maxWage, baseWage } = values as {
      minWage?: string;
      maxWage?: string;
      baseWage?: string | null;
    };
    if (id && (minWage === undefined || maxWage === undefined || baseWage === undefined)) {
      const [row] = await tx.select().from(schema.salaryGrades).where(eq(schema.salaryGrades.id, id));
      minWage ??= row?.minWage;
      maxWage ??= row?.maxWage;
      if (baseWage === undefined) baseWage = row?.baseWage ?? null;
    }
    if (minWage !== undefined && maxWage !== undefined && new Decimal(maxWage).lt(minWage))
      throw fieldError("maxWage", "Upah maksimum di bawah upah minimum");
    if (baseWage && minWage !== undefined && maxWage !== undefined)
      if (new Decimal(baseWage).lt(minWage) || new Decimal(baseWage).gt(maxWage))
        throw fieldError("baseWage", "Gaji pokok golongan harus di antara upah minimum dan maksimum");
  },
});

/** Golongan upah karyawan: golongan di data karyawan, atau golongan jabatannya. */
async function gradeOf(tx: Db, employeeId: string) {
  const [employee] = await tx
    .select({ gradeId: schema.employees.gradeId, jobId: schema.employees.jobId })
    .from(schema.employees)
    .where(eq(schema.employees.id, employeeId));
  return employee ? effectiveGrade(tx, employee) : null;
}

type BaseWageStatus = "current" | "standard" | "adjusted";

/**
 * Gaji pokok golongan berubah → sesuaikan kontrak berjalan (upah bulanan) karyawan bergolongan itu: kontrak yang
 * mengikuti standar lama diganti kontrak upah baru per tanggal berlaku; yang disesuaikan manual dilewati kecuali
 * diminta. Selisih periode yang sudah dibayar lewat "Hitung rapel" payroll.
 */
@Controller("salary-grades")
class SalaryGradeWageController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ContractService) private readonly contracts: ContractService,
  ) {}

  private async impact(tx: Db, id: string) {
    const [grade] = await tx.select().from(schema.salaryGrades).where(eq(schema.salaryGrades.id, id));
    if (!grade) throw new NotFoundException("Golongan upah tidak ditemukan");
    const rows = await tx
      .select({
        contractId: schema.contracts.id,
        contractName: schema.contracts.name,
        dateStart: schema.contracts.dateStart,
        wage: schema.contracts.wage,
        gradeBaseWage: schema.contracts.gradeBaseWage,
        employeeId: schema.employees.id,
        employeeNumber: schema.employees.employeeNumber,
        employeeName: schema.employees.name,
        companyId: schema.employees.companyId,
      })
      .from(schema.contracts)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.contracts.employeeId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
      .where(
        and(
          eq(schema.contracts.companyId, currentContext().companyId),
          eq(schema.contracts.state, "running"),
          eq(schema.contracts.wageType, "monthly"),
          sql`coalesce(${schema.employees.gradeId}, ${schema.jobPositions.gradeId}) = ${id}`,
        ),
      )
      .orderBy(asc(schema.employees.name));
    const base = grade.baseWage;
    const items = rows.map((r) => {
      const status: BaseWageStatus =
        base && new Decimal(r.wage).eq(base)
          ? "current"
          : r.gradeBaseWage && new Decimal(r.wage).eq(r.gradeBaseWage)
            ? "standard"
            : "adjusted";
      return { ...r, status };
    });
    return { grade, items };
  }

  /** Kontrak berjalan yang terdampak perubahan gaji pokok golongan. */
  @Get(":id/base-wage-impact")
  @RequirePermission("payroll.manage")
  preview(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const { grade, items } = await this.impact(tx, id);
      return {
        grade: { id: grade.id, code: grade.code, name: grade.name, baseWage: grade.baseWage },
        items: items.map(({ companyId: _c, ...i }) => i),
      };
    });
  }

  @Post(":id/apply-base-wage")
  @RequirePermission("payroll.manage")
  apply(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(applyGradeBaseWageSchema, body);
    return this.tenantDb.run(async (tx) => {
      const { grade, items } = await this.impact(tx, id);
      if (!grade.baseWage) throw fieldError("baseWage", "Golongan belum punya gaji pokok standar");
      const updated: { employeeName: string; contractId: string; oldWage: string }[] = [];
      const skipped: { employeeName: string; reason: string }[] = [];
      for (const item of items) {
        if (item.status === "current") continue;
        if (item.status === "adjusted" && !input.includeAdjusted) {
          skipped.push({ employeeName: item.employeeName, reason: "adjusted" });
          continue;
        }
        if (input.effectiveDate <= item.dateStart) {
          skipped.push({ employeeName: item.employeeName, reason: "date" });
          continue;
        }
        const renewed = await this.contracts.renewWage(
          tx,
          { id: item.employeeId, companyId: item.companyId },
          {
            effectiveDate: input.effectiveDate,
            newWage: grade.baseWage,
            note: `penyesuaian gaji pokok golongan ${grade.code}`,
          },
        );
        updated.push({ employeeName: item.employeeName, contractId: renewed.id, oldWage: renewed.oldWage });
      }
      return { updated, skipped };
    });
  }
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
        .leftJoin(
          schema.salaryGrades,
          eq(
            schema.salaryGrades.id,
            sql`coalesce(${schema.employees.gradeId}, ${schema.jobPositions.gradeId})`,
          ),
        )
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
        baseWage: r.grade?.baseWage ?? null,
        position: r.grade ? gradePosition(r.wage, r.grade) : null,
        adjusted: r.grade ? gradeWageStatus(r.wage, r.grade).adjusted : false,
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
          baseWage: list[0]!.baseWage,
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
    if (values.employeeId && values.date) await assertOvertimeAllowed(tx, String(values.employeeId));
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
    @Inject(OvertimeService) private readonly overtimes: OvertimeService,
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

  /** Keputusan lembur; saat menyetujui, atasan boleh mengurangi jam (≤ hasil hitung absensi / jam diajukan). */
  @Post("overtime/:id/:decision")
  @HttpCode(200)
  overtime(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("decision") decision: string,
    @Body() body: unknown,
  ) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(overtimeDecisionSchema, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const result = await this.approvals.decide(
        tx,
        "overtime",
        id,
        decision === "approve" ? "approved" : "refused",
        input.note,
      );
      if (decision === "approve" && input.hours) await this.overtimes.setApprovedHours(tx, id, input.hours);
      return result;
    });
  }
}

/** Hitung lembur dari absensi (HR) untuk rentang tanggal; berjalan juga otomatis bila diaktifkan. */
@Controller("overtimes")
class OvertimeAttendanceController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(OvertimeService) private readonly overtimes: OvertimeService,
  ) {}

  @Post("from-attendance")
  @HttpCode(200)
  @RequirePermission("hr.write")
  generate(@Body() body: unknown) {
    const input = parse(overtimeGenerateSchema, body);
    return this.tenantDb.run((tx) =>
      this.overtimes.syncAttendances(tx, currentContext().companyId, {
        from: input.from,
        to: input.to,
        employeeIds: input.employeeId ? [input.employeeId] : undefined,
        force: true,
      }),
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
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(ContractDocumentService) private readonly documents: ContractDocumentService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list(
    @Query() query: { q?: string; departmentId?: string; active?: string; limit?: string; offset?: string },
  ) {
    return this.tenantDb.run((tx) => this.employees.list(tx, query));
  }

  /** HR mengatur ulang PIN slip karyawan (lupa PIN / terkunci). */
  @Post(":id/payslip-pin/reset")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  resetPayslipPin(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, id);
      await tx
        .update(schema.employees)
        .set({
          payslipPinHash: null,
          payslipPinFailed: 0,
          payslipPinLockedUntil: null,
          payslipUnlockedUntil: null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.employees.id, id));
      await this.activity.log(tx, {
        resModel: "employee",
        resId: id,
        action: "comment",
        message: `PIN slip gaji ${employee.name} diatur ulang`,
      });
      return { ok: true };
    });
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.find(tx, id);
      // Data pribadi terbuka penuh hanya untuk hr.manage; aksesnya dicatat (UU PDP).
      if (hasPermission(currentContext().permissions, "hr.manage"))
        await logPersonalDataAccess(tx, {
          employeeId: employee.id,
          employeeUserId: employee.userId,
          fields: filledPersonalFields(employee),
          purpose: "Membuka data karyawan",
        });
      return this.employees.reveal(employee);
    });
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
      }>(sql`
        select
          (select count(*) from appraisals a where a.employee_id = ${id})::int as appraisals,
          (select count(*) from appraisals a where a.employee_id = ${id} and a.state <> 'done')::int as open_appraisals,
          (select count(*) from performance_goals g where g.employee_id = ${id} and g.state = 'active')::int as goals,
          (select coalesce(sum(extract(epoch from (a.check_out - a.check_in))) / 3600, 0)::numeric(10,2)::text
             from attendances a
            where a.employee_id = ${id} and a.check_out is not null and a.state <> 'refused'
              and a.check_in >= ${monthStart}::date) as hours,
          exists (select 1 from employee_photos p where p.employee_id = ${id}) as has_photo`);
      const [contract] = await tx
        .select()
        .from(C)
        .where(and(eq(C.employeeId, id), eq(C.state, "running")))
        .orderBy(desc(C.dateStart))
        .limit(1);
      // Komponen gaji kontrak (termasuk komponen otomatis); tunjangan tetap = dasar upah BPJS & lembur.
      const components = contract ? await this.documents.components(tx, contract.id, contract.companyId) : [];
      const fixedAllowance = components
        .filter((c) => c.kind === "allowance" && c.fixed && c.calc === "fixed_amount")
        .reduce((sum, c) => sum.plus(c.amount), new Decimal(0))
        .toFixed(2);
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
        retirement: await retirementOf(tx, employee),
        appraisals: stats?.appraisals ?? 0,
        openAppraisals: stats?.open_appraisals ?? 0,
        goals: stats?.goals ?? 0,
        hoursThisMonth: stats?.hours ?? "0",
        hasPhoto: stats?.has_photo ?? false,
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
              components,
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

  /**
   * Karyawan baru beserta kontrak kerjanya (`contract`): tanggal masuk = tanggal mulai kontrak (hanya diinput di
   * kontrak), kontrak dibuat dari template terpilih dan langsung berlaku. Tanpa `contract` (API/integrasi lama) tanggal
   * masuk dari `joinDate`. Hanya pengguna yang berhak mengelola kontrak (hr.manage).
   */
  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const { contract } = parse(z.object({ contract: newEmployeeContractSchema.nullish() }), body ?? {});
    const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const input = parse(
      employeeSchema,
      contract ? { ...raw, joinDate: contract.dateStart, resignDate: null } : raw,
    );
    return this.tenantDb.run(async (tx) => {
      if (contract?.templateId) await this.documents.template(tx, contract.templateId);
      if (contract)
        await assertBeforeRetirement(
          tx,
          {
            ...input,
            companyId: currentContext().companyId,
          } as unknown as typeof schema.employees.$inferSelect,
          { dateStart: contract.dateStart, dateEnd: contract.dateEnd },
          "contract.",
        );
      if (contract)
        await assertContractType(tx, contract.contractType, {
          dateStart: contract.dateStart,
          dateEnd: contract.dateEnd,
          field: "contract.contractType",
          endField: "contract.dateEnd",
        });
      if (contract)
        await this.contracts.assertComponents(
          tx,
          contract.allowances.map((a) => a.componentId),
          "contract.",
        );
      const employee = await this.employees.create(tx, input);
      await this.history.record(tx, employee, "join", {
        date: employee.joinDate,
        newValue: employee.joinDate,
      });
      // Onboarding otomatis untuk karyawan baru (bukan impor data lama).
      if (employee.joinDate >= addDays(new Date().toISOString().slice(0, 10), -30))
        await this.checklists.autoStart(tx, employee.id, "onboarding");
      if (!contract) return employee;
      const contractId = await this.contracts.create(
        tx,
        {
          employeeId: employee.id,
          contractType: contract.contractType,
          wageType: contract.wageType,
          taxMethod: contract.taxMethod,
          dateStart: contract.dateStart,
          dateEnd: contract.dateEnd ?? null,
          wage: contract.wage,
          probationMonths: contract.probationMonths ?? null,
          allowances: contract.allowances,
        },
        "contract.",
      );
      if (contract.templateId)
        await tx
          .update(schema.contracts)
          .set({ templateId: contract.templateId })
          .where(eq(schema.contracts.id, contractId));
      await this.contracts.start(tx, contractId);
      return { ...employee, contractId };
    });
  }

  /** Ubah data karyawan. Tanggal masuk/keluar tidak diubah di sini: keduanya mengikuti kontrak kerja. */
  @Patch(":id")
  @RequirePermission("hr.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const values = parse(employeeSchema.partial().strip(), body);
    const sent = Object.fromEntries(
      Object.entries(values).filter(([k]) => body !== null && typeof body === "object" && k in body),
    );
    return this.tenantDb.run(async (tx) => {
      const before = await this.employees.find(tx, id);
      assertDatesUnchanged(before, sent);
      delete sent.joinDate;
      delete sent.resignDate;
      const employee = await this.employees.update(tx, id, sent);
      await this.history.diff(tx, before, await this.employees.find(tx, id));
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
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ContractDocumentService) private readonly documents: ContractDocumentService,
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
      // Dokumen yang sudah ditandatangani mengikat syarat kontrak; isi template dirender ulang bila belum.
      await this.documents.assertEditable(tx, contract);
      const owner = await this.employees.find(tx, contract.employeeId);
      this.contracts.assertWithinEmployment(owner, input);
      await assertBeforeRetirement(tx, owner, input);
      await assertContractType(tx, input.contractType, input, contract.contractType);
      const pay = await contractGradeWage(tx, owner, input);
      // Hasil evaluasi yang sudah diputuskan tetap; masa percobaan dihitung ulang dari tanggal mulai.
      const probation = contract.probationResult ? {} : await contractProbation(tx, input);
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
          ...pay,
          ...probation,
          note: input.note ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(C.id, id));
      await this.documents.refreshAfterContractChange(tx, contract);
      if (input.dateStart !== contract.dateStart)
        await this.contracts.syncJoinDate(tx, contract.employeeId, {
          before: contract.dateStart,
          after: input.dateStart,
        });
      await tx.delete(schema.contractAllowances).where(eq(schema.contractAllowances.contractId, id));
      if (input.allowances.length)
        await tx
          .insert(schema.contractAllowances)
          .values(input.allowances.map((a) => ({ ...a, contractId: id })));
      await this.activity.log(tx, {
        resModel: "employee",
        resId: contract.employeeId,
        action: "comment",
        message: `Kontrak ${contract.name} diubah (gaji pokok ${new Decimal(pay.wage).toFixed(0)})`,
      });
      return this.load(tx, id);
    });
  }

  /** Hasil evaluasi masa percobaan (lulus/tidak lulus). Tidak lulus: akhiri lewat Akhiri kontrak. */
  @Post(":id/probation")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  probation(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(probationDecisionSchema, body);
    return this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      if (!contract.probationEnd) throw new BadRequestException("Kontrak ini tanpa masa percobaan");
      if (contract.state !== "running")
        throw new BadRequestException("Hanya kontrak berjalan yang dievaluasi");
      await tx
        .update(C)
        .set({
          probationResult: input.result,
          probationNote: input.note ?? null,
          probationDecidedAt: sql`now()`,
          probationDecidedBy: currentContext().userId,
          updatedAt: sql`now()`,
        })
        .where(eq(C.id, id));
      await this.activity.log(tx, {
        resModel: "employee",
        resId: contract.employeeId,
        action: "comment",
        message: `Masa percobaan ${contract.name}: ${input.result === "passed" ? "lulus" : "tidak lulus"}${input.note ? ` — ${input.note}` : ""}`,
      });
      return this.load(tx, id);
    });
  }

  /** Surat pengangkatan karyawan tetap setelah lulus masa percobaan. */
  @Get(":id/appointment-letter")
  @RequirePermission("hr.read")
  async appointmentLetter(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      if (contract.probationResult !== "passed")
        throw new BadRequestException("Surat pengangkatan tersedia setelah karyawan lulus masa percobaan");
      const employee = await this.employees.find(tx, contract.employeeId);
      const [company] = await tx
        .select({ name: schema.companies.name, city: schema.companies.city })
        .from(schema.companies)
        .where(eq(schema.companies.id, contract.companyId));
      const [job] = employee.jobId
        ? await tx
            .select({ name: schema.jobPositions.name })
            .from(schema.jobPositions)
            .where(eq(schema.jobPositions.id, employee.jobId))
        : [];
      const decided = (contract.probationDecidedAt ?? new Date()).toISOString().slice(0, 10);
      const body = [
        "SURAT PENGANGKATAN KARYAWAN TETAP",
        "",
        `Yang bertanda tangan di bawah ini, atas nama ${company?.name ?? ""}, menerangkan bahwa:`,
        "",
        `Nama          : ${employee.name}`,
        `No. karyawan  : ${employee.employeeNumber}`,
        `Jabatan       : ${job?.name ?? "-"}`,
        "",
        `telah menyelesaikan masa percobaan ${contract.probationMonths} bulan (${contract.dateStart} s.d. ${contract.probationEnd}) dengan hasil baik dan dengan ini diangkat sebagai karyawan tetap berdasarkan perjanjian kerja ${contract.name}, terhitung sejak ${addDays(contract.probationEnd!, 1)}.`,
        "",
        "Hak dan kewajiban karyawan mengikuti perjanjian kerja, peraturan perusahaan, dan ketentuan ketenagakerjaan yang berlaku.",
        "",
        `${company?.city ?? ""}${company?.city ? ", " : ""}${decided}`,
        "",
        "",
        "(.................................)",
        company?.name ?? "",
      ].join("\n");
      return {
        name: `pengangkatan-${employee.employeeNumber.replace(/[^\w.-]+/g, "_")}.pdf`,
        content: await renderOfferPdf({ company: company?.name ?? "", number: contract.name, body }),
      };
    });
    res.type("application/pdf").attachment(file.name).send(file.content);
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

  /**
   * Akhiri kontrak. `exit: true` + alasan = karyawan keluar per tanggal berakhir (satu-satunya tempat tanggal keluar
   * diisi; checklist offboarding dimulai). Kontrak keluar yang sudah berakhir bisa diakhiri ulang untuk memperbaiki
   * tanggal/alasan keluar.
   */
  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  close(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return this.tenantDb.run(async (tx) => {
      const contract = await this.find(tx, id);
      const input = parse(contractEndSchema, {
        ...raw,
        dateEnd: raw.dateEnd ?? contract.dateEnd ?? new Date().toISOString().slice(0, 10),
      });
      await this.contracts.end(tx, id, input);
      return this.load(tx, id);
    });
  }

  /** Batalkan keluar: kontrak keluar kembali berjalan, tanggal & alasan keluar karyawan dihapus. */
  @Post(":id/cancel-exit")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  cancelExit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.documents.assertEditable(tx, await this.find(tx, id));
      await this.contracts.cancelExit(tx, id);
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
      await this.contracts.syncJoinDate(tx, contract.employeeId, { before: contract.dateStart, after: null });
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
      .select({
        name: schema.employees.name,
        joinDate: schema.employees.joinDate,
        resignDate: schema.employees.resignDate,
        resignReason: schema.employees.resignReason,
        pendingStart: schema.employees.pendingStart,
      })
      .from(schema.employees)
      .where(eq(schema.employees.id, contract.employeeId));
    const [earlier] = await tx
      .select({ id: C.id })
      .from(C)
      .where(
        and(
          eq(C.employeeId, contract.employeeId),
          ne(C.state, "cancel"),
          ne(C.id, contract.id),
          sql`${C.dateStart} < ${contract.dateStart}`,
        ),
      )
      .limit(1);
    const [later] = await tx
      .select({ id: C.id })
      .from(C)
      .where(
        and(
          eq(C.employeeId, contract.employeeId),
          ne(C.state, "cancel"),
          ne(C.id, contract.id),
          sql`${C.dateStart} > ${contract.dateStart}`,
        ),
      )
      .limit(1);
    const grade = await gradeOf(tx, contract.employeeId);
    return {
      ...contract,
      employeeName: employee?.name ?? "",
      employee: employee
        ? {
            joinDate: employee.joinDate,
            resignDate: employee.resignDate,
            resignReason: employee.resignReason,
            pendingStart: employee.pendingStart,
          }
        : null,
      // Kontrak pertama: tanggal mulainya = tanggal masuk karyawan.
      isFirst: !earlier,
      // Kontrak terakhir: hanya kontrak ini yang bisa diakhiri dengan karyawan keluar.
      isLast: !later,
      allowances,
      // Peringatan struktur & skala upah: upah pokok di luar rentang golongan jabatan.
      grade: grade
        ? {
            code: grade.code,
            name: grade.name,
            id: grade.id,
            minWage: grade.minWage,
            maxWage: grade.maxWage,
            baseWage: grade.baseWage,
            position: contract.wageType === "monthly" ? gradePosition(contract.wage, grade) : null,
            adjusted:
              contract.wageType === "monthly" ? gradeWageStatus(contract.wage, grade).adjusted : false,
          }
        : null,
    };
  }
}

/** Masa percobaan karyawan: berjalan (belum dievaluasi) atau semua, dengan sisa hari. */
@Controller("hr/probations")
class ProbationsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.read")
  list(@Query("state") state?: string) {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({
          contractId: C.id,
          contractName: C.name,
          dateStart: C.dateStart,
          probationMonths: C.probationMonths,
          probationEnd: C.probationEnd,
          probationResult: C.probationResult,
          probationNote: C.probationNote,
          contractState: C.state,
          employeeId: schema.employees.id,
          employeeName: schema.employees.name,
          employeeNumber: schema.employees.employeeNumber,
        })
        .from(C)
        .innerJoin(schema.employees, eq(schema.employees.id, C.employeeId))
        .where(
          and(
            eq(C.companyId, currentContext().companyId),
            isNotNull(C.probationEnd),
            state === "all" ? undefined : and(eq(C.state, "running"), isNull(C.probationResult)),
          ),
        )
        .orderBy(asc(C.probationEnd));
      const today = new Date().toISOString().slice(0, 10);
      return rows.map((r) => ({
        ...r,
        daysLeft: Math.round((Date.parse(r.probationEnd!) - Date.parse(today)) / 86_400_000),
      }));
    });
  }
}

/** Log akses data pribadi karyawan (UU PDP): siapa membuka NIK/NPWP/rekening/gaji, kapan, untuk apa. */
@Controller("personal-data-access-logs")
class PersonalDataAccessLogsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.manage")
  list(@Query("employeeId") employeeId?: string, @Query("from") from?: string, @Query("to") to?: string) {
    const L = schema.personalDataAccessLogs;
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: L.id,
          createdAt: L.createdAt,
          fields: L.fields,
          purpose: L.purpose,
          recordCount: L.recordCount,
          employeeId: L.employeeId,
          employeeName: schema.employees.name,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(L)
        .leftJoin(schema.employees, eq(schema.employees.id, L.employeeId))
        .leftJoin(schema.users, eq(schema.users.id, L.userId))
        .where(
          and(
            eq(L.companyId, currentContext().companyId),
            employeeId ? eq(L.employeeId, employeeId) : undefined,
            from ? gte(L.createdAt, new Date(`${from}T00:00:00Z`)) : undefined,
            to ? lte(L.createdAt, new Date(`${to}T23:59:59Z`)) : undefined,
          ),
        )
        .orderBy(desc(L.createdAt))
        .limit(2000),
    );
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
        .limit(LIST_LOAD_LIMIT),
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
    SalaryGradeWageController,
    WageScaleController,
    ProbationsController,
    PersonalDataAccessLogsController,
    WorkCalendarController,
    OvertimeAttendanceController,
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
    ApprovalGateService,
    AttendanceService,
    ScheduleService,
    ChecklistService,
    HistoryService,
    ContractService,
    ContractDocumentService,
    NotificationService,
    WorkCalendarService,
    OvertimeService,
  ],
  exports: [
    ContractDocumentService,
    WorkCalendarService,
    OvertimeService,
    NotificationService,
    EmployeeService,
    LeaveService,
    ScheduleService,
    ApprovalService,
    ApprovalEngineService,
    ApprovalGateService,
    AttendanceService,
    ChecklistService,
    HistoryService,
    ContractService,
  ],
})
export class HrModule {}
