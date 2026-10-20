import type { INestApplication } from "@nestjs/common";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignedXml } from "xml-crypto";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** `openssl` di PATH, atau bawaan Git for Windows (PowerShell biasanya tidak punya openssl di PATH). */
const OPENSSL = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"].find((bin) => {
  try {
    execFileSync(bin, ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

/** Pasangan kunci + sertifikat X.509 sementara untuk IdP tiruan (dibuat saat tes, tidak disimpan di repo). */
function keyPair(dir: string, name: string) {
  execFileSync(
    OPENSSL!,
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${name}`].concat([
      "-keyout",
      join(dir, `${name}.key`),
      "-out",
      join(dir, `${name}.crt`),
    ]),
    { stdio: "ignore" },
  );
  return {
    key: readFileSync(join(dir, `${name}.key`), "utf8"),
    cert: readFileSync(join(dir, `${name}.crt`), "utf8"),
  };
}

const IDP = "https://idp.contoh.test/saml";
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/** Respons SAML dengan assertion bertanda tangan (RSA-SHA256, exclusive c14n), seperti ADFS/Entra/Okta. */
function samlResponse(opts: {
  key: string;
  cert: string;
  inResponseTo: string;
  audience: string;
  acs: string;
  email: string;
  name?: string;
  notOnOrAfter?: string;
}) {
  const until = opts.notOnOrAfter ?? iso(5 * 60_000);
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="_r${Date.now()}" Version="2.0" IssueInstant="${iso()}" Destination="${opts.acs}" InResponseTo="${opts.inResponseTo}">` +
    `<saml:Issuer>${IDP}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="_a${Date.now()}" Version="2.0" IssueInstant="${iso()}">` +
    `<saml:Issuer>${IDP}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">u-123</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData InResponseTo="${opts.inResponseTo}" NotOnOrAfter="${until}" Recipient="${opts.acs}"/>` +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${until}">` +
    `<saml:AudienceRestriction><saml:Audience>${opts.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso()}" SessionIndex="_s1"><saml:AuthnContext>` +
    `<saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>` +
    `</saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>${opts.email}</saml:AttributeValue></saml:Attribute>` +
    (opts.name
      ? `<saml:Attribute Name="displayName"><saml:AttributeValue>${opts.name}</saml:AttributeValue></saml:Attribute>`
      : "") +
    `</saml:AttributeStatement></saml:Assertion></samlp:Response>`;
  const sig = new SignedXml({
    privateKey: opts.key,
    publicCert: opts.cert,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" },
  });
  return Buffer.from(sig.getSignedXml()).toString("base64");
}

// Tanpa openssl (mis. Windows tanpa Git for Windows) tes ini dilewati, seperti tes database tanpa DATABASE_URL.
describe.skipIf(!hasDb || !OPENSSL)("Platform: SSO SAML 2.0", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let dir: string;
  let idp: { key: string; cert: string };
  let other: { key: string; cert: string };
  let staffRole: string;
  let sp: { entityId: string; acsUrl: string; metadataUrl: string };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "saml-"));
    idp = keyPair(dir, "idp");
    other = keyPair(dir, "other");
    app = await createApp();
    a = await signup(app, "saml");
    staffRole = (await a.get("/roles").expect(200)).body.find((r: { code: string }) => r.code !== "admin").id;
    const companyId = (await a.get("/auth/me").expect(200)).body.activeCompanyId;
    await a
      .post("/users", {
        name: "Sari",
        email: "sari@contoh.co.id",
        password: "rahasia123",
        roleIds: [staffRole],
        companyIds: [companyId],
      })
      .expect(201);
  });
  afterAll(async () => {
    await app?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());
  const failure = (res: request.Response) => new URL(res.headers.location!).searchParams.get("ssoError");
  /** start → (IdP) → ACS → finish; `tamper` mengubah parameter respons IdP. */
  const flow = async (
    email: string,
    opts: {
      signer?: { key: string; cert: string };
      audience?: string;
      inResponseTo?: string;
      expired?: boolean;
      cookie?: boolean;
      name?: string;
    } = {},
  ) => {
    const start = await http().get(`/auth/sso/start/${a.slug}`).expect(302);
    const cookie = start.headers["set-cookie"]?.[0]?.split(";")[0];
    const authUrl = new URL(start.headers.location!);
    const authnRequest = inflateRawSync(
      Buffer.from(authUrl.searchParams.get("SAMLRequest")!, "base64"),
    ).toString();
    const requestId = /ID="([^"]+)"/.exec(authnRequest)![1]!;
    const signer = opts.signer ?? idp;
    const acs = await http()
      .post("/auth/sso/saml/acs")
      .type("form")
      .send({
        SAMLResponse: samlResponse({
          ...signer,
          inResponseTo: opts.inResponseTo ?? requestId,
          audience: opts.audience ?? sp.entityId,
          acs: sp.acsUrl,
          email,
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.expired ? { notOnOrAfter: iso(-5 * 60_000) } : {}),
        }),
        RelayState: authUrl.searchParams.get("RelayState")!,
      });
    if (acs.status !== 303) return { acs, authnRequest, authUrl };
    const finishUrl = new URL(acs.headers.location!);
    const finish = http().get(finishUrl.pathname + finishUrl.search);
    if (opts.cookie !== false && cookie) finish.set("Cookie", cookie);
    return { acs, finish: await finish.expect(302), authnRequest, authUrl };
  };

  it("konfigurasi SAML: sertifikat divalidasi, URL SP & metadata tersedia", async () => {
    const before = (await a.get("/auth/sso/config").expect(200)).body;
    sp = before.saml;
    expect(sp.acsUrl).toMatch(/\/auth\/sso\/saml\/acs$/);
    expect(sp.entityId).toBe(sp.metadataUrl);
    await a
      .put("/auth/sso/config", {
        protocol: "saml",
        samlEntryPoint: `${IDP}/sso`,
        samlIdpCert: "x".repeat(200),
      })
      .expect(400);
    const cfg = (
      await a
        .put("/auth/sso/config", {
          protocol: "saml",
          label: "ADFS Kantor",
          samlEntryPoint: `${IDP}/sso`,
          // Base64 polos (tanpa header PEM) juga diterima.
          samlIdpCert: idp.cert.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
          samlIdpIssuer: IDP,
          allowedDomains: ["contoh.co.id"],
        })
        .expect(200)
    ).body;
    expect(cfg).toMatchObject({ protocol: "saml", issuer: null, clientId: null, samlIdpIssuer: IDP });
    expect(cfg.samlIdpCert).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect((await http().get(`/auth/sso/provider?tenant=${a.slug}`).expect(200)).body).toMatchObject({
      enabled: true,
      protocol: "saml",
      label: "ADFS Kantor",
    });
    const metadata = await http().get(`/auth/sso/saml/${a.slug}/metadata`).expect(200);
    expect(metadata.headers["content-type"]).toMatch(/samlmetadata\+xml/);
    expect(metadata.text).toContain(`entityID="${sp.entityId}"`);
    expect(metadata.text).toContain(`Location="${sp.acsUrl}"`);
  });

  it("login: AuthnRequest → assertion bertanda tangan → sesi via refresh token sekali pakai", async () => {
    const { finish, authnRequest, authUrl } = await flow("Sari@Contoh.co.id");
    expect(authUrl.origin + authUrl.pathname).toBe(`${IDP}/sso`);
    expect(authnRequest).toContain(`AssertionConsumerServiceURL="${sp.acsUrl}"`);
    expect(authnRequest).toContain(
      `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${sp.entityId}</saml:Issuer>`,
    );
    const target = new URL(finish!.headers.location!);
    expect(target.pathname).toBe("/login/sso");
    const refreshToken = new URLSearchParams(target.hash.slice(1)).get("refresh")!;
    const session = (await http().post("/auth/refresh").send({ refreshToken }).expect(200)).body;
    expect((await client(app, session.token).get("/auth/me").expect(200)).body).toMatchObject({
      email: "sari@contoh.co.id",
    });
    await http().post("/auth/refresh").send({ refreshToken }).expect(401);
  });

  it("ditolak: tanda tangan IdP lain, InResponseTo/audience salah, kedaluwarsa, tanpa cookie, domain & user", async () => {
    const acsError = async (p: ReturnType<typeof flow>) => failure((await p).acs);
    expect(await acsError(flow("sari@contoh.co.id", { signer: other }))).toMatch(/Respons SAML tidak valid/);
    expect(await acsError(flow("sari@contoh.co.id", { inResponseTo: "_palsu" }))).toMatch(
      /Respons SAML tidak valid/,
    );
    expect(await acsError(flow("sari@contoh.co.id", { audience: "https://sp-lain.test" }))).toMatch(
      /Respons SAML tidak valid/,
    );
    expect(await acsError(flow("sari@contoh.co.id", { expired: true }))).toMatch(/Respons SAML tidak valid/);
    expect(failure((await flow("sari@contoh.co.id", { cookie: false })).finish!)).toMatch(
      /peramban SSO tidak cocok/,
    );
    expect(failure((await flow("orang@lain.com")).finish!)).toMatch(/Domain lain.com tidak diizinkan/);
    expect(failure((await flow("baru@contoh.co.id")).finish!)).toMatch(/belum terdaftar/);
    // Respons tanpa RelayState (IdP-initiated) dan token finish palsu.
    expect(
      failure(await http().post("/auth/sso/saml/acs").type("form").send({ SAMLResponse: "x" }).expect(302)),
    ).toMatch(/tidak valid/);
    expect(failure(await http().get("/auth/sso/saml/finish?token=palsu").expect(302))).toMatch(/tidak valid/);
  });

  it("user baru dibuat otomatis dengan nama dari atribut; OIDC lama tetap bisa dipakai ulang", async () => {
    const current = (await a.get("/auth/sso/config").expect(200)).body;
    await a
      .put("/auth/sso/config", {
        protocol: "saml",
        samlEntryPoint: current.samlEntryPoint,
        samlIdpCert: current.samlIdpCert,
        allowedDomains: ["contoh.co.id"],
        autoProvision: true,
        defaultRoleId: staffRole,
      })
      .expect(200);
    const { finish } = await flow("baru@contoh.co.id", { name: "Budi SAML" });
    expect(new URL(finish!.headers.location!).pathname).toBe("/login/sso");
    const users = (await a.get("/users").expect(200)).body;
    expect(users.find((u: { email: string }) => u.email === "baru@contoh.co.id")).toMatchObject({
      name: "Budi SAML",
    });
    // Kembali ke OIDC: field SAML dikosongkan.
    const oidc = (
      await a.put("/auth/sso/config", { issuer: "https://login.contoh.test", clientId: "erp" }).expect(200)
    ).body;
    expect(oidc).toMatchObject({ protocol: "oidc", samlEntryPoint: null, samlIdpCert: null });
  });
});
