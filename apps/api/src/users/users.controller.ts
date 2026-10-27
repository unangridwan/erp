import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { and, asc, desc, eq, isNull, schema, sql, type Db } from "@erp/db";
import { employeeInviteSchema, inviteSchema, userCreateSchema } from "@erp/shared";
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
          and(
            eq(schema.users.active, true),
            eq(schema.users.kind, "human"),
            eq(schema.userCompanies.companyId, currentContext().companyId),
          ),
        )
        .orderBy(asc(schema.users.name)),
    );
  }

  /** Pilihan peran (id & nama) untuk penyetuju berbasis peran. Tanpa daftar hak. */
  @Get("roles/options")
  roleOptions() {
    return this.tenantDb.run((tx) =>
      tx
        .select({ id: schema.roles.id, name: schema.roles.name })
        .from(schema.roles)
        .orderBy(asc(schema.roles.name)),
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
        .where(eq(schema.users.kind, "human"))
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

  /**
   * Undang karyawan ke portal (email kerja, atau email pribadi bila kosong). Bila email sudah dipakai user di tenant
   * ini, karyawan langsung ditautkan ke user tersebut; selain itu undangan dikirim dan akun ditautkan saat diterima.
   */
  @Post("employees/:id/invite")
  @RequirePermission("user.write")
  async inviteEmployee(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(employeeInviteSchema, body ?? {});
    const { tenantId, userId, companyId } = currentContext();
    const { token, hash } = issueTenantToken(tenantId);
    const result = await this.tenantDb.run(async (tx) => {
      const E = schema.employees;
      const [employee] = await tx
        .select()
        .from(E)
        .where(and(eq(E.id, id), eq(E.companyId, companyId)));
      if (!employee) throw new NotFoundException("Karyawan tidak ditemukan");
      if (employee.userId) throw new BadRequestException("Karyawan sudah punya akun login");
      const email = (input.email ?? employee.workEmail ?? employee.personalEmail)?.toLowerCase();
      if (!email)
        throw new BadRequestException({
          message: "Isi email kerja atau email pribadi karyawan terlebih dahulu",
          errors: [{ path: "workEmail", message: "Email wajib diisi untuk undangan" }],
        });
      const [existing] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      if (existing) {
        await tx
          .update(E)
          .set({ userId: existing.id, updatedAt: sql`now()` })
          .where(eq(E.id, id));
        return { status: "linked" as const, email };
      }
      await assertUserLimit(tx);
      await this.assertRolesDelegable(tx, input.roleIds);
      for (const roleId of input.roleIds) await assertRefsVisible(tx, { roleId: schema.roles }, { roleId });
      // Undangan lama yang belum diterima untuk karyawan ini dibatalkan (diganti yang baru).
      await tx
        .delete(schema.invitations)
        .where(and(eq(schema.invitations.employeeId, id), isNull(schema.invitations.acceptedAt)));
      const [row] = await tx
        .insert(schema.invitations)
        .values({
          name: employee.name,
          email,
          roleIds: input.roleIds,
          companyIds: [employee.companyId],
          employeeId: id,
          tokenHash: hash,
          invitedBy: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        })
        .returning({ expiresAt: schema.invitations.expiresAt });
      await this.activity.log(tx, {
        resModel: "employee",
        resId: id,
        action: "comment",
        message: `Undangan portal dikirim ke ${email}`,
      });
      return { status: "invited" as const, email, expiresAt: row!.expiresAt, name: employee.name };
    });
    if (result.status === "invited") {
      const link = `${this.config.webOrigin}/accept-invite#token=${encodeURIComponent(token)}`;
      await this.mailer.send({
        to: result.email,
        subject: "Undangan portal karyawan",
        text: `Halo ${result.name},\n\nAnda diundang ke portal karyawan. Buka tautan berikut untuk membuat password (berlaku ${INVITE_TTL_DAYS} hari):\n\n${link}\n`,
      });
    }
    return result;
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
