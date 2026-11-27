import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "@erp/shared";
import { AlertScheduler } from "../src/alerts/alerts.module.js";
import { AutomationEngine } from "../src/automation/automation.engine.js";
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
  let role = "";
  let sariId = "";
  let so = "";
  let service = "";
  let customer = "";
  const byKey = (rows: RunResult[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "alert");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    role = (
      await a
        .post("/roles", { code: "jual", name: "Jual", permissions: ["sales.read", "sales.write"] })
        .expect(201)
    ).body.id;
    sariId = (
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
    service = (
      await a
        .post("/products", { sku: "JS", productType: "service", name: "Jasa", uomId: uom, salePrice: "1" })
        .expect(201)
    ).body.id;
    customer = (await a.post("/partners", { name: "PT Telat Bayar", isCustomer: true }).expect(201)).body.id;
    so = (
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

  /** Pesanan Sari yang ditagih 60 hari lalu & belum dibayar (lewat SLA tahap Ditagih). */
  const lateOrder = async () => {
    const id = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: daysAgo(70),
          userId: sariId,
          lines: [{ productId: service, quantity: 1, priceUnit: 500_000, taxIds: [] }],
        })
        .expect(201)
    ).body;
    await a.post(`/sale-orders/${id.id}/confirm`).expect(200);
    const inv = (
      await a.post(`/sale-orders/${id.id}/invoice`, { method: "regular", date: daysAgo(60) }).expect(201)
    ).body.moveId;
    await a.post(`/moves/${inv}/post`).expect(200);
    return id as { id: string; name: string };
  };

  it("seketika: dokumen yang berubah & lewat SLA langsung diberitahukan, sekali per dokumen per hari", async () => {
    const automation = app.get(AutomationEngine);
    // Bawaan aturan per dokumen: diperiksa juga saat dokumen berubah.
    const rules = (await a.get("/alerts/rules").expect(200)).body as {
      key: string;
      values: Record<string, number>;
    }[];
    expect(rules.find((r) => r.key === "flow_late")!.values.instant).toBe(1);

    // Dokumen yang sudah masuk ringkasan hari ini tidak dikirim lagi walau berubah.
    await a.patch(`/sale-orders/${so}`, { note: "ditagih ulang" });
    await automation.processPending([tenantId]);
    const before = ((await sari.get("/me/alerts").expect(200)).body as Note[]).length;

    const order = await lateOrder();
    await automation.processPending([tenantId]);
    const notes = (await sari.get("/me/alerts").expect(200)).body as Note[];
    expect(notes.length).toBe(before + 1);
    expect(notes[0]).toMatchObject({
      title: `Peringatan: Dokumen lewat SLA — ${order.name}`,
      link: `/sales/orders/${order.id}`,
    });
    // Perubahan berikutnya di hari yang sama: tidak dikirim ganda.
    await a.patch(`/sale-orders/${order.id}`, { note: "dicek" });
    await automation.processPending([tenantId]);
    expect(((await sari.get("/me/alerts").expect(200)).body as Note[]).length).toBe(before + 1);

    // Saklar dimatikan: dokumen baru yang lewat SLA menunggu pemeriksaan harian.
    await a
      .put("/alerts/rules/flow_late", { active: true, params: { instant: 0 }, recipients: ["owner"] })
      .expect(200);
    await lateOrder();
    await automation.processPending([tenantId]);
    expect(((await sari.get("/me/alerts").expect(200)).body as Note[]).length).toBe(before + 1);
  });

  it("eskalasi: pengingat serah terima yang diabaikan diteruskan ke atasan manajer, sekali per pengingat", async () => {
    const me = (await a.get("/auth/me")).body;
    const mkUser = async (name: string, email: string) => {
      const id = (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [role],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
      const c = client(
        app,
        (
          await request(app.getHttpServer())
            .post("/auth/login")
            .send({ tenantSlug: a.slug, email, password: "rahasia123" })
            .expect(200)
        ).body.token,
      );
      return { id, c };
    };
    const dedi = await mkUser("Dedi Direktur", "dedi@example.com");
    const budi = await mkUser("Budi Manajer", "budi@example.com");
    const dediEmp = (
      await a
        .post("/employees", { name: "Dedi Direktur", userId: dedi.id, joinDate: "2020-01-01" })
        .expect(201)
    ).body.id;
    const budiEmp = (
      await a
        .post("/employees", {
          name: "Budi Manajer",
          userId: budi.id,
          managerId: dediEmp,
          joinDate: "2021-01-01",
        })
        .expect(201)
    ).body.id;
    const keu = (await a.post("/departments", { name: "Keuangan", managerId: budiEmp }).expect(201)).body.id;
    await a
      .put("/flow/o2c/settings", { stages: [{ stage: "invoiced", slaDays: 30, departmentId: keu }] })
      .expect(200);

    // Belum ada pengingat: tidak ada eskalasi.
    await a
      .put("/alerts/rules/handoff_ignored", {
        active: true,
        params: { ignoredDays: 0 },
        recipients: ["manager"],
      })
      .expect(200);
    const none = byKey((await a.post("/alerts/run", { keys: ["handoff_ignored"] }).expect(200)).body);
    expect(none.handoff_ignored).toMatchObject({ matches: 0, notified: 0 });

    // Admin mengingatkan Sari & Budi; tidak ditindaklanjuti → diteruskan ke Dedi (atasan Budi).
    await a.post("/flow/handoffs/remind", { process: "o2c", id: so }).expect(201);
    const run = byKey((await a.post("/alerts/run", { keys: ["handoff_ignored"] }).expect(200)).body);
    expect(run.handoff_ignored).toMatchObject({ matches: 1, recipients: 1, notified: 1 });
    const notes = (await dedi.c.get("/me/alerts").expect(200)).body as Note[];
    expect(notes[0]!.title).toBe("Peringatan: Pengingat diabaikan (eskalasi) (1)");
    expect(notes[0]!.body).toContain("diingatkan 0 hari lalu");
    expect(((await budi.c.get("/me/alerts").expect(200)).body as Note[]).length).toBe(0);

    // Tercatat di riwayat dokumen; pengingat yang sama tidak dieskalasi lagi (juga di hari berikutnya).
    const history = (await a.get(`/activity/sale_order/${so}`).expect(200)).body as {
      message: string | null;
      changes: { escalation?: { to: { name: string }[] } } | null;
    }[];
    const esc = history.find((h) => h.changes?.escalation);
    expect(esc!.changes!.escalation!.to.map((t) => t.name)).toEqual(["Dedi Direktur"]);
    expect(esc!.message).toContain("Dedi Direktur");
    const preview = byKey((await a.get("/alerts/preview").expect(200)).body);
    expect(preview.handoff_ignored!.matches).toBe(0);
  });
});
