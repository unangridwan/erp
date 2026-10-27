import type { INestApplication } from "@nestjs/common";
import { eq, schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
const CALLBACK = "token-callback-xendit-uji-coba";

describe.skipIf(!hasDb)("Fase 5: langganan SaaS & onboarding", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let ops: Api & { slug: string };
  let tenantId: string;
  let companyId: string;

  const login = async (slug: string, email: string) =>
    client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .set("User-Agent", "vitest-browser")
          .send({ tenantSlug: slug, email, password: "rahasia123" })
          .expect(200)
      ).body.token,
    );

  beforeAll(async () => {
    process.env.XENDIT_CALLBACK_TOKEN = CALLBACK;
    app = await createApp();
    a = await signup(app, "saas");
    const me = (await a.get("/auth/me").expect(200)).body;
    tenantId = me.tenantId;
    companyId = me.activeCompanyId;
    // Operator SaaS: tenant terpisah dengan user admin platform.
    ops = await signup(app, "ops");
    const opsTenant = (await ops.get("/auth/me")).body.tenantId;
    await app
      .get(TenantDb)
      .runAs(opsTenant, (tx) =>
        tx
          .update(schema.users)
          .set({ platformAdmin: true })
          .where(eq(schema.users.email, "admin@example.com")),
      );
  });

  afterAll(() => {
    delete process.env.XENDIT_CALLBACK_TOKEN;
    return app?.close();
  });

  describe("langganan", () => {
    it("tenant baru mendapat masa uji coba Enterprise", async () => {
      const me = (await a.get("/auth/me").expect(200)).body;
      expect(me.subscription).toMatchObject({ planCode: "enterprise", status: "trialing", writable: true });
      expect(me.platformAdmin).toBe(false);
      const billing = (await a.get("/billing").expect(200)).body;
      expect(billing.plans.map((p: { code: string }) => p.code)).toEqual(
        expect.arrayContaining(["starter", "business", "enterprise"]),
      );
      expect(billing.plans.map((p: { code: string }) => p.code)).not.toContain("mini");
      expect(billing.usage).toEqual({ users: 1, companies: 1 });
      expect(billing.subscription.status).toBe("trialing");
    });

    it("pilih Starter → tagihan + PPN; lunas manual oleh admin platform → modul & batas paket berlaku", async () => {
      const res = (await a.post("/billing/subscribe", { planCode: "starter" }).expect(200)).body;
      expect(res.invoice).toMatchObject({
        amount: "499000.00",
        tax: "54890.00",
        total: "553890.00",
        status: "open",
        purpose: "new",
        provider: "manual",
      });
      expect(res.instructions).toContain(res.invoice.number);
      // Ganti pilihan: tagihan lama dibatalkan, tetap satu tagihan terbuka.
      const again = (
        await a.post("/billing/subscribe", { planCode: "starter", billingCycle: "yearly" }).expect(200)
      ).body;
      expect(again.invoice.total).toBe("5538900.00");
      const invoices = (await a.get("/billing").expect(200)).body.invoices;
      expect(invoices.map((i: { status: string }) => i.status).sort()).toEqual(["open", "void"]);

      await a.get("/platform/tenants").expect(403);
      const open = (await ops.get("/platform/invoices").expect(200)).body;
      expect(open.find((i: { id: string }) => i.id === again.invoice.id)).toMatchObject({
        tenantSlug: a.slug,
      });
      const paid = (await ops.post(`/platform/invoices/${again.invoice.id}/mark-paid`, {}).expect(200)).body;
      expect(paid.subscription).toMatchObject({ status: "active", billingCycle: "yearly" });
      expect(paid.plan.code).toBe("starter");

      const me = (await a.get("/auth/me").expect(200)).body;
      expect(me.subscription).toMatchObject({ planCode: "starter", status: "active", maxUsers: 5 });
      // Modul di luar paket terkunci; modul paket tetap jalan.
      const locked = (await a.get("/employees").expect(403)).body;
      expect(locked).toMatchObject({ planRequired: true });
      expect(locked.message).toMatch(/hr/);
      await a.get("/partners").expect(200);
      await a.get("/tax-invoices").expect(200);

      // Batas 5 pengguna & 1 perusahaan.
      for (let i = 1; i <= 4; i++)
        await a
          .post("/users", {
            name: `User ${i}`,
            email: `u${i}@example.com`,
            password: "rahasia123",
            companyIds: [companyId],
          })
          .expect(201);
      const over = await a
        .post("/users", {
          name: "User 5",
          email: "u5@example.com",
          password: "rahasia123",
          companyIds: [companyId],
        })
        .expect(403);
      expect(over.body.message).toMatch(/maksimal 5 pengguna/);
      await a
        .post("/users/invite", { name: "Undangan", email: "inv@example.com", companyIds: [companyId] })
        .expect(403);
      expect(
        (await a.post("/companies", { code: "ANAK", name: "PT Anak" }).expect(403)).body.message,
      ).toMatch(/maksimal 1 perusahaan/);
      // Turun paket tidak boleh melebihi batas yang sudah terpakai.
      await ops
        .put("/platform/plans", {
          code: "mini",
          name: "Mini",
          priceMonthly: "99000",
          priceYearly: "990000",
          maxUsers: 2,
          maxCompanies: 1,
          modules: ["accounting"],
          public: false,
        })
        .expect(200);
      expect((await a.post("/billing/subscribe", { planCode: "mini" }).expect(400)).body.message).toMatch(
        /maksimal 2/,
      );
    });

    it("webhook Xendit: token wajib; PAID mengaktifkan paket Bisnis", async () => {
      const { invoice } = (await a.post("/billing/subscribe", { planCode: "business" }).expect(200)).body;
      const hook = (token?: string) => {
        const req = request(app.getHttpServer()).post("/billing/webhooks/xendit");
        if (token) req.set("x-callback-token", token);
        return req.send({ external_id: invoice.id, status: "PAID", id: "xnd_123" });
      };
      await hook().expect(401);
      await hook("salah").expect(401);
      await hook(CALLBACK).expect(200);
      await hook(CALLBACK).expect(200); // idempoten
      const billing = (await a.get("/billing").expect(200)).body;
      expect(billing.plan.code).toBe("business");
      expect(billing.invoices.find((i: { id: string }) => i.id === invoice.id)).toMatchObject({
        status: "paid",
        providerRef: "xnd_123",
      });
      await a.get("/employees").expect(200);
      await a.post("/companies", { code: "ANAK", name: "PT Anak" }).expect(201);
    });

    it("langganan berakhir: baca saja (402), halaman langganan tetap bisa dipakai", async () => {
      const past = new Date(Date.now() - 10 * 86_400_000).toISOString();
      await ops.patch(`/platform/tenants/${tenantId}/subscription`, { currentPeriodEnd: past }).expect(200);
      const blocked = await a.post("/partners", { name: "Tidak bisa" }).expect(402);
      expect(blocked.body.subscriptionStatus).toBe("expired");
      await a.get("/partners").expect(200);
      await a.get("/billing").expect(200);
      // Masa toleransi: 3 hari lewat masih bisa menulis.
      const grace = new Date(Date.now() - 3 * 86_400_000).toISOString();
      await ops.patch(`/platform/tenants/${tenantId}/subscription`, { currentPeriodEnd: grace }).expect(200);
      expect((await a.get("/auth/me")).body.subscription.status).toBe("past_due");
      await a.post("/partners", { name: "Masih bisa" }).expect(201);
      await ops.patch(`/platform/tenants/${tenantId}/subscription`, { status: "suspended" }).expect(200);
      expect((await a.post("/partners", { name: "X" }).expect(402)).body.message).toMatch(/ditangguhkan/);
      await ops.patch(`/platform/tenants/${tenantId}/subscription`, { status: "active" }).expect(200);
    });

    it("perpanjangan otomatis: tagihan dibuat 7 hari sebelum berakhir, periode berlanjut saat dibayar", async () => {
      const end = new Date(Date.now() + 3 * 86_400_000);
      await ops
        .patch(`/platform/tenants/${tenantId}/subscription`, { currentPeriodEnd: end.toISOString() })
        .expect(200);
      expect((await ops.post("/platform/billing/run").expect(200)).body.created).toBeGreaterThanOrEqual(1);
      const renewal = (await a.get("/billing").expect(200)).body.invoices.find(
        (i: { status: string }) => i.status === "open",
      );
      expect(renewal).toMatchObject({ purpose: "renewal", total: "1663890.00" });
      const paid = (await ops.post(`/platform/invoices/${renewal.id}/mark-paid`, {}).expect(200)).body;
      const nextEnd = new Date(paid.subscription.currentPeriodEnd);
      expect(new Date(paid.subscription.currentPeriodStart).getTime()).toBe(end.getTime());
      expect(Math.round((nextEnd.getTime() - end.getTime()) / 86_400_000)).toBeGreaterThanOrEqual(28);

      const cancelled = (await a.post("/billing/cancel").expect(200)).body;
      expect(cancelled.subscription).toMatchObject({ status: "cancelling", cancelAtPeriodEnd: true });
      await a.post("/billing/resume").expect(200);
    });
  });

  describe("admin platform: paket & tenant gratis", () => {
    // Paket bersifat global (lintas tenant & lintas run test) → kode unik per run.
    const sfx = Math.random().toString(36).slice(2, 7);
    const mitraCode = `mitra-${sfx}`;
    const plan = {
      code: `promo-${sfx}`,
      name: "Promo",
      priceMonthly: "100000",
      priceYearly: "1000000",
      maxUsers: 3,
      maxCompanies: null,
      modules: ["accounting"],
      public: false,
      sort: 90,
      active: true,
    };

    it("CRUD paket: kode unik, ubah kode, hapus hanya bila belum dipakai, khusus admin platform", async () => {
      await a.post("/platform/plans", plan).expect(403);
      const created = (await ops.post("/platform/plans", plan).expect(201)).body;
      const dup = await ops.post("/platform/plans", plan).expect(400);
      expect(dup.body.errors[0].path).toBe("code");
      const updated = (
        await ops
          .put(`/platform/plans/${created.id}`, { ...plan, code: mitraCode, name: "Mitra" })
          .expect(200)
      ).body;
      expect(updated).toMatchObject({ code: mitraCode, name: "Mitra" });
      const list = (await ops.get("/platform/plans").expect(200)).body as {
        code: string;
        tenantCount: number;
      }[];
      expect(list.find((p) => p.code === mitraCode)?.tenantCount).toBe(0);
      expect(list.find((p) => p.code === "enterprise")!.tenantCount).toBeGreaterThan(0);
      const temp = (await ops.post("/platform/plans", { ...plan, code: `tmp-${sfx}` }).expect(201)).body;
      await ops.delete(`/platform/plans/${temp.id}`).expect(204);
      const enterprise = list.find((p) => p.code === "enterprise") as unknown as { id: string };
      await ops.delete(`/platform/plans/${enterprise.id}`).expect(400);
    });

    it("tenant gratis: tagihan terbuka dibatalkan, tetap aktif walau uji coba habis, tidak ditagih; cabut → berakhir", async () => {
      const c = await signup(app, "gratis");
      const cTenant = (await c.get("/auth/me")).body.tenantId as string;
      await c.post("/billing/subscribe", { planCode: "starter" }).expect(200);
      const past = new Date(Date.now() - 86_400_000).toISOString();
      await ops
        .patch(`/platform/tenants/${cTenant}/subscription`, { complimentary: true, complimentaryUntil: past })
        .expect(400);
      const until = new Date(Date.now() + 90 * 86_400_000).toISOString();
      await ops
        .patch(`/platform/tenants/${cTenant}/subscription`, {
          planCode: mitraCode,
          trialEndsAt: past,
          complimentary: true,
          complimentaryUntil: until,
          complimentaryNote: "Mitra program UMKM",
        })
        .expect(200);
      const billing = (await c.get("/billing").expect(200)).body;
      expect(billing.subscription).toMatchObject({ status: "complimentary", complimentary: true });
      expect(billing.invoices.every((i: { status: string }) => i.status === "void")).toBe(true);
      const me = (await c.get("/auth/me").expect(200)).body;
      expect(me.subscription).toMatchObject({ planCode: mitraCode, status: "complimentary", writable: true });
      await c.post("/partners", { name: "Pelanggan Gratis" }).expect(201);
      await c.get("/employees").expect(403); // modul SDM tidak termasuk paket Mitra
      const tenants = (await ops.get("/platform/tenants").expect(200)).body;
      expect(tenants.find((t: { id: string }) => t.id === cTenant)).toMatchObject({
        complimentary: true,
        complimentaryNote: "Mitra program UMKM",
        planName: "Mitra",
      });
      // Penagihan perpanjangan melewati tenant gratis.
      await ops
        .patch(`/platform/tenants/${cTenant}/subscription`, {
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        })
        .expect(200);
      await ops.post("/platform/billing/run").expect(200);
      const after = (await c.get("/billing").expect(200)).body.invoices;
      expect(after.some((i: { status: string }) => i.status === "open")).toBe(false);
      const mitra = (await ops.get("/platform/plans").expect(200)).body.find(
        (p: { code: string }) => p.code === mitraCode,
      );
      await ops.delete(`/platform/plans/${mitra.id}`).expect(400); // dipakai tenant
      // Cabut gratis: kembali ke aturan biasa (periode habis → baca saja).
      await ops
        .patch(`/platform/tenants/${cTenant}/subscription`, {
          complimentary: false,
          currentPeriodEnd: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        })
        .expect(200);
      expect((await c.post("/partners", { name: "Tidak bisa" }).expect(402)).body.subscriptionStatus).toBe(
        "expired",
      );
    });
  });

  describe("onboarding", () => {
    it("checklist, profil perusahaan non-PKP, saldo awal seimbang otomatis", async () => {
      const start = (await a.get("/onboarding").expect(200)).body;
      const status = (key: string, s = start) => s.steps.find((x: { key: string }) => x.key === key).status;
      expect(status("company")).toBe("todo");
      expect(status("users")).toBe("done");
      expect(status("plan")).toBe("done");

      const saved = (
        await a
          .put("/onboarding/company", {
            name: "PT Saas Maju",
            npwp: "0012345678901000",
            pkp: false,
            street: "Jl. Asia Afrika 5",
            city: "Bandung",
          })
          .expect(200)
      ).body;
      expect(status("company", saved)).toBe("done");
      expect(status("tax", saved)).toBe("done");
      expect((await a.get("/accounting/settings").expect(200)).body.defaultSaleTaxId).toBeNull();

      const opening = (
        await a
          .post("/onboarding/opening-balance", {
            date: "2026-01-01",
            lines: [
              { accountCode: "1-1100", debit: "10000000" },
              { accountCode: "3-1000", credit: "8000000" },
              { accountCode: "1-1300", debit: "0" },
            ],
          })
          .expect(201)
      ).body;
      expect(opening.balancingAmount).toBe("2000000.00");
      const move = (await a.get(`/moves/${opening.moveId}`).expect(200)).body;
      expect(move).toMatchObject({ state: "posted", ref: "SALDO-AWAL" });
      expect(move.lines).toHaveLength(3);
      await a
        .post("/onboarding/opening-balance", {
          date: "2026-01-01",
          lines: [{ accountCode: "9-9999", debit: "1" }],
        })
        .expect(409);

      const skipped = (await a.post("/onboarding/steps", { step: "products", status: "skipped" }).expect(200))
        .body;
      expect(status("opening", skipped)).toBe("done");
      expect(status("products", skipped)).toBe("skipped");
      const done = (await a.post("/onboarding/complete").expect(200)).body;
      expect(done.completedAt).not.toBeNull();
    });
  });

  describe("sesi login", () => {
    it("daftar sesi aktif & cabut perangkat", async () => {
      const u = await login(a.slug, "u1@example.com");
      await login(a.slug, "u1@example.com");
      const sessions = (await u.get("/auth/sessions").expect(200)).body;
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({ userAgent: "vitest-browser" });
      await u.delete(`/auth/sessions/${sessions[1].id}`).expect(204);
      expect((await u.get("/auth/sessions").expect(200)).body).toHaveLength(1);
      await u.delete("/auth/sessions").expect(204);
      expect((await u.get("/auth/sessions").expect(200)).body).toHaveLength(0);
    });
  });
});
