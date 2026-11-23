import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

const today = businessToday();
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
interface Proposal {
  id: string;
  productId: string;
  kind: string;
  quantity: string;
  dateStart: string;
  supplierId: string | null;
  state: string;
  level: number;
}

describe.skipIf(!hasDb)("MRP sederhana: usulan order produksi & pembelian", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const prod: Record<string, string> = {};
  const vendor: Record<string, string> = {};
  let warehouseId = "";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "mrp2");
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    for (const k of ["pupuk", "kompos", "karung", "jerami"])
      prod[k] = (
        await a.post("/products", { sku: k.toUpperCase(), name: k, uomId: pcs, cost: "1000" }).expect(201)
      ).body.id;
    for (const k of ["v1", "v2"])
      vendor[k] = (await a.post("/partners", { name: `Pemasok ${k}`, isSupplier: true }).expect(201)).body.id;
    await a
      .post("/product-suppliers", {
        partnerId: vendor.v1,
        productId: prod.karung,
        price: "2000",
        delayDays: 5,
      })
      .expect(201);
    await a
      .post("/product-suppliers", {
        partnerId: vendor.v2,
        productId: prod.jerami,
        price: "500",
        delayDays: 1,
      })
      .expect(201);
    warehouseId =
      (await a.get("/warehouses").expect(200)).body.items?.[0]?.id ?? (await a.get("/warehouses")).body[0].id;
    await a
      .post("/reorder-rules", {
        warehouseId,
        productId: prod.karung,
        minQty: "5",
        maxQty: "20",
        qtyMultiple: "10",
      })
      .expect(201);
    // Stok awal: pupuk 10, kompos 30.
    const r = (
      await a
        .post("/pickings", {
          pickingType: "incoming",
          scheduledDate: today,
          partnerId: vendor.v1,
          moves: [
            { productId: prod.pupuk, quantity: "10", priceUnit: "1000" },
            { productId: prod.kompos, quantity: "30", priceUnit: "1000" },
          ],
        })
        .expect(201)
    ).body;
    await a.post(`/pickings/${r.id}/validate`, {}).expect(200);
    await a
      .post("/boms", {
        productId: prod.kompos,
        leadDays: 3,
        lines: [{ productId: prod.jerami, quantity: "1" }],
      })
      .expect(201);
    await a
      .post("/boms", {
        productId: prod.pupuk,
        leadDays: 2,
        lines: [
          { productId: prod.kompos, quantity: "2" },
          { productId: prod.karung, quantity: "1" },
        ],
      })
      .expect(201);
    // Permintaan: pengiriman 50 pupuk ke pelanggan dalam 20 hari.
    const customer = (await a.post("/partners", { name: "Kios Tani", isCustomer: true }).expect(201)).body.id;
    await a
      .post("/pickings", {
        pickingType: "outgoing",
        scheduledDate: plus(20),
        partnerId: customer,
        moves: [{ productId: prod.pupuk, quantity: "50" }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("menghitung kebutuhan bersih per level BOM dengan lead time & stok minimum", async () => {
    const run = (await a.post("/mrp/runs", { warehouseId }).expect(201)).body;
    const by = Object.fromEntries(run.proposals.map((p: Proposal) => [p.productId, p]));
    expect(by[prod.pupuk!]).toMatchObject({
      kind: "manufacture",
      quantity: "40.0000",
      level: 0,
      dateStart: plus(18),
    });
    // Kompos: 80 − 30.
    expect(by[prod.kompos!]).toMatchObject({
      kind: "manufacture",
      quantity: "50.0000",
      level: 1,
      dateStart: plus(15),
    });
    // Karung: 40 untuk produksi + isi ke maksimum 20 → 60 (kelipatan 10), dari pemasok v1.
    expect(by[prod.karung!]).toMatchObject({ kind: "purchase", quantity: "60.0000", supplierId: vendor.v1 });
    expect(by[prod.jerami!]).toMatchObject({
      kind: "purchase",
      quantity: "50.0000",
      supplierId: vendor.v2,
      level: 2,
    });

    const confirmed = (
      await a
        .post(`/mrp/runs/${run.id}/confirm`, { proposalIds: run.proposals.map((p: Proposal) => p.id) })
        .expect(200)
    ).body;
    expect(confirmed.productionOrders).toHaveLength(2);
    expect(confirmed.purchaseOrders).toHaveLength(2);
    expect(confirmed.run.proposals.every((p: Proposal) => p.state === "done")).toBe(true);
    const mos = (await a.get("/production-orders").expect(200)).body;
    expect(mos.map((m: { quantity: string }) => m.quantity).sort()).toEqual(["40.0000", "50.0000"]);
    // RFQ karung memakai harga pemasok.
    const rfq = (await a.get(`/purchase-orders/${confirmed.purchaseOrders[0]}`).expect(200)).body;
    expect(rfq.state).toBe("draft");
  });

  it("dijalankan ulang: pasokan dari usulan yang dikonfirmasi menutup kebutuhan", async () => {
    const run = (await a.post("/mrp/runs", { warehouseId }).expect(201)).body;
    expect(run.proposals).toEqual([]);
    const runs = (await a.get("/mrp/runs").expect(200)).body;
    expect(runs).toHaveLength(2);
  });

  it("abaikan usulan & tanpa pemasok dilewati", async () => {
    const extra = (
      await a
        .post("/products", {
          sku: "LABEL",
          name: "Label",
          uomId: (await a.get("/uoms?limit=200")).body.items.find((u: { name: string }) => u.name === "Pcs")
            .id,
          cost: "1",
        })
        .expect(201)
    ).body.id;
    await a
      .post("/reorder-rules", { warehouseId, productId: extra, minQty: "10", maxQty: "10", qtyMultiple: "1" })
      .expect(201);
    const run = (await a.post("/mrp/runs", { warehouseId }).expect(201)).body;
    const label = run.proposals.find((p: Proposal) => p.productId === extra);
    expect(label).toMatchObject({ kind: "purchase", quantity: "10.0000", supplierId: null });
    const res = (await a.post(`/mrp/runs/${run.id}/confirm`, { proposalIds: [label.id] }).expect(200)).body;
    expect(res.skipped).toHaveLength(1);
    const ignored = (await a.post(`/mrp/runs/${run.id}/ignore`, { proposalIds: [label.id] }).expect(200))
      .body;
    expect(ignored.proposals[0].state).toBe("ignored");
  });
});
