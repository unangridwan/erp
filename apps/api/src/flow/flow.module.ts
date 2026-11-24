import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from "@nestjs/common";
import { and, eq, inArray, schema, sql, type Db } from "@erp/db";
import {
  businessToday,
  currentStage,
  FLOW_DEFS,
  FLOW_PROCESSES,
  flowDays,
  flowSettingsSchema,
  stageStatus,
  summarizeFlow,
  workItems,
  type FlowProcess,
} from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { FlowHandoffController } from "./handoffs.js";
import { FlowService } from "./flow.service.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z
  .object({
    from: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(ISO).optional()),
    to: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(ISO).optional()),
    department: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
    user: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
    status: z.enum(["on_time", "at_risk", "late"]).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  });
type FlowQuery = z.infer<typeof querySchema>;

const processOf = (key: string): FlowProcess => {
  if (!(FLOW_PROCESSES as readonly string[]).includes(key))
    throw new NotFoundException("Proses tidak ditemukan");
  return key as FlowProcess;
};

/**
 * Alur bisnis end-to-end: posisi tiap dokumen di proses (Order-to-Cash, Procure-to-Pay, Produksi, Hire-to-Pay), umur
 * & SLA per tahap, konversi, hambatan, waktu siklus, siapa & departemen mana yang memegang, serta jejak satu dokumen.
 */
@Controller("flow")
export class FlowController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FlowService) private readonly flow: FlowService,
  ) {}

  /** Ringkasan semua proses yang boleh dilihat (kartu di halaman Alur Bisnis). */
  @Get()
  overview(@Query() query: unknown) {
    const q = parse(querySchema, query);
    return this.tenantDb.run(async (tx) => {
      const out = [];
      for (const p of FLOW_PROCESSES) {
        if (!this.flow.canRead(p)) continue;
        const { summary } = await this.compute(tx, p, q);
        const def = FLOW_DEFS[p];
        out.push({
          process: p,
          label: def.label,
          description: def.description,
          chain: def.chain,
          wip: summary.wip,
          completed: summary.completed,
          bottleneck: summary.bottleneck,
          stages: summary.stages.map((s) => ({ key: s.key, label: s.label, count: s.count, late: s.late })),
        });
      }
      return out;
    });
  }

  @Get(":process")
  summary(@Param("process") key: string, @Query() query: unknown) {
    const process = processOf(key);
    this.flow.assertCanRead(process);
    const q = parse(querySchema, query);
    return this.tenantDb.run(async (tx) => {
      const { summary, settings } = await this.compute(tx, process, q);
      const departments = await this.departmentNames(tx, Object.values(settings.departments));
      return {
        process,
        definition: FLOW_DEFS[process],
        summary: {
          ...summary,
          stages: summary.stages.map((s) => ({
            ...s,
            department: s.departmentId ? (departments.get(s.departmentId) ?? null) : null,
          })),
        },
        today: businessToday(),
      };
    });
  }

  /** Dokumen di satu tahap (tahap akhir: yang selesai dalam periode), urut paling terlambat & tertua. */
  @Get(":process/stage/:stage")
  stage(@Param("process") key: string, @Param("stage") stage: string, @Query() query: unknown) {
    const process = processOf(key);
    this.flow.assertCanRead(process);
    const def = FLOW_DEFS[process];
    if (!def.stages.some((s) => s.key === stage)) throw new NotFoundException("Tahap tidak ditemukan");
    const q = parse(querySchema, query);
    return this.tenantDb.run(async (tx) => {
      const { items, settings, owners } = await this.load(tx, process, q);
      const today = businessToday();
      const last = def.stages[def.stages.length - 1]!.key;
      if (stage === last) {
        const done = items
          .filter((it) => currentStage(def, it) === last)
          .filter((it) => {
            const d = (it.times[last] ?? "").slice(0, 10);
            return (!q.from || d >= q.from) && (!q.to || d <= q.to);
          })
          .map((it) => {
            const start = def.stages.map((s) => it.times[s.key]).find(Boolean)!;
            const owner = it.ownerId ? owners.get(it.ownerId) : undefined;
            return {
              id: it.id,
              model: it.model,
              name: it.name,
              partner: it.partner ?? null,
              stage: last,
              since: it.times[last]!,
              ageDays: flowDays(start, it.times[last]!),
              due: null,
              status: "on_time" as const,
              value: it.value ?? null,
              ownerId: it.ownerId ?? null,
              owner: owner?.name ?? null,
              department: owner?.department ?? null,
              href: it.href ?? null,
            };
          })
          .sort((a, b) => b.since.localeCompare(a.since));
        return { items: done.slice(0, 500), total: done.length };
      }
      const rank = { late: 0, at_risk: 1, on_time: 2 } as const;
      const list = workItems(def, items, { today, sla: settings.sla, owners })
        .filter((w) => w.stage === stage && (!q.status || w.status === q.status))
        .sort((a, b) => rank[a.status] - rank[b.status] || b.ageDays - a.ageDays);
      return { items: list.slice(0, 500), total: list.length };
    });
  }

  @Get(":process/settings")
  getSettings(@Param("process") key: string) {
    const process = processOf(key);
    this.flow.assertCanRead(process);
    return this.tenantDb.run((tx) => this.getSettingsTx(tx, process));
  }

  @Put(":process/settings")
  @RequirePermission("settings.manage")
  putSettings(@Param("process") key: string, @Body() body: unknown) {
    const process = processOf(key);
    const input = parse(flowSettingsSchema, body);
    const def = FLOW_DEFS[process];
    for (const s of input.stages)
      if (!def.stages.some((x) => x.key === s.stage)) throw new BadRequestException("Tahap tidak ditemukan");
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const depIds = input.stages.map((s) => s.departmentId).filter((x): x is string => !!x);
      if (depIds.length) {
        const D = schema.departments;
        const found = await tx
          .select({ id: D.id })
          .from(D)
          .where(and(eq(D.companyId, c), inArray(D.id, depIds)));
        if (found.length !== new Set(depIds).size)
          throw new BadRequestException("Departemen tidak ditemukan");
      }
      const S = schema.flowStageSettings;
      for (const s of input.stages)
        await tx
          .insert(S)
          .values({ companyId: c, process, stage: s.stage, slaDays: s.slaDays, departmentId: s.departmentId })
          .onConflictDoUpdate({
            target: [S.companyId, S.process, S.stage],
            set: { slaDays: s.slaDays, departmentId: s.departmentId, updatedAt: sql`now()` },
          });
      return this.getSettingsTx(tx, process);
    });
  }

  /** Jejak satu dokumen sepanjang alurnya: tahap & lamanya, serta riwayat tindakan pada dokumen terkait. */
  @Get("trace/:model/:id")
  trace(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const anchor = await this.anchor(tx, model, id);
      if (!anchor) throw new NotFoundException("Dokumen tidak berada dalam alur bisnis");
      const { process, anchorId } = anchor;
      this.flow.assertCanRead(process);
      const def = FLOW_DEFS[process];
      const [item] = await this.flow.items(tx, process, { onlyId: anchorId });
      if (!item) throw new NotFoundException("Dokumen tidak berada dalam alur bisnis");
      const settings = await this.flow.settings(tx, process);
      const today = businessToday();
      const stage = currentStage(def, item);
      const keys = def.stages.map((s) => s.key);
      const stages = def.stages.map((s, i) => {
        const at = item.times[s.key] ?? null;
        const nextKey = keys.slice(i + 1).find((k) => item.times[k]);
        const next = nextKey ? item.times[nextKey]! : null;
        const current = s.key === stage && i < keys.length - 1;
        return {
          key: s.key,
          label: s.label,
          waiting: s.waiting,
          at,
          days: at ? (next ? flowDays(at, next) : current ? flowDays(at, today) : null) : null,
          current,
          slaDays: settings.sla[s.key] ?? null,
          status: current && at ? stageStatus(at, today, settings.sla[s.key] ?? null, item.due) : null,
        };
      });
      const related = await this.related(tx, process, anchorId);
      const events = await this.events(tx, [{ model: item.model, id: item.id, name: item.name }, ...related]);
      const owners = await this.flow.owners(tx, item.ownerId ? [item.ownerId] : []);
      const start = keys.map((k) => item.times[k]).find(Boolean);
      const end = item.times[keys[keys.length - 1]!];
      return {
        process,
        label: def.label,
        anchor: { model: item.model, id: item.id, name: item.name, href: item.href ?? null },
        partner: item.partner ?? null,
        value: item.value ?? null,
        owner: item.ownerId ? (owners.get(item.ownerId) ?? null) : null,
        stage,
        due: item.due ?? null,
        cycleDays: start ? flowDays(start, end ?? today) : null,
        finished: !!end,
        stages,
        related,
        events,
      };
    });
  }

  // ---- internal ----

  private async getSettingsTx(tx: Db, process: FlowProcess) {
    const s = await this.flow.settings(tx, process);
    return FLOW_DEFS[process].stages.map((st) => ({
      stage: st.key,
      label: st.label,
      defaultSlaDays: st.slaDays,
      slaDays: s.sla[st.key] ?? null,
      departmentId: s.configured[st.key] ?? null,
      /** Departemen hasil pencocokan otomatis, dipakai bila departemen belum ditetapkan. */
      autoDepartmentId: s.auto[st.key] ?? null,
      final: st.slaDays === null,
    }));
  }

  private async load(tx: Db, process: FlowProcess, q: FlowQuery) {
    let items = await this.flow.items(tx, process, { from: q.from });
    const settings = await this.flow.settings(tx, process);
    const owners = await this.flow.owners(tx, items.map((i) => i.ownerId ?? "").filter(Boolean));
    if (q.user) items = items.filter((i) => i.ownerId === q.user);
    if (q.department)
      items = items.filter((i) => i.ownerId && owners.get(i.ownerId)?.departmentId === q.department);
    return { items, settings, owners };
  }

  private async compute(tx: Db, process: FlowProcess, q: FlowQuery) {
    const { items, settings, owners } = await this.load(tx, process, q);
    const summary = summarizeFlow(FLOW_DEFS[process], items, {
      today: businessToday(),
      from: q.from,
      to: q.to,
      sla: settings.sla,
      departments: settings.departments,
      owners,
    });
    return { summary, settings };
  }

  private async departmentNames(tx: Db, ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const D = schema.departments;
    const rows = await tx.select({ id: D.id, name: D.name }).from(D).where(inArray(D.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Dokumen jangkar proses untuk dokumen yang dibuka (mis. faktur → pesanan penjualannya). */
  private async anchor(
    tx: Db,
    model: string,
    id: string,
  ): Promise<{ process: FlowProcess; anchorId: string } | null> {
    const c = currentContext().companyId;
    switch (model) {
      case "sale_order":
        return { process: "o2c", anchorId: id };
      case "purchase_order":
        return { process: "p2p", anchorId: id };
      case "production_order":
        return { process: "mfg", anchorId: id };
      case "stock_picking": {
        const [p] = await tx
          .select({ so: schema.stockPickings.saleOrderId, po: schema.stockPickings.purchaseOrderId })
          .from(schema.stockPickings)
          .where(and(eq(schema.stockPickings.id, id), eq(schema.stockPickings.companyId, c)));
        if (p?.so) return { process: "o2c", anchorId: p.so };
        if (p?.po) return { process: "p2p", anchorId: p.po };
        return null;
      }
      case "account_move": {
        const [r] = await tx.execute<{ source_model: string; source_id: string }>(sql`
          select ms.source_model, ms.source_id from account_move_sources ms join account_moves m on m.id = ms.move_id
          where ms.move_id = ${id} and m.company_id = ${c} and ms.source_model in ('sale_order', 'purchase_order')
          limit 1`);
        if (!r) return null;
        return { process: r.source_model === "sale_order" ? "o2c" : "p2p", anchorId: r.source_id };
      }
      case "employee": {
        const [a] = await tx.execute<{ id: string }>(sql`
          select a.id from applicants a where a.employee_id = ${id} and a.company_id = ${c} limit 1`);
        return a ? { process: "h2p", anchorId: a.id } : null;
      }
      default:
        return null;
    }
  }

  /** Dokumen turunan langsung dalam alur (pengiriman/penerimaan, faktur/tagihan, QC, karyawan). */
  private async related(tx: Db, process: FlowProcess, anchorId: string) {
    let rows: {
      model: string;
      id: string;
      name: string | null;
      date: string | null;
      state: string | null;
    }[] = [];
    if (process === "o2c" || process === "p2p") {
      const col = process === "o2c" ? sql`sale_order_id` : sql`purchase_order_id`;
      const src = process === "o2c" ? "sale_order" : "purchase_order";
      rows = [
        ...(await tx.execute<(typeof rows)[number]>(sql`
          select 'stock_picking' as model, t.id, t.name, coalesce(t.date_done::date, t.scheduled_date)::text as date, t.state
          from stock_pickings t where t.${col} = ${anchorId} order by t.scheduled_date`)),
        ...(await tx.execute<(typeof rows)[number]>(sql`
          select distinct 'account_move' as model, m.id, coalesce(m.name, '(draft)') as name, m.date::text as date,
            case when m.state = 'posted' then m.payment_state else m.state end as state
          from account_move_sources ms join account_moves m on m.id = ms.move_id
          where ms.source_model = ${src} and ms.source_id = ${anchorId}`)),
      ];
    } else if (process === "mfg") {
      rows = [
        ...(await tx.execute<(typeof rows)[number]>(sql`
          select 'quality_check' as model, q.id, q.name, q.decided_at::date::text as date, q.state
          from quality_checks q where q.production_order_id = ${anchorId}`)),
      ];
    } else {
      rows = [
        ...(await tx.execute<(typeof rows)[number]>(sql`
          select 'employee' as model, e.id, e.name, e.join_date::text as date, null as state
          from applicants a join employees e on e.id = a.employee_id where a.id = ${anchorId}`)),
      ];
    }
    return rows.map((r) => ({ model: r.model, id: r.id, name: r.name ?? "", date: r.date, state: r.state }));
  }

  /** Riwayat tindakan (siapa, kapan, apa) pada dokumen alur, dari log aktivitas. */
  private async events(tx: Db, docs: { model: string; id: string; name: string }[]) {
    if (!docs.length) return [];
    const L = schema.activityLogs;
    const U = schema.users;
    const rows = await tx
      .select({
        at: L.createdAt,
        model: L.resModel,
        id: L.resId,
        action: L.action,
        message: L.message,
        changes: L.changes,
        user: U.name,
      })
      .from(L)
      .leftJoin(U, eq(U.id, L.userId))
      .where(
        inArray(
          L.resId,
          docs.map((d) => d.id),
        ),
      )
      .orderBy(L.createdAt)
      .limit(200);
    const names = new Map(docs.map((d) => [d.id, d.name]));
    return rows.map((r) => ({
      at: r.at,
      model: r.model,
      id: r.id,
      name: names.get(r.id) ?? "",
      action: r.action,
      message: r.message,
      changes: r.changes,
      user: r.user,
    }));
  }
}

@Module({
  imports: [NotificationsModule],
  // Papan serah terima didaftarkan lebih dulu agar /flow/handoffs tidak tertangkap /flow/:process.
  controllers: [FlowHandoffController, FlowController],
  providers: [FlowService],
  exports: [FlowService],
})
export class FlowModule {}
