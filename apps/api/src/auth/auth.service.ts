import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, gt, isNull, schema, sql, type Db } from "@erp/db";
import {
  ALL_PERMISSIONS,
  effectivePermissions,
  type AccessGrants,
  type acceptInviteSchema,
  type LoginInput,
  type SignupInput,
} from "@erp/shared";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { CONFIG, type AppConfig } from "../config.js";
import { decrypt, encrypt, issueTenantToken, parseTenantToken } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { seedTenant } from "../tenancy/tenant-setup.js";
import { BillingService } from "../billing/billing.service.js";
import { UsersService } from "../users/users.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateSecret, otpauthUrl, verifyTotp } from "./totp.js";

export interface TokenClaims {
  sub: string;
  tid: string;
}

/** Asal permintaan login, dicatat untuk daftar sesi aktif. */
export interface ClientMeta {
  ip: string;
  userAgent: string | null;
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
  platformAdmin: boolean;
  /** Perusahaan aktif (header X-Company-Id atau default); hak efektif dihitung untuk perusahaan ini. */
  companyId: string | undefined;
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
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /** Daftarkan tenant baru beserta perusahaan holding dan user admin pertama. */
  async signup(input: SignupInput, meta: ClientMeta): Promise<Session> {
    await this.limiter.consume(`signup:${meta.ip}`, 10, 60 * MINUTE);
    const passwordHash = await hashPassword(input.password);
    const { tenantId, userId } = await this.ownerDb.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ slug: input.tenantSlug, name: input.companyName })
        .onConflictDoNothing()
        .returning({ id: schema.tenants.id });
      if (!tenant) throw new ConflictException("Slug tenant sudah dipakai");
      await this.billing.startTrial(tx as unknown as Db, tenant.id);

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
    return this.tenantDb.runAs(tenantId, (tx) => this.issueSession(tx, { sub: userId, tid: tenantId }, meta));
  }

  async login(input: LoginInput, meta: ClientMeta): Promise<Session> {
    const ip = meta.ip;
    // Batas per akun mencegah tebak password terarah; batas per IP mencegah penyisiran banyak akun.
    const accountKey = `login:${input.tenantSlug}:${input.email}`;
    await this.limiter.consume(`login-ip:${ip}`, 50, 15 * MINUTE);
    await this.limiter.consume(accountKey, 10, 15 * MINUTE);

    const invalid = new UnauthorizedException("Tenant, email, atau password salah");
    const tenantId = await this.tenantIdBySlug(input.tenantSlug);
    if (!tenantId) throw invalid;

    const session = await this.tenantDb.runAs(tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.email, input.email), eq(schema.users.active, true)));
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw invalid;
      await this.assertPasswordLoginAllowed(tx, user.id);

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
      await tx
        .update(schema.users)
        .set({ lastLoginAt: sql`now()` })
        .where(eq(schema.users.id, user.id));
      return this.issueSession(tx, { sub: user.id, tid: tenantId }, meta);
    });
    await this.limiter.reset(accountKey);
    return session;
  }

  /** Sesi untuk user yang sudah diautentikasi penyedia SSO (2FA ditangani penyedia identitas). */
  async ssoSession(tenantId: string, userId: string, meta: ClientMeta): Promise<Session> {
    return this.tenantDb.runAs(tenantId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ lastLoginAt: sql`now()` })
        .where(eq(schema.users.id, userId));
      return this.issueSession(tx, { sub: userId, tid: tenantId }, meta);
    });
  }

  /** SSO wajib: login password hanya untuk administrator (akses darurat bila penyedia identitas bermasalah). */
  private async assertPasswordLoginAllowed(tx: Db, userId: string) {
    const [sso] = await tx
      .select({ enforce: schema.tenantSso.enforce, active: schema.tenantSso.active })
      .from(schema.tenantSso);
    if (!sso?.enforce || !sso.active) return;
    const [admin] = await tx
      .select({ permission: schema.rolePermissions.permission })
      .from(schema.userRoles)
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
      .where(and(eq(schema.userRoles.userId, userId), eq(schema.rolePermissions.permission, ALL_PERMISSIONS)))
      .limit(1);
    if (!admin) throw new UnauthorizedException("Tenant ini mewajibkan login lewat SSO");
  }

  /** Tukar refresh token dengan sesi baru (rotasi). Token lama yang dipakai ulang mencabut seluruh keluarganya. */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<Session> {
    await this.limiter.consume(`refresh:${meta.ip}`, 60, 15 * MINUTE);
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
      return this.issueSession(tx, { sub: row.userId, tid: parsed.tenantId }, meta, row.familyId);
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

  async acceptInvitation(input: z.infer<typeof acceptInviteSchema>, meta: ClientMeta): Promise<Session> {
    await this.limiter.consume(`invite:${meta.ip}`, 20, 15 * MINUTE);
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
      // Undangan dari data karyawan: tautkan akun baru ke karyawan (bila belum punya akun).
      if (invitation.employeeId)
        await tx
          .update(schema.employees)
          .set({ userId: user.id, updatedAt: sql`now()` })
          .where(and(eq(schema.employees.id, invitation.employeeId), isNull(schema.employees.userId)));
      return this.issueSession(tx, { sub: user.id, tid: parsed.tenantId }, meta);
    });
  }

  // ---- Sesi aktif ----

  /** Sesi login (keluarga refresh token) user yang masih berlaku, terbaru dulu. */
  async sessions(userId: string) {
    return this.tenantDb
      .run((tx) =>
        tx.execute<{
          id: string;
          started_at: string;
          last_used_at: string;
          ip: string | null;
          user_agent: string | null;
        }>(sql`
        select family_id as id, min(created_at) as started_at, max(created_at) as last_used_at,
               (array_agg(ip order by created_at desc))[1] as ip,
               (array_agg(user_agent order by created_at desc))[1] as user_agent
        from refresh_tokens
        where user_id = ${userId}
        group by family_id
        having bool_or(revoked_at is null and expires_at > now())
        order by max(created_at) desc`),
      )
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          startedAt: r.started_at,
          lastUsedAt: r.last_used_at,
          ip: r.ip,
          userAgent: r.user_agent,
        })),
      );
  }

  /** Cabut satu sesi (atau semua bila `familyId` kosong) milik user. */
  async revokeSessions(userId: string, familyId?: string) {
    await this.tenantDb.run((tx) =>
      tx
        .update(schema.refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(schema.refreshTokens.userId, userId),
            isNull(schema.refreshTokens.revokedAt),
            familyId ? eq(schema.refreshTokens.familyId, familyId) : undefined,
          ),
        ),
    );
  }

  // ---- Token & principal ----

  async verifyToken(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { algorithms: ["HS256"] });
      if (typeof payload.sub !== "string" || typeof payload.tid !== "string")
        throw new Error("klaim tidak lengkap");
      // Token portal pelanggan tidak berlaku untuk API internal.
      if (payload.typ === "portal") throw new Error("token portal");
      return { sub: payload.sub, tid: payload.tid };
    } catch {
      throw new UnauthorizedException("Token tidak valid atau kedaluwarsa");
    }
  }

  /**
   * Muat user aktif beserta perusahaan yang boleh diakses dan hak efektifnya di perusahaan aktif (`requestedCompanyId`
   * atau default): peran yang berlaku di perusahaan itu + tambah/cabut hak per akun.
   */
  async loadPrincipal(claims: TokenClaims, requestedCompanyId?: string): Promise<Principal | undefined> {
    return this.tenantDb.runAs(claims.tid, async (tx) => {
      const [user] = await tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          totpEnabled: schema.users.totpEnabled,
          platformAdmin: schema.users.platformAdmin,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, claims.sub), eq(schema.users.active, true)));
      if (!user) return undefined;

      const grants = await this.accessGrants(tx, user.id);
      // Admin ('*') tanpa batas perusahaan otomatis dapat mengakses semua perusahaan dalam grup.
      const globalAdmin = grants.roles.some(
        (r) => r.companyId === null && r.permissions.includes(ALL_PERMISSIONS),
      );

      const assigned = await tx
        .select({ companyId: schema.userCompanies.companyId, isDefault: schema.userCompanies.isDefault })
        .from(schema.userCompanies)
        .where(eq(schema.userCompanies.userId, user.id));
      const defaults = new Set(assigned.filter((a) => a.isDefault).map((a) => a.companyId));
      const allowed = new Set(assigned.map((a) => a.companyId));

      const companies = (
        await tx
          .select({ id: schema.companies.id, code: schema.companies.code, name: schema.companies.name })
          .from(schema.companies)
          .where(eq(schema.companies.active, true))
          .orderBy(schema.companies.code)
      )
        .filter((c) => globalAdmin || allowed.has(c.id))
        .map((c) => ({ ...c, isDefault: defaults.has(c.id) }));

      const companyId = requestedCompanyId || (companies.find((c) => c.isDefault) ?? companies[0])?.id;
      return {
        tenantId: claims.tid,
        userId: user.id,
        name: user.name,
        email: user.email,
        twoFactorEnabled: user.totpEnabled,
        platformAdmin: user.platformAdmin,
        companyId,
        permissions: companyId ? effectivePermissions(grants, companyId) : [],
        companies,
      };
    });
  }

  /** Peran (per perusahaan) & hak khusus per akun milik seorang user. */
  async accessGrants(tx: Db, userId: string): Promise<AccessGrants> {
    const rows = await tx
      .select({
        id: schema.userRoles.id,
        companyId: schema.userRoles.companyId,
        permission: schema.rolePermissions.permission,
      })
      .from(schema.userRoles)
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId));
    const byAssignment = new Map<string, { companyId: string | null; permissions: string[] }>();
    for (const r of rows) {
      const a = byAssignment.get(r.id) ?? { companyId: r.companyId, permissions: [] };
      if (r.permission) a.permissions.push(r.permission);
      byAssignment.set(r.id, a);
    }
    const overrides = await tx
      .select({
        permission: schema.userPermissionOverrides.permission,
        effect: schema.userPermissionOverrides.effect,
        companyId: schema.userPermissionOverrides.companyId,
      })
      .from(schema.userPermissionOverrides)
      .where(eq(schema.userPermissionOverrides.userId, userId));
    return { roles: [...byAssignment.values()], overrides };
  }

  private async issueSession(
    tx: Db,
    claims: TokenClaims,
    meta: ClientMeta,
    familyId: string = randomUUID(),
  ): Promise<Session> {
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
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
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
    await this.limiter.consume(`totp:${user.id}`, 10, 15 * MINUTE);
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
