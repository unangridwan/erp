import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { Mailer } from "../src/common/mailer.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface MoveLine {
  accountId: string;
  displayType: string;
  quantity: string;
  debit: string;
  credit: string;
  saleLineId: string | null;
  productId: string | null;
  name: string;
  priceUnit: string;
  discount: string;
  taxIds: string[];
}

describe.skipIf(!hasDb)("Fase 2: CRM & penjualan", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let tenantId: string;
  let companyId: string;
  let adminId: string;
  let sales: Api;
  let salesUserId: string;
  const stage: Record<string, { id: string; probability: string }> = {};
  const acc: Record<string, string> = {};
  const term: Record<string, string> = {};
  let ppn: string;
  let customer: string;
  let laptop: string;
  let mouse: string;
  let electronics: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "crm");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    companyId = me.activeCompanyId;
    adminId = me.userId;
    for (const s of (await a.get("/crm-stages").expect(200)).body.items) stage[s.name] = s;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const t of (await a.get("/payment-terms").expect(200)).body.items) term[t.name] = t.id;
    ppn = (await a.get("/taxes?limit=200").expect(200)).body.items.find(
      (t: { name: string }) => t.name === "PPN Keluaran 12% (DPP 11/12)",
    ).id;

    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    electronics = (await a.post("/product-categories", { name: "Elektronik" }).expect(201)).body.id;
    const computers = (
      await a.post("/product-categories", { name: "Komputer", parentId: electronics }).expect(201)
    ).body.id;
    laptop = (
      await a
        .post("/products", {
          sku: "LPT-01",
          name: "Laptop 14",
          categoryId: computers,
          uomId: uom,
          salePrice: "1000000",
        })
        .expect(201)
    ).body.id;
    mouse = (
      await a
        .post("/products", {
          sku: "MS-01",
          name: "Mouse",
          categoryId: electronics,
          uomId: uom,
          salePrice: "50000",
        })
        .expect(201)
    ).body.id;
    customer = (
      await a
        .post("/partners", {
          name: "PT Pelanggan Baru",
          isCustomer: true,
          email: "beli@pelanggan.co.id",
          paymentTermId: term["Net 30 hari"],
        })
        .expect(201)
    ).body.id;

    // Role penjual: hanya melihat lead/pesanan miliknya atau yang belum ditugaskan.
    const db = app.get(TenantDb);
    const [role] = await db.runAs(tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "sales", name: "Penjual" }).returning({ id: schema.roles.id }),
    );
    await db.runAs(tenantId, (tx) =>
      tx
        .insert(schema.rolePermissions)
        .values(
          ["crm.read", "crm.write", "sales.read", "sales.write", "partner.read", "product.read"].map(
            (permission) => ({ roleId: role!.id, permission }),
          ),
        ),
    );
    salesUserId = (
      await a
        .post("/users", {
          name: "Budi Penjual",
          email: "budi@example.com",
          password: "rahasia123",
          roleIds: [role!.id],
          companyIds: [companyId],
        })
        .expect(201)
    ).body.id;
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "budi@example.com", password: "rahasia123" })
      .expect(200);
    sales = client(app, login.body.token);
  });

  afterAll(() => app?.close());

  it("signup menyiapkan tahap CRM, alasan kalah, termin, dan pajak bawaan", async () => {
    expect(Object.keys(stage)).toEqual(["Baru", "Kualifikasi", "Proposal", "Negosiasi", "Menang"]);
    expect(stage.Menang).toMatchObject({ isWon: true });
    expect((await a.get("/lost-reasons").expect(200)).body.total).toBe(4);
    expect(Object.keys(term)).toEqual(["Tunai", "Net 14 hari", "Net 30 hari", "Net 60 hari"]);
    const settings = (await a.get("/accounting/settings").expect(200)).body;
    expect(settings).toMatchObject({ defaultSaleTaxId: ppn, downPaymentAccountId: acc["2-1600"] });
  });

  describe("CRM", () => {
    let leadId: string;

    it("lead → konversi menjadi peluang dengan pelanggan baru", async () => {
      const lead = (
        await a
          .post("/leads", {
            leadType: "lead",
            name: "Pengadaan laptop kantor",
            partnerName: "CV Maju Jaya",
            contactName: "Ibu Sari",
            email: "sari@majujaya.id",
            source: "website",
            expectedRevenue: "50000000",
          })
          .expect(201)
      ).body;
      expect(lead).toMatchObject({ leadType: "lead", stageId: null, userId: adminId, state: "open" });
      leadId = lead.id;

      const converted = (await a.post(`/leads/${leadId}/convert`, { partner: "create" }).expect(200)).body;
      expect(converted).toMatchObject({
        leadType: "opportunity",
        stageId: stage.Baru!.id,
        probability: "10.00",
      });
      const partner = (await a.get(`/partners/${converted.partnerId}`).expect(200)).body;
      expect(partner).toMatchObject({ name: "CV Maju Jaya", email: "sari@majujaya.id", isCustomer: true });
    });

    it("pindah tahap mengikuti probabilitas; tahap menang menandai menang; buka kembali", async () => {
      const moved = (await a.patch(`/leads/${leadId}`, { stageId: stage.Proposal!.id }).expect(200)).body;
      expect(moved).toMatchObject({ probability: "60.00", state: "open" });
      const won = (await a.patch(`/leads/${leadId}`, { stageId: stage.Menang!.id }).expect(200)).body;
      expect(won).toMatchObject({ state: "won", probability: "100.00" });
      expect(won.closedAt).toBeTruthy();
      const reopened = (await a.post(`/leads/${leadId}/reopen`).expect(200)).body;
      expect(reopened).toMatchObject({
        state: "open",
        stageId: stage.Baru!.id,
        probability: "10.00",
        closedAt: null,
      });
    });

    it("tandai kalah dengan alasan, lalu pulihkan", async () => {
      const reason = (await a.get("/lost-reasons").expect(200)).body.items.find(
        (r: { name: string }) => r.name === "Memilih pesaing",
      );
      const lost = (
        await a
          .post(`/leads/${leadId}/lost`, { lostReasonId: reason.id, lostNote: "Harga pesaing lebih murah" })
          .expect(200)
      ).body;
      expect(lost).toMatchObject({ state: "lost", probability: "0.00", lostReasonId: reason.id });
      await a.patch(`/leads/${leadId}`, { stageId: stage.Proposal!.id }).expect(400);
      const pipeline = (await a.get("/leads/pipeline").expect(200)).body;
      expect(pipeline.lost.count).toBe(1);
      expect(pipeline.lostByReason).toEqual([{ reason: "Memilih pesaing", count: 1 }]);
      await a.post(`/leads/${leadId}/reopen`).expect(200);
    });

    it("pipeline: nilai tertimbang per tahap", async () => {
      await a
        .post("/leads", { name: "Peluang B", stageId: stage.Negosiasi!.id, expectedRevenue: "10000000" })
        .expect(201);
      const pipeline = (await a.get("/leads/pipeline").expect(200)).body;
      const row = (name: string) => pipeline.stages.find((s: { stageName: string }) => s.stageName === name);
      expect(row("Baru")).toMatchObject({ count: 1, expected: "50000000.00", weighted: "5000000.00" });
      expect(row("Negosiasi")).toMatchObject({ count: 1, expected: "10000000.00", weighted: "8000000.00" });
      const list = (await a.get("/leads?leadType=opportunity&state=open").expect(200)).body;
      expect(list.total).toBe(2);
    });

    it("aktivitas terjadwal: jadwalkan, daftar milik saya, selesai tercatat di riwayat", async () => {
      const act = (
        await a
          .post("/activities", {
            resModel: "crm_lead",
            resId: leadId,
            activityType: "call",
            summary: "Telepon follow-up",
            dueDate: "2026-10-20",
          })
          .expect(201)
      ).body;
      expect((await a.get(`/activities?resModel=crm_lead&resId=${leadId}`).expect(200)).body).toHaveLength(1);
      const mine = (await a.get("/activities/mine").expect(200)).body;
      expect(mine).toEqual([expect.objectContaining({ id: act.id, recordName: "Pengadaan laptop kantor" })]);
      const leads = (await a.get("/leads?q=laptop").expect(200)).body.items;
      expect(leads[0].nextActivity).toBe("2026-10-20");

      await a.post(`/activities/${act.id}/done`, { feedback: "Minta penawaran" }).expect(200);
      expect((await a.get("/activities/mine").expect(200)).body).toHaveLength(0);
      const log = (await a.get(`/activity/crm_lead/${leadId}`).expect(200)).body;
      expect(log[0].message).toBe("Aktivitas selesai: Telepon follow-up — Minta penawaran");
    });

    it("aturan rekaman: penjual hanya melihat lead miliknya atau yang belum ditugaskan", async () => {
      const own = (await sales.post("/leads", { name: "Lead milik Budi" }).expect(201)).body;
      expect(own.userId).toBe(salesUserId);
      const unassigned = (await a.post("/leads", { name: "Lead umum", userId: null }).expect(201)).body;
      const names = (await sales.get("/leads").expect(200)).body.items.map((l: { name: string }) => l.name);
      expect(names.sort()).toEqual(["Lead milik Budi", "Lead umum"]);
      await sales.get(`/leads/${leadId}`).expect(404);
      await sales
        .post("/activities", { resModel: "crm_lead", resId: leadId, summary: "x", dueDate: "2026-10-20" })
        .expect(404);
      await sales.post("/crm-stages", { name: "Tahap baru" }).expect(403);
      // Admin melihat semua.
      expect((await a.get("/leads").expect(200)).body.total).toBe(4);
      await a.delete(`/leads/${unassigned.id}`).expect(204);
    });
  });

  describe("daftar harga", () => {
    let pricelistId: string;

    it("aturan per kategori induk, per produk dengan minimum kuantitas, dan promo bertanggal", async () => {
      pricelistId = (
        await a
          .post("/pricelists", {
            name: "Grosir",
            items: [
              { categoryId: electronics, compute: "discount", discount: "10" },
              { productId: laptop, compute: "fixed", fixedPrice: "850000", minQuantity: "10" },
              {
                productId: mouse,
                compute: "discount",
                discount: "50",
                dateStart: "2026-12-01",
                dateEnd: "2026-12-31",
              },
            ],
          })
          .expect(201)
      ).body.id;
      const lists = (await a.get("/pricelists").expect(200)).body.items;
      expect(lists).toEqual([expect.objectContaining({ id: pricelistId, itemCount: 3 })]);
      const compute = (dateOrder: string, lines: object[]) =>
        a.post("/sale-orders/compute", { partnerId: customer, pricelistId, dateOrder, lines }).expect(200);

      const res = (
        await compute("2026-10-15", [
          { productId: laptop, quantity: "2" },
          { productId: laptop, quantity: "10" },
          { productId: mouse, quantity: "1" },
        ])
      ).body;
      expect(res.lines.map((l: { priceUnit: string }) => l.priceUnit)).toEqual([
        "900000.0000",
        "850000.0000",
        "45000.0000",
      ]);
      const promo = (await compute("2026-12-10", [{ productId: mouse, quantity: "1" }])).body;
      expect(promo.lines[0].priceUnit).toBe("25000.0000");
      // Termin & pajak bawaan diambil dari pelanggan & pengaturan.
      expect(res.paymentTermId).toBe(term["Net 30 hari"]);
      expect(res.lines[0].taxIds).toEqual([ppn]);
    });

    it("daftar harga bawaan pelanggan dipakai bila tidak dipilih", async () => {
      await a.patch(`/partners/${customer}`, { pricelistId }).expect(200);
      const res = (
        await a
          .post("/sale-orders/compute", {
            partnerId: customer,
            dateOrder: "2026-10-15",
            lines: [{ productId: laptop }],
          })
          .expect(200)
      ).body;
      expect(res).toMatchObject({
        pricelistId,
        lines: [expect.objectContaining({ priceUnit: "900000.0000" })],
      });
      await a.patch(`/partners/${customer}`, { pricelistId: null }).expect(200);
    });
  });

  describe("penawaran → pesanan → faktur", () => {
    let orderId: string;
    let leadId: string;
    let dpInvoiceId: string;
    let finalInvoiceId: string;

    it("membuat penawaran dari peluang dengan nomor SO dan total PPN 12% (DPP 11/12)", async () => {
      leadId = (
        await a.post("/leads", { name: "Laptop untuk PT Pelanggan Baru", partnerId: customer }).expect(201)
      ).body.id;
      const order = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            leadId,
            dateOrder: "2026-10-15",
            validityDate: "2026-10-30",
            clientOrderRef: "PO-PLG-77",
            lines: [{ productId: laptop, quantity: "2" }],
          })
          .expect(201)
      ).body;
      orderId = order.id;
      expect(order).toMatchObject({
        name: "SO/2026/0001",
        state: "draft",
        currencyCode: "IDR",
        amountUntaxed: "2000000.00",
        amountTax: "220000.00",
        amountTotal: "2220000.00",
        invoiceStatus: "no",
        paymentTermName: "Net 30 hari",
        leadName: "Laptop untuk PT Pelanggan Baru",
      });
      expect(order.lines[0]).toMatchObject({
        name: "Laptop 14",
        priceUnit: "1000000.0000",
        priceSubtotal: "2000000.00",
      });
      expect(order.taxes).toEqual([
        expect.objectContaining({ name: "PPN Keluaran 12% (DPP 11/12)", amount: "220000.00" }),
      ]);
    });

    it("ubah penawaran; validasi baris tanpa harga & pajak pembelian", async () => {
      const body = {
        partnerId: customer,
        leadId,
        dateOrder: "2026-10-15",
        clientOrderRef: "PO-PLG-77",
        lines: [
          { productId: laptop, quantity: "2" },
          { name: "Jasa instalasi", quantity: "1", priceUnit: "250000", discount: "20" },
        ],
      };
      const updated = (await a.put(`/sale-orders/${orderId}`, body).expect(200)).body;
      expect(updated).toMatchObject({
        amountUntaxed: "2200000.00",
        amountTax: "242000.00",
        amountTotal: "2442000.00",
      });
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: "2026-10-15",
          lines: [{ name: "Tanpa harga" }],
        })
        .expect(400);
      const purchaseTax = (await a.get("/taxes?limit=200").expect(200)).body.items.find(
        (t: { typeTaxUse: string }) => t.typeTaxUse === "purchase",
      ).id;
      const bad = await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: "2026-10-15",
          lines: [{ productId: mouse, taxIds: [purchaseTax] }],
        })
        .expect(400);
      expect(bad.body.errors[0].path).toBe("lines.0.taxIds");
    });

    it("PDF penawaran & kirim email dengan lampiran (draft → terkirim)", async () => {
      const pdf = await a
        .get(`/sale-orders/${orderId}/pdf`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers["content-type"]).toContain("application/pdf");
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

      const sent = (await a.post(`/sale-orders/${orderId}/send`, {}).expect(200)).body;
      expect(sent.state).toBe("sent");
      const mail = app.get(Mailer).outbox.at(-1)!;
      expect(mail).toMatchObject({ to: "beli@pelanggan.co.id", subject: "Penawaran SO/2026/0001" });
      expect(mail.attachments?.[0]?.filename).toBe("SO_2026_0001.pdf");
    });

    it("konfirmasi: menjadi pesanan, peluang ditandai menang", async () => {
      const order = (await a.post(`/sale-orders/${orderId}/confirm`).expect(200)).body;
      expect(order).toMatchObject({ state: "sale", invoiceStatus: "to_invoice" });
      await a
        .put(`/sale-orders/${orderId}`, {
          partnerId: customer,
          dateOrder: "2026-10-15",
          lines: [{ productId: laptop }],
        })
        .expect(400);
      const lead = (await a.get(`/leads/${leadId}`).expect(200)).body;
      expect(lead).toMatchObject({ state: "won", stageId: stage.Menang!.id });
    });

    it("faktur uang muka 30%: akun uang muka pelanggan, PPN, jatuh tempo dari termin", async () => {
      dpInvoiceId = (
        await a
          .post(`/sale-orders/${orderId}/invoice`, {
            method: "percentage",
            percentage: 30,
            date: "2026-10-16",
          })
          .expect(201)
      ).body.moveId;
      const inv = (await a.get(`/moves/${dpInvoiceId}`).expect(200)).body;
      expect(inv).toMatchObject({
        moveType: "out_invoice",
        invoiceOrigin: "SO/2026/0001",
        ref: "PO-PLG-77",
        dueDate: "2026-11-15",
        amountUntaxed: "660000.00",
        amountTax: "72600.00",
        amountTotal: "732600.00",
      });
      const product = (inv.lines as MoveLine[]).find((l) => l.displayType === "product")!;
      expect(product).toMatchObject({ accountId: acc["2-1600"], credit: "660000.00" });
      await a.post(`/moves/${dpInvoiceId}/post`).expect(200);

      const order = (await a.get(`/sale-orders/${orderId}`).expect(200)).body;
      const dp = order.lines.find((l: { isDownpayment: boolean }) => l.isDownpayment);
      expect(dp).toMatchObject({ quantity: "0.0000", qtyInvoiced: "1.0000", priceUnit: "660000.0000" });
      expect(order.amountTotal).toBe("2442000.00");
      expect(order.invoiceStatus).toBe("to_invoice");
      expect(order.invoices).toHaveLength(1);
    });

    it("faktur akhir: sisa kuantitas dikurangi uang muka; status menjadi tertagih", async () => {
      finalInvoiceId = (
        await a.post(`/sale-orders/${orderId}/invoice`, { method: "regular", date: "2026-10-20" }).expect(201)
      ).body.moveId;
      const inv = (await a.get(`/moves/${finalInvoiceId}`).expect(200)).body;
      expect(inv).toMatchObject({
        amountUntaxed: "1540000.00",
        amountTax: "169400.00",
        amountTotal: "1709400.00",
      });
      const products = (inv.lines as MoveLine[]).filter((l) => l.displayType === "product");
      expect(products.map((l) => [l.quantity, l.debit, l.credit])).toEqual([
        ["2.0000", "0.00", "2000000.00"],
        ["1.0000", "0.00", "200000.00"],
        ["-1.0000", "660000.00", "0.00"],
      ]);
      expect(products.every((l) => l.saleLineId)).toBe(true);

      let order = (await a.get(`/sale-orders/${orderId}`).expect(200)).body;
      expect(order.invoiceStatus).toBe("invoiced");
      expect(order.lines.map((l: { qtyInvoiced: string }) => l.qtyInvoiced)).toEqual([
        "2.0000",
        "1.0000",
        "0.0000",
      ]);
      await a.post(`/sale-orders/${orderId}/invoice`, { method: "regular" }).expect(400);
      // Draft faktur menahan pembatalan pesanan.
      await a.post(`/sale-orders/${orderId}/cancel`).expect(400);

      // Mengubah draft faktur tetap menjaga tautan ke baris pesanan.
      await a
        .patch(`/moves/${finalInvoiceId}`, {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-10-21",
          lines: products.map((l) => ({
            productId: l.productId,
            accountId: l.accountId,
            discount: l.discount,
            name: l.name,
            quantity: l.quantity,
            priceUnit: l.priceUnit,
            taxIds: l.taxIds,
          })),
        })
        .expect(200);
      order = (await a.get(`/sale-orders/${orderId}`).expect(200)).body;
      expect(order.invoiceStatus).toBe("invoiced");
    });

    it("pembalikan faktur akhir mengembalikan status 'perlu ditagih'", async () => {
      await a.post(`/moves/${finalInvoiceId}/post`).expect(200);
      await a.post(`/moves/${finalInvoiceId}/reverse`, {}).expect(201);
      const order = (await a.get(`/sale-orders/${orderId}`).expect(200)).body;
      expect(order.invoiceStatus).toBe("to_invoice");
      expect(order.lines.map((l: { qtyInvoiced: string }) => l.qtyInvoiced)).toEqual([
        "0.0000",
        "0.0000",
        "1.0000",
      ]);
      expect(order.invoices.map((i: { moveType: string }) => i.moveType).sort()).toEqual([
        "out_invoice",
        "out_invoice",
        "out_refund",
      ]);
      await a.post(`/sale-orders/${orderId}/cancel`).expect(400);
      await a.delete(`/leads/${leadId}`).expect(400);
    });

    it("batal, kembali ke draft, dan hapus penawaran tanpa faktur", async () => {
      const q = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder: "2026-10-18",
            lines: [{ productId: mouse, quantity: "3" }],
          })
          .expect(201)
      ).body;
      expect(q.name).toBe("SO/2026/0002");
      await a.post(`/sale-orders/${q.id}/confirm`).expect(200);
      await a.delete(`/sale-orders/${q.id}`).expect(400);
      expect((await a.post(`/sale-orders/${q.id}/cancel`).expect(200)).body).toMatchObject({
        state: "cancel",
        invoiceStatus: "no",
      });
      expect((await a.post(`/sale-orders/${q.id}/draft`).expect(200)).body.state).toBe("draft");
      await a.delete(`/sale-orders/${q.id}`).expect(204);
    });

    it("penjual hanya melihat pesanannya; membuat faktur butuh hak akuntansi", async () => {
      const own = (
        await sales
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder: "2026-10-19",
            lines: [{ productId: mouse }],
          })
          .expect(201)
      ).body;
      expect(own.userId).toBe(salesUserId);
      const names = (await sales.get("/sale-orders").expect(200)).body.items.map(
        (o: { name: string }) => o.name,
      );
      expect(names).toEqual([own.name]);
      await sales.get(`/sale-orders/${orderId}`).expect(404);
      await sales.post(`/sale-orders/${own.id}/confirm`).expect(200);
      await sales.post(`/sale-orders/${own.id}/invoice`, { method: "regular" }).expect(403);
      expect((await a.get("/sale-orders?invoiceStatus=to_invoice").expect(200)).body.total).toBe(2);
    });

    it("analisis penjualan per produk, pelanggan, dan bulan", async () => {
      const q = "from=2026-10-01&to=2026-10-31";
      const byProduct = (await a.get(`/sale-orders/report?${q}&groupBy=product`).expect(200)).body;
      expect(byProduct.map((r: { label: string; amount: string }) => [r.label, r.amount])).toEqual([
        ["Laptop 14", "2000000.00"],
        ["Jasa instalasi", "200000.00"],
        ["Mouse", "50000.00"],
      ]);
      const byPartner = (await a.get(`/sale-orders/report?${q}&groupBy=partner`).expect(200)).body;
      expect(byPartner).toEqual([
        expect.objectContaining({ label: "PT Pelanggan Baru", orders: 2, amount: "2250000.00" }),
      ]);
      const byMonth = (await a.get(`/sale-orders/report?${q}&groupBy=month`).expect(200)).body;
      expect(byMonth).toEqual([expect.objectContaining({ key: "2026-10", orders: 2 })]);
    });
  });
});
