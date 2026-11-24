import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "@erp/shared";
import { AlertScheduler } from "../src/alerts/alerts.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = businessToday();
const daysAgo = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

interface Note {
  kind?: string;
  title: string;
  body: string | null;
  link: string | null;
}
interface RunResult {
  key: string;
  matches: number;
  recipients: number;
  notified: number;
}

describe.skipIf(!hasDb)("Peringatan dini otomatis", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sari: ReturnType<typeof client>;
  let tenantId = "";
  const byKey = (rows: RunResult[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "alert");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    const role = (
      await a
        .post("/roles", { code: "jual", name: "Jual", permissions: ["sales.read", "sales.write"] })
        .expect(201)
    ).body.id;
    const sariId = (
      await a
        .post("/users", {
          name: "Sari Penjual",
          email: "sari@example.com",
          password: "rahasia123",
          roleIds: [role],
          companyIds: [me.activeCompanyId],
        })
        .expect(201)
    ).body.id;
    sari = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const dept = (await a.post("/departments", { name: "Penjualan" }).expect(201)).body.id;
    await a
      .post("/employees", {
        name: "Sari Penjual",
        userId: sariId,
        departmentId: dept,
        joinDate: "2024-01-01",
      })
      .expect(201);

    // Pesanan Sari: ditagih 60 hari lalu, belum dibayar → lewat SLA alur & piutang menua.
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const service = (
      await a
        .post("/products", { sku: "JS", productType: "service", name: "Jasa", uomId: uom, salePrice: "1" })
        .expect(201)
    ).body.id;
    const customer = (await a.post("/partners", { name: "PT Telat Bayar", isCustomer: true }).expect(201))
      .body.id;
    const so = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: daysAgo(70),
          userId: sariId,
          lines: [{ productId: service, quantity: 1, priceUnit: 1_000_000, taxIds: [] }],
        })
        .expect(201)
    ).body.id;
    await a.post(`/sale-orders/${so}/confirm`).expect(200);
    const inv = (
      await a.post(`/sale-orders/${so}/invoice`, { method: "regular", date: daysAgo(60) }).expect(201)
    ).body.moveId;
    await a.post(`/moves/${inv}/post`).expect(200);

    // Aturan stok minimum tanpa stok.
    const goods = (await a.post("/products", { sku: "BRG", name: "Barang", uomId: uom }).expect(201)).body.id;
    const warehouseId = (await a.get("/warehouses").expect(200)).body.items[0].id;
    await a.post("/reorder-rules", { warehouseId, productId: goods, minQty: "5", maxQty: "20" }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("katalog & pengaturan aturan (hanya pengelola pengaturan)", async () => {
    const rules = (await a.get("/alerts/rules").expect(200)).body as { key: string; active: boolean }[];
    expect(rules.map((r) => r.key)).toContain("flow_late");
    expect(rules.every((r) => !r.active)).toBe(true);
    await sari.get("/alerts/rules").expect(403);
    await a.put("/alerts/rules/tidak_ada", { active: true }).expect(404);

    const saved = (
      await a
        .put("/alerts/rules/ar_overdue", {
          active: true,
          params: { overdueDays: 9999999 },
          recipients: ["owner", "role", "manager"],
        })
        .expect(200)
    ).body;
    // Nilai di luar batas kembali ke bawaan; penerima yang tidak tersedia untuk aturan ini dibuang.
    expect(saved).toMatchObject({ values: { overdueDays: 30 }, selected: ["owner", "role"] });
    await a.put("/alerts/rules/flow_late", { active: true, params: {}, recipients: ["owner"] }).expect(200);
    await a.put("/alerts/rules/stock_low", { active: true, params: {}, recipients: ["role"] }).expect(200);
    await a
      .put("/alerts/rules/cash_negative", {
        active: true,
        params: { minBalance: 5_000_000 },
        recipients: ["role"],
      })
      .expect(200);
  });

  it("pratinjau, kirim ringkasan sekali per orang per aturan per hari", async () => {
    const preview = byKey((await a.get("/alerts/preview").expect(200)).body);
    expect(preview.flow_late).toMatchObject({ matches: 1, recipients: 1, notified: 0 });
    expect(preview.ar_overdue!.matches).toBe(1);
    expect(preview.stock_low!.matches).toBe(1);
    // Proyeksi kas tertinggi 1 jt (piutang) < minimum 5 jt.
    expect(preview.cash_negative!.matches).toBe(1);
    // Pratinjau juga menghitung aturan yang belum aktif.
    expect(preview.goal_behind).toBeDefined();

    const run = byKey((await a.post("/alerts/run", {}).expect(200)).body);
    // Sari: pemilik dokumen (lewat SLA & piutang); Admin: penerima peran (akuntansi & pembelian).
    expect(run.flow_late).toMatchObject({ matches: 1, notified: 1 });
    expect(run.ar_overdue).toMatchObject({ matches: 1, recipients: 2, notified: 2 });
    expect(run.stock_low).toMatchObject({ matches: 1, notified: 1 });
    expect(run.goal_behind).toBeUndefined();

    const notes = (await sari.get("/me/alerts").expect(200)).body as Note[];
    expect(notes.map((n) => n.title).sort()).toEqual([
      "Peringatan: Dokumen lewat SLA (1)",
      "Peringatan: Piutang menua (1)",
    ]);
    expect(notes.find((n) => n.title.includes("Piutang"))!.body).toContain("PT Telat Bayar");
    const work = (await sari.get("/me/work").expect(200)).body;
    expect(work.summary.alertsUnread).toBe(2);

    // Dijalankan ulang di hari yang sama: tidak dikirim ganda.
    const again = byKey((await a.post("/alerts/run", {}).expect(200)).body);
    expect(again.flow_late!.notified + again.ar_overdue!.notified + again.stock_low!.notified).toBe(0);
    await sari.post("/alerts/run", {}).expect(403);
  });

  it("penjadwal harian: klaim aturan per hari, berjalan dengan hak pemilik pengaturan", async () => {
    const scheduler = app.get(AlertScheduler);
    // Hari ini sudah terkirim lewat "jalankan sekarang": klaim berhasil tetapi tidak ada kiriman baru.
    expect(await scheduler.runDue(today, [tenantId])).toBe(0);
    // Klaim yang sama tidak berjalan dua kali.
    expect(await scheduler.runDue(today, [tenantId])).toBe(0);
    // Hari berikutnya: dikirim lagi (Sari 2 + Admin: piutang, stok, kas).
    expect(await scheduler.runDue(tomorrow, [tenantId])).toBe(5);
    const rules = (await a.get("/alerts/rules").expect(200)).body as {
      key: string;
      lastRunOn: string | null;
    }[];
    expect(rules.find((r) => r.key === "flow_late")!.lastRunOn).toBe(tomorrow);
  });
});
