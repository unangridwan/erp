import { Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Inject } from "@nestjs/common";
import { and, desc, eq, isNull, schema, sql } from "@erp/db";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
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

@Module({
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
