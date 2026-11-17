import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Satu tempat konfigurasi persetujuan: kategori dokumen sistem tersedia sebelum dipakai (bisa diberi penyetuju
 * lebih dulu), dikelola pemegang approval.manage atau HR, dan PO ikut Kotak Persetujuan.
 */
describe.skipIf(!hasDb)("Konfigurasi persetujuan terpadu", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let companyId: string;
  type Api = ReturnType<typeof client>;
  const users: Record<string, Api> = {};

  const login = async (email: string) => {
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email, password: "rahasia123" })
        .expect(200)
    ).body.token as string;
    return client(app, token);
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "aprcfg");
    companyId = (await a.get("/auth/me")).body.activeCompanyId;
    for (const [key, permissions] of [
      ["admin_apr", ["approval.manage", "company.read"]],
      ["hr_reader", ["hr.read", "company.read"]],
      ["buyer", ["purchase.write", "partner.read", "product.read", "company.read"]],
    ] as const) {
      const role = (await a.post("/roles", { code: key, name: key, permissions }).expect(201)).body.id;
      await a
        .post("/users", {
          name: key,
          email: `${key}@example.com`,
          password: "rahasia123",
          roleIds: [role],
          companyIds: [companyId],
        })
        .expect(201);
      users[key] = await login(`${key}@example.com`);
    }
  });
  afterAll(() => app?.close());

  it("kategori dokumen sistem tersedia sebelum dipakai, ditandai sistem & pemakainya", async () => {
    const list = (await a.get("/approval-categories").expect(200)).body as {
      code: string;
      system: boolean;
      usedBy: [string, string] | null;
    }[];
    const codes = list.map((c) => c.code);
    for (const code of [
      "PAYROLL",
      "MUTASI",
      "PENAWARAN",
      "KENAIKAN",
      "PAYRUN",
      "OPNAME",
      "KONTRAK_BELI",
      "MPP",
    ])
      expect(codes).toContain(code);
    expect(list.find((c) => c.code === "MUTASI")).toMatchObject({ system: true });
    expect(list.find((c) => c.code === "MUTASI")!.usedBy![0]).toContain("SK");
    // Kategori contoh permintaan bebas tetap dibuat dan bukan kategori sistem.
    expect(list.find((c) => c.code === "UMUM")).toMatchObject({ system: false, usedBy: null });
    // Tidak dobel saat dimuat ulang.
    const again = (await a.get("/approval-categories").expect(200)).body as { code: string }[];
    expect(again.filter((c) => c.code === "PAYROLL")).toHaveLength(1);
  });

  it("penyetuju kategori sistem bisa diatur lebih dulu dan dipakai saat dokumen diajukan", async () => {
    const list = (await a.get("/approval-categories").expect(200)).body as { id: string; code: string }[];
    const mutasi = (
      await a.get(`/approval-categories/${list.find((c) => c.code === "MUTASI")!.id}`).expect(200)
    ).body;
    const me = (await a.get("/auth/me").expect(200)).body;
    const body = {
      code: mutasi.code,
      name: mutasi.name,
      prefix: mutasi.prefix,
      description: mutasi.description,
      fields: mutasi.fields,
      managerFirst: false,
      approvalMode: "sequential",
      minApprovals: 0,
      sequence: mutasi.sequence,
      active: true,
      approvers: [{ userId: me.userId, label: "Direktur SDM", required: true }],
    };
    // Pemegang approval.manage (tanpa hak SDM) boleh mengatur; pembaca SDM tidak.
    await users.admin_apr!.put(`/approval-categories/${mutasi.id}`, body).expect(200);
    await users.hr_reader!.put(`/approval-categories/${mutasi.id}`, body).expect(403);
    const saved = (await a.get(`/approval-categories/${mutasi.id}`).expect(200)).body;
    expect(saved.approvers).toHaveLength(1);
    expect(saved).toMatchObject({ system: true });

    // Kode & prefix kategori sistem dikunci; kategori sistem tidak bisa dihapus.
    const code = await a.put(`/approval-categories/${mutasi.id}`, { ...body, code: "MUTASI2" }).expect(400);
    expect(code.body.errors?.[0]?.path).toBe("code");
    await a.put(`/approval-categories/${mutasi.id}`, { ...body, prefix: "XX" }).expect(400);
    await a.delete(`/approval-categories/${mutasi.id}`).expect(400);
  });

  it("PO menunggu persetujuan tampil untuk penyetujunya saja", async () => {
    const vendor = (await a.post("/partners", { name: "PT Pemasok", isSupplier: true }).expect(201)).body.id;
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (
      await a
        .post("/products", { sku: "KRT", name: "Kertas", uomId: uom, productType: "consumable" })
        .expect(201)
    ).body.id;
    await a
      .put("/approval-limits/purchase_order", { limits: [{ maxAmount: "1000000", note: "Default" }] })
      .expect(200);
    const order = (
      await users
        .buyer!.post("/purchase-orders", {
          partnerId: vendor,
          dateOrder: today(),
          lines: [{ productId: product, quantity: "1", priceUnit: "5000000", taxIds: [] }],
        })
        .expect(201)
    ).body;
    await users.buyer!.post(`/purchase-orders/${order.id}/confirm`).expect(200);

    const mine = (await a.get("/purchase-orders/pending-approval").expect(200)).body;
    expect(mine).toEqual([
      expect.objectContaining({ id: order.id, name: order.name, partnerName: "PT Pemasok", step: 1 }),
    ]);
    // Pembeli tanpa hak menyetujui tidak melihatnya di kotak persetujuan.
    expect((await users.buyer!.get("/purchase-orders/pending-approval").expect(200)).body).toEqual([]);
    await a.post(`/purchase-orders/${order.id}/approve`).expect(200);
    expect((await a.get("/purchase-orders/pending-approval").expect(200)).body).toEqual([]);
  });
});
