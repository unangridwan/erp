import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "@erp/shared";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = businessToday();
const thisMonth = `${today.slice(0, 7)}-01`;
const lastMonth = (() => {
  const d = new Date(`${thisMonth}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.toISOString().slice(0, 7)}-15`;
})();
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

interface Kpi {
  code: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  trendTone: string;
  team: { size: number; average: number | null; rank: number | null };
  trend: { month: string; value: number | null }[];
}

describe.skipIf(!hasDb)("Pekerjaan Saya & KPI pribadi", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sari: ReturnType<typeof client>;
  let sariId = "";
  let order = "";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "work");
    const me = (await a.get("/auth/me")).body;
    const role = (
      await a
        .post("/roles", {
          code: "penjual",
          name: "Penjual",
          permissions: ["sales.read", "sales.write", "crm.read"],
        })
        .expect(201)
    ).body.id;
    const user = async (name: string, email: string) =>
      (
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
    sariId = await user("Sari Penjual", "sari@example.com");
    const budiId = await user("Budi Penjual", "budi@example.com");
    sari = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const sales = (await a.post("/departments", { name: "Penjualan & Pemasaran" }).expect(201)).body.id;
    await a
      .post("/employees", {
        name: "Sari Penjual",
        userId: sariId,
        departmentId: sales,
        joinDate: "2024-01-01",
      })
      .expect(201);

    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (
      await a
        .post("/products", { sku: "JS", productType: "service", name: "Jasa", uomId: uom, salePrice: "1" })
        .expect(201)
    ).body.id;
    const customer = (await a.post("/partners", { name: "PT Pelanggan", isCustomer: true }).expect(201)).body
      .id;
    const so = async (userId: string, dateOrder: string, price: number, confirm: boolean) => {
      const id = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder,
            userId,
            lines: [{ productId: product, quantity: 1, priceUnit: price }],
          })
          .expect(201)
      ).body.id as string;
      if (confirm) await a.post(`/sale-orders/${id}/confirm`).expect(200);
      return id;
    };
    // Sari: bulan ini 1 pesanan (1 jt) + 1 penawaran; bulan lalu 1 pesanan (500 rb). Budi: bulan ini 2 jt.
    order = await so(sariId, thisMonth, 1_000_000, true);
    await so(sariId, thisMonth, 300_000, false);
    await so(sariId, lastMonth, 500_000, true);
    await so(budiId, thisMonth, 2_000_000, true);

    // Aktivitas lewat jatuh tempo untuk Sari, dan sebutan dari Admin.
    await a
      .post("/activities", {
        resModel: "sale_order",
        resId: order,
        activityType: "call",
        summary: "Konfirmasi jadwal",
        dueDate: yesterday,
        userId: sariId,
      })
      .expect(201);
    await a
      .post(`/activity/sale_order/${order}/comments`, { message: "@Sari Penjual cek ya", mentions: [sariId] })
      .expect(201);
    await sari.post(`/activity/sale_order/${order}/comments`, { message: "Siap" }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("KPI pribadi: nilai, periode lalu, tren, dan posisi di antara rekan", async () => {
    const body = (await sari.get("/me/kpis").expect(200)).body;
    expect(body.from).toBe(thisMonth);
    const by = Object.fromEntries((body.items as Kpi[]).map((k) => [k.code, k]));
    // Hanya KPI yang relevan & boleh dilihat: penjualan (bukan CRM tanpa data, bukan pembelian tanpa hak).
    expect(Object.keys(by).sort()).toEqual(["sales.conversion", "sales.orders", "sales.revenue"]);
    expect(by["sales.revenue"]).toMatchObject({
      value: 1_000_000,
      previous: 500_000,
      change: 100,
      trendTone: "good",
      team: { size: 2, average: 1_500_000, rank: 2 },
    });
    expect(by["sales.revenue"]!.trend).toHaveLength(6);
    expect(by["sales.revenue"]!.trend.at(-1)).toEqual({ month: today.slice(0, 7), value: 1_000_000 });
    expect(by["sales.conversion"]).toMatchObject({ value: 50, previous: 100, trendTone: "bad" });
    expect(by["sales.orders"]).toMatchObject({ value: 1, previous: 1 });

    const rows = (await sari.get("/me/kpis/sales.revenue/rows").expect(200)).body;
    expect(rows.total).toBe(1);
    expect(rows.columns.slice(0, 2).map((c: { key: string }) => c.key)).toEqual(["name", "dateOrder"]);
    expect(rows.rows[0]).toMatchObject({ _id: order, href: `/sales/orders/${order}` });
    await sari.get("/me/kpis/purchase.spend/rows").expect(403);
    await sari.get("/me/kpis/tidak.ada/rows").expect(404);
    await sari.get("/me/kpis?from=2026-02-01&to=2026-01-01").expect(400);
  });

  it("PO diterima tepat waktu: penerimaan lengkap dibanding tanggal rencana", async () => {
    const vendor = (await a.post("/partners", { name: "PT Pemasok", isSupplier: true }).expect(201)).body.id;
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const item = (await a.post("/products", { sku: "BRG", name: "Barang", uomId: uom }).expect(201)).body.id;
    const receive = async (datePlanned: string) => {
      const id = (
        await a
          .post("/purchase-orders", {
            partnerId: vendor,
            dateOrder: today,
            datePlanned,
            lines: [{ productId: item, quantity: "5", priceUnit: "1000", taxIds: [] }],
          })
          .expect(201)
      ).body.id as string;
      const confirmed = (await a.post(`/purchase-orders/${id}/confirm`).expect(200)).body;
      await a.post(`/pickings/${confirmed.pickings[0].id}/validate`, {}).expect(200);
      return id;
    };
    const onTime = await receive(tomorrow);
    const late = await receive(yesterday);
    // Belum diterima: tidak dihitung.
    await a
      .post("/purchase-orders", {
        partnerId: vendor,
        dateOrder: today,
        datePlanned: tomorrow,
        lines: [{ productId: item, quantity: "1", priceUnit: "1000", taxIds: [] }],
      })
      .expect(201);
    const k = ((await a.get("/me/kpis").expect(200)).body.items as Kpi[]).find(
      (x) => x.code === "purchase.on_time",
    );
    expect(k).toMatchObject({ value: 50 });
    const rows = (await a.get("/me/kpis/purchase.on_time/rows").expect(200)).body;
    expect(
      rows.rows.map((r: { _id: string; receivedOnTime: string }) => [r._id, r.receivedOnTime]).sort(),
    ).toEqual(
      [
        [onTime, "Ya"],
        [late, "Tidak"],
      ].sort(),
    );
  });

  it("antrean kerja: dokumen yang saya pegang, departemen saya, aktivitas, dan sebutan", async () => {
    const w = (await sari.get("/me/work").expect(200)).body;
    expect(w.department).toMatchObject({ name: "Penjualan & Pemasaran" });
    // 2 pesanan (menunggu faktur) + 1 penawaran milik Sari.
    expect(w.summary).toMatchObject({ documents: 3, activitiesOverdue: 1, mentionsUnread: 1 });
    expect(w.documents.map((d: { stage: string }) => d.stage).sort()).toEqual([
      "delivered",
      "delivered",
      "quote",
    ]);
    expect(w.documents[0]).toMatchObject({ processLabel: ["Order-to-Cash (Penjualan)", "Order-to-Cash"] });
    // Penawaran menunggu di departemen Penjualan (dicocokkan otomatis).
    expect(w.departmentQueue.map((d: { stage: string }) => d.stage)).toEqual(["quote"]);
    expect(w.activities[0]).toMatchObject({
      summary: "Konfirmasi jadwal",
      overdue: true,
      document: expect.stringMatching(/^S/),
      href: `/sales/orders/${order}`,
    });
    expect(w.mentions[0]).toMatchObject({ kind: "mention", link: `/sales/orders/${order}` });
    // Tanpa hak layanan: tiket kosong.
    expect(w.tickets).toEqual([]);
  });

  it("jejak kerja: apa yang saya lakukan & ringkasannya", async () => {
    const h = (await sari.get("/me/history").expect(200)).body;
    expect(h.total).toBe(1);
    expect(h.items[0]).toMatchObject({ action: "message", message: "Siap", model: "sale_order" });
    expect(h.byAction).toEqual({ message: 1 });
    const admin = (await a.get("/me/history?days=7").expect(200)).body;
    expect(admin.byAction.create).toBeGreaterThanOrEqual(4);
    expect(admin.byModel.find((m: { model: string }) => m.model === "sale_order")).toMatchObject({
      label: ["Pesanan penjualan", "Sales order"],
    });
    await sari.get("/me/history?days=500").expect(400);
  });
});
