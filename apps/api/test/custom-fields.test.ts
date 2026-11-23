import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

const today = businessToday();

describe.skipIf(!hasDb)("Field kustom", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let other: Awaited<ReturnType<typeof signup>>;
  let viewer: ReturnType<typeof client>;
  let pcs = "";
  let product = "";
  let employee = "";
  const fields: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "kustom");
    other = await signup(app, "kustom2");
    pcs = ((await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]).find(
      (u) => u.name === "Pcs",
    )!.id;
    product = (await a.post("/products", { sku: "BNH", name: "Benih", uomId: pcs, cost: "1000" }).expect(201))
      .body.id;
    employee = (await a.post("/employees", { name: "Budi Lapangan", joinDate: today }).expect(201)).body.id;
    const me = (await a.get("/auth/me")).body;
    const userRole = ((await a.get("/roles").expect(200)).body as { id: string; code: string }[]).find(
      (r) => r.code === "user",
    )!;
    await a
      .post("/users", {
        name: "Vina Viewer",
        email: "vina@example.com",
        password: "rahasia123",
        roleIds: [userRole.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    viewer = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "vina@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it("definisi: CRUD, validasi, izin, kunci unik", async () => {
    fields.region = (
      await a
        .post("/custom-fields", {
          model: "partner",
          key: "wilayah",
          label: "Wilayah",
          fieldType: "select",
          options: [
            { value: "jbr", label: "Jawa Barat" },
            { value: "jtm", label: "Jawa Timur" },
          ],
          required: true,
          showInList: true,
        })
        .expect(201)
    ).body.id;
    fields.luas = (
      await a
        .post("/custom-fields", {
          model: "partner",
          key: "luas_lahan",
          label: "Luas lahan (ha)",
          fieldType: "number",
          defaultValue: 1,
        })
        .expect(201)
    ).body.id;
    fields.pic = (
      await a
        .post("/custom-fields", {
          model: "partner",
          key: "pic",
          label: "PIC",
          fieldType: "ref",
          refModel: "employee",
        })
        .expect(201)
    ).body.id;
    await a
      .post("/custom-fields", { model: "partner", key: "wilayah", label: "Dobel", fieldType: "text" })
      .expect(400);
    await a
      .post("/custom-fields", { model: "partner", key: "x", label: "X", fieldType: "select" })
      .expect(400);
    await viewer
      .post("/custom-fields", { model: "partner", key: "y", label: "Y", fieldType: "text" })
      .expect(403);
    // Semua pengguna login bisa membaca definisi (untuk form).
    const list = (await viewer.get("/custom-fields?model=partner").expect(200)).body as { key: string }[];
    expect(list.map((f) => f.key)).toEqual(expect.arrayContaining(["wilayah", "luas_lahan", "pic"]));
    // Tenant lain tidak melihat.
    expect((await other.get("/custom-fields?model=partner").expect(200)).body).toEqual([]);
  });

  it("kontak lewat CRUD generik: wajib, bawaan, rujukan, ubah sebagian, ekspor & impor", async () => {
    const missing = await a.post("/partners", { name: "Tani Makmur", custom: {} }).expect(400);
    expect(JSON.stringify(missing.body)).toContain("custom.wilayah");
    const bad = await a
      .post("/partners", {
        name: "Tani Makmur",
        custom: { wilayah: "jbr", pic: "4c1a3b4e-2b4c-4d5e-8f90-1234567890ab" },
      })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("custom.pic");
    const p = (
      await a
        .post("/partners", { name: "Tani Makmur", custom: { wilayah: "Jawa Barat", pic: employee } })
        .expect(201)
    ).body;
    expect(p.custom).toEqual({ wilayah: "jbr", luas_lahan: 1, pic: employee });
    // Tanpa kiriman field kustom (integrasi/API): wajib tidak dipaksa, nilai bawaan dipakai.
    const api = (await a.post("/partners", { name: "Dari API" }).expect(201)).body;
    expect(api.custom).toEqual({ luas_lahan: 1 });
    // PATCH tanpa custom tidak mengubah nilai; dengan custom digabung.
    await a.patch(`/partners/${p.id}`, { phone: "0811" }).expect(200);
    const upd = (await a.patch(`/partners/${p.id}`, { custom: { luas_lahan: "2,5" } }).expect(200)).body;
    expect(upd.custom).toEqual({ wilayah: "jbr", luas_lahan: 2.5, pic: employee });
    await a.patch(`/partners/${p.id}`, { custom: { wilayah: "" } }).expect(400);

    const cols = (await a.get("/partners/export-columns").expect(200)).body as string[];
    expect(cols).toEqual(expect.arrayContaining(["custom.wilayah", "custom.pic"]));
    const csv = (await a.get("/partners/export?columns=name,custom.wilayah,custom.pic").expect(200)).text;
    expect(csv).toContain("Jawa Barat");
    expect(csv).toContain("Budi Lapangan");
    const imp = await a
      .post("/partners/import", {
        csv: `id,name,custom.wilayah,custom.luas_lahan\n${p.id},Tani Makmur,Jawa Timur,7\n,Baru,jbr,\n`,
      })
      .expect(200);
    expect(imp.body).toEqual({ created: 1, updated: 1 });
    expect((await a.get(`/partners/${p.id}`).expect(200)).body.custom).toMatchObject({
      wilayah: "jtm",
      luas_lahan: 7,
    });
    const badImp = await a.post("/partners/import", { csv: `name,custom.wilayah\nGagal,Bali\n` }).expect(400);
    expect(JSON.stringify(badImp.body)).toContain("baris 2");
  });

  it("dokumen: SO, faktur terposting, transfer; ubah nilai di dokumen terkunci; PDF", async () => {
    await a
      .post("/custom-fields", {
        model: "sale_order",
        key: "no_kontrak",
        label: "No. kontrak tani",
        fieldType: "text",
        required: true,
        showOnPdf: true,
      })
      .expect(201);
    await a
      .post("/custom-fields", { model: "account_move", key: "proyek", label: "Proyek", fieldType: "text" })
      .expect(201);
    const customer = (
      await a
        .post("/partners", { name: "Koperasi", isCustomer: true, custom: { wilayah: "jbr" } })
        .expect(201)
    ).body.id;
    const body = {
      partnerId: customer,
      dateOrder: today,
      lines: [{ productId: product, quantity: "2", priceUnit: "5000" }],
    };
    await a.post("/sale-orders", { ...body, custom: {} }).expect(400);
    const so = (await a.post("/sale-orders", { ...body, custom: { no_kontrak: "KT-01" } }).expect(201)).body;
    expect(so.custom).toEqual({ no_kontrak: "KT-01" });
    const list = (await a.get("/sale-orders?limit=50").expect(200)).body.items as {
      id: string;
      custom: unknown;
    }[];
    expect(list.find((o) => o.id === so.id)?.custom).toEqual({ no_kontrak: "KT-01" });
    const pdf = await a.get(`/sale-orders/${so.id}/pdf`).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    await a.post(`/sale-orders/${so.id}/confirm`).expect(200);
    // Dokumen terkonfirmasi tetap bisa diubah field kustomnya.
    await a.patch(`/custom-values/sale_order/${so.id}`, { custom: { no_kontrak: "KT-02" } }).expect(200);
    expect((await a.get(`/sale-orders/${so.id}`).expect(200)).body.custom).toEqual({ no_kontrak: "KT-02" });
    await viewer.patch(`/custom-values/sale_order/${so.id}`, { custom: { no_kontrak: "X" } }).expect(403);
    await other.patch(`/custom-values/sale_order/${so.id}`, { custom: { no_kontrak: "X" } }).expect(404);

    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: today,
          lines: [{ name: "Benih", productId: product, quantity: 1, priceUnit: 1000 }],
          custom: { proyek: "Sawah A" },
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${inv.id}/post`).expect(200);
    await a.patch(`/custom-values/account_move/${inv.id}`, { custom: { proyek: "Sawah B" } }).expect(200);
    const moves = (await a.get("/moves?moveType=out_invoice&limit=50").expect(200)).body.items as {
      id: string;
      custom: unknown;
    }[];
    expect(moves.find((m) => m.id === inv.id)?.custom).toEqual({ proyek: "Sawah B" });

    await a
      .post("/custom-fields", { model: "stock_picking", key: "sopir", label: "Sopir", fieldType: "text" })
      .expect(201);
    const pick = (
      await a
        .post("/pickings", {
          pickingType: "incoming",
          scheduledDate: today,
          moves: [{ productId: product, quantity: "3", priceUnit: "1000" }],
          custom: { sopir: "Asep" },
        })
        .expect(201)
    ).body;
    expect((await a.get(`/pickings/${pick.id}`).expect(200)).body.custom).toEqual({ sopir: "Asep" });
  });

  it("ganti tipe ditolak bila sudah terisi; hapus definisi menghapus nilainya", async () => {
    await a.put(`/custom-fields/${fields.luas}`, { label: "Luas", fieldType: "text" }).expect(400);
    await a.put(`/custom-fields/${fields.luas}`, { label: "Luas (ha)", fieldType: "number" }).expect(200);
    await a.delete(`/custom-fields/${fields.luas}`).expect(204);
    const partners = (await a.get("/partners?limit=50").expect(200)).body.items as {
      custom: Record<string, unknown>;
    }[];
    expect(partners.some((p) => "luas_lahan" in p.custom)).toBe(false);
    // Nonaktif: tidak bisa diisi lagi, nilai lama tetap.
    await a
      .put(`/custom-fields/${fields.region}`, {
        label: "Wilayah",
        fieldType: "select",
        options: [{ value: "jbr", label: "Jawa Barat" }],
        active: false,
      })
      .expect(200);
    const p = (await a.post("/partners", { name: "Tanpa wilayah", custom: {} }).expect(201)).body;
    await a.patch(`/partners/${p.id}`, { custom: { wilayah: "jbr" } }).expect(400);
  });
});
