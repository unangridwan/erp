import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, schema, sql, type Db } from "@erp/db";
import {
  FEEDBACK_COMPETENCIES,
  announcementSchema,
  employeeNoteSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
  feedbackSummary,
  goalCheckinSchema,
  goalProgress,
  goalSchema,
  hasPermission,
  businessToday,
  elapsedShare,
  KPI_BY_CODE,
  KPI_METRIC,
  paceStatus,
} from "@erp/shared";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { NotificationService } from "../notifications/notification.service.js";
import { EmployeeService } from "./employee.service.js";
import { HrModule } from "./hr.module.js";

const G = schema.performanceGoals;
const GC = schema.goalCheckins;
const FB = schema.feedbackRequests;
const NT = schema.employeeNotes;
const AN = schema.announcements;
const AR = schema.announcementReads;
const E = schema.employees;
const today = () => businessToday();
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Employee = typeof E.$inferSelect;

/** Relasi user saat ini dengan seorang karyawan: HR, karyawan itu sendiri, atau atasan langsungnya. */
@Injectable()
export class PeopleAccess {
  async relation(tx: Db, employee: Employee) {
    const ctx = currentContext();
    const self = employee.userId === ctx.userId;
    let manager = false;
    if (employee.managerId) {
      const [m] = await tx.select({ userId: E.userId }).from(E).where(eq(E.id, employee.managerId));
      manager = !!m?.userId && m.userId === ctx.userId;
    }
    return {
      self,
      manager,
      hrRead: hasPermission(ctx.permissions, "hr.read"),
      hrManage: hasPermission(ctx.permissions, "hr.manage"),
    };
  }

  /** Karyawan milik user saat ini (null bila akun tidak terhubung). */
  async me(tx: Db) {
    const ctx = currentContext();
    const [row] = await tx
      .select()
      .from(E)
      .where(and(eq(E.userId, ctx.userId), eq(E.companyId, ctx.companyId)));
    return row ?? null;
  }
}

// ---- Sasaran bertingkat ----

@Injectable()
export class GoalService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(PeopleAccess) private readonly access: PeopleAccess,
  ) {}

  /** Daftar sasaran beserta progres (induk dihitung dari anak). Non-HR: sasaran perusahaan/departemen, milik sendiri, bawahan. */
  async list(tx: Db, q: { cycleId?: string; employeeId?: string; mine?: boolean }) {
    const ctx = currentContext();
    const all = await tx
      .select({
        goal: G,
        employeeName: E.name,
        employeeUserId: E.userId,
        employeeManagerId: E.managerId,
        departmentName: schema.departments.name,
      })
      .from(G)
      .leftJoin(E, eq(E.id, G.employeeId))
      .leftJoin(schema.departments, eq(schema.departments.id, G.departmentId))
      .where(and(eq(G.companyId, ctx.companyId), q.cycleId ? eq(G.cycleId, q.cycleId) : undefined))
      .orderBy(asc(G.createdAt));
    const progress = goalProgress(all.map((r) => r.goal));
    const me = await this.access.me(tx);
    const now = today();
    const hr = hasPermission(ctx.permissions, "hr.read");
    return all
      .filter((r) => {
        if (q.employeeId && r.goal.employeeId !== q.employeeId) return false;
        if (q.mine) return r.employeeUserId === ctx.userId;
        if (hr || !r.goal.employeeId) return true;
        return r.employeeUserId === ctx.userId || (!!me && r.employeeManagerId === me.id);
      })
      .map((r) => ({
        ...r.goal,
        employeeName: r.employeeName,
        departmentName: r.departmentName,
        progress: progress.get(r.goal.id) ?? 0,
        // Status laju: capaian dibanding porsi waktu periode (atau sampai tenggat) yang sudah berjalan.
        ...paceStatus(
          progress.get(r.goal.id) ?? 0,
          elapsedShare(
            r.goal.periodFrom ?? (r.goal.dueDate ? r.goal.createdAt.toISOString().slice(0, 10) : null),
            r.goal.periodTo ?? r.goal.dueDate,
            now,
          ),
          r.goal.state === "done",
        ),
        kpi: r.goal.kpiCode ? (KPI_BY_CODE.get(r.goal.kpiCode)?.label ?? null) : null,
        canEdit:
          hasPermission(ctx.permissions, "hr.manage") ||
          r.employeeUserId === ctx.userId ||
          (!!me && r.employeeManagerId === me.id),
      }));
  }

  /** Karyawan pemilik, atasan langsungnya, atau hr.manage; sasaran perusahaan/departemen hanya hr.manage. */
  private async assertCanEdit(tx: Db, employeeId: string | null | undefined) {
    const ctx = currentContext();
    if (hasPermission(ctx.permissions, "hr.manage")) return;
    if (!employeeId)
      throw new ForbiddenException("Sasaran perusahaan/departemen hanya diatur HR (hr.manage)");
    const r = await this.access.relation(tx, await this.employees.find(tx, employeeId));
    if (!r.self && !r.manager) throw new ForbiddenException("Hanya karyawan, atasan langsung, atau HR");
  }

  private async values(tx: Db, input: z.infer<typeof goalSchema>, id: string | null) {
    const companyId = currentContext().companyId;
    if (input.parentId) {
      // Induk di perusahaan yang sama & tidak membentuk siklus.
      let cursor: string | null = input.parentId;
      for (let depth = 0; cursor; depth++) {
        if (cursor === id) throw fieldError("parentId", "Induk tidak boleh sasaran ini atau turunannya");
        const [p]: { parentId: string | null; companyId: string }[] = await tx
          .select({ parentId: G.parentId, companyId: G.companyId })
          .from(G)
          .where(eq(G.id, cursor));
        if (!p || p.companyId !== companyId) throw fieldError("parentId", "Sasaran induk tidak ditemukan");
        if (depth > 20) break;
        cursor = p.parentId;
      }
    }
    if (input.employeeId) await this.employees.find(tx, input.employeeId);
    if (input.departmentId) {
      const [d] = await tx
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(
          and(eq(schema.departments.id, input.departmentId), eq(schema.departments.companyId, companyId)),
        );
      if (!d) throw fieldError("departmentId", "Departemen tidak ditemukan");
    }
    const kpi = input.kpiCode ? KPI_BY_CODE.get(input.kpiCode) : undefined;
    if (input.kpiCode && !kpi) throw fieldError("kpiCode", "KPI tidak ditemukan");
    if (input.cycleId) {
      const [c] = await tx
        .select({ id: schema.appraisalCycles.id })
        .from(schema.appraisalCycles)
        .where(
          and(eq(schema.appraisalCycles.id, input.cycleId), eq(schema.appraisalCycles.companyId, companyId)),
        );
      if (!c) throw fieldError("cycleId", "Siklus penilaian tidak ditemukan");
    }
    return {
      parentId: input.parentId ?? null,
      cycleId: input.cycleId ?? null,
      employeeId: input.employeeId ?? null,
      departmentId: input.departmentId ?? null,
      title: input.title,
      description: input.description ?? null,
      // Sasaran KPI: metrik mengikuti satuan KPI.
      metric: kpi ? KPI_METRIC[kpi.unit] : input.metric,
      startValue: String(input.startValue),
      targetValue: String(!kpi && input.metric === "boolean" ? 1 : input.targetValue),
      currentValue: String(input.currentValue),
      unit: input.unit ?? null,
      weight: String(input.weight),
      dueDate: input.dueDate ?? null,
      state: input.state,
      kpiCode: kpi ? kpi.code : null,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
      // Nilai otomatis dihitung ulang saat dibaca berikutnya.
      ...(kpi ? { valueComputedAt: null } : {}),
    };
  }

  async create(tx: Db, input: z.infer<typeof goalSchema>) {
    await this.assertCanEdit(tx, input.employeeId);
    const [row] = await tx
      .insert(G)
      .values({
        ...(await this.values(tx, input, null)),
        companyId: currentContext().companyId,
        createdBy: currentContext().userId,
      })
      .returning();
    return row!;
  }

  async update(tx: Db, id: string, input: z.infer<typeof goalSchema>) {
    const goal = await this.find(tx, id);
    await this.assertCanEdit(tx, goal.employeeId);
    if (input.employeeId !== goal.employeeId) await this.assertCanEdit(tx, input.employeeId);
    const [row] = await tx
      .update(G)
      .set({ ...(await this.values(tx, input, id)), updatedAt: sql`now()` })
      .where(eq(G.id, id))
      .returning();
    return row!;
  }

  /** Hapus: hr.manage, atasan langsung, atau pembuat sasaran (karyawan tidak menghapus sasaran dari atasannya). */
  async remove(tx: Db, id: string) {
    const goal = await this.find(tx, id);
    await this.assertCanEdit(tx, goal.employeeId);
    const ctx = currentContext();
    if (!hasPermission(ctx.permissions, "hr.manage") && goal.employeeId && goal.createdBy !== ctx.userId) {
      const r = await this.access.relation(tx, await this.employees.find(tx, goal.employeeId));
      if (!r.manager) throw new ForbiddenException("Sasaran dari atasan hanya bisa dihapus atasan atau HR");
    }
    await tx.delete(G).where(eq(G.id, id));
  }

  /** Check-in progres: nilai terbaru + catatan; sasaran yang mencapai target tidak otomatis ditutup. */
  async checkin(tx: Db, id: string, input: z.infer<typeof goalCheckinSchema>) {
    const goal = await this.find(tx, id);
    await this.assertCanEdit(tx, goal.employeeId);
    if (goal.state !== "active") throw new BadRequestException("Sasaran tidak aktif");
    await tx.insert(GC).values({
      goalId: id,
      value: String(input.value),
      note: input.note ?? null,
      createdBy: currentContext().userId,
    });
    await tx
      .update(G)
      .set({ currentValue: String(input.value), updatedAt: sql`now()` })
      .where(eq(G.id, id));
    return this.checkins(tx, id);
  }

  async checkins(tx: Db, id: string) {
    await this.find(tx, id);
    return tx
      .select({ checkin: GC, userName: schema.users.name })
      .from(GC)
      .leftJoin(schema.users, eq(schema.users.id, GC.createdBy))
      .where(eq(GC.goalId, id))
      .orderBy(desc(GC.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.checkin, userName: r.userName })));
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(G)
      .where(and(eq(G.id, id), eq(G.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Sasaran tidak ditemukan");
    return row;
  }
}

@Controller()
class GoalsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(GoalService) private readonly goals: GoalService,
  ) {}

  @Get("goals")
  list(@Query("cycleId") cycleId?: string, @Query("employeeId") employeeId?: string) {
    return this.tenantDb.run((tx) => this.goals.list(tx, { cycleId, employeeId }));
  }

  @Get("me/goals")
  mine() {
    return this.tenantDb.run((tx) => this.goals.list(tx, { mine: true }));
  }

  @Post("goals")
  create(@Body() body: unknown) {
    const input = parse(goalSchema, body);
    return this.tenantDb.run((tx) => this.goals.create(tx, input));
  }

  @Put("goals/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(goalSchema, body);
    return this.tenantDb.run((tx) => this.goals.update(tx, id, input));
  }

  @Delete("goals/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.goals.remove(tx, id));
  }

  @Get("goals/:id/checkins")
  checkins(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.goals.checkins(tx, id));
  }

  @Post("goals/:id/checkins")
  checkin(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(goalCheckinSchema, body);
    return this.tenantDb.run((tx) => this.goals.checkin(tx, id, input));
  }
}

// ---- Feedback 360 ----

@Controller()
class FeedbackController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(PeopleAccess) private readonly access: PeopleAccess,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** HR atau atasan langsung meminta feedback dari beberapa penilai sekaligus. */
  @Post("feedback-requests")
  create(@Body() body: unknown) {
    const input = parse(feedbackRequestSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const subject = await this.employees.find(tx, input.subjectEmployeeId);
      const r = await this.access.relation(tx, subject);
      if (!r.hrManage && !r.manager) throw new ForbiddenException("Hanya atasan langsung atau HR");
      const users = await tx
        .select({ id: schema.userCompanies.userId })
        .from(schema.userCompanies)
        .where(
          and(
            eq(schema.userCompanies.companyId, ctx.companyId),
            inArray(schema.userCompanies.userId, input.reviewerUserIds),
          ),
        );
      if (users.length !== new Set(input.reviewerUserIds).size)
        throw fieldError("reviewerUserIds", "Penilai harus pengguna di perusahaan ini");
      if (input.relation !== "self" && input.reviewerUserIds.includes(subject.userId ?? ""))
        throw fieldError("reviewerUserIds", "Karyawan menilai diri sendiri lewat relasi 'diri sendiri'");
      const rows = await tx
        .insert(FB)
        .values(
          input.reviewerUserIds.map((reviewerUserId) => ({
            companyId: ctx.companyId,
            cycleId: input.cycleId ?? null,
            subjectEmployeeId: subject.id,
            reviewerUserId,
            relation: input.relation,
            dueDate: input.dueDate ?? null,
            requestedBy: ctx.userId,
          })),
        )
        .onConflictDoNothing()
        .returning();
      await this.notifications.notify(
        tx,
        rows.map((x) => x.reviewerUserId),
        {
          kind: "feedback.request",
          title: `Mohon beri feedback untuk ${subject.name}`,
          body: input.dueDate ? `Tenggat ${input.dueDate}` : null,
          link: "/me",
        },
      );
      return { created: rows.length };
    });
  }

  /** Status permintaan feedback seorang karyawan (tanpa isi penilaian). */
  @Get("feedback-requests")
  list(@Query("subjectEmployeeId", ParseUUIDPipe) subjectEmployeeId: string) {
    return this.tenantDb.run(async (tx) => {
      const subject = await this.employees.find(tx, subjectEmployeeId);
      const r = await this.access.relation(tx, subject);
      if (!r.hrRead && !r.manager) throw new ForbiddenException("Hanya atasan langsung atau HR");
      return tx
        .select({
          id: FB.id,
          relation: FB.relation,
          state: FB.state,
          dueDate: FB.dueDate,
          cycleId: FB.cycleId,
          reviewerName: schema.users.name,
          submittedAt: FB.submittedAt,
          createdAt: FB.createdAt,
        })
        .from(FB)
        .innerJoin(schema.users, eq(schema.users.id, FB.reviewerUserId))
        .where(eq(FB.subjectEmployeeId, subjectEmployeeId))
        .orderBy(desc(FB.createdAt));
    });
  }

  @Get("me/feedback-requests")
  mine() {
    return this.tenantDb.run((tx) =>
      tx
        .select({ request: FB, subjectName: E.name })
        .from(FB)
        .innerJoin(E, eq(E.id, FB.subjectEmployeeId))
        .where(
          and(eq(FB.reviewerUserId, currentContext().userId), eq(FB.companyId, currentContext().companyId)),
        )
        .orderBy(desc(FB.createdAt))
        .limit(50)
        .then((rows) => rows.map((r) => ({ ...r.request, subjectName: r.subjectName }))),
    );
  }

  @Put("feedback-requests/:id")
  submit(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(feedbackResponseSchema, body);
    return this.tenantDb.run(async (tx) => {
      const req = await this.mine1(tx, id);
      const keys = new Set<string>(FEEDBACK_COMPETENCIES.map((c) => c.key));
      const unknown = Object.keys(input.scores).find((k) => !keys.has(k));
      if (unknown) throw fieldError("scores", `Kompetensi tidak dikenal: ${unknown}`);
      if (!Object.keys(input.scores).length) throw fieldError("scores", "Isi minimal satu skor kompetensi");
      const [row] = await tx
        .update(FB)
        .set({
          scores: input.scores,
          strengths: input.strengths ?? null,
          improvements: input.improvements ?? null,
          state: "submitted",
          submittedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(FB.id, req.id))
        .returning();
      return row!;
    });
  }

  @Post("feedback-requests/:id/decline")
  @HttpCode(200)
  decline(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const req = await this.mine1(tx, id);
      const [row] = await tx
        .update(FB)
        .set({ state: "declined", updatedAt: sql`now()` })
        .where(eq(FB.id, req.id))
        .returning();
      return row!;
    });
  }

  /** Ringkasan anonim untuk HR, atasan langsung, atau karyawan itu sendiri. */
  @Get("employees/:id/feedback-summary")
  summary(@Param("id", ParseUUIDPipe) id: string, @Query("cycleId") cycleId?: string) {
    return this.tenantDb.run(async (tx) => {
      const subject = await this.employees.find(tx, id);
      const r = await this.access.relation(tx, subject);
      if (!r.hrRead && !r.manager && !r.self) throw new ForbiddenException("Butuh permission hr.read");
      const rows = await tx
        .select()
        .from(FB)
        .where(
          and(
            eq(FB.subjectEmployeeId, id),
            eq(FB.state, "submitted"),
            cycleId ? eq(FB.cycleId, cycleId) : undefined,
          ),
        );
      const [pending] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(FB)
        .where(and(eq(FB.subjectEmployeeId, id), eq(FB.state, "pending")));
      return { ...feedbackSummary(rows), pending: pending?.n ?? 0 };
    });
  }

  private async mine1(tx: Db, id: string) {
    const [req] = await tx.select().from(FB).where(eq(FB.id, id));
    if (!req || req.reviewerUserId !== currentContext().userId)
      throw new NotFoundException("Permintaan feedback tidak ditemukan");
    if (req.state !== "pending") throw new BadRequestException("Permintaan feedback sudah dijawab");
    return req;
  }
}

// ---- Catatan atasan ----

@Controller()
class NotesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(PeopleAccess) private readonly access: PeopleAccess,
  ) {}

  /** HR (hr.read) atau atasan langsung; karyawan tidak pernah melihat catatan tentang dirinya. */
  private async guard(tx: Db, employeeId: string) {
    const employee = await this.employees.find(tx, employeeId);
    const r = await this.access.relation(tx, employee);
    if (r.self) throw new ForbiddenException("Catatan ini tidak tersedia untuk karyawan yang bersangkutan");
    if (!r.hrRead && !r.manager) throw new ForbiddenException("Hanya atasan langsung atau HR");
    return { employee, r };
  }

  @Get("employees/:id/notes")
  list(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const { r } = await this.guard(tx, id);
      const ctx = currentContext();
      return tx
        .select({ note: NT, authorName: schema.users.name })
        .from(NT)
        .leftJoin(schema.users, eq(schema.users.id, NT.authorUserId))
        .where(
          and(
            eq(NT.employeeId, id),
            r.hrManage
              ? or(eq(NT.authorUserId, ctx.userId), eq(NT.visibility, "hr"))
              : eq(NT.authorUserId, ctx.userId),
          ),
        )
        .orderBy(desc(NT.createdAt))
        .then((rows) =>
          rows.map((x) => ({
            ...x.note,
            authorName: x.authorName,
            mine: x.note.authorUserId === ctx.userId,
          })),
        );
    });
  }

  @Post("employees/:id/notes")
  create(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(employeeNoteSchema, body);
    return this.tenantDb.run(async (tx) => {
      const { employee } = await this.guard(tx, id);
      const [row] = await tx
        .insert(NT)
        .values({
          ...input,
          companyId: employee.companyId,
          employeeId: id,
          authorUserId: currentContext().userId,
        })
        .returning();
      return row!;
    });
  }

  @Delete("employee-notes/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .delete(NT)
        .where(
          and(
            eq(NT.id, id),
            eq(NT.authorUserId, currentContext().userId),
            eq(NT.companyId, currentContext().companyId),
          ),
        )
        .returning({ id: NT.id });
      if (!row) throw new NotFoundException("Catatan tidak ditemukan");
    });
  }
}

// ---- Pengumuman & Who's Off ----

@Controller()
class AnnouncementsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PeopleAccess) private readonly access: PeopleAccess,
  ) {}

  @Get("announcements")
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          announcement: AN,
          departmentName: schema.departments.name,
          reads: sql<number>`(select count(*) from announcement_reads r where r.announcement_id = ${AN.id})::int`,
        })
        .from(AN)
        .leftJoin(schema.departments, eq(schema.departments.id, AN.departmentId))
        .where(eq(AN.companyId, currentContext().companyId))
        .orderBy(desc(AN.pinned), desc(AN.createdAt))
        .then((rows) =>
          rows.map((r) => ({ ...r.announcement, departmentName: r.departmentName, reads: r.reads })),
        ),
    );
  }

  private values(input: z.infer<typeof announcementSchema>) {
    return {
      title: input.title,
      body: input.body,
      departmentId: input.departmentId ?? null,
      pinned: input.pinned,
      expiresAt: input.expiresAt ?? null,
    };
  }

  @Post("announcements")
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(announcementSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const [row] = await tx
        .insert(AN)
        .values({
          ...this.values(input),
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          publishedAt: input.publish ? sql`now()` : null,
        })
        .returning();
      return row!;
    });
  }

  @Put("announcements/:id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(announcementSchema, body);
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .update(AN)
        .set({
          ...this.values(input),
          // Terbit sekali (tanggal terbit tetap); publish=false menarik kembali menjadi draft.
          publishedAt: input.publish ? sql`coalesce(${AN.publishedAt}, now())` : null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(AN.id, id), eq(AN.companyId, currentContext().companyId)))
        .returning();
      if (!row) throw new NotFoundException("Pengumuman tidak ditemukan");
      return row;
    });
  }

  @Delete("announcements/:id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) =>
      tx.delete(AN).where(and(eq(AN.id, id), eq(AN.companyId, currentContext().companyId))),
    );
  }

  /** Pengumuman aktif untuk user (semua karyawan atau departemennya), disematkan di atas. */
  @Get("me/announcements")
  mine() {
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const me = await this.access.me(tx);
      return tx
        .select({
          announcement: AN,
          readAt: AR.readAt,
        })
        .from(AN)
        .leftJoin(AR, and(eq(AR.announcementId, AN.id), eq(AR.userId, ctx.userId)))
        .where(
          and(
            eq(AN.companyId, ctx.companyId),
            sql`${AN.publishedAt} is not null`,
            or(isNull(AN.expiresAt), gte(AN.expiresAt, today())),
            me?.departmentId
              ? or(isNull(AN.departmentId), eq(AN.departmentId, me.departmentId))
              : isNull(AN.departmentId),
          ),
        )
        .orderBy(desc(AN.pinned), desc(AN.publishedAt))
        .limit(30)
        .then((rows) => rows.map((r) => ({ ...r.announcement, readAt: r.readAt })));
    });
  }

  @Post("me/announcements/:id/read")
  @HttpCode(200)
  read(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const [a] = await tx
        .select({ id: AN.id })
        .from(AN)
        .where(and(eq(AN.id, id), eq(AN.companyId, currentContext().companyId)));
      if (!a) throw new NotFoundException("Pengumuman tidak ditemukan");
      await tx
        .insert(AR)
        .values({ announcementId: id, userId: currentContext().userId })
        .onConflictDoNothing();
      return { ok: true };
    });
  }

  /** Who's Off: cuti disetujui rekan sekantor dalam rentang (bawaan 14 hari); jenis cuti hanya untuk hr.read. */
  @Get("me/whos-off")
  whosOff(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("departmentId") departmentId?: string,
  ) {
    const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today();
    const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : addDays(start, 13);
    if (end < start || end > addDays(start, 92))
      throw new BadRequestException("Rentang tanggal maksimal 3 bulan");
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const hr = hasPermission(ctx.permissions, "hr.read");
      const rows = await tx
        .select({
          id: schema.leaveRequests.id,
          employeeId: E.id,
          employeeName: E.name,
          departmentName: schema.departments.name,
          dateFrom: schema.leaveRequests.dateFrom,
          dateTo: schema.leaveRequests.dateTo,
          halfDay: schema.leaveRequests.halfDay,
          leaveType: schema.leaveTypes.name,
        })
        .from(schema.leaveRequests)
        .innerJoin(E, eq(E.id, schema.leaveRequests.employeeId))
        .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
        .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .where(
          and(
            eq(schema.leaveRequests.companyId, ctx.companyId),
            eq(schema.leaveRequests.state, "approved"),
            lte(schema.leaveRequests.dateFrom, end),
            gte(schema.leaveRequests.dateTo, start),
            departmentId ? eq(E.departmentId, departmentId) : undefined,
            or(isNull(E.resignDate), gte(E.resignDate, start)),
            ne(E.active, false),
          ),
        )
        .orderBy(asc(schema.leaveRequests.dateFrom), asc(E.name));
      return { from: start, to: end, items: rows.map((r) => ({ ...r, leaveType: hr ? r.leaveType : null })) };
    });
  }
}

@Module({
  imports: [HrModule],
  controllers: [GoalsController, FeedbackController, NotesController, AnnouncementsController],
  providers: [PeopleAccess, GoalService],
})
export class PerformanceAdvancedModule {}
