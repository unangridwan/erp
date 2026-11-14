import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";
import { allowedFor, type Permission } from "@erp/shared";
import { and, desc, eq, schema, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";
import { TenantDb } from "../common/database.js";

/**
 * Hak baca per model log aktivitas. Isi `changes` bisa memuat gaji, data pribadi, atau hak akses, jadi log hanya
 * boleh dibaca oleh yang berhak membaca datanya. Model CRUD generik mendaftar sendiri lewat `registerActivityModel`.
 */
const ACTIVITY_READ = new Map<string, Permission>([
  ["account_move", "accounting.read"],
  ["applicant", "hr.read"],
  ["approval_request", "hr.read"],
  ["approval_rules", "approval.manage"],
  ["automation_rule", "customization.manage"],
  ["benefit_plan", "payroll.read"],
  ["compensation_cycle", "payroll.read"],
  ["connected_app", "integration.manage"],
  ["crm_lead", "crm.read"],
  ["custom_field", "customization.manage"],
  ["employee", "hr.read"],
  ["hiring_request", "hr.read"],
  ["leave_bulk", "hr.read"],
  ["manpower_plan", "hr.read"],
  ["overtime", "hr.read"],
  ["partner", "partner.read"],
  ["payroll_run", "payroll.read"],
  ["pricelist", "sales.read"],
  ["production_order", "mrp.read"],
  ["public_holiday", "hr.read"],
  ["purchase_contract", "purchase.read"],
  ["purchase_order", "purchase.read"],
  ["role", "role.manage"],
  ["sale_order", "sales.read"],
  ["stock_count", "inventory.read"],
  ["stock_picking", "inventory.read"],
  ["user", "user.read"],
  ["user_access", "user.read"],
]);

export function registerActivityModel(model: string, read: Permission) {
  if (!ACTIVITY_READ.has(model)) ACTIVITY_READ.set(model, read);
}

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
    const required = ACTIVITY_READ.get(model);
    if (!required || !allowedFor(currentContext().permissions, required, { path: "/", method: "GET" }))
      throw new ForbiddenException("Tidak punya akses ke riwayat data ini");
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
