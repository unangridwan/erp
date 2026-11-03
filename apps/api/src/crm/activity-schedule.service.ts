import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or, schema, sql, type Db } from "@erp/db";
import { hasPermission, LIST_LOAD_LIMIT, type activitySchema, type Permission } from "@erp/shared";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { assertCompanyUser, ownedScope } from "./checks.js";

export type ScheduleInput = z.infer<typeof activitySchema>;
type ResModel = ScheduleInput["resModel"];

const A = schema.scheduledActivities;

/** Permission & nama tampilan dokumen yang bisa diberi aktivitas terjadwal. */
const MODELS: Record<ResModel, { read: Permission; write: Permission }> = {
  crm_lead: { read: "crm.read", write: "crm.write" },
  sale_order: { read: "sales.read", write: "sales.write" },
  partner: { read: "partner.read", write: "partner.write" },
};

@Injectable()
export class ScheduleService {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  /** Pastikan dokumen terlihat oleh user (permission + aturan rekaman) dan kembalikan namanya. */
  async assertRecord(tx: Db, resModel: ResModel, resId: string, write: boolean): Promise<string> {
    const ctx = currentContext();
    const perm = MODELS[resModel];
    if (!perm) throw new NotFoundException("Dokumen tidak ditemukan");
    const required = write ? perm.write : perm.read;
    if (!hasPermission(ctx.permissions, required))
      throw new ForbiddenException(`Butuh permission ${required}`);
    const [row] =
      resModel === "crm_lead"
        ? await tx
            .select({ name: schema.crmLeads.name })
            .from(schema.crmLeads)
            .where(
              and(
                eq(schema.crmLeads.id, resId),
                ownedScope(schema.crmLeads.companyId, schema.crmLeads.userId, "crm.all"),
              ),
            )
        : resModel === "sale_order"
          ? await tx
              .select({ name: schema.saleOrders.name })
              .from(schema.saleOrders)
              .where(
                and(
                  eq(schema.saleOrders.id, resId),
                  ownedScope(schema.saleOrders.companyId, schema.saleOrders.userId, "sales.all"),
                ),
              )
          : await tx
              .select({ name: schema.partners.name })
              .from(schema.partners)
              .where(
                and(
                  eq(schema.partners.id, resId),
                  or(isNull(schema.partners.companyId), inArray(schema.partners.companyId, ctx.companyIds)),
                ),
              );
    if (!row) throw new NotFoundException("Dokumen tidak ditemukan");
    return row.name;
  }

  async listFor(tx: Db, resModel: ResModel, resId: string) {
    await this.assertRecord(tx, resModel, resId, false);
    return tx
      .select({ activity: A, userName: schema.users.name })
      .from(A)
      .leftJoin(schema.users, eq(schema.users.id, A.userId))
      .where(and(eq(A.resModel, resModel), eq(A.resId, resId), isNull(A.doneAt)))
      .orderBy(asc(A.dueDate))
      .then((rows) => rows.map((r) => ({ ...r.activity, userName: r.userName })));
  }

  /** Aktivitas terbuka milik user saat ini di perusahaan aktif, lengkap dengan nama dokumennya. */
  async mine(tx: Db) {
    const ctx = currentContext();
    return tx
      .select({
        activity: A,
        // Nama tabel ditulis lengkap: tanpa join Drizzle tidak menyertakannya pada kolom.
        recordName: sql<string | null>`coalesce(
          (select l.name from ${schema.crmLeads} l where scheduled_activities.res_model = 'crm_lead'
             and l.id = scheduled_activities.res_id and l.company_id = ${ctx.companyId}),
          (select o.name from ${schema.saleOrders} o where scheduled_activities.res_model = 'sale_order'
             and o.id = scheduled_activities.res_id and o.company_id = ${ctx.companyId}),
          (select p.name from ${schema.partners} p where scheduled_activities.res_model = 'partner'
             and p.id = scheduled_activities.res_id))`,
      })
      .from(A)
      .where(and(eq(A.userId, ctx.userId), isNull(A.doneAt)))
      .orderBy(asc(A.dueDate))
      .limit(LIST_LOAD_LIMIT)
      .then((rows) =>
        rows.filter((r) => r.recordName !== null).map((r) => ({ ...r.activity, recordName: r.recordName })),
      );
  }

  async create(tx: Db, input: ScheduleInput) {
    await this.assertRecord(tx, input.resModel, input.resId, true);
    const userId = input.userId ?? currentContext().userId;
    await assertCompanyUser(tx, userId);
    const [row] = await tx
      .insert(A)
      .values({ ...input, userId, createdBy: currentContext().userId })
      .returning();
    await this.activity.log(tx, {
      resModel: input.resModel,
      resId: input.resId,
      action: "comment",
      message: `Aktivitas dijadwalkan: ${input.summary} (${input.dueDate})`,
    });
    return row!;
  }

  async update(tx: Db, id: string, input: Partial<Omit<ScheduleInput, "resModel" | "resId">>) {
    const current = await this.find(tx, id);
    if (input.userId) await assertCompanyUser(tx, input.userId);
    const { resModel: _m, resId: _r, ...values } = input as Partial<ScheduleInput>;
    if (!Object.keys(values).length) return current;
    const [row] = await tx.update(A).set(values).where(eq(A.id, id)).returning();
    return row!;
  }

  /** Tandai selesai; ringkasan & catatan hasil masuk ke riwayat dokumen. */
  async done(tx: Db, id: string, feedback?: string | null) {
    const current = await this.find(tx, id);
    if (current.doneAt) return current;
    const [row] = await tx.update(A).set({ doneAt: new Date() }).where(eq(A.id, id)).returning();
    await this.activity.log(tx, {
      resModel: current.resModel,
      resId: current.resId,
      action: "comment",
      message: `Aktivitas selesai: ${current.summary}${feedback ? ` — ${feedback}` : ""}`,
    });
    return row!;
  }

  async remove(tx: Db, id: string) {
    await this.find(tx, id);
    await tx.delete(A).where(eq(A.id, id));
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx.select().from(A).where(eq(A.id, id));
    if (!row) throw new NotFoundException("Aktivitas tidak ditemukan");
    await this.assertRecord(tx, row.resModel as ResModel, row.resId, true);
    return row;
  }
}
