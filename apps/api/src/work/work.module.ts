import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, notInArray, schema, sql, type Db } from "@erp/db";
import {
  businessToday,
  computeKpi,
  drillVisual,
  FLOW_DEFS,
  FLOW_PROCESSES,
  hasPermission,
  KPI_BY_CODE,
  KPI_CATALOG,
  kpiLoadRange,
  kpiRowsIn,
  kpiVisual,
  previousPeriod,
  recordHref,
  RECORD_MODELS,
  type FlowHandoff,
  type KpiResult,
} from "@erp/shared";
import { z } from "zod";
import { canReadActivity, docNames, hasDocTable } from "../activity/activity.service.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { FlowModule } from "../flow/flow.module.js";
import { FlowService } from "../flow/flow.service.js";
import { HrModule } from "../hr/hr.module.js";
import { ScheduleService } from "../hr/schedule.service.js";
import { ReportsModule, ReportsService } from "../reports/reports.module.js";
import { AutoGoalService, ScorecardController } from "./scorecard.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v: unknown) => (v === "" ? undefined : v);
const periodSchema = z
  .object({
    from: z.preprocess(blank, z.string().regex(ISO).optional()),
    to: z.preprocess(blank, z.string().regex(ISO).optional()),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  });
const historySchema = z.object({
  days: z.preprocess(blank, z.coerce.number().int().min(1).max(90).default(30)),
});

/** Periode bawaan: bulan berjalan. */
function period(q: { from?: string; to?: string }) {
  const today = businessToday();
  const from = q.from ?? `${today.slice(0, 7)}-01`;
  const end = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { from, to: q.to ?? end.toISOString().slice(0, 10) };
}

const RANK = { late: 0, at_risk: 1, on_time: 2 } as const;

/**
 * Pekerjaan Saya: satu tempat bagi tiap orang untuk melihat, memantau, dan mengevaluasi kerjanya — antrean lintas
 * modul (dokumen yang saya pegang di alur bisnis, pekerjaan yang menunggu di departemen saya, aktivitas, tiket,
 * sebutan), KPI pribadi otomatis dibanding periode lalu & rekan, dan jejak kerja dari log aktivitas.
 */
@Controller("me")
export class MyWorkController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FlowService) private readonly flow: FlowService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

  @Get("work")
  work() {
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const c = ctx.companyId;
      const today = businessToday();
      const D = schema.departments;
      const E = schema.employees;
      const [emp] = await tx
        .select({ departmentId: E.departmentId, department: D.name })
        .from(E)
        .leftJoin(D, eq(D.id, E.departmentId))
        .where(and(eq(E.userId, ctx.userId), eq(E.companyId, c), eq(E.active, true)))
        .limit(1);
      const myDept = emp?.departmentId ?? null;

      // Dokumen alur bisnis: yang saya pegang & yang menunggu di departemen saya.
      const docs: FlowHandoff[] = [];
      const waiting: FlowHandoff[] = [];
      for (const p of FLOW_PROCESSES) {
        if (!this.flow.canRead(p)) continue;
        const list = await this.flow.handoffs(tx, p);
        docs.push(...list.filter((h) => h.ownerId === ctx.userId));
        if (myDept) waiting.push(...list.filter((h) => h.toDepartmentId === myDept));
      }
      const order = (a: FlowHandoff, b: FlowHandoff) =>
        RANK[a.status] - RANK[b.status] || b.ageDays - a.ageDays;
      docs.sort(order);
      waiting.sort(order);
      const deps = new Map(
        (await tx.select({ id: D.id, name: D.name }).from(D).where(eq(D.companyId, c))).map((d) => [
          d.id,
          d.name,
        ]),
      );
      const view = (h: FlowHandoff) => ({
        id: h.id,
        model: h.model,
        name: h.name,
        partner: h.partner,
        process: h.process,
        processLabel: FLOW_DEFS[h.process].label,
        stage: h.stage,
        stageLabel: h.stageLabel,
        waiting: h.waiting,
        since: h.since,
        ageDays: h.ageDays,
        slaDays: h.slaDays,
        due: h.due,
        status: h.status,
        value: h.value,
        owner: h.owner,
        href: h.href ?? recordHref(h.model, h.id),
        toDepartment: h.toDepartmentId ? (deps.get(h.toDepartmentId) ?? null) : null,
        fromDepartment: h.fromDepartmentId ? (deps.get(h.fromDepartmentId) ?? null) : null,
      });

      // Aktivitas terjadwal yang ditugaskan ke saya.
      const A = schema.scheduledActivities;
      const acts = await tx
        .select({
          id: A.id,
          summary: A.summary,
          activityType: A.activityType,
          dueDate: A.dueDate,
          resModel: A.resModel,
          resId: A.resId,
        })
        .from(A)
        .where(and(eq(A.userId, ctx.userId), isNull(A.doneAt)))
        .orderBy(A.dueDate)
        .limit(100);
      const actNames = new Map<string, string>();
      for (const model of new Set(acts.map((a) => a.resModel)))
        for (const [id, name] of await docNames(
          tx,
          model,
          acts.filter((a) => a.resModel === model).map((a) => a.resId),
        ))
          actNames.set(id, name);
      const activities = acts.map((a) => ({
        ...a,
        document: actNames.get(a.resId) ?? null,
        modelLabel: (RECORD_MODELS as Record<string, { label: [string, string] }>)[a.resModel]?.label ?? null,
        href: recordHref(a.resModel, a.resId),
        overdue: a.dueDate < today,
        today: a.dueDate === today,
      }));

      // Tiket layanan yang saya tangani.
      let tickets: {
        id: string;
        number: string;
        subject: string;
        priority: string;
        status: string;
        resolveDue: string | null;
        late: boolean;
      }[] = [];
      if (hasPermission(ctx.permissions, "support.read")) {
        const T = schema.supportTickets;
        tickets = (
          await tx
            .select({
              id: T.id,
              number: T.number,
              subject: T.subject,
              priority: T.priority,
              status: T.status,
              resolveDue: T.resolveDue,
            })
            .from(T)
            .where(
              and(eq(T.companyId, c), eq(T.userId, ctx.userId), notInArray(T.status, ["resolved", "closed"])),
            )
            .orderBy(sql`${T.resolveDue} nulls last`)
            .limit(50)
        ).map((t) => ({
          ...t,
          resolveDue: t.resolveDue ? new Date(t.resolveDue).toISOString() : null,
          late: !!t.resolveDue && new Date(t.resolveDue).getTime() < Date.now(),
        }));
      }

      // Sebutan & pengingat untuk saya (30 hari terakhir).
      const N = schema.notifications;
      const mentions = await tx
        .select({
          id: N.id,
          kind: N.kind,
          title: N.title,
          body: N.body,
          link: N.link,
          readAt: N.readAt,
          createdAt: N.createdAt,
        })
        .from(N)
        .where(
          and(
            eq(N.userId, ctx.userId),
            eq(N.companyId, c),
            inArray(N.kind, ["mention", "comment", "handoff_reminder"]),
            gt(N.createdAt, sql`now() - interval '30 days'`),
          ),
        )
        .orderBy(desc(N.createdAt))
        .limit(30);

      // Peringatan dini untuk saya (14 hari terakhir).
      const alerts = await tx
        .select({
          id: N.id,
          title: N.title,
          body: N.body,
          link: N.link,
          readAt: N.readAt,
          createdAt: N.createdAt,
        })
        .from(N)
        .where(
          and(
            eq(N.userId, ctx.userId),
            eq(N.companyId, c),
            eq(N.kind, "alert"),
            gt(N.createdAt, sql`now() - interval '14 days'`),
          ),
        )
        .orderBy(desc(N.createdAt))
        .limit(30);

      return {
        today,
        department: myDept ? { id: myDept, name: emp?.department ?? "" } : null,
        summary: {
          documents: docs.length,
          documentsLate: docs.filter((d) => d.status === "late").length,
          departmentWaiting: waiting.length,
          departmentLate: waiting.filter((d) => d.status === "late").length,
          activitiesOverdue: activities.filter((a) => a.overdue).length,
          activitiesToday: activities.filter((a) => a.today).length,
          activities: activities.length,
          tickets: tickets.length,
          ticketsLate: tickets.filter((t) => t.late).length,
          mentionsUnread: mentions.filter((m) => !m.readAt).length,
          alertsUnread: alerts.filter((m) => !m.readAt).length,
        },
        documents: docs.slice(0, 50).map(view),
        departmentQueue: waiting.slice(0, 20).map(view),
        activities,
        tickets,
        mentions,
        alerts,
      };
    });
  }

  /** KPI pribadi otomatis untuk periode (bawaan bulan berjalan): hanya KPI yang relevan dengan pekerjaan saya. */
  @Get("kpis")
  kpis(@Query() query: unknown) {
    const { from, to } = period(parse(periodSchema, query));
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const defs = KPI_CATALOG.filter((d) => d.selfService || hasPermission(ctx.permissions, d.permission));
      const range = kpiLoadRange(from, to);
      const items: KpiResult[] = [];
      for (const dataset of new Set(defs.map((d) => d.dataset))) {
        const data = await this.loadDataset(tx, dataset, range.from, range.to);
        if (!data) continue;
        for (const def of defs.filter((d) => d.dataset === dataset)) {
          // Relevan bila saya pemilik data dalam rentang tren.
          if (!data.rows.some((r) => r[def.owner] === ctx.userId)) continue;
          const k = computeKpi(def, data.rows, data.columns, { userId: ctx.userId, from, to });
          // Tanpa angka sama sekali (mis. PO tanpa tanggal rencana): tidak ditampilkan.
          if (k.value === null && k.previous === null && k.trend.every((t) => t.value === null)) continue;
          items.push(k);
        }
      }
      return { from, to, previous: previousPeriod(from, to), items };
    });
  }

  /** Dokumen penyusun KPI saya dalam periode (dengan tautan ke dokumennya). */
  @Get("kpis/:code/rows")
  kpiRows(@Param("code") code: string, @Query() query: unknown) {
    const def = KPI_BY_CODE.get(code);
    if (!def) throw new NotFoundException("KPI tidak ditemukan");
    if (!def.selfService && !hasPermission(currentContext().permissions, def.permission))
      throw new ForbiddenException(`Butuh permission ${def.permission}`);
    const { from, to } = period(parse(periodSchema, query));
    return this.tenantDb.run(async (tx) => {
      const data = await this.loadDataset(tx, def.dataset, from, to);
      if (!data) throw new ForbiddenException(`Butuh permission ${def.permission}`);
      const mine = kpiRowsIn(
        def,
        data.rows.filter((r) => r[def.owner] === currentContext().userId),
        from,
        to,
      );
      const visual = kpiVisual(def);
      const main = def.measures.find((x) => !x.hidden);
      visual.filters = [...(def.filters ?? []), ...(def.detailFilters ?? main?.filters ?? [])];
      const drill = drillVisual(mine, data.columns, visual, {}, []);
      // Nomor dokumen & tanggal dulu, lalu kolom ukuran & lainnya.
      const first = ["name", def.date];
      const columns = [
        ...first.map((k) => drill.columns.find((c) => c.key === k)).filter((c) => !!c),
        ...drill.columns.filter((c) => !first.includes(c.key)),
      ].slice(0, 8);
      return {
        from,
        to,
        columns,
        total: drill.total,
        totals: drill.totals,
        rows: drill.rows.slice(0, 200).map((r) => ({
          ...r,
          href:
            typeof r._model === "string" && typeof r._id === "string" ? recordHref(r._model, r._id) : null,
        })),
      };
    });
  }

  /** Jejak kerja saya: apa yang saya buat, ubah, catat, dan diskusikan (dari log aktivitas). */
  @Get("history")
  history(@Query() query: unknown) {
    const { days } = parse(historySchema, query);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const L = schema.activityLogs;
      const rows = await tx
        .select({
          id: L.id,
          model: L.resModel,
          resId: L.resId,
          action: L.action,
          message: L.message,
          changes: L.changes,
          createdAt: L.createdAt,
        })
        .from(L)
        .where(and(eq(L.userId, ctx.userId), gt(L.createdAt, sql`now() - make_interval(days => ${days})`)))
        .orderBy(desc(L.createdAt))
        .limit(500);
      // Hanya dokumen yang masih boleh saya lihat, dan (bila tabelnya dikenal) milik perusahaan aktif.
      const readable = rows.filter((r) => canReadActivity(r.model));
      const names = new Map<string, string>();
      for (const model of new Set(readable.map((r) => r.model)))
        for (const [id, name] of await docNames(tx, model, [
          ...new Set(readable.filter((r) => r.model === model).map((r) => r.resId)),
        ]))
          names.set(id, name);
      const visible = readable.filter((r) => !hasDocTable(r.model) || names.has(r.resId));
      const byAction: Record<string, number> = {};
      const byModel = new Map<string, number>();
      for (const r of visible) {
        byAction[r.action] = (byAction[r.action] ?? 0) + 1;
        byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
      }
      const label = (model: string) =>
        (RECORD_MODELS as Record<string, { label: [string, string] }>)[model]?.label ?? [model, model];
      return {
        days,
        total: visible.length,
        byAction,
        byModel: [...byModel.entries()]
          .map(([model, count]) => ({ model, label: label(model), count }))
          .sort((a, b) => b.count - a.count),
        items: visible.slice(0, 200).map((r) => ({
          id: r.id,
          model: r.model,
          modelLabel: label(r.model),
          resId: r.resId,
          name: names.get(r.resId) ?? null,
          href: recordHref(r.model, r.resId),
          action: r.action,
          message: r.message,
          fields:
            r.action === "update" && r.changes && typeof r.changes === "object"
              ? Object.keys(r.changes as object).length
              : 0,
          createdAt: r.createdAt,
        })),
      };
    });
  }

  /**
   * Muat dataset BI dengan hak pengguna; null bila tidak berhak. Tanpa hak SDM, ketepatan kehadiran tetap dimuat
   * untuk diri sendiri saja (KPI swalayan).
   */
  private async loadDataset(tx: Db, key: string, from: string, to: string) {
    try {
      return await this.reports.load(tx, key, { from, to }, []);
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      if (key !== "attendance_punctuality") return null;
      const userId = currentContext().userId;
      const rows = (await this.schedules.punctuality(tx, { from, to }))
        .filter((r) => r.userId === userId)
        .map((r) => ({
          _userId: userId,
          date: r.date,
          month: r.date.slice(0, 7),
          onTime: r.onTime ? "Ya" : "Tidak",
          lateMinutes: r.lateMinutes,
        }));
      return {
        rows,
        columns: [
          { key: "date", header: "Tanggal" },
          { key: "month", header: "Bulan" },
          { key: "onTime", header: "Tepat waktu" },
          { key: "lateMinutes", header: "Menit terlambat", numeric: true },
        ],
        title: "Ketepatan kehadiran",
        restricted: [],
      };
    }
  }
}

@Module({
  imports: [FlowModule, ReportsModule, HrModule],
  controllers: [MyWorkController, ScorecardController],
  providers: [AutoGoalService],
})
export class WorkModule {}
