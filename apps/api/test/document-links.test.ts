import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@erp/db";
import { RECORD_MODEL_KEYS } from "@erp/shared";
import { TenantDb } from "../src/common/database.js";
import { journalsOf, RELATIONS, TABLES } from "../src/links/links.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Group {
  key: string;
  model: string;
  direction: string;
  count: number;
  items: { id: string; name: string | null; amount: string | null }[];
}
const group = (body: { groups: Group[] }, key: string) => body.groups.find((g) => g.key === key);

describe.skipIf(!hasDb)("Data terhubung & drilldown laporan", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let sales: Api;
  let customer: string;
  let orderId: string;
  let invoiceId: string;
  let paymentId: string;
  let paymentMoveId: string;
  const jr: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const DATE_TO = "2026-11-16";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "links");
    const me = (await a.get("/auth/me")).body;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (
      await a
        .post("/products", {
          sku: "JS-01",
          productType: "service",
          name: "Jasa",
          uomId: uom,
          salePrice: "1000000",
        })
        .expect(201)
    ).body.id;
    customer = (await a.post("/partners", { name: "PT Pelanggan Tautan", isCustomer: true }).expect(201)).body
      .id;

    orderId = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: "2026-10-15",
          lines: [{ productId: product, quantity: 2, priceUnit: 1_000_000 }],
        })
        .expect(201)
    ).body.id;
    await a.post(`/sale-orders/${orderId}/confirm`).expect(200);
    invoiceId = (
      await a.post(`/sale-orders/${orderId}/invoice`, { method: "regular", date: "2026-10-20" }).expect(201)
    ).body.moveId;
    await a.post(`/moves/${invoiceId}/post`).expect(200);
    const pay = (
      await a
        .post("/payments", {
          paymentType: "inbound",
          partnerId: customer,
          journalId: jr.BNK1,
          amount: 500_000,
          date: "2026-10-25",
          moveIds: [invoiceId],
        })
        .expect(201)
    ).body;
    paymentId = pay.id;
    paymentMoveId = pay.moveId;

    // Penjual: boleh lihat penjualan & kontak, tanpa hak akuntansi.
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "sales", name: "Penjual" }).returning({ id: schema.roles.id }),
    );
    await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.rolePermissions).values(
        ["sales.read", "sales.write", "partner.read"].map((permission) => ({
          roleId: role!.id,
          permission,
        })),
      ),
    );
    await a
      .post("/users", {
        name: "Sari Penjual",
        email: "sari@example.com",
        password: "rahasia123",
        roleIds: [role!.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
      .expect(200);
    sales = client(app, login.body.token);
  });

  afterAll(() => app?.close());

  it("faktur: dokumen asal SO, pembayaran terekonsiliasi, dan partner", async () => {
    const body = (await a.get(`/links/account_move/${invoiceId}`).expect(200)).body;
    expect(group(body, "source_sale_order")).toMatchObject({
      model: "sale_order",
      direction: "upstream",
      items: [{ id: orderId, name: expect.stringMatching(/^SO\//) }],
    });
    expect(group(body, "reconciled")!.items.map((i) => i.id)).toEqual([paymentMoveId]);
    expect(group(body, "partner")!.items[0]).toMatchObject({ id: customer, name: "PT Pelanggan Tautan" });
  });

  it("pesanan penjualan: faktur turunan & pembayarannya", async () => {
    const body = (await a.get(`/links/sale_order/${orderId}`).expect(200)).body;
    expect(group(body, "journal")!.items.map((i) => i.id)).toEqual([invoiceId]);
    expect(group(body, "reconciled")!.items.map((i) => i.id)).toEqual([paymentMoveId]);
  });

  it("pembayaran: jurnalnya & faktur yang dilunasi", async () => {
    const body = (await a.get(`/links/payment/${paymentId}`).expect(200)).body;
    expect(group(body, "journal")!.items.map((i) => i.id)).toEqual([paymentMoveId]);
    expect(group(body, "reconciled")!.items.map((i) => i.id)).toEqual([invoiceId]);
    // Jurnal pembayaran menunjuk balik ke pembayarannya.
    const move = (await a.get(`/links/account_move/${paymentMoveId}`).expect(200)).body;
    expect(group(move, "source_payment")!.items[0]!.id).toBe(paymentId);
  });

  it("kontak: daftar dokumen per jenis dengan jumlah", async () => {
    const body = (await a.get(`/links/partner/${customer}`).expect(200)).body;
    expect(group(body, "sale_orders")).toMatchObject({ count: 1, items: [{ id: orderId }] });
    expect(group(body, "invoices")).toMatchObject({
      count: 1,
      items: [{ id: invoiceId, amount: "2220000.00" }],
    });
    expect(group(body, "payments")).toMatchObject({ count: 1, items: [{ id: paymentId }] });
  });

  it("hak baca: dokumen yang tidak boleh dibaca disembunyikan", async () => {
    const body = (await sales.get(`/links/sale_order/${orderId}`).expect(200)).body;
    expect(body.groups.some((g: Group) => g.model === "account_move")).toBe(false);
    expect(group(body, "partner")).toBeDefined();
    await sales.get(`/links/account_move/${invoiceId}`).expect(404);
    await sales.get(`/reports/drilldown?accountId=${acc["4-1000"] ?? invoiceId}`).expect(403);
  });

  it("model/dokumen tidak dikenal & tenant lain → 404", async () => {
    await a.get(`/links/unknown/${orderId}`).expect(404);
    await a.get(`/links/sale_order/00000000-0000-4000-8000-000000000000`).expect(404);
    await a.get(`/links/sale_order/bukan-uuid`).expect(400);
    const other = await signup(app, "links-other");
    await other.get(`/links/sale_order/${orderId}`).expect(404);
  });

  it("drilldown laba rugi: total item = angka akun, dengan dokumen sumber", async () => {
    const pl = (await a.get(`/reports/profit-loss?dateFrom=2026-10-01&dateTo=${DATE_TO}`).expect(200)).body;
    const line = pl.income.accounts[0] as { accountId: string; amount: string };
    const dd = (
      await a
        .get(
          `/reports/drilldown?accountId=${line.accountId}&dateFrom=2026-10-01&dateTo=${DATE_TO}&excludeClosing=1`,
        )
        .expect(200)
    ).body;
    expect(Number(dd.totals.balance) * -1).toBe(Number(line.amount));
    expect(dd.lines[0]).toMatchObject({
      moveId: invoiceId,
      partner: "PT Pelanggan Tautan",
      source: { model: "sale_order", id: orderId },
    });
  });

  it("drilldown neraca (kumulatif) & umur piutang (item terbuka per rentang)", async () => {
    const bs = (await a.get(`/reports/balance-sheet?dateTo=${DATE_TO}`).expect(200)).body;
    const receivable = (bs.assets.accounts as { accountId: string; amount: string }[]).find(
      (x) => x.accountId && Number(x.amount) === 1_720_000,
    )!;
    const cum = (
      await a
        .get(`/reports/drilldown?accountId=${receivable.accountId}&dateTo=${DATE_TO}&basis=cumulative`)
        .expect(200)
    ).body;
    expect(cum.totals).toMatchObject({ balance: "1720000.00", count: 2 });

    const aged = (await a.get(`/reports/aged?dateTo=${DATE_TO}`).expect(200)).body;
    const row = aged.partners.find((p: { partnerId: string }) => p.partnerId === customer);
    expect(row).toMatchObject({ d1_30: "1720000.00", total: "1720000.00" });
    const open = (
      await a
        .get(`/reports/drilldown?openOnly=1&partnerId=${customer}&bucket=d1_30&dateTo=${DATE_TO}`)
        .expect(200)
    ).body;
    expect(open.totals).toMatchObject({ residual: "1720000.00", count: 1 });
    expect(open.lines[0]).toMatchObject({ moveId: invoiceId, dueDate: expect.any(String) });
    const none = (
      await a
        .get(`/reports/drilldown?openOnly=1&partnerId=${customer}&bucket=over90&dateTo=${DATE_TO}`)
        .expect(200)
    ).body;
    expect(none.totals.count).toBe(0);
  });

  it("drilldown PPN keluaran per masa", async () => {
    const dd = (await a.get("/tax/vat-report/drilldown?year=2026&month=10&use=sale").expect(200)).body;
    expect(dd.totals.count).toBe(1);
    expect(dd.totals.credit).toBe("220000.00");
    await a.get("/tax/vat-report/drilldown?year=2026&month=10").expect(400);
  });

  it("semua query relasi & nama dokumen valid terhadap skema", async () => {
    const db = app.get(TenantDb);
    const tenantId = (await a.get("/auth/me")).body.tenantId as string;
    const id = "00000000-0000-4000-8000-000000000000";
    await db.runAs(tenantId, async (tx) => {
      for (const model of RECORD_MODEL_KEYS) {
        const t = TABLES[model];
        await tx.execute(
          sql`select t.id, ${sql.raw(t.name)} as name, t.company_id from ${sql.raw(t.table)} t limit 1`,
        );
        for (const r of [...(RELATIONS[model] ?? []), journalsOf(model)])
          await tx.execute(
            sql`select x.id, x.date::text, x.amount::text, x.state from (${r.query(id)}) x limit 0`,
          );
      }
    });
  });

  it("paginasi: total tetap atas semua item", async () => {
    const dd = (
      await a.get(`/reports/drilldown?dateFrom=2026-10-01&dateTo=${DATE_TO}&limit=1&offset=1`).expect(200)
    ).body;
    expect(dd.lines).toHaveLength(1);
    expect(dd.totals.count).toBeGreaterThan(2);
    expect(dd.totals.debit).toBe(dd.totals.credit);
  });
});
