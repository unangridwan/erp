import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { asc, eq, schema } from "@erp/db";
import { userCreateSchema } from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { hashPassword } from "../auth/password.js";
import { assertRefsVisible } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";

@Controller()
export class UsersController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

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
        })
        .from(schema.users)
        .orderBy(asc(schema.users.name));
      const roles = await tx
        .select({ userId: schema.userRoles.userId, code: schema.roles.code })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId));
      return users.map((u) => ({ ...u, roles: roles.filter((r) => r.userId === u.id).map((r) => r.code) }));
    });
  }

  @Post("users")
  @RequirePermission("user.write")
  async create(@Body() body: unknown) {
    const input = parse(userCreateSchema, body);
    const passwordHash = await hashPassword(input.password);
    return this.tenantDb.run(async (tx) => {
      for (const roleId of input.roleIds) await assertRefsVisible(tx, { roleId: schema.roles }, { roleId });
      for (const companyId of input.companyIds) {
        await assertRefsVisible(tx, { companyId: schema.companies }, { companyId });
      }
      const [user] = await tx
        .insert(schema.users)
        .values({ name: input.name, email: input.email, passwordHash })
        .returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });
      if (input.roleIds.length) {
        await tx
          .insert(schema.userRoles)
          .values(input.roleIds.map((roleId) => ({ userId: user!.id, roleId })));
      }
      await tx
        .insert(schema.userCompanies)
        .values(
          input.companyIds.map((companyId, i) => ({ userId: user!.id, companyId, isDefault: i === 0 })),
        );
      await this.activity.log(tx, { resModel: "user", resId: user!.id, action: "create" });
      return user;
    });
  }

  @Get("roles")
  @RequirePermission("user.read")
  roles() {
    return this.tenantDb.run((tx) =>
      tx.select({ id: schema.roles.id, code: schema.roles.code, name: schema.roles.name }).from(schema.roles),
    );
  }
}
