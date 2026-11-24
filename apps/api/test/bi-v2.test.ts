import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

const today = businessToday();
const year = today.slice(0, 4);
const lastYearDay = `${Number(year) - 1}${today.slice(4)}`;
const layout = { x: 0, y: 0, w: 6, h: 6 };

interface Result {
  id: string;
  hidden?: boolean;
  error?: string;
  categories: { key: string; label: string }[];
  series: { label: string; values: (number | null)[] }[];
  rows: Record<string, unknown>[];
  totals: Record<string, number | null>;
  card?: { value: number | null; previous?: number | null; change?: number | null };
  rowCount: number;
}

describe.skipIf(!hasDb)("Mesin BI v2: /bi/query & dokumen dashboard", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sales: ReturnType<typeof client>;

  const query = async (body: object, as = a) =>
    (await as.post("/bi/query", body).expect(200)).body.visuals as Result[];

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "biv2");
    const me = (await a.get("/auth/me")).body;
    const role = (
      await a
        .post("/roles", { code: "sales_bi", name: "Sales", permissions: ["sales.read", "sales.write"] })
        .expect(201)
    ).body.id;
    await a
      .post("/users", {
        name: "Sari",
        email: "sari@example.com",
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
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    const product = (
      await a.post("/products", { sku: "BNH", name: "Benih Padi", uomId: pcs, cost: "4000" }).expect(201)
    ).body.id;
    const tani = (await a.post("/partners", { name: "Koperasi Tani", isCustomer: true }).expect(201)).body.id;
    const makmur = (await a.post("/partners", { name: "UD Makmur", isCustomer: true }).expect(201)).body.id;
    for (const [partnerId, date, qty] of [
      [tani, today, "10"],
      [makmur, today, "5"],
      [tani, lastYearDay, "4"],
    ] as const) {
      const so = (
        await a
          .post("/sale-orders", {
            partnerId,
            dateOrder: date,
            lines: [{ productId: product, quantity: qty, priceUnit: "10000" }],
          })
          .expect(201)
      ).body;
      await a.post(`/sale-orders/${so.id}/confirm`).expect(200);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it("menjalankan banyak visual: hierarki tanggal, rumus, filter silang, pembanding", async () => {
    const [byYear, byPartner, kpi, yoy] = await query({
      visuals: [
        {
          id: "y",
          type: "column",
          dataset: "sales_orders",
          layout,
          axis: [
            { column: "dateOrder", level: "year" },
            { column: "dateOrder", level: "month" },
          ],
          values: [{ id: "m1", column: "amountUntaxed", fn: "sum" }],
        },
        {
          id: "p",
          type: "table",
          dataset: "sales_orders",
          layout,
          axis: [{ column: "partner" }],
          values: [
            { id: "omzet", label: "Omzet", column: "amountUntaxed", fn: "sum" },
            { id: "n", label: "Pesanan", column: "*", fn: "count" },
            { id: "avg", label: "Rata-rata", formula: "DIVIDE([Omzet], [Pesanan])" },
          ],
          sort: { by: "partner", dir: "asc" },
        },
        {
          id: "k",
          type: "kpi",
          dataset: "sales_orders",
          layout,
          values: [{ id: "m1", column: "amountUntaxed", fn: "sum" }],
          options: { compare: "last_year" },
        },
        {
          id: "g",
          type: "column",
          dataset: "sales_orders",
          layout,
          axis: [{ column: "partner" }],
          values: [{ id: "m1", column: "amountUntaxed", fn: "sum", showAs: "yoy" }],
        },
      ],
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    });
    // Periode tahun ini: hanya 2 pesanan.
    expect(byYear!.categories.map((c) => c.key)).toEqual([year]);
    expect(byYear!.series[0]!.values).toEqual([150000]);
    expect(byPartner!.rows).toEqual([
      { partner: "Koperasi Tani", omzet: 100000, n: 1, avg: 100000 },
      { partner: "UD Makmur", omzet: 50000, n: 1, avg: 50000 },
    ]);
    // KPI vs periode yang sama tahun lalu (YTD).
    expect(kpi!.card).toMatchObject({ value: 150000, previous: 40000, change: 275 });
    // YoY per pelanggan: Koperasi Tani 100.000 vs 40.000.
    expect(yoy!.series[0]!.values).toEqual([150, null]);

    // Drill tahun → bulan dan filter silang dari visual lain.
    const [drilled, filtered] = await query({
      visuals: [
        {
          id: "y",
          type: "column",
          dataset: "sales_orders",
          layout,
          axis: [
            { column: "dateOrder", level: "year" },
            { column: "dateOrder", level: "month" },
          ],
          values: [{ id: "m1", column: "amountUntaxed", fn: "sum" }],
        },
        {
          id: "p",
          type: "card",
          dataset: "sales_orders",
          layout,
          values: [{ id: "m1", column: "amountUntaxed", fn: "sum" }],
        },
      ],
      drill: { y: { depth: 1, path: [year] } },
      filters: [{ column: "partner", op: "in", values: ["UD Makmur"], source: "x" }],
    });
    expect(drilled!.categories.map((c) => c.key)).toEqual([today.slice(0, 7)]);
    expect(drilled!.series[0]!.values).toEqual([50000]);
    expect(filtered!.card!.value).toBe(50000);
  });

  it("galat per visual tidak menggagalkan visual lain; hak dataset menyembunyikan visual", async () => {
    const [bad, formula, ok] = await query({
      visuals: [
        { id: "a", type: "column", dataset: "sales_orders", layout, axis: [{ column: "nope" }], values: [] },
        {
          id: "b",
          type: "card",
          dataset: "sales_orders",
          layout,
          values: [{ id: "x", formula: "[tidak ada] + 1" }],
        },
        {
          id: "c",
          type: "card",
          dataset: "sales_orders",
          layout,
          values: [{ id: "m", column: "*", fn: "count" }],
        },
      ],
    });
    expect(bad!.error).toContain("tidak dikenal: nope");
    expect(formula!.error).toContain("tidak ditemukan");
    expect(ok!.card!.value).toBe(3);

    const [hidden, visible] = await query(
      {
        visuals: [
          {
            id: "inv",
            type: "card",
            dataset: "invoices",
            layout,
            values: [{ id: "m", column: "*", fn: "count" }],
          },
          {
            id: "so",
            type: "card",
            dataset: "sales_orders",
            layout,
            values: [{ id: "m", column: "*", fn: "count" }],
          },
        ],
      },
      sales,
    );
    expect(hidden!.hidden).toBe(true);
    expect(visible!.card!.value).toBe(3);

    // Rentang terbalik ditolak.
    await a.post("/bi/query", { builtin: "sales", from: `${year}-03-01`, to: `${year}-01-01` }).expect(400);
  });

  it("dokumen dashboard v2: simpan, validasi, jalankan per halaman, duplikat bawaan", async () => {
    const document = {
      period: "this_year",
      filters: [],
      pages: [
        {
          id: "p1",
          name: "Ringkasan",
          visuals: [
            {
              id: "v1",
              type: "card",
              title: "Omzet",
              dataset: "sales_orders",
              layout: { x: 0, y: 0, w: 3, h: 3 },
              values: [{ id: "m1", column: "amountUntaxed", fn: "sum" }],
            },
          ],
        },
        {
          id: "p2",
          name: "Per pelanggan",
          filters: [{ column: "partner", op: "in", values: ["Koperasi Tani"] }],
          visuals: [
            {
              id: "v2",
              type: "bar",
              title: "Omzet per pelanggan",
              dataset: "sales_orders",
              layout: { x: 0, y: 0, w: 6, h: 6 },
              axis: [{ column: "partner" }],
              values: [{ id: "m1", column: "amountUntaxed", fn: "sum" }],
            },
          ],
        },
      ],
    };
    const d = (await a.post("/dashboards", { name: "BI v2", widgets: [], document }).expect(201)).body;
    const got = (await a.get(`/dashboards/${d.id}`).expect(200)).body;
    expect(got.document.pages.map((p: { name: string }) => p.name)).toEqual(["Ringkasan", "Per pelanggan"]);
    const list = (await a.get("/dashboards").expect(200)).body;
    expect(list.custom.find((x: { id: string }) => x.id === d.id).widgets).toBe(2);

    const [card] = await query({ dashboardId: d.id });
    expect(card!.card!.value).toBe(190000);
    const [bar] = await query({ dashboardId: d.id, pageId: "p2" });
    expect(bar!.categories.map((c) => c.key)).toEqual(["Koperasi Tani"]);
    await a.post("/bi/query", { dashboardId: d.id, pageId: "zz" }).expect(404);

    // Validasi: id visual ganda, rumus melingkar, dataset tak dikenal.
    const broken = structuredClone(document);
    broken.pages[1]!.visuals[0]!.id = "v1";
    const res = await a
      .patch(`/dashboards/${d.id}`, { name: "BI v2", widgets: [], document: broken })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain("Id visual ganda");
    const circular = structuredClone(document);
    circular.pages[0]!.visuals[0]!.values = [{ id: "a", formula: "[a] + 1" }] as never;
    await a.patch(`/dashboards/${d.id}`, { name: "BI v2", widgets: [], document: circular }).expect(400);
    const unknown = structuredClone(document);
    unknown.pages[0]!.visuals[0]!.dataset = "tidak_ada";
    await a.patch(`/dashboards/${d.id}`, { name: "BI v2", widgets: [], document: unknown }).expect(400);
    // Klien lama yang tidak mengirim dokumen tidak menghapusnya.
    await a.patch(`/dashboards/${d.id}`, { name: "BI v2 baru", widgets: [] }).expect(200);
    expect((await a.get(`/dashboards/${d.id}`).expect(200)).body.document.pages).toHaveLength(2);

    // Dashboard bawaan: dokumen v2 tersedia & bisa dijalankan; duplikat membawa dokumen.
    const builtin = (await a.get("/dashboards/builtin/sales").expect(200)).body;
    expect(builtin.document.pages[0].visuals.length).toBe(builtin.widgets.length);
    const run = await query({ builtin: "sales", from: `${year}-01-01`, to: `${year}-12-31` });
    expect(run.every((v) => !v.error)).toBe(true);
    const copy = (await a.post("/dashboards/duplicate", { builtin: "sales" }).expect(201)).body;
    expect(copy.document.pages[0].visuals.length).toBeGreaterThan(3);
    // Dashboard lama (widget) tampil sebagai dokumen.
    const legacy = (
      await a
        .post("/dashboards", {
          name: "Lama",
          widgets: [
            {
              id: "w1",
              title: "Omzet",
              type: "kpi",
              source: {
                dataset: "sales_orders",
                config: { aggregates: [{ column: "amountUntaxed", fn: "sum" }] },
              },
            },
          ],
        })
        .expect(201)
    ).body;
    const legacyDoc = (await a.get(`/dashboards/${legacy.id}`).expect(200)).body.document;
    expect(legacyDoc.pages[0].visuals[0]).toMatchObject({ id: "w1", type: "kpi", dataset: "sales_orders" });
    for (const id of [d.id, copy.id, legacy.id]) await a.delete(`/dashboards/${id}`).expect(204);
  });
});
