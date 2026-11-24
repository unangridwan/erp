import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, desc, eq, gt, isNotNull, schema, sql, type Db } from "@erp/db";
import {
  ALERT_BY_KEY,
  ALERT_DEFS,
  alertParams,
  alertRuleSchema,
  businessToday,
  digestFor,
  effectivePermissions,
  elapsedShare,
  FLOW_DEFS,
  FLOW_PROCESSES,
  goalProgress,
  hasPermission,
  paceStatus,
  type AlertDef,
  type AlertRecipient,
} from "@erp/shared";
import { z } from "zod";
import { ControllingService } from "../accounting/controlling.module.js";
import { AccountingModule } from "../accounting/accounting.module.js";
import { companyReaders } from "../activity/readers.js";
import { loadAccessGrants } from "../auth/auth.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { CONFIG, type AppConfig } from "../config.js";
import { currentContext, runWithContext, type RequestContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { FlowModule } from "../flow/flow.module.js";
import { FlowService } from "../flow/flow.service.js";
import { computeCashForecast } from "../flow/money.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { NotificationService } from "../notifications/notification.service.js";
import { PurchaseModule } from "../purchase/purchase.module.js";
import { ReplenishmentService } from "../purchase/replenishment.service.js";

const R = schema.alertRules;
const EV = schema.alertEvents;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const money = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

/** Temuan satu aturan: penerima langsung (pemilik/manajer) dan butir ringkasannya. */
interface Finding {
  owner?: string | null;
  manager?: string | null;
  item: string;
}

const runSchema = z.object({ keys: z.array(z.string().max(40)).max(20).optional() });

/**
 * Mesin peringatan dini: tiap aturan menghasilkan temuan dari data terkini dengan hak pengguna yang menjalankannya,
 * lalu tiap penerima mendapat satu notifikasi ringkas per aturan per hari (dicatat di `alert_events` sehingga tidak
 * terkirim ganda meski dijalankan berulang).
 */
@Injectable()
export class AlertEngine {
  constructor(
    @Inject(FlowService) private readonly flow: FlowService,
    @Inject(ReplenishmentService) private readonly replenishment: ReplenishmentService,
    @Inject(ControllingService) private readonly controlling: ControllingService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** Temuan aturan saat ini (tanpa mengirim). Aturan yang datanya tidak boleh dibaca menghasilkan daftar kosong. */
  async findings(tx: Db, def: AlertDef, params: Record<string, number>): Promise<Finding[]> {
    const ctx = currentContext();
    if (def.permission && !hasPermission(ctx.permissions, def.permission)) return [];
    const c = ctx.companyId;
    const today = businessToday();
    switch (def.key) {
      case "flow_late": {
        const managers = await this.departmentManagers(tx);
        const out: (Finding & { over: number })[] = [];
        for (const p of FLOW_PROCESSES) {
          if (!this.flow.canRead(p)) continue;
          for (const h of await this.flow.handoffs(tx, p)) {
            if (h.status !== "late") continue;
            const over = h.due
              ? Math.round((Date.parse(today) - Date.parse(h.due)) / 864e5)
              : h.slaDays !== null
                ? h.ageDays - h.slaDays
                : 0;
            if (over < params.graceDays!) continue;
            out.push({
              over,
              owner: h.ownerId,
              manager: h.toDepartmentId ? (managers.get(h.toDepartmentId) ?? null) : null,
              item: `${h.name} — menunggu ${h.waiting[0].toLowerCase()} ${h.ageDays} hari (${FLOW_DEFS[p].label[0].split(" (")[0]})`,
            });
          }
        }
        // Paling lama lewat batas lebih dulu (contoh di ringkasan).
        return out.sort((x, y) => y.over - x.over);
      }
      case "stock_low": {
        const rows = await this.replenishment.list(tx);
        return rows
          .filter((r) => num(r.forecast) < num(r.minQty))
          .map((r) => ({
            item: `${r.sku ? `${r.sku} ` : ""}${r.productName} (${r.warehouseCode}): perkiraan ${num(r.forecast)} < minimum ${num(r.minQty)}`,
          }));
      }
      case "ar_overdue": {
        const rows = await tx.execute<{
          name: string;
          partner: string | null;
          residual: string;
          days: number;
          owner: string | null;
        }>(sql`
          select m.name, p.name as partner, m.amount_residual as residual,
            (${today}::date - coalesce(m.due_date, m.date)) as days,
            (select s.user_id from account_move_lines l join sale_order_lines sl on sl.id = l.sale_line_id
              join sale_orders s on s.id = sl.order_id where l.move_id = m.id limit 1) as owner
          from account_moves m left join partners p on p.id = m.partner_id
          where m.company_id = ${c} and m.state = 'posted' and m.move_type = 'out_invoice'
            and m.payment_state in ('not_paid', 'partial') and m.amount_residual > 0
            and coalesce(m.due_date, m.date) < ${today}::date - ${params.overdueDays!}::int
          order by days desc`);
        return [...rows].map((r) => ({
          owner: r.owner,
          item: `${r.name} ${r.partner ?? ""}: sisa ${money(num(r.residual))}, lewat ${r.days} hari`,
        }));
      }
      case "budget_threshold": {
        const year = today.slice(0, 4);
        const report = await this.controlling.costCenters(tx, {
          dateFrom: `${year}-01-01`,
          dateTo: `${year}-12-31`,
        });
        const centers = await tx
          .select({ id: schema.costCenters.id, managerUser: schema.employees.userId })
          .from(schema.costCenters)
          .leftJoin(schema.employees, eq(schema.employees.id, schema.costCenters.managerEmployeeId))
          .where(eq(schema.costCenters.companyId, c));
        const D = schema.departments;
        const deptManagers = await tx
          .select({ cc: D.costCenterId, user: schema.employees.userId })
          .from(D)
          .innerJoin(schema.employees, eq(schema.employees.id, D.managerId))
          .where(and(eq(D.companyId, c), isNotNull(D.costCenterId)));
        return report.rows
          .filter((r) => num(r.budget) > 0 && r.percent !== null && r.percent >= params.threshold!)
          .map((r) => ({
            manager:
              centers.find((x) => x.id === r.id)?.managerUser ??
              deptManagers.find((x) => x.cc === r.id)?.user ??
              null,
            item: `${r.code} ${r.name}: terpakai ${r.percent}% (${money(num(r.actual))} dari ${money(num(r.budget))})`,
          }));
      }
      case "goal_behind": {
        const G = schema.performanceGoals;
        const goals = await tx.select().from(G).where(eq(G.companyId, c));
        const progress = goalProgress(goals);
        const E = schema.employees;
        const emps = await tx
          .select({ id: E.id, userId: E.userId, managerId: E.managerId })
          .from(E)
          .where(eq(E.companyId, c));
        const userOf = (empId: string | null | undefined) =>
          empId ? emps.find((e) => e.id === empId)?.userId : null;
        const managers = await this.departmentManagers(tx);
        return goals
          .filter((g) => g.state === "active")
          .flatMap((g) => {
            const p = progress.get(g.id) ?? 0;
            const pace = paceStatus(
              p,
              elapsedShare(
                g.periodFrom ?? (g.dueDate ? g.createdAt.toISOString().slice(0, 10) : null),
                g.periodTo ?? g.dueDate,
                today,
              ),
            );
            if (pace.rag !== "red") return [];
            const emp = g.employeeId ? emps.find((e) => e.id === g.employeeId) : undefined;
            return [
              {
                owner: emp
                  ? (emp.userId ?? null)
                  : g.departmentId
                    ? (managers.get(g.departmentId) ?? null)
                    : null,
                manager: emp ? (userOf(emp.managerId) ?? null) : null,
                item: `${g.title}: ${p}% (seharusnya ${pace.expected}%)`,
              },
            ];
          });
      }
      case "approval_waiting": {
        const P = schema.purchaseOrders;
        const rows = await tx
          .select({ name: P.name, owner: P.userId, since: P.approvalRequestedAt, total: P.amountTotal })
          .from(P)
          .where(
            and(
              eq(P.companyId, c),
              eq(P.state, "to_approve"),
              sql`coalesce(${P.approvalRequestedAt}, ${P.updatedAt}) < now() - make_interval(days => ${params.waitDays!})`,
            ),
          );
        return rows.map((r) => ({
          owner: r.owner,
          item: `${r.name}: ${money(num(r.total))}, menunggu sejak ${r.since ? r.since.toISOString().slice(0, 10) : "—"}`,
        }));
      }
      case "supplier_late": {
        const rows = await tx.execute<{ partner: string | null; total: string; on_time: string }>(sql`
          select pa.name as partner, count(*) as total,
            count(*) filter (where t.date_done::date <= coalesce(p.date_planned::date, t.scheduled_date)) as on_time
          from stock_pickings t left join purchase_orders p on p.id = t.purchase_order_id
          left join partners pa on pa.id = coalesce(t.partner_id, p.partner_id)
          where t.company_id = ${c} and t.picking_type = 'incoming' and t.state = 'done' and t.return_of_id is null
            and t.date_done > now() - interval '90 days'
          group by pa.name having count(*) >= 3`);
        return [...rows]
          .map((r) => ({
            partner: r.partner ?? "—",
            pct: Math.round((num(r.on_time) / num(r.total)) * 1000) / 10,
            n: num(r.total),
          }))
          .filter((r) => r.pct < params.threshold!)
          .map((r) => ({ item: `${r.partner}: tepat waktu ${r.pct}% dari ${r.n} penerimaan` }));
      }
      case "cash_negative": {
        const f = await computeCashForecast(tx, 13);
        const low = f.weeks.filter((w) => w.balance < params.minBalance!);
        return low.length
          ? [
              {
                item: `Saldo kas diproyeksikan ${money(f.lowest.balance)} pada minggu ke-${f.lowest.week} (${low.length} minggu di bawah ${money(params.minBalance!)})`,
              },
            ]
          : [];
      }
      default:
        return [];
    }
  }

  /**
   * Jalankan aturan aktif perusahaan aktif: hitung temuan, ringkas per penerima, kirim notifikasi yang belum terkirim
   * hari ini. `dryRun` = hanya hitung (pratinjau).
   */
  async run(tx: Db, opts: { keys?: string[]; dryRun?: boolean; activeOnly?: boolean; day?: string } = {}) {
    const ctx = currentContext();
    const saved = await tx.select().from(R).where(eq(R.companyId, ctx.companyId));
    const today = opts.day ?? businessToday();
    const out: { key: string; matches: number; recipients: number; notified: number }[] = [];
    for (const def of ALERT_DEFS) {
      if (opts.keys && !opts.keys.includes(def.key)) continue;
      const rule = saved.find((r) => r.key === def.key);
      if ((opts.activeOnly ?? true) && !rule?.active) continue;
      const params = alertParams(def, rule?.params);
      const recipients = (rule?.recipients ?? def.defaultRecipients) as AlertRecipient[];
      const findings = await this.findings(tx, def, params);
      const role =
        recipients.includes("role") && findings.length
          ? (await companyReaders(tx, ctx.companyId, def.rolePermission)).map((u) => u.id)
          : [];
      const pairs: { userId: string; item: string }[] = [];
      for (const f of findings) {
        const users = new Set<string>(role);
        if (recipients.includes("owner") && f.owner) users.add(f.owner);
        if (recipients.includes("manager") && f.manager) users.add(f.manager);
        for (const u of users) pairs.push({ userId: u, item: f.item });
      }
      const digest = digestFor(pairs);
      let notified = 0;
      if (!opts.dryRun && digest.size) {
        // Hanya pengguna aktif di perusahaan ini.
        const active = new Set(
          (await companyReaders(tx, ctx.companyId, null, { ids: [...digest.keys()] })).map((u) => u.id),
        );
        for (const [userId, d] of digest) {
          if (!active.has(userId)) continue;
          const [claimed] = await tx
            .insert(EV)
            .values({ companyId: ctx.companyId, ruleKey: def.key, userId, day: today, count: d.count })
            .onConflictDoNothing()
            .returning({ id: EV.id });
          if (!claimed) continue;
          await this.notifications.notify(
            tx,
            [userId],
            {
              kind: "alert",
              title: `Peringatan: ${def.label[0]} (${d.count})`,
              body:
                d.items.map((i) => `• ${i}`).join("\n") +
                (d.count > d.items.length ? `\n• +${d.count - d.items.length} lainnya` : ""),
              link: def.link,
            },
            { includeSelf: true },
          );
          notified++;
        }
      }
      out.push({ key: def.key, matches: findings.length, recipients: digest.size, notified });
    }
    return out;
  }

  /** Pengguna manajer per departemen (departemen → karyawan manajer → akun). */
  private async departmentManagers(tx: Db) {
    const D = schema.departments;
    const rows = await tx
      .select({ id: D.id, user: schema.employees.userId })
      .from(D)
      .innerJoin(schema.employees, eq(schema.employees.id, D.managerId))
      .where(eq(D.companyId, currentContext().companyId));
    return new Map(rows.filter((r) => r.user).map((r) => [r.id, r.user!]));
  }
}

@Controller()
export class AlertsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AlertEngine) private readonly engine: AlertEngine,
  ) {}

  /** Katalog aturan & pengaturan perusahaan. */
  @Get("alerts/rules")
  @RequirePermission("settings.manage")
  rules() {
    return this.tenantDb.run(async (tx) => {
      const saved = await tx.select().from(R).where(eq(R.companyId, currentContext().companyId));
      return ALERT_DEFS.map((def) => {
        const rule = saved.find((r) => r.key === def.key);
        return {
          ...def,
          active: rule?.active ?? false,
          configured: !!rule,
          values: alertParams(def, rule?.params),
          selected: rule ? rule.recipients : def.defaultRecipients,
          lastRunOn: rule?.lastRunOn ?? null,
        };
      });
    });
  }

  /** Simpan pengaturan satu aturan; pengguna yang menyimpan menjadi pemilik (haknya dipakai saat dijalankan). */
  @Put("alerts/rules/:key")
  @RequirePermission("settings.manage")
  save(@Param("key") key: string, @Body() body: unknown) {
    const def = ALERT_BY_KEY.get(key);
    if (!def) throw new NotFoundException("Aturan peringatan tidak ditemukan");
    const input = parse(alertRuleSchema, body);
    const params = alertParams(def, input.params);
    const recipients = input.recipients.filter((r) => def.recipients.includes(r));
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      await tx
        .insert(R)
        .values({
          companyId: ctx.companyId,
          key,
          active: input.active,
          params,
          recipients,
          ownerId: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [R.companyId, R.key],
          set: { active: input.active, params, recipients, ownerId: ctx.userId, updatedAt: sql`now()` },
        });
      return { key, active: input.active, values: params, selected: recipients };
    });
  }

  /** Pratinjau: banyaknya temuan & penerima tiap aturan saat ini (tanpa mengirim). */
  @Get("alerts/preview")
  @RequirePermission("settings.manage")
  preview() {
    return this.tenantDb.run((tx) => this.engine.run(tx, { dryRun: true, activeOnly: false }));
  }

  /** Jalankan aturan aktif sekarang (tetap sekali per penerima per aturan per hari). */
  @Post("alerts/run")
  @HttpCode(200)
  @RequirePermission("settings.manage")
  runNow(@Body() body: unknown) {
    const { keys } = parse(runSchema, body ?? {});
    return this.tenantDb.run((tx) => this.engine.run(tx, { keys }));
  }

  /** Peringatan untuk saya (14 hari terakhir). */
  @Get("me/alerts")
  mine() {
    return this.tenantDb.run((tx) => {
      const ctx = currentContext();
      const N = schema.notifications;
      return tx
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
            eq(N.companyId, ctx.companyId),
            eq(N.kind, "alert"),
            gt(N.createdAt, sql`now() - interval '14 days'`),
          ),
        )
        .orderBy(desc(N.createdAt))
        .limit(50);
    });
  }
}

/** Penjadwal harian: tiap jam, aturan aktif yang belum berjalan hari ini dijalankan dengan hak pemiliknya. */
@Injectable()
export class AlertScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AlertScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AlertEngine) private readonly engine: AlertEngine,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.alerts.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "alert-scheduler" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Jalankan aturan yang jatuh tempo hari ini di semua tenant (atau tenant tertentu); mengembalikan notifikasi terkirim. */
  async runDue(day = businessToday(), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let sent = 0;
    for (const tenantId of tenants) {
      // Klaim aturan hari ini: hanya satu proses yang berhasil mengubah last_run_on.
      const claimed = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .update(R)
          .set({ lastRunOn: day })
          .where(
            and(eq(R.active, true), isNotNull(R.ownerId), sql`${R.lastRunOn} is distinct from ${day}::date`),
          )
          .returning({ companyId: R.companyId, key: R.key, ownerId: R.ownerId }),
      );
      const byOwner = new Map<string, { companyId: string; ownerId: string; keys: string[] }>();
      for (const r of claimed) {
        const k = `${r.companyId}:${r.ownerId}`;
        const g = byOwner.get(k) ?? { companyId: r.companyId, ownerId: r.ownerId!, keys: [] };
        g.keys.push(r.key);
        byOwner.set(k, g);
      }
      for (const g of byOwner.values()) {
        try {
          const ctx = await this.ownerContext(tenantId, g.ownerId, g.companyId);
          if (!ctx) continue;
          const result = await runWithContext(ctx, () =>
            this.tenantDb.run((tx) => this.engine.run(tx, { keys: g.keys, day })),
          );
          sent += result.reduce((s, r) => s + r.notified, 0);
        } catch (e) {
          this.logger.error(e);
          reportError(e, { job: "alert-scheduler", tenantId, companyId: g.companyId });
        }
      }
    }
    return sent;
  }

  /** Hak efektif pemilik pengaturan di perusahaan aturan (pengguna nonaktif → dilewati). */
  private ownerContext(tenantId: string, userId: string, companyId: string): Promise<RequestContext | null> {
    return this.tenantDb.runAs(tenantId, async (tx) => {
      const [user] = await tx
        .select({ active: schema.users.active })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      if (!user?.active) return null;
      const permissions = effectivePermissions(await loadAccessGrants(tx, userId), companyId);
      return { tenantId, userId, companyIds: [companyId], companyId, permissions } as RequestContext;
    });
  }
}

@Module({
  imports: [FlowModule, AccountingModule, PurchaseModule, NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertEngine, AlertScheduler],
  exports: [AlertScheduler],
})
export class AlertsModule {}
