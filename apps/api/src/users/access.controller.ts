import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, count, desc, eq, inArray, ne, schema, sql, type Db } from "@erp/db";
import {
  ALL_PERMISSIONS,
  ADMIN_ONLY_PERMISSIONS,
  PERMISSION_CATALOG,
  ROLE_TEMPLATES,
  canDelegate,
  effectivePermissions,
  moduleLevels,
  roleSchema,
  userOverridesSchema,
  userRolesSchema,
  userUpdateSchema,
} from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { AuthService } from "../auth/auth.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";

const R = schema.roles;
const RP = schema.rolePermissions;
const UR = schema.userRoles;
const UO = schema.userPermissionOverrides;
const U = schema.users;
const UC = schema.userCompanies;

const isAdmin = (perms: readonly string[]) => perms.includes(ALL_PERMISSIONS);

/** Aturan akses: delegasi admin (anti eskalasi), admin terakhir, audit & notifikasi perubahan hak. */
@Injectable()
export class AccessService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Pemberi (user saat ini) boleh memberi/mencabut semua kode ini? */
  assertDelegable(codes: Iterable<string>) {
    const perms = currentContext().permissions;
    const blocked = [...new Set(codes)].filter((c) => !canDelegate(perms, c));
    if (blocked.length)
      throw new ForbiddenException(
        `Anda tidak dapat memberi atau mencabut hak yang tidak Anda miliki: ${blocked.slice(0, 5).join(", ")}`,
      );
  }

  async rolePermissions(tx: Db, roleIds: string[]) {
    if (!roleIds.length) return new Map<string, string[]>();
    const rows = await tx.select().from(RP).where(inArray(RP.roleId, roleIds));
    const map = new Map<string, string[]>(roleIds.map((id) => [id, []]));
    for (const r of rows) map.get(r.roleId)?.push(r.permission);
    return map;
  }

  async user(tx: Db, id: string) {
    const [user] = await tx
      .select({
        id: U.id,
        name: U.name,
        email: U.email,
        active: U.active,
        twoFactorEnabled: U.totpEnabled,
        lastLoginAt: U.lastLoginAt,
      })
      .from(U)
      .where(eq(U.id, id));
    if (!user) throw new NotFoundException("User tidak ditemukan");
    return user;
  }

  /**
   * Admin terdelegasi tidak boleh mengubah akun yang hak efektifnya (di perusahaan aktif) melebihi haknya sendiri,
   * dan tidak ada yang boleh mengubah hak/status akunnya sendiri.
   */
  async assertCanManage(tx: Db, targetId: string) {
    const ctx = currentContext();
    if (targetId === ctx.userId)
      throw new ForbiddenException("Hak akses dan status akun sendiri tidak dapat diubah sendiri");
    if (isAdmin(ctx.permissions)) return;
    const target = effectivePermissions(await this.auth.accessGrants(tx, targetId), ctx.companyId);
    const held = new Set(ctx.permissions);
    if (target.some((p) => !held.has(p)))
      throw new ForbiddenException(
        "Akun ini memiliki hak di atas hak Anda; hanya admin penuh yang dapat mengubahnya",
      );
  }

  /** Minimal satu pengguna aktif tetap admin penuh di semua perusahaan. */
  async assertAdminRemains(tx: Db) {
    const [row] = await tx
      .select({ n: sql<number>`count(distinct ${UR.userId})::int` })
      .from(UR)
      .innerJoin(RP, eq(RP.roleId, UR.roleId))
      .innerJoin(U, eq(U.id, UR.userId))
      .where(and(eq(RP.permission, ALL_PERMISSIONS), sql`${UR.companyId} is null`, eq(U.active, true)));
    if (!row?.n) throw new BadRequestException("Harus ada minimal satu administrator aktif");
  }

  async log(tx: Db, userId: string, message: string, changes?: unknown) {
    await this.activity.log(tx, {
      resModel: "user_access",
      resId: userId,
      action: "update",
      message,
      changes,
    });
  }

  async notify(tx: Db, userId: string, body: string) {
    const ctx = currentContext();
    await tx.insert(schema.notifications).values({
      companyId: ctx.companyId,
      userId,
      kind: "access_changed",
      title: "Hak akses Anda diperbarui",
      body,
      link: "/settings/security",
    });
  }

  /** Hak efektif per perusahaan yang boleh diakses + sumber tiap hak (peran / hak khusus). */
  async access(tx: Db, userId: string) {
    const grants = await this.auth.accessGrants(tx, userId);
    const assignments = await tx
      .select({ id: UR.id, roleId: UR.roleId, companyId: UR.companyId, roleName: R.name })
      .from(UR)
      .innerJoin(R, eq(R.id, UR.roleId))
      .where(eq(UR.userId, userId));
    const perms = await this.rolePermissions(
      tx,
      assignments.map((a) => a.roleId),
    );
    const globalAdmin = assignments.some(
      (a) => a.companyId === null && perms.get(a.roleId)?.includes(ALL_PERMISSIONS),
    );
    const companies = await tx
      .select({ id: schema.companies.id, code: schema.companies.code, name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.active, true))
      .orderBy(asc(schema.companies.code));
    const allowed = new Set(
      (await tx.select({ companyId: UC.companyId }).from(UC).where(eq(UC.userId, userId))).map(
        (r) => r.companyId,
      ),
    );
    return companies
      .filter((c) => globalAdmin || allowed.has(c.id))
      .map((c) => {
        const permissions = effectivePermissions(grants, c.id);
        const sources: Record<string, string[]> = {};
        const add = (codes: string[], source: string) => {
          for (const code of codes) (sources[code] ??= []).push(source);
        };
        for (const a of assignments)
          if (a.companyId === null || a.companyId === c.id)
            add(
              effectivePermissions(
                { roles: [{ permissions: perms.get(a.roleId) ?? [], companyId: null }], overrides: [] },
                c.id,
              ),
              `role:${a.roleName}`,
            );
        for (const o of grants.overrides.filter(
          (x) => x.effect === "grant" && (x.companyId === null || x.companyId === c.id),
        ))
          add(
            effectivePermissions(
              { roles: [], overrides: [{ permission: o.permission, effect: "grant", companyId: null }] },
              c.id,
            ),
            `grant:${o.permission}`,
          );
        const denied = grants.overrides
          .filter((x) => x.effect === "deny" && (x.companyId === null || x.companyId === c.id))
          .map((x) => x.permission);
        return { company: c, permissions, sources, denied };
      });
  }
}

/** Katalog hak & templat peran untuk matriks UI. */
@Controller("permissions")
export class PermissionsController {
  @Get("catalog")
  @RequirePermission("user.read")
  catalog() {
    return {
      modules: PERMISSION_CATALOG.map((m) => ({ ...m, levels: moduleLevels(m.key) })),
      adminOnly: [...ADMIN_ONLY_PERMISSIONS],
      templates: ROLE_TEMPLATES,
    };
  }
}

@Controller("roles")
export class RolesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  @RequirePermission("user.read")
  list() {
    return this.tenantDb.run(async (tx) => {
      const roles = await tx.select().from(R).orderBy(desc(R.isSystem), asc(R.name));
      const perms = await this.access.rolePermissions(
        tx,
        roles.map((r) => r.id),
      );
      const users = await tx
        .select({ roleId: UR.roleId, n: sql<number>`count(distinct ${UR.userId})::int` })
        .from(UR)
        .groupBy(UR.roleId);
      const counts = new Map(users.map((u) => [u.roleId, u.n]));
      return roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: perms.get(r.id) ?? [],
        userCount: counts.get(r.id) ?? 0,
      }));
    });
  }

  @Get(":id")
  @RequirePermission("user.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const role = await this.find(tx, id);
      const perms = await this.access.rolePermissions(tx, [id]);
      const users = await tx
        .select({ id: U.id, name: U.name, email: U.email, companyId: UR.companyId })
        .from(UR)
        .innerJoin(U, eq(U.id, UR.userId))
        .where(eq(UR.roleId, id))
        .orderBy(asc(U.name));
      return { ...role, permissions: perms.get(id) ?? [], users };
    });
  }

  @Post()
  @RequirePermission("role.manage")
  create(@Body() body: unknown) {
    const input = parse(roleSchema, body);
    this.access.assertDelegable(input.permissions);
    return this.tenantDb.run(async (tx) => {
      await this.assertCodeFree(tx, input.code);
      const [role] = await tx
        .insert(R)
        .values({ code: input.code, name: input.name, description: input.description ?? null })
        .returning();
      await this.setPermissions(tx, role!.id, input.permissions);
      await this.activity.log(tx, {
        resModel: "role",
        resId: role!.id,
        action: "create",
        changes: input.permissions,
      });
      return { ...role!, permissions: [...new Set(input.permissions)] };
    });
  }

  @Put(":id")
  @RequirePermission("role.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(roleSchema, body);
    return this.tenantDb.run(async (tx) => {
      const role = await this.find(tx, id);
      const before = (await this.access.rolePermissions(tx, [id])).get(id) ?? [];
      const admin = role.isSystem && before.includes(ALL_PERMISSIONS);
      if (admin && (input.permissions.length !== 1 || input.permissions[0] !== ALL_PERMISSIONS))
        throw new BadRequestException("Hak peran Administrator bawaan tidak dapat diubah");
      if (role.isSystem && input.code !== role.code)
        throw new BadRequestException("Kode peran bawaan tidak dapat diubah");
      const added = input.permissions.filter((p) => !before.includes(p));
      const removed = before.filter((p) => !input.permissions.includes(p));
      this.access.assertDelegable([...added, ...removed]);
      if (input.code !== role.code) await this.assertCodeFree(tx, input.code, id);
      await tx
        .update(R)
        .set({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(R.id, id));
      await this.setPermissions(tx, id, input.permissions);
      if (removed.includes(ALL_PERMISSIONS)) await this.access.assertAdminRemains(tx);
      await this.activity.log(tx, {
        resModel: "role",
        resId: id,
        action: "update",
        changes: { added, removed },
      });
      // Pengguna peran ini diberi tahu bila haknya berubah.
      if (added.length || removed.length) {
        const holders = await tx.selectDistinct({ userId: UR.userId }).from(UR).where(eq(UR.roleId, id));
        for (const h of holders)
          if (h.userId !== currentContext().userId)
            await this.access.notify(tx, h.userId, `Hak peran "${input.name}" diperbarui oleh admin.`);
      }
      return this.find(tx, id);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("role.manage")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const role = await this.find(tx, id);
      if (role.isSystem) throw new BadRequestException("Peran bawaan tidak dapat dihapus");
      const [used] = await tx.select({ n: count() }).from(UR).where(eq(UR.roleId, id));
      if (used?.n)
        throw new BadRequestException("Peran masih dipakai pengguna; lepaskan dari pengguna terlebih dahulu");
      this.access.assertDelegable((await this.access.rolePermissions(tx, [id])).get(id) ?? []);
      await tx.delete(R).where(eq(R.id, id));
      await this.activity.log(tx, { resModel: "role", resId: id, action: "delete" });
    });
  }

  private async find(tx: Db, id: string) {
    const [role] = await tx.select().from(R).where(eq(R.id, id));
    if (!role) throw new NotFoundException("Peran tidak ditemukan");
    return role;
  }

  private async assertCodeFree(tx: Db, code: string, exceptId?: string) {
    const [dup] = await tx
      .select({ id: R.id })
      .from(R)
      .where(and(eq(R.code, code), exceptId ? ne(R.id, exceptId) : undefined));
    if (dup)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: [{ path: "code", message: "Kode peran sudah dipakai" }],
      });
  }

  private async setPermissions(tx: Db, roleId: string, permissions: string[]) {
    await tx.delete(RP).where(eq(RP.roleId, roleId));
    const unique = [...new Set(permissions)];
    if (unique.length) await tx.insert(RP).values(unique.map((permission) => ({ roleId, permission })));
  }
}

@Controller("users")
export class UserAccessController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get(":id")
  @RequirePermission("user.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const user = await this.access.user(tx, id);
      const companies = await tx
        .select({ companyId: UC.companyId, isDefault: UC.isDefault, name: schema.companies.name })
        .from(UC)
        .innerJoin(schema.companies, eq(schema.companies.id, UC.companyId))
        .where(eq(UC.userId, id))
        .orderBy(asc(schema.companies.code));
      const roles = await tx
        .select({ id: UR.id, roleId: UR.roleId, roleName: R.name, roleCode: R.code, companyId: UR.companyId })
        .from(UR)
        .innerJoin(R, eq(R.id, UR.roleId))
        .where(eq(UR.userId, id))
        .orderBy(asc(R.name));
      const overrides = await tx.select().from(UO).where(eq(UO.userId, id)).orderBy(asc(UO.permission));
      return { ...user, companies, roles, overrides };
    });
  }

  @Patch(":id")
  @RequirePermission("user.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(userUpdateSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      if (input.companyIds || input.defaultCompanyId) await this.access.assertCanManage(tx, id);
      if (input.name)
        await tx
          .update(U)
          .set({ name: input.name, updatedAt: sql`now()` })
          .where(eq(U.id, id));
      if (input.companyIds) {
        const visible = await tx
          .select({ id: schema.companies.id })
          .from(schema.companies)
          .where(inArray(schema.companies.id, input.companyIds));
        if (visible.length !== new Set(input.companyIds).size)
          throw new BadRequestException("Perusahaan tidak ditemukan");
        const mine = new Set(currentContext().companyIds);
        if (input.companyIds.some((c) => !mine.has(c)))
          throw new ForbiddenException("Tidak dapat memberi akses ke perusahaan yang tidak bisa Anda akses");
        const def = input.defaultCompanyId ?? input.companyIds[0]!;
        if (!input.companyIds.includes(def))
          throw new BadRequestException("Perusahaan default harus termasuk yang dipilih");
        await tx.delete(UC).where(eq(UC.userId, id));
        await tx.insert(UC).values(
          [...new Set(input.companyIds)].map((companyId) => ({
            userId: id,
            companyId,
            isDefault: companyId === def,
          })),
        );
        await this.access.log(tx, id, "Akses perusahaan diubah", {
          companyIds: input.companyIds,
          defaultCompanyId: def,
        });
      } else if (input.defaultCompanyId) {
        const rows = await tx.select().from(UC).where(eq(UC.userId, id));
        if (!rows.some((r) => r.companyId === input.defaultCompanyId))
          throw new BadRequestException("Perusahaan default harus termasuk yang dipilih");
        await tx
          .update(UC)
          .set({ isDefault: sql`${UC.companyId} = ${input.defaultCompanyId}` })
          .where(eq(UC.userId, id));
      }
      return this.access.user(tx, id);
    });
  }

  /** Ganti seluruh penugasan peran (per perusahaan atau semua perusahaan). */
  @Put(":id/roles")
  @RequirePermission("user.write")
  setRoles(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(userRolesSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      await this.access.assertCanManage(tx, id);
      const key = (r: { roleId: string; companyId?: string | null }) => `${r.roleId}:${r.companyId ?? ""}`;
      const wanted = [
        ...new Map(
          input.roles.map((r) => [key(r), { roleId: r.roleId, companyId: r.companyId ?? null }]),
        ).values(),
      ];
      const before = await tx.select().from(UR).where(eq(UR.userId, id));
      const roleIds = [...new Set([...wanted, ...before].map((r) => r.roleId))];
      const known = roleIds.length
        ? await tx.select({ id: R.id, name: R.name }).from(R).where(inArray(R.id, roleIds))
        : [];
      if (wanted.some((w) => !known.some((k) => k.id === w.roleId)))
        throw new BadRequestException("Peran tidak ditemukan");
      const companies = new Set(
        (await tx.select({ companyId: UC.companyId }).from(UC).where(eq(UC.userId, id))).map(
          (r) => r.companyId,
        ),
      );
      if (wanted.some((w) => w.companyId && !companies.has(w.companyId)))
        throw new BadRequestException(
          "Peran per perusahaan hanya untuk perusahaan yang boleh diakses pengguna ini",
        );
      const added = wanted.filter((w) => !before.some((b) => key(b) === key(w)));
      const removed = before.filter((b) => !wanted.some((w) => key(w) === key(b)));
      const perms = await this.access.rolePermissions(tx, roleIds);
      this.access.assertDelegable([...added, ...removed].flatMap((r) => perms.get(r.roleId) ?? []));
      for (const r of removed) await tx.delete(UR).where(eq(UR.id, r.id));
      if (added.length)
        await tx.insert(UR).values(
          added.map((a) => ({
            userId: id,
            roleId: a.roleId,
            companyId: a.companyId,
            createdBy: currentContext().userId,
          })),
        );
      await this.access.assertAdminRemains(tx);
      const name = (roleId: string) => known.find((k) => k.id === roleId)?.name ?? roleId;
      if (added.length || removed.length) {
        await this.access.log(tx, id, "Peran diubah", {
          added: added.map((a) => ({ role: name(a.roleId), companyId: a.companyId })),
          removed: removed.map((r) => ({ role: name(r.roleId), companyId: r.companyId })),
        });
        await this.access.notify(tx, id, "Peran Anda diubah oleh admin.");
      }
      return this.access.access(tx, id);
    });
  }

  /** Ganti seluruh hak khusus akun (tambah/cabut per hak, per perusahaan). */
  @Put(":id/overrides")
  @RequirePermission("user.write")
  setOverrides(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(userOverridesSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      await this.access.assertCanManage(tx, id);
      const key = (o: { permission: string; companyId?: string | null }) =>
        `${o.permission}:${o.companyId ?? ""}`;
      const wanted = [...new Map(input.overrides.map((o) => [key(o), o])).values()];
      const before = await tx.select().from(UO).where(eq(UO.userId, id));
      const changed = [
        ...wanted.filter((w) => !before.some((b) => key(b) === key(w) && b.effect === w.effect)),
        ...before.filter((b) => !wanted.some((w) => key(w) === key(b) && w.effect === b.effect)),
      ];
      this.access.assertDelegable(changed.map((c) => c.permission));
      const companies = new Set(
        (await tx.select({ companyId: UC.companyId }).from(UC).where(eq(UC.userId, id))).map(
          (r) => r.companyId,
        ),
      );
      if (wanted.some((w) => w.companyId && !companies.has(w.companyId)))
        throw new BadRequestException(
          "Hak khusus per perusahaan hanya untuk perusahaan yang boleh diakses pengguna ini",
        );
      await tx.delete(UO).where(eq(UO.userId, id));
      if (wanted.length)
        await tx.insert(UO).values(
          wanted.map((w) => ({
            userId: id,
            permission: w.permission,
            effect: w.effect,
            companyId: w.companyId ?? null,
            note: w.note ?? null,
            createdBy: currentContext().userId,
          })),
        );
      if (changed.length) {
        await this.access.log(tx, id, "Hak khusus diubah", {
          overrides: wanted.map(
            (w) =>
              `${w.effect === "grant" ? "+" : "−"}${w.permission}${w.companyId ? `@${w.companyId}` : ""}`,
          ),
        });
        await this.access.notify(tx, id, "Hak khusus akun Anda diubah oleh admin.");
      }
      return this.access.access(tx, id);
    });
  }

  @Get(":id/access")
  @RequirePermission("user.read")
  effective(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      return this.access.access(tx, id);
    });
  }

  @Get(":id/access-log")
  @RequirePermission("user.read")
  accessLog(@Param("id", ParseUUIDPipe) id: string, @Query("limit") limit?: string) {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: schema.activityLogs.id,
          message: schema.activityLogs.message,
          changes: schema.activityLogs.changes,
          createdAt: schema.activityLogs.createdAt,
          by: U.name,
        })
        .from(schema.activityLogs)
        .leftJoin(U, eq(U.id, schema.activityLogs.userId))
        .where(and(eq(schema.activityLogs.resModel, "user_access"), eq(schema.activityLogs.resId, id)))
        .orderBy(desc(schema.activityLogs.createdAt))
        .limit(Math.min(Math.max(Number(limit) || 50, 1), 200)),
    );
  }

  @Post(":id/deactivate")
  @RequirePermission("user.write")
  async deactivate(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      await this.access.assertCanManage(tx, id);
      await tx
        .update(U)
        .set({ active: false, updatedAt: sql`now()` })
        .where(eq(U.id, id));
      await this.access.assertAdminRemains(tx);
      await this.access.log(tx, id, "Akun dinonaktifkan");
    });
    await this.auth.revokeSessions(id);
    return { active: false };
  }

  @Post(":id/activate")
  @RequirePermission("user.write")
  activate(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      await this.access.assertCanManage(tx, id);
      await tx
        .update(U)
        .set({ active: true, updatedAt: sql`now()` })
        .where(eq(U.id, id));
      await this.access.log(tx, id, "Akun diaktifkan");
      return { active: true };
    });
  }

  @Post(":id/reset-2fa")
  @RequirePermission("user.write")
  resetTwoFactor(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.access.user(tx, id);
      await this.access.assertCanManage(tx, id);
      await tx
        .update(U)
        .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, updatedAt: sql`now()` })
        .where(eq(U.id, id));
      await this.access.log(tx, id, "Verifikasi dua langkah direset");
      return { twoFactorEnabled: false };
    });
  }
}
