import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { and, eq, schema, sql, type Db } from "@erp/db";
import { ALL_PERMISSIONS, type LoginInput, type SignupInput } from "@erp/shared";
import { SignJWT, jwtVerify } from "jose";
import { CONFIG, type AppConfig } from "../config.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { seedTenant } from "../tenancy/tenant-setup.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface TokenClaims {
  sub: string;
  tid: string;
}

export interface Principal {
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  permissions: string[];
  companies: { id: string; code: string; name: string; isDefault: boolean }[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  /** Daftarkan tenant baru beserta perusahaan holding dan user admin pertama. */
  async signup(input: SignupInput) {
    const passwordHash = await hashPassword(input.password);
    const { tenantId, userId } = await this.ownerDb.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ slug: input.tenantSlug, name: input.companyName })
        .onConflictDoNothing()
        .returning({ id: schema.tenants.id });
      if (!tenant) throw new ConflictException("Slug tenant sudah dipakai");

      await tx.execute(sql`set local role app_user`);
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
      const seeded = await seedTenant(tx as unknown as Db, input.companyName);
      const [user] = await tx
        .insert(schema.users)
        .values({ email: input.email, name: input.name, passwordHash })
        .returning({ id: schema.users.id });
      await tx.insert(schema.userRoles).values({ userId: user!.id, roleId: seeded.adminRoleId });
      await tx
        .insert(schema.userCompanies)
        .values({ userId: user!.id, companyId: seeded.companyId, isDefault: true });
      return { tenantId: tenant.id, userId: user!.id };
    });
    return { token: await this.issueToken({ sub: userId, tid: tenantId }) };
  }

  async login(input: LoginInput) {
    const invalid = new UnauthorizedException("Tenant, email, atau password salah");
    const [tenant] = await this.ownerDb
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, input.tenantSlug));
    if (!tenant) throw invalid;

    const user = await this.tenantDb.runAs(tenant.id, async (tx) => {
      const [row] = await tx
        .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(and(eq(schema.users.email, input.email), eq(schema.users.active, true)));
      return row;
    });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw invalid;
    return { token: await this.issueToken({ sub: user.id, tid: tenant.id }) };
  }

  issueToken(claims: TokenClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(this.config.jwtTtl)
      .sign(this.config.jwtSecret);
  }

  async verifyToken(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { algorithms: ["HS256"] });
      if (typeof payload.sub !== "string" || typeof payload.tid !== "string")
        throw new Error("klaim tidak lengkap");
      return { sub: payload.sub, tid: payload.tid };
    } catch {
      throw new UnauthorizedException("Token tidak valid atau kedaluwarsa");
    }
  }

  /** Muat user aktif beserta permission dan perusahaan yang boleh diakses. */
  async loadPrincipal(claims: TokenClaims): Promise<Principal | undefined> {
    return this.tenantDb.runAs(claims.tid, async (tx) => {
      const [user] = await tx
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(and(eq(schema.users.id, claims.sub), eq(schema.users.active, true)));
      if (!user) return undefined;

      const perms = await tx
        .selectDistinct({ permission: schema.rolePermissions.permission })
        .from(schema.rolePermissions)
        .innerJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.rolePermissions.roleId))
        .where(eq(schema.userRoles.userId, user.id));
      const permissions = perms.map((p) => p.permission);

      const assigned = await tx
        .select({ companyId: schema.userCompanies.companyId, isDefault: schema.userCompanies.isDefault })
        .from(schema.userCompanies)
        .where(eq(schema.userCompanies.userId, user.id));
      const defaults = new Set(assigned.filter((a) => a.isDefault).map((a) => a.companyId));
      const allowed = new Set(assigned.map((a) => a.companyId));

      // Admin ('*') otomatis dapat mengakses semua perusahaan dalam grup.
      const companies = (
        await tx
          .select({ id: schema.companies.id, code: schema.companies.code, name: schema.companies.name })
          .from(schema.companies)
          .where(eq(schema.companies.active, true))
          .orderBy(schema.companies.code)
      )
        .filter((c) => permissions.includes(ALL_PERMISSIONS) || allowed.has(c.id))
        .map((c) => ({ ...c, isDefault: defaults.has(c.id) }));

      return {
        tenantId: claims.tid,
        userId: user.id,
        name: user.name,
        email: user.email,
        permissions,
        companies,
      };
    });
  }
}
