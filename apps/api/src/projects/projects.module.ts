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
  Req,
} from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, notInArray, or, schema, sql, type Db } from "@erp/db";
import {
  PROJECT_STATUSES,
  projectSyncSchema,
  taskSyncSchema,
  timesheetBatchSchema,
  timesheetEntrySchema,
  type EmployeeRef,
  LIST_LOAD_LIMIT,
} from "@erp/shared";
import type { Request } from "express";
import type { Principal } from "../auth/auth.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { EmployeeService } from "../hr/employee.service.js";
import { HrModule } from "../hr/hr.module.js";

const P = schema.externalProjects;
const M = schema.externalProjectMembers;
const T = schema.externalTasks;
const TS = schema.externalTimesheets;
const E = schema.employees;

type Req_ = Request & { principal: Principal };
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** Proyek, task, & timesheet dari aplikasi terhubung: sinkron (akun layanan) dan tampilan per karyawan. */
@Injectable()
export class ProjectService {
  /** Cari karyawan dari rujukan aplikasi (id / email kerja atau akun / nomor) di perusahaan yang boleh diakses. */
  async resolveEmployee(tx: Db, ref: EmployeeRef, preferCompanyId?: string): Promise<string | undefined> {
    const { companyIds } = currentContext();
    const where = ref.employeeId
      ? eq(E.id, ref.employeeId)
      : ref.employeeEmail
        ? or(
            sql`lower(${E.workEmail}) = ${ref.employeeEmail}`,
            inArray(
              E.userId,
              tx
                .select({ id: schema.users.id })
                .from(schema.users)
                .where(sql`lower(${schema.users.email}) = ${ref.employeeEmail}`),
            ),
          )
        : eq(E.employeeNumber, ref.employeeNumber!);
    const [row] = await tx
      .select({ id: E.id })
      .from(E)
      .where(and(where, inArray(E.companyId, companyIds)))
      .orderBy(
        desc(E.active),
        preferCompanyId ? desc(sql`${E.companyId} = ${preferCompanyId}`) : asc(E.createdAt),
        asc(E.createdAt),
      )
      .limit(1);
    return row?.id;
  }

  async projectByExternal(tx: Db, clientId: string, externalId: string) {
    const [row] = await tx
      .select()
      .from(P)
      .where(and(eq(P.clientId, clientId), eq(P.externalId, externalId)));
    return row;
  }

  /** Proyek yang diikuti/dipimpin karyawan, task terbuka, dan jam timesheet. */
  async employeeProjects(tx: Db, employeeId: string) {
    const since = monthStart();
    const projects = await tx.execute<{
      id: string;
      code: string | null;
      name: string;
      status: string;
      start_date: string | null;
      end_date: string | null;
      url: string | null;
      app: string;
      role: string | null;
      allocation: string | null;
      is_manager: boolean;
      hours_month: string;
      hours_total: string;
      open_tasks: number;
    }>(sql`
      select p.id, p.code, p.name, p.status, p.start_date, p.end_date, p.url, c.name as app,
             m.role, m.allocation, (p.manager_employee_id = ${employeeId}) as is_manager,
             coalesce((select sum(t.hours) from external_timesheets t
                        where t.project_id = p.id and t.employee_id = ${employeeId} and t.date >= ${since}::date), 0)::text as hours_month,
             coalesce((select sum(t.hours) from external_timesheets t
                        where t.project_id = p.id and t.employee_id = ${employeeId}), 0)::text as hours_total,
             (select count(*) from external_tasks k
               where k.project_id = p.id and k.assignee_employee_id = ${employeeId}
                 and k.status not in ('done', 'cancelled'))::int as open_tasks
      from external_projects p
      join oauth_clients c on c.id = p.client_id
      left join external_project_members m on m.project_id = p.id and m.employee_id = ${employeeId}
      where m.id is not null or p.manager_employee_id = ${employeeId}
         or exists (select 1 from external_tasks k where k.project_id = p.id and k.assignee_employee_id = ${employeeId})
      order by (p.status = 'active') desc, p.end_date nulls last, p.name`);
    const openTasks = await tx
      .select({
        id: T.id,
        title: T.title,
        status: T.status,
        priority: T.priority,
        dueDate: T.dueDate,
        url: T.url,
        projectId: P.id,
        projectName: P.name,
      })
      .from(T)
      .innerJoin(P, eq(P.id, T.projectId))
      .where(and(eq(T.assigneeEmployeeId, employeeId), notInArray(T.status, ["done", "cancelled"])))
      .orderBy(sql`${T.dueDate} asc nulls last`, desc(T.updatedAt))
      .limit(50);
    const timesheets = await tx
      .select({
        id: TS.id,
        date: TS.date,
        hours: TS.hours,
        description: TS.description,
        approved: TS.approved,
        projectId: P.id,
        projectName: P.name,
        taskTitle: T.title,
      })
      .from(TS)
      .innerJoin(P, eq(P.id, TS.projectId))
      .leftJoin(T, eq(T.id, TS.taskId))
      .where(eq(TS.employeeId, employeeId))
      .orderBy(desc(TS.date), desc(TS.createdAt))
      .limit(30);
    const list = projects.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      startDate: p.start_date,
      endDate: p.end_date,
      url: p.url,
      app: p.app,
      role: p.role,
      allocation: p.allocation,
      isManager: p.is_manager,
      hoursThisMonth: p.hours_month,
      hoursTotal: p.hours_total,
      openTasks: p.open_tasks,
    }));
    return {
      projects: list,
      activeProjects: list.filter((p) => p.status === "active").length,
      openTasks,
      recentTimesheets: timesheets,
      hoursThisMonth: list.reduce((s, p) => s + Number(p.hoursThisMonth), 0).toFixed(2),
    };
  }
}

/** Sinkron dari aplikasi terhubung: hanya token akun layanan; data diikat ke aplikasi pengirim. */
@Controller("integrations")
class ProjectSyncController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ProjectService) private readonly projects: ProjectService,
  ) {}

  @Put("projects/:externalId")
  @RequirePermission("project.write")
  upsertProject(@Req() req: Req_, @Param("externalId") externalId: string, @Body() body: unknown) {
    const clientId = this.clientOf(req);
    const input = parse(projectSyncSchema, body);
    const ctx = currentContext();
    const companyId = input.companyId ?? ctx.companyId;
    if (!ctx.companyIds.includes(companyId))
      throw new BadRequestException("Perusahaan tidak dapat diakses akun layanan aplikasi");
    return this.tenantDb.run(async (tx) => {
      const skipped: { index: number | "manager"; reason: string }[] = [];
      const managerId = input.manager
        ? await this.projects.resolveEmployee(tx, input.manager, companyId)
        : null;
      if (input.manager && !managerId) skipped.push({ index: "manager", reason: "Karyawan tidak ditemukan" });
      const values = {
        companyId,
        code: input.code ?? null,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        url: input.url ?? null,
        managerEmployeeId: managerId ?? null,
      };
      const [project] = await tx
        .insert(P)
        .values({ ...values, clientId, externalId: this.id(externalId) })
        .onConflictDoUpdate({ target: [P.clientId, P.externalId], set: { ...values, updatedAt: sql`now()` } })
        .returning();
      if (input.members) {
        const members = new Map<string, (typeof input.members)[number]>();
        for (const [index, m] of input.members.entries()) {
          const employeeId = await this.projects.resolveEmployee(tx, m, companyId);
          if (employeeId) members.set(employeeId, m);
          else skipped.push({ index, reason: "Karyawan tidak ditemukan" });
        }
        await tx
          .delete(M)
          .where(
            and(
              eq(M.projectId, project!.id),
              members.size ? notInArray(M.employeeId, [...members.keys()]) : undefined,
            ),
          );
        for (const [employeeId, m] of members) {
          const v = {
            role: m.role ?? null,
            allocation: m.allocation === undefined || m.allocation === null ? null : String(m.allocation),
            startDate: m.startDate ?? null,
            endDate: m.endDate ?? null,
          };
          await tx
            .insert(M)
            .values({ ...v, projectId: project!.id, employeeId })
            .onConflictDoUpdate({ target: [M.projectId, M.employeeId], set: v });
        }
      }
      return { project, skipped };
    });
  }

  @Delete("projects/:externalId")
  @RequirePermission("project.write")
  @HttpCode(204)
  async deleteProject(@Req() req: Req_, @Param("externalId") externalId: string) {
    const clientId = this.clientOf(req);
    await this.tenantDb.run((tx) =>
      tx.delete(P).where(and(eq(P.clientId, clientId), eq(P.externalId, externalId))),
    );
  }

  @Put("tasks/:externalId")
  @RequirePermission("project.write")
  upsertTask(@Req() req: Req_, @Param("externalId") externalId: string, @Body() body: unknown) {
    const clientId = this.clientOf(req);
    const input = parse(taskSyncSchema, body);
    return this.tenantDb.run(async (tx) => {
      const project = await this.projects.projectByExternal(tx, clientId, input.projectExternalId);
      if (!project) throw new NotFoundException("Proyek belum dikirim ke ERP");
      const assigneeId = input.assignee
        ? await this.projects.resolveEmployee(tx, input.assignee, project.companyId)
        : null;
      const done = input.status === "done" || input.status === "cancelled";
      const values = {
        projectId: project.id,
        title: input.title,
        status: input.status,
        priority: input.priority,
        assigneeEmployeeId: assigneeId ?? null,
        dueDate: input.dueDate ?? null,
        url: input.url ?? null,
      };
      const closedAt = input.closedAt ? new Date(input.closedAt) : null;
      const [task] = await tx
        .insert(T)
        .values({
          ...values,
          clientId,
          externalId: this.id(externalId),
          closedAt: done ? (closedAt ?? new Date()) : null,
        })
        .onConflictDoUpdate({
          target: [T.clientId, T.externalId],
          set: {
            ...values,
            // Selesai: pertahankan waktu tutup pertama kecuali aplikasi mengirimnya; dibuka lagi = kosong.
            closedAt: done ? (closedAt ? closedAt : sql`coalesce(${T.closedAt}, now())`) : null,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return { task, assigneeResolved: !input.assignee || Boolean(assigneeId) };
    });
  }

  @Delete("tasks/:externalId")
  @RequirePermission("project.write")
  @HttpCode(204)
  async deleteTask(@Req() req: Req_, @Param("externalId") externalId: string) {
    const clientId = this.clientOf(req);
    await this.tenantDb.run((tx) =>
      tx.delete(T).where(and(eq(T.clientId, clientId), eq(T.externalId, externalId))),
    );
  }

  /** Upsert timesheet per baris (idempoten via externalId); baris gagal dilaporkan, baris lain tetap tersimpan. */
  @Post("timesheets/batch")
  @RequirePermission("project.write")
  @HttpCode(200)
  timesheets(@Req() req: Req_, @Body() body: unknown) {
    const clientId = this.clientOf(req);
    const { entries } = parse(timesheetBatchSchema, body);
    return this.tenantDb.run(async (tx) => {
      const projects = new Map<string, typeof P.$inferSelect | undefined>();
      const tasks = new Map<string, string | undefined>();
      const errors: { index: number; externalId?: string; reason: string }[] = [];
      let upserted = 0;
      for (const [index, raw] of entries.entries()) {
        const parsed = timesheetEntrySchema.safeParse(raw);
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          errors.push({
            index,
            externalId: (raw as { externalId?: string })?.externalId,
            reason: `${issue.path.join(".") || "baris"}: ${issue.message}`,
          });
          continue;
        }
        const e = parsed.data;
        if (!projects.has(e.projectExternalId))
          projects.set(
            e.projectExternalId,
            await this.projects.projectByExternal(tx, clientId, e.projectExternalId),
          );
        const project = projects.get(e.projectExternalId);
        if (!project) {
          errors.push({ index, externalId: e.externalId, reason: "Proyek belum dikirim ke ERP" });
          continue;
        }
        let taskId: string | undefined;
        if (e.taskExternalId) {
          if (!tasks.has(e.taskExternalId)) {
            const [t] = await tx
              .select({ id: T.id })
              .from(T)
              .where(and(eq(T.clientId, clientId), eq(T.externalId, e.taskExternalId)));
            tasks.set(e.taskExternalId, t?.id);
          }
          taskId = tasks.get(e.taskExternalId);
          if (!taskId) {
            errors.push({ index, externalId: e.externalId, reason: "Task belum dikirim ke ERP" });
            continue;
          }
        }
        const employeeId = await this.projects.resolveEmployee(tx, e, project.companyId);
        if (!employeeId) {
          errors.push({ index, externalId: e.externalId, reason: "Karyawan tidak ditemukan" });
          continue;
        }
        const values = {
          projectId: project.id,
          taskId: taskId ?? null,
          employeeId,
          date: e.date,
          hours: String(e.hours),
          description: e.description ?? null,
          approved: e.approved,
        };
        await tx
          .insert(TS)
          .values({ ...values, clientId, externalId: e.externalId })
          .onConflictDoUpdate({
            target: [TS.clientId, TS.externalId],
            set: { ...values, updatedAt: sql`now()` },
          });
        upserted++;
      }
      return { upserted, errors };
    });
  }

  @Delete("timesheets/:externalId")
  @RequirePermission("project.write")
  @HttpCode(204)
  async deleteTimesheet(@Req() req: Req_, @Param("externalId") externalId: string) {
    const clientId = this.clientOf(req);
    await this.tenantDb.run((tx) =>
      tx.delete(TS).where(and(eq(TS.clientId, clientId), eq(TS.externalId, externalId))),
    );
  }

  private clientOf(req: Req_) {
    if (!req.principal.clientId) throw new ForbiddenException("Hanya untuk akun layanan aplikasi terhubung");
    return req.principal.clientId;
  }

  private id(externalId: string) {
    const v = externalId.trim();
    if (!v || v.length > 200) throw new BadRequestException("externalId tidak valid");
    return v;
  }
}

/** Tampilan proyek di ERP (SDM, baca saja). */
@Controller()
class ProjectsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ProjectService) private readonly projects: ProjectService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get("projects")
  @RequirePermission("hr.read")
  list(@Query() q: Record<string, string>) {
    const status = (PROJECT_STATUSES as readonly string[]).includes(q.status ?? "") ? q.status : undefined;
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({
          id: P.id,
          code: P.code,
          name: P.name,
          status: P.status,
          startDate: P.startDate,
          endDate: P.endDate,
          url: P.url,
          app: schema.oauthClients.name,
          manager: E.name,
          members: sql<number>`(select count(*) from external_project_members m where m.project_id = ${P.id})::int`,
          openTasks: sql<number>`(select count(*) from external_tasks k
            where k.project_id = ${P.id} and k.status not in ('done', 'cancelled'))::int`,
          hoursThisMonth: sql<string>`coalesce((select sum(t.hours) from external_timesheets t
            where t.project_id = ${P.id} and t.date >= ${monthStart()}::date), 0)::text`,
          updatedAt: P.updatedAt,
        })
        .from(P)
        .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, P.clientId))
        .leftJoin(E, eq(E.id, P.managerEmployeeId))
        .where(
          and(
            eq(P.companyId, currentContext().companyId),
            status ? eq(P.status, status as (typeof PROJECT_STATUSES)[number]) : undefined,
            q.q ? or(ilike(P.name, `%${q.q}%`), ilike(P.code, `%${q.q}%`)) : undefined,
            q.employeeId
              ? sql`exists (select 1 from external_project_members m
                  where m.project_id = ${P.id} and m.employee_id = ${q.employeeId}::uuid)`
              : undefined,
          ),
        )
        .orderBy(sql`(${P.status} = 'active') desc`, asc(P.name))
        .limit(LIST_LOAD_LIMIT);
      return rows;
    });
  }

  @Get("projects/:id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const [project] = await tx
        .select({
          id: P.id,
          externalId: P.externalId,
          code: P.code,
          name: P.name,
          description: P.description,
          status: P.status,
          startDate: P.startDate,
          endDate: P.endDate,
          url: P.url,
          app: schema.oauthClients.name,
          managerId: P.managerEmployeeId,
          manager: E.name,
          updatedAt: P.updatedAt,
        })
        .from(P)
        .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, P.clientId))
        .leftJoin(E, eq(E.id, P.managerEmployeeId))
        .where(and(eq(P.id, id), eq(P.companyId, currentContext().companyId)));
      if (!project) throw new NotFoundException("Proyek tidak ditemukan");
      const since = monthStart();
      const members = await tx
        .select({
          employeeId: E.id,
          name: E.name,
          employeeNumber: E.employeeNumber,
          role: M.role,
          allocation: M.allocation,
          startDate: M.startDate,
          endDate: M.endDate,
          hoursThisMonth: sql<string>`coalesce((select sum(t.hours) from external_timesheets t
            where t.project_id = ${id} and t.employee_id = ${E.id} and t.date >= ${since}::date), 0)::text`,
          hoursTotal: sql<string>`coalesce((select sum(t.hours) from external_timesheets t
            where t.project_id = ${id} and t.employee_id = ${E.id}), 0)::text`,
        })
        .from(M)
        .innerJoin(E, eq(E.id, M.employeeId))
        .where(eq(M.projectId, id))
        .orderBy(asc(E.name));
      const tasks = await tx
        .select({
          id: T.id,
          title: T.title,
          status: T.status,
          priority: T.priority,
          dueDate: T.dueDate,
          closedAt: T.closedAt,
          url: T.url,
          assigneeId: T.assigneeEmployeeId,
          assignee: E.name,
        })
        .from(T)
        .leftJoin(E, eq(E.id, T.assigneeEmployeeId))
        .where(eq(T.projectId, id))
        .orderBy(sql`${T.status} in ('done', 'cancelled')`, sql`${T.dueDate} asc nulls last`, asc(T.title))
        .limit(300);
      const monthly = await tx.execute<{ month: string; hours: string }>(sql`
        select to_char(date_trunc('month', date), 'YYYY-MM') as month, sum(hours)::text as hours
        from external_timesheets where project_id = ${id}
        group by 1 order by 1 desc limit 12`);
      return { ...project, members, tasks, monthlyHours: monthly };
    });
  }

  @Get("employees/:id/projects")
  @RequirePermission("hr.read")
  employeeProjects(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, id);
      return this.projects.employeeProjects(tx, id);
    });
  }

  /** Portal karyawan: proyek, task, dan timesheet milik sendiri. */
  @Get("me/projects")
  mine() {
    return this.tenantDb.run(async (tx) =>
      this.projects.employeeProjects(tx, (await this.employees.mine(tx)).id),
    );
  }
}

@Module({
  imports: [HrModule],
  controllers: [ProjectSyncController, ProjectsController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectsModule {}
