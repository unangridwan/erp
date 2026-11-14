import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

interface Check {
  id: string;
  name: string;
  state: string;
  quantity: string;
  sampleQty: string;
  locationId: string;
  destLocationId: string;
  returnPickingId: string | null;
  scrapMoveId: string | null;
  results: { label: string; passed: boolean | null }[];
  evaluation: { complete: boolean; passed: boolean };
  alerts: { id: string; name: string }[];
}

describe.skipIf(!hasDb)("Inspeksi mutu (QM)", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let viewer: ReturnType<typeof client>;
  let vendor = "";
  let gabah = "";
  let benih = "";
  let beras = "";
  let stockLocationId = "";
  let quarantineId = "";

  const onHand = async (productId: string, locationId: string) => {
    const body = (await a.get(`/stock/quants?productId=${productId}`).expect(200)).body;
    return ((Array.isArray(body) ? body : body.items) as { locationId: string; quantity: string }[])
      .filter((q) => q.locationId === locationId)
      .reduce((s, q) => s + Number(q.quantity), 0);
  };
  const receive = async (productId: string, quantity: string, lots?: object[]) => {
    const po = (
      await a
        .post("/purchase-orders", {
          partnerId: vendor,
          dateOrder: today,
          lines: [{ productId, quantity, priceUnit: "10000", taxIds: [] }],
        })
        .expect(201)
    ).body;
    const confirmed = (await a.post(`/purchase-orders/${po.id}/confirm`).expect(200)).body;
    const pickingId = confirmed.pickings[0].id as string;
    const picking = (await a.get(`/pickings/${pickingId}`).expect(200)).body;
    await a
      .post(`/pickings/${pickingId}/validate`, {
        moves: lots ? [{ id: picking.moves[0].id, quantityDone: quantity, lots }] : undefined,
      })
      .expect(200);
    const checks = (await a.get(`/quality-checks-for?pickingId=${pickingId}`).expect(200)).body;
    return { po: po.id as string, pickingId, checkId: checks[0]?.id as string | undefined };
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "qm");
    const me = (await a.get("/auth/me")).body;
    const userRole = (await a.get("/roles").expect(200)).body.find(
      (r: { code: string }) => r.code === "user",
    );
    await a
      .post("/users", {
        name: "Vina Viewer",
        email: "vina@example.com",
        password: "rahasia123",
        roleIds: [userRole.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    viewer = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "vina@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    stockLocationId = (await a.get("/warehouses").expect(200)).body.items[0].lotStockId;
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    const seeds = (await a.post("/product-categories", { name: "Benih" }).expect(201)).body.id;
    gabah = (
      await a.post("/products", { sku: "GBH", name: "Gabah Kering", uomId: pcs, cost: "8000" }).expect(201)
    ).body.id;
    benih = (
      await a
        .post("/products", {
          sku: "BNH",
          name: "Benih Padi",
          uomId: pcs,
          cost: "12000",
          tracking: "lot",
          categoryId: seeds,
        })
        .expect(201)
    ).body.id;
    beras = (
      await a.post("/products", { sku: "BRS", name: "Beras Premium", uomId: pcs, cost: "0" }).expect(201)
    ).body.id;
    vendor = (await a.post("/partners", { name: "UD Tani Jaya", isSupplier: true }).expect(201)).body.id;

    await a
      .post("/quality-points", {
        name: "Cek gabah masuk",
        trigger: "receipt",
        productId: gabah,
        sampling: "percent",
        sampleValue: "10",
        items: [
          { label: "Bebas hama", kind: "pass_fail" },
          { label: "Kadar air", kind: "measure", min: 10, max: 14, unit: "%" },
          { label: "Foto karung", kind: "pass_fail", photo: true },
        ],
      })
      .expect(201);
    await a
      .post("/quality-points", {
        name: "Daya kecambah benih",
        trigger: "receipt",
        categoryId: seeds,
        items: [{ label: "Daya kecambah", kind: "measure", min: 85, unit: "%" }],
      })
      .expect(201);
    await a
      .post("/quality-points", {
        name: "Cek beras hasil giling",
        trigger: "production",
        productId: beras,
        quarantine: true,
        items: [{ label: "Butir patah", kind: "measure", max: 5, unit: "%" }],
      })
      .expect(201);
    await a
      .post("/quality-points", {
        name: "x",
        trigger: "production",
        partnerId: vendor,
        items: [{ label: "a" }],
      })
      .expect(400);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("penerimaan: karantina + sampel; gagal → retur ke pemasok, NCR", async () => {
    const { checkId, po } = await receive(gabah, "100");
    const check = (await a.get(`/quality-checks/${checkId}`).expect(200)).body as Check;
    expect(check).toMatchObject({ state: "pending", quantity: "100.0000", sampleQty: "10.0000" });
    quarantineId = check.locationId;
    expect(quarantineId).not.toBe(stockLocationId);
    expect(await onHand(gabah, quarantineId)).toBe(100);
    expect(await onHand(gabah, stockLocationId)).toBe(0);

    await a.post(`/quality-checks/${checkId}/decide`, { decision: "accept" }).expect(400);
    const saved = (
      await a
        .put(`/quality-checks/${checkId}/results`, {
          results: [{ value: "pass" }, { value: "16" }, { value: "pass" }],
          note: "Gabah basah",
        })
        .expect(200)
    ).body as Check;
    expect(saved.evaluation).toEqual({ complete: true, passed: false });
    expect(saved.results[1]!.passed).toBe(false);
    await viewer.post(`/quality-checks/${checkId}/decide`, { decision: "return" }).expect(403);
    await a.post(`/quality-checks/${checkId}/decide`, { decision: "accept" }).expect(400);
    const done = (await a.post(`/quality-checks/${checkId}/decide`, { decision: "return" }).expect(201))
      .body as Check;
    expect(done.state).toBe("failed");
    expect(done.alerts).toHaveLength(1);
    expect(await onHand(gabah, quarantineId)).toBe(0);
    expect(await onHand(gabah, stockLocationId)).toBe(0);
    const ret = (await a.get(`/pickings/${done.returnPickingId}`).expect(200)).body;
    expect(ret).toMatchObject({ state: "done", pickingType: "outgoing" });
    // Diterima lalu diretur: kuantitas diterima PO kembali 0 (tagihan/nota kredit mengikuti alur pembelian biasa).
    const order = (await a.get(`/purchase-orders/${po}`).expect(200)).body;
    expect(Number(order.lines[0].qtyReceived)).toBe(0);
  });

  it("penerimaan lulus dengan foto wajib → masuk gudang", async () => {
    const { checkId } = await receive(gabah, "50");
    await a
      .put(`/quality-checks/${checkId}/results`, {
        results: [{ value: "pass" }, { value: "12" }, { value: "pass" }],
      })
      .expect(200);
    // Butir foto belum ada fotonya → belum lulus.
    expect(((await a.get(`/quality-checks/${checkId}`).expect(200)).body as Check).evaluation.passed).toBe(
      false,
    );
    const photo = (
      await a
        .post(`/quality-checks/${checkId}/photos`, {
          itemIndex: 2,
          fileName: "karung.png",
          contentType: "image/png",
          data: PNG,
        })
        .expect(201)
    ).body;
    const res = await a.get(`/quality-checks/${checkId}/photos/${photo.id}`).expect(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(((await a.get(`/quality-checks/${checkId}`).expect(200)).body as Check).evaluation.passed).toBe(
      true,
    );
    const done = (await a.post(`/quality-checks/${checkId}/decide`, { decision: "accept" }).expect(201))
      .body as Check;
    expect(done).toMatchObject({ state: "passed", alerts: [] });
    expect(await onHand(gabah, stockLocationId)).toBe(50);
    await a.post(`/quality-checks/${checkId}/decide`, { decision: "scrap" }).expect(400);
  });

  it("titik kontrol per kategori + lot; gagal → scrap dengan jurnal selisih persediaan", async () => {
    const { checkId } = await receive(benih, "20", [{ lotName: "BN-01", quantity: "20" }]);
    expect(checkId).toBeTruthy();
    await a.put(`/quality-checks/${checkId}/results`, { results: [{ value: "70" }] }).expect(200);
    const done = (
      await a
        .post(`/quality-checks/${checkId}/decide`, { decision: "scrap", note: "Kecambah rendah" })
        .expect(201)
    ).body as Check;
    expect(done.state).toBe("failed");
    expect(done.scrapMoveId).toBeTruthy();
    expect(await onHand(benih, quarantineId)).toBe(0);
    expect(await onHand(benih, stockLocationId)).toBe(0);
    const journal = (await a.get(`/moves/${done.scrapMoveId}`).expect(200)).body;
    expect(journal.lines.some((l: { debit: string }) => Number(l.debit) === 200000)).toBe(true);
  });

  it("hasil produksi masuk karantina; terima bersyarat → gudang + NCR; NCR ditutup dengan tindakan", async () => {
    await a
      .post("/boms", { productId: beras, quantity: "1", lines: [{ productId: gabah, quantity: "2" }] })
      .expect(201);
    const mo = (
      await a.post("/production-orders", { productId: beras, quantity: "10", datePlanned: today }).expect(201)
    ).body;
    await a.post(`/production-orders/${mo.id}/confirm`).expect(200);
    await a.post(`/production-orders/${mo.id}/produce`, {}).expect(200);
    const checks = (await a.get(`/quality-checks-for?productionOrderId=${mo.id}`).expect(200)).body;
    expect(checks).toHaveLength(1);
    expect(await onHand(beras, quarantineId)).toBe(10);
    await a.put(`/quality-checks/${checks[0].id}/results`, { results: [{ value: "7" }] }).expect(200);
    const done = (
      await a.post(`/quality-checks/${checks[0].id}/decide`, { decision: "conditional" }).expect(201)
    ).body as Check;
    expect(done.state).toBe("conditional");
    expect(await onHand(beras, stockLocationId)).toBe(10);
    const ncr = done.alerts[0]!;
    const alert = (await a.get(`/quality-alerts/${ncr.id}`).expect(200)).body;
    await a.put(`/quality-alerts/${ncr.id}`, { ...alert, state: "closed" }).expect(400);
    const closed = (
      await a
        .put(`/quality-alerts/${ncr.id}`, {
          ...alert,
          state: "closed",
          correctiveAction: "Setel ulang mesin",
        })
        .expect(200)
    ).body;
    expect(closed.closedAt).toBeTruthy();
    expect((await a.get("/quality-alerts").expect(200)).body).toHaveLength(3);
  });

  it("laporan mutu per pemasok & produk; isolasi tenant", async () => {
    const r = (await a.get(`/quality/reports?from=${today}&to=${today}`).expect(200)).body;
    expect(r.totals).toMatchObject({ checks: 4, failed: 2, passed: 1, conditional: 1 });
    const sup = r.bySupplier.find((x: { id: string }) => x.id === vendor);
    expect(sup).toMatchObject({ checks: 3, failed: 2, defectRate: 66.7 });
    const b = await signup(app, "qm2");
    expect((await b.get("/quality-checks").expect(200)).body).toEqual([]);
    const any = (await a.get("/quality-checks").expect(200)).body[0];
    await b.get(`/quality-checks/${any.id}`).expect(404);
  });
});
