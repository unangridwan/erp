import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, asc, eq, lte, schema, sql, type Db } from "@erp/db";
import { createHmac, randomUUID } from "node:crypto";
import { decrypt } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { CONFIG, type AppConfig } from "../config.js";
import { departmentRecord, employeeRecord } from "./integration-data.js";

const W = schema.webhookDeliveries;
const C = schema.oauthClients;
export const WEBHOOK_MAX_ATTEMPTS = 8;
const TIMEOUT_MS = 10_000;
const BATCH = 50;

/** Jeda percobaan ulang: 30 dtk, 1 mnt, 2 mnt, … maksimal 6 jam. */
const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 6 * 3600_000);

/** Tanda tangan `t=<unix>,v1=<HMAC-SHA256(secret, "<t>.<body>")>` (hex). */
export function signWebhook(secret: string, timestamp: number, body: string) {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

interface Job {
  id: string;
  url: string;
  secret: string;
  event: string;
  body: string;
  attempts: number;
}

export interface SendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** Pengirim outbox webhook aplikasi terhubung (diisi trigger database saat karyawan/departemen berubah). */
@Injectable()
export class WebhookService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Webhook");
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.webhook.scheduler) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.run()
        .catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "webhook" });
        })
        .finally(() => (this.running = false));
    }, 30_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Kirim semua webhook yang jatuh tempo; mengembalikan jumlah yang terkirim. */
  async run(tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let sent = 0;
    for (const tenantId of tenants) {
      const jobs = await this.claim(tenantId);
      for (const job of jobs) {
        const result = await this.send(job.url, job.secret, job.event, job.id, job.body);
        await this.tenantDb.runAs(tenantId, (tx) => this.record(tx, job, result));
        if (result.ok) sent++;
      }
    }
    return sent;
  }

  /** Kirim event `ping` ke aplikasi (tombol "Tes webhook"); tidak masuk outbox. */
  async ping(url: string, secretEnc: string, tenantSlug: string) {
    const id = randomUUID();
    const body = JSON.stringify({
      id,
      event: "ping",
      occurredAt: new Date().toISOString(),
      tenant: tenantSlug,
      data: { message: "Tes webhook dari ERP" },
    });
    return this.send(url, decrypt(secretEnc, this.config.encryptionKey), "ping", id, body);
  }

  /**
   * Ambil webhook jatuh tempo dan majukan jadwal percobaan berikutnya dalam satu transaksi (SKIP LOCKED), sehingga
   * beberapa proses API tidak mengirim webhook yang sama. Isi dibangun dari data terbaru saat ini.
   */
  private async claim(tenantId: string): Promise<Job[]> {
    const [tenant] = await this.ownerDb
      .select({ slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    return this.tenantDb.runAs(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: W.id,
          event: W.event,
          resModel: W.resModel,
          resId: W.resId,
          attempts: W.attempts,
          createdAt: W.createdAt,
          url: C.webhookUrl,
          secretEnc: C.webhookSecretEnc,
          active: C.active,
        })
        .from(W)
        .innerJoin(C, eq(C.id, W.clientId))
        .where(and(eq(W.state, "pending"), lte(W.nextAttemptAt, sql`now()`)))
        .orderBy(asc(W.createdAt))
        .limit(BATCH)
        .for("update", { of: W, skipLocked: true });
      const jobs: Job[] = [];
      for (const r of rows) {
        // Aplikasi dinonaktifkan atau webhook dihapus setelah event diantrekan.
        if (!r.active || !r.url || !r.secretEnc) {
          await tx
            .update(W)
            .set({ state: "failed", lastError: "Webhook aplikasi tidak aktif" })
            .where(eq(W.id, r.id));
          continue;
        }
        const attempts = r.attempts + 1;
        await tx
          .update(W)
          .set({ attempts, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) })
          .where(eq(W.id, r.id));
        const data = await this.payload(tx, r.resModel, r.resId, r.event);
        jobs.push({
          id: r.id,
          url: r.url,
          secret: decrypt(r.secretEnc, this.config.encryptionKey),
          event: r.event,
          attempts,
          body: JSON.stringify({
            id: r.id,
            event: r.event,
            occurredAt: r.createdAt.toISOString(),
            tenant: tenant?.slug ?? null,
            data,
          }),
        });
      }
      return jobs;
    });
  }

  private async payload(tx: Db, model: string, id: string, event: string) {
    if (event.endsWith(".deleted")) return { id };
    const record = model === "employee" ? await employeeRecord(tx, id) : await departmentRecord(tx, id);
    return record ?? { id };
  }

  private async record(tx: Db, job: Job, result: SendResult) {
    const base = { responseStatus: result.status, lastError: result.error?.slice(0, 500) ?? null };
    if (result.ok)
      await tx
        .update(W)
        .set({ ...base, state: "sent", sentAt: sql`now()` })
        .where(eq(W.id, job.id));
    else if (job.attempts >= WEBHOOK_MAX_ATTEMPTS)
      await tx
        .update(W)
        .set({ ...base, state: "failed" })
        .where(eq(W.id, job.id));
    else await tx.update(W).set(base).where(eq(W.id, job.id));
  }

  private async send(
    url: string,
    secret: string,
    event: string,
    id: string,
    body: string,
  ): Promise<SendResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ERP-Webhook/1.0",
          "X-ERP-Event": event,
          "X-ERP-Delivery": id,
          "X-ERP-Signature": signWebhook(secret, timestamp, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => undefined);
      return res.ok
        ? { ok: true, status: res.status, error: null }
        : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
