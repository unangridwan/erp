import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { SequenceService } from "../src/sequences/sequence.service.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

describe.skipIf(!hasDb)("Fase 0: auth, RBAC, master data, multi-company", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let b: Awaited<ReturnType<typeof signup>>;
  let holdingId: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "a");
    b = await signup(app, "b");
    holdingId = (await a.get("/auth/me").expect(200)).body.activeCompanyId;
  });

  afterAll(() => app?.close());

  describe("auth", () => {
    it("signup membuat holding, role admin, dan partner intercompany", async () => {
      const me = (await a.get("/auth/me").expect(200)).body;
      expect(me.permissions).toEqual(["*"]);
      expect(me.companies).toEqual([expect.objectContaining({ code: "HQ", isDefault: true })]);
      const partners = (await a.get("/partners").expect(200)).body;
      expect(partners.items).toEqual([expect.objectContaining({ icCompanyId: holdingId })]);
    });

    it("menolak slug tenant duplikat", async () => {
      await request(app.getHttpServer())
        .post("/auth/signup")
        .send({
          tenantSlug: a.slug,
          companyName: "PT X",
          name: "Budi",
          email: "x@example.com",
          password: "rahasia123",
        })
        .expect(409);
    });

    it("login dengan kredensial benar, tolak yang salah", async () => {
      const server = app.getHttpServer();
      await request(server)
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "admin@example.com", password: "salah-banget" })
        .expect(401);
      const ok = await request(server)
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "ADMIN@example.com", password: "rahasia123" })
        .expect(200);
      expect(ok.body.token).toEqual(expect.any(String));
    });

    it("menolak request tanpa token atau token palsu", async () => {
      await request(app.getHttpServer()).get("/partners").expect(401);
      await client(app, "bukan.token.valid").get("/partners").expect(401);
    });
  });

  describe("master data", () => {
    it("CRUD partner dengan pencarian dan log aktivitas", async () => {
      const created = (
        await a
          .post("/partners", {
            name: "CV Maju Jaya",
            isCustomer: true,
            npwp: "01.234.567.8-901.000",
            city: "Bandung",
          })
          .expect(201)
      ).body;
      expect(created.npwp).toBe("012345678901000");

      const found = (await a.get("/partners?q=maju").expect(200)).body;
      expect(found.items.map((p: { id: string }) => p.id)).toEqual([created.id]);

      await a.patch(`/partners/${created.id}`, { city: "Jakarta" }).expect(200);
      const updated = (await a.get(`/partners/${created.id}`).expect(200)).body;
      expect(updated).toMatchObject({ city: "Jakarta", isCustomer: true });

      const log = (await a.get(`/activity/partner/${created.id}`).expect(200)).body;
      expect(log.map((l: { action: string }) => l.action)).toEqual(["update", "create"]);
      expect(log[0].changes).toEqual({ city: { from: "Bandung", to: "Jakarta" } });

      await a.delete(`/partners/${created.id}`).expect(204);
      await a.get(`/partners/${created.id}`).expect(404);
    });

    it("validasi input mengembalikan error per field", async () => {
      const res = await a.post("/partners", { name: "", npwp: "123" }).expect(400);
      expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(["name", "npwp"]);
    });

    it("produk memakai UoM bawaan tenant dan SKU unik", async () => {
      const uoms = (await a.get("/uoms?q=Pcs").expect(200)).body.items;
      const product = {
        sku: "BRG-001",
        name: "Kertas A4",
        uomId: uoms[0].id,
        salePrice: 55000.5,
        cost: "42000",
      };
      const created = (await a.post("/products", product).expect(201)).body;
      expect(created).toMatchObject({ salePrice: "55000.50", cost: "42000.00", productType: "storable" });
      await a.post("/products", product).expect(409);
    });
  });

  describe("isolasi tenant", () => {
    it("tenant lain tidak bisa membaca atau merujuk data tenant A", async () => {
      const partner = (await a.post("/partners", { name: "Rahasia A" }).expect(201)).body;
      await b.get(`/partners/${partner.id}`).expect(404);
      expect((await b.get("/partners?q=Rahasia").expect(200)).body.total).toBe(0);

      const uomA = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0];
      const res = await b.post("/products", { sku: "X", name: "X", uomId: uomA.id }).expect(400);
      expect(res.body.errors).toEqual([{ path: "uomId", message: "Data rujukan tidak ditemukan" }]);
    });
  });

  describe("struktur grup & akses perusahaan", () => {
    let subId: string;
    let staff: ReturnType<typeof client>;

    beforeAll(async () => {
      subId = (
        await a
          .post("/companies", {
            code: "SUB1",
            name: "PT Anak Satu",
            parentId: holdingId,
            npwp: "0123456789012345",
          })
          .expect(201)
      ).body.id;
      await a
        .post("/ownerships", {
          parentCompanyId: holdingId,
          childCompanyId: subId,
          pct: 80,
          method: "full",
          validFrom: "2026-01-01",
        })
        .expect(201);
      await a.post("/branches", { companyId: subId, code: "SBY", name: "Cabang Surabaya" }).expect(201);

      const roles = (await a.get("/roles").expect(200)).body as { id: string; code: string }[];
      const userRole = roles.find((r) => r.code === "user")!;
      await a
        .post("/users", {
          name: "Staf HQ",
          email: "staf@example.com",
          password: "rahasia123",
          roleIds: [userRole.id],
          companyIds: [holdingId],
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "staf@example.com", password: "rahasia123" })
        .expect(200);
      staff = client(app, login.body.token);
    });

    it("membuat partner intercompany untuk anak perusahaan", async () => {
      const partners = (await a.get("/partners?q=Anak").expect(200)).body.items;
      expect(partners).toEqual([
        expect.objectContaining({ icCompanyId: subId, isCustomer: true, isSupplier: true }),
      ]);
    });

    it("menolak struktur perusahaan melingkar", async () => {
      await a.patch(`/companies/${holdingId}`, { parentId: subId }).expect(400);
    });

    it("role read-only boleh membaca tetapi tidak menulis", async () => {
      await staff.get("/partners").expect(200);
      await staff.post("/partners", { name: "Tidak boleh" }).expect(403);
      await staff.get("/users").expect(200);
      await staff.post("/users", {}).expect(403);
    });

    it("user hanya bisa memakai perusahaan yang di-assign", async () => {
      const me = (await staff.get("/auth/me").expect(200)).body;
      expect(me.companies.map((c: { id: string }) => c.id)).toEqual([holdingId]);
      await client(app, staff.token, subId).get("/partners").expect(403);

      // Partner milik anak perusahaan tidak terlihat oleh staf HQ; partner bersama (company null) terlihat.
      const own = (await a.post("/partners", { name: "Pelanggan Khusus Anak", companyId: subId }).expect(201))
        .body;
      await staff.get(`/partners/${own.id}`).expect(404);
      const shared = (await a.post("/partners", { name: "Pelanggan Bersama" }).expect(201)).body;
      await staff.get(`/partners/${shared.id}`).expect(200);
    });
  });

  describe("sequence dokumen", () => {
    it("menghasilkan nomor berurutan tanpa duplikat saat paralel", async () => {
      const tenantDb = app.get(TenantDb);
      const sequences = app.get(SequenceService);
      const tenantId = (await a.get("/auth/me")).body.tenantId as string;

      const numbers = await Promise.all(
        Array.from({ length: 10 }, () =>
          tenantDb.runAs(tenantId, (tx) =>
            sequences.next(tx, "sale.order", holdingId, new Date("2026-03-01")),
          ),
        ),
      );
      expect(new Set(numbers).size).toBe(10);
      expect(numbers.sort()[0]).toBe("SO/2026/0001");
      expect(numbers.sort()[9]).toBe("SO/2026/0010");

      const nextYear = await tenantDb.runAs(tenantId, (tx) =>
        sequences.next(tx, "sale.order", holdingId, new Date("2027-01-02")),
      );
      expect(nextYear).toBe("SO/2027/0001");
    });
  });
});
