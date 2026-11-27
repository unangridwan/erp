import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { and, eq, inArray, isNotNull, schema, sql, type Db } from "@erp/db";
import {
  businessToday,
  elapsedShare,
  FLOW_DEFS,
  FLOW_PROCESSES,
  goalCascadeSchema,
  goalProgress,
  hasPermission,
  KPI_BY_CODE,
  KPI_CATALOG,
  KPI_METRIC,
  kpiScopeValue,
  paceStatus,
  previousPeriod,
  splitTarget,
  summarizeFlow,
  type FlowHandoff,
  type KpiDef,
} from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { FlowService } from "../flow/flow.service.js";
import { ReportsService } from "../reports/reports.module.js";

const G = schema.performanceGoals;
const E = schema.employees;
const D = schema.departments;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v: unknown) => (v === "" ? undefined : v);
const scorecardSchema = z
  .object({
    scope: z.preprocess(blank, z.enum(["company", "department", "me", "employee"]).default("company")),
    id: z.preprocess(blank, z.string().uuid().optional()),
    from: z.preprocess(blank, z.string().regex(ISO).optional()),
    to: z.preprocess(blank, z.string().regex(ISO).optional()),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  })
  .refine((v) => v.scope !== "department" || !!v.id, { message: "Pilih departemen", path: ["id"] })
  .refine((v) => v.scope !== "employee" || !!v.id, { message: "Pilih karyawan", path: ["id"] });
const periodSchema = z
  .object({
    from: z.preprocess(blank, z.string().regex(ISO).optional()),
    to: z.preprocess(blank, z.string().regex(ISO).optional()),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  });

/** Periode bawaan scorecard: tahun berjalan. */
const yearPeriod = (q: { from?: string; to?: string }) => {
  const y = businessToday().slice(0, 4);
  return { from: q.from ?? `${y}-01-01`, to: q.to ?? `${y}-12-31` };
};
/**
 * Sasaran relevan dengan periode: periodenya beririsan; sasaran tanpa periode dinilai dari rentang dibuat → tenggat
 * (tanpa tenggat = masih berjalan), sehingga sasaran lama yang sudah lewat tenggat tidak ikut.
 */
const overlaps = (
  g: { periodFrom: string | null; periodTo: string | null; dueDate: string | null; createdAt: Date },
  from: string,
  to: string,
) => {
  const start = g.periodFrom ?? g.createdAt.toISOString().slice(0, 10);
  const end = g.periodTo ?? g.dueDate;
  return start <= to && (!end || end >= from);
};

type GoalRow = typeof G.$inferSelect;

/** Struktur organisasi perusahaan aktif: subtree departemen & pengguna anggota tiap departemen. */
async function orgOf(tx: Db) {
  const c = currentContext().companyId;
  const deps = await tx
    .select({ id: D.id, name: D.name, parentId: D.parentId, managerId: D.managerId, active: D.active })
    .from(D)
    .where(eq(D.companyId, c))
    .orderBy(D.name);
  const emps = await tx
    .select({
      id: E.id,
      userId: E.userId,
      departmentId: E.departmentId,
      managerId: E.managerId,
      name: E.name,
    })
    .from(E)
    .where(and(eq(E.companyId, c), eq(E.active, true)));
  const children = new Map<string, string[]>();
  for (const d of deps) if (d.parentId) children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  const subtree = (id: string) => {
    const out = new Set<string>();
    const walk = (x: string) => {
      if (out.has(x)) return;
      out.add(x);
      (children.get(x) ?? []).forEach(walk);
    };
    walk(id);
    return out;
  };
  const users = (deptIds: Set<string>) =>
    new Set(
      emps.filter((e) => e.departmentId && deptIds.has(e.departmentId) && e.userId).map((e) => e.userId!),
    );
  return { deps, emps, subtree, users };
}

/**
 * Nilai otomatis sasaran KPI: dihitung dari dataset BI untuk pemilik sasaran (karyawan → akunnya; departemen →
 * anggota departemen & subdepartemennya; perusahaan → semua) dalam periode sasaran, lalu disimpan sebagai nilai
 * berjalan. Hanya KPI yang datanya boleh dibaca pengguna yang memicu perhitungan; sisanya memakai nilai tersimpan.
 */
@Injectable()
export class AutoGoalService {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  async refresh(tx: Db, opts: { force?: boolean; ids?: string[] } = {}) {
    const ctx = currentContext();
    const goals = await tx
      .select()
      .from(G)
      .where(
        and(
          eq(G.companyId, ctx.companyId),
          isNotNull(G.kpiCode),
          eq(G.state, "active"),
          opts.ids ? inArray(G.id, opts.ids) : undefined,
          opts.force
            ? undefined
            : sql`(${G.valueComputedAt} is null or ${G.valueComputedAt} < now() - interval '5 minutes')`,
        ),
      );
    const due = goals.filter((g) => {
      const def = KPI_BY_CODE.get(g.kpiCode!);
      return !!def && !!g.periodFrom && !!g.periodTo && hasPermission(ctx.permissions, def.permission);
    });
    if (!due.length) return 0;
    const org = await orgOf(tx);
    let updated = 0;
    for (const dataset of new Set(due.map((g) => KPI_BY_CODE.get(g.kpiCode!)!.dataset))) {
      const list = due.filter((g) => KPI_BY_CODE.get(g.kpiCode!)!.dataset === dataset);
      const from = list.map((g) => g.periodFrom!).sort()[0]!;
      const to = list
        .map((g) => g.periodTo!)
        .sort()
        .at(-1)!;
      const data = await this.load(tx, dataset, from, to);
      if (!data) continue;
      for (const g of list) {
        const def = KPI_BY_CODE.get(g.kpiCode!)!;
        const value = kpiScopeValue(def, data.rows, data.columns, {
          owners: ownersOf(g, org),
          from: g.periodFrom!,
          to: g.periodTo!,
        });
        // Tanpa data: jumlah/nilai = 0; rasio tetap memakai nilai terakhir (bukan 0%).
        const next = value ?? (def.unit === "percent" ? Number(g.currentValue) : 0);
        await tx
          .update(G)
          .set({ currentValue: String(next), valueComputedAt: sql`now()` })
          .where(eq(G.id, g.id));
        updated++;
      }
    }
    return updated;
  }

  /** Muat dataset BI dengan hak pengguna; null bila tidak berhak. */
  async load(tx: Db, key: string, from: string, to: string) {
    try {
      return await this.reports.load(tx, key, { from, to }, []);
    } catch (e) {
      if (e instanceof ForbiddenException) return null;
      throw e;
    }
  }
}

/** Pengguna pemilik cakupan sasaran (null = seluruh perusahaan). */
function ownersOf(
  g: Pick<GoalRow, "employeeId" | "departmentId">,
  org: Awaited<ReturnType<typeof orgOf>>,
): Set<string> | null {
  if (g.employeeId) {
    const u = org.emps.find((e) => e.id === g.employeeId)?.userId;
    return new Set(u ? [u] : []);
  }
  if (g.departmentId) return org.users(org.subtree(g.departmentId));
  return null;
}

/**
 * Target berjenjang & scorecard: sasaran perusahaan → departemen → karyawan dengan nilai KPI otomatis dan status
 * laju (hijau/kuning/merah), berdampingan dengan KPI cakupan dan metrik proses (beban, keterlambatan, serah terima)
 * untuk rapat manajemen; penurunan target ke departemen/karyawan.
 */
@Controller()
export class ScorecardController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FlowService) private readonly flow: FlowService,
    @Inject(AutoGoalService) private readonly auto: AutoGoalService,
  ) {}

  /** Katalog KPI untuk form sasaran (yang tidak boleh dibaca tetap bisa dipilih HR, nilainya dihitung pemegang hak). */
  @Get("goals/kpis")
  kpis() {
    const perms = currentContext().permissions;
    return KPI_CATALOG.map((k) => ({
      code: k.code,
      label: k.label,
      description: k.description,
      area: k.area,
      unit: k.unit,
      better: k.better,
      metric: KPI_METRIC[k.unit],
      readable: hasPermission(perms, k.permission),
    }));
  }

  /** Perbarui nilai otomatis sasaran KPI (dilewati bila baru dihitung < 5 menit lalu). */
  @Post("goals/refresh-auto")
  @HttpCode(200)
  refresh() {
    return this.tenantDb.run(async (tx) => ({ updated: await this.auto.refresh(tx) }));
  }

  @Get("scorecard")
  scorecard(@Query() query: unknown) {
    const q = parse(scorecardSchema, query);
    const { from, to } = yearPeriod(q);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      await this.auto.refresh(tx);
      const org = await orgOf(tx);
      const hr = hasPermission(ctx.permissions, "hr.read");
      const meEmp = org.emps.find((e) => e.userId === ctx.userId) ?? null;

      // Cakupan.
      let title: string;
      let deptIds: Set<string> | null = null;
      let owners: Set<string> | null = null;
      let targetEmp: (typeof org.emps)[number] | null = null;
      if (q.scope === "department") {
        const d = org.deps.find((x) => x.id === q.id);
        if (!d) throw new NotFoundException("Departemen tidak ditemukan");
        title = d.name;
        deptIds = org.subtree(d.id);
        owners = org.users(deptIds);
      } else if (q.scope === "me") {
        title = meEmp?.name ?? "";
        owners = new Set([ctx.userId]);
      } else if (q.scope === "employee") {
        // Bukti penilaian kinerja: HR, karyawan itu sendiri, atau atasan langsungnya.
        const target = org.emps.find((e) => e.id === q.id);
        if (!target) throw new NotFoundException("Karyawan tidak ditemukan");
        const reviewer =
          (
            await tx
              .select({ id: schema.appraisals.id })
              .from(schema.appraisals)
              .where(
                and(
                  eq(schema.appraisals.employeeId, target.id),
                  eq(schema.appraisals.managerUserId, ctx.userId),
                ),
              )
              .limit(1)
          ).length > 0;
        if (!hr && !reviewer && target.userId !== ctx.userId && !(meEmp && target.managerId === meEmp.id))
          throw new ForbiddenException("Hanya karyawan, atasan langsung, atau HR");
        targetEmp = target;
        title = target.name;
        owners = new Set(target.userId ? [target.userId] : []);
      } else title = "";

      // Sasaran yang terlihat & relevan dengan cakupan dan periode.
      const all = await tx.select().from(G).where(eq(G.companyId, ctx.companyId));
      const progress = goalProgress(all);
      const empById = new Map(org.emps.map((e) => [e.id, e]));
      const managerOf = (empId: string | null) => (empId ? empById.get(empId)?.managerId : null);
      const canSeeEmployeeGoal = (empId: string) =>
        hr || empById.get(empId)?.userId === ctx.userId || (!!meEmp && managerOf(empId) === meEmp.id);
      const inScope = (g: GoalRow) => {
        if (q.scope === "me") return !!meEmp && g.employeeId === meEmp.id;
        if (q.scope === "employee") return g.employeeId === targetEmp!.id;
        if (q.scope === "department") {
          if (g.departmentId) return deptIds!.has(g.departmentId);
          if (g.employeeId) {
            const e = empById.get(g.employeeId);
            return !!e?.departmentId && deptIds!.has(e.departmentId) && canSeeEmployeeGoal(g.employeeId);
          }
          return false;
        }
        // Perusahaan: sasaran perusahaan & departemen; sasaran karyawan hanya bagi HR.
        return !g.employeeId || (hr && canSeeEmployeeGoal(g.employeeId));
      };
      const today = businessToday();
      const goals = all
        .filter((g) => g.state !== "cancelled" && g.state !== "draft" && inScope(g) && overlaps(g, from, to))
        .map((g) => {
          const p = progress.get(g.id) ?? 0;
          const pace = paceStatus(
            p,
            elapsedShare(
              g.periodFrom ?? (g.dueDate ? g.createdAt.toISOString().slice(0, 10) : null),
              g.periodTo ?? g.dueDate,
              today,
            ),
            g.state === "done",
          );
          const kpi = g.kpiCode ? KPI_BY_CODE.get(g.kpiCode) : undefined;
          const emp = g.employeeId ? empById.get(g.employeeId) : undefined;
          return {
            id: g.id,
            parentId: g.parentId,
            title: g.title,
            owner: emp
              ? { kind: "employee" as const, name: emp.name }
              : g.departmentId
                ? {
                    kind: "department" as const,
                    name: org.deps.find((d) => d.id === g.departmentId)?.name ?? "",
                  }
                : { kind: "company" as const, name: "" },
            employeeId: g.employeeId,
            departmentId: g.departmentId,
            kpi: kpi ? { code: kpi.code, label: kpi.label, unit: kpi.unit } : null,
            metric: g.metric,
            unit: g.unit,
            startValue: Number(g.startValue),
            targetValue: Number(g.targetValue),
            currentValue: Number(g.currentValue),
            weight: Number(g.weight),
            periodFrom: g.periodFrom,
            periodTo: g.periodTo,
            dueDate: g.dueDate,
            state: g.state,
            valueComputedAt: g.valueComputedAt,
            progress: p,
            ...pace,
          };
        });
      const ids = new Set(goals.map((g) => g.id));
      const roots = goals.filter((g) => !g.parentId || !ids.has(g.parentId));
      const weight = roots.reduce((s, g) => s + g.weight, 0);
      const achievement = weight
        ? Math.round((roots.reduce((s, g) => s + g.progress * g.weight, 0) / weight) * 10) / 10
        : null;
      const rag = { green: 0, amber: 0, red: 0 };
      for (const g of goals) rag[g.rag]++;

      // KPI cakupan: periode ini vs sebelumnya.
      const kpis = await this.scopeKpis(tx, owners, from, to);

      // Metrik proses.
      const flow = await this.flowMetrics(
        tx,
        q.scope === "employee" ? "me" : q.scope,
        deptIds,
        from,
        to,
        q.scope === "employee" ? (targetEmp!.userId ?? "") : ctx.userId,
      );

      return {
        scope: q.scope,
        id: q.id ?? null,
        title,
        from,
        to,
        today,
        achievement,
        rag,
        goals,
        kpis,
        flow,
        canManage: hasPermission(ctx.permissions, "hr.manage"),
        /** Cakupan "saya" butuh akun yang terhubung ke data karyawan. */
        linked: q.scope !== "me" || !!meEmp,
      };
    });
  }

  /** Scorecard departemen berdampingan: capaian sasaran, status laju, beban & keterlambatan proses, serah terima. */
  @Get("scorecard/departments")
  departments(@Query() query: unknown) {
    const { from, to } = yearPeriod(parse(periodSchema, query));
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      await this.auto.refresh(tx);
      const org = await orgOf(tx);
      const all = await tx.select().from(G).where(eq(G.companyId, ctx.companyId));
      const progress = goalProgress(all);
      const handoffs: FlowHandoff[] = [];
      for (const p of FLOW_PROCESSES)
        if (this.flow.canRead(p)) handoffs.push(...(await this.flow.handoffs(tx, p)));
      const today = businessToday();
      const rows = org.deps
        .filter((d) => d.active)
        .map((d) => {
          const sub = org.subtree(d.id);
          const goals = all.filter(
            (g) =>
              g.departmentId === d.id &&
              (g.state === "active" || g.state === "done") &&
              overlaps(g, from, to),
          );
          const ids = new Set(goals.map((g) => g.id));
          const roots = goals.filter((g) => !g.parentId || !ids.has(g.parentId));
          const w = roots.reduce((s, g) => s + Number(g.weight), 0);
          const rag = { green: 0, amber: 0, red: 0 };
          for (const g of goals)
            rag[
              paceStatus(
                progress.get(g.id) ?? 0,
                elapsedShare(
                  g.periodFrom ?? (g.dueDate ? g.createdAt.toISOString().slice(0, 10) : null),
                  g.periodTo ?? g.dueDate,
                  today,
                ),
                g.state === "done",
              ).rag
            ]++;
          const incoming = handoffs.filter((h) => h.toDepartmentId && sub.has(h.toDepartmentId));
          const outgoing = handoffs.filter(
            (h) =>
              h.fromStage &&
              h.fromDepartmentId &&
              sub.has(h.fromDepartmentId) &&
              !(h.toDepartmentId && sub.has(h.toDepartmentId)),
          );
          return {
            id: d.id,
            name: d.name,
            parentId: d.parentId,
            members: org.emps.filter((e) => e.departmentId && sub.has(e.departmentId)).length,
            goals: goals.length,
            achievement: w
              ? Math.round(
                  (roots.reduce((s, g) => s + (progress.get(g.id) ?? 0) * Number(g.weight), 0) / w) * 10,
                ) / 10
              : null,
            rag,
            waiting: incoming.length,
            late: incoming.filter((h) => h.status === "late").length,
            onTimePct: incoming.length
              ? Math.round((incoming.filter((h) => h.status !== "late").length / incoming.length) * 1000) / 10
              : null,
            avgAge: incoming.length
              ? Math.round((incoming.reduce((s, h) => s + h.ageDays, 0) / incoming.length) * 10) / 10
              : null,
            handedOver: outgoing.length,
            handedOverLate: outgoing.filter((h) => h.status === "late").length,
          };
        });
      return { from, to, today, items: rows };
    });
  }

  /**
   * Turunkan sasaran ke semua departemen atau ke karyawan satu departemen: target dibagi rata atau proporsional
   * terhadap capaian KPI periode sebelumnya (KPI persentase: target sama). Turunan yang sudah ada dilewati.
   */
  @Post("goals/:id/cascade")
  @RequirePermission("hr.manage")
  cascade(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(goalCascadeSchema, body);
    if (input.to === "employees" && !input.departmentId) throw new BadRequestException("Pilih departemen");
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const [parent] = await tx
        .select()
        .from(G)
        .where(and(eq(G.id, id), eq(G.companyId, ctx.companyId)));
      if (!parent) throw new NotFoundException("Sasaran tidak ditemukan");
      if (parent.state !== "active") throw new BadRequestException("Sasaran tidak aktif");
      const org = await orgOf(tx);
      let targets: { key: string; departmentId: string | null; employeeId: string | null; name: string }[];
      if (input.to === "departments") {
        targets = org.deps
          .filter((d) => d.active && d.id !== parent.departmentId)
          // Turunan langsung: dari perusahaan → departemen puncak; dari departemen → subdepartemennya.
          .filter((d) => (parent.departmentId ? d.parentId === parent.departmentId : !d.parentId))
          .map((d) => ({ key: d.id, departmentId: d.id, employeeId: null, name: d.name }));
      } else {
        const d = org.deps.find((x) => x.id === input.departmentId);
        if (!d) throw new NotFoundException("Departemen tidak ditemukan");
        const sub = org.subtree(d.id);
        targets = org.emps
          .filter((e) => e.departmentId && sub.has(e.departmentId))
          .map((e) => ({ key: e.id, departmentId: null, employeeId: e.id, name: e.name }));
      }
      if (!targets.length) throw new BadRequestException("Tidak ada departemen/karyawan untuk diturunkan");
      const existing = await tx
        .select({ departmentId: G.departmentId, employeeId: G.employeeId })
        .from(G)
        .where(and(eq(G.parentId, parent.id), eq(G.companyId, ctx.companyId)));
      const taken = new Set(existing.map((x) => x.employeeId ?? x.departmentId ?? ""));
      const fresh = targets.filter((t) => !taken.has(t.key));

      // Dasar proporsional: capaian KPI periode sebelumnya per turunan.
      const def = parent.kpiCode ? KPI_BY_CODE.get(parent.kpiCode) : undefined;
      const basis = new Map<string, number | null>();
      if (input.split === "proportional" && def && parent.periodFrom && parent.periodTo) {
        const prev = previousPeriod(parent.periodFrom, parent.periodTo);
        const data = await this.auto.load(tx, def.dataset, prev.from, prev.to);
        if (data)
          for (const t of fresh)
            basis.set(
              t.key,
              kpiScopeValue(def, data.rows, data.columns, {
                owners: ownersOf(t, org),
                from: prev.from,
                to: prev.to,
              }),
            );
      }
      const shares = splitTarget(
        Number(parent.targetValue),
        fresh.map((t) => ({ id: t.key, basis: basis.get(t.key) ?? null })),
        input.split,
        parent.metric === "percent" || parent.metric === "boolean",
      );
      const created = fresh.length
        ? await tx
            .insert(G)
            .values(
              fresh.map((t) => ({
                companyId: ctx.companyId,
                parentId: parent.id,
                cycleId: parent.cycleId,
                employeeId: t.employeeId,
                departmentId: t.departmentId,
                title: `${parent.title} — ${t.name}`,
                description: parent.description,
                metric: parent.metric,
                startValue: parent.metric === "percent" ? parent.startValue : "0",
                targetValue: String(shares.get(t.key) ?? 0),
                currentValue: "0",
                unit: parent.unit,
                weight: "1",
                dueDate: parent.dueDate,
                state: "active" as const,
                kpiCode: parent.kpiCode,
                periodFrom: parent.periodFrom,
                periodTo: parent.periodTo,
                createdBy: ctx.userId,
              })),
            )
            .returning({ id: G.id })
        : [];
      if (created.length && def) await this.auto.refresh(tx, { force: true, ids: created.map((c) => c.id) });
      return { created: created.length, skipped: targets.length - fresh.length };
    });
  }

  /** KPI untuk sekumpulan pemilik (null = perusahaan): periode ini & sebelumnya, hanya yang boleh dibaca & ada data. */
  private async scopeKpis(tx: Db, owners: Set<string> | null, from: string, to: string) {
    const perms = currentContext().permissions;
    const prev = previousPeriod(from, to);
    const defs = KPI_CATALOG.filter((k) => hasPermission(perms, k.permission));
    const out: {
      code: string;
      label: [string, string];
      area: [string, string];
      unit: KpiDef["unit"];
      better: KpiDef["better"];
      value: number | null;
      previous: number | null;
      change: number | null;
    }[] = [];
    for (const dataset of new Set(defs.map((d) => d.dataset))) {
      const data = await this.auto.load(tx, dataset, prev.from, to);
      if (!data) continue;
      for (const def of defs.filter((d) => d.dataset === dataset)) {
        const value = kpiScopeValue(def, data.rows, data.columns, { owners, from, to });
        const previous = kpiScopeValue(def, data.rows, data.columns, { owners, ...prev });
        if (value === null && previous === null) continue;
        out.push({
          code: def.code,
          label: def.label,
          area: def.area,
          unit: def.unit,
          better: def.better,
          value,
          previous,
          change:
            value !== null && previous
              ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10
              : null,
        });
      }
    }
    return out;
  }

  /** Metrik proses cakupan: perusahaan per proses; departemen = antrean & serah terimanya; saya = dokumen saya. */
  private async flowMetrics(
    tx: Db,
    scope: "company" | "department" | "me",
    deptIds: Set<string> | null,
    from: string,
    to: string,
    holder: string,
  ) {
    const processes = FLOW_PROCESSES.filter((p) => this.flow.canRead(p));
    if (scope === "company") {
      const out = [];
      for (const p of processes) {
        const items = await this.flow.items(tx, p, { from });
        const settings = await this.flow.settings(tx, p);
        const s = summarizeFlow(FLOW_DEFS[p], items, {
          today: businessToday(),
          from,
          to,
          sla: settings.sla,
          departments: settings.departments,
        });
        out.push({
          process: p,
          label: FLOW_DEFS[p].label,
          wip: s.wip.count,
          late: s.wip.late,
          completed: s.completed.count,
          cycleMedian: s.completed.cycleMedian,
          bottleneck: s.bottleneck
            ? (FLOW_DEFS[p].stages.find((x) => x.key === s.bottleneck)?.label ?? null)
            : null,
        });
      }
      return { processes: out };
    }
    const all: FlowHandoff[] = [];
    for (const p of processes) all.push(...(await this.flow.handoffs(tx, p)));
    const stats = (list: FlowHandoff[]) => ({
      count: list.length,
      late: list.filter((h) => h.status === "late").length,
      atRisk: list.filter((h) => h.status === "at_risk").length,
      avgAge: list.length
        ? Math.round((list.reduce((s, h) => s + h.ageDays, 0) / list.length) * 10) / 10
        : null,
    });
    if (scope === "me") return { held: stats(all.filter((h) => h.ownerId === holder)) };
    const ids = deptIds!;
    return {
      waiting: stats(all.filter((h) => h.toDepartmentId && ids.has(h.toDepartmentId))),
      handedOver: stats(
        all.filter(
          (h) =>
            h.fromStage &&
            h.fromDepartmentId &&
            ids.has(h.fromDepartmentId) &&
            !(h.toDepartmentId && ids.has(h.toDepartmentId)),
        ),
      ),
    };
  }
}
