import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!hasDb)("Fase 3: pembelian & persediaan", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let tenantId: string;
  const acc: Record<string, string> = {};
  let warehouseId: string;
  let stockLocationId: string;
  let vendor: string;
  let customer: string;
  let paper: string; // average
  let ink: string; // FIFO
  let laptop: string; // serial
  let bag: string; // habis pakai
  let po1: string;
  let receipt1: string;
  let so: string;
  let delivery: string;

  const codeOf = (id: string) => Object.entries(acc).find(([, v]) => v === id)?.[0];
  const entry = async (moveId: string) => {
    const lines = (await a.get(`/moves/${moveId}`).expect(200)).body.lines as Line[];
    return lines
      .map((l) => [codeOf(l.accountId), l.debit, l.credit])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  };
  const product = async (body: object) =>
    (await a.post("/products", { uomId: await pcs(), ...body }).expect(201)).body.id as string;
  let uomCache: string | undefined;
  const pcs = async () => (uomCache ??= (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id);
  const overview = async (q: string) =>
    (await a.get(`/stock/overview?q=${encodeURIComponent(q)}`).expect(200)).body[0] as {
      onHand: string;
      value: string;
      averageCost: string;
      incoming: string;
      outgoing: string;
    };
  const manual = async (pickingType: string, moves: object[], extra: object = {}) =>
    (await a.post("/pickings", { pickingType, scheduledDate: today, moves, ...extra }).expect(201)).body;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "inv");
    tenantId = (await a.get("/auth/me")).body.tenantId;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    const wh = (await a.get("/warehouses").expect(200)).body.items[0];
    warehouseId = wh.id;
    stockLocationId = wh.lotStockId;
    vendor = (
      await a
        .post("/partners", { name: "PT Pemasok Kertas", isSupplier: true, email: "jual@pemasok.id" })
        .expect(201)
    ).body.id;
    customer = (await a.post("/partners", { name: "CV Toko Buku", isCustomer: true }).expect(201)).body.id;
    paper = await product({ sku: "A4", name: "Kertas A4", salePrice: "15000" });
    ink = await product({ sku: "INK", name: "Tinta", costMethod: "fifo" });
    laptop = await product({ sku: "NB", name: "Laptop Seri", tracking: "serial" });
    bag = await product({ sku: "BAG", name: "Kantong", productType: "consumable" });
    await a.post("/product-suppliers", { partnerId: vendor, productId: paper, price: "10000" }).expect(201);
    await a
      .post("/product-suppliers", { partnerId: vendor, productId: paper, price: "9000", minQty: "100" })
      .expect(201);
  });

  afterAll(() => app?.close());

  it("perusahaan baru punya gudang, lokasi virtual, dan akun persediaan", async () => {
    const locations = (await a.get("/stock-locations").expect(200)).body.items.map(
      (l: { completeName: string }) => l.completeName,
    );
    expect(locations).toEqual(
      expect.arrayContaining([
        "WH/Stok",
        "Partner/Pemasok",
        "Partner/Pelanggan",
        "Virtual/Penyesuaian Persediaan",
      ]),
    );
    const settings = (await a.get("/accounting/settings").expect(200)).body;
    expect(settings).toMatchObject({
      stockValuationAccountId: acc["1-1400"],
      stockInputAccountId: acc["2-1800"],
      cogsAccountId: acc["5-1000"],
      stockAdjustmentAccountId: acc["5-1200"],
    });
  });

  describe("pembelian → penerimaan → tagihan", () => {
    it("PO memakai harga pemasok bertingkat; konfirmasi membuat penerimaan (jasa tidak)", async () => {
      const po = (
        await a
          .post("/purchase-orders", {
            partnerId: vendor,
            dateOrder: today,
            partnerRef: "SJ-778",
            lines: [
              { productId: paper, quantity: "100", taxIds: [] },
              { name: "Ongkos kirim", quantity: "1", priceUnit: "50000", taxIds: [] },
            ],
          })
          .expect(201)
      ).body;
      po1 = po.id;
      expect(po).toMatchObject({
        name: `PO/${today.slice(0, 4)}/0001`,
        state: "draft",
        amountTotal: "950000.00",
      });
      expect(po.lines[0].priceUnit).toBe("9000.0000");

      await a.post(`/purchase-orders/${po1}/send`, {}).expect(200);
      const confirmed = (await a.post(`/purchase-orders/${po1}/confirm`).expect(200)).body;
      expect(confirmed).toMatchObject({
        state: "purchase",
        receiptStatus: "pending",
        billStatus: "to_invoice",
      });
      expect(confirmed.pickings).toHaveLength(1);
      receipt1 = confirmed.pickings[0].id;
      const picking = (await a.get(`/pickings/${receipt1}`).expect(200)).body;
      expect(picking).toMatchObject({
        name: `WH/IN/${today.slice(0, 4)}/0001`,
        state: "ready",
        pickingType: "incoming",
      });
      expect(picking.moves).toEqual([
        expect.objectContaining({ productId: paper, quantity: "100.0000", priceUnit: "9000.0000" }),
      ]);
    });

    it("terima sebagian → backorder; jurnal Persediaan / Barang Diterima Belum Ditagih", async () => {
      const picking = (await a.get(`/pickings/${receipt1}`).expect(200)).body;
      const res = (
        await a
          .post(`/pickings/${receipt1}/validate`, {
            moves: [{ id: picking.moves[0].id, quantityDone: "60" }],
          })
          .expect(200)
      ).body;
      expect(res.state).toBe("done");
      expect(res.backorderId).toBeTruthy();
      expect(await entry(res.accountMoveId)).toEqual([
        ["1-1400", "540000.00", "0.00"],
        ["2-1800", "0.00", "540000.00"],
      ]);
      const backorder = (await a.get(`/pickings/${res.backorderId}`).expect(200)).body;
      expect(backorder.moves[0].quantity).toBe("40.0000");
      expect(await overview("Kertas")).toMatchObject({
        onHand: "60.0000",
        value: "540000.00",
        averageCost: "9000.0000",
        incoming: "40.0000",
      });
      const po = (await a.get(`/purchase-orders/${po1}`).expect(200)).body;
      expect(po.receiptStatus).toBe("partial");
      expect(po.lines.map((l: { qtyReceived: string }) => l.qtyReceived)).toEqual(["60.0000", "0.0000"]);
    });

    it("tagihan dari PO hanya untuk barang yang sudah diterima (3-way matching)", async () => {
      const billId = (await a.post(`/purchase-orders/${po1}/bill`, { date: today }).expect(201)).body.moveId;
      const bill = (await a.get(`/moves/${billId}`).expect(200)).body;
      expect(bill).toMatchObject({
        moveType: "in_invoice",
        ref: "SJ-778",
        invoiceOrigin: expect.stringMatching(/^PO\//),
        amountUntaxed: "590000.00",
      });
      const products = bill.lines.filter((l: { displayType: string }) => l.displayType === "product");
      expect(
        products.map((l: Line & { quantity: string }) => [codeOf(l.accountId), l.quantity, l.debit]),
      ).toEqual([
        ["2-1800", "60.0000", "540000.00"],
        ["6-5000", "1.0000", "50000.00"],
      ]);
      await a.post(`/moves/${billId}/post`).expect(200);
      await a.post(`/purchase-orders/${po1}/bill`, {}).expect(400);
      expect((await a.get("/purchase-orders/matching").expect(200)).body).toEqual([]);

      const backorder = (await a.get(`/pickings?purchaseOrderId=${po1}&state=ready`).expect(200)).body
        .items[0];
      // Tanggal transfer boleh mundur (input terlambat), tidak boleh di masa depan.
      await a.post(`/pickings/${backorder.id}/validate`, { date: "2999-01-01" }).expect(400);
      await a.post(`/pickings/${backorder.id}/validate`, {}).expect(200);
      const matching = (await a.get("/purchase-orders/matching").expect(200)).body;
      expect(matching).toEqual([
        expect.objectContaining({ orderId: po1, received: "100.0000", billed: "60.0000", status: "to_bill" }),
      ]);
      expect((await a.get(`/purchase-orders/${po1}`).expect(200)).body).toMatchObject({
        receiptStatus: "full",
        billStatus: "to_invoice",
      });
      await a.post(`/purchase-orders/${po1}/cancel`).expect(400);
    });

    it("biaya rata-rata tertimbang setelah penerimaan dengan harga berbeda", async () => {
      const po2 = (
        await a
          .post("/purchase-orders", {
            partnerId: vendor,
            dateOrder: today,
            lines: [{ productId: paper, quantity: "100", priceUnit: "12000", taxIds: [] }],
          })
          .expect(201)
      ).body.id;
      const confirmed = (await a.post(`/purchase-orders/${po2}/confirm`).expect(200)).body;
      await a.post(`/pickings/${confirmed.pickings[0].id}/validate`, {}).expect(200);
      expect(await overview("Kertas")).toMatchObject({
        onHand: "200.0000",
        value: "2100000.00",
        averageCost: "10500.0000",
      });
    });
  });

  describe("penjualan → pengiriman → faktur & HPP", () => {
    it("SO membuat pengiriman; faktur hanya setelah barang dikirim", async () => {
      const order = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder: today,
            lines: [{ productId: paper, quantity: "50", priceUnit: "15000", taxIds: [] }],
          })
          .expect(201)
      ).body;
      so = order.id;
      const confirmed = (await a.post(`/sale-orders/${so}/confirm`).expect(200)).body;
      expect(confirmed).toMatchObject({ state: "sale", deliveryStatus: "pending", invoiceStatus: "no" });
      delivery = confirmed.pickings[0].id;
      expect(await overview("Kertas")).toMatchObject({ outgoing: "50.0000" });
      await a.post(`/sale-orders/${so}/invoice`, { method: "regular" }).expect(400);
    });

    it("validasi pengiriman membukukan HPP dengan biaya rata-rata; lalu faktur sesuai kuantitas terkirim", async () => {
      const res = (await a.post(`/pickings/${delivery}/validate`, {}).expect(200)).body;
      expect(await entry(res.accountMoveId)).toEqual([
        ["1-1400", "0.00", "525000.00"],
        ["5-1000", "525000.00", "0.00"],
      ]);
      const order = (await a.get(`/sale-orders/${so}`).expect(200)).body;
      expect(order).toMatchObject({ deliveryStatus: "full", invoiceStatus: "to_invoice" });
      expect(order.lines[0].qtyDelivered).toBe("50.0000");
      const invoiceId = (await a.post(`/sale-orders/${so}/invoice`, { method: "regular" }).expect(201)).body
        .moveId;
      expect((await a.get(`/moves/${invoiceId}`).expect(200)).body.amountTotal).toBe("750000.00");
      await a.post(`/sale-orders/${so}/cancel`).expect(400);
    });

    it("retur pelanggan kembali dengan biaya aslinya; retur ke pemasok dinilai rata-rata", async () => {
      const done = (await a.get(`/pickings/${delivery}`).expect(200)).body;
      await a
        .post(`/pickings/${delivery}/return`, { lines: [{ moveId: done.moves[0].id, quantity: "60" }] })
        .expect(400);
      const ret = (
        await a
          .post(`/pickings/${delivery}/return`, { lines: [{ moveId: done.moves[0].id, quantity: "5" }] })
          .expect(201)
      ).body;
      expect(ret).toMatchObject({
        pickingType: "incoming",
        returnOfId: delivery,
        origin: expect.stringContaining("Retur"),
      });
      const validated = (await a.post(`/pickings/${ret.id}/validate`, {}).expect(200)).body;
      expect(await entry(validated.accountMoveId)).toEqual([
        ["1-1400", "52500.00", "0.00"],
        ["5-1000", "0.00", "52500.00"],
      ]);
      expect((await a.get(`/sale-orders/${so}`).expect(200)).body.lines[0].qtyDelivered).toBe("45.0000");

      const receipt = (await a.get(`/pickings/${receipt1}`).expect(200)).body;
      const back = (
        await a
          .post(`/pickings/${receipt1}/return`, { lines: [{ moveId: receipt.moves[0].id, quantity: "10" }] })
          .expect(201)
      ).body;
      const sent = (await a.post(`/pickings/${back.id}/validate`, {}).expect(200)).body;
      expect(await entry(sent.accountMoveId)).toEqual([
        ["1-1400", "0.00", "105000.00"],
        ["2-1800", "105000.00", "0.00"],
      ]);
      const po = (await a.get(`/purchase-orders/${po1}`).expect(200)).body;
      expect(po.lines[0].qtyReceived).toBe("90.0000");
      expect(await overview("Kertas")).toMatchObject({
        onHand: "145.0000",
        value: "1522500.00",
        averageCost: "10500.0000",
      });
    });

    it("stok tidak cukup ditolak; barang habis pakai boleh minus tanpa jurnal", async () => {
      const out = await manual("outgoing", [{ productId: paper, quantity: "1000" }], { partnerId: customer });
      const err = await a.post(`/pickings/${out.id}/validate`, {}).expect(400);
      expect(err.body.message).toContain("tidak cukup");
      await a.post(`/pickings/${out.id}/cancel`).expect(200);

      const bagOut = await manual("outgoing", [{ productId: bag, quantity: "5" }]);
      const res = (await a.post(`/pickings/${bagOut.id}/validate`, {}).expect(200)).body;
      expect(res.accountMoveId).toBeNull();
    });
  });

  describe("FIFO, lot/serial, penyesuaian", () => {
    it("FIFO: barang keluar memakai lapisan tertua", async () => {
      await a
        .post("/stock/adjustments", {
          locationId: stockLocationId,
          reason: "Saldo awal",
          lines: [{ productId: ink, countedQty: "10", unitCost: "100" }],
        })
        .expect(200);
      const incoming = await manual("incoming", [{ productId: ink, quantity: "10", priceUnit: "130" }], {
        partnerId: vendor,
      });
      await a.post(`/pickings/${incoming.id}/validate`, {}).expect(200);
      const out = await manual("outgoing", [{ productId: ink, quantity: "15" }], { partnerId: customer });
      const res = (await a.post(`/pickings/${out.id}/validate`, {}).expect(200)).body;
      expect(res.moves[0]).toMatchObject({ value: "1650.00", unitCost: "110.0000" });
      const valuation = (await a.get(`/stock/valuation?date=${today}`).expect(200)).body.items;
      expect(valuation.find((v: { productId: string }) => v.productId === ink)).toMatchObject({
        quantity: "5.0000",
        value: "650.00",
      });
    });

    it("nomor serial wajib, unik, dan berjumlah 1", async () => {
      const incoming = await manual(
        "incoming",
        [{ productId: laptop, quantity: "2", priceUnit: "5000000" }],
        { partnerId: vendor },
      );
      const moveId = incoming.moves[0].id;
      await a.post(`/pickings/${incoming.id}/validate`, {}).expect(400);
      await a
        .post(`/pickings/${incoming.id}/validate`, {
          moves: [{ id: moveId, quantityDone: "2", lots: [{ lotName: "SN-001", quantity: "2" }] }],
        })
        .expect(400);
      await a
        .post(`/pickings/${incoming.id}/validate`, {
          moves: [
            {
              id: moveId,
              quantityDone: "2",
              lots: [
                { lotName: "SN-001", quantity: "1", expirationDate: "2029-12-31" },
                { lotName: "SN-002", quantity: "1" },
              ],
            },
          ],
        })
        .expect(200);
      const lots = (await a.get(`/stock/lots?productId=${laptop}`).expect(200)).body;
      const sn1 = lots.find((l: { name: string }) => l.name === "SN-001");
      expect(sn1).toMatchObject({ onHand: "1.0000", expirationDate: "2029-12-31" });

      const out = await manual("outgoing", [{ productId: laptop, quantity: "1" }], { partnerId: customer });
      await a
        .post(`/pickings/${out.id}/validate`, {
          moves: [{ id: out.moves[0].id, quantityDone: "1", lots: [{ lotId: sn1.id, quantity: "1" }] }],
        })
        .expect(200);
      const available = (await a.get(`/stock/lots?productId=${laptop}&available=true`).expect(200)).body;
      expect(available.map((l: { name: string }) => l.name)).toEqual(["SN-002"]);

      const dup = await manual("incoming", [{ productId: laptop, quantity: "1", priceUnit: "5000000" }]);
      const err = await a
        .post(`/pickings/${dup.id}/validate`, {
          moves: [{ id: dup.moves[0].id, quantityDone: "1", lots: [{ lotName: "SN-002", quantity: "1" }] }],
        })
        .expect(400);
      expect(err.body.message).toContain("serial");
    });

    it("stock opname: selisih kurang dibukukan ke Selisih Persediaan", async () => {
      const res = (
        await a
          .post("/stock/adjustments", {
            locationId: stockLocationId,
            lines: [{ productId: paper, countedQty: "140" }],
          })
          .expect(200)
      ).body;
      expect(res.moves).toBe(1);
      expect(await overview("Kertas")).toMatchObject({ onHand: "140.0000", value: "1470000.00" });
      const quants = (await a.get(`/stock/quants?productId=${paper}`).expect(200)).body;
      expect(quants).toEqual([expect.objectContaining({ locationName: "WH/Stok", quantity: "140.0000" })]);
    });

    it("kartu stok: mutasi berurutan dengan saldo berjalan", async () => {
      const card = (await a.get(`/stock/card?productId=${paper}&from=${today}&to=${today}`).expect(200)).body;
      const moves = card.lines.map(
        (l: { qtyIn: string; qtyOut: string }) => Number(l.qtyIn) || -Number(l.qtyOut),
      );
      expect(moves).toEqual([60, 40, 100, -50, 5, -10, -5]);
      expect(card.opening).toEqual({ qty: "0.0000", value: "0.00" });
      expect(card.closing).toEqual({ qty: "140.0000", value: "1470000.00" });
    });
  });

  describe("pemesanan ulang & persetujuan", () => {
    it("aturan min/max membuat RFQ ke pemasok utama", async () => {
      const rule = (
        await a
          .post("/reorder-rules", {
            warehouseId,
            productId: paper,
            minQty: "200",
            maxQty: "300",
            qtyMultiple: "10",
          })
          .expect(201)
      ).body;
      const list = (await a.get("/replenishment").expect(200)).body;
      expect(list).toEqual([
        expect.objectContaining({
          id: rule.id,
          forecast: "140.0000",
          toOrder: "160.0000",
          supplierId: vendor,
        }),
      ]);
      const run = (await a.post("/replenishment/run", {}).expect(200)).body;
      expect(run.orderIds).toHaveLength(1);
      const rfq = (await a.get(`/purchase-orders/${run.orderIds[0]}`).expect(200)).body;
      expect(rfq).toMatchObject({ state: "draft", partnerId: vendor });
      expect(rfq.lines[0]).toMatchObject({ productId: paper, quantity: "160.0000", priceUnit: "9000.0000" });
      expect((await a.get("/replenishment").expect(200)).body[0]).toMatchObject({
        rfq: "160.0000",
        toOrder: "0.0000",
      });
    });

    it("PO di atas batas perlu persetujuan purchase.approve", async () => {
      await a.patch("/accounting/settings", { purchaseApprovalAmount: "1000000" }).expect(200);
      const db = app.get(TenantDb);
      const [role] = await db.runAs(tenantId, (tx) =>
        tx.insert(schema.roles).values({ code: "buyer", name: "Pembeli" }).returning({ id: schema.roles.id }),
      );
      await db.runAs(tenantId, (tx) =>
        tx.insert(schema.rolePermissions).values(
          ["purchase.read", "purchase.write", "partner.read", "product.read"].map((permission) => ({
            roleId: role!.id,
            permission,
          })),
        ),
      );
      const companyId = (await a.get("/auth/me")).body.activeCompanyId;
      await a
        .post("/users", {
          name: "Siti Pembeli",
          email: "siti@example.com",
          password: "rahasia123",
          roleIds: [role!.id],
          companyIds: [companyId],
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "siti@example.com", password: "rahasia123" })
        .expect(200);
      const buyer = client(app, login.body.token);

      const po = (
        await buyer
          .post("/purchase-orders", {
            partnerId: vendor,
            dateOrder: today,
            lines: [{ productId: ink, quantity: "200", priceUnit: "10000", taxIds: [] }],
          })
          .expect(201)
      ).body;
      expect((await buyer.post(`/purchase-orders/${po.id}/confirm`).expect(200)).body).toMatchObject({
        state: "to_approve",
        pickings: [],
      });
      await buyer.post(`/purchase-orders/${po.id}/approve`).expect(403);
      const approved = (await a.post(`/purchase-orders/${po.id}/approve`).expect(200)).body;
      expect(approved).toMatchObject({ state: "purchase", approvedBy: expect.any(String) });
      expect(approved.pickings).toHaveLength(1);
      const cancelled = (await a.post(`/purchase-orders/${po.id}/cancel`).expect(200)).body;
      expect(cancelled.state).toBe("cancel");
      expect(cancelled.pickings[0].state).toBe("cancel");
    });

    it("analisis pembelian per pemasok", async () => {
      const report = (
        await a.get(`/purchase-orders/report?from=${today}&to=${today}&groupBy=partner`).expect(200)
      ).body;
      expect(report).toEqual([
        expect.objectContaining({ label: "PT Pemasok Kertas", orders: 2, amount: "2150000.00" }),
      ]);
    });
  });
});
