import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { and, asc, desc, eq, isNull, schema, type Db } from "@erp/db";
import { inviteSchema, userCreateSchema } from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { hashPassword } from "../auth/password.js";
import { assertUserLimit } from "../billing/limits.js";
import { assertRefsVisible } from "../common/crud.js";
import { issueTenantToken } from "../common/crypto.js";
import { TenantDb } from "../common/database.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { AccessService } from "./access.controller.js";
import { UsersService } from "./users.service.js";

const INVITE_TTL_DAYS = 7;

@Controller()
export class UsersController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Pilihan user aktif di perusahaan aktif (penanggung jawab lead, penjual). Tanpa data sensitif. */
  @Get("users/options")
  options() {
    return this.tenantDb.run((tx) =>
      tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .innerJoin(schema.userCompanies, eq(schema.userCompanies.userId, schema.users.id))
        .where(
          and(eq(schema.users.active, true), eq(schema.userCompanies.companyId, currentContext().companyId)),
        )
        .orderBy(asc(schema.users.name)),
    );
  }

  @Get("users")
  @RequirePermission("user.read")
  list() {
    return this.tenantDb.run(async (tx) => {
      const users = await tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          active: schema.users.active,
          twoFactorEnabled: schema.users.totpEnabled,
        })
        .from(schema.users)
        .orderBy(asc(schema.users.name));
      const roles = await tx
        .select({ userId: schema.userRoles.userId, name: schema.roles.name })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId));
      return users.map((u) => ({
        ...u,
        roles: [...new Set(roles.filter((r) => r.userId === u.id).map((r) => r.name))],
      }));
    });
  }

  @Post("users")
  @RequirePermission("user.write")
  async create(@Body() body: unknown) {
    const input = parse(userCreateSchema, body);
    const passwordHash = await hashPassword(input.password);
    return this.tenantDb.run(async (tx) => {
      await this.assertRolesDelegable(tx, input.roleIds);
      const user = await this.users.create(tx, { ...input, passwordHash });
      await this.activity.log(tx, { resModel: "user", resId: user.id, action: "create" });
      return user;
    });
  }

  /** Undang user lewat email; user mengatur password sendiri saat menerima undangan. */
  @Post("users/invite")
  @RequirePermission("user.write")
  async invite(@Body() body: unknown) {
    const input = parse(inviteSchema, body);
    const { tenantId, userId } = currentContext();
    const { token, hash } = issueTenantToken(tenantId);
    const invitation = await this.tenantDb.run(async (tx) => {
      await assertUserLimit(tx);
      await this.assertRolesDelegable(tx, input.roleIds);
      for (const roleId of input.roleIds) await assertRefsVisible(tx, { roleId: schema.roles }, { roleId });
      for (const companyId of input.companyIds) {
        await assertRefsVisible(tx, { companyId: schema.companies }, { companyId });
      }
      const [row] = await tx
        .insert(schema.invitations)
        .values({
          ...input,
          tokenHash: hash,
          invitedBy: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        })
        .returning({
          id: schema.invitations.id,
          email: schema.invitations.email,
          name: schema.invitations.name,
          expiresAt: schema.invitations.expiresAt,
        });
      return row!;
    });
    const link = `${this.config.webOrigin}/accept-invite#token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: input.email,
      subject: "Undangan bergabung ke ERP",
      text: `Halo ${input.name},\n\nAnda diundang untuk bergabung. Buka tautan berikut untuk membuat password (berlaku ${INVITE_TTL_DAYS} hari):\n\n${link}\n`,
    });
    return invitation;
  }

  @Get("invitations")
  @RequirePermission("user.read")
  invitations() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: schema.invitations.id,
          email: schema.invitations.email,
          name: schema.invitations.name,
          expiresAt: schema.invitations.expiresAt,
          createdAt: schema.invitations.createdAt,
        })
        .from(schema.invitations)
        .where(and(isNull(schema.invitations.acceptedAt)))
        .orderBy(desc(schema.invitations.createdAt)),
    );
  }

  /** Admin terdelegasi hanya boleh memberi peran yang seluruh haknya ia miliki. */
  private async assertRolesDelegable(tx: Db, roleIds: string[]) {
    const perms = await this.access.rolePermissions(tx, roleIds);
    this.access.assertDelegable([...perms.values()].flat());
  }
}
