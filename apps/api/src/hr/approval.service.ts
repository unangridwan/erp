import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { hasPermission } from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { ApprovalEngineService, hasLeft } from "./approval-engine.service.js";
import { NotificationService } from "../notifications/notification.service.js";

export type ApprovalModel =
  "leave_request" | "overtime" | "expense_claim" | "attendance_request" | "shift_request";
type Model = ApprovalModel;
type Employee = typeof schema.employees.$inferSelect;

/**
 * Persetujuan berjenjang cuti, lembur, dan klaim biaya. Tahap 1 = atasan langsung karyawan, tahap 2 = atasan dari atasan,
 * tahap 3 = HR. Tahap tanpa atasan (atau tahap 3) diputuskan HR (permission hr.write), yang juga boleh mengambil
 * alih tahap mana pun. Delegasi penyetuju yang aktif berlaku juga; pengajuan karyawan yang sudah resign tidak bisa
 * diputuskan.
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** Beri tahu penyetuju tahap pertama bahwa ada pengajuan baru. */
  async notifySubmitted(tx: Db, employee: Employee, what: string, label: string) {
    await this.notifications.notify(tx, [await this.approverFor(tx, employee, 1)], {
      kind: "approval.pending",
      title: `${what} ${employee.name} menunggu persetujuan Anda`,
      body: label,
      link: "/hr/approvals",
      companyId: employee.companyId,
    });
  }

  /** Jumlah tahap untuk dokumen baru (dari pengaturan payroll perusahaan). */
  async levels(tx: Db, companyId: string, model: Model) {
    const [s] = await tx
      .select({
        leave: schema.payrollSettings.leaveApprovalLevels,
        overtime: schema.payrollSettings.overtimeApprovalLevels,
        expense: schema.payrollSettings.expenseApprovalLevels,
        attendance: schema.payrollSettings.attendanceApprovalLevels,
      })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    if (model === "expense_claim") return s?.expense ?? 1;
    if (model === "attendance_request" || model === "shift_request") return s?.attendance ?? 1;
    return model === "leave_request" ? (s?.leave ?? 1) : (s?.overtime ?? 0);
  }

  /** User penyetuju tahap tertentu (null = HR). */
  async approverFor(tx: Db, employee: Employee, step: number): Promise<string | null> {
    if (step >= 3) return null;
    let current: Employee | undefined = employee;
    for (let i = 0; i < step; i++) {
      if (!current?.managerId) return null;
      [current] = await tx.select().from(schema.employees).where(eq(schema.employees.id, current.managerId));
    }
    return current?.userId ?? null;
  }

  /** Setujui/tolak tahap berjalan; tahap terakhir yang disetujui menyelesaikan dokumen. */
  async decide(tx: Db, model: Model, id: string, decision: "approved" | "refused", note?: string | null) {
    const doc = await this.load(tx, model, id);
    if (doc.state !== "confirm") throw new BadRequestException("Pengajuan sudah diproses");
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, doc.employeeId));
    if (hasLeft(employee!))
      throw new BadRequestException("Karyawan sudah resign; pengajuan tidak bisa diputuskan");
    const ctx = currentContext();
    const expected = await this.approverFor(tx, employee!, doc.approvalStep);
    const hr = hasPermission(ctx.permissions, "hr.write");
    const acting = await this.engine.actsFor(tx, expected, ctx.userId);
    if (!acting.ok && !hr)
      throw new ForbiddenException(
        expected
          ? "Menunggu persetujuan atasan pada tahap ini"
          : "Tahap ini disetujui oleh HR (butuh permission hr.write)",
      );
    if (employee!.userId === ctx.userId && !hr)
      throw new ForbiddenException("Tidak bisa menyetujui pengajuan sendiri");
    await tx.insert(schema.approvals).values({
      resModel: model,
      resId: id,
      step: doc.approvalStep,
      userId: ctx.userId,
      decision,
      note: acting.delegated ? `[delegasi] ${note ?? ""}`.trim() : (note ?? null),
    });
    const last = doc.approvalStep >= doc.approvalLevels;
    const state = decision === "refused" ? "refused" : last ? "approved" : "confirm";
    const table = {
      leave_request: schema.leaveRequests,
      overtime: schema.overtimes,
      expense_claim: schema.expenseClaims,
      attendance_request: schema.attendanceRequests,
      shift_request: schema.shiftRequests,
    }[model];
    await tx
      .update(table)
      .set({
        state,
        approvalStep: decision === "approved" && !last ? doc.approvalStep + 1 : doc.approvalStep,
        ...(model === "leave_request" && state !== "confirm"
          ? { approvedBy: ctx.userId, approvedAt: new Date() }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(table.id, id));
    const what = {
      leave_request: "Cuti",
      overtime: "Lembur",
      expense_claim: "Klaim",
      attendance_request: "Koreksi absensi",
      shift_request: "Tukar shift",
    }[model];
    await this.activity.log(tx, {
      resModel: "employee",
      resId: doc.employeeId,
      action: "comment",
      message: `${what} ${doc.label}: tahap ${doc.approvalStep}/${doc.approvalLevels} ${decision === "approved" ? "disetujui" : "ditolak"}${state === "approved" ? " — selesai" : ""}`,
    });
    // Keputusan akhir ke karyawan; tahap berikutnya ke penyetuju berikut.
    if (state === "confirm")
      await this.notifications.notify(tx, [await this.approverFor(tx, employee!, doc.approvalStep + 1)], {
        kind: "approval.pending",
        title: `${what} ${employee!.name} menunggu persetujuan Anda`,
        body: doc.label,
        link: "/hr/approvals",
        companyId: employee!.companyId,
      });
    else
      await this.notifications.notify(tx, [employee!.userId], {
        kind: `approval.${state}`,
        title: `${what} ${doc.label} ${state === "approved" ? "disetujui" : "ditolak"}`,
        body: note ?? null,
        link: "/me",
        companyId: employee!.companyId,
      });
    return this.status(tx, model, id);
  }

  /** Status & riwayat persetujuan sebuah dokumen. */
  async status(tx: Db, model: Model, id: string) {
    const doc = await this.load(tx, model, id);
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, doc.employeeId));
    const history = await tx
      .select({
        step: schema.approvals.step,
        decision: schema.approvals.decision,
        note: schema.approvals.note,
        createdAt: schema.approvals.createdAt,
        userName: schema.users.name,
      })
      .from(schema.approvals)
      .leftJoin(schema.users, eq(schema.users.id, schema.approvals.userId))
      .where(and(eq(schema.approvals.resModel, model), eq(schema.approvals.resId, id)))
      .orderBy(asc(schema.approvals.createdAt));
    const approver = doc.state === "confirm" ? await this.approverFor(tx, employee!, doc.approvalStep) : null;
    const [approverUser] = approver
      ? await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, approver))
      : [];
    return {
      id,
      state: doc.state,
      step: doc.approvalStep,
      levels: doc.approvalLevels,
      waitingFor: doc.state === "confirm" ? (approverUser?.name ?? "HR") : null,
      history,
    };
  }

  /** `userId` penyetuju tahap berjalan dokumen ini (langsung atau sebagai delegasi). */
  async isApprover(tx: Db, employee: Employee, step: number, userId: string) {
    return (await this.engine.actsFor(tx, await this.approverFor(tx, employee, step), userId)).ok;
  }

  /** Pengajuan yang menunggu keputusan user ini (HR melihat semua yang menunggu), termasuk permintaan generik. */
  async pending(tx: Db) {
    const ctx = currentContext();
    const hr = hasPermission(ctx.permissions, "hr.write");
    const delegators = await this.engine.delegatorsOf(tx, ctx.userId);
    const isMine = (approver: string | null) =>
      approver !== null && (approver === ctx.userId || delegators.has(approver));
    const leaves = await tx
      .select({ doc: schema.leaveRequests, employee: schema.employees, typeName: schema.leaveTypes.name })
      .from(schema.leaveRequests)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.leaveRequests.employeeId))
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
      .where(
        and(
          inArray(schema.leaveRequests.companyId, ctx.companyIds),
          eq(schema.leaveRequests.state, "confirm"),
        ),
      );
    const overtimes = await tx
      .select({ doc: schema.overtimes, employee: schema.employees })
      .from(schema.overtimes)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.overtimes.employeeId))
      .where(and(inArray(schema.overtimes.companyId, ctx.companyIds), eq(schema.overtimes.state, "confirm")));
    const claims = await tx
      .select({ doc: schema.expenseClaims, employee: schema.employees })
      .from(schema.expenseClaims)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.expenseClaims.employeeId))
      .where(
        and(
          inArray(schema.expenseClaims.companyId, ctx.companyIds),
          eq(schema.expenseClaims.state, "confirm"),
        ),
      );
    const result = [];
    for (const { doc, employee } of claims) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (isMine(approver) || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "expense_claim" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `Klaim ${doc.name} Rp ${Number(doc.total).toLocaleString("id-ID")}`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: isMine(approver),
        });
    }
    for (const { doc, employee, typeName } of leaves) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (isMine(approver) || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "leave_request" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `${typeName} ${doc.dateFrom} s.d. ${doc.dateTo} (${Number(doc.days)} hari)`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: isMine(approver),
        });
    }
    for (const { doc, employee } of overtimes) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (isMine(approver) || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "overtime" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `Lembur ${doc.date} ${Number(doc.hours)} jam`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: isMine(approver),
        });
    }
    const corrections = await tx
      .select({ doc: schema.attendanceRequests, employee: schema.employees })
      .from(schema.attendanceRequests)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.attendanceRequests.employeeId))
      .where(
        and(
          inArray(schema.attendanceRequests.companyId, ctx.companyIds),
          eq(schema.attendanceRequests.state, "confirm"),
        ),
      );
    for (const { doc, employee } of corrections) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (isMine(approver) || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "attendance_request" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `Koreksi absensi ${doc.date}: ${doc.reason}`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: isMine(approver),
        });
    }
    const shifts = await tx
      .select({
        doc: schema.shiftRequests,
        employee: schema.employees,
        scheduleName: schema.workSchedules.name,
      })
      .from(schema.shiftRequests)
      .innerJoin(schema.employees, eq(schema.employees.id, schema.shiftRequests.employeeId))
      .innerJoin(schema.workSchedules, eq(schema.workSchedules.id, schema.shiftRequests.scheduleId))
      .where(
        and(
          inArray(schema.shiftRequests.companyId, ctx.companyIds),
          eq(schema.shiftRequests.state, "confirm"),
        ),
      );
    for (const { doc, employee, scheduleName } of shifts) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (isMine(approver) || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "shift_request" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `Tukar shift ke ${scheduleName} ${doc.dateFrom} s.d. ${doc.dateTo}`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: isMine(approver),
        });
    }
    const users = new Map<string, string>();
    for (const r of await this.engine.reviewable(tx)) {
      const name = r.requestedBy
        ? (users.get(r.requestedBy) ??
          (
            await tx
              .select({ name: schema.users.name })
              .from(schema.users)
              .where(eq(schema.users.id, r.requestedBy))
          )[0]?.name ??
          "—")
        : "—";
      if (r.requestedBy) users.set(r.requestedBy, name);
      result.push({
        model: "approval_request" as const,
        id: r.id,
        employeeName: name,
        summary: `${r.categoryName} ${r.number ?? ""}: ${r.subject}${
          r.amount ? ` (Rp ${Number(r.amount).toLocaleString("id-ID")})` : ""
        }`,
        step: r.step,
        levels: r.levels,
        mine: r.mine,
      });
    }
    return result;
  }

  private async load(tx: Db, model: Model, id: string) {
    const companyIds = currentContext().companyIds;
    if (model === "leave_request") {
      const [r] = await tx
        .select()
        .from(schema.leaveRequests)
        .where(and(eq(schema.leaveRequests.id, id), inArray(schema.leaveRequests.companyId, companyIds)));
      if (!r) throw new NotFoundException("Pengajuan cuti tidak ditemukan");
      return { ...r, label: `${r.dateFrom} s.d. ${r.dateTo}` };
    }
    if (model === "attendance_request") {
      const [a] = await tx
        .select()
        .from(schema.attendanceRequests)
        .where(
          and(eq(schema.attendanceRequests.id, id), inArray(schema.attendanceRequests.companyId, companyIds)),
        );
      if (!a) throw new NotFoundException("Koreksi absensi tidak ditemukan");
      return { ...a, label: a.date };
    }
    if (model === "shift_request") {
      const [r] = await tx
        .select()
        .from(schema.shiftRequests)
        .where(and(eq(schema.shiftRequests.id, id), inArray(schema.shiftRequests.companyId, companyIds)));
      if (!r) throw new NotFoundException("Permintaan tukar shift tidak ditemukan");
      return { ...r, label: `${r.dateFrom} s.d. ${r.dateTo}` };
    }
    if (model === "expense_claim") {
      const [c] = await tx
        .select()
        .from(schema.expenseClaims)
        .where(and(eq(schema.expenseClaims.id, id), inArray(schema.expenseClaims.companyId, companyIds)));
      if (!c) throw new NotFoundException("Klaim biaya tidak ditemukan");
      return { ...c, label: c.name };
    }
    const [o] = await tx
      .select()
      .from(schema.overtimes)
      .where(and(eq(schema.overtimes.id, id), inArray(schema.overtimes.companyId, companyIds)));
    if (!o) throw new NotFoundException("Lembur tidak ditemukan");
    return { ...o, label: `${o.date} (${Number(o.hours)} jam)` };
  }
}
