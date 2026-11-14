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
import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { CONFIG, type AppConfig } from "../config.js";
import { decrypt, encrypt } from "../common/crypto.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { assertPublicUrl, guardedAgentFor, safeFetch } from "../common/safe-fetch.js";
import { currentContext } from "../common/request-context.js";
import { UsersService } from "../users/users.service.js";
import { AuthService, type ClientMeta, type Session } from "./auth.service.js";

type SsoInput = z.infer<typeof ssoConfigSchema>;
type SsoRow = typeof schema.tenantSso.$inferSelect;
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
/**
 * Isi `state` OIDC / `RelayState` SAML (terenkripsi): tenant, PKCE verifier, nonce (OIDC) atau ID AuthnRequest
 * (SAML), dan pengikat cookie peramban.
 */
interface StatePayload {
  tid: string;
  slug: string;
  verifier: string;
  nonce: string;
  bind: string;
  exp: number;
  /** Waktu AuthnRequest dibuat (SAML). */
  iat?: number;
}
/** Hasil verifikasi assertion SAML yang diteruskan ke langkah `finish` (terenkripsi, berumur pendek). */
interface SamlResult {
  tid: string;
  slug: string;
  bind: string;
  email: string;
  name?: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60_000;
const SAML_RESULT_TTL_MS = 60_000;
const EMAIL_ATTRIBUTES = [
  "email",
  "mail",
  "urn:oid:0.9.2342.19200300.100.1.3",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
];
const NAME_ATTRIBUTES = [
  "displayName",
  "urn:oid:2.16.840.1.113730.3.1.241",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  "http://schemas.microsoft.com/identity/claims/displayname",
];

/** Pisahkan teks berisi satu/lebih sertifikat (PEM atau base64 polos) menjadi daftar PEM yang valid. */
export function parseIdpCerts(text: string): string[] {
  const blocks = text.includes("-----BEGIN CERTIFICATE-----")
    ? [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => m[1]!)
    : [text];
  return blocks.map((b) => {
    const body = b.replace(/\s+/g, "");
    const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END CERTIFICATE-----`;
    try {
      new X509Certificate(pem);
    } catch {
      throw new BadRequestException("Sertifikat IdP tidak valid");
    }
    return pem;
  });
}
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

  /** URL penyedia layanan (SP) SAML untuk tenant: entity ID (= URL metadata) dan Assertion Consumer Service. */
  samlUrls(slug: string) {
    const metadataUrl = `${this.config.apiOrigin}/auth/sso/saml/${encodeURIComponent(slug)}/metadata`;
    return { entityId: metadataUrl, metadataUrl, acsUrl: `${this.config.apiOrigin}/auth/sso/saml/acs` };
  }

  async getConfig(tx: Db) {
    const [row] = await tx.select().from(schema.tenantSso);
    const slug = await this.currentSlug();
    const saml = this.samlUrls(slug);
    if (!row) return { redirectUri: this.redirectUri, saml };
    const { clientSecretEnc, ...rest } = row;
    return { ...rest, hasClientSecret: !!clientSecretEnc, redirectUri: this.redirectUri, saml };
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
    if (input.protocol === "oidc") assertPublicUrl(input.issuer);
    const common = {
      label: input.label,
      protocol: input.protocol,
      allowedDomains: input.allowedDomains,
      autoProvision: input.autoProvision,
      defaultRoleId: input.defaultRoleId ?? null,
      enforce: input.enforce,
      active: input.active,
    };
    const values =
      input.protocol === "saml"
        ? {
            ...common,
            issuer: null,
            clientId: null,
            clientSecretEnc: null,
            samlEntryPoint: input.samlEntryPoint,
            samlIdpCert: parseIdpCerts(input.samlIdpCert).join("\n"),
            samlIdpIssuer: input.samlIdpIssuer || null,
            samlEmailAttribute: input.samlEmailAttribute || null,
          }
        : {
            ...common,
            issuer: input.issuer,
            clientId: input.clientId,
            ...(input.clientSecret
              ? { clientSecretEnc: encrypt(input.clientSecret, this.config.encryptionKey) }
              : {}),
            samlEntryPoint: null,
            samlIdpCert: null,
            samlIdpIssuer: null,
            samlEmailAttribute: null,
          };
    const [existing] = await tx.select({ id: schema.tenantSso.id }).from(schema.tenantSso);
    if (existing)
      await tx
        .update(schema.tenantSso)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.tenantSso.id, existing.id));
    else await tx.insert(schema.tenantSso).values(values);
    if (input.protocol === "oidc") this.discovery.delete(input.issuer);
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
    return sso?.active
      ? { enabled: true, label: sso.label, enforce: sso.enforce, protocol: sso.protocol }
      : { enabled: false };
  }

  /** URL otorisasi penyedia identitas + nilai cookie pengikat peramban. */
  async start(slug: string, ip: string): Promise<{ url: string; bind: string }> {
    await this.limiter.consume(`sso-start:${ip}`, 60, 15 * 60_000);
    const tenantId = await this.tenantId(slug);
    if (!tenantId) throw new NotFoundException("Tenant tidak ditemukan");
    const sso = await this.activeSso(tenantId);
    if (sso.protocol === "saml") return this.samlStart(slug, tenantId, sso);
    const { doc } = await this.discover(sso.issuer!);
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
      client_id: sso.clientId!,
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
    const state = this.readState(input.state);
    // Mencegah login CSRF: callback harus datang dari peramban yang memulai alur.
    if (!input.bind || input.bind !== state.bind)
      throw new BadRequestException("Sesi peramban SSO tidak cocok, ulangi login dari halaman masuk");
    const sso = await this.activeSso(state.tid);
    if (sso.protocol !== "oidc") throw new BadRequestException("Permintaan SSO tidak valid");
    const { doc, jwks } = await this.discover(sso.issuer!);

    const res = await safeFetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: this.redirectUri,
        client_id: sso.clientId!,
        ...(sso.clientSecretEnc
          ? { client_secret: decrypt(sso.clientSecretEnc, this.config.encryptionKey) }
          : {}),
        code_verifier: state.verifier,
      }).toString(),
      timeoutMs: 10_000,
    });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !tokens.id_token)
      throw new UnauthorizedException(`Penyedia identitas menolak login (${tokens.error ?? res.status})`);

    let claims: { email?: string; email_verified?: boolean | string; name?: string; nonce?: string };
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, jwks, {
        issuer: doc.issuer,
        audience: sso.clientId!,
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
    return this.signIn(state.tid, state.slug, sso, email, claims.name, meta);
  }

  // ---- SAML 2.0 ----

  private saml(slug: string, sso: SsoRow, expected?: { id: string; iat: number }) {
    const sp = this.samlUrls(slug);
    return new SAML({
      entryPoint: sso.samlEntryPoint!,
      issuer: sp.entityId,
      callbackUrl: sp.acsUrl,
      audience: sp.entityId,
      idpCert: sso.samlIdpCert ? parseIdpCerts(sso.samlIdpCert) : "-",
      ...(sso.samlIdpIssuer ? { idpIssuer: sso.samlIdpIssuer } : {}),
      // Assertion wajib ditandatangani IdP; tanda tangan Response tetap diverifikasi bila ada.
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      acceptedClockSkewMs: 60_000,
      // Tidak memaksa metode autentikasi tertentu (MFA, Kerberos, passkey tetap diterima IdP).
      disableRequestedAuthnContext: true,
      // InResponseTo dicocokkan dengan ID AuthnRequest di RelayState terenkripsi (aman untuk banyak instance API).
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: STATE_TTL_MS,
      ...(expected ? { generateUniqueId: () => expected.id } : {}),
      cacheProvider: {
        saveAsync: async () => null,
        getAsync: async (key: string) =>
          expected && key === expected.id ? new Date(expected.iat).toISOString() : null,
        removeAsync: async () => null,
      },
    });
  }

  private async samlStart(slug: string, tenantId: string, sso: SsoRow) {
    const payload: StatePayload = {
      tid: tenantId,
      slug,
      verifier: "",
      nonce: `_${randomBytes(20).toString("hex")}`,
      bind: b64url(randomBytes(16)),
      exp: Date.now() + STATE_TTL_MS,
      iat: Date.now(),
    };
    const relayState = encrypt(JSON.stringify(payload), this.config.encryptionKey);
    const url = await this.saml(slug, sso, { id: payload.nonce, iat: payload.iat! }).getAuthorizeUrlAsync(
      relayState,
      undefined,
      {},
    );
    return { url, bind: payload.bind };
  }

  /**
   * Assertion Consumer Service: verifikasi tanda tangan, audience, waktu, dan InResponseTo. Sesi belum dibuat di
   * sini (POST lintas situs dari IdP tidak membawa cookie SameSite=Lax); hasilnya diteruskan ke `samlFinish`.
   */
  async samlAcs(input: { SAMLResponse?: string; RelayState?: string }, ip: string) {
    await this.limiter.consume(`sso-callback:${ip}`, 60, 15 * 60_000);
    if (!input.SAMLResponse || !input.RelayState) throw new BadRequestException("Permintaan SSO tidak valid");
    const state = this.readState(input.RelayState);
    const sso = await this.activeSso(state.tid);
    if (sso.protocol !== "saml") throw new BadRequestException("Permintaan SSO tidak valid");
    let profile: Profile | null;
    try {
      ({ profile } = await this.saml(state.slug, sso, {
        id: state.nonce,
        iat: state.iat ?? 0,
      }).validatePostResponseAsync({
        SAMLResponse: input.SAMLResponse,
      }));
    } catch (e) {
      throw new UnauthorizedException(`Respons SAML tidak valid: ${(e as Error).message}`);
    }
    if (!profile) throw new UnauthorizedException("Respons SAML tidak valid: tanpa assertion");
    const attr = (name: string) => {
      const v = profile[name];
      return typeof v === "string"
        ? v
        : Array.isArray(v) && typeof v[0] === "string"
          ? (v[0] as string)
          : undefined;
    };
    const email = (
      (sso.samlEmailAttribute ? attr(sso.samlEmailAttribute) : undefined) ??
      EMAIL_ATTRIBUTES.map(attr).find(Boolean) ??
      (profile.nameID?.includes("@") ? profile.nameID : undefined)
    )
      ?.trim()
      .toLowerCase();
    if (!email) throw new UnauthorizedException("Penyedia identitas tidak mengirim email");
    const name = NAME_ATTRIBUTES.map(attr).find(Boolean);
    const result: SamlResult = {
      tid: state.tid,
      slug: state.slug,
      bind: state.bind,
      email,
      ...(name ? { name } : {}),
      exp: Date.now() + SAML_RESULT_TTL_MS,
    };
    return encrypt(JSON.stringify(result), this.config.encryptionKey);
  }

  /** Langkah akhir SAML (GET dari peramban yang sama): cocokkan cookie pengikat lalu buat sesi. */
  async samlFinish(input: { token: string; bind: string | undefined }, meta: ClientMeta) {
    let result: SamlResult;
    try {
      result = JSON.parse(decrypt(input.token, this.config.encryptionKey)) as SamlResult;
    } catch {
      throw new BadRequestException("Permintaan SSO tidak valid");
    }
    if (result.exp < Date.now()) throw new BadRequestException("Permintaan SSO kedaluwarsa, ulangi login");
    if (!input.bind || input.bind !== result.bind)
      throw new BadRequestException("Sesi peramban SSO tidak cocok, ulangi login dari halaman masuk");
    const sso = await this.activeSso(result.tid);
    if (sso.protocol !== "saml") throw new BadRequestException("Permintaan SSO tidak valid");
    return this.signIn(result.tid, result.slug, sso, result.email, result.name, meta);
  }

  /** Metadata SP untuk diunggah ke IdP (bisa diambil sebelum SAML dikonfigurasi). */
  async samlMetadata(slug: string) {
    const tenantId = await this.tenantId(slug);
    if (!tenantId) throw new NotFoundException("Tenant tidak ditemukan");
    const sso = await this.tenantDb.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.tenantSso)
        .then((r) => r[0]),
    );
    const row = (sso?.protocol === "saml" ? sso : { samlEntryPoint: "https://idp.invalid/sso" }) as SsoRow;
    return this.saml(slug, row).generateServiceProviderMetadata(null, null);
  }

  // ---- Bersama ----

  private readState(raw: string): StatePayload {
    let state: StatePayload;
    try {
      state = JSON.parse(decrypt(raw, this.config.encryptionKey)) as StatePayload;
    } catch {
      throw new BadRequestException("Permintaan SSO tidak valid");
    }
    if (state.exp < Date.now()) throw new BadRequestException("Permintaan SSO kedaluwarsa, ulangi login");
    return state;
  }

  /** Cocokkan email terverifikasi IdP dengan user tenant (atau buat otomatis), lalu buat sesi. */
  private async signIn(
    tid: string,
    slug: string,
    sso: SsoRow,
    email: string,
    name: string | undefined,
    meta: ClientMeta,
  ) {
    const domain = email.split("@")[1] ?? "";
    if (sso.allowedDomains.length && !sso.allowedDomains.includes(domain))
      throw new ForbiddenException(`Domain ${domain} tidak diizinkan untuk tenant ini`);

    const userId = await this.tenantDb.runAs(tid, async (tx) => {
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
        name: name?.trim() || email,
        email,
        passwordHash: null,
        roleIds: [sso.defaultRoleId],
        companyIds: company ? [company.id] : [],
      });
      return created.id;
    });
    const session: Session = await this.auth.ssoSession(tid, userId, meta);
    return { session, slug };
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
      const res = await safeFetch(`${issuer}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = (await res.json()) as Discovery;
    } catch (e) {
      throw new BadRequestException(`Discovery OpenID ${issuer} gagal: ${(e as Error).message}`);
    }
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri)
      throw new BadRequestException("Dokumen discovery OpenID tidak lengkap");
    // Endpoint dari dokumen discovery ikut diperiksa: dokumen itu dikendalikan pihak luar.
    assertPublicUrl(doc.token_endpoint);
    const jwksUrl = assertPublicUrl(doc.jwks_uri);
    const entry = {
      at: Date.now(),
      doc,
      jwks: createRemoteJWKSet(jwksUrl, { agent: guardedAgentFor(jwksUrl) }),
    };
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

  private async currentSlug() {
    const [t] = await this.ownerDb
      .select({ slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, currentContext().tenantId));
    return t?.slug ?? "";
  }
}
