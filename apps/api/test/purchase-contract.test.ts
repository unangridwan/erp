import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

type Api = ReturnType<typeof client>;
const today = businessToday();
const year = today.slice(0, 4);
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasDb)("Kontrak pembelian (blanket order)", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let rina: Api;
  let vendor = "";
  let other = "";
  const prod: Record<string, string> = {};
  let contractId = "";
  let lineA = "";

  const po = (body: object) => a.post("/purchase-orders", { dateOrder: today, ...body });

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "pkontrak");
    const me = (await a.get("/auth/me")).body;
    const admin = ((await a.get("/roles").expect(200)).body as { id: string; code: string }[]).find(
      (r) => r.code === "admin",
    )!;
    await a
      .post("/users", {
        name: "Rina Direktur",
        email: "rina@example.com",
        password: "rahasia123",
        roleIds: [admin.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    rina = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "rina@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    for (const [k, sku, cost] of [
      ["A", "PUPUK-UREA", "5000"],
      ["B", "PUPUK-NPK", "8000"],
    ] as const)
      prod[k] = (await a.post("/products", { sku, name: sku, uomId: pcs, cost }).expect(201)).body.id;
    vendor = (await a.post("/partners", { name: "PT Pupuk Indonesia", isSupplier: true }).expect(201)).body
      .id;
    other = (await a.post("/partners", { name: "CV Lain", isSupplier: true }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("validasi & persetujuan: draft → ajukan → disetujui user lain → aktif", async () => {
    const bad = await a
      .post("/purchase-contracts", {
        partnerId: vendor,
        dateStart: `${year}-12-31`,
        dateEnd: `${year}-01-01`,
        lines: [{ productId: prod.A, quantity: "1", priceUnit: "1" }],
      })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("dateEnd");

    const c = (
      await a
        .post("/purchase-contracts", {
          partnerId: vendor,
          dateStart: shift(-30),
          dateEnd: shift(30),
          valueLimit: "1500000",
          lines: [
            { productId: prod.A, quantity: "100", priceUnit: "4500", taxIds: [] },
            { productId: prod.B, quantity: "50", priceUnit: "7000", discount: "10", taxIds: [] },
          ],
        })
        .expect(201)
    ).body;
    contractId = c.id;
    lineA = c.lines.find((l: { productId: string }) => l.productId === prod.A).id;
    expect(c.state).toBe("draft");
    expect(c.name).toMatch(/^PK\//);
    expect(c.committedValue).toBe("765000.00");

    // Kontrak belum aktif tidak bisa dipakai PO.
    await po({ partnerId: vendor, contractId, lines: [{ productId: prod.A, quantity: "1" }] }).expect(400);

    const submitted = (await a.post(`/purchase-contracts/${contractId}/submit`).expect(200)).body;
    expect(submitted.state).toBe("in_approval");
    await a.put(`/purchase-contracts/${contractId}`, { partnerId: vendor }).expect(400);
    const req = (await a.get(`/approval-requests/${submitted.approval.id}`).expect(200)).body;
    expect(req.category.code).toBe("KONTRAK_BELI");
    expect(req.amount).toBe("1500000.00");
    await a.post(`/approval-requests/${req.id}/approve`, {}).expect(403);
    await rina.post(`/approval-requests/${req.id}/approve`, { note: "OK" }).expect(200);
    expect((await a.get(`/purchase-contracts/${contractId}`).expect(200)).body.state).toBe("active");
  });

  it("PO memakai harga kontrak (dari kontrak & otomatis); dalam sisa langsung jadi PO", async () => {
    const created = (
      await a
        .post(`/purchase-contracts/${contractId}/purchase-order`, {
          lines: [{ contractLineId: lineA, quantity: "60" }],
        })
        .expect(201)
    ).body;
    const order = (await a.get(`/purchase-orders/${created.id}`).expect(200)).body;
    expect(order.contract.id).toBe(contractId);
    expect(order.lines[0]).toMatchObject({ priceUnit: "4500.0000", contractLineId: lineA });
    expect(order.contractWarnings).toEqual([]);
    expect((await a.post(`/purchase-orders/${created.id}/confirm`).expect(200)).body.state).toBe("purchase");

    // PO manual tanpa harga ke pemasok yang sama ikut harga kontrak (diskon kontrak).
    const auto = (await po({ partnerId: vendor, lines: [{ productId: prod.B, quantity: "10" }] }).expect(201))
      .body;
    const autoOrder = (await a.get(`/purchase-orders/${auto.id}`).expect(200)).body;
    expect(autoOrder.contract?.id).toBe(contractId);
    expect(autoOrder.lines[0]).toMatchObject({ priceUnit: "7000.0000", discount: "10.0000" });

    // Pemasok lain tanpa kontrak memakai biaya produk; kontrak pemasok lain ditolak.
    const plain = (await po({ partnerId: other, lines: [{ productId: prod.A, quantity: "1" }] }).expect(201))
      .body;
    expect((await a.get(`/purchase-orders/${plain.id}`).expect(200)).body.lines[0].priceUnit).toBe(
      "5000.0000",
    );
    await po({ partnerId: other, contractId, lines: [{ productId: prod.A, quantity: "1" }] }).expect(400);

    const detail = (await a.get(`/purchase-contracts/${contractId}`).expect(200)).body;
    const a1 = detail.lines.find((l: { id: string }) => l.id === lineA);
    expect(a1).toMatchObject({ ordered: "60.0000", remaining: "40.0000", pct: 60 });
    expect(detail.orderedValue).toBe("270000.00");
  });

  it("melebihi sisa → wajib persetujuan + peringatan; batal PO mengembalikan sisa", async () => {
    const over = (
      await po({ partnerId: vendor, contractId, lines: [{ productId: prod.A, quantity: "50" }] }).expect(201)
    ).body;
    const draft = (await a.get(`/purchase-orders/${over.id}`).expect(200)).body;
    expect(draft.contractWarnings.join(" ")).toContain("sisa kontrak 40");
    expect((await a.post(`/purchase-orders/${over.id}/confirm`).expect(200)).body.state).toBe("to_approve");
    const waiting = (await a.get(`/purchase-orders/${over.id}`).expect(200)).body;
    expect(waiting.contractWarning).toContain("sisa kontrak 40");
    expect((await a.post(`/purchase-orders/${over.id}/approve`).expect(200)).body.state).toBe("purchase");

    let detail = (await a.get(`/purchase-contracts/${contractId}`).expect(200)).body;
    expect(detail.lines.find((l: { id: string }) => l.id === lineA).remaining).toBe("-10.0000");
    await a.post(`/purchase-orders/${over.id}/cancel`).expect(200);
    detail = (await a.get(`/purchase-contracts/${contractId}`).expect(200)).body;
    expect(detail.lines.find((l: { id: string }) => l.id === lineA).remaining).toBe("40.0000");
  });

  it("plafon nilai terlampaui → peringatan; kontrak aktif tidak bisa diubah; tutup kontrak", async () => {
    const big = (
      await po({
        partnerId: vendor,
        contractId,
        lines: [{ productId: prod.A, quantity: "40", priceUnit: "40000" }],
      }).expect(201)
    ).body;
    const order = (await a.get(`/purchase-orders/${big.id}`).expect(200)).body;
    expect(order.lines[0].contractLineId).toBe(lineA);
    expect(order.contractWarnings.join(" ")).toContain("melebihi plafon");
    expect((await a.post(`/purchase-orders/${big.id}/confirm`).expect(200)).body.state).toBe("to_approve");
    await a.post(`/purchase-orders/${big.id}/cancel`).expect(200);

    await a.delete(`/purchase-contracts/${contractId}`).expect(400);
    const closed = (await a.post(`/purchase-contracts/${contractId}/close`).expect(200)).body;
    expect(closed.state).toBe("closed");
    await a
      .post(`/purchase-contracts/${contractId}/purchase-order`, {
        lines: [{ contractLineId: lineA, quantity: "1" }],
      })
      .expect(400);
    const list = (await a.get("/purchase-contracts").expect(200)).body;
    expect(list.find((c: { id: string }) => c.id === contractId)).toMatchObject({
      state: "closed",
      qtyPct: expect.any(Number),
    });
  });

  it("kontrak berakhir: tampil expired dan PO dengan kontrak itu butuh persetujuan", async () => {
    const c = (
      await a
        .post("/purchase-contracts", {
          partnerId: other,
          dateStart: shift(-60),
          dateEnd: shift(-1),
          lines: [{ productId: prod.B, quantity: "10", priceUnit: "6000", taxIds: [] }],
        })
        .expect(201)
    ).body;
    const sub = (await a.post(`/purchase-contracts/${c.id}/submit`).expect(200)).body;
    await rina.post(`/approval-requests/${sub.approval.id}/approve`, {}).expect(200);
    expect((await a.get(`/purchase-contracts/${c.id}`).expect(200)).body.state).toBe("expired");
    const order = (
      await po({ partnerId: other, contractId: c.id, lines: [{ productId: prod.B, quantity: "2" }] }).expect(
        201,
      )
    ).body;
    const detail = (await a.get(`/purchase-orders/${order.id}`).expect(200)).body;
    expect(detail.lines[0].priceUnit).toBe("6000.0000");
    expect(detail.contractWarnings.join(" ")).toContain("berakhir");
    expect((await a.post(`/purchase-orders/${order.id}/confirm`).expect(200)).body.state).toBe("to_approve");
    const report = (await a.get("/purchase-contracts/report").expect(200)).body;
    expect(report.contracts.some((x: { id: string }) => x.id === c.id)).toBe(true);
  });
});
