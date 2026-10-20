import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, schema, sql, type Db } from "@erp/db";
import type { ssoConfigSchema } from "@erp/shared";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { CONFIG, type AppConfig } from "../config.js";
import { decrypt, encrypt } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { UsersService } from "../users/users.service.js";
import { AuthService, type ClientMeta, type Session } from "./auth.service.js";

type SsoInput = z.infer<typeof ssoConfigSchema>;
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
/** Isi `state` (terenkripsi): tenant, PKCE verifier, nonce, dan pengikat cookie peramban. */
interface StatePayload {
  tid: string;
  slug: string;
  verifier: string;
  nonce: string;
  bind: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60_000;
const b64url = (buf: Buffer) => buf.toString("base64url");
const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

/**
 * SSO OpenID Connect per tenant (authorization code + PKCE). Penyedia identitas apa pun yang mendukung discovery
 * (`/.well-known/openid-configuration`): Google Workspace, Microsoft Entra ID, Keycloak, Okta, dsb. User dicocokkan
 * lewat email terverifikasi; bila diaktifkan, user baru dibuat dengan peran bawaan.
 */
@Injectable()
export class SsoService {
  private readonly discovery = new Map<string, { at: number; doc: Discovery; jwks: JWTVerifyGetKey }>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  get redirectUri() {
    return `${this.config.apiOrigin}/auth/sso/callback`;
  }

  // ---- Pengaturan (admin tenant) ----

  async getConfig(tx: Db) {
    const [row] = await tx.select().from(schema.tenantSso);
    if (!row) return null;
    const { clientSecretEnc, ...rest } = row;
    return { ...rest, hasClientSecret: !!clientSecretEnc, redirectUri: this.redirectUri };
  }

  async saveConfig(tx: Db, input: SsoInput) {
    if (input.defaultRoleId) {
      const [role] = await tx
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.id, input.defaultRoleId));
      if (!role) throw new BadRequestException("Peran bawaan tidak ditemukan");
    }
    if (input.autoProvision && !input.defaultRoleId)
      throw new BadRequestException("Pilih peran bawaan untuk user yang dibuat otomatis");
    const { clientSecret, ...values } = input;
    const secret =
      clientSecret === undefined || clientSecret === null || clientSecret === ""
        ? {}
        : { clientSecretEnc: encrypt(clientSecret, this.config.encryptionKey) };
    const [existing] = await tx.select({ id: schema.tenantSso.id }).from(schema.tenantSso);
    if (existing)
      await tx
        .update(schema.tenantSso)
        .set({ ...values, defaultRoleId: values.defaultRoleId ?? null, ...secret, updatedAt: sql`now()` })
        .where(eq(schema.tenantSso.id, existing.id));
    else
      await tx
        .insert(schema.tenantSso)
        .values({ ...values, defaultRoleId: values.defaultRoleId ?? null, ...secret });
    this.discovery.delete(input.issuer);
    return this.getConfig(tx);
  }

  async deleteConfig(tx: Db) {
    await tx.delete(schema.tenantSso);
  }

  // ---- Alur login ----

  /** Info publik untuk halaman login: apakah tenant memakai SSO. */
  async providerFor(slug: string) {
    const tenantId = await this.tenantId(slug);
    if (!tenantId) return { enabled: false };
    const sso = await this.tenantDb.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.tenantSso)
        .then((r) => r[0]),
    );
    return sso?.active ? { enabled: true, label: sso.label, enforce: sso.enforce } : { enabled: false };
  }

  /** URL otorisasi penyedia identitas + nilai cookie pengikat peramban. */
  async start(slug: string, ip: string): Promise<{ url: string; bind: string }> {
    await this.limiter.consume(`sso-start:${ip}`, 60, 15 * 60_000);
    const tenantId = await this.tenantId(slug);
    if (!tenantId) throw new NotFoundException("Tenant tidak ditemukan");
    const sso = await this.activeSso(tenantId);
    const { doc } = await this.discover(sso.issuer);
    const verifier = b64url(randomBytes(32));
    const payload: StatePayload = {
      tid: tenantId,
      slug,
      verifier,
      nonce: b64url(randomBytes(16)),
      bind: b64url(randomBytes(16)),
      exp: Date.now() + STATE_TTL_MS,
    };
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: sso.clientId,
      redirect_uri: this.redirectUri,
      scope: "openid email profile",
      state: encrypt(JSON.stringify(payload), this.config.encryptionKey),
      nonce: payload.nonce,
      code_challenge: challengeOf(verifier),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), bind: payload.bind };
  }

  /** Tukar kode otorisasi, verifikasi ID token, lalu buat sesi untuk user yang cocok. */
  async callback(input: { code: string; state: string; bind: string | undefined }, meta: ClientMeta) {
    await this.limiter.consume(`sso-callback:${meta.ip}`, 60, 15 * 60_000);
    let state: StatePayload;
    try {
      state = JSON.parse(decrypt(input.state, this.config.encryptionKey)) as StatePayload;
    } catch {
      throw new BadRequestException("Permintaan SSO tidak valid");
    }
    if (state.exp < Date.now()) throw new BadRequestException("Permintaan SSO kedaluwarsa, ulangi login");
    // Mencegah login CSRF: callback harus datang dari peramban yang memulai alur.
    if (!input.bind || input.bind !== state.bind)
      throw new BadRequestException("Sesi peramban SSO tidak cocok, ulangi login dari halaman masuk");
    const sso = await this.activeSso(state.tid);
    const { doc, jwks } = await this.discover(sso.issuer);

    const res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: this.redirectUri,
        client_id: sso.clientId,
        ...(sso.clientSecretEnc
          ? { client_secret: decrypt(sso.clientSecretEnc, this.config.encryptionKey) }
          : {}),
        code_verifier: state.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !tokens.id_token)
      throw new UnauthorizedException(`Penyedia identitas menolak login (${tokens.error ?? res.status})`);

    let claims: { email?: string; email_verified?: boolean | string; name?: string; nonce?: string };
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, jwks, {
        issuer: doc.issuer,
        audience: sso.clientId,
        clockTolerance: 60,
      }));
    } catch (e) {
      throw new UnauthorizedException(`ID token tidak valid: ${(e as Error).message}`);
    }
    if (claims.nonce !== state.nonce) throw new UnauthorizedException("ID token tidak valid (nonce)");
    const email = claims.email?.trim().toLowerCase();
    if (!email) throw new UnauthorizedException("Penyedia identitas tidak mengirim email");
    if (claims.email_verified === false || claims.email_verified === "false")
      throw new UnauthorizedException("Email belum diverifikasi di penyedia identitas");
    const domain = email.split("@")[1] ?? "";
    if (sso.allowedDomains.length && !sso.allowedDomains.includes(domain))
      throw new ForbiddenException(`Domain ${domain} tidak diizinkan untuk tenant ini`);

    const userId = await this.tenantDb.runAs(state.tid, async (tx) => {
      const [user] = await tx
        .select({ id: schema.users.id, active: schema.users.active })
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email}`);
      if (user) {
        if (!user.active) throw new ForbiddenException("Akun dinonaktifkan");
        return user.id;
      }
      if (!sso.autoProvision || !sso.defaultRoleId)
        throw new ForbiddenException(
          `Akun ${email} belum terdaftar di tenant ini; minta admin mengundang Anda`,
        );
      const [company] = await tx
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .orderBy(schema.companies.createdAt)
        .limit(1);
      const created = await this.users.create(tx, {
        name: claims.name?.trim() || email,
        email,
        passwordHash: null,
        roleIds: [sso.defaultRoleId],
        companyIds: company ? [company.id] : [],
      });
      return created.id;
    });
    const session: Session = await this.auth.ssoSession(state.tid, userId, meta);
    return { session, slug: state.slug };
  }

  private async activeSso(tenantId: string) {
    const sso = await this.tenantDb.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.tenantSso)
        .where(and(eq(schema.tenantSso.active, true)))
        .then((r) => r[0]),
    );
    if (!sso) throw new BadRequestException("SSO belum diaktifkan untuk tenant ini");
    return sso;
  }

  /** Dokumen discovery & JWKS, disimpan 1 jam. */
  private async discover(issuer: string) {
    const cached = this.discovery.get(issuer);
    if (cached && Date.now() - cached.at < 3_600_000) return cached;
    let doc: Discovery;
    try {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = (await res.json()) as Discovery;
    } catch (e) {
      throw new BadRequestException(`Discovery OpenID ${issuer} gagal: ${(e as Error).message}`);
    }
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri)
      throw new BadRequestException("Dokumen discovery OpenID tidak lengkap");
    const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
    this.discovery.set(issuer, entry);
    return entry;
  }

  private async tenantId(slug: string) {
    const [t] = await this.ownerDb
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug));
    return t?.id;
  }
}
