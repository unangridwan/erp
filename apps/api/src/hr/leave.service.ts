import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, schema, sql, type Db, type SQL } from "@erp/db";
import { hasPermission, workingDays, type leaveRequestSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { ApprovalService } from "./approval.service.js";
import { EmployeeService } from "./employee.service.js";

type LeaveInput = z.infer<typeof leaveRequestSchema>;
const R = schema.leaveRequests;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** Hari libur nasional/perusahaan dalam rentang (YYYY-MM-DD). */
export async function holidaysBetween(tx: Db, from: string, to: string) {
  const rows = await tx
    .select({ date: schema.publicHolidays.date })
    .from(schema.publicHolidays)
    .where(and(gte(schema.publicHolidays.date, from), lte(schema.publicHolidays.date, to)));
  return rows.map((r) => r.date);
}

@Injectable()
export class LeaveService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
  ) {}

  async list(tx: Db, query: { employeeId?: string; state?: string }) {
    const filters: (SQL | undefined)[] = [eq(R.companyId, currentContext().companyId)];
    if (query.employeeId) filters.push(eq(R.employeeId, query.employeeId));
    const states = (query.state ?? "")
      .split(",")
      .filter((s): s is "confirm" => ["confirm", "approved", "refused", "cancel"].includes(s));
    if (states.length) filters.push(inArray(R.state, states));
    const rows = await tx
      .select({ request: R, employeeName: schema.employees.name, leaveTypeName: schema.leaveTypes.name })
      .from(R)
      .innerJoin(schema.employees, eq(schema.employees.id, R.employeeId))
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, R.leaveTypeId))
      .where(and(...filters))
      .orderBy(desc(R.dateFrom))
      .limit(500);
    return rows.map((r) => ({ ...r.request, employeeName: r.employeeName, leaveTypeName: r.leaveTypeName }));
  }

  /**
   * Saldo cuti per jenis yang memakai jatah, pada tanggal tertentu: jatah yang masa berlakunya mencakup
   * tanggal itu dikurangi pengajuan (menunggu/disetujui) dalam masa berlaku tersebut.
   */
  async balances(tx: Db, employeeId: string, on = new Date().toISOString().slice(0, 10)) {
    const types = await tx
      .select()
      .from(schema.leaveTypes)
      .where(and(eq(schema.leaveTypes.requiresAllocation, true), eq(schema.leaveTypes.active, true)))
      .orderBy(asc(schema.leaveTypes.name));
    const result = [];
    for (const type of types) {
      const b = await this.balance(tx, employeeId, type.id, on, on);
      result.push({ leaveTypeId: type.id, leaveTypeName: type.name, ...b });
    }
    return result;
  }

  private async balance(
    tx: Db,
    employeeId: string,
    leaveTypeId: string,
    from: string,
    to: string,
    exclude?: string,
  ) {
    const A = schema.leaveAllocations;
    const allocations = await tx
      .select()
      .from(A)
      .where(
        and(
          eq(A.employeeId, employeeId),
          eq(A.leaveTypeId, leaveTypeId),
          lte(A.dateFrom, from),
          gte(A.dateTo, to),
        ),
      );
    if (!allocations.length) return { allocated: "0", taken: "0", remaining: "0" };
    const start = allocations.reduce((m, a) => (a.dateFrom < m ? a.dateFrom : m), allocations[0]!.dateFrom);
    const end = allocations.reduce((m, a) => (a.dateTo > m ? a.dateTo : m), allocations[0]!.dateTo);
    const [taken] = await tx
      .select({ days: sql<string>`coalesce(sum(${R.days}), 0)::text` })
      .from(R)
      .where(
        and(
          eq(R.employeeId, employeeId),
          eq(R.leaveTypeId, leaveTypeId),
          inArray(R.state, ["confirm", "approved"]),
          gte(R.dateFrom, start),
          lte(R.dateFrom, end),
          exclude ? sql`${R.id} <> ${exclude}` : undefined,
        ),
      );
    const allocated = allocations.reduce((s, a) => s.plus(a.days), d(0));
    return {
      allocated: allocated.toFixed(2),
      taken: d(taken?.days).toFixed(2),
      remaining: allocated.minus(taken?.days ?? 0).toFixed(2),
    };
  }

  /** Ajukan cuti. Tanpa hr.write hanya untuk diri sendiri. */
  async request(tx: Db, input: LeaveInput) {
    const ctx = currentContext();
    const employee = input.employeeId
      ? await this.employees.find(tx, input.employeeId)
      : await this.employees.mine(tx);
    if (employee.userId !== ctx.userId && !hasPermission(ctx.permissions, "hr.write"))
      throw new ForbiddenException("Hanya bisa mengajukan cuti untuk diri sendiri");
    const [type] = await tx
      .select()
      .from(schema.leaveTypes)
      .where(and(eq(schema.leaveTypes.id, input.leaveTypeId), eq(schema.leaveTypes.active, true)));
    if (!type) throw fieldError("leaveTypeId", "Jenis cuti tidak ditemukan");
    const days = workingDays(
      input.dateFrom,
      input.dateTo,
      await holidaysBetween(tx, input.dateFrom, input.dateTo),
    );
    if (days === 0) throw fieldError("dateTo", "Rentang cuti tidak mencakup hari kerja");
    const [overlap] = await tx
      .select({ id: R.id })
      .from(R)
      .where(
        and(
          eq(R.employeeId, employee.id),
          inArray(R.state, ["confirm", "approved"]),
          lte(R.dateFrom, input.dateTo),
          gte(R.dateTo, input.dateFrom),
        ),
      )
      .limit(1);
    if (overlap) throw fieldError("dateFrom", "Sudah ada pengajuan cuti pada tanggal tersebut");
    if (type.requiresAllocation) {
      const b = await this.balance(tx, employee.id, type.id, input.dateFrom, input.dateTo);
      if (d(b.remaining).lt(days))
        throw fieldError(
          "dateTo",
          `Saldo ${type.name} tidak cukup (sisa ${d(b.remaining).toFixed()} hari, diminta ${days})`,
        );
    }
    const [row] = await tx
      .insert(R)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        days: String(days),
        reason: input.reason ?? null,
        approvalLevels: await this.approvals.levels(tx, employee.companyId, "leave_request"),
        createdBy: ctx.userId,
      })
      .returning();
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Pengajuan ${type.name} ${input.dateFrom} s.d. ${input.dateTo} (${days} hari)`,
    });
    return row!;
  }

  /** Keputusan tahap persetujuan berjalan (berjenjang; lihat ApprovalService). */
  async decide(tx: Db, id: string, state: "approved" | "refused", note?: string | null) {
    await this.find(tx, id);
    await this.approvals.decide(tx, "leave_request", id, state, note);
    return this.find(tx, id);
  }

  /** Batalkan pengajuan sendiri (atau oleh HR). */
  async cancel(tx: Db, id: string) {
    const ctx = currentContext();
    const request = await this.find(tx, id);
    const employee = await this.employees.find(tx, request.employeeId);
    if (employee.userId !== ctx.userId && !hasPermission(ctx.permissions, "hr.write"))
      throw new ForbiddenException("Tidak bisa membatalkan cuti orang lain");
    if (request.state === "refused" || request.state === "cancel")
      throw new BadRequestException("Pengajuan sudah ditutup");
    const [row] = await tx
      .update(R)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(R.id, id))
      .returning();
    return row!;
  }

  /** Hari kerja cuti tanpa upah (disetujui) dalam periode payroll. */
  async unpaidDays(tx: Db, employeeId: string, from: string, to: string, holidays: string[]) {
    const rows = await tx
      .select({ dateFrom: R.dateFrom, dateTo: R.dateTo })
      .from(R)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, R.leaveTypeId))
      .where(
        and(
          eq(R.employeeId, employeeId),
          eq(R.state, "approved"),
          eq(schema.leaveTypes.paid, false),
          lte(R.dateFrom, to),
          gte(R.dateTo, from),
        ),
      );
    return rows.reduce(
      (sum, r) =>
        sum + workingDays(r.dateFrom > from ? r.dateFrom : from, r.dateTo < to ? r.dateTo : to, holidays),
      0,
    );
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, id), eq(R.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Pengajuan cuti tidak ditemukan");
    return row;
  }
}
