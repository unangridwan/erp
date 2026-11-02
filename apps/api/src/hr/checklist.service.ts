import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, schema, sql, type Db } from "@erp/db";
import {
  addDays,
  DEFAULT_CHECKLISTS,
  hasPermission,
  type ChecklistItem,
  type checklistStartSchema,
  type checklistTemplateSchema,
} from "@erp/shared";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";

const T = schema.hrChecklistTemplates;
const TI = schema.hrChecklistTemplateItems;
const CK = schema.hrChecklists;
const TK = schema.hrChecklistTasks;
type Kind = "onboarding" | "offboarding";

/**
 * Checklist onboarding/offboarding: tugas dengan penanggung jawab (HR, atasan, karyawan, IT) dan tenggat relatif
 * terhadap tanggal masuk/keluar, dari template perusahaan (atau bawaan).
 */
/** Tugas checklist bagian karyawan yang belum punya pemilik diberikan ke akun karyawan yang baru ditautkan. */
export async function assignEmployeeTasks(tx: Db, employeeId: string, userId: string) {
  const T = schema.hrChecklistTasks;
  const CL = schema.hrChecklists;
  await tx
    .update(T)
    .set({ responsibleUserId: userId })
    .where(
      and(
        eq(T.responsible, "employee"),
        isNull(T.responsibleUserId),
        isNull(T.doneAt),
        inArray(
          T.checklistId,
          tx
            .select({ id: CL.id })
            .from(CL)
            .where(and(eq(CL.employeeId, employeeId), eq(CL.state, "open"))),
        ),
      ),
    );
}

@Injectable()
export class ChecklistService {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  // ---- Template ----

  async templates(tx: Db) {
    const rows = await tx
      .select()
      .from(T)
      .where(eq(T.companyId, currentContext().companyId))
      .orderBy(asc(T.kind), asc(T.name));
    const items = rows.length
      ? await tx
          .select()
          .from(TI)
          .where(
            inArray(
              TI.templateId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(TI.sequence))
      : [];
    return rows.map((r) => ({ ...r, items: items.filter((i) => i.templateId === r.id) }));
  }

  async saveTemplate(tx: Db, input: z.infer<typeof checklistTemplateSchema>, id?: string) {
    const companyId = currentContext().companyId;
    if (input.isDefault)
      // Hanya satu template bawaan per jenis.
      await tx
        .update(T)
        .set({ isDefault: false })
        .where(and(eq(T.companyId, companyId), eq(T.kind, input.kind), eq(T.isDefault, true)));
    const { items, ...values } = input;
    let templateId = id;
    if (id) {
      const [row] = await tx
        .update(T)
        .set({ ...values, updatedAt: sql`now()` })
        .where(and(eq(T.id, id), eq(T.companyId, companyId)))
        .returning();
      if (!row) throw new NotFoundException("Template checklist tidak ditemukan");
      await tx.delete(TI).where(eq(TI.templateId, id));
    } else {
      const [row] = await tx
        .insert(T)
        .values({ ...values, companyId })
        .returning();
      templateId = row!.id;
    }
    await tx.insert(TI).values(
      items.map((item, i) => ({
        ...item,
        action: item.action ?? null,
        templateId: templateId!,
        sequence: i,
      })),
    );
    return (await this.templates(tx)).find((t) => t.id === templateId)!;
  }

  async removeTemplate(tx: Db, id: string) {
    await tx.delete(T).where(and(eq(T.id, id), eq(T.companyId, currentContext().companyId)));
  }

  // ---- Checklist karyawan ----

  /**
   * Mulai checklist untuk karyawan (idempoten: checklist terbuka dengan jenis sama dikembalikan apa adanya).
   * Template: yang dipilih, template bawaan perusahaan, atau checklist bawaan sistem.
   */
  async start(tx: Db, input: z.infer<typeof checklistStartSchema>) {
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.id, input.employeeId),
          eq(schema.employees.companyId, currentContext().companyId),
        ),
      );
    if (!employee) throw fieldError("employeeId", "Karyawan tidak ditemukan di perusahaan ini");
    const [open] = await tx
      .select({ id: CK.id })
      .from(CK)
      .where(and(eq(CK.employeeId, employee.id), eq(CK.kind, input.kind), eq(CK.state, "open")));
    if (open) return this.get(tx, open.id);
    const baseDate =
      input.baseDate ?? (input.kind === "onboarding" ? employee.joinDate : employee.resignDate);
    if (!baseDate) throw fieldError("baseDate", "Isi tanggal keluar karyawan terlebih dahulu");

    let name: string;
    let items: ChecklistItem[];
    const [template] = await tx
      .select()
      .from(T)
      .where(
        and(
          eq(T.companyId, employee.companyId),
          eq(T.kind, input.kind),
          eq(T.active, true),
          input.templateId ? eq(T.id, input.templateId) : eq(T.isDefault, true),
        ),
      );
    if (input.templateId && !template) throw fieldError("templateId", "Template checklist tidak ditemukan");
    if (template) {
      name = template.name;
      items = await tx.select().from(TI).where(eq(TI.templateId, template.id)).orderBy(asc(TI.sequence));
    } else ({ name, items } = DEFAULT_CHECKLISTS[input.kind]);

    const managerUser = employee.managerId
      ? (
          await tx
            .select({ userId: schema.employees.userId })
            .from(schema.employees)
            .where(eq(schema.employees.id, employee.managerId))
        )[0]?.userId
      : null;
    const [checklist] = await tx
      .insert(CK)
      .values({ companyId: employee.companyId, employeeId: employee.id, kind: input.kind, name, baseDate })
      .returning();
    await tx.insert(TK).values(
      items.map((item, i) => ({
        checklistId: checklist!.id,
        sequence: i,
        name: item.name,
        responsible: item.responsible,
        responsibleUserId:
          item.responsible === "manager"
            ? (managerUser ?? null)
            : item.responsible === "employee"
              ? employee.userId
              : null,
        dueDate: addDays(baseDate, item.dueDays),
        action: item.action ?? null,
      })),
    );
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Checklist ${name} dimulai`,
    });
    return this.get(tx, checklist!.id);
  }

  async list(tx: Db, query: { employeeId?: string; state?: string }) {
    return tx
      .select({
        checklist: CK,
        employeeName: schema.employees.name,
        tasks: sql<number>`(select count(*)::int from ${TK} t where t.checklist_id = hr_checklists.id)`,
        done: sql<number>`(select count(*)::int from ${TK} t where t.checklist_id = hr_checklists.id and t.done_at is not null)`,
        overdue: sql<number>`(select count(*)::int from ${TK} t where t.checklist_id = hr_checklists.id
          and t.done_at is null and t.due_date < current_date)`,
      })
      .from(CK)
      .innerJoin(schema.employees, eq(schema.employees.id, CK.employeeId))
      .where(
        and(
          eq(CK.companyId, currentContext().companyId),
          query.employeeId ? eq(CK.employeeId, query.employeeId) : undefined,
          query.state ? eq(CK.state, query.state as "open") : undefined,
        ),
      )
      .orderBy(desc(CK.createdAt))
      .then((rows) =>
        rows.map((r) => ({
          ...r.checklist,
          employeeName: r.employeeName,
          tasks: r.tasks,
          done: r.done,
          overdue: r.overdue,
        })),
      );
  }

  async get(tx: Db, id: string) {
    const [row] = await tx
      .select({ checklist: CK, employeeName: schema.employees.name })
      .from(CK)
      .innerJoin(schema.employees, eq(schema.employees.id, CK.employeeId))
      .where(and(eq(CK.id, id), eq(CK.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Checklist tidak ditemukan");
    const tasks = await tx
      .select({ task: TK, userName: schema.users.name })
      .from(TK)
      .leftJoin(schema.users, eq(schema.users.id, TK.responsibleUserId))
      .where(eq(TK.checklistId, id))
      .orderBy(asc(TK.dueDate), asc(TK.sequence));
    return {
      ...row.checklist,
      employeeName: row.employeeName,
      tasks: tasks.map((t) => ({ ...t.task, userName: t.userName })),
    };
  }

  /**
   * Tandai tugas selesai/belum. Boleh oleh penanggung jawabnya atau HR (hr.write). Tugas "nonaktifkan akun"
   * menonaktifkan user login karyawan saat diselesaikan.
   */
  async toggle(tx: Db, taskId: string, done: boolean) {
    const ctx = currentContext();
    const [row] = await tx
      .select({ task: TK, checklist: CK, employeeUserId: schema.employees.userId })
      .from(TK)
      .innerJoin(CK, eq(CK.id, TK.checklistId))
      .innerJoin(schema.employees, eq(schema.employees.id, CK.employeeId))
      .where(and(eq(TK.id, taskId), eq(CK.companyId, ctx.companyId)));
    if (!row) throw new NotFoundException("Tugas checklist tidak ditemukan");
    if (row.task.responsibleUserId !== ctx.userId && !hasPermission(ctx.permissions, "hr.write"))
      throw new ForbiddenException("Hanya penanggung jawab tugas atau HR yang bisa mengubah tugas ini");
    await tx
      .update(TK)
      .set(done ? { doneAt: new Date(), doneBy: ctx.userId } : { doneAt: null, doneBy: null })
      .where(eq(TK.id, taskId));
    if (done && row.task.action === "deactivate_user" && row.employeeUserId) {
      if (row.employeeUserId === ctx.userId)
        throw new BadRequestException("Tidak bisa menonaktifkan akun sendiri");
      await tx.update(schema.users).set({ active: false }).where(eq(schema.users.id, row.employeeUserId));
    }
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(TK)
      .where(and(eq(TK.checklistId, row.checklist.id), isNull(TK.doneAt)));
    await tx
      .update(CK)
      .set({ state: left?.n ? "open" : "done", updatedAt: sql`now()` })
      .where(eq(CK.id, row.checklist.id));
    return this.get(tx, row.checklist.id);
  }

  /** Tugas checklist terbuka milik user yang login (portal). */
  async myTasks(tx: Db) {
    const ctx = currentContext();
    return tx
      .select({
        id: TK.id,
        name: TK.name,
        dueDate: TK.dueDate,
        doneAt: TK.doneAt,
        checklistName: CK.name,
        kind: CK.kind,
        employeeName: schema.employees.name,
      })
      .from(TK)
      .innerJoin(CK, eq(CK.id, TK.checklistId))
      .innerJoin(schema.employees, eq(schema.employees.id, CK.employeeId))
      .where(and(eq(TK.responsibleUserId, ctx.userId), eq(CK.companyId, ctx.companyId), eq(CK.state, "open")))
      .orderBy(asc(TK.dueDate));
  }

  /** Mulai otomatis saat karyawan dibuat (onboarding) atau diberi tanggal keluar (offboarding). */
  async autoStart(tx: Db, employeeId: string, kind: Kind) {
    await this.start(tx, { employeeId, kind });
  }
}
