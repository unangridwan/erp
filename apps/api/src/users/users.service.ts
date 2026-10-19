import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@erp/db";
import { assertUserLimit } from "../billing/limits.js";
import { assertRefsVisible } from "../common/crud.js";

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  roleIds: string[];
  companyIds: string[];
}

@Injectable()
export class UsersService {
  /** Buat user beserta role dan akses perusahaan. Perusahaan pertama menjadi default. */
  async create(tx: Db, input: NewUser) {
    await assertUserLimit(tx);
    for (const roleId of input.roleIds) await assertRefsVisible(tx, { roleId: schema.roles }, { roleId });
    for (const companyId of input.companyIds)
      await assertRefsVisible(tx, { companyId: schema.companies }, { companyId });
    const [user] = await tx
      .insert(schema.users)
      .values({ name: input.name, email: input.email, passwordHash: input.passwordHash })
      .returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });
    if (input.roleIds.length) {
      await tx.insert(schema.userRoles).values(input.roleIds.map((roleId) => ({ userId: user!.id, roleId })));
    }
    await tx
      .insert(schema.userCompanies)
      .values(input.companyIds.map((companyId, i) => ({ userId: user!.id, companyId, isDefault: i === 0 })));
    return user!;
  }
}
