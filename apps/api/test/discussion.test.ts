import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "@erp/shared";
import { client, createApp, hasDb, signup } from "./helpers.js";

interface Note {
  title: string;
  body: string | null;
  link: string | null;
}

describe.skipIf(!hasDb)("Diskusi dokumen & @mention", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const users: Record<string, { id: string; api: ReturnType<typeof client> }> = {};
  let order = "";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "disc");
    const me = (await a.get("/auth/me")).body;
    const role = async (code: string, permissions: string[]) =>
      (await a.post("/roles", { code, name: code, permissions }).expect(201)).body.id as string;
    const user = async (key: string, name: string, roleId: string) => {
      const id = (
        await a
          .post("/users", {
            name,
            email: `${key}@example.com`,
            password: "rahasia123",
            roleIds: [roleId],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
      const token = (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: `${key}@example.com`, password: "rahasia123" })
          .expect(200)
      ).body.token as string;
      users[key] = { id, api: client(app, token) };
    };
    await user("sari", "Sari Penjual", await role("penjual", ["sales.read", "sales.write"]));
    await user("gani", "Gani Gudang", await role("gudang", ["inventory.read"]));

    const customer = (await a.post("/partners", { name: "PT Diskusi", isCustomer: true }).expect(201)).body
      .id;
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (
      await a
        .post("/products", { sku: "DS", productType: "service", name: "Jasa", uomId: uom, salePrice: "100" })
        .expect(201)
    ).body.id;
    order = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: businessToday(),
          userId: users.sari!.id,
          lines: [{ productId: product, quantity: 1, priceUnit: 100 }],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("saran @mention hanya orang yang berhak melihat dokumen", async () => {
    const people = (await a.get(`/activity/sale_order/${order}/people`).expect(200)).body as {
      name: string;
    }[];
    const names = people.map((p) => p.name);
    expect(names).toContain("Sari Penjual");
    expect(names).not.toContain("Gani Gudang");
    // Diri sendiri tidak disarankan.
    expect(names).not.toContain("Admin");
    const q = (await a.get(`/activity/sale_order/${order}/people?q=sar`).expect(200)).body;
    expect(q).toEqual([expect.objectContaining({ name: "Sari Penjual" })]);
    await users.gani!.api.get(`/activity/sale_order/${order}/people`).expect(403);
  });

  it("komentar dengan @mention memberi tahu yang disebut; balasan memberi tahu peserta diskusi", async () => {
    const posted = (
      await a
        .post(`/activity/sale_order/${order}/comments`, {
          message: "@Sari Penjual tolong konfirmasi jadwal dengan pelanggan",
          mentions: [users.sari!.id],
        })
        .expect(201)
    ).body;
    expect(posted).toMatchObject({ action: "message", userName: "Admin" });
    expect(posted.changes.mentions).toEqual([{ id: users.sari!.id, name: "Sari Penjual" }]);

    const sariNotes = (await users.sari!.api.get("/me/notifications").expect(200)).body as Note[];
    expect(sariNotes[0]).toMatchObject({
      title: expect.stringContaining("menyebut Anda"),
      body: "@Sari Penjual tolong konfirmasi jadwal dengan pelanggan",
      link: `/sales/orders/${order}`,
    });

    // Sari membalas tanpa menyebut siapa pun → Admin (peserta diskusi) mendapat notifikasi.
    await users
      .sari!.api.post(`/activity/sale_order/${order}/comments`, { message: "Siap, besok." })
      .expect(201);
    const adminNotes = (await a.get("/me/notifications").expect(200)).body as Note[];
    expect(adminNotes[0]).toMatchObject({
      title: expect.stringContaining("berkomentar"),
      body: "Siap, besok.",
    });

    const log = (await a.get(`/activity/sale_order/${order}`).expect(200)).body as {
      action: string;
      message: string;
      userName: string;
    }[];
    expect(log.filter((e) => e.action === "message").map((e) => e.message)).toEqual([
      "Siap, besok.",
      "@Sari Penjual tolong konfirmasi jadwal dengan pelanggan",
    ]);
  });

  it("menolak sebutan orang yang tidak berhak, dokumen tak dikenal, komentar kosong, dan tanpa hak", async () => {
    await a
      .post(`/activity/sale_order/${order}/comments`, { message: "@Gani cek", mentions: [users.gani!.id] })
      .expect(400);
    await a
      .post(`/activity/sale_order/00000000-0000-4000-8000-000000000000/comments`, { message: "halo" })
      .expect(404);
    await a.post(`/activity/sale_order/${order}/comments`, { message: "   " }).expect(400);
    await users.gani!.api.post(`/activity/sale_order/${order}/comments`, { message: "halo" }).expect(403);
    await a.post(`/activity/tidak_ada/${order}/comments`, { message: "halo" }).expect(403);
  });
});
