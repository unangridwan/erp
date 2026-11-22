import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, schema, sql, type Db } from "@erp/db";
import { normalizeScope, type oauthAuthorizeSchema } from "@erp/shared";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { Principal } from "../auth/auth.service.js";
import { issueTenantToken, parseTenantToken, sha256 } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { CONFIG, type AppConfig } from "../config.js";
import { OidcKeysService } from "./oidc-keys.service.js";

const C = schema.oauthClients;
const CODE_TTL_MS = 2 * 60_000;
const ID_TOKEN_TTL = "1h";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Galat sesuai RFC 6749 (`{ error, error_description }`). */
export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    description: string,
  ) {
    super(description);
  }
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  id_token?: string;
  refresh_token?: string;
}

/** Tenant pemilik client_id (`<tenant_id>.<acak>`). */
export function tenantOfClientId(clientId: string): string | undefined {
  const tenantId = clientId.split(".", 1)[0] ?? "";
  return UUID.test(tenantId) && clientId.length > tenantId.length + 8 ? tenantId : undefined;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** ERP sebagai penyedia login OpenID Connect untuk aplikasi terhubung (authorization code + PKCE, client credentials). */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(OidcKeysService) private readonly keys: OidcKeysService,
  ) {}

  get issuer() {
    return this.config.apiOrigin;
  }

  get webOrigin() {
    return this.config.webOrigin;
  }

  discovery() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.webOrigin}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      userinfo_endpoint: `${this.issuer}/oauth/userinfo`,
      jwks_uri: `${this.issuer}/oauth/jwks`,
      end_session_endpoint: `${this.webOrigin}/oauth/logout`,
      revocation_endpoint: `${this.issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: ["openid", "profile", "email", "employee", "offline_access"],
      claims_supported: [
        "sub",
        "name",
        "preferred_username",
        "email",
        "email_verified",
        "tenant",
        "roles",
        "company_id",
        "company_name",
        "employee_id",
        "employee_number",
        "department",
        "job_title",
      ],
    };
  }

  /** Info publik untuk halaman web `/oauth/authorize` & `/oauth/logout`. */
  async clientInfo(clientId: string, redirectUri?: string, postLogoutRedirectUri?: string) {
    const tenantId = tenantOfClientId(clientId);
    const [tenant] = tenantId
      ? await this.ownerDb
          .select({ slug: schema.tenants.slug, name: schema.tenants.name })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, tenantId))
      : [];
    const client = tenant && (await this.tenantDb.runAs(tenantId!, (tx) => this.activeClient(tx, clientId)));
    if (!client) throw new NotFoundException("Aplikasi tidak ditemukan atau nonaktif");
    if (redirectUri && !client.redirectUris.includes(redirectUri))
      throw new BadRequestException("redirect_uri tidak terdaftar untuk aplikasi ini");
    if (postLogoutRedirectUri && !client.postLogoutRedirectUris.includes(postLogoutRedirectUri))
      throw new BadRequestException("post_logout_redirect_uri tidak terdaftar untuk aplikasi ini");
    return { name: client.name, tenantSlug: tenant.slug, tenantName: tenant.name };
  }

  /** User yang sudah login di web meminta kode otorisasi untuk aplikasi. */
  async authorize(principal: Principal, input: z.infer<typeof oauthAuthorizeSchema>) {
    if (tenantOfClientId(input.clientId) !== principal.tenantId)
      throw new ForbiddenException(
        "Aplikasi ini terdaftar di tenant lain; masuk dengan akun tenant tersebut",
      );
    const scope = normalizeScope(input.scope);
    if (!scope) throw new BadRequestException("scope harus memuat openid");
    const code = issueTenantToken(principal.tenantId);
    await this.tenantDb.run(async (tx) => {
      const client = await this.activeClient(tx, input.clientId);
      if (!client) throw new NotFoundException("Aplikasi tidak ditemukan atau nonaktif");
      if (!client.redirectUris.includes(input.redirectUri))
        throw new BadRequestException("redirect_uri tidak terdaftar untuk aplikasi ini");
      await this.assertMayUse(tx, client, principal.userId);
      await tx.insert(schema.oauthCodes).values({
        clientId: client.id,
        userId: principal.userId,
        companyId: principal.companyId ?? null,
        codeHash: code.hash,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        nonce: input.nonce ?? null,
        scope,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
    });
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", code.token);
    if (input.state) url.searchParams.set("state", input.state);
    url.searchParams.set("iss", this.issuer);
    return { redirectTo: url.toString() };
  }

  /** Endpoint token (RFC 6749): authorization_code, refresh_token, client_credentials. */
  async token(params: Record<string, string | undefined>, authorization: string | undefined, ip: string) {
    await this.limiter.consume(`oauth-token:${ip}`, 300, 15 * 60_000).catch(() => {
      throw new OAuthError(429, "slow_down", "Terlalu banyak permintaan token");
    });
    const { clientId, secret } = this.clientCredentials(params, authorization);
    const tenantId = tenantOfClientId(clientId);
    if (!tenantId) throw new OAuthError(401, "invalid_client", "Client tidak dikenal");
    const result = await this.tenantDb.runAs(tenantId, async (tx) => {
      const client = await this.activeClient(tx, clientId);
      if (!client || !safeEqual(sha256(secret), client.secretHash))
        throw new OAuthError(401, "invalid_client", "Client ID atau secret salah");
      await tx
        .update(C)
        .set({ lastUsedAt: sql`now()` })
        .where(eq(C.id, client.id));
      switch (params.grant_type) {
        case "authorization_code":
          return this.exchangeCode(tx, tenantId, client, params);
        case "refresh_token":
          return this.exchangeRefresh(tx, tenantId, client, params.refresh_token);
        case "client_credentials":
          return this.serviceToken(tx, tenantId, client);
        default:
          throw new OAuthError(400, "unsupported_grant_type", "grant_type tidak didukung");
      }
    });
    // Pencabutan token karena pemakaian ulang harus tetap tersimpan, jadi galatnya dilempar di luar transaksi.
    if (result instanceof OAuthError) throw result;
    return result;
  }

  async userinfo(authorization: string | undefined) {
    const token = authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException("Butuh access token");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.config.jwtSecret, { algorithms: ["HS256"] }));
    } catch {
      throw new UnauthorizedException("Token tidak valid atau kedaluwarsa");
    }
    if (payload.typ !== "oauth" || typeof payload.sub !== "string" || typeof payload.tid !== "string")
      throw new UnauthorizedException("Token tidak valid atau kedaluwarsa");
    const claims = await this.tenantDb.runAs(payload.tid, (tx) =>
      this.profileClaims(
        tx,
        payload.sub!,
        String(payload.scope ?? "openid"),
        typeof payload.cmp === "string" ? payload.cmp : null,
      ),
    );
    if (!claims) throw new UnauthorizedException("User tidak aktif");
    return { sub: payload.sub, ...claims, tenant: await this.tenantSlug(payload.tid) };
  }

  /** Cabut refresh token (RFC 7009). Selalu sukses agar tidak membocorkan keberadaan token. */
  async revoke(params: Record<string, string | undefined>, authorization: string | undefined) {
    const { clientId, secret } = this.clientCredentials(params, authorization);
    const tenantId = tenantOfClientId(clientId);
    const parsed = params.token ? parseTenantToken(params.token) : undefined;
    if (!tenantId) throw new OAuthError(401, "invalid_client", "Client tidak dikenal");
    await this.tenantDb.runAs(tenantId, async (tx) => {
      const client = await this.activeClient(tx, clientId);
      if (!client || !safeEqual(sha256(secret), client.secretHash))
        throw new OAuthError(401, "invalid_client", "Client ID atau secret salah");
      if (!parsed || parsed.tenantId !== tenantId) return;
      const [row] = await tx
        .select({ familyId: schema.oauthRefreshTokens.familyId })
        .from(schema.oauthRefreshTokens)
        .where(
          and(
            eq(schema.oauthRefreshTokens.tokenHash, parsed.hash),
            eq(schema.oauthRefreshTokens.clientId, client.id),
          ),
        );
      if (row) await this.revokeFamily(tx, row.familyId);
    });
  }

  /**
   * Logout dari aplikasi (RP-initiated logout): cabut refresh token aplikasi milik user (dari id_token_hint) dan
   * kembalikan URL tujuan bila terdaftar. Sesi web ERP dihapus oleh halaman web.
   */
  async logout(input: {
    clientId?: string;
    idTokenHint?: string;
    postLogoutRedirectUri?: string;
    state?: string;
  }) {
    let clientId = input.clientId;
    let userId: string | undefined;
    if (input.idTokenHint) {
      const { key } = await this.keys.signingKey();
      try {
        // Token kedaluwarsa tetap diterima sebagai petunjuk (umum saat logout setelah lama tidak aktif).
        const { payload } = await jwtVerify(input.idTokenHint, key, {
          issuer: this.issuer,
          currentDate: new Date(decodeJwt(input.idTokenHint).iat! * 1000),
        });
        clientId ??= typeof payload.aud === "string" ? payload.aud : undefined;
        if (payload.aud === clientId) userId = payload.sub;
      } catch {
        // Petunjuk tidak valid: abaikan, tetap logout dari ERP.
      }
    }
    const tenantId = clientId ? tenantOfClientId(clientId) : undefined;
    if (!clientId || !tenantId) return { redirectTo: null };
    return this.tenantDb.runAs(tenantId, async (tx) => {
      const client = await this.activeClient(tx, clientId!);
      if (!client) return { redirectTo: null };
      if (userId)
        await tx
          .update(schema.oauthRefreshTokens)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(schema.oauthRefreshTokens.clientId, client.id),
              eq(schema.oauthRefreshTokens.userId, userId),
              isNull(schema.oauthRefreshTokens.revokedAt),
            ),
          );
      if (
        !input.postLogoutRedirectUri ||
        !client.postLogoutRedirectUris.includes(input.postLogoutRedirectUri)
      )
        return { redirectTo: null };
      const url = new URL(input.postLogoutRedirectUri);
      if (input.state) url.searchParams.set("state", input.state);
      return { redirectTo: url.toString() };
    });
  }

  // ---- internal ----

  private clientCredentials(params: Record<string, string | undefined>, authorization: string | undefined) {
    const basic = authorization?.match(/^Basic (.+)$/i)?.[1];
    if (basic) {
      const decoded = Buffer.from(basic, "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i > 0) {
        try {
          return {
            clientId: decodeURIComponent(decoded.slice(0, i)),
            secret: decodeURIComponent(decoded.slice(i + 1)),
          };
        } catch {
          throw new OAuthError(401, "invalid_client", "Header Authorization Basic tidak valid");
        }
      }
    }
    if (params.client_id && params.client_secret)
      return { clientId: params.client_id, secret: params.client_secret };
    throw new OAuthError(401, "invalid_client", "Autentikasi client wajib (client_secret_basic/post)");
  }

  private async activeClient(tx: Db, clientId: string) {
    const [client] = await tx
      .select()
      .from(C)
      .where(and(eq(C.clientId, clientId), eq(C.active, true)));
    return client;
  }

  /** Hanya pengguna aktif (bukan akun layanan) dengan peran yang diizinkan aplikasi. */
  private async assertMayUse(tx: Db, client: typeof C.$inferSelect, userId: string) {
    const [user] = await tx
      .select({ kind: schema.users.kind })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)));
    if (!user || user.kind !== "human")
      throw new ForbiddenException("Akun ini tidak dapat masuk ke aplikasi");
    if (!client.allowedRoleIds.length) return;
    const [role] = await tx
      .select({ id: schema.userRoles.id })
      .from(schema.userRoles)
      .where(
        and(eq(schema.userRoles.userId, userId), inArray(schema.userRoles.roleId, client.allowedRoleIds)),
      )
      .limit(1);
    if (!role)
      throw new ForbiddenException(`Anda tidak diizinkan masuk ke ${client.name}; hubungi administrator`);
  }

  private async exchangeCode(
    tx: Db,
    tenantId: string,
    client: typeof C.$inferSelect,
    params: Record<string, string | undefined>,
  ): Promise<TokenResponse | OAuthError> {
    const invalid = (msg: string) => new OAuthError(400, "invalid_grant", msg);
    if (!params.code || !params.redirect_uri || !params.code_verifier)
      throw new OAuthError(400, "invalid_request", "code, redirect_uri, dan code_verifier wajib");
    const parsed = parseTenantToken(params.code);
    if (!parsed || parsed.tenantId !== tenantId) throw invalid("Kode otorisasi tidak valid");
    const [code] = await tx
      .select()
      .from(schema.oauthCodes)
      .where(eq(schema.oauthCodes.codeHash, parsed.hash))
      .for("update");
    if (!code || code.clientId !== client.id) throw invalid("Kode otorisasi tidak valid");
    if (code.usedAt) {
      // Kode dipakai ulang (kemungkinan bocor): cabut token yang terbit dari kode ini.
      await tx
        .update(schema.oauthRefreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(eq(schema.oauthRefreshTokens.familyId, code.id), isNull(schema.oauthRefreshTokens.revokedAt)),
        );
      return invalid("Kode otorisasi sudah dipakai");
    }
    if (code.expiresAt <= new Date()) throw invalid("Kode otorisasi kedaluwarsa");
    if (code.redirectUri !== params.redirect_uri) throw invalid("redirect_uri tidak cocok");
    if (!safeEqual(s256(params.code_verifier), code.codeChallenge)) throw invalid("code_verifier salah");
    await tx
      .update(schema.oauthCodes)
      .set({ usedAt: sql`now()` })
      .where(eq(schema.oauthCodes.id, code.id));
    return this.userTokens(tx, tenantId, client, {
      userId: code.userId,
      companyId: code.companyId,
      scope: code.scope,
      nonce: code.nonce,
      // Keluarga refresh token = id kode, agar pemakaian ulang kode bisa mencabutnya.
      familyId: code.id,
    });
  }

  private async exchangeRefresh(
    tx: Db,
    tenantId: string,
    client: typeof C.$inferSelect,
    token: string | undefined,
  ): Promise<TokenResponse | OAuthError> {
    const invalid = new OAuthError(400, "invalid_grant", "Refresh token tidak valid atau kedaluwarsa");
    const parsed = token ? parseTenantToken(token) : undefined;
    if (!parsed || parsed.tenantId !== tenantId) throw invalid;
    const R = schema.oauthRefreshTokens;
    const [row] = await tx.select().from(R).where(eq(R.tokenHash, parsed.hash)).for("update");
    if (!row || row.clientId !== client.id) throw invalid;
    if (row.revokedAt) {
      await this.revokeFamily(tx, row.familyId);
      return invalid;
    }
    if (row.expiresAt <= new Date()) throw invalid;
    await tx
      .update(R)
      .set({ revokedAt: sql`now()` })
      .where(eq(R.id, row.id));
    return this.userTokens(tx, tenantId, client, {
      userId: row.userId,
      companyId: row.companyId,
      scope: row.scope,
      nonce: null,
      familyId: row.familyId,
    });
  }

  private async userTokens(
    tx: Db,
    tenantId: string,
    client: typeof C.$inferSelect,
    grant: {
      userId: string;
      companyId: string | null;
      scope: string;
      nonce: string | null;
      familyId: string;
    },
  ): Promise<TokenResponse> {
    const claims = await this.profileClaims(tx, grant.userId, grant.scope, grant.companyId);
    if (!claims) throw new OAuthError(400, "invalid_grant", "User tidak aktif");
    await this.assertMayUse(tx, client, grant.userId).catch(() => {
      throw new OAuthError(400, "invalid_grant", "User tidak lagi diizinkan memakai aplikasi ini");
    });
    const access = await this.accessToken({
      sub: grant.userId,
      tid: tenantId,
      typ: "oauth",
      cid: client.id,
      scope: grant.scope,
      ...(grant.companyId ? { cmp: grant.companyId } : {}),
    });
    const { kid, key } = await this.keys.signingKey();
    const idToken = await new SignJWT({
      ...claims,
      tenant: await this.tenantSlug(tenantId),
      ...(grant.nonce ? { nonce: grant.nonce } : {}),
    })
      .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
      .setIssuer(this.issuer)
      .setAudience(client.clientId)
      .setSubject(grant.userId)
      .setIssuedAt()
      .setExpirationTime(ID_TOKEN_TTL)
      .sign(key);
    const refresh = issueTenantToken(tenantId);
    await tx.insert(schema.oauthRefreshTokens).values({
      clientId: client.id,
      userId: grant.userId,
      companyId: grant.companyId,
      familyId: grant.familyId,
      tokenHash: refresh.hash,
      scope: grant.scope,
      expiresAt: new Date(Date.now() + this.config.refreshTtlDays * 24 * 60 * 60_000),
    });
    return {
      ...access,
      token_type: "Bearer",
      scope: grant.scope,
      id_token: idToken,
      refresh_token: refresh.token,
    };
  }

  /** client_credentials: token akun layanan aplikasi untuk memanggil REST API ERP. */
  private async serviceToken(
    tx: Db,
    tenantId: string,
    client: typeof C.$inferSelect,
  ): Promise<TokenResponse> {
    const [user] = client.serviceUserId
      ? await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.id, client.serviceUserId), eq(schema.users.active, true)))
      : [];
    if (!user) throw new OAuthError(400, "unauthorized_client", "Akun layanan aplikasi tidak aktif");
    const access = await this.accessToken({ sub: user.id, tid: tenantId, typ: "service", cid: client.id });
    return { ...access, token_type: "Bearer", scope: "api" };
  }

  private async accessToken(claims: { sub: string; tid: string; [k: string]: string }) {
    const { sub, ...rest } = claims;
    const access_token = await new SignJWT({ ...rest, jti: randomUUID() })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(this.config.accessTtl)
      .sign(this.config.jwtSecret);
    const { exp, iat } = decodeJwt(access_token);
    return { access_token, expires_in: exp! - iat! };
  }

  /** Klaim profil sesuai scope; undefined bila user tidak aktif. */
  private async profileClaims(tx: Db, userId: string, scope: string, companyId: string | null) {
    const scopes = new Set(scope.split(" "));
    const [user] = await tx
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)));
    if (!user) return undefined;
    const out: Record<string, unknown> = {};
    if (scopes.has("profile")) {
      out.name = user.name;
      out.preferred_username = user.email;
      out.roles = (
        await tx
          .selectDistinct({ code: schema.roles.code })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.userRoles.userId, userId))
      ).map((r) => r.code);
    }
    if (scopes.has("email")) {
      out.email = user.email;
      out.email_verified = true;
    }
    if (scopes.has("employee")) {
      const E = schema.employees;
      const [employee] = await tx
        .select({
          id: E.id,
          number: E.employeeNumber,
          companyId: E.companyId,
          companyName: schema.companies.name,
          department: schema.departments.name,
          job: schema.jobPositions.name,
        })
        .from(E)
        .innerJoin(schema.companies, eq(schema.companies.id, E.companyId))
        .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
        .where(and(eq(E.userId, userId), eq(E.active, true)))
        .orderBy(companyId ? desc(sql`${E.companyId} = ${companyId}`) : asc(E.joinDate), asc(E.joinDate))
        .limit(1);
      Object.assign(out, {
        employee_id: employee?.id ?? null,
        employee_number: employee?.number ?? null,
        company_id: employee?.companyId ?? companyId,
        company_name: employee?.companyName ?? null,
        department: employee?.department ?? null,
        job_title: employee?.job ?? null,
      });
    }
    return out;
  }

  private async tenantSlug(tenantId: string) {
    const [t] = await this.ownerDb
      .select({ slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    return t?.slug ?? null;
  }

  private async revokeFamily(tx: Db, familyId: string) {
    await tx
      .update(schema.oauthRefreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(eq(schema.oauthRefreshTokens.familyId, familyId), isNull(schema.oauthRefreshTokens.revokedAt)),
      );
  }
}
