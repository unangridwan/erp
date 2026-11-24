import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "@erp/shared";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = businessToday();
const daysAgo = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const year = today.slice(0, 4);
const period = `from=${year}-01-01&to=${year}-12-31`;

interface Stage {
  key: string;
  count: number;
  late: number;
  atRisk: number;
  reached: number;
}

describe.skipIf(!hasDb)("Alur bisnis end-to-end", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sales: ReturnType<typeof client>;
  let salesUserId = "";
  let paidOrder = "";
  let openInvoiceOrder = "";
  let invoiceId = "";
  const jr: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "flow");
    const me = (await a.get("/auth/me")).body;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    const role = (
      await a
        .post("/roles", { code: "penjual", name: "Penjual", permissions: ["sales.read", "sales.write"] })
        .expect(201)
    ).body.id;
    salesUserId = (
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
    sales = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (
      await a
        .post("/products", {
          sku: "JS",
          productType: "service",
          name: "Jasa",
          uomId: uom,
          salePrice: "1000000",
        })
        .expect(201)
    ).body.id;
    const customer = (await a.post("/partners", { name: "PT Pelanggan Alur", isCustomer: true }).expect(201))
      .body.id;
    const order = async (dateOrder: string, confirm: boolean, userId?: string) => {
      const id = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder,
            ...(userId ? { userId } : {}),
            lines: [{ productId: product, quantity: 1, priceUnit: 1_000_000 }],
          })
          .expect(201)
      ).body.id as string;
      if (confirm) await a.post(`/sale-orders/${id}/confirm`).expect(200);
      return id;
    };
    // 1) Lunas: pesanan → faktur → dibayar penuh.
    paidOrder = await order(daysAgo(30), true);
    const inv1 = (
      await a.post(`/sale-orders/${paidOrder}/invoice`, { method: "regular", date: daysAgo(25) }).expect(201)
    ).body.moveId;
    await a.post(`/moves/${inv1}/post`).expect(200);
    await a
      .post("/payments", {
        paymentType: "inbound",
        partnerId: customer,
        journalId: jr.BNK1,
        // Lunas penuh termasuk pajak.
        amount: Number((await a.get(`/moves/${inv1}`).expect(200)).body.amountTotal),
        date: daysAgo(10),
        moveIds: [inv1],
      })
      .expect(201);
    // 2) Ditagih, jatuh tempo lewat (belum dibayar) — dipegang penjual Sari.
    openInvoiceOrder = await order(daysAgo(60), true, salesUserId);
    invoiceId = (
      await a
        .post(`/sale-orders/${openInvoiceOrder}/invoice`, { method: "regular", date: daysAgo(50) })
        .expect(201)
    ).body.moveId;
    await a.post(`/moves/${invoiceId}/post`).expect(200);
    // 3) Jasa dikonfirmasi tanpa pengiriman → langsung menunggu faktur.
    await order(daysAgo(5), true);
    // 4) Penawaran.
    await order(daysAgo(1), false);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("menempatkan tiap pesanan di tahap yang benar dengan umur, SLA, kohort, dan waktu siklus", async () => {
    const body = (await a.get(`/flow/o2c?${period}`).expect(200)).body;
    const by = Object.fromEntries((body.summary.stages as Stage[]).map((s) => [s.key, s]));
    expect(by.quote).toMatchObject({ count: 1, late: 0 });
    expect(by.delivered).toMatchObject({ count: 1 });
    expect(by.invoiced).toMatchObject({ count: 1, late: 1 });
    expect(by.paid).toMatchObject({ count: 1 });
    expect(body.summary.wip).toMatchObject({ count: 3, late: 1, value: 3_000_000 });
    expect(body.summary.completed).toMatchObject({ count: 1, cycleMedian: 20 });
    expect(body.summary.bottleneck).toBe("invoiced");
    expect(body.definition.outputStage).toBe("delivered");

    const list = (await a.get(`/flow/o2c/stage/invoiced?${period}`).expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: openInvoiceOrder, status: "late", owner: "Sari Penjual" });
    expect((await a.get(`/flow/o2c/stage/paid?${period}`).expect(200)).body.items[0]).toMatchObject({
      id: paidOrder,
      ageDays: 20,
    });
    // Filter orang.
    const mine = (await a.get(`/flow/o2c?${period}&user=${salesUserId}`).expect(200)).body;
    expect(mine.summary.wip.count).toBe(1);
  });

  it("jejak: faktur menelusuri pesanannya, tahap & riwayat tindakan", async () => {
    const t = (await a.get(`/flow/trace/account_move/${invoiceId}`).expect(200)).body;
    expect(t).toMatchObject({ process: "o2c", stage: "invoiced", finished: false });
    expect(t.anchor.id).toBe(openInvoiceOrder);
    expect(t.stages.find((s: { key: string }) => s.key === "invoiced")).toMatchObject({
      current: true,
      status: "late",
    });
    expect(t.related.some((r: { id: string }) => r.id === invoiceId)).toBe(true);
    expect(t.events.length).toBeGreaterThan(0);
    await a.get(`/flow/trace/partner/${invoiceId}`).expect(404);
  });

  it("pengaturan SLA mengubah status; hak akses per proses", async () => {
    const settings = (await a.get("/flow/o2c/settings").expect(200)).body;
    expect(settings.find((s: { stage: string }) => s.stage === "quote")).toMatchObject({
      slaDays: 14,
      final: false,
    });
    // Penawaran berumur 1 hari: SLA 0 hari → terlambat.
    await a
      .put("/flow/o2c/settings", { stages: [{ stage: "quote", slaDays: 0, departmentId: null }] })
      .expect(200);
    const after = (await a.get(`/flow/o2c?${period}`).expect(200)).body;
    expect(after.summary.stages.find((s: Stage) => s.key === "quote")).toMatchObject({ late: 1 });
    await a
      .put("/flow/o2c/settings", { stages: [{ stage: "nope", slaDays: 1, departmentId: null }] })
      .expect(400);
    await sales.put("/flow/o2c/settings", { stages: [] }).expect(403);

    // Penjual: hanya alur penjualan.
    const overview = (await sales.get(`/flow?${period}`).expect(200)).body;
    expect(overview.map((p: { process: string }) => p.process)).toEqual(["o2c"]);
    await sales.get(`/flow/p2p?${period}`).expect(403);
    await a.get(`/flow/xyz`).expect(404);
    await a.get(`/flow/o2c?from=${year}-12-31&to=${year}-01-01`).expect(400);
  });
});
