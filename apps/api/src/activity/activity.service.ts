import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe } from "@nestjs/common";
import { and, desc, eq, schema, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";
import { TenantDb } from "../common/database.js";

export type ActivityAction = "create" | "update" | "delete" | "comment";

@Injectable()
export class ActivityService {
  /** Catat aktivitas dalam transaksi yang sama dengan perubahan datanya. */
  async log(
    tx: Db,
    entry: { resModel: string; resId: string; action: ActivityAction; changes?: unknown; message?: string },
  ) {
    await tx.insert(schema.activityLogs).values({ ...entry, userId: currentContext().userId });
  }
}

@Controller("activity")
export class ActivityController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get(":model/:id")
  list(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: schema.activityLogs.id,
          action: schema.activityLogs.action,
          changes: schema.activityLogs.changes,
          message: schema.activityLogs.message,
          createdAt: schema.activityLogs.createdAt,
          userName: schema.users.name,
        })
        .from(schema.activityLogs)
        .leftJoin(schema.users, eq(schema.users.id, schema.activityLogs.userId))
        .where(and(eq(schema.activityLogs.resModel, model), eq(schema.activityLogs.resId, id)))
        .orderBy(desc(schema.activityLogs.createdAt))
        .limit(100),
    );
  }
}
