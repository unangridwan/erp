import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

interface WidgetResult {
  id: string;
  hidden?: boolean;
  error?: string;
  rows?: Record<string, unknown>[];
  value?: number;
  previous?: number | null;
  change?: number | null;
}

describe.skipIf(!hasDb)("Laporan semua modul & dashboard BI", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sales: ReturnType<typeof client>;
  let customer = "";
  let product = "";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "bi");
    const me = (await a.get("/auth/me")).body;
    const role = (
      await a
        .post("/roles", {
          code: "sales_only",
          name: "Sales",
          permissions: ["sales.read", "sales.write", "crm.read"],
        })
        .expect(201)
    ).body.id;
    await a
      .post("/users", {
        name: "Sinta Sales",
        email: "sinta@example.com",
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
          .send({ tenantSlug: a.slug, email: "sinta@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    product = (
      await a.post("/products", { sku: "BNH", name: "Benih Padi", uomId: pcs, cost: "4000" }).expect(201)
    ).body.id;
    customer = (await a.post("/partners", { name: "Koperasi Tani", isCustomer: true }).expect(201)).body.id;
    await a
      .post("/custom-fields", { model: "sale_order", key: "musim", label: "Musim", fieldType: "text" })
      .expect(201);
    for (const [date, qty, musim] of [
      [today, "10", "hujan"],
      [today, "5", "kemarau"],
      [lastYear, "4", "hujan"],
    ] as const) {
      const so = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder: date,
            lines: [{ productId: product, quantity: qty, priceUnit: "10000" }],
            custom: { musim },
          })
          .expect(201)
      ).body;
      await a.post(`/sale-orders/${so.id}/confirm`).expect(200);
    }
    // Faktur pelanggan terposting, jatuh tempo lewat 40 hari.
    const past = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: past,
          dueDate: past,
          lines: [{ name: "Benih", productId: product, quantity: 1, priceUnit: 100000 }],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${inv.id}/post`).expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("dataset bisnis tersedia sesuai hak; isi & field kustom benar", async () => {
    const all = (await a.get("/reports/datasets").expect(200)).body as {
      key: string;
      columns: { key: string }[];
    }[];
    const keys = all.map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "sales_orders",
        "invoices",
        "journal_items",
        "stock_quants",
        "production_orders",
      ]),
    );
    expect(all.find((d) => d.key === "sales_orders")!.columns.map((c) => c.key)).toContain("custom.musim");
    const limited = ((await sales.get("/reports/datasets").expect(200)).body as { key: string }[]).map(
      (d) => d.key,
    );
    expect(limited).toContain("sales_orders");
    expect(limited).not.toContain("invoices");

    const bySeason = (
      await a
        .post("/saved-reports/preview", {
          dataset: "sales_orders",
          config: {
            filters: { from: `${today.slice(0, 4)}-01-01`, to: today },
            groupBy: ["custom.musim"],
            aggregates: [{ column: "amountUntaxed", fn: "sum" }],
            sort: { column: "custom.musim", dir: "asc" },
          },
        })
        .expect(200)
    ).body;
    expect(bySeason.rows).toEqual([
      { "custom.musim": "hujan", sum__amountUntaxed: 100000 },
      { "custom.musim": "kemarau", sum__amountUntaxed: 50000 },
    ]);
    const aging = (
      await a
        .post("/saved-reports/preview", {
          dataset: "invoices",
          config: {
            columns: ["name", "aging", "overdueDays", "amountResidual"],
            filters: { kind: "customer" },
          },
        })
        .expect(200)
    ).body;
    expect(aging.rows[0]).toMatchObject({ aging: "3. 31-60 hari", amountResidual: expect.any(Number) });
    expect(Number(aging.rows[0].overdueDays)).toBeGreaterThanOrEqual(40);
    await sales.post("/saved-reports/preview", { dataset: "invoices", config: {} }).expect(403);
  });

  it("dashboard bawaan: widget sesuai hak, KPI dengan pembanding periode", async () => {
    const list = (await sales.get("/dashboards").expect(200)).body;
    expect(list.builtin.map((d: { key: string }) => d.key)).toContain("sales");
    expect(list.builtin.map((d: { key: string }) => d.key)).not.toContain("finance");

    const run = (
      await a.post("/dashboards/run", { builtin: "sales", from: `${month}-01`, to: today }).expect(200)
    ).body as { widgets: WidgetResult[] };
    const revenue = run.widgets[0]!;
    expect(revenue.value).toBe(150000);
    expect(revenue.previous).toBe(0);
    const yearly = (
      await a
        .post("/dashboards/run", {
          builtin: "sales",
          from: `${today.slice(0, 4)}-01-01`,
          to: `${today.slice(0, 4)}-12-31`,
        })
        .expect(200)
    ).body as { widgets: WidgetResult[] };
    expect(yearly.widgets[0]).toMatchObject({ value: 150000, previous: 40000, change: 275 });

    // Pengguna sales: widget keuangan pada dashboard campuran disembunyikan, bukan error.
    const mixed = (
      await sales
        .post("/dashboards/run", {
          widgets: [
            {
              id: "a",
              title: "Omzet",
              type: "kpi",
              source: {
                dataset: "sales_orders",
                config: { aggregates: [{ column: "amountTotal", fn: "sum" }] },
              },
            },
            {
              id: "b",
              title: "Piutang",
              type: "kpi",
              source: {
                dataset: "invoices",
                config: { aggregates: [{ column: "amountResidual", fn: "sum" }] },
              },
            },
          ],
        })
        .expect(200)
    ).body as { widgets: WidgetResult[] };
    expect(mixed.widgets[0]!.value).toBeGreaterThan(0);
    expect(mixed.widgets[1]).toEqual({ id: "b", hidden: true });

    const finance = (await a.post("/dashboards/run", { builtin: "finance" }).expect(200)).body as {
      widgets: WidgetResult[];
    };
    expect(finance.widgets.every((w) => !w.error)).toBe(true);
  });

  it("dashboard kustom: CRUD, berbagi, duplikat bawaan, sematan Beranda", async () => {
    const report = (
      await a
        .post("/saved-reports", {
          name: "Omzet per musim",
          dataset: "sales_orders",
          config: { groupBy: ["custom.musim"], aggregates: [{ column: "amountUntaxed", fn: "sum" }] },
        })
        .expect(201)
    ).body;
    const d = (
      await a
        .post("/dashboards", {
          name: "Dashboard direksi",
          widgets: [{ id: "x1", title: "Omzet per musim", type: "table", source: { reportId: report.id } }],
        })
        .expect(201)
    ).body;
    await a
      .post("/dashboards", {
        name: "Rusak",
        widgets: [{ id: "x", title: "x", type: "kpi", source: { dataset: "tidak_ada", config: {} } }],
      })
      .expect(400);
    await sales.get(`/dashboards/${d.id}`).expect(404);
    await a.patch(`/dashboards/${d.id}`, { ...d, visibility: "shared" }).expect(200);
    expect((await sales.get(`/dashboards/${d.id}`).expect(200)).body.name).toBe("Dashboard direksi");
    await sales.patch(`/dashboards/${d.id}`, { name: "Ubah", widgets: [] }).expect(404);
    const run = (await sales.post("/dashboards/run", { dashboardId: d.id }).expect(200)).body;
    expect(run.widgets[0].rows.length).toBeGreaterThan(0);

    const copy = (await a.post("/dashboards/duplicate", { builtin: "finance" }).expect(201)).body;
    expect(copy.name).toContain("Keuangan");
    expect(copy.widgets.length).toBeGreaterThan(3);

    expect((await a.put("/me/dashboard-pins", { refs: ["builtin:sales", d.id] }).expect(200)).body).toEqual([
      "builtin:sales",
      d.id,
    ]);
    await a.put("/me/dashboard-pins", { refs: ["builtin:tidak-ada"] }).expect(400);
    expect((await a.get("/me/dashboard-pins").expect(200)).body).toEqual(["builtin:sales", d.id]);
    await a.delete(`/dashboards/${d.id}`).expect(204);
    expect((await a.get("/me/dashboard-pins").expect(200)).body).toEqual(["builtin:sales"]);
  });
});
