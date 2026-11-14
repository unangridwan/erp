import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { currentStep, totpCode } from "../src/auth/totp.js";
import { Mailer } from "../src/common/mailer.js";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

describe.skipIf(!hasDb)("Fase 0 lanjutan: sesi, 2FA, undangan, CSV, kurs, wilayah", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const server = () => app.getHttpServer();
  const login = (body: object) => request(server()).post("/auth/login").send(body);

  beforeAll(async () => {
    app = await createApp();
    const { seedRegions } = await import("@erp/db/seed-regions");
    await seedRegions(process.env.DATABASE_URL!);
    a = await signup(app, "sec");
  });

  afterAll(() => app?.close());
  afterEach(() => vi.restoreAllMocks());

  describe("refresh token", () => {
    it("rotasi token; token lama yang dipakai ulang mencabut seluruh sesi", async () => {
      const first = (
        await login({ tenantSlug: a.slug, email: "admin@example.com", password: "rahasia123" }).expect(200)
      ).body;
      const second = (
        await request(server()).post("/auth/refresh").send({ refreshToken: first.refreshToken }).expect(200)
      ).body;
      expect(second.refreshToken).not.toBe(first.refreshToken);
      await client(app, second.token).get("/auth/me").expect(200);

      // Pemakaian ulang token lama → dianggap bocor: keluarga token dicabut, termasuk yang terbaru.
      await request(server()).post("/auth/refresh").send({ refreshToken: first.refreshToken }).expect(401);
      await request(server()).post("/auth/refresh").send({ refreshToken: second.refreshToken }).expect(401);
    });

    it("logout mencabut refresh token", async () => {
      const s = (
        await login({ tenantSlug: a.slug, email: "admin@example.com", password: "rahasia123" }).expect(200)
      ).body;
      await request(server()).post("/auth/logout").send({ refreshToken: s.refreshToken }).expect(204);
      await request(server()).post("/auth/refresh").send({ refreshToken: s.refreshToken }).expect(401);
    });

    it("menolak refresh token palsu", async () => {
      await request(server())
        .post("/auth/refresh")
        .send({ refreshToken: "00000000-0000-0000-0000-000000000000.palsu-palsu-palsu" })
        .expect(401);
    });
  });

  describe("2FA (TOTP)", () => {
    it("setup → aktifkan → login wajib kode → tolak replay → nonaktifkan", async () => {
      const t0 = Date.now();
      const at = (offsetSteps: number) => vi.spyOn(Date, "now").mockReturnValue(t0 + offsetSteps * 30_000);

      const { secret, otpauthUrl } = (await a.post("/auth/2fa/setup").expect(200)).body;
      expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/ERP%3Aadmin%40example\.com\?secret=/);
      await a.post("/auth/2fa/enable", { code: "000000" }).expect(401);
      await a.post("/auth/2fa/enable", { code: totpCode(secret, currentStep(t0)) }).expect(204);
      expect((await a.get("/auth/me").expect(200)).body.twoFactorEnabled).toBe(true);

      const creds = { tenantSlug: a.slug, email: "admin@example.com", password: "rahasia123" };
      const noCode = await login(creds).expect(401);
      expect(noCode.body.twoFactorRequired).toBe(true);

      at(1);
      const code1 = totpCode(secret, currentStep(t0) + 1);
      const ok = (await login({ ...creds, code: code1 }).expect(200)).body;
      await login({ ...creds, code: code1 }).expect(401); // kode yang sama tidak bisa dipakai dua kali

      at(2);
      await client(app, ok.token)
        .post("/auth/2fa/disable", { code: totpCode(secret, currentStep(t0) + 2) })
        .expect(204);
      vi.restoreAllMocks();
      await login(creds).expect(200);
    });

    it("secret disimpan terenkripsi", async () => {
      await a.post("/auth/2fa/setup").expect(200);
      const tenantId = (await a.get("/auth/me")).body.tenantId;
      const [user] = await app.get(TenantDb).runAs(tenantId, (tx) => tx.select().from(schema.users));
      expect(user!.totpSecretEnc).toMatch(/^v1\./);
    });
  });

  describe("rate limit login", () => {
    it("mengembalikan 429 setelah terlalu banyak percobaan gagal", async () => {
      const creds = { tenantSlug: a.slug, email: "korban@example.com", password: "salah-salah" };
      for (let i = 0; i < 10; i++) await login(creds).expect(401);
      const blocked = await login(creds).expect(429);
      expect(blocked.body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("undangan user", () => {
    it("admin mengundang, user menerima dan bisa login", async () => {
      const holdingId = (await a.get("/auth/me")).body.activeCompanyId;
      const roles = (await a.get("/roles")).body as { id: string; code: string }[];
      await a
        .post("/users/invite", {
          name: "Sari Gudang",
          email: "sari@example.com",
          roleIds: [roles.find((r) => r.code === "user")!.id],
          companyIds: [holdingId],
        })
        .expect(201);
      expect((await a.get("/invitations").expect(200)).body).toEqual([
        expect.objectContaining({ email: "sari@example.com" }),
      ]);

      const mail = app.get(Mailer).outbox.at(-1)!;
      expect(mail.to).toBe("sari@example.com");
      const token = decodeURIComponent(mail.text.match(/#token=(\S+)/)![1]!);

      const info = (await request(server()).post("/auth/invitation").send({ token }).expect(200)).body;
      expect(info).toMatchObject({ email: "sari@example.com", tenantSlug: a.slug });

      const session = (
        await request(server())
          .post("/auth/accept-invite")
          .send({ token, password: "passwordSari1" })
          .expect(201)
      ).body;
      const me = (await client(app, session.token).get("/auth/me").expect(200)).body;
      expect(me).toMatchObject({ email: "sari@example.com", permissions: expect.not.arrayContaining(["*"]) });

      await request(server())
        .post("/auth/accept-invite")
        .send({ token, password: "passwordSari1" })
        .expect(410);
      await login({ tenantSlug: a.slug, email: "sari@example.com", password: "passwordSari1" }).expect(200);
      expect((await a.get("/invitations").expect(200)).body).toEqual([]);
    });
  });

  describe("CSV import/export", () => {
    it("impor membuat & memperbarui data; ekspor menghasilkan CSV", async () => {
      const csv =
        'name,isCustomer,city,npwp\nPT Satu,ya,Bandung,\n"CV Dua, Tbk",tidak,Medan,0123456789012345\n';
      expect((await a.post("/partners/import", { csv }).expect(200)).body).toEqual({
        created: 2,
        updated: 0,
      });

      const exported = await a.get("/partners/export?q=Dua").expect(200);
      expect(exported.headers["content-type"]).toMatch(/text\/csv/);
      const [header, row] = exported.text
        .replace(/^\uFEFF/, "")
        .trim()
        .split("\r\n");
      expect(header!.split(",").slice(0, 4)).toEqual(["id", "companyId", "parentId", "kind"]);
      expect(row).toContain('"CV Dua, Tbk"');

      const id = row!.split(",")[0];
      await a.post("/partners/import", { csv: `id,city\n${id},Surabaya\n` }).expect(200);
      expect((await a.get(`/partners/${id}`).expect(200)).body).toMatchObject({
        city: "Surabaya",
        name: "CV Dua, Tbk",
      });
    });

    it("baris tidak valid membatalkan seluruh impor", async () => {
      const before = (await a.get("/partners?active=all")).body.total;
      const res = await a.post("/partners/import", { csv: "name,npwp\nPT Valid,\n,123\n" }).expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 3, path: "name" }),
          expect.objectContaining({ row: 3, path: "npwp" }),
        ]),
      );
      expect((await a.get("/partners?active=all")).body.total).toBe(before);
    });
  });

  describe("foreign key komposit", () => {
    it("database menolak rujukan ke baris tenant lain walau aplikasi dilewati", async () => {
      const b = await signup(app, "fk");
      const uomA = (await a.get("/uoms?q=Pcs")).body.items[0];
      const tenantB = (await b.get("/auth/me")).body.tenantId;
      await expect(
        app
          .get(TenantDb)
          .runAs(tenantB, (tx) => tx.insert(schema.products).values({ sku: "X", name: "X", uomId: uomA.id })),
      ).rejects.toMatchObject({ cause: { code: "23503", constraint_name: "products_uom_id_fkey" } });
    });
  });

  describe("kurs", () => {
    it("konversi memakai kurs terakhir pada/sebelum tanggal", async () => {
      await a
        .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-10-01", rate: 16250 })
        .expect(201);
      await a
        .post("/currency-rates", { currencyCode: "usd", rateDate: "2026-10-15", rate: "16400.5" })
        .expect(201);
      await a.post("/currency-rates", { currencyCode: "USD", rateDate: "2026-10-15", rate: 1 }).expect(409);
      await a.post("/currency-rates", { currencyCode: "IDR", rateDate: "2026-10-15", rate: 1 }).expect(400);

      const r = (await a.get("/fx/convert?from=USD&amount=100&date=2026-10-10").expect(200)).body;
      expect(r).toMatchObject({ to: "IDR", result: "1625000", fromRate: { rateDate: "2026-10-01" } });
      const back = (await a.get("/fx/convert?from=IDR&to=USD&amount=1640050&date=2026-10-20").expect(200))
        .body;
      expect(back.result).toBe("100.00");
      await a.get("/fx/convert?from=USD&amount=1&date=2026-01-01").expect(404);
    });
  });

  describe("wilayah", () => {
    it("menampilkan provinsi dan kabupaten/kota per provinsi", async () => {
      const provinces = (await a.get("/regions?level=1").expect(200)).body;
      expect(provinces).toHaveLength(38);
      const jabar = provinces.find((p: { name: string }) => p.name === "Jawa Barat");
      const cities = (await a.get(`/regions?parent=${jabar.code}&q=bandung`).expect(200)).body;
      expect(cities.map((c: { name: string }) => c.name)).toEqual(
        expect.arrayContaining(["Kota Bandung", "Kabupaten Bandung"]),
      );
    });
  });
});
