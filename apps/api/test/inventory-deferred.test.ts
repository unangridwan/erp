import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  displayType: string;
  quantity: string | null;
  priceUnit: string | null;
  uomId: string | null;
}

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);

const accountsOf = async (api: Api) =>
  Object.fromEntries(
    ((await api.get("/accounts?limit=200").expect(200)).body.items as { code: string; id: string }[]).map(
      (a) => [a.code, a.id],
    ),
  );
const balances = async (api: Api) =>
  Object.fromEntries(
    (
      (await api.get(`/reports/trial-balance?dateFrom=${year}-01-01&dateTo=${year}-12-31`).expect(200)).body
        .lines as { code: string; closing: string }[]
    ).map((l) => [l.code, l.closing]),
  );
const uoms = async (api: Api) =>
  Object.fromEntries(
    ((await api.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]).map((u) => [
      u.name,
      u.id,
    ]),
  );
const validate = async (api: Api, pickingId: string, body: object = {}) =>
  (await api.post(`/pickings/${pickingId}/validate`, body).expect(200)).body;
const overview = async (api: Api, q: string) =>
  (await api.get(`/stock/overview?q=${encodeURIComponent(q)}`).expect(200)).body[0] as {
    onHand: string;
    reserved: string;
    available: string;
  };
const products = (move: { lines: Line[] }) => move.lines.filter((l) => l.displayType === "product");

describe.skipIf(!hasDb)("Item tunda Fase 3: satuan, reservasi stok, dropship", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  it("satuan beli/jual: beli per lusin, jual per lusin; stok, valuasi & tagihan dalam satuan yang benar", async () => {
    const a = await signup(app, "uom");
    const u = await uoms(a);
    const acc = await accountsOf(a);
    const vendor = (await a.post("/partners", { name: "PT Grosir", isSupplier: true }).expect(201)).body.id;
    const customer = (await a.post("/partners", { name: "Toko Eceran", isCustomer: true }).expect(201)).body
      .id;
    const kg = (await a.get("/uoms?q=Kg").expect(200)).body.items[0]?.id as string | undefined;
    const pen = (
      await a
        .post("/products", {
          sku: "PEN",
          name: "Pulpen",
          uomId: u["Pcs"],
          purchaseUomId: u["Lusin"],
          salePrice: "3000",
          cost: "2000",
        })
        .expect(201)
    ).body.id;
    if (kg)
      await a.post("/products", { sku: "X", name: "Salah", uomId: u["Pcs"], saleUomId: kg }).expect(400);

    // PO 5 lusin @ 20.000 → penerimaan 60 pcs @ 1.666,6667.
    const po = (
      await a
        .post("/purchase-orders", {
          partnerId: vendor,
          dateOrder: today,
          lines: [{ productId: pen, quantity: "5", priceUnit: "20000", taxIds: [] }],
        })
        .expect(201)
    ).body.id;
    const order = (await a.get(`/purchase-orders/${po}`).expect(200)).body;
    expect(order.lines[0]).toMatchObject({ uomId: u["Lusin"], uomRatio: "12.000000", uomName: "Lusin" });
    const receipt = (await a.post(`/purchase-orders/${po}/confirm`).expect(200)).body.pickings[0].id;
    const picking = (await a.get(`/pickings/${receipt}`).expect(200)).body;
    expect(picking.moves[0]).toMatchObject({ quantity: "60.0000", priceUnit: "1666.6667" });
    // Terima 24 pcs = 2 lusin.
    await validate(a, receipt, {
      moves: [{ id: picking.moves[0].id, quantityDone: "24" }],
      createBackorder: true,
    });
    const received = (await a.get(`/purchase-orders/${po}`).expect(200)).body;
    expect(received.lines[0]).toMatchObject({ qtyReceived: "2.0000", qtyBilled: "0.0000" });
    const billId = (await a.post(`/purchase-orders/${po}/bill`, { date: today }).expect(201)).body.moveId;
    const bill = (await a.get(`/moves/${billId}`).expect(200)).body;
    expect(products(bill)[0]).toMatchObject({
      quantity: "2.0000",
      priceUnit: "20000.0000",
      uomId: u["Lusin"],
    });
    await a.post(`/moves/${billId}/post`).expect(200);
    expect((await balances(a))["2-1800"]).toBe("0.00"); // 24 × 1.666,6667 = 40.000 = tagihan

    // Jual 1 lusin; harga dari harga jual per pcs × 12.
    const so = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ productId: pen, quantity: "1", uomId: u["Lusin"], taxIds: [] }],
        })
        .expect(201)
    ).body;
    expect(so.lines[0]).toMatchObject({ priceUnit: "36000.0000", uomName: "Lusin" });
    const confirmed = (await a.post(`/sale-orders/${so.id}/confirm`).expect(200)).body;
    const delivery = (await a.get(`/pickings/${confirmed.pickings[0].id}`).expect(200)).body;
    expect(delivery.moves[0].quantity).toBe("12.0000");
    await validate(a, delivery.id);
    const sold = (await a.get(`/sale-orders/${so.id}`).expect(200)).body;
    expect(sold.lines[0]).toMatchObject({ qtyDelivered: "1.0000" });
    const invoiceId = (await a.post(`/sale-orders/${so.id}/invoice`, { method: "regular" }).expect(201)).body
      .moveId;
    const invoice = (await a.get(`/moves/${invoiceId}`).expect(200)).body;
    expect(products(invoice)[0]).toMatchObject({ quantity: "1.0000", uomId: u["Lusin"] });
    expect(invoice.amountUntaxed).toBe("36000.00");
    expect(await overview(a, "Pulpen")).toMatchObject({ onHand: "12.0000" });
    expect(acc["5-1000"]).toBeTruthy();
  });

  it("reservasi: stok dicadangkan berurutan; transfer lain tidak bisa memakai stok yang sudah dicadangkan", async () => {
    const a = await signup(app, "rsv");
    const u = await uoms(a);
    const customer = (await a.post("/partners", { name: "Pelanggan", isCustomer: true }).expect(201)).body.id;
    const item = (
      await a.post("/products", { sku: "RSV", name: "Barang Cadang", uomId: u["Pcs"] }).expect(201)
    ).body.id;
    const out = async (quantity: string) =>
      (
        await a
          .post("/pickings", {
            pickingType: "outgoing",
            scheduledDate: today,
            partnerId: customer,
            moves: [{ productId: item, quantity }],
          })
          .expect(201)
      ).body.id as string;
    const confirm = async (id: string) => {
      await a.post(`/pickings/${id}/confirm`).expect(200);
      return (await a.get(`/pickings/${id}`).expect(200)).body;
    };

    const first = await confirm(await out("6"));
    expect(first).toMatchObject({ availability: "waiting" });
    expect(first.moves[0].quantityReserved).toBe("0.0000");

    // Stok masuk 10 → transfer pertama dicadangkan penuh, kedua sebagian.
    const second = await confirm(await out("6"));
    const incoming = (
      await a
        .post("/pickings", {
          pickingType: "incoming",
          scheduledDate: today,
          moves: [{ productId: item, quantity: "10", priceUnit: "1000" }],
        })
        .expect(201)
    ).body.id;
    await validate(a, incoming);
    expect((await a.get(`/pickings/${first.id}`).expect(200)).body).toMatchObject({
      availability: "available",
    });
    const partial = (await a.get(`/pickings/${second.id}`).expect(200)).body;
    expect(partial).toMatchObject({ availability: "partial" });
    expect(partial.moves[0].quantityReserved).toBe("4.0000");
    expect(await overview(a, "Barang Cadang")).toMatchObject({
      onHand: "10.0000",
      reserved: "10.0000",
      available: "0.0000",
    });

    // Transfer kedua tidak boleh mengambil 6 karena 6 sudah dicadangkan untuk yang pertama.
    const err = await a.post(`/pickings/${second.id}/validate`, {}).expect(400);
    expect(err.body.message).toContain("dicadangkan");
    await validate(a, second.id, {
      moves: [{ id: partial.moves[0].id, quantityDone: "4" }],
      createBackorder: true,
    });
    // Lepas cadangan transfer pertama → stoknya bebas lagi.
    await a.post(`/pickings/${first.id}/unreserve`).expect(200);
    expect(await overview(a, "Barang Cadang")).toMatchObject({ reserved: "0.0000", available: "6.0000" });
    const again = (await a.post(`/pickings/${first.id}/reserve`).expect(200)).body;
    expect(again).toMatchObject({ availability: "available" });
    await validate(a, first.id);
    expect(await overview(a, "Barang Cadang")).toMatchObject({ onHand: "0.0000", reserved: "0.0000" });
  });

  it("dropship: SO → RFQ ke pemasok utama; transfer langsung pemasok → pelanggan, HPP = harga beli", async () => {
    const a = await signup(app, "drop");
    const u = await uoms(a);
    const vendor = (await a.post("/partners", { name: "PT Pabrik", isSupplier: true }).expect(201)).body.id;
    const customer = (await a.post("/partners", { name: "PT Proyek", isCustomer: true }).expect(201)).body.id;
    const item = (
      await a
        .post("/products", {
          sku: "DS1",
          name: "Mesin Besar",
          uomId: u["Pcs"],
          salePrice: "15000",
          dropship: true,
        })
        .expect(201)
    ).body.id;
    const noVendor = (
      await a.post("/products", { sku: "DS2", name: "Tanpa Pemasok", uomId: u["Pcs"] }).expect(201)
    ).body.id;
    await a.post("/product-suppliers", { partnerId: vendor, productId: item, price: "10000" }).expect(201);

    const bad = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ productId: noVendor, quantity: "1", priceUnit: "1", dropship: true, taxIds: [] }],
        })
        .expect(201)
    ).body.id;
    await a.post(`/sale-orders/${bad}/confirm`).expect(400);

    const so = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ productId: item, quantity: "3", taxIds: [] }],
        })
        .expect(201)
    ).body;
    expect(so.lines[0].dropship).toBe(true);
    const confirmed = (await a.post(`/sale-orders/${so.id}/confirm`).expect(200)).body;
    expect(confirmed.pickings).toEqual([]);
    expect(confirmed.dropshipOrders).toHaveLength(1);
    const po = (await a.get(`/purchase-orders/${confirmed.dropshipOrders[0].id}`).expect(200)).body;
    expect(po).toMatchObject({ partnerId: vendor, dropshipSaleOrderId: so.id, state: "draft" });
    expect(po.lines[0]).toMatchObject({
      quantity: "3.0000",
      priceUnit: "10000.0000",
      saleLineId: so.lines[0].id,
    });

    const pickingId = (await a.post(`/purchase-orders/${po.id}/confirm`).expect(200)).body.pickings[0].id;
    const picking = (await a.get(`/pickings/${pickingId}`).expect(200)).body;
    expect(picking).toMatchObject({
      pickingType: "dropship",
      saleOrderId: so.id,
      locationName: "Partner/Pemasok",
      locationDestName: "Partner/Pelanggan",
      availability: null,
    });
    const done = await validate(a, pickingId);
    expect(done.name).toMatch(/\/DS\//);
    expect((await a.get(`/sale-orders/${so.id}`).expect(200)).body.lines[0].qtyDelivered).toBe("3.0000");
    expect((await a.get(`/purchase-orders/${po.id}`).expect(200)).body.lines[0].qtyReceived).toBe("3.0000");
    let tb = await balances(a);
    expect(tb["5-1000"]).toBe("30000.00");
    expect(tb["2-1800"]).toBe("-30000.00");
    expect(tb["1-1400"] ?? "0.00").toBe("0.00");
    expect(Number((await overview(a, "Mesin Besar")).onHand)).toBe(0);

    const billId = (await a.post(`/purchase-orders/${po.id}/bill`, { date: today }).expect(201)).body.moveId;
    await a.post(`/moves/${billId}/post`).expect(200);
    const invoiceId = (await a.post(`/sale-orders/${so.id}/invoice`, { method: "regular" }).expect(201)).body
      .moveId;
    await a.post(`/moves/${invoiceId}/post`).expect(200);
    tb = await balances(a);
    expect(tb["2-1800"]).toBe("0.00");
    expect(tb["4-1000"]).toBe("-45000.00");
    await a
      .post(`/pickings/${pickingId}/return`, { lines: [{ moveId: picking.moves[0].id, quantity: "1" }] })
      .expect(400);
  });
});
