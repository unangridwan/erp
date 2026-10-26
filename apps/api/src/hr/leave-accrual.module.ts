import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, eq, inArray, lte, schema, sql, type Db } from "@erp/db";
import {
  accrualPeriods,
  balanceOn,
  cappedAccrual,
  carryOver,
  leaveAccrualAssignSchema,
  leaveAccrualPlanSchema,
  leaveBlockDateSchema,
  leaveLedger,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { HrModule } from "./hr.module.js";
import { LeaveService } from "./leave.service.js";

const P = schema.leaveAccrualPlans;
const AS = schema.leaveAccrualAssignments;
const A = schema.leaveAllocations;
const E = schema.employees;
type PlanInput = z.infer<typeof leaveAccrualPlanSchema>;
type Plan = typeof P.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Rencana akrual cuti: jatah bertambah per bulan/tahun setelah masa kerja tertentu, dibatasi saldo maksimum, dan sisa
 * akhir tahun dibawa ke tahun berikutnya (semua/berbatas) dengan masa kedaluwarsa.
 */
@Injectable()
export class LeaveAccrualService {
  async list(tx: Db) {
    const rows = await tx
      .select({
        plan: P,
        leaveTypeName: schema.leaveTypes.name,
        employees: sql<number>`(select count(*) from leave_accrual_assignments s where s.plan_id = ${P.id})::int`,
      })
      .from(P)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, P.leaveTypeId))
      .where(eq(P.companyId, currentContext().companyId))
      .orderBy(asc(P.name));
    return rows.map((r) => ({ ...r.plan, leaveTypeName: r.leaveTypeName, employeeCount: r.employees }));
  }

  async get(tx: Db, id: string) {
    const plan = await this.find(tx, id);
    const assignments = await tx
      .select({
        id: AS.id,
        employeeId: AS.employeeId,
        employeeName: E.name,
        employeeNumber: E.employeeNumber,
        joinDate: E.joinDate,
        dateFrom: AS.dateFrom,
      })
      .from(AS)
      .innerJoin(E, eq(E.id, AS.employeeId))
      .where(eq(AS.planId, id))
      .orderBy(asc(E.name));
    const [type] = await tx
      .select({ name: schema.leaveTypes.name })
      .from(schema.leaveTypes)
      .where(eq(schema.leaveTypes.id, plan.leaveTypeId));
    return { ...plan, leaveTypeName: type?.name ?? null, assignments };
  }

  async save(tx: Db, id: string | null, input: PlanInput) {
    const [type] = await tx
      .select({ id: schema.leaveTypes.id, requiresAllocation: schema.leaveTypes.requiresAllocation })
      .from(schema.leaveTypes)
      .where(eq(schema.leaveTypes.id, input.leaveTypeId));
    if (!type) throw fieldError("leaveTypeId", "Jenis cuti tidak ditemukan");
    if (!type.requiresAllocation) throw fieldError("leaveTypeId", "Jenis cuti ini tidak memakai jatah/saldo");
    const values = {
      ...input,
      maxBalance: input.maxBalance ?? null,
      carryOverMax: input.carryOver === "limited" ? (input.carryOverMax ?? null) : null,
      carryOverExpiryMonths: input.carryOver === "none" ? null : (input.carryOverExpiryMonths ?? null),
    };
    if (id) {
      await this.find(tx, id);
      await tx
        .update(P)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(P.id, id));
      return this.get(tx, id);
    }
    const [row] = await tx
      .insert(P)
      .values({ ...values, companyId: currentContext().companyId })
      .returning({ id: P.id });
    return this.get(tx, row!.id);
  }

  async remove(tx: Db, id: string) {
    await this.find(tx, id);
    await tx.delete(P).where(eq(P.id, id));
  }

  /** Tugaskan rencana ke karyawan terpilih, per departemen, atau semua karyawan aktif. */
  async assign(tx: Db, id: string, input: z.infer<typeof leaveAccrualAssignSchema>) {
    const plan = await this.find(tx, id);
    const employees = await tx
      .select({ id: E.id })
      .from(E)
      .where(
        and(
          eq(E.companyId, plan.companyId),
          eq(E.active, true),
          input.departmentId ? eq(E.departmentId, input.departmentId) : undefined,
          input.employeeIds?.length ? inArray(E.id, input.employeeIds) : undefined,
        ),
      );
    if (input.employeeIds?.length && employees.length !== new Set(input.employeeIds).size)
      throw fieldError("employeeIds", "Karyawan tidak ditemukan atau tidak aktif di perusahaan ini");
    if (employees.length)
      await tx
        .insert(AS)
        .values(employees.map((e) => ({ planId: id, employeeId: e.id, dateFrom: input.dateFrom })))
        .onConflictDoUpdate({ target: [AS.planId, AS.employeeId], set: { dateFrom: input.dateFrom } });
    return { assigned: employees.length };
  }

  async unassign(tx: Db, id: string, employeeId: string) {
    await this.find(tx, id);
    await tx.delete(AS).where(and(eq(AS.planId, id), eq(AS.employeeId, employeeId)));
  }

  /** Buat jatah akrual yang sudah jatuh tempo sampai `until` (idempoten per karyawan × periode). */
  async run(tx: Db, id: string, until = today()) {
    const plan = await this.find(tx, id);
    if (!plan.active) throw new BadRequestException("Rencana akrual tidak aktif");
    return this.accrue(tx, plan, until);
  }

  async accrue(tx: Db, plan: Plan, until: string) {
    const rows = await tx
      .select({ assignment: AS, employee: E })
      .from(AS)
      .innerJoin(E, eq(E.id, AS.employeeId))
      .where(eq(AS.planId, plan.id));
    let created = 0;
    let capped = 0;
    for (const { assignment, employee } of rows) {
      const last = employee.resignDate && employee.resignDate < until ? employee.resignDate : until;
      const periods = accrualPeriods(plan, {
        assignedFrom: assignment.dateFrom,
        joinDate: employee.joinDate,
        until: last,
      });
      if (!periods.length) continue;
      const done = new Set(
        (
          await tx
            .select({ period: A.period })
            .from(A)
            .where(and(eq(A.employeeId, employee.id), eq(A.accrualPlanId, plan.id), eq(A.source, "accrual")))
        ).map((r) => r.period),
      );
      for (const p of periods) {
        if (done.has(p.period)) continue;
        let days = p.days;
        if (plan.maxBalance) {
          const ledger = await this.ledger(tx, employee.id, plan.leaveTypeId, p.dateFrom);
          days = cappedAccrual(balanceOn(ledger, p.dateFrom).remaining, p.days, plan.maxBalance);
          if (days !== p.days) capped++;
        }
        const [row] = await tx
          .insert(A)
          .values({
            companyId: employee.companyId,
            employeeId: employee.id,
            leaveTypeId: plan.leaveTypeId,
            days,
            dateFrom: p.dateFrom,
            dateTo: p.dateTo,
            source: "accrual",
            accrualPlanId: plan.id,
            period: p.period,
            note: `Akrual ${plan.name} ${p.period}`,
          })
          .onConflictDoNothing()
          .returning({ id: A.id });
        if (row) created++;
      }
    }
    return { created, capped };
  }

  /** Bawa sisa jatah akrual tahun `year` ke tahun berikutnya sesuai aturan carry-over (idempoten). */
  async carryOver(tx: Db, id: string, year: number) {
    const plan = await this.find(tx, id);
    return this.carry(tx, plan, year);
  }

  async carry(tx: Db, plan: Plan, year: number) {
    if (plan.carryOver === "none") return { created: 0, days: "0.00" };
    const rows = await tx
      .select({ employee: E })
      .from(AS)
      .innerJoin(E, eq(E.id, AS.employeeId))
      .where(eq(AS.planId, plan.id));
    let created = 0;
    let total = new Decimal(0);
    const yearEnd = `${year}-12-31`;
    for (const { employee } of rows) {
      if (employee.resignDate && employee.resignDate <= yearEnd) continue;
      const ledger = await this.ledger(tx, employee.id, plan.leaveTypeId, yearEnd);
      const remaining = ledger.allocations
        .filter(
          (a) => a.accrualPlanId === plan.id && a.source === "accrual" && a.period?.startsWith(String(year)),
        )
        .reduce((s, a) => s.plus(a.remaining), new Decimal(0));
      const co = carryOver(plan, remaining, year);
      if (!co) continue;
      const [row] = await tx
        .insert(A)
        .values({
          companyId: employee.companyId,
          employeeId: employee.id,
          leaveTypeId: plan.leaveTypeId,
          days: co.days,
          dateFrom: co.dateFrom,
          dateTo: co.dateTo,
          source: "carry_over",
          accrualPlanId: plan.id,
          period: String(year),
          note: `Sisa ${plan.name} ${year} (berlaku s.d. ${co.dateTo})`,
        })
        .onConflictDoNothing()
        .returning({ id: A.id });
      if (row) {
        created++;
        total = total.plus(co.days);
      }
    }
    return { created, days: total.toFixed(2) };
  }

  private async ledger(tx: Db, employeeId: string, leaveTypeId: string, on: string) {
    const allocations = await tx
      .select()
      .from(A)
      .where(and(eq(A.employeeId, employeeId), eq(A.leaveTypeId, leaveTypeId)));
    const requests = await tx
      .select({
        id: schema.leaveRequests.id,
        dateFrom: schema.leaveRequests.dateFrom,
        days: schema.leaveRequests.days,
      })
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.employeeId, employeeId),
          eq(schema.leaveRequests.leaveTypeId, leaveTypeId),
          inArray(schema.leaveRequests.state, ["confirm", "approved"]),
          lte(schema.leaveRequests.dateFrom, on),
        ),
      );
    return leaveLedger(allocations, requests, on);
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, id), eq(P.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Rencana akrual tidak ditemukan");
    return row;
  }
}

/** Akrual & carry-over otomatis tiap jam untuk semua tenant (idempoten), memakai flag scheduler pengingat HR. */
@Injectable()
export class LeaveAccrualScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("LeaveAccrual");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LeaveAccrualService) private readonly accruals: LeaveAccrualService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.hrReminder.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runAll().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "leave-accrual" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async runAll(tenantIds?: string[], on = today()) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let created = 0;
    for (const tenantId of tenants)
      created += await this.tenantDb.runAs(tenantId, async (tx) => {
        let n = 0;
        for (const plan of await tx.select().from(P).where(eq(P.active, true))) {
          n += (await this.accruals.accrue(tx, plan, on)).created;
          n += (await this.accruals.carry(tx, plan, Number(on.slice(0, 4)) - 1)).created;
        }
        return n;
      });
    return { created };
  }
}

@Controller("leave-accrual-plans")
class LeaveAccrualPlansController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LeaveAccrualService) private readonly accruals: LeaveAccrualService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run((tx) => this.accruals.list(tx));
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.accruals.get(tx, id));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(leaveAccrualPlanSchema, body);
    return this.tenantDb.run((tx) => this.accruals.save(tx, null, input));
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(leaveAccrualPlanSchema, body);
    return this.tenantDb.run((tx) => this.accruals.save(tx, id, input));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.accruals.remove(tx, id));
  }

  @Post(":id/assign")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  assign(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(leaveAccrualAssignSchema, body);
    return this.tenantDb.run((tx) => this.accruals.assign(tx, id, input));
  }

  @Delete(":id/assignments/:employeeId")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async unassign(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
  ) {
    await this.tenantDb.run((tx) => this.accruals.unassign(tx, id, employeeId));
  }

  /** Jalankan akrual sampai tanggal (bawaan hari ini). */
  @Post(":id/run")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  run(@Param("id", ParseUUIDPipe) id: string, @Query("until") until?: string) {
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw fieldError("until", "Tanggal tidak valid");
    return this.tenantDb.run((tx) => this.accruals.run(tx, id, until));
  }

  /** Bawa sisa tahun `year` (bawaan tahun lalu) ke tahun berikutnya. */
  @Post(":id/carry-over")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  carryOver(@Param("id", ParseUUIDPipe) id: string, @Query("year") year?: string) {
    const y = year ? Number(year) : new Date().getFullYear() - 1;
    if (!Number.isInteger(y) || y < 2000 || y > 2200) throw fieldError("year", "Tahun tidak valid");
    return this.tenantDb.run((tx) => this.accruals.carryOver(tx, id, y));
  }
}

const LeaveBlockDatesController = createCrudController({
  path: "leave-block-dates",
  model: "leave_block_date",
  table: schema.leaveBlockDates,
  schema: leaveBlockDateSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.leaveBlockDates.reason],
  orderBy: schema.leaveBlockDates.dateFrom,
  companyColumn: schema.leaveBlockDates.companyId,
  perCompany: true,
  refs: { departmentId: schema.departments },
  beforeSave: async (_tx, values) => {
    if (
      typeof values.dateFrom === "string" &&
      typeof values.dateTo === "string" &&
      values.dateTo < values.dateFrom
    )
      throw fieldError("dateTo", "Tanggal akhir sebelum tanggal mulai");
  },
});

/** Cuti pengganti dari lembur hari libur. */
@Controller("overtimes")
class OvertimeCompensationController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LeaveService) private readonly leaves: LeaveService,
  ) {}

  @Post(":id/compensate")
  @HttpCode(200)
  @RequirePermission("hr.write")
  compensate(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leaves.compensate(tx, id));
  }
}

/** Cuti lanjutan: rencana akrual & carry-over, tanggal blok cuti, cuti pengganti. */
@Module({
  imports: [HrModule],
  controllers: [LeaveAccrualPlansController, LeaveBlockDatesController, OvertimeCompensationController],
  providers: [ActivityService, LeaveAccrualService, LeaveAccrualScheduler],
  exports: [LeaveAccrualService, LeaveAccrualScheduler],
})
export class LeaveAccrualModule {}
