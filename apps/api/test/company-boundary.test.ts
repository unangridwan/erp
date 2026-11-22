import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/**
 * Batas perusahaan untuk admin terdelegasi: hak (termasuk '*') yang berlaku di satu perusahaan tidak boleh membuka
 * data, akun, atau hak di perusahaan lain.
 */
describe.skipIf(!hasDb)("Batas perusahaan & delegasi admin", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let A: string;
  let B: string;
  let C: string;
  let adminRole: string;
  let n = 0;

  const login = async (email: string) => {
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email, password: "rahasia123" })
        .expect(200)
    ).body.token as string;
    return token;
  };

  /** User dengan akses ke `companies` dan peran per perusahaan. */
  const userWith = async (companies: string[], roles: { roleId: string; companyId: string | null }[]) => {
    n++;
    const email = `batas${n}@example.com`;
    const user = (
      await a
        .post("/users", {
          name: `Batas ${n}`,
          email,
          password: "rahasia123",
          roleIds: [],
          companyIds: companies,
        })
        .expect(201)
    ).body;
    await a.put(`/users/${user.id}/roles`, { roles }).expect(200);
    const token = await login(email);
    return { id: user.id as string, email, as: (company: string) => client(app, token, company) };
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "batas");
    A = (await a.get("/auth/me")).body.activeCompanyId;
    B = (await a.post("/companies", { code: "BB", name: "PT Bravo" }).expect(201)).body.id;
    C = (await a.post("/companies", { code: "CC", name: "PT Charlie" }).expect(201)).body.id;
    adminRole = (await a.get("/roles").expect(200)).body.find((r: { code: string }) => r.code === "admin").id;
  });
  afterAll(() => app?.close());

  it("admin '*' di satu perusahaan tidak melihat/mengubah data perusahaan yang tidak bisa diaksesnya", async () => {
    const partnerC = (await a.post("/partners", { name: "Mitra Charlie", companyId: C }).expect(201)).body;
    const u = await userWith([A, B], [{ roleId: adminRole, companyId: A }]);
    const list = (await u.as(A).get("/partners").expect(200)).body;
    const rows = Array.isArray(list) ? list : list.items;
    expect(rows.some((p: { id: string }) => p.id === partnerC.id)).toBe(false);
    await u.as(A).get(`/partners/${partnerC.id}`).expect(404);
    await u.as(A).patch(`/partners/${partnerC.id}`, { name: "Diubah" }).expect(404);
    await u.as(A).delete(`/partners/${partnerC.id}`).expect(404);
    await u.as(A).patch(`/companies/${C}`, { name: "Diubah" }).expect(404);
    // Admin semua perusahaan tetap melihatnya.
    await a.get(`/partners/${partnerC.id}`).expect(200);
  });

  it("hak baca di perusahaan lain tidak cukup untuk mengubah atau menghapus datanya", async () => {
    const partnerB = (await a.post("/partners", { name: "Mitra Bravo", companyId: B }).expect(201)).body;
    const writer = (
      await a
        .post("/roles", { code: "mitra_tulis", name: "Tulis mitra", permissions: ["partner.write"] })
        .expect(201)
    ).body.id;
    const reader = (
      await a
        .post("/roles", { code: "mitra_baca", name: "Baca mitra", permissions: ["partner.read"] })
        .expect(201)
    ).body.id;
    const u = await userWith(
      [A, B],
      [
        { roleId: writer, companyId: A },
        { roleId: reader, companyId: B },
      ],
    );
    await u.as(A).get(`/partners/${partnerB.id}`).expect(200);
    await u.as(A).patch(`/partners/${partnerB.id}`, { name: "Diubah" }).expect(404);
    await u.as(A).delete(`/partners/${partnerB.id}`).expect(404);
    expect((await a.get(`/partners/${partnerB.id}`).expect(200)).body.name).toBe("Mitra Bravo");
  });

  it("admin terdelegasi tidak bisa membuat/mengundang akun ke perusahaan lain atau memberi peran di sana", async () => {
    const userAdmin = (
      await a
        .post("/roles", {
          code: "admin_user",
          name: "Kelola pengguna",
          permissions: ["user.write", "user.read", "accounting.manage"],
        })
        .expect(201)
    ).body.id;
    const acct = (
      await a
        .post("/roles", { code: "akuntan_b", name: "Akuntan", permissions: ["accounting.manage"] })
        .expect(201)
    ).body.id;
    const d = await userWith([A, B], [{ roleId: userAdmin, companyId: A }]);
    const base = { name: "Baru", password: "rahasia123", roleIds: [acct] };
    await d
      .as(A)
      .post("/users", { ...base, email: "baru-b@example.com", companyIds: [B] })
      .expect(403);
    await d
      .as(A)
      .post("/users/invite", {
        name: "Baru",
        email: "undang-b@example.com",
        roleIds: [acct],
        companyIds: [B],
      })
      .expect(403);
    // Di perusahaan yang dikelolanya tetap bisa.
    await d
      .as(A)
      .post("/users", { ...base, email: "baru-a@example.com", companyIds: [A] })
      .expect(201);

    // Peran untuk user lain: hanya di perusahaan tempat pemberi memegang haknya.
    const t = await userWith([A, B], []);
    await d
      .as(A)
      .put(`/users/${t.id}/roles`, { roles: [{ roleId: acct, companyId: B }] })
      .expect(403);
    await d
      .as(A)
      .put(`/users/${t.id}/roles`, { roles: [{ roleId: acct, companyId: null }] })
      .expect(403);
    await d
      .as(A)
      .put(`/users/${t.id}/roles`, { roles: [{ roleId: acct, companyId: A }] })
      .expect(200);
  });

  it("admin terdelegasi tidak bisa menonaktifkan admin perusahaan lain", async () => {
    const userAdmin = (
      await a
        .post("/roles", {
          code: "admin_user2",
          name: "Kelola pengguna 2",
          permissions: ["user.write", "user.read"],
        })
        .expect(201)
    ).body.id;
    const d = await userWith([A, B], [{ roleId: userAdmin, companyId: A }]);
    const adminB = await userWith([A, B], [{ roleId: adminRole, companyId: B }]);
    await d.as(A).post(`/users/${adminB.id}/deactivate`).expect(403);
    await d.as(A).post(`/users/${adminB.id}/reset-2fa`).expect(403);
  });

  it("undang karyawan tidak menautkan karyawan ke akun lain lewat email sembarang", async () => {
    const employee = (
      await a
        .post("/employees", { name: "Direktur", joinDate: "2025-01-02", workEmail: "dir@example.com" })
        .expect(201)
    ).body;
    // Email akun admin yang tidak tercatat di data karyawan → ditolak.
    await a.post(`/employees/${employee.id}/invite`, { email: "admin@example.com" }).expect(400);
    expect((await a.get(`/employees/${employee.id}`).expect(200)).body.userId ?? null).toBeNull();
  });
});
