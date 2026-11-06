import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, asc, desc, eq, isNull, schema, sql, type Db } from "@erp/db";
import { notificationSettingsSchema } from "@erp/shared";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { Mailer } from "../common/mailer.js";
import { reportError } from "../common/error-reporting.js";
import { parse } from "../common/zod.js";
import { currentContext } from "../common/request-context.js";
import { CONFIG, type AppConfig } from "../config.js";
import { NotificationService } from "./notification.service.js";

const N = schema.notifications;

@Controller("me/notifications")
class NotificationsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  /** 50 notifikasi terbaru milik user (opsional hanya yang belum dibaca). */
  @Get()
  list(@Query("unread") unread?: string) {
    return this.tenantDb.run((tx) =>
      tx
        .select()
        .from(N)
        .where(and(eq(N.userId, currentContext().userId), unread ? isNull(N.readAt) : undefined))
        .orderBy(desc(N.createdAt))
        .limit(50),
    );
  }

  @Get("count")
  count() {
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(N)
        .where(and(eq(N.userId, currentContext().userId), isNull(N.readAt)));
      return { unread: row?.unread ?? 0 };
    });
  }

  @Post("read-all")
  @HttpCode(200)
  readAll() {
    return this.tenantDb.run(async (tx) => {
      await tx
        .update(N)
        .set({ readAt: sql`now()` })
        .where(and(eq(N.userId, currentContext().userId), isNull(N.readAt)));
      return { ok: true };
    });
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await tx
        .update(N)
        .set({ readAt: sql`coalesce(${N.readAt}, now())` })
        .where(and(eq(N.id, id), eq(N.userId, currentContext().userId)));
      return { ok: true };
    });
  }
}

/** Preferensi notifikasi pengguna: email aktif/nonaktif. */
@Controller("me/notification-settings")
class NotificationSettingsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  get() {
    return this.tenantDb.run(async (tx) => {
      const [u] = await tx
        .select({ email: schema.users.notifyEmail, address: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, currentContext().userId));
      return { email: u?.email ?? false, address: u?.address ?? null };
    });
  }

  @Put()
  update(@Body() body: unknown) {
    const input = parse(notificationSettingsSchema, body);
    return this.tenantDb.run(async (tx) => {
      await tx
        .update(schema.users)
        .set({ notifyEmail: input.email })
        .where(eq(schema.users.id, currentContext().userId));
      return { email: input.email };
    });
  }
}

const MAX_ATTEMPTS = 5;

/**
 * Pengirim email notifikasi (outbox): notifikasi `email_state = pending` dikirim setelah transaksi pembuatnya selesai,
 * sehingga email gagal tidak membatalkan pengajuan/persetujuan. Gagal → dicoba lagi, setelah 5 kali `failed`.
 */
@Injectable()
export class NotificationMailer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("NotificationMailer");
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(Mailer) private readonly mailer: Mailer,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.notifyEmail.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.flush().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "notification-mailer" });
        }),
      60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Kirim email notifikasi tertunda (semua tenant atau tenant tertentu); mengembalikan jumlah terkirim. */
  async flush(tenantIds?: string[]) {
    if (this.running) return 0;
    this.running = true;
    try {
      const tenants =
        tenantIds ??
        (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
      let sent = 0;
      for (const tenantId of tenants) sent += await this.flushTenant(tenantId);
      return sent;
    } finally {
      this.running = false;
    }
  }

  private async flushTenant(tenantId: string) {
    const pending = await this.tenantDb.runAs(tenantId, (tx) =>
      tx
        .select({ n: N, email: schema.users.email, company: schema.companies.name })
        .from(N)
        .innerJoin(schema.users, eq(schema.users.id, N.userId))
        .innerJoin(schema.companies, eq(schema.companies.id, N.companyId))
        .where(eq(N.emailState, "pending"))
        .orderBy(asc(N.createdAt))
        .limit(200),
    );
    let sent = 0;
    for (const { n, email, company } of pending) {
      const link = n.link ? `${this.config.webOrigin.replace(/\/$/, "")}${n.link}` : null;
      try {
        await this.mailer.send({
          to: email,
          subject: `[${company}] ${n.title}`,
          text: [
            n.body,
            link ? `Buka: ${link}` : null,
            "",
            "Email otomatis dari ERP — atur di menu Notifikasi.",
          ]
            .filter((l) => l !== null)
            .join("\n"),
        });
        await this.tenantDb.runAs(tenantId, (tx) =>
          tx
            .update(N)
            .set({ emailState: "sent", emailedAt: sql`now()`, emailAttempts: n.emailAttempts + 1 })
            .where(eq(N.id, n.id)),
        );
        sent++;
      } catch (e) {
        this.logger.warn(`Email notifikasi ${n.id} gagal: ${(e as Error).message}`);
        await this.tenantDb.runAs(tenantId, (tx) =>
          tx
            .update(N)
            .set({
              emailAttempts: n.emailAttempts + 1,
              ...(n.emailAttempts + 1 >= MAX_ATTEMPTS ? { emailState: "failed" as const } : {}),
            })
            .where(eq(N.id, n.id)),
        );
      }
    }
    return sent;
  }
}

@Module({
  controllers: [NotificationsController, NotificationSettingsController],
  providers: [NotificationService, NotificationMailer],
  exports: [NotificationService, NotificationMailer],
})
export class NotificationsModule {}
