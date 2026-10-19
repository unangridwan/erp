import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!hasDb)("Item tunda Fase 2–3: varian produk & portal pelanggan", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  it("varian: atribut × nilai menghasilkan produk varian (SKU, nama, harga tambahan); induk tidak bisa dijual", async () => {
    const a = await signup(app, "variant");
    const uomId = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const color = (await a.post("/product-attributes", { name: "Warna", sequence: 1 }).expect(201)).body.id;
    const size = (await a.post("/product-attributes", { name: "Ukuran", sequence: 2 }).expect(201)).body.id;
    const value = async (attributeId: string, name: string, extra = 0, code?: string) =>
      (await a.post("/product-attribute-values", { attributeId, name, priceExtra: extra, code }).expect(201))
        .body.id as string;
    const red = await value(color, "Merah", 0, "MRH");
    const blue = await value(color, "Biru", 0, "BRU");
    const m = await value(size, "M");
    const xl = await value(size, "XL", 5000);
    const shirt = (
      await a
        .post("/products", { sku: "KAOS", name: "Kaos Polos", uomId, salePrice: "50000", cost: "30000" })
        .expect(201)
    ).body.id;

    const gen = (
      await a
        .post(`/products/${shirt}/variants`, {
          values: [
            [m, xl],
            [red, blue],
          ],
        })
        .expect(201)
    ).body;
    expect(gen.created).toBe(4);
    expect(gen.template.isVariantTemplate).toBe(true);
    const list = (await a.get(`/products/${shirt}/variants`).expect(200)).body;
    expect(list.template.isVariantTemplate).toBe(true);
    expect(
      list.variants.map((v: { sku: string; name: string; salePrice: string }) => [
        v.sku,
        v.name,
        v.salePrice,
      ]),
    ).toEqual([
      ["KAOS-BRU-M", "Kaos Polos (Biru, M)", "50000.00"],
      ["KAOS-BRU-XL", "Kaos Polos (Biru, XL)", "55000.00"],
      ["KAOS-MRH-M", "Kaos Polos (Merah, M)", "50000.00"],
      ["KAOS-MRH-XL", "Kaos Polos (Merah, XL)", "55000.00"],
    ]);
    expect(list.variants[0].attributes).toEqual([
      { attribute: "Warna", value: "Biru" },
      { attribute: "Ukuran", value: "M" },
    ]);
    // Generate ulang dengan nilai tambahan hanya membuat kombinasi baru.
    const black = await value(color, "Hitam");
    const again = (
      await a
        .post(`/products/${shirt}/variants`, {
          values: [
            [m, xl],
            [red, blue, black],
          ],
        })
        .expect(201)
    ).body;
    expect(again.created).toBe(2);
    await a.post(`/products/${shirt}/variants`, { values: [[m], [xl]] }).expect(400);
    await a.post(`/products/${list.variants[0].id}/variants`, { values: [[m]] }).expect(400);

    const customer = (await a.post("/partners", { name: "Toko Baju", isCustomer: true }).expect(201)).body.id;
    const bad = await a
      .post("/sale-orders", {
        partnerId: customer,
        dateOrder: today,
        lines: [{ productId: shirt, quantity: "1" }],
      })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("pilih variannya");
    const ok = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ productId: list.variants[1].id, quantity: "2", taxIds: [] }],
        })
        .expect(201)
    ).body;
    expect(ok.amountTotal).toBe("110000.00");
  });

  it("portal: undang pelanggan, terima undangan, lihat & setujui penawaran, lihat faktur; data pelanggan lain tertutup", async () => {
    const a = await signup(app, "portal");
    const server = app.getHttpServer();
    const customer = (
      await a
        .post("/partners", { name: "PT Pelanggan Portal", isCustomer: true, email: "beli@pelanggan.id" })
        .expect(201)
    ).body.id;
    const other = (await a.post("/partners", { name: "PT Lain", isCustomer: true }).expect(201)).body.id;
    const quote = async (partnerId: string, priceUnit: string) => {
      const so = (
        await a
          .post("/sale-orders", {
            partnerId,
            dateOrder: today,
            lines: [{ name: "Jasa konsultasi", quantity: "1", priceUnit, taxIds: [] }],
          })
          .expect(201)
      ).body;
      await a.post(`/sale-orders/${so.id}/send`, { to: "pembeli@contoh.id" }).expect(200);
      return so.id as string;
    };
    const mine = await quote(customer, "1000000");
    const theirs = await quote(other, "2000000");
    const draft = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ name: "Draft", quantity: "1", priceUnit: "1", taxIds: [] }],
        })
        .expect(201)
    ).body.id;

    await a.post(`/partners/${other}/portal-invite`, {}).expect(400); // tanpa email
    const invite = (await a.post(`/partners/${customer}/portal-invite`, {}).expect(200)).body;
    expect(invite).toMatchObject({ email: "beli@pelanggan.id", invitePending: true, hasPassword: false });
    const token = decodeURIComponent(invite.inviteUrl.split("#token=")[1]);
    const session = (
      await request(server).post("/portal/auth/accept").send({ token, password: "rahasia123" }).expect(200)
    ).body;
    expect(session).toMatchObject({ partnerName: "PT Pelanggan Portal" });
    await request(server).post("/portal/auth/accept").send({ token, password: "rahasia123" }).expect(400);

    const portal = (url: string) => request(server).get(url).set("Authorization", `Bearer ${session.token}`);
    // Token portal tidak berlaku di API internal, dan sebaliknya.
    await request(server).get("/partners").set("Authorization", `Bearer ${session.token}`).expect(401);
    await request(server).get("/portal/me").set("Authorization", `Bearer ${a.token}`).expect(401);

    const login = (
      await request(server)
        .post("/portal/auth/login")
        .send({ tenantSlug: a.slug, email: "beli@pelanggan.id", password: "rahasia123" })
        .expect(200)
    ).body;
    expect(login.token).toBeTruthy();
    await request(server)
      .post("/portal/auth/login")
      .send({ tenantSlug: a.slug, email: "beli@pelanggan.id", password: "salah" })
      .expect(401);

    const orders = (await portal("/portal/orders").expect(200)).body as { id: string }[];
    expect(orders.map((o) => o.id)).toEqual([mine]);
    await portal(`/portal/orders/${theirs}`).expect(404);
    await portal(`/portal/orders/${draft}`).expect(404);
    const detail = (await portal(`/portal/orders/${mine}`).expect(200)).body;
    expect(detail).toMatchObject({ state: "sent", canAccept: true, amountTotal: "1000000.00" });
    const pdf = await portal(`/portal/orders/${mine}/pdf`).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");

    const accepted = (
      await request(server)
        .post(`/portal/orders/${mine}/accept`)
        .set("Authorization", `Bearer ${session.token}`)
        .expect(200)
    ).body;
    expect(accepted).toMatchObject({ state: "sale", canAccept: false });
    const staffView = (await a.get(`/sale-orders/${mine}`).expect(200)).body;
    expect(staffView.state).toBe("sale");
    const log = (await a.get(`/activity/sale_order/${mine}`).expect(200)).body as {
      message: string | null;
    }[];
    expect(log.some((l) => l.message?.includes("portal"))).toBe(true);

    const invoiceId = (await a.post(`/sale-orders/${mine}/invoice`, { method: "regular" }).expect(201)).body
      .moveId;
    expect((await portal("/portal/invoices").expect(200)).body).toEqual([]); // draft belum tampil
    await a.post(`/moves/${invoiceId}/post`).expect(200);
    const invoices = (await portal("/portal/invoices").expect(200)).body;
    expect(invoices).toEqual([
      expect.objectContaining({ id: invoiceId, amountTotal: "1000000.00", paymentState: "not_paid" }),
    ]);
    const inv = (await portal(`/portal/invoices/${invoiceId}`).expect(200)).body;
    expect(inv.lines).toEqual([expect.objectContaining({ name: "Jasa konsultasi", subtotal: "1000000.00" })]);
    await portal(`/portal/invoices/${invoiceId}/pdf`).expect(200);
    expect((await portal("/portal/me").expect(200)).body).toMatchObject({ openBalance: "1000000.00" });

    // Cabut akses → token lama tidak berlaku.
    await a.post(`/partners/${customer}/portal-revoke`).expect(200);
    await portal("/portal/me").expect(401);
  });
});
