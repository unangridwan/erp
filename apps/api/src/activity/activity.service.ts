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
import { allowedFor, commentSchema, recordHref, type CommentMeta, type Permission } from "@erp/shared";
import { and, desc, eq, schema, sql, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";
import { NotificationService } from "../notifications/notification.service.js";
import { companyReaders } from "./readers.js";

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
  ["support_ticket", "support.read"],
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

/**
 * Dokumen yang bisa didiskusikan dengan nama tampilan & pemiliknya (penerima notifikasi komentar). Model lain tetap
 * bisa dikomentari tanpa pemeriksaan keberadaan khusus (dibatasi hak baca modelnya).
 */
const DISCUSS_DOCS: Record<string, { table: string; name: string; owner: string | null }> = {
  sale_order: { table: "sale_orders", name: "name", owner: "user_id" },
  purchase_order: { table: "purchase_orders", name: "name", owner: "user_id" },
  account_move: { table: "account_moves", name: "coalesce(name, '(draft)')", owner: "created_by" },
  stock_picking: { table: "stock_pickings", name: "name", owner: "created_by" },
  production_order: { table: "production_orders", name: "name", owner: "created_by" },
  crm_lead: { table: "crm_leads", name: "name", owner: "user_id" },
  support_ticket: { table: "support_tickets", name: "number", owner: "user_id" },
  employee: { table: "employees", name: "name", owner: null },
  applicant: { table: "applicants", name: "name", owner: null },
};

/** "comment" = catatan sistem; "message" = komentar/diskusi pengguna (dengan @mention). */
export type ActivityAction = "create" | "update" | "delete" | "comment" | "message";

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

/** Hak baca model log aktivitas; 403 bila pemanggil tidak berhak. */
export function activityReadPermission(model: string): Permission {
  const required = ACTIVITY_READ.get(model);
  if (!required || !allowedFor(currentContext().permissions, required, { path: "/", method: "GET" }))
    throw new ForbiddenException("Tidak punya akses ke riwayat data ini");
  return required;
}

/** Nama & pemilik dokumen di perusahaan aktif (404 bila tidak ada); null bila model tidak terdaftar. */
export async function discussDoc(tx: Db, model: string, id: string) {
  const d = DISCUSS_DOCS[model];
  if (!d) return null;
  const [row] = await tx.execute<{ name: string | null; owner: string | null }>(sql`
    select ${sql.raw(d.name)} as name, ${sql.raw(d.owner ?? "null::uuid")} as owner
    from ${sql.raw(d.table)} where id = ${id} and company_id = ${currentContext().companyId}`);
  if (!row) throw new NotFoundException("Dokumen tidak ditemukan");
  return { name: row.name ?? "", owner: row.owner };
}

/**
 * Tulis komentar di dokumen & beri tahu yang disebut, pemilik dokumen, dan peserta diskusi sebelumnya — hanya yang
 * berhak membaca dokumen itu di perusahaan aktif.
 */
export async function postComment(
  tx: Db,
  notifications: NotificationService,
  input: {
    model: string;
    id: string;
    required: string;
    message: string;
    mentions: string[];
    reminder?: CommentMeta["reminder"];
    /** Penerima tambahan (mis. manajer departemen untuk pengingat). */
    notify?: string[];
    title?: string;
  },
) {
  const ctx = currentContext();
  const doc = await discussDoc(tx, input.model, input.id);
  const mentionIds = [...new Set(input.mentions)];
  const mentioned = await companyReaders(tx, ctx.companyId, input.required, { ids: mentionIds });
  if (mentioned.length !== mentionIds.length)
    throw new BadRequestException("Orang yang disebut tidak bisa melihat dokumen ini");
  const meta: CommentMeta = {
    ...(mentioned.length ? { mentions: mentioned.map((m) => ({ id: m.id, name: m.name })) } : {}),
    ...(input.reminder ? { reminder: input.reminder } : {}),
  };
  const L = schema.activityLogs;
  const participants = await tx
    .selectDistinct({ userId: L.userId })
    .from(L)
    .where(and(eq(L.resModel, input.model), eq(L.resId, input.id), eq(L.action, "message")));
  const [row] = await tx
    .insert(L)
    .values({
      resModel: input.model,
      resId: input.id,
      action: "message",
      userId: ctx.userId,
      message: input.message,
      changes: Object.keys(meta).length ? meta : null,
    })
    .returning();
  const [me] = await tx
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ctx.userId));
  // Pemilik dokumen & peserta diskusi: hanya yang berhak membaca dokumen.
  const others = [doc?.owner, ...participants.map((p) => p.userId)].filter(
    (u): u is string => !!u && !mentionIds.includes(u) && u !== ctx.userId,
  );
  const followers = others.length
    ? await companyReaders(tx, ctx.companyId, input.required, { ids: [...new Set(others)] })
    : [];
  // Penerima pengingat (pemegang & manajer departemen) cukup terdaftar di perusahaan; yang tidak berhak membaca
  // dokumen tetap mendapat isi pengingat tanpa tautan.
  const known = new Set([...mentionIds, ...followers.map((f) => f.id), ctx.userId]);
  const extraIds = [...new Set(input.notify ?? [])].filter((u) => !known.has(u));
  const extra = extraIds.length ? await companyReaders(tx, ctx.companyId, null, { ids: extraIds }) : [];
  const extraReaders = extraIds.length
    ? new Set((await companyReaders(tx, ctx.companyId, input.required, { ids: extraIds })).map((r) => r.id))
    : new Set<string>();
  const link =
    recordHref(input.model, input.id) ?? (input.model === "applicant" ? `/hr/recruitment/${input.id}` : null);
  const docName = doc?.name ? ` ${doc.name}` : "";
  const body = input.message.length > 300 ? `${input.message.slice(0, 297)}…` : input.message;
  const kind = input.reminder ? "handoff_reminder" : "comment";
  const who = me?.name ?? "Seseorang";
  if (mentioned.length)
    await notifications.notify(
      tx,
      mentioned.map((m) => m.id),
      {
        kind: input.reminder ? kind : "mention",
        title: input.title ?? `${who} menyebut Anda di${docName}`,
        body,
        link,
      },
    );
  const withLink = [
    ...followers.map((f) => f.id),
    ...extra.filter((e) => extraReaders.has(e.id)).map((e) => e.id),
  ];
  const withoutLink = extra.filter((e) => !extraReaders.has(e.id)).map((e) => e.id);
  const title = input.title ?? `${who} berkomentar di${docName}`;
  if (withLink.length) await notifications.notify(tx, withLink, { kind, title, body, link });
  if (withoutLink.length) await notifications.notify(tx, withoutLink, { kind, title, body, link: null });
  const notified = mentioned.length + withLink.length + withoutLink.length;
  return { ...row!, userName: me?.name ?? null, notified };
}

@Controller("activity")
export class ActivityController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /** Orang yang bisa disebut (@mention) di dokumen: pengguna lain di perusahaan aktif yang berhak membacanya. */
  @Get(":model/:id/people")
  people(@Param("model") model: string, @Param("id", ParseUUIDPipe) _id: string, @Query("q") q?: string) {
    const required = activityReadPermission(model);
    return this.tenantDb.run((tx) =>
      companyReaders(tx, currentContext().companyId, required, {
        q: q?.trim().slice(0, 60) || undefined,
        limit: 21,
      }).then((rows) =>
        rows
          .filter((r) => r.id !== currentContext().userId)
          .slice(0, 20)
          .map((r) => ({ id: r.id, name: r.name, department: r.department })),
      ),
    );
  }

  /** Komentar pengguna di dokumen, dengan @mention → notifikasi. */
  @Post(":model/:id/comments")
  @HttpCode(201)
  comment(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const required = activityReadPermission(model);
    const input = parse(commentSchema, body);
    return this.tenantDb.run((tx) => postComment(tx, this.notifications, { model, id, required, ...input }));
  }

  @Get(":model/:id")
  list(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string) {
    activityReadPermission(model);
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: schema.activityLogs.id,
          action: schema.activityLogs.action,
          changes: schema.activityLogs.changes,
          message: schema.activityLogs.message,
          createdAt: schema.activityLogs.createdAt,
          userId: schema.activityLogs.userId,
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
