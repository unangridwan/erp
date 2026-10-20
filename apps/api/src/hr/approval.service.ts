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

export type ApprovalModel = "leave_request" | "overtime" | "expense_claim";
type Model = ApprovalModel;
type Employee = typeof schema.employees.$inferSelect;

/**
 * Persetujuan berjenjang cuti, lembur, dan klaim biaya. Tahap 1 = atasan langsung karyawan, tahap 2 = atasan dari atasan,
 * tahap 3 = HR. Tahap tanpa atasan (atau tahap 3) diputuskan HR (permission hr.write), yang juga boleh mengambil
 * alih tahap mana pun.
 */
@Injectable()
export class ApprovalService {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  /** Jumlah tahap untuk dokumen baru (dari pengaturan payroll perusahaan). */
  async levels(tx: Db, companyId: string, model: Model) {
    const [s] = await tx
      .select({
        leave: schema.payrollSettings.leaveApprovalLevels,
        overtime: schema.payrollSettings.overtimeApprovalLevels,
        expense: schema.payrollSettings.expenseApprovalLevels,
      })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    if (model === "expense_claim") return s?.expense ?? 1;
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
    const ctx = currentContext();
    const expected = await this.approverFor(tx, employee!, doc.approvalStep);
    const hr = hasPermission(ctx.permissions, "hr.write");
    if (expected !== ctx.userId && !hr)
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
      note: note ?? null,
    });
    const last = doc.approvalStep >= doc.approvalLevels;
    const state = decision === "refused" ? "refused" : last ? "approved" : "confirm";
    const table =
      model === "leave_request"
        ? schema.leaveRequests
        : model === "overtime"
          ? schema.overtimes
          : schema.expenseClaims;
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
    const what = model === "leave_request" ? "Cuti" : model === "overtime" ? "Lembur" : "Klaim";
    await this.activity.log(tx, {
      resModel: "employee",
      resId: doc.employeeId,
      action: "comment",
      message: `${what} ${doc.label}: tahap ${doc.approvalStep}/${doc.approvalLevels} ${decision === "approved" ? "disetujui" : "ditolak"}${state === "approved" ? " — selesai" : ""}`,
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

  /** Pengajuan yang menunggu keputusan user ini (HR melihat semua yang menunggu). */
  async pending(tx: Db) {
    const ctx = currentContext();
    const hr = hasPermission(ctx.permissions, "hr.write");
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
      if (approver === ctx.userId || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "expense_claim" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `Klaim ${doc.name} Rp ${Number(doc.total).toLocaleString("id-ID")}`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: approver === ctx.userId,
        });
    }
    for (const { doc, employee, typeName } of leaves) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (approver === ctx.userId || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "leave_request" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `${typeName} ${doc.dateFrom} s.d. ${doc.dateTo} (${Number(doc.days)} hari)`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: approver === ctx.userId,
        });
    }
    for (const { doc, employee } of overtimes) {
      const approver = await this.approverFor(tx, employee, doc.approvalStep);
      if (approver === ctx.userId || (hr && employee.userId !== ctx.userId) || (hr && !approver))
        result.push({
          model: "overtime" as const,
          id: doc.id,
          employeeName: employee.name,
          summary: `Lembur ${doc.date} ${Number(doc.hours)} jam`,
          step: doc.approvalStep,
          levels: doc.approvalLevels,
          mine: approver === ctx.userId,
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
