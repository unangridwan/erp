import type { INestApplication } from "@nestjs/common";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** Penyedia identitas OpenID tiruan: discovery, JWKS, token endpoint dengan PKCE. */
async function fakeIdp() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<
    string,
    { challenge: string; nonce: string; email: string; verified: boolean; aud: string }
  >();
  let issuer = "";
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const body = new URLSearchParams(raw);
        const grant = codes.get(body.get("code") ?? "");
        const challenge = createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url");
        if (!grant || grant.challenge !== challenge || body.get("client_secret") !== "rahasia-klien")
          return json(400, { error: "invalid_grant" });
        codes.delete(body.get("code")!);
        const idToken = await new SignJWT({
          email: grant.email,
          email_verified: grant.verified,
          name: "Dewi SSO",
          nonce: grant.nonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(issuer)
          .setAudience(grant.aud)
          .setSubject(grant.email)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey as KeyLike);
        json(200, { access_token: "x", token_type: "Bearer", id_token: idToken });
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  /** Simulasikan persetujuan user di IdP: simpan kode untuk URL otorisasi. */
  const authorize = (authUrl: string, email: string, verified = true) => {
    const u = new URL(authUrl);
    const code = Math.random().toString(36).slice(2);
    codes.set(code, {
      challenge: u.searchParams.get("code_challenge")!,
      nonce: u.searchParams.get("nonce")!,
      email,
      verified,
      aud: u.searchParams.get("client_id")!,
    });
    return { code, state: u.searchParams.get("state")! };
  };
  return { issuer, authorize, close: () => new Promise((r) => server.close(r)) };
}

describe.skipIf(!hasDb)("Platform: SSO OpenID Connect", () => {
  let app: INestApplication;
  let idp: Awaited<ReturnType<typeof fakeIdp>>;
  let a: Awaited<ReturnType<typeof signup>>;
  let staffRole: string;
  let companyId: string;
  beforeAll(async () => {
    idp = await fakeIdp();
    app = await createApp();
    a = await signup(app, "sso");
    staffRole = (await a.get("/roles").expect(200)).body.find((r: { code: string }) => r.code !== "admin").id;
    companyId = (await a.get("/auth/me").expect(200)).body.activeCompanyId;
  });
  afterAll(async () => {
    await app?.close();
    await idp?.close();
  });

  const http = () => request(app.getHttpServer());
  /** Jalankan alur lengkap: start → IdP → callback; kembalikan respons callback. */
  const flow = async (email: string, opts: { verified?: boolean; cookie?: boolean } = {}) => {
    const start = await http().get(`/auth/sso/start/${a.slug}`).expect(302);
    const cookie = start.headers["set-cookie"]?.[0]?.split(";")[0];
    const { code, state } = idp.authorize(start.headers.location!, email, opts.verified ?? true);
    const req = http().get(`/auth/sso/callback?code=${code}&state=${encodeURIComponent(state)}`);
    if (opts.cookie !== false && cookie) req.set("Cookie", cookie);
    return req.expect(302);
  };
  const failure = (res: request.Response) => new URL(res.headers.location!).searchParams.get("ssoError");

  it("konfigurasi: hanya pengelola, secret tidak pernah dikembalikan", async () => {
    expect((await http().get(`/auth/sso/provider?tenant=${a.slug}`).expect(200)).body).toEqual({
      enabled: false,
    });
    await a.put("/auth/sso/config", { issuer: "bukan-url", clientId: "x" }).expect(400);
    await a
      .put("/auth/sso/config", { issuer: idp.issuer, clientId: "erp-app", autoProvision: true })
      .expect(400); // butuh peran bawaan
    const cfg = (
      await a
        .put("/auth/sso/config", {
          label: "Google Workspace",
          issuer: `${idp.issuer}/`,
          clientId: "erp-app",
          clientSecret: "rahasia-klien",
          allowedDomains: ["Contoh.co.id"],
        })
        .expect(200)
    ).body;
    expect(cfg).toMatchObject({
      issuer: idp.issuer,
      allowedDomains: ["contoh.co.id"],
      hasClientSecret: true,
      redirectUri: expect.stringMatching(/\/auth\/sso\/callback$/),
    });
    expect(JSON.stringify(cfg)).not.toContain("rahasia-klien");
    expect((await http().get(`/auth/sso/provider?tenant=${a.slug}`).expect(200)).body).toEqual({
      enabled: true,
      label: "Google Workspace",
      enforce: false,
    });
  });

  it("login SSO: PKCE + nonce + JWKS, user terdaftar dicocokkan lewat email; sesi diserahkan via refresh token", async () => {
    await a
      .post("/users", {
        name: "Dewi",
        email: "dewi@contoh.co.id",
        password: "rahasia123",
        roleIds: [staffRole],
        companyIds: [companyId],
      })
      .expect(201);
    const start = await http().get(`/auth/sso/start/${a.slug}`).expect(302);
    const auth = new URL(start.headers.location!);
    expect(auth.origin + auth.pathname).toBe(`${idp.issuer}/authorize`);
    expect(Object.fromEntries(auth.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "erp-app",
      code_challenge_method: "S256",
      scope: "openid email profile",
    });
    expect(start.headers["set-cookie"]?.[0]).toMatch(/erp_sso=.+HttpOnly; SameSite=Lax/);

    const res = await flow("Dewi@Contoh.co.id");
    const target = new URL(res.headers.location!);
    expect(target.pathname).toBe("/login/sso");
    const refreshToken = new URLSearchParams(target.hash.slice(1)).get("refresh")!;
    const session = (await http().post("/auth/refresh").send({ refreshToken }).expect(200)).body;
    const me = (await client(app, session.token).get("/auth/me").expect(200)).body;
    expect(me).toMatchObject({ email: "dewi@contoh.co.id" });
    // Token dari URL hanya sekali pakai (rotasi).
    await http().post("/auth/refresh").send({ refreshToken }).expect(401);
  });

  it("ditolak: tanpa cookie peramban, email belum diverifikasi, domain lain, user belum terdaftar, state palsu", async () => {
    expect(failure(await flow("dewi@contoh.co.id", { cookie: false }))).toMatch(/peramban SSO tidak cocok/);
    expect(failure(await flow("dewi@contoh.co.id", { verified: false }))).toMatch(/belum diverifikasi/);
    expect(failure(await flow("orang@lain.com"))).toMatch(/Domain lain.com tidak diizinkan/);
    expect(failure(await flow("baru@contoh.co.id"))).toMatch(/belum terdaftar/);
    const bad = await http().get("/auth/sso/callback?code=x&state=palsu").expect(302);
    expect(failure(bad)).toMatch(/tidak valid/);
    expect(failure(await http().get(`/auth/sso/start/tidak-ada`).expect(302))).toMatch(
      /Tenant tidak ditemukan/,
    );
  });

  it("buat user otomatis dengan peran bawaan; SSO wajib menolak login password selain admin", async () => {
    await a
      .put("/auth/sso/config", {
        label: "Google Workspace",
        issuer: idp.issuer,
        clientId: "erp-app",
        allowedDomains: ["contoh.co.id"],
        autoProvision: true,
        defaultRoleId: staffRole,
        enforce: true,
      })
      .expect(200);
    const res = await flow("baru@contoh.co.id"); // secret lama tetap dipakai
    expect(new URL(res.headers.location!).pathname).toBe("/login/sso");
    const users = (await a.get("/users").expect(200)).body;
    expect(users.find((u: { email: string }) => u.email === "baru@contoh.co.id")).toMatchObject({
      name: "Dewi SSO",
    });

    const login = (email: string) =>
      http().post("/auth/login").send({ tenantSlug: a.slug, email, password: "rahasia123" });
    expect((await login("dewi@contoh.co.id").expect(401)).body.message).toMatch(/mewajibkan login lewat SSO/);
    await login("admin@example.com").expect(200); // akses darurat admin
    await a.delete("/auth/sso/config").expect(204);
    await login("dewi@contoh.co.id").expect(200);
  });
});
