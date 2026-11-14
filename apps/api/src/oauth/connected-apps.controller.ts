import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { and, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { connectedAppSchema } from "@erp/shared";
import { randomBytes } from "node:crypto";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { assertRefsVisible } from "../common/crud.js";
import { encrypt, randomToken, sha256 } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { assertPublicUrl } from "../common/safe-fetch.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { AccessService } from "../users/access.controller.js";
import { departmentPage, employeePage } from "./integration-data.js";
import { WebhookService } from "./webhook.service.js";

const C = schema.oauthClients;
const W = schema.webhookDeliveries;
const U = schema.users;

const newSecret = () => randomToken(32);

/** Pengaturan › Aplikasi Terhubung: klien login, akun layanan API, webhook (hanya admin penuh). */
@Controller()
export class ConnectedAppsController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(WebhookService) private readonly webhooks: WebhookService,
  ) {}

  @Get("connected-apps")
  @RequirePermission("integration.manage")
  list() {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.select().from(C).orderBy(C.name);
      return Promise.all(rows.map((r) => this.view(tx, r)));
    });
  }

  @Get("connected-apps/:id")
  @RequirePermission("integration.manage")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => this.view(tx, await this.find(tx, id)));
  }

  @Post("connected-apps")
  @RequirePermission("integration.manage")
  create(@Body() body: unknown) {
    const input = parse(connectedAppSchema, body);
    if (input.webhookUrl) assertPublicUrl(input.webhookUrl);
    const ctx = currentContext();
    return this.tenantDb.run(async (tx) => {
      await this.assertRoles(tx, input.allowedRoleIds);
      const serviceRoleIds = input.serviceRoleIds ?? [];
      await this.assertRoles(tx, serviceRoleIds);
      this.access.assertDelegable(
        [...(await this.access.rolePermissions(tx, serviceRoleIds)).values()].flat(),
      );
      // Akun layanan: hak API aplikasi diatur lewat peran, seperti pengguna biasa.
      const [user] = await tx
        .insert(U)
        .values({
          name: `${input.name} (aplikasi)`,
          email: `app-${randomBytes(8).toString("hex")}@service.invalid`,
          passwordHash: null,
          kind: "service",
          active: input.active,
        })
        .returning({ id: U.id });
      const companies = await tx
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .where(eq(schema.companies.active, true));
      await tx
        .insert(schema.userCompanies)
        .values(
          companies
            .sort((a, b) => Number(b.id === ctx.companyId) - Number(a.id === ctx.companyId))
            .map((c, i) => ({ userId: user!.id, companyId: c.id, isDefault: i === 0 })),
        );
      if (serviceRoleIds.length)
        await tx
          .insert(schema.userRoles)
          .values(serviceRoleIds.map((roleId) => ({ userId: user!.id, roleId })));

      const clientSecret = newSecret();
      const webhookSecret = input.webhookUrl ? newSecret() : null;
      const [row] = await tx
        .insert(C)
        .values({
          name: input.name,
          clientId: `${ctx.tenantId}.${randomToken(12)}`,
          secretHash: sha256(clientSecret),
          redirectUris: input.redirectUris,
          postLogoutRedirectUris: input.postLogoutRedirectUris,
          allowedRoleIds: input.allowedRoleIds,
          serviceUserId: user!.id,
          webhookUrl: input.webhookUrl ?? null,
          webhookSecretEnc: webhookSecret && encrypt(webhookSecret, this.config.encryptionKey),
          webhookEvents: input.webhookEvents,
          active: input.active,
          createdBy: ctx.userId,
        })
        .returning();
      await this.activity.log(tx, { resModel: "connected_app", resId: row!.id, action: "create" });
      // Secret hanya ditampilkan sekali; yang tersimpan hanya hash (client) / terenkripsi (webhook).
      return { ...(await this.view(tx, row!)), clientSecret, webhookSecret };
    });
  }

  @Patch("connected-apps/:id")
  @RequirePermission("integration.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(connectedAppSchema.omit({ serviceRoleIds: true }).partial(), body);
    if (input.webhookUrl) assertPublicUrl(input.webhookUrl);
    return this.tenantDb.run(async (tx) => {
      const before = await this.find(tx, id);
      if (input.allowedRoleIds) await this.assertRoles(tx, input.allowedRoleIds);
      // Webhook baru tanpa secret: buat secret sekarang dan tampilkan sekali.
      const webhookSecret = input.webhookUrl && !before.webhookSecretEnc ? newSecret() : null;
      const [row] = await tx
        .update(C)
        .set({
          ...input,
          ...(webhookSecret ? { webhookSecretEnc: encrypt(webhookSecret, this.config.encryptionKey) } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(C.id, id))
        .returning();
      if (input.active !== undefined && before.serviceUserId)
        await tx
          .update(U)
          .set({ active: input.active, updatedAt: sql`now()` })
          .where(eq(U.id, before.serviceUserId));
      await this.activity.log(tx, {
        resModel: "connected_app",
        resId: id,
        action: "update",
        changes: Object.fromEntries(
          Object.keys(input).map((k) => [
            k,
            { from: before[k as keyof typeof before], to: row![k as keyof typeof row] },
          ]),
        ),
      });
      return { ...(await this.view(tx, row!)), webhookSecret };
    });
  }

  @Delete("connected-apps/:id")
  @RequirePermission("integration.manage")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const app = await this.find(tx, id);
      await tx.delete(C).where(eq(C.id, id));
      // Akun layanan dinonaktifkan (bukan dihapus) agar riwayat perubahan oleh aplikasi tetap terbaca.
      if (app.serviceUserId)
        await tx
          .update(U)
          .set({ active: false, updatedAt: sql`now()` })
          .where(eq(U.id, app.serviceUserId));
      await this.activity.log(tx, {
        resModel: "connected_app",
        resId: id,
        action: "delete",
        message: `Aplikasi ${app.name} dihapus`,
      });
    });
  }

  @Post("connected-apps/:id/rotate-secret")
  @RequirePermission("integration.manage")
  @HttpCode(200)
  rotateSecret(@Param("id", ParseUUIDPipe) id: string) {
    const clientSecret = newSecret();
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      await tx
        .update(C)
        .set({ secretHash: sha256(clientSecret), updatedAt: sql`now()` })
        .where(eq(C.id, id));
      await this.activity.log(tx, {
        resModel: "connected_app",
        resId: id,
        action: "update",
        message: "Client secret diganti",
      });
      return { clientSecret };
    });
  }

  @Post("connected-apps/:id/rotate-webhook-secret")
  @RequirePermission("integration.manage")
  @HttpCode(200)
  rotateWebhookSecret(@Param("id", ParseUUIDPipe) id: string) {
    const webhookSecret = newSecret();
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      await tx
        .update(C)
        .set({ webhookSecretEnc: encrypt(webhookSecret, this.config.encryptionKey), updatedAt: sql`now()` })
        .where(eq(C.id, id));
      await this.activity.log(tx, {
        resModel: "connected_app",
        resId: id,
        action: "update",
        message: "Secret webhook diganti",
      });
      return { webhookSecret };
    });
  }

  @Post("connected-apps/:id/webhook-test")
  @RequirePermission("integration.manage")
  @HttpCode(200)
  async webhookTest(@Param("id", ParseUUIDPipe) id: string) {
    const app = await this.tenantDb.run((tx) => this.find(tx, id));
    if (!app.webhookUrl || !app.webhookSecretEnc) throw new NotFoundException("Webhook belum diatur");
    const [tenant] = await this.ownerDb
      .select({ slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, currentContext().tenantId));
    return this.webhooks.ping(app.webhookUrl, app.webhookSecretEnc, tenant?.slug ?? "");
  }

  @Get("connected-apps/:id/deliveries")
  @RequirePermission("integration.manage")
  deliveries(@Param("id", ParseUUIDPipe) id: string, @Query("state") state?: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      return tx
        .select()
        .from(W)
        .where(
          and(
            eq(W.clientId, id),
            state === "pending" || state === "sent" || state === "failed" ? eq(W.state, state) : undefined,
          ),
        )
        .orderBy(desc(W.createdAt))
        .limit(100);
    });
  }

  @Post("webhook-deliveries/:id/retry")
  @RequirePermission("integration.manage")
  @HttpCode(200)
  retry(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .update(W)
        .set({ state: "pending", attempts: 0, nextAttemptAt: sql`now()`, lastError: null })
        .where(eq(W.id, id))
        .returning();
      if (!row) throw new NotFoundException("Pengiriman webhook tidak ditemukan");
      return row;
    });
  }

  // ---- Data untuk aplikasi terhubung (token akun layanan) ----

  /** Sinkron karyawan: `?updatedSince=<ISO>&cursor=&limit=` (urut updated_at, maks 1000 per halaman). */
  @Get("integrations/employees")
  @RequirePermission("hr.read")
  employees(@Query() q: Record<string, string>) {
    return this.tenantDb.run((tx) => employeePage(tx, { ...q, companyIds: currentContext().companyIds }));
  }

  @Get("integrations/departments")
  @RequirePermission("hr.read")
  departments(@Query() q: Record<string, string>) {
    return this.tenantDb.run((tx) => departmentPage(tx, { ...q, companyIds: currentContext().companyIds }));
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx.select().from(C).where(eq(C.id, id));
    if (!row) throw new NotFoundException("Aplikasi tidak ditemukan");
    return row;
  }

  private async assertRoles(tx: Db, roleIds: string[]) {
    for (const roleId of new Set(roleIds)) await assertRefsVisible(tx, { roleId: schema.roles }, { roleId });
  }

  private async view(tx: Db, row: typeof C.$inferSelect) {
    const { secretHash: _s, webhookSecretEnc, ...rest } = row;
    const [stats] = await tx
      .select({
        pending: sql<number>`count(*) filter (where ${W.state} = 'pending')::int`,
        failed: sql<number>`count(*) filter (where ${W.state} = 'failed')::int`,
        lastSentAt: sql<string | null>`max(${W.sentAt})`,
      })
      .from(W)
      .where(eq(W.clientId, row.id));
    const [service] = row.serviceUserId
      ? await tx
          .select({ id: U.id, name: U.name, active: U.active })
          .from(U)
          .where(eq(U.id, row.serviceUserId))
      : [];
    const roles = service
      ? await tx
          .select({ id: schema.roles.id, name: schema.roles.name })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.userRoles.userId, service.id))
      : [];
    const allowedRoles = row.allowedRoleIds.length
      ? await tx
          .select({ id: schema.roles.id, name: schema.roles.name })
          .from(schema.roles)
          .where(inArray(schema.roles.id, row.allowedRoleIds))
      : [];
    return {
      ...rest,
      hasWebhookSecret: Boolean(webhookSecretEnc),
      serviceUser: service ? { ...service, roles } : null,
      allowedRoles,
      deliveries: stats ?? { pending: 0, failed: 0, lastSentAt: null },
      discoveryUrl: `${this.config.apiOrigin}/.well-known/openid-configuration`,
    };
  }
}
