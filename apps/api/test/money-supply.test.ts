import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "@erp/shared";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = businessToday();
const shift = (days: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

interface Flow {
  key: string;
  amount: number;
}

describe.skipIf(!hasDb)("Arus uang & rantai pasok", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sales: ReturnType<typeof client>;
  const acc: Record<string, string> = {};
  const jr: Record<string, string> = {};
  let openInvoice = "";

  const entry = async (
    date: string,
    lines: { accountId: string; debit?: number; credit?: number; costCenterId?: string }[],
  ) => {
    const m = (await a.post("/moves", { date, lines }).expect(201)).body;
    await a.post(`/moves/${m.id}/post`).expect(200);
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "money");
    const me = (await a.get("/auth/me")).body;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    const role = (
      await a.post("/roles", { code: "jual", name: "Jual", permissions: ["sales.read"] }).expect(201)
    ).body.id;
    await a
      .post("/users", {
        name: "Penjual",
        email: "jual@example.com",
        password: "rahasia123",
        roleIds: [role],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    sales = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "jual@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const customer = (await a.post("/partners", { name: "PT Pembeli", isCustomer: true }).expect(201)).body
      .id;

    // Sama dengan skenario laporan arus kas: modal 100 jt sebelum periode; 2026: penjualan 50 jt diterima 30 jt,
    // beli traktor 40 jt, sewa 5 jt, pinjaman bank 20 jt.
    await entry("2025-12-31", [
      { accountId: acc["1-1200"]!, debit: 100_000_000 },
      { accountId: acc["3-1000"]!, credit: 100_000_000 },
    ]);
    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-02-10",
          lines: [{ name: "Benih", priceUnit: 50_000_000, accountId: acc["4-1000"] }],
        })
        .expect(201)
    ).body;
    openInvoice = inv.id;
    await a.post(`/moves/${inv.id}/post`).expect(200);
    await a
      .post("/payments", {
        paymentType: "inbound",
        partnerId: customer,
        journalId: jr.BNK1,
        amount: 30_000_000,
        date: "2026-03-01",
        moveIds: [inv.id],
      })
      .expect(201);
    await entry("2026-03-05", [
      { accountId: acc["1-2200"]!, debit: 40_000_000 },
      { accountId: acc["1-1200"]!, credit: 40_000_000 },
    ]);
    // Sewa dibebankan ke cost center departemen Umum (anggaran 10 jt).
    const cc = (await a.post("/cost-centers", { code: "CC-UM", name: "Umum" }).expect(201)).body.id;
    await a.post("/departments", { name: "Umum", costCenterId: cc }).expect(201);
    await a.post("/departments", { name: "Tanpa CC" }).expect(201);
    await a
      .post("/budgets", {
        name: "Anggaran Umum 2026",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        lines: [{ accountId: acc["6-2000"], amount: "10000000", costCenterId: cc }],
      })
      .expect(201);
    await entry("2026-04-01", [
      { accountId: acc["6-2000"]!, debit: 5_000_000, costCenterId: cc },
      { accountId: acc["1-1200"]!, credit: 5_000_000 },
    ]);
    await entry("2026-05-01", [
      { accountId: acc["1-1200"]!, debit: 20_000_000 },
      { accountId: acc["2-2100"]!, credit: 20_000_000 },
    ]);

    // Rantai pasok: terima barang dari pemasok (1 PO tepat waktu, 1 terlambat), lalu kirim ke pelanggan.
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const item = (
      await a.post("/products", { sku: "BRG", name: "Barang", uomId: uom, salePrice: "1000" }).expect(201)
    ).body.id;
    const vendor = (await a.post("/partners", { name: "PT Pemasok", isSupplier: true }).expect(201)).body.id;
    for (const datePlanned of [shift(1), shift(-2)]) {
      const po = (
        await a
          .post("/purchase-orders", {
            partnerId: vendor,
            dateOrder: shift(-5),
            datePlanned,
            lines: [{ productId: item, quantity: "10", priceUnit: "500", taxIds: [] }],
          })
          .expect(201)
      ).body.id;
      const confirmed = (await a.post(`/purchase-orders/${po}/confirm`).expect(200)).body;
      await a.post(`/pickings/${confirmed.pickings[0].id}/validate`, {}).expect(200);
    }
    // Dua pengiriman: jadwal hari ini (tepat waktu) & kemarin (terlambat 1 hari).
    for (const dateOrder of [today, shift(-1)]) {
      const so = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder,
            lines: [{ productId: item, quantity: 2, priceUnit: 1000, taxIds: [] }],
          })
          .expect(201)
      ).body.id;
      const confirmed = (await a.post(`/sale-orders/${so}/confirm`).expect(200)).body;
      const picking =
        confirmed.pickings?.[0]?.id ?? (await a.get(`/sale-orders/${so}`).expect(200)).body.pickings[0].id;
      await a.post(`/pickings/${picking}/validate`, {}).expect(200);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it("arus kas per kategori seimbang dengan perubahan saldo & laporan arus kas", async () => {
    const c = (await a.get("/flow/money/cash?from=2026-01-01&to=2026-12-31").expect(200)).body;
    expect(c).toMatchObject({
      opening: 100_000_000,
      inflow: 50_000_000,
      outflow: 45_000_000,
      net: 5_000_000,
    });
    expect(c.unexplained).toBe(0);
    expect(c.closing - c.opening).toBe(c.net);
    const amount = (list: Flow[], key: string) => list.find((x) => x.key === key)?.amount;
    expect(amount(c.inflows, "customers")).toBe(30_000_000);
    expect(amount(c.inflows, "financing_in")).toBe(20_000_000);
    expect(amount(c.outflows, "capex")).toBe(40_000_000);
    expect(amount(c.outflows, "opex")).toBe(5_000_000);
    expect(c.byMonth.map((m: { month: string }) => m.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
    // Sama dengan laporan arus kas (metode tidak langsung).
    const report = (await a.get("/reports/cash-flow?dateFrom=2026-01-01&dateTo=2026-12-31").expect(200)).body;
    expect(Number(report.netChange)).toBe(c.net);
  });

  it("proyeksi kas: piutang terbuka lewat jatuh tempo masuk minggu pertama", async () => {
    const f = (await a.get("/flow/money/forecast?weeks=4").expect(200)).body;
    const residual = Number((await a.get(`/moves/${openInvoice}`).expect(200)).body.amountResidual);
    expect(f.weeks).toHaveLength(4);
    expect(f.overdue.receivables).toBe(residual);
    expect(f.weeks[0].receivables).toBeGreaterThanOrEqual(residual);
    expect(f.weeks[0].balance).toBe(Math.round((f.opening + f.weeks[0].net) * 100) / 100);
    await a.get("/flow/money/forecast?weeks=2").expect(400);

    const cyc = (await a.get("/flow/money/cycle?to=2026-06-30").expect(200)).body;
    expect(cyc.months).toHaveLength(12);
    expect(cyc.months.at(-1).month).toBe("2026-06");
    // Piutang akhir Februari: 50 jt (belum ada pembayaran).
    expect(cyc.months.find((m: { month: string }) => m.month === "2026-02")).toMatchObject({
      ar: 50_000_000,
    });
  });

  it("anggaran vs realisasi per departemen lewat cost center", async () => {
    const b = (await a.get("/flow/money/budget?from=2026-01-01&to=2026-12-31").expect(200)).body;
    expect(b.items.find((d: { department: string }) => d.department === "Umum")).toMatchObject({
      budget: 10_000_000,
      actual: 5_000_000,
      percent: 50,
    });
    expect(b.items.find((d: { department: string }) => d.department === "Tanpa CC")).toMatchObject({
      costCenter: null,
      actual: null,
    });
  });

  it("OTIF pengiriman dengan toleransi, kinerja pemasok, dan umur persediaan", async () => {
    const d0 = (await a.get("/flow/supply/deliveries").expect(200)).body;
    expect(d0.summary).toEqual({ count: 2, onTime: 50, inFull: 100, otif: 50 });
    expect(d0.late).toHaveLength(1);
    expect(d0.late[0]).toMatchObject({ daysLate: 1, onTime: false, inFull: true });
    const d1 = (await a.get("/flow/supply/deliveries?tolerance=1").expect(200)).body;
    expect(d1.summary.otif).toBe(100);

    const s = (await a.get("/flow/supply/suppliers").expect(200)).body;
    expect(s.items).toEqual([
      expect.objectContaining({
        partner: "PT Pemasok",
        receipts: 2,
        onTime: 50,
        inFull: 100,
        leadActual: 5,
        score: 75,
      }),
    ]);

    const st = (await a.get("/flow/supply/stock").expect(200)).body;
    // 20 masuk @500, 4 keluar: sisa 16 × 500 = 8.000, semuanya baru (0–30 hari).
    expect(st.value).toBe(8_000);
    expect(st.aging[0]).toMatchObject({ key: "0-30", value: 8_000, share: 100 });
    expect(st.deadStock.count).toBe(0);
  });

  it("dataset BI arus kas & pengiriman bisa dipakai di editor BI", async () => {
    const layout = { x: 0, y: 0, w: 6, h: 4 };
    const [byCategory, otif] = (
      await a
        .post("/bi/query", {
          from: "2026-01-01",
          to: "2026-12-31",
          visuals: [
            {
              id: "c",
              type: "table",
              dataset: "cash_flows",
              layout,
              axis: [{ column: "category" }],
              values: [{ id: "m", column: "amount", fn: "sum" }],
            },
            {
              id: "d",
              type: "table",
              dataset: "deliveries",
              layout,
              ignorePeriod: true,
              axis: [{ column: "kind" }, { column: "otif" }],
              values: [{ id: "n", column: "*", fn: "count" }],
            },
          ],
        })
        .expect(200)
    ).body.visuals;
    const cat = Object.fromEntries(
      (byCategory.rows as Record<string, unknown>[]).map((r) => [r.category, r.m]),
    );
    expect(cat).toMatchObject({
      Pelanggan: 30_000_000,
      "Aset tetap": -40_000_000,
      "Pinjaman & modal": 20_000_000,
    });
    expect(otif.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "Pengiriman", otif: "Ya", n: 1 }),
        expect.objectContaining({ kind: "Pengiriman", otif: "Tidak", n: 1 }),
        expect.objectContaining({ kind: "Penerimaan", otif: "Ya", n: 1 }),
      ]),
    );
  });

  it("hak akses: tanpa hak akuntansi/persediaan/pembelian ditolak", async () => {
    await sales.get("/flow/money/cash").expect(403);
    await sales.get("/flow/money/forecast").expect(403);
    await sales.get("/flow/supply/deliveries").expect(403);
    await sales.get("/flow/supply/suppliers").expect(403);
    await a.get("/flow/money/cash?from=2026-12-31&to=2026-01-01").expect(400);
  });
});
