import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

type Api = ReturnType<typeof client>;
const today = businessToday();
interface Line {
  id: string;
  productId: string;
  lotName: string | null;
  systemQty: string;
  countedQty: string | null;
  varianceQty: string;
  varianceValue: string;
}

describe.skipIf(!hasDb)("Stock opname, barcode & lacak serial", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let rina: Api;
  let warehouseId = "";
  const prod: Record<string, string> = {};
  let countId = "";
  let customer = "";

  const quant = async (productId: string) =>
    (
      (await a.get(`/stock/quants?productId=${productId}`).expect(200)).body as {
        quantity: string;
        lotName: string | null;
      }[]
    ).reduce((s, q) => s + Number(q.quantity), 0);

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "opname");
    const me = (await a.get("/auth/me")).body;
    const admin = ((await a.get("/roles").expect(200)).body as { id: string; code: string }[]).find(
      (r) => r.code === "admin",
    )!;
    await a
      .post("/users", {
        name: "Rina Direktur",
        email: "rina@example.com",
        password: "rahasia123",
        roleIds: [admin.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    rina = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "rina@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    warehouseId =
      (await a.get("/warehouses").expect(200)).body.items?.[0]?.id ?? (await a.get("/warehouses")).body[0].id;
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    const cat = (await a.post("/product-categories", { name: "Pupuk" }).expect(201)).body.id;
    prod.A = (
      await a
        .post("/products", { sku: "BENIH-A", name: "Benih A", uomId: pcs, cost: "1000", barcode: "8991001" })
        .expect(201)
    ).body.id;
    prod.S = (
      await a
        .post("/products", {
          sku: "DRONE",
          name: "Drone Semprot",
          uomId: pcs,
          cost: "50000",
          tracking: "serial",
        })
        .expect(201)
    ).body.id;
    prod.P = (
      await a
        .post("/products", { sku: "UREA", name: "Urea", uomId: pcs, cost: "2000", categoryId: cat })
        .expect(201)
    ).body.id;
    const vendor = (await a.post("/partners", { name: "Pemasok", isSupplier: true }).expect(201)).body.id;
    customer = (await a.post("/partners", { name: "Petani", isCustomer: true }).expect(201)).body.id;
    const receipt = (
      await a
        .post("/pickings", {
          pickingType: "incoming",
          scheduledDate: today,
          partnerId: vendor,
          moves: [
            { productId: prod.A, quantity: "10", priceUnit: "1000" },
            { productId: prod.S, quantity: "2", priceUnit: "50000" },
            { productId: prod.P, quantity: "5", priceUnit: "2000" },
          ],
        })
        .expect(201)
    ).body;
    const moves = (await a.get(`/pickings/${receipt.id}`).expect(200)).body.moves as {
      id: string;
      productId: string;
      quantity: string;
    }[];
    await a
      .post(`/pickings/${receipt.id}/validate`, {
        moves: moves.map((m) => ({
          id: m.id,
          quantityDone: m.quantity,
          lots:
            m.productId === prod.S
              ? [
                  { lotName: "SN-001", quantity: "1" },
                  { lotName: "SN-002", quantity: "1" },
                ]
              : undefined,
        })),
      })
      .expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("barcode: produk (barcode/SKU) & serial; label PDF", async () => {
    expect((await a.get("/barcode/lookup?code=8991001").expect(200)).body.product.id).toBe(prod.A);
    expect((await a.get("/barcode/lookup?code=benih-a").expect(200)).body.product.id).toBe(prod.A);
    const sn = (await a.get("/barcode/lookup?code=SN-002").expect(200)).body;
    expect(sn).toMatchObject({ product: { id: prod.S }, lot: { name: "SN-002" } });
    await a.get("/barcode/lookup?code=TIDAK-ADA").expect(404);
    const pdf = await a.get(`/barcode/labels?productIds=${prod.A}&lotIds=${sn.lot.id}&copies=2`).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.body.length ?? pdf.text.length).toBeGreaterThan(500);
  });

  it("sesi opname: snapshot, scan, selisih, persetujuan, posting penyesuaian", async () => {
    const c = (await a.post("/stock-counts", { warehouseId, date: today }).expect(201)).body;
    countId = c.id;
    expect(c.state).toBe("draft");
    const started = (await a.post(`/stock-counts/${countId}/start`).expect(200)).body;
    expect(started.state).toBe("counting");
    // A 10, Urea 5, dua serial drone.
    expect(started.lines).toHaveLength(4);

    // Scan barcode A 7× (hasil 7 → kurang 3), serial SN-001 ditemukan, SN-002 hilang, serial baru SN-009 ditemukan.
    for (let i = 0; i < 7; i++)
      await a.post(`/stock-counts/${countId}/scan`, { code: "8991001" }).expect(200);
    await a.post(`/stock-counts/${countId}/scan`, { code: "SN-001" }).expect(200);
    const drone = await a.post(`/stock-counts/${countId}/scan`, { code: "DRONE" }).expect(400);
    expect(JSON.stringify(drone.body)).toContain("serial");
    await a
      .post(`/stock-counts/${countId}/lines`, { productId: prod.S, lotName: "SN-009", countedQty: "1" })
      .expect(201);
    await a
      .post(`/stock-counts/${countId}/lines`, { productId: prod.S, lotName: "SN-010", countedQty: "2" })
      .expect(400);

    // Belum semua dihitung → ditolak; lalu anggap nol (Urea 0, SN-002 0).
    await a.post(`/stock-counts/${countId}/submit`, {}).expect(400);
    let detail = (await a.get(`/stock-counts/${countId}`).expect(200)).body;
    const urea = detail.lines.find((l: Line) => l.productId === prod.P);
    await a.put(`/stock-counts/${countId}/lines`, { lines: [{ id: urea.id, countedQty: "6" }] }).expect(200);
    const submitted = (await a.post(`/stock-counts/${countId}/submit`, { uncountedAsZero: true }).expect(200))
      .body;
    expect(submitted.state).toBe("in_approval");
    // A −3×1000, Urea +1×2000, SN-002 −1×50000, SN-009 +1×50000.
    expect(submitted.summary).toMatchObject({
      withVariance: 4,
      gainValue: "52000.00",
      lossValue: "53000.00",
      absValue: "105000.00",
    });
    await a.post(`/stock-counts/${countId}/post`).expect(400);
    await a.put(`/stock-counts/${countId}/lines`, { lines: [{ id: urea.id, countedQty: "1" }] }).expect(400);

    const req = (await a.get(`/approval-requests/${submitted.approval.id}`).expect(200)).body;
    expect(req.category.code).toBe("OPNAME");
    expect(req.amount).toBe("105000.00");
    await rina.post(`/approval-requests/${req.id}/approve`, {}).expect(200);
    detail = (await a.get(`/stock-counts/${countId}`).expect(200)).body;
    expect(detail.state).toBe("approved");

    const posted = (await a.post(`/stock-counts/${countId}/post`).expect(200)).body;
    expect(posted.state).toBe("done");
    expect(await quant(prod.A)).toBe(7);
    expect(await quant(prod.P)).toBe(6);
    const serials = (
      (await a.get(`/stock/quants?productId=${prod.S}`).expect(200)).body as {
        lotName: string;
        quantity: string;
      }[]
    )
      .filter((q) => Number(q.quantity) > 0)
      .map((q) => q.lotName)
      .sort();
    expect(serials).toEqual(["SN-001", "SN-009"]);
  });

  it("cycle count per kategori, impor Excel/CSV, tanpa selisih langsung siap posting", async () => {
    const cat = (await a.get("/product-categories?limit=50").expect(200)).body.items.find(
      (c: { name: string }) => c.name === "Pupuk",
    ).id;
    const c = (await a.post("/stock-counts", { warehouseId, date: today, categoryId: cat }).expect(201)).body;
    const started = (await a.post(`/stock-counts/${c.id}/start`).expect(200)).body;
    expect(started.lines.map((l: Line) => l.productId)).toEqual([prod.P]);
    const sheet = await a.get(`/stock-counts/${c.id}/sheet`).expect(200);
    expect(sheet.headers["content-type"]).toContain("spreadsheetml");
    const line = started.lines[0];
    const imported = (
      await a
        .post(`/stock-counts/${c.id}/import`, {
          csv: `Baris,SKU,Hitung\n${line.id},UREA,6\n,TIDAK-ADA,3\n`,
        })
        .expect(200)
    ).body;
    expect(imported.updated).toBe(1);
    expect(imported.errors).toHaveLength(1);
    const sub = (await a.post(`/stock-counts/${c.id}/submit`, {}).expect(200)).body;
    expect(sub.state).toBe("approved");
    expect((await a.post(`/stock-counts/${c.id}/post`).expect(200)).body.adjustments).toBe(0);
  });

  it("lacak serial: penerimaan, opname, pengiriman ke pelanggan", async () => {
    const out = (
      await a
        .post("/pickings", {
          pickingType: "outgoing",
          scheduledDate: today,
          partnerId: customer,
          moves: [{ productId: prod.S, quantity: "1" }],
        })
        .expect(201)
    ).body;
    const move = (await a.get(`/pickings/${out.id}`).expect(200)).body.moves[0];
    const lot = (await a.get("/barcode/lookup?code=SN-001").expect(200)).body.lot;
    await a
      .post(`/pickings/${out.id}/validate`, {
        moves: [{ id: move.id, quantityDone: "1", lots: [{ lotId: lot.id, quantity: "1" }] }],
      })
      .expect(200);
    const trace = (await a.get(`/stock-lots/${lot.id}/trace`).expect(200)).body;
    expect(trace.onHand).toBe("0.0000");
    expect(trace.moves.map((m: { pickingType: string | null }) => m.pickingType)).toEqual([
      "incoming",
      "outgoing",
    ]);
    expect(trace.moves[1].partnerName).toBe("Petani");
    const sn9 = (await a.get("/barcode/lookup?code=SN-009").expect(200)).body.lot;
    const t9 = (await a.get(`/stock-lots/${sn9.id}/trace`).expect(200)).body;
    expect(t9.moves).toHaveLength(1);
    expect(t9.moves[0]).toMatchObject({ isInventory: true, toUsage: "internal" });
    expect(t9.onHand).toBe("1.0000");
  });
});
