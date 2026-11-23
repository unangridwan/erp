import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or, schema, sql, type Db } from "@erp/db";
import {
  dateTriggerTarget,
  effectivePermissions,
  fieldValue,
  latestOccurrence,
  matchConditions,
  PARTNER_FIELD,
  publicRecord,
  renderTemplate,
  RESPONSIBLE_FIELD,
  shouldFireOnUpdate,
  type AutomationAction,
  type AutomationCondition,
  type CustomFieldModel,
  businessToday,
} from "@erp/shared";
import { randomUUID } from "node:crypto";
import { loadAccessGrants } from "../auth/auth.service.js";
import { decrypt } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { Mailer } from "../common/mailer.js";
import { safeFetch } from "../common/safe-fetch.js";
import { runWithContext, type RequestContext } from "../common/request-context.js";
import { CONFIG, type AppConfig } from "../config.js";
import { normalizeCustom } from "../customization/custom-values.js";
import { ApprovalEngineService } from "../hr/approval-engine.service.js";
import { ScheduleService } from "../hr/schedule.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { signWebhook } from "../oauth/webhook.service.js";

const RULE = schema.automationRules;
const EVT = schema.automationEvents;
const RUN = schema.automationRuns;

type Rule = typeof RULE.$inferSelect;
type Rec = Record<string, unknown>;

/** Tabel per model (nama SQL). */
export const MODEL_TABLES: Record<CustomFieldModel, string> = {
  partner: "partners",
  product: "products",
  employee: "employees",
  fleet_vehicle: "fleet_vehicles",
  crm_lead: "crm_leads",
  sale_order: "sale_orders",
  purchase_order: "purchase_orders",
  account_move: "account_moves",
  stock_picking: "stock_pickings",
  production_order: "production_orders",
  equipment: "equipment",
  maintenance_request: "maintenance_requests",
};
/** Halaman web data (untuk tautan di notifikasi/email). */
export const MODEL_LINKS: Record<CustomFieldModel, string> = {
  partner: "/partners/",
  product: "/products/",
  employee: "/employees/",
  fleet_vehicle: "/fleet-vehicles/",
  crm_lead: "/crm/leads/",
  sale_order: "/sales/orders/",
  purchase_order: "/purchase/orders/",
  account_move: "/accounting/moves/",
  stock_picking: "/inventory/pickings/",
  production_order: "/manufacturing/orders/",
  equipment: "/equipment/",
  maintenance_request: "/maintenance/requests/",
};
/** Ekspresi label data (konstanta, bukan masukan pengguna). */
const LABEL_SQL: Record<CustomFieldModel, string> = {
  partner: "t.name",
  product: "coalesce(t.sku || ' ', '') || t.name",
  employee: "coalesce(t.employee_number || ' ', '') || t.name",
  fleet_vehicle: "t.license_plate",
  crm_lead: "t.name",
  sale_order: "t.name",
  purchase_order: "t.name",
  account_move: "coalesce(t.name, '(draft)')",
  stock_picking: "t.name",
  production_order: "t.name",
  equipment: "t.code || ' ' || t.name",
  maintenance_request: "t.name || ' ' || t.title",
};
const BATCH = 200;
const SCAN_LIMIT = 1000;
const WEBHOOK_TIMEOUT = 10_000;
const COLUMN = /^[a-z][a-z0-9_]{0,59}$/;

class ActionFailed extends Error {
  constructor(readonly result: ActionResult) {
    super(result.detail ?? "gagal");
  }
}

export interface ActionResult {
  type: string;
  ok: boolean;
  detail?: string;
}

/**
 * Mesin aturan otomatis: memproses outbox perubahan data (dibuat/diubah), memindai pemicu tanggal & jadwal, lalu
 * menjalankan aksi dengan hak pemilik aturan. Setiap eksekusi dicatat di `automation_runs`.
 */
@Injectable()
export class AutomationEngine implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Automation");
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Jam terakhir pemindaian tanggal/jadwal (sekali per menit cukup). */
  private lastDue = 0;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.automation.scheduler) return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processPending();
      if (Date.now() - this.lastDue > 60_000) {
        this.lastDue = Date.now();
        await this.runDue();
      }
    } catch (e) {
      this.logger.error(e);
      reportError(e, { job: "automation" });
    } finally {
      this.running = false;
    }
  }

  // ---- Event dibuat/diubah ----

  /** Proses event yang belum diproses (semua tenant atau tenant tertentu). Mengembalikan jumlah eksekusi. */
  async processPending(tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (
        await this.ownerDb
          .selectDistinct({ id: EVT.tenantId })
          .from(EVT)
          .where(isNull(EVT.processedAt))
          .limit(100)
      ).map((t) => t.id);
    let executed = 0;
    for (const tenantId of tenants) {
      for (;;) {
        const events = await this.tenantDb.runAs(tenantId, (tx) =>
          tx.select().from(EVT).where(isNull(EVT.processedAt)).orderBy(asc(EVT.createdAt)).limit(BATCH),
        );
        if (!events.length) break;
        for (const e of events) {
          const rules = await this.tenantDb.runAs(tenantId, (tx) =>
            tx
              .select()
              .from(RULE)
              .where(
                and(
                  eq(RULE.model, e.model),
                  eq(RULE.trigger, e.kind),
                  eq(RULE.active, true),
                  e.companyId ? eq(RULE.companyId, e.companyId) : undefined,
                ),
              ),
          );
          for (const rule of rules) {
            const conds = rule.conditions as AutomationCondition[];
            const fire =
              e.kind === "created"
                ? matchConditions(e.new, conds)
                : shouldFireOnUpdate(e.old, e.new, conds, rule.onlyWhenChanges);
            if (!fire) continue;
            await this.execute(tenantId, rule, e.resId, e.kind, null, e.depth);
            executed++;
          }
          await this.tenantDb.runAs(tenantId, (tx) =>
            tx.update(EVT).set({ processedAt: new Date() }).where(eq(EVT.id, e.id)),
          );
        }
        if (events.length < BATCH) break;
      }
    }
    return executed;
  }

  // ---- Pemicu tanggal & jadwal ----

  /** Pindai aturan tanggal & terjadwal yang jatuh tempo. Mengembalikan jumlah eksekusi. */
  async runDue(now = new Date(), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (
        await this.ownerDb
          .selectDistinct({ id: RULE.tenantId })
          .from(RULE)
          .where(and(eq(RULE.active, true), inArray(RULE.trigger, ["date", "scheduled"])))
      ).map((t) => t.id);
    let executed = 0;
    for (const tenantId of tenants) {
      const rules = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .select()
          .from(RULE)
          .where(and(eq(RULE.active, true), inArray(RULE.trigger, ["date", "scheduled"]))),
      );
      for (const rule of rules) {
        try {
          executed += await this.scanRule(tenantId, rule, now, false);
        } catch (e) {
          this.logger.error(e);
          reportError(e, { job: "automation", ruleId: rule.id });
        }
      }
    }
    return executed;
  }

  /** Jalankan satu aturan tanggal/jadwal; `force` = jalankan sekarang tanpa menunggu jadwal (tombol manual). */
  async scanRule(tenantId: string, rule: Rule, now: Date, force: boolean) {
    const tz = await this.tenantDb.runAs(tenantId, (tx) => this.schedules.timezone(tx, rule.companyId));
    let periodKey: string;
    let dateFilter: { column: string; date: string } | null = null;
    if (rule.trigger === "date") {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
      const target = dateTriggerTarget(today, rule.offsetDays);
      periodKey = `date:${target}`;
      dateFilter = { column: rule.dateField ?? "", date: target };
    } else {
      const occurrence = latestOccurrence(
        {
          frequency: rule.frequency ?? "daily",
          hour: rule.hour,
          weekday: rule.weekday,
          monthday: rule.monthday,
        },
        now,
        tz,
      );
      const since = rule.lastRunAt ?? rule.createdAt;
      if (!force && (!occurrence || occurrence.at <= since)) return 0;
      periodKey = force || !occurrence ? `manual:${now.toISOString()}` : `sched:${occurrence.period}`;
    }
    const records = await this.tenantDb.runAs(tenantId, (tx) => this.scanRecords(tx, rule, dateFilter));
    let executed = 0;
    for (const rec of records) {
      if (!matchConditions(rec, rule.conditions as AutomationCondition[])) continue;
      const done = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .select({ id: RUN.id })
          .from(RUN)
          .where(
            and(
              eq(RUN.ruleId, rule.id),
              eq(RUN.resId, rec.id as string),
              eq(RUN.periodKey, periodKey),
              sql`${RUN.status} <> 'failed'`,
            ),
          )
          .limit(1),
      );
      if (done.length) continue;
      await this.execute(tenantId, rule, rec.id as string, rule.trigger, periodKey, 0);
      executed++;
    }
    await this.tenantDb.runAs(tenantId, (tx) =>
      tx.update(RULE).set({ lastRunAt: now }).where(eq(RULE.id, rule.id)),
    );
    return executed;
  }

  private async scanRecords(tx: Db, rule: Rule, dateFilter: { column: string; date: string } | null) {
    const table = MODEL_TABLES[rule.model as CustomFieldModel];
    const filters = [sql`(t.company_id is null or t.company_id = ${rule.companyId})`];
    if (dateFilter) {
      const col = dateFilter.column;
      if (col.startsWith("custom.")) {
        const key = col.slice(7);
        if (!COLUMN.test(key)) return [];
        filters.push(sql`(t.custom ->> ${key}) = ${dateFilter.date}`);
      } else {
        if (!COLUMN.test(col)) return [];
        filters.push(sql`(t.${sql.identifier(col)})::date = ${dateFilter.date}::date`);
      }
    }
    const rows = await tx.execute(
      sql`select to_jsonb(t) as r from ${sql.identifier(table)} t where ${sql.join(filters, sql` and `)} limit ${SCAN_LIMIT}`,
    );
    return (rows as unknown as { r: Rec }[]).map((x) => x.r);
  }

  // ---- Eksekusi ----

  /** Jalankan aksi aturan untuk satu data dengan hak pemilik aturan; hasil dicatat di log. */
  async execute(
    tenantId: string,
    rule: Rule,
    resId: string,
    trigger: string,
    periodKey: string | null,
    depth: number,
  ) {
    const ctx = await this.ownerContext(tenantId, rule);
    const results: ActionResult[] = [];
    let status: "success" | "failed" | "skipped" = "success";
    let message: string | null = null;
    if (!ctx) {
      status = "skipped";
      message = "Pemilik aturan nonaktif";
    } else {
      try {
        await runWithContext(ctx, () =>
          this.tenantDb.run(async (tx) => {
            await tx.execute(sql`select set_config('erp.automation_depth', ${String(depth + 1)}, true)`);
            const rec = await this.loadRecord(tx, rule.model as CustomFieldModel, resId);
            if (!rec) throw new Error("Data tidak ditemukan");
            // Tiap aksi di savepoint sendiri: aksi yang gagal dibatalkan tanpa menggagalkan aksi lain.
            for (const action of rule.actions as AutomationAction[])
              results.push(
                await tx
                  .transaction(async (sp) => {
                    const r = await this.runAction(sp as unknown as Db, rule, action, rec);
                    if (!r.ok) throw new ActionFailed(r);
                    return r;
                  })
                  .catch((e: unknown) => {
                    if (e instanceof ActionFailed) return e.result;
                    return {
                      type: action.type,
                      ok: false,
                      detail: e instanceof Error ? e.message : String(e),
                    };
                  }),
              );
          }),
        );
        if (results.some((r) => !r.ok)) {
          status = "failed";
          message = results.find((r) => !r.ok)?.detail ?? null;
        }
      } catch (e) {
        status = "failed";
        message = e instanceof Error ? e.message : String(e);
      }
    }
    await this.tenantDb.runAs(tenantId, (tx) =>
      tx.insert(RUN).values({
        ruleId: rule.id,
        resId,
        trigger,
        periodKey,
        status,
        message: message?.slice(0, 1000) ?? null,
        results: results as unknown as Rec[],
      }),
    );
    return { status, message, results };
  }

  private async ownerContext(tenantId: string, rule: Rule): Promise<RequestContext | null> {
    return this.tenantDb.runAs(tenantId, async (tx) => {
      const [user] = await tx
        .select({ active: schema.users.active })
        .from(schema.users)
        .where(eq(schema.users.id, rule.ownerId));
      if (!user?.active) return null;
      const permissions = effectivePermissions(await loadAccessGrants(tx, rule.ownerId), rule.companyId);
      return {
        tenantId,
        userId: rule.ownerId,
        companyIds: [rule.companyId],
        companyId: rule.companyId,
        permissions,
      } as RequestContext;
    });
  }

  /** Data terbaru model aturan (untuk dipilih saat uji coba), dicari di kolom nama/nomor. */
  async searchRecords(tx: Db, rule: Rule, q: string) {
    const table = MODEL_TABLES[rule.model as CustomFieldModel];
    const label = LABEL_SQL[rule.model as CustomFieldModel];
    const rows = await tx.execute(
      sql`select t.id, ${sql.raw(label)} as label from ${sql.identifier(table)} t
          where (t.company_id is null or t.company_id = ${rule.companyId})
            and (${q} = '' or ${sql.raw(label)} ilike ${"%" + q + "%"})
          order by t.created_at desc limit 20`,
    );
    return rows as unknown as { id: string; label: string }[];
  }

  async loadRecord(tx: Db, model: CustomFieldModel, id: string): Promise<Rec | null> {
    const rows = await tx.execute(
      sql`select to_jsonb(t) as r from ${sql.identifier(MODEL_TABLES[model])} t where t.id = ${id}`,
    );
    return (rows as unknown as { r: Rec }[])[0]?.r ?? null;
  }

  private extras(rule: Rule, rec: Rec) {
    const path = `${MODEL_LINKS[rule.model as CustomFieldModel]}${rec.id as string}`;
    return { link: `${this.config.webOrigin}${path}`, rule: rule.name, path };
  }

  private async runAction(tx: Db, rule: Rule, action: AutomationAction, rec: Rec): Promise<ActionResult> {
    const model = rule.model as CustomFieldModel;
    const extra = this.extras(rule, rec);
    const t = (s: string) => renderTemplate(s, rec, extra);
    try {
      switch (action.type) {
        case "notify": {
          const users = new Set(action.users);
          if (action.roleIds.length) {
            const members = await tx
              .select({ userId: schema.userRoles.userId })
              .from(schema.userRoles)
              .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
              .where(
                and(
                  inArray(schema.userRoles.roleId, action.roleIds),
                  eq(schema.users.active, true),
                  or(isNull(schema.userRoles.companyId), eq(schema.userRoles.companyId, rule.companyId)),
                ),
              );
            for (const m of members) users.add(m.userId);
          }
          const resp = RESPONSIBLE_FIELD[model];
          if (action.responsible && resp && typeof rec[resp] === "string") users.add(rec[resp] as string);
          if (action.creator && typeof rec.created_by === "string") users.add(rec.created_by);
          await this.notifications.notify(
            tx,
            [...users],
            {
              kind: "automation",
              title: t(action.title),
              body: t(action.body) || null,
              link: extra.path,
              companyId: rule.companyId,
            },
            { includeSelf: true },
          );
          return { type: action.type, ok: true, detail: `${users.size} penerima` };
        }
        case "email": {
          let to = action.address ?? "";
          if (action.to === "partner") {
            const field = PARTNER_FIELD[model];
            const partnerId = field ? (fieldValue(rec, field) as string | null) : null;
            const [p] = partnerId
              ? await tx
                  .select({ email: schema.partners.email })
                  .from(schema.partners)
                  .where(eq(schema.partners.id, partnerId))
              : [];
            to = p?.email ?? "";
          }
          if (!to) return { type: action.type, ok: false, detail: "Alamat email penerima kosong" };
          await this.mailer.send({ to, subject: t(action.subject), text: t(action.body) });
          return { type: action.type, ok: true, detail: to };
        }
        case "set_field": {
          const table = MODEL_TABLES[model];
          const value = t(action.value);
          if (action.field.startsWith("custom.")) {
            const custom = await normalizeCustom(
              tx,
              model,
              { [action.field.slice(7)]: value },
              (rec.custom ?? {}) as Rec,
              (rec.company_id as string | null) ?? rule.companyId,
            );
            await tx.execute(
              sql`update ${sql.identifier(table)} set custom = ${JSON.stringify(custom)}::jsonb where id = ${rec.id as string}`,
            );
          } else if (action.field === RESPONSIBLE_FIELD[model]) {
            const [u] = value
              ? await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, value))
              : [];
            if (value && !u) return { type: action.type, ok: false, detail: "Pengguna tidak ditemukan" };
            await tx.execute(
              sql`update ${sql.identifier(table)} set ${sql.identifier(action.field)} = ${value || null} where id = ${rec.id as string}`,
            );
          } else return { type: action.type, ok: false, detail: "Field tidak bisa diubah aturan otomatis" };
          return { type: action.type, ok: true, detail: `${action.field} = ${value}` };
        }
        case "activity": {
          const resp = RESPONSIBLE_FIELD[model];
          const userId =
            action.assignTo === "user"
              ? action.userId
              : (resp && (rec[resp] as string | null)) || (rec.created_by as string | null) || rule.ownerId;
          if (!userId) return { type: action.type, ok: false, detail: "Penanggung jawab kosong" };
          const due = new Date();
          due.setUTCDate(due.getUTCDate() + action.dueInDays);
          await tx.insert(schema.scheduledActivities).values({
            resModel: model,
            resId: rec.id as string,
            activityType: action.activityType,
            summary: t(action.summary).slice(0, 200),
            note: t(action.note) || null,
            dueDate: due.toISOString().slice(0, 10),
            userId,
            createdBy: rule.ownerId,
          });
          return { type: action.type, ok: true };
        }
        case "approval": {
          const description = t(action.description);
          const amount = action.amountField ? Number(fieldValue(rec, action.amountField)) : NaN;
          const created = await this.approvals.createRequest(tx, {
            categoryId: action.categoryId,
            subject: `${rule.name}: ${String(rec.name ?? rec.license_plate ?? rec.id)}`.slice(0, 200),
            date: businessToday(),
            description,
            reference: String(rec.name ?? "").slice(0, 200) || null,
            amount: Number.isFinite(amount) ? amount.toFixed(2) : null,
            location: null,
            contact: null,
          });
          const submitted = await this.approvals.submit(tx, created.id);
          return {
            type: action.type,
            ok: true,
            detail: (submitted as { number?: string | null }).number ?? undefined,
          };
        }
        case "webhook": {
          const secret = rule.webhookSecretEnc
            ? decrypt(rule.webhookSecretEnc, this.config.encryptionKey)
            : "";
          const body = JSON.stringify({
            id: randomUUID(),
            rule: { id: rule.id, name: rule.name },
            model,
            record: publicRecord(rec),
            occurredAt: new Date().toISOString(),
          });
          const ts = Math.floor(Date.now() / 1000);
          const res = await safeFetch(action.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-ERP-Event": "automation",
              "X-ERP-Signature": signWebhook(secret, ts, body),
            },
            body,
            timeoutMs: WEBHOOK_TIMEOUT,
          });
          if (!res.ok) return { type: action.type, ok: false, detail: `HTTP ${res.status}` };
          return { type: action.type, ok: true, detail: `HTTP ${res.status}` };
        }
      }
    } catch (e) {
      return { type: action.type, ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}
