import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);
interface Comp {
  id: string;
  productId: string;
  qtyRequired: string;
  qtyConsumed: string | null;
  value: string | null;
  short: string | null;
}

describe.skipIf(!hasDb)("Manufaktur ringan: BOM, stasiun kerja, order produksi", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const prod: Record<string, string> = {};
  const wc: Record<string, string> = {};
  let npkBom = "";
  let lotInokulan = "";

  const tb = async () =>
    Object.fromEntries(
      (
        (await a.get(`/reports/trial-balance?dateFrom=${today}&dateTo=${today}`).expect(200)).body.lines as {
          code: string;
          closing: string;
        }[]
      ).map((l) => [l.code, l.closing]),
    );
  const valuation = async (productId: string) =>
    (
      (await a.get(`/stock/valuation?date=${today}`).expect(200)).body.items as {
        productId: string;
        quantity: string;
        value: string;
      }[]
    ).find((v) => v.productId === productId);

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "mrp");
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    for (const [k, sku, method, tracking] of [
      ["npk", "NPK", "average", "lot"],
      ["urea", "UREA", "fifo", "none"],
      ["mineral", "MINERAL", "average", "none"],
      ["kapur", "KAPUR", "average", "none"],
      ["dolomit", "DOLOMIT", "average", "none"],
      ["karung", "KARUNG", "average", "none"],
      ["inokulan", "INOKULAN", "fifo", "lot"],
    ] as const)
      prod[k] = (
        await a
          .post("/products", { sku, name: sku, uomId: pcs, cost: "0", costMethod: method, tracking })
          .expect(201)
      ).body.id;
    const vendor = (await a.post("/partners", { name: "Pemasok", isSupplier: true }).expect(201)).body.id;
    const receive = async (
      moves: { productId: string; quantity: string; priceUnit: string; lot?: string }[],
    ) => {
      const p = (
        await a
          .post("/pickings", {
            pickingType: "incoming",
            scheduledDate: today,
            partnerId: vendor,
            moves: moves.map(({ lot: _l, ...m }) => m),
          })
          .expect(201)
      ).body;
      const ms = (await a.get(`/pickings/${p.id}`).expect(200)).body.moves as {
        id: string;
        productId: string;
        quantity: string;
      }[];
      await a
        .post(`/pickings/${p.id}/validate`, {
          moves: ms.map((m) => {
            const src = moves.find((x) => x.productId === m.productId)!;
            return {
              id: m.id,
              quantityDone: m.quantity,
              lots: src.lot ? [{ lotName: src.lot, quantity: m.quantity }] : undefined,
            };
          }),
        })
        .expect(200);
    };
    // Urea FIFO: 20 @5.000 lalu 80 @6.000.
    await receive([{ productId: prod.urea!, quantity: "20", priceUnit: "5000" }]);
    await receive([
      { productId: prod.urea!, quantity: "80", priceUnit: "6000" },
      { productId: prod.kapur!, quantity: "50", priceUnit: "1000" },
      { productId: prod.dolomit!, quantity: "50", priceUnit: "1500" },
      { productId: prod.karung!, quantity: "20", priceUnit: "2000" },
      { productId: prod.inokulan!, quantity: "10", priceUnit: "3000", lot: "INO-01" },
    ]);
    lotInokulan = (await a.get("/barcode/lookup?code=INO-01").expect(200)).body.lot.id;
    wc.mixer = (
      await a.post("/work-centers", { code: "MIX", name: "Mixer", costPerHour: "60000" }).expect(201)
    ).body.id;
    wc.ayak = (
      await a.post("/work-centers", { code: "AYK", name: "Ayakan", costPerHour: "30000" }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("BOM multi-level dengan kit phantom, deteksi siklus, estimasi biaya", async () => {
    await a
      .post("/boms", {
        productId: prod.mineral,
        quantity: "2",
        bomType: "phantom",
        lines: [
          { productId: prod.kapur, quantity: "1" },
          { productId: prod.dolomit, quantity: "1" },
        ],
        operations: [{ name: "Ayak", workCenterId: wc.ayak, minutes: "4" }],
      })
      .expect(201);
    const bom = (
      await a
        .post("/boms", {
          productId: prod.npk,
          quantity: "10",
          lines: [
            { productId: prod.urea, quantity: "6" },
            { productId: prod.mineral, quantity: "4" },
            { productId: prod.karung, quantity: "1" },
            { productId: prod.inokulan, quantity: "1" },
          ],
          operations: [{ name: "Campur", workCenterId: wc.mixer, minutes: "30" }],
        })
        .expect(201)
    ).body;
    npkBom = bom.id;
    expect(bom.lines).toHaveLength(4);
    // Kapur memakai NPK → siklus.
    const loop = await a
      .post("/boms", { productId: prod.kapur, lines: [{ productId: prod.npk, quantity: "1" }] })
      .expect(400);
    expect(JSON.stringify(loop.body)).toContain("berputar");
    const cost = (await a.get(`/boms/${npkBom}/cost?qty=10`).expect(200)).body;
    expect(cost.components.map((c: { productId: string }) => c.productId).sort()).toEqual(
      [prod.urea, prod.kapur, prod.dolomit, prod.karung, prod.inokulan].sort(),
    );
    // Konversi: campur 30 mnt × 60rb/jam + ayak 8 mnt × 30rb/jam = 30.000 + 4.000.
    expect(cost.conversion).toBe("34000.00");
  });

  it("order produksi: kekurangan bahan ditolak; konsumsi aktual + biaya konversi → nilai barang jadi, WIP nol", async () => {
    const big = (
      await a
        .post("/production-orders", { productId: prod.npk, quantity: "500", datePlanned: today })
        .expect(201)
    ).body;
    expect(big.shortages).toBeGreaterThan(0);
    await a.post(`/production-orders/${big.id}/confirm`).expect(200);
    const short = await a.post(`/production-orders/${big.id}/produce`, { lotName: "X" }).expect(400);
    expect(JSON.stringify(short.body)).toContain("tidak cukup");
    await a.post(`/production-orders/${big.id}/cancel`).expect(200);

    const mo = (
      await a
        .post("/production-orders", { productId: prod.npk, quantity: "50", datePlanned: today })
        .expect(201)
    ).body;
    expect(mo.name).toMatch(/^MO\//);
    const req = Object.fromEntries(mo.components.map((c: Comp) => [c.productId, c.qtyRequired]));
    expect(req).toMatchObject({
      [prod.urea!]: "30.0000",
      [prod.kapur!]: "10.0000",
      [prod.dolomit!]: "10.0000",
      [prod.karung!]: "5.0000",
      [prod.inokulan!]: "5.0000",
    });
    expect(mo.operations.map((o: { plannedMinutes: string }) => o.plannedMinutes)).toEqual([
      "150.00",
      "40.00",
    ]);
    await a.post(`/production-orders/${mo.id}/produce`, { lotName: "NPK-001" }).expect(400);
    await a.post(`/production-orders/${mo.id}/confirm`).expect(200);
    const campur = mo.operations[0].id;
    await a.post(`/production-orders/${mo.id}/operations/${campur}`, { action: "start" }).expect(200);
    const running = (
      await a
        .post(`/production-orders/${mo.id}/operations/${campur}`, { action: "finish", actualMinutes: "120" })
        .expect(200)
    ).body;
    expect(running.state).toBe("in_progress");
    // Barang jadi ber-lot wajib nomor lot.
    await a.post(`/production-orders/${mo.id}/produce`, {}).expect(400);
    const done = (await a.post(`/production-orders/${mo.id}/produce`, { lotName: "NPK-001" }).expect(200))
      .body;
    expect(done.state).toBe("done");
    // Bahan: urea FIFO 20×5.000 + 10×6.000 = 160.000; kapur 10.000; dolomit 15.000; karung 10.000; inokulan 15.000.
    expect(done.materialCost).toBe("210000.00");
    // Konversi: campur 120 mnt × 60rb + ayak rencana 40 mnt × 30rb = 120.000 + 20.000.
    expect(done.conversionCost).toBe("140000.00");
    expect(done.unitCost).toBe("7000.0000");
    expect(await valuation(prod.npk!)).toMatchObject({ quantity: "50.0000", value: "350000.00" });
    expect(await valuation(prod.urea!)).toMatchObject({ quantity: "70.0000", value: "420000.00" });
    const balances = await tb();
    expect(Number(balances["1-1450"] ?? 0)).toBe(0);
    expect(Number(balances["5-1300"])).toBe(-140000);
    const lot = (await a.get("/barcode/lookup?code=NPK-001").expect(200)).body;
    expect(lot.product.id).toBe(prod.npk);
    const ino = done.components.find((c: Comp) => c.productId === prod.inokulan);
    expect(ino).toMatchObject({ qtyConsumed: "5.0000", value: "15000.00" });
    const trace = (await a.get(`/stock-lots/${lotInokulan}/trace`).expect(200)).body;
    expect(trace.onHand).toBe("5.0000");
    await a.post(`/production-orders/${mo.id}/cancel`).expect(400);
  });

  it("hasil sebagian dengan konsumsi diubah, laporan biaya, hak akses", async () => {
    const mo = (
      await a
        .post("/production-orders", { productId: prod.npk, quantity: "20", datePlanned: today })
        .expect(201)
    ).body;
    await a.post(`/production-orders/${mo.id}/confirm`).expect(200);
    const urea = mo.components.find((c: Comp) => c.productId === prod.urea);
    const done = (
      await a
        .post(`/production-orders/${mo.id}/produce`, {
          qtyProduced: "10",
          lotName: "NPK-002",
          components: [{ id: urea.id, qtyConsumed: "7" }],
        })
        .expect(200)
    ).body;
    expect(done.qtyProduced).toBe("10.0000");
    // Urea 7 × 6.000 = 42.000 (sisa lapisan kedua); lainnya proporsional ½.
    expect(done.components.find((c: Comp) => c.productId === prod.urea).value).toBe("42000.00");
    const report = (await a.get(`/manufacturing/reports/costs?from=${today}&to=${today}`).expect(200)).body;
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ orders: 2, quantity: "60.0000" });
    await a.delete(`/boms/${npkBom}`).expect(400);
  });
});
