import type { INestApplication } from "@nestjs/common";
import { createLocalJWKSet, decodeJwt, jwtVerify, type JSONWebKeySet } from "jose";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_DB } from "../src/common/database.js";
import { CONFIG, type AppConfig } from "../src/config.js";
import { OidcKeysService } from "../src/oauth/oidc-keys.service.js";
import { WebhookService } from "../src/oauth/webhook.service.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const REDIRECT = "http://localhost:4000/api/auth/callback/erp";
const LOGOUT = "http://localhost:4000/";

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Penerima webhook lokal: mencatat request; `status` mengatur kode balasan. */
function receiver() {
  const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const state = { status: 200 };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = state.status;
      res.end("ok");
    });
  });
  return { server, received, state };
}

/** ERP sebagai penyedia login (OIDC), akun layanan API, webhook keluar. */
describe.skipIf(!hasDb)("Aplikasi terhubung (OIDC, akun layanan, webhook)", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let tenantId: string;
  let adminId: string;
  let employeeId: string;
  let hrRole: string;
  let appId: string;
  let clientId: string;
  let clientSecret: string;
  let webhookSecret: string;
  const hook = receiver();
  let hookUrl: string;

  const token = (form: Record<string, string>, basic = true) => {
    const req = request(app.getHttpServer()).post("/oauth/token").type("form");
    if (basic)
      req.set(
        "Authorization",
        `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`,
      );
    return req.send(form);
  };

  const authorize = async (verifier = pkce()) => {
    const res = await a
      .post("/oauth/authorize", {
        clientId,
        redirectUri: REDIRECT,
        responseType: "code",
        scope: "openid profile email employee",
        state: "xyz",
        nonce: "n-123",
        codeChallenge: verifier.challenge,
        codeChallengeMethod: "S256",
      })
      .expect(200);
    const url = new URL(res.body.redirectTo);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("xyz");
    return { code: url.searchParams.get("code")!, verifier: verifier.verifier };
  };

  beforeAll(async () => {
    app = await createApp();
    await new Promise<void>((r) => hook.server.listen(0, "127.0.0.1", r));
    hookUrl = `http://127.0.0.1:${(hook.server.address() as AddressInfo).port}/hook`;
    a = await signup(app, "oauth");
    tenantId = String(decodeJwt(a.token).tid);
    adminId = (await a.get("/auth/me").expect(200)).body.userId;
    hrRole = (
      await a.post("/roles", { code: "hr_reader", name: "Baca SDM", permissions: ["hr.read"] }).expect(201)
    ).body.id;
    employeeId = (
      await a
        .post("/employees", { name: "Admin Karyawan", joinDate: "2024-01-02", userId: adminId })
        .expect(201)
    ).body.id;
    const created = (
      await a
        .post("/connected-apps", {
          name: "Aplikasi Proyek",
          redirectUris: [REDIRECT],
          postLogoutRedirectUris: [LOGOUT],
          serviceRoleIds: [hrRole],
          webhookUrl: hookUrl,
          webhookEvents: ["employee.created", "employee.updated", "employee.archived"],
        })
        .expect(201)
    ).body;
    ({ id: appId, clientId, clientSecret, webhookSecret } = created);
    expect(clientId.startsWith(`${tenantId}.`)).toBe(true);
    expect(created.secretHash).toBeUndefined();
  });
  afterAll(async () => {
    hook.server.close();
    await app?.close();
  });

  it("discovery & JWKS", async () => {
    const d = (await request(app.getHttpServer()).get("/.well-known/openid-configuration").expect(200)).body;
    expect(d.token_endpoint).toBe(`${d.issuer}/oauth/token`);
    expect(d.code_challenge_methods_supported).toEqual(["S256"]);
    const jwks = (await request(app.getHttpServer()).get("/oauth/jwks").expect(200)).body;
    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    expect(jwks.keys[0].d).toBeUndefined();
    // ENCRYPTION_KEY diganti: kunci lama tak terbaca dilewati, kunci baru dibuat; JWKS memuat keduanya.
    const rotated = new OidcKeysService(app.get(OWNER_DB), {
      ...app.get<AppConfig>(CONFIG),
      encryptionKey: randomBytes(24).toString("hex"),
    });
    const { kid } = await rotated.signingKey();
    expect(kid).not.toBe((await app.get(OidcKeysService).signingKey()).kid);
    expect((await rotated.jwks()).keys.map((k) => k.kid)).toContain(kid);
    const info = await request(app.getHttpServer())
      .get(
        `/oauth/client?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT)}`,
      )
      .expect(200);
    expect(info.body).toMatchObject({ name: "Aplikasi Proyek", tenantSlug: a.slug });
    await request(app.getHttpServer())
      .get(`/oauth/client?client_id=${encodeURIComponent(clientId)}&redirect_uri=https://evil.example/cb`)
      .expect(400);
  });

  it("authorization code + PKCE → id_token dengan data karyawan; kode sekali pakai", async () => {
    const p = pkce();
    const base = { clientId, responseType: "code", scope: "openid", codeChallenge: p.challenge };
    await a
      .post("/oauth/authorize", {
        ...base,
        redirectUri: "https://evil.example/cb",
        codeChallengeMethod: "S256",
      })
      .expect(400);
    await a
      .post("/oauth/authorize", { ...base, redirectUri: REDIRECT, codeChallengeMethod: "plain" })
      .expect(400);

    const { code, verifier } = await authorize();
    const wrong = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: pkce().verifier,
    }).expect(400);
    expect(wrong.body.error).toBe("invalid_grant");

    const res = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ token_type: "Bearer", scope: "openid profile email employee" });
    const jwks = (await request(app.getHttpServer()).get("/oauth/jwks")).body as JSONWebKeySet;
    const issuer = (await request(app.getHttpServer()).get("/.well-known/openid-configuration")).body.issuer;
    const { payload } = await jwtVerify(res.body.id_token, createLocalJWKSet(jwks), {
      issuer,
      audience: clientId,
    });
    expect(payload).toMatchObject({
      sub: adminId,
      nonce: "n-123",
      email: "admin@example.com",
      email_verified: true,
      tenant: a.slug,
      employee_id: employeeId,
      roles: ["admin"],
    });

    // Kode dipakai ulang → ditolak dan token yang terbit darinya dicabut.
    await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }).expect(400);
    await token({ grant_type: "refresh_token", refresh_token: res.body.refresh_token }).expect(400);
  });

  it("access token login hanya untuk profil; refresh berotasi; secret salah 401", async () => {
    const { code, verifier } = await authorize();
    const t = (
      await token({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }).expect(200)
    ).body;
    const info = await request(app.getHttpServer())
      .get("/oauth/userinfo")
      .set("Authorization", `Bearer ${t.access_token}`)
      .expect(200);
    expect(info.body).toMatchObject({ sub: adminId, email: "admin@example.com", employee_id: employeeId });
    const asUser = client(app, t.access_token);
    await asUser.get("/auth/me").expect(200);
    await asUser.get("/employees").expect(403);
    // Data gaji & kompensasi tidak pernah untuk aplikasi terhubung, walau scope employee diberikan.
    await asUser.get("/me/payslips").expect(403);
    await asUser.get("/me/total-rewards").expect(403);

    const next = (await token({ grant_type: "refresh_token", refresh_token: t.refresh_token }).expect(200))
      .body;
    expect(next.refresh_token).not.toBe(t.refresh_token);
    // Refresh token lama dipakai ulang → seluruh keluarga dicabut.
    await token({ grant_type: "refresh_token", refresh_token: t.refresh_token }).expect(400);
    await token({ grant_type: "refresh_token", refresh_token: next.refresh_token }).expect(400);

    const bad = await request(app.getHttpServer())
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "client_credentials", client_id: clientId, client_secret: "salah" })
      .expect(401);
    expect(bad.body.error).toBe("invalid_client");
  });

  it("token tanpa scope employee tidak bisa membaca portal karyawan; input rusak → 4xx, bukan 500", async () => {
    const p = pkce();
    const res = await a
      .post("/oauth/authorize", {
        clientId,
        redirectUri: REDIRECT,
        responseType: "code",
        scope: "openid",
        codeChallenge: p.challenge,
        codeChallengeMethod: "S256",
      })
      .expect(200);
    const code = new URL(res.body.redirectTo).searchParams.get("code")!;
    const t = (
      await token({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        code_verifier: p.verifier,
      }).expect(200)
    ).body;
    const asUser = client(app, t.access_token);
    await asUser.get("/auth/me").expect(200);
    await asUser.get("/me/announcements").expect(403);

    const broken = await request(app.getHttpServer())
      .post("/oauth/token")
      .type("form")
      .set("Authorization", `Basic ${Buffer.from("%E0%A4%A:x").toString("base64")}`)
      .send({ grant_type: "client_credentials" })
      .expect(401);
    expect(broken.body.error).toBe("invalid_client");

    const svc = client(
      app,
      (await token({ grant_type: "client_credentials" }).expect(200)).body.access_token,
    );
    const cursor = Buffer.from("2024-01-01T00:00:00.000Z|bukan-uuid").toString("base64url");
    await svc.get(`/integrations/employees?cursor=${cursor}`).expect(400);
  });

  it("hanya peran yang diizinkan boleh masuk ke aplikasi", async () => {
    await a.patch(`/connected-apps/${appId}`, { allowedRoleIds: [hrRole] }).expect(200);
    await a
      .post("/oauth/authorize", {
        clientId,
        redirectUri: REDIRECT,
        responseType: "code",
        scope: "openid",
        codeChallenge: pkce().challenge,
        codeChallengeMethod: "S256",
      })
      .expect(403);
    await a.patch(`/connected-apps/${appId}`, { allowedRoleIds: [] }).expect(200);
  });

  it("client_credentials → akun layanan dengan hak perannya saja", async () => {
    const t = (await token({ grant_type: "client_credentials" }).expect(200)).body;
    expect(t.id_token).toBeUndefined();
    const svc = client(app, t.access_token);
    const page = (await svc.get("/integrations/employees?limit=1").expect(200)).body;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("nikEnc");
    if (page.nextCursor) {
      const more = (await svc.get(`/integrations/employees?cursor=${page.nextCursor}`).expect(200)).body;
      expect(more.items.map((e: { id: string }) => e.id)).not.toContain(page.items[0].id);
    }
    await svc.get("/integrations/departments").expect(200);
    await svc.post("/employees", { name: "X", joinDate: "2024-01-02" }).expect(403);
    await svc.get("/connected-apps").expect(403);
    // Akun layanan tidak muncul di daftar pengguna & tidak bisa login ke aplikasi.
    const users = (await a.get("/users").expect(200)).body as { name: string }[];
    expect(users.some((u) => u.name.includes("(aplikasi)"))).toBe(false);
    await svc
      .post("/oauth/authorize", {
        clientId,
        redirectUri: REDIRECT,
        responseType: "code",
        scope: "openid",
        codeChallenge: pkce().challenge,
        codeChallengeMethod: "S256",
      })
      .expect(403);
  });

  it("webhook: karyawan dibuat/diubah → terkirim bertanda tangan HMAC; gagal → dicoba ulang", async () => {
    const webhooks = app.get(WebhookService);
    hook.received.length = 0;
    const id = (await a.post("/employees", { name: "Budi Proyek", joinDate: "2024-02-01" }).expect(201)).body
      .id;
    await a.patch(`/employees/${id}`, { workEmail: "budi@example.com" }).expect(200);
    expect(await webhooks.run([tenantId])).toBe(2);
    const events = hook.received.map((r) => JSON.parse(r.body) as { event: string; data: { name: string } });
    expect(events.map((e) => e.event).sort()).toEqual(["employee.created", "employee.updated"]);
    expect(events[0]!.data.name).toBe("Budi Proyek");
    for (const r of hook.received) {
      const [, t, v1] = String(r.headers["x-erp-signature"]).match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
      expect(v1).toBe(createHmac("sha256", webhookSecret).update(`${t}.${r.body}`).digest("hex"));
    }
    expect(await webhooks.run([tenantId])).toBe(0);

    hook.state.status = 500;
    await a.patch(`/employees/${id}`, { active: false }).expect(200);
    expect(await webhooks.run([tenantId])).toBe(0);
    const failed = (await a.get(`/connected-apps/${appId}/deliveries?state=pending`).expect(200)).body;
    expect(failed[0]).toMatchObject({ event: "employee.archived", attempts: 1, responseStatus: 500 });
    hook.state.status = 200;
    await a.post(`/webhook-deliveries/${failed[0].id}/retry`).expect(200);
    expect(await webhooks.run([tenantId])).toBe(1);

    const ping = (await a.post(`/connected-apps/${appId}/webhook-test`).expect(200)).body;
    expect(ping).toMatchObject({ ok: true, status: 200 });
  });

  it("ganti secret mematikan secret lama; logout mencabut token aplikasi", async () => {
    const { code, verifier } = await authorize();
    const t = (
      await token({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }).expect(200)
    ).body;
    const out = (
      await request(app.getHttpServer())
        .post("/oauth/logout")
        .send({ id_token_hint: t.id_token, post_logout_redirect_uri: LOGOUT, state: "s1" })
        .expect(200)
    ).body;
    expect(out.redirectTo).toBe(`${LOGOUT}?state=s1`);
    await token({ grant_type: "refresh_token", refresh_token: t.refresh_token }).expect(400);
    const notListed = (
      await request(app.getHttpServer())
        .post("/oauth/logout")
        .send({ client_id: clientId, post_logout_redirect_uri: "https://evil.example/" })
        .expect(200)
    ).body;
    expect(notListed.redirectTo).toBeNull();

    const old = clientSecret;
    clientSecret = (await a.post(`/connected-apps/${appId}/rotate-secret`).expect(200)).body.clientSecret;
    await token({ grant_type: "client_credentials" }).expect(200);
    const prev = clientSecret;
    clientSecret = old;
    await token({ grant_type: "client_credentials" }).expect(401);
    clientSecret = prev;

    // Aplikasi dinonaktifkan → token akun layanan lama tidak berlaku lagi.
    const svcToken = (await token({ grant_type: "client_credentials" }).expect(200)).body.access_token;
    await a.patch(`/connected-apps/${appId}`, { active: false }).expect(200);
    await client(app, svcToken).get("/integrations/employees").expect(401);
    await token({ grant_type: "client_credentials" }).expect(401);
  });
});
