import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, gt, isNull, schema, sql, type Db } from "@erp/db";
import { ALL_PERMISSIONS, type acceptInviteSchema, type LoginInput, type SignupInput } from "@erp/shared";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { CONFIG, type AppConfig } from "../config.js";
import { decrypt, encrypt, issueTenantToken, parseTenantToken } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { seedTenant } from "../tenancy/tenant-setup.js";
import { UsersService } from "../users/users.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateSecret, otpauthUrl, verifyTotp } from "./totp.js";

export interface TokenClaims {
  sub: string;
  tid: string;
}

export interface Session {
  token: string;
  refreshToken: string;
  expiresIn: string;
}

export interface Principal {
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  permissions: string[];
  companies: { id: string; code: string; name: string; isDefault: boolean }[];
}

const MINUTE = 60_000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Daftarkan tenant baru beserta perusahaan holding dan user admin pertama. */
  async signup(input: SignupInput, ip: string): Promise<Session> {
    this.limiter.consume(`signup:${ip}`, 10, 60 * MINUTE);
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
      const user = await this.users.create(tx as unknown as Db, {
        name: input.name,
        email: input.email,
        passwordHash,
        roleIds: [seeded.adminRoleId],
        companyIds: [seeded.companyId],
      });
      return { tenantId: tenant.id, userId: user.id };
    });
    return this.tenantDb.runAs(tenantId, (tx) => this.issueSession(tx, { sub: userId, tid: tenantId }));
  }

  async login(input: LoginInput, ip: string): Promise<Session> {
    // Batas per akun mencegah tebak password terarah; batas per IP mencegah penyisiran banyak akun.
    const accountKey = `login:${input.tenantSlug}:${input.email}`;
    this.limiter.consume(`login-ip:${ip}`, 50, 15 * MINUTE);
    this.limiter.consume(accountKey, 10, 15 * MINUTE);

    const invalid = new UnauthorizedException("Tenant, email, atau password salah");
    const tenantId = await this.tenantIdBySlug(input.tenantSlug);
    if (!tenantId) throw invalid;

    const session = await this.tenantDb.runAs(tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.email, input.email), eq(schema.users.active, true)));
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw invalid;

      if (user.totpEnabled) {
        if (!input.code) {
          throw new UnauthorizedException({
            statusCode: 401,
            message: "Masukkan kode 2FA",
            twoFactorRequired: true,
          });
        }
        await this.consumeTotp(tx, user, input.code);
      }
      return this.issueSession(tx, { sub: user.id, tid: tenantId });
    });
    this.limiter.reset(accountKey);
    return session;
  }

  /** Tukar refresh token dengan sesi baru (rotasi). Token lama yang dipakai ulang mencabut seluruh keluarganya. */
  async refresh(refreshToken: string, ip: string): Promise<Session> {
    this.limiter.consume(`refresh:${ip}`, 60, 15 * MINUTE);
    const invalid = new UnauthorizedException("Sesi berakhir, silakan masuk lagi");
    const parsed = parseTenantToken(refreshToken);
    if (!parsed) throw invalid;

    const result = await this.tenantDb.runAs(parsed.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, parsed.hash))
        .for("update");
      if (!row) return undefined;
      if (row.revokedAt) {
        await this.revokeFamily(tx, row.familyId);
        return "reused" as const;
      }
      if (row.expiresAt <= new Date()) return undefined;
      const [user] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.id, row.userId), eq(schema.users.active, true)));
      if (!user) return undefined;

      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(eq(schema.refreshTokens.id, row.id));
      return this.issueSession(tx, { sub: row.userId, tid: parsed.tenantId }, row.familyId);
    });
    // Pencabutan keluarga token harus tetap tersimpan, jadi error dilempar di luar transaksi.
    if (!result || result === "reused") throw invalid;
    return result;
  }

  async logout(refreshToken: string) {
    const parsed = parseTenantToken(refreshToken);
    if (!parsed) return;
    await this.tenantDb.runAs(parsed.tenantId, async (tx) => {
      const [row] = await tx
        .select({ familyId: schema.refreshTokens.familyId })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, parsed.hash));
      if (row) await this.revokeFamily(tx, row.familyId);
    });
  }

  // ---- 2FA ----

  /** Buat secret TOTP baru (belum aktif sampai dikonfirmasi dengan kode). */
  async setupTotp(userId: string) {
    const secret = generateSecret();
    return this.tenantDb.run(async (tx) => {
      const [user] = await tx
        .update(schema.users)
        .set({ totpSecretEnc: encrypt(secret, this.config.encryptionKey), totpLastStep: null })
        .where(and(eq(schema.users.id, userId), eq(schema.users.totpEnabled, false)))
        .returning({ email: schema.users.email });
      if (!user) throw new ConflictException("2FA sudah aktif; nonaktifkan dulu untuk membuat secret baru");
      return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
    });
  }

  async enableTotp(userId: string, code: string) {
    await this.tenantDb.run(async (tx) => {
      const user = await this.userForTotp(tx, userId);
      if (!user.totpSecretEnc) throw new BadRequestException("Jalankan setup 2FA terlebih dahulu");
      await this.consumeTotp(tx, user, code);
      await tx.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, userId));
    });
  }

  async disableTotp(userId: string, code: string) {
    await this.tenantDb.run(async (tx) => {
      const user = await this.userForTotp(tx, userId);
      if (!user.totpEnabled) throw new BadRequestException("2FA belum aktif");
      await this.consumeTotp(tx, user, code);
      await tx
        .update(schema.users)
        .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null })
        .where(eq(schema.users.id, userId));
    });
  }

  // ---- Undangan ----

  /** Info publik undangan untuk halaman terima undangan. */
  async invitationInfo(token: string) {
    const parsed = parseTenantToken(token);
    if (!parsed) throw new GoneException("Undangan tidak valid atau sudah kedaluwarsa");
    const [tenant] = await this.ownerDb
      .select({ slug: schema.tenants.slug, name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, parsed.tenantId));
    const invitation =
      tenant && (await this.tenantDb.runAs(parsed.tenantId, (tx) => this.pendingInvitation(tx, parsed.hash)));
    if (!invitation) throw new GoneException("Undangan tidak valid atau sudah kedaluwarsa");
    return {
      email: invitation.email,
      name: invitation.name,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    };
  }

  async acceptInvitation(input: z.infer<typeof acceptInviteSchema>, ip: string): Promise<Session> {
    this.limiter.consume(`invite:${ip}`, 20, 15 * MINUTE);
    const parsed = parseTenantToken(input.token);
    if (!parsed) throw new GoneException("Undangan tidak valid atau sudah kedaluwarsa");
    const passwordHash = await hashPassword(input.password);
    return this.tenantDb.runAs(parsed.tenantId, async (tx) => {
      const invitation = await this.pendingInvitation(tx, parsed.hash, true);
      if (!invitation) throw new GoneException("Undangan tidak valid atau sudah kedaluwarsa");
      const user = await this.users.create(tx, {
        name: invitation.name,
        email: invitation.email,
        passwordHash,
        roleIds: invitation.roleIds,
        companyIds: invitation.companyIds,
      });
      await tx
        .update(schema.invitations)
        .set({ acceptedAt: sql`now()` })
        .where(eq(schema.invitations.id, invitation.id));
      return this.issueSession(tx, { sub: user.id, tid: parsed.tenantId });
    });
  }

  // ---- Token & principal ----

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
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          totpEnabled: schema.users.totpEnabled,
        })
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
        twoFactorEnabled: user.totpEnabled,
        permissions,
        companies,
      };
    });
  }

  private async issueSession(tx: Db, claims: TokenClaims, familyId: string = randomUUID()): Promise<Session> {
    const token = await new SignJWT({ tid: claims.tid })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(this.config.accessTtl)
      .sign(this.config.jwtSecret);
    const refresh = issueTenantToken(claims.tid);
    await tx.insert(schema.refreshTokens).values({
      userId: claims.sub,
      familyId,
      tokenHash: refresh.hash,
      expiresAt: new Date(Date.now() + this.config.refreshTtlDays * 24 * 60 * MINUTE),
    });
    return { token, refreshToken: refresh.token, expiresIn: this.config.accessTtl };
  }

  private async revokeFamily(tx: Db, familyId: string) {
    await tx
      .update(schema.refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)));
  }

  private async tenantIdBySlug(slug: string): Promise<string | undefined> {
    const [tenant] = await this.ownerDb
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug));
    return tenant?.id;
  }

  private async userForTotp(tx: Db, userId: string) {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new UnauthorizedException();
    return user;
  }

  /** Verifikasi kode TOTP dan catat step-nya agar kode tidak bisa dipakai ulang. */
  private async consumeTotp(tx: Db, user: typeof schema.users.$inferSelect, code: string) {
    this.limiter.consume(`totp:${user.id}`, 10, 15 * MINUTE);
    const secret = user.totpSecretEnc && decrypt(user.totpSecretEnc, this.config.encryptionKey);
    const step = secret ? verifyTotp(secret, code, user.totpLastStep) : undefined;
    if (step === undefined) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Kode 2FA salah",
        twoFactorRequired: true,
      });
    }
    await tx.update(schema.users).set({ totpLastStep: step }).where(eq(schema.users.id, user.id));
  }

  private async pendingInvitation(tx: Db, hash: string, lock = false) {
    const query = tx
      .select()
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.tokenHash, hash),
          isNull(schema.invitations.acceptedAt),
          gt(schema.invitations.expiresAt, sql`now()`),
        ),
      );
    const [row] = await (lock ? query.for("update") : query);
    return row;
  }
}
