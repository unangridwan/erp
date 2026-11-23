import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  displayType: string;
  quantity: string | null;
  priceUnit: string | null;
  purchaseLineId: string | null;
  saleLineId: string | null;
  taxIds: string[];
}

const today = businessToday();
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
const product = async (api: Api, body: object) => {
  const uomId = (await api.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
  return (await api.post("/products", { uomId, ...body }).expect(201)).body.id as string;
};
const validate = async (api: Api, pickingId: string) =>
  (await api.post(`/pickings/${pickingId}/validate`, {}).expect(200)).body;
const products = (move: { lines: Line[] }) => move.lines.filter((l) => l.displayType === "product");

describe.skipIf(!hasDb)("Item tunda Fase 2–3: penjualan & pembelian", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  it("selisih harga tagihan vs PO ke akun Selisih Harga; retur setelah ditagih membuat draft nota kredit/debit", async () => {
    const a = await signup(app, "retur");
    const acc = await accountsOf(a);
    const vendor = (await a.post("/partners", { name: "PT Pemasok", isSupplier: true }).expect(201)).body.id;
    const customer = (await a.post("/partners", { name: "CV Pembeli", isCustomer: true }).expect(201)).body
      .id;
    const item = await product(a, { sku: "BRG", name: "Barang Uji" });

    // Pembelian 10 @ 1.000, ditagih 1.100 → selisih 1.000 ke 5-1100.
    const po = (
      await a
        .post("/purchase-orders", {
          partnerId: vendor,
          dateOrder: today,
          lines: [{ productId: item, quantity: "10", priceUnit: "1000", taxIds: [] }],
        })
        .expect(201)
    ).body.id;
    const receipt = (await a.post(`/purchase-orders/${po}/confirm`).expect(200)).body.pickings[0].id;
    await validate(a, receipt);
    const billId = (await a.post(`/purchase-orders/${po}/bill`, { date: today }).expect(201)).body.moveId;
    const bill = (await a.get(`/moves/${billId}`).expect(200)).body;
    await a
      .patch(`/moves/${billId}`, {
        moveType: "in_invoice",
        partnerId: vendor,
        date: today,
        lines: products(bill).map((l) => ({
          productId: item,
          accountId: l.accountId,
          name: "Barang Uji",
          quantity: l.quantity,
          priceUnit: "1100",
          taxIds: [],
        })),
      })
      .expect(200);
    await a.post(`/moves/${billId}/post`).expect(200);
    let tb = await balances(a);
    expect(tb["2-1800"]).toBe("0.00");
    expect(tb["5-1100"]).toBe("1000.00");
    expect(tb["1-1400"]).toBe("10000.00");

    // Retur 3 ke pemasok setelah ditagih → draft nota debit 3 @ harga PO.
    const done = (await a.get(`/pickings/${receipt}`).expect(200)).body;
    const back = (
      await a
        .post(`/pickings/${receipt}/return`, { lines: [{ moveId: done.moves[0].id, quantity: "3" }] })
        .expect(201)
    ).body;
    const sent = await validate(a, back.id);
    expect(sent.documents).toEqual([
      expect.objectContaining({ model: "account_move", label: "Draft nota debit" }),
    ]);
    const debitNote = (await a.get(`/moves/${sent.documents[0].id}`).expect(200)).body;
    expect(debitNote).toMatchObject({ moveType: "in_refund", state: "draft", amountTotal: "3000.00" });
    expect(products(debitNote)[0]).toMatchObject({ quantity: "3.0000", accountId: acc["2-1800"] });
    expect(products(debitNote)[0].purchaseLineId).toBeTruthy();
    await a.post(`/moves/${debitNote.id}/post`).expect(200);
    const order = (await a.get(`/purchase-orders/${po}`).expect(200)).body;
    expect(order.lines[0]).toMatchObject({ qtyReceived: "7.0000", qtyBilled: "7.0000" });
    tb = await balances(a);
    expect(tb["2-1800"]).toBe("0.00");
    expect(tb["5-1100"]).toBe("1000.00");

    // Penjualan 5, ditagih, lalu retur 2 → draft nota kredit 2 @ harga SO.
    const so = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ productId: item, quantity: "5", priceUnit: "2000", taxIds: [] }],
        })
        .expect(201)
    ).body.id;
    const delivery = (await a.post(`/sale-orders/${so}/confirm`).expect(200)).body.pickings[0].id;
    expect((await validate(a, delivery)).documents).toEqual([]);
    const invoiceId = (await a.post(`/sale-orders/${so}/invoice`, { method: "regular" }).expect(201)).body
      .moveId;
    await a.post(`/moves/${invoiceId}/post`).expect(200);
    const out = (await a.get(`/pickings/${delivery}`).expect(200)).body;
    const ret = (
      await a
        .post(`/pickings/${delivery}/return`, { lines: [{ moveId: out.moves[0].id, quantity: "2" }] })
        .expect(201)
    ).body;
    const returned = await validate(a, ret.id);
    expect(returned.documents).toHaveLength(1);
    const creditNote = (await a.get(`/moves/${returned.documents[0].id}`).expect(200)).body;
    expect(creditNote).toMatchObject({ moveType: "out_refund", state: "draft", amountTotal: "4000.00" });
    expect(products(creditNote)[0]).toMatchObject({ quantity: "2.0000", priceUnit: "2000.0000" });
    const sale = (await a.get(`/sale-orders/${so}`).expect(200)).body;
    expect(sale.lines[0]).toMatchObject({ qtyDelivered: "3.0000", qtyInvoiced: "3.0000" });
    expect(sale.invoices.map((i: { moveType: string }) => i.moveType).sort()).toEqual([
      "out_invoice",
      "out_refund",
    ]);
  });

  it("antar perusahaan: SO → draft RFQ, faktur → draft tagihan terhubung PO; PO → draft penawaran", async () => {
    const hq = await signup(app, "icdoc");
    const hqId = (await hq.get("/auth/me")).body.activeCompanyId;
    const aId = (
      await hq
        .post("/companies", { code: "A", name: "PT Anak Dagang", entityType: "subsidiary", parentId: hqId })
        .expect(201)
    ).body.id;
    const a = client(app, hq.token, aId);
    await hq.patch(`/companies/${hqId}`, { icAutoDocuments: true }).expect(200);
    const accA = await accountsOf(a);
    const partners = (await hq.get("/partners?limit=200&active=all").expect(200)).body.items as {
      id: string;
      icCompanyId: string | null;
    }[];
    const icHq = partners.find((p) => p.icCompanyId === hqId)!.id;
    const icA = partners.find((p) => p.icCompanyId === aId)!.id;
    const item = await product(hq, { sku: "IC1", name: "Barang Grup" });
    const settingsA = (await a.get("/accounting/settings").expect(200)).body;

    // Stok awal di HQ untuk dikirim.
    const supplier = (await hq.post("/partners", { name: "PT Luar", isSupplier: true }).expect(201)).body.id;
    const seed = (
      await hq
        .post("/purchase-orders", {
          partnerId: supplier,
          dateOrder: today,
          lines: [{ productId: item, quantity: "10", priceUnit: "3000", taxIds: [] }],
        })
        .expect(201)
    ).body.id;
    await validate(hq, (await hq.post(`/purchase-orders/${seed}/confirm`).expect(200)).body.pickings[0].id);

    const so = (
      await hq
        .post("/sale-orders", {
          partnerId: icA,
          dateOrder: today,
          lines: [{ productId: item, quantity: "4", priceUnit: "5000" }],
        })
        .expect(201)
    ).body;
    const confirmed = (await hq.post(`/sale-orders/${so.id}/confirm`).expect(200)).body;
    expect(confirmed.icPurchaseOrderId).toBeTruthy();
    const po = (await a.get(`/purchase-orders/${confirmed.icPurchaseOrderId}`).expect(200)).body;
    expect(po).toMatchObject({
      state: "draft",
      partnerId: icHq,
      partnerRef: so.name,
      icSaleOrderId: so.id,
      currencyCode: "IDR",
    });
    expect(po.lines[0]).toMatchObject({ productId: item, quantity: "4.0000", priceUnit: "5000.0000" });
    expect(po.lines[0].taxIds).toEqual([settingsA.defaultPurchaseTaxId]);

    // A mengonfirmasi PO (tidak memicu SO balik) dan menerima barang; HQ mengirim & menagih.
    const receipt = (await a.post(`/purchase-orders/${po.id}/confirm`).expect(200)).body.pickings[0].id;
    expect((await hq.get(`/sale-orders?partnerId=${icA}`).expect(200)).body.total).toBe(1);
    await validate(a, receipt);
    await validate(hq, confirmed.pickings[0].id);
    const invoiceId = (await hq.post(`/sale-orders/${so.id}/invoice`, { method: "regular" }).expect(201)).body
      .moveId;
    await hq.post(`/moves/${invoiceId}/post`).expect(200);
    const invoice = (await hq.get(`/moves/${invoiceId}`).expect(200)).body;

    const bills = (await a.get(`/moves?type=in_invoice&q=${encodeURIComponent(invoice.name)}`).expect(200))
      .body.items as { id: string }[];
    expect(bills).toHaveLength(1);
    const bill = (await a.get(`/moves/${bills[0]!.id}`).expect(200)).body;
    expect(bill).toMatchObject({
      state: "draft",
      icSourceMoveId: invoiceId,
      partnerId: icHq,
      ref: invoice.name,
      amountTotal: invoice.amountTotal,
    });
    expect(products(bill)[0]).toMatchObject({ accountId: accA["2-1800"], quantity: "4.0000" });
    expect(products(bill)[0].purchaseLineId).toBe(po.lines[0].id);
    await a.post(`/moves/${bill.id}/post`).expect(200);
    expect((await a.get(`/purchase-orders/${po.id}`).expect(200)).body.billStatus).toBe("invoiced");
    expect((await balances(a))["2-1800"]).toBe("0.00");

    // Arah sebaliknya: PO dari A ke HQ → draft penawaran di HQ.
    await hq.patch(`/companies/${aId}`, { icAutoDocuments: true }).expect(200);
    const po2 = (
      await a
        .post("/purchase-orders", {
          partnerId: icHq,
          dateOrder: today,
          lines: [{ productId: item, quantity: "2", priceUnit: "5500", taxIds: [] }],
        })
        .expect(201)
    ).body;
    await a.post(`/purchase-orders/${po2.id}/confirm`).expect(200);
    const linked = (await a.get(`/purchase-orders/${po2.id}`).expect(200)).body.icSaleOrderId;
    const quote = (await hq.get(`/sale-orders/${linked}`).expect(200)).body;
    expect(quote).toMatchObject({
      state: "draft",
      partnerId: icA,
      clientOrderRef: po2.name,
      icPurchaseOrderId: po2.id,
    });
    expect(quote.lines[0]).toMatchObject({ quantity: "2.0000", priceUnit: "5500.0000", taxIds: [] });
  });

  it("komisi penjual: aturan per penjual, per tim, bawaan; dasar lunas hanya faktur lunas", async () => {
    const a = await signup(app, "komisi");
    const me = (await a.get("/auth/me")).body;
    const withSeller = (
      await a
        .post("/partners", { name: "PT Pelanggan Setia", isCustomer: true, salespersonId: me.userId })
        .expect(201)
    ).body.id;
    const walkIn = (await a.post("/partners", { name: "Pembeli Umum", isCustomer: true }).expect(201)).body
      .id;
    await a.post("/commission-plans", { name: "Bawaan", rate: 1, basis: "paid" }).expect(201);
    await a.post("/commission-plans", { name: "Admin", rate: 5, userId: me.userId }).expect(201);
    await a
      .post("/commission-plans", { name: "Salah", rate: 2, userId: me.userId, teamId: me.userId })
      .expect(400);

    const invoice = async (partnerId: string, priceUnit: number, moveType = "out_invoice") => {
      const draft = (
        await a
          .post("/moves", {
            moveType,
            partnerId,
            date: today,
            lines: [{ name: "Jasa", priceUnit, taxIds: [] }],
          })
          .expect(201)
      ).body;
      await a.post(`/moves/${draft.id}/post`).expect(200);
      return draft.id as string;
    };
    await invoice(withSeller, 1_000_000);
    await invoice(withSeller, 200_000, "out_refund");
    await invoice(walkIn, 500_000);

    const report = (await a.get(`/sales/commissions?dateFrom=${year}-01-01&dateTo=${year}-12-31`).expect(200))
      .body;
    expect(report.total).toBe("40000.00");
    expect(
      report.lines.map((l: { base: string; commission: string; planName: string; eligible: boolean }) => [
        l.base,
        l.planName,
        l.eligible,
        l.commission,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["1000000.00", "Admin", true, "50000.00"],
        ["-200000.00", "Admin", true, "-10000.00"],
        ["500000.00", "Bawaan", false, "0.00"],
      ]),
    );
    expect(report.salespeople).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: me.userId, base: "800000.00", commission: "40000.00" }),
      ]),
    );
    const xlsx = await a
      .get(`/sales/commissions/export?dateFrom=${year}-01-01&dateTo=${year}-12-31`)
      .expect(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
  });
});
