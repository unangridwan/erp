import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** RBAC: peran kustom, peran per perusahaan, hak per akun (modul/fitur), admin terdelegasi, pengaman. */
describe.skipIf(!hasDb)("RBAC", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let companyA: string;
  let companyB: string;
  let adminId: string;
  let adminRole: string;

  const login = async (email: string, companyId?: string) => {
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email, password: "rahasia123" })
        .expect(200)
    ).body.token as string;
    return client(app, token, companyId);
  };
  const createUser = async (name: string, email: string, roleIds: string[] = []) =>
    (
      await a
        .post("/users", { name, email, password: "rahasia123", roleIds, companyIds: [companyA, companyB] })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "rbac");
    const me = (await a.get("/auth/me")).body;
    companyA = me.activeCompanyId;
    adminId = me.userId;
    companyB = (await a.post("/companies", { code: "B", name: "PT B", parentId: companyA }).expect(201)).body
      .id;
    adminRole = (await a.get("/roles").expect(200)).body.find((r: { code: string }) => r.code === "admin").id;
  });
  afterAll(() => app?.close());

  it("katalog & templat; peran kustom hanya membuka modulnya", async () => {
    const cat = (await a.get("/permissions/catalog").expect(200)).body;
    expect(cat.modules.find((m: { key: string }) => m.key === "hr").features.length).toBeGreaterThan(5);
    expect(cat.templates.some((t: { code: string }) => t.code === "auditor")).toBe(true);

    await a.post("/roles", { code: "bad", name: "Salah", permissions: ["tidak.ada"] }).expect(400);
    const hr = (
      await a
        .post("/roles", { code: "hr_staff", name: "Staf SDM", permissions: ["hr.manage", "company.read"] })
        .expect(201)
    ).body;
    await a.post("/roles", { code: "hr_staff", name: "Dobel", permissions: [] }).expect(400);
    const sari = await createUser("Sari SDM", "sari@example.com", [hr.id]);
    const s = await login("sari@example.com");
    await s.get("/employees").expect(200);
    await s.post("/departments", { name: "Gudang" }).expect(201);
    await s.get("/moves").expect(403);
    await s.get("/payroll-runs").expect(403);
    const roles = (await a.get("/roles").expect(200)).body;
    expect(roles.find((r: { code: string }) => r.code === "hr_staff").userCount).toBe(1);
    await a.delete(`/roles/${hr.id}`).expect(400); // masih dipakai
    await a.delete(`/roles/${adminRole}`).expect(400); // bawaan
    expect(sari).toBeTruthy();
  });

  it("peran per perusahaan: akses di PT A, ditolak di PT B", async () => {
    const acct = (
      await a.post("/roles", { code: "acct", name: "Akuntan", permissions: ["accounting.write"] }).expect(201)
    ).body;
    const budi = await createUser("Budi Akuntan", "budi@example.com");
    await a.put(`/users/${budi}/roles`, { roles: [{ roleId: acct.id, companyId: companyA }] }).expect(200);
    const inA = await login("budi@example.com", companyA);
    const inB = await login("budi@example.com", companyB);
    await inA.get("/moves").expect(200);
    await inB.get("/moves").expect(403);
    expect((await inB.get("/auth/me").expect(200)).body.permissions).not.toContain("accounting.read");

    const access = (await a.get(`/users/${budi}/access`).expect(200)).body as {
      company: { id: string };
      permissions: string[];
      sources: Record<string, string[]>;
    }[];
    const forA = access.find((x) => x.company.id === companyA)!;
    expect(forA.permissions).toContain("accounting.payments.write");
    expect(forA.sources["accounting.write"]).toEqual(["role:Akuntan"]);
    expect(access.find((x) => x.company.id === companyB)!.permissions).toEqual([]);
  });

  it("data lintas perusahaan hanya terlihat di perusahaan tempat pengguna punya hak baca", async () => {
    const role = (
      await a
        .post("/roles", {
          code: "mitra_a",
          name: "Mitra A",
          permissions: ["partner.write", "accounting.read"],
        })
        .expect(201)
    ).body;
    const cici = await createUser("Cici", "cici@example.com");
    await a.put(`/users/${cici}/roles`, { roles: [{ roleId: role.id, companyId: companyA }] }).expect(200);
    await a.post("/partners", { name: "Pelanggan Bersama" }).expect(201);
    await a.post("/partners", { name: "Pelanggan PT A", companyId: companyA }).expect(201);
    const privateB = (await a.post("/partners", { name: "Pelanggan PT B", companyId: companyB }).expect(201))
      .body.id as string;

    const inA = await login("cici@example.com", companyA);
    const names = (await inA.get("/partners?limit=200").expect(200)).body.items.map(
      (p: { name: string }) => p.name,
    );
    expect(names).toEqual(expect.arrayContaining(["Pelanggan Bersama", "Pelanggan PT A"]));
    expect(names).not.toContain("Pelanggan PT B");
    await inA.get(`/partners/${privateB}`).expect(404);
    await inA.patch(`/partners/${privateB}`, { name: "Diubah" }).expect(404);
    // Membuat data untuk perusahaan lain juga butuh hak tulis di sana.
    await inA.post("/partners", { name: "Titipan", companyId: companyB }).expect(404);
    await inA.get(`/reports/trial-balance?dateTo=2026-12-31&companyIds=${companyA}`).expect(200);
    await inA.get(`/reports/trial-balance?dateTo=2026-12-31&companyIds=${companyA},${companyB}`).expect(400);

    // Admin (semua hak) tetap melihat semuanya.
    const all = (await a.get("/partners?limit=200").expect(200)).body.items.map(
      (p: { name: string }) => p.name,
    );
    expect(all).toContain("Pelanggan PT B");
  });

  it("hak khusus per akun: cabut satu fitur, tambah satu fitur tanpa modul", async () => {
    const hr = (await a.get("/roles").expect(200)).body.find((r: { code: string }) => r.code === "hr_staff");
    const dewi = await createUser("Dewi", "dewi@example.com", [hr.id]);
    await a
      .put(`/users/${dewi}/overrides`, {
        overrides: [
          { permission: "hr.recruitment.read", effect: "deny", note: "Bukan tim rekrutmen" },
          { permission: "hr.employees.export", effect: "deny" },
          { permission: "accounting.reports.read", effect: "grant", companyId: companyA },
        ],
      })
      .expect(200);
    const d = await login("dewi@example.com", companyA);
    await d.get("/employees").expect(200);
    await d.get("/applicants").expect(403);
    await d.get("/job-openings").expect(403);
    await d.get("/employees/export").expect(403);
    await d.get("/departments/export").expect(403); // departemen termasuk fitur data karyawan
    await d.get("/leave-types/export").expect(200);
    await d.get("/moves").expect(403); // hanya laporan yang ditambahkan
    const me = (await d.get("/auth/me").expect(200)).body;
    expect(me.permissions).toContain("accounting.reports.read");
    expect(me.permissions).not.toContain("hr.recruitment.read");
    // Hapus dibatasi terpisah dari ubah.
    await a
      .put(`/users/${dewi}/overrides`, { overrides: [{ permission: "hr.employees.delete", effect: "deny" }] })
      .expect(200);
    const dep = (await d.post("/departments", { name: "Sementara" }).expect(201)).body.id;
    await d.delete(`/departments/${dep}`).expect(403);
    const log = (await a.get(`/users/${dewi}/access-log`).expect(200)).body;
    expect(log.length).toBeGreaterThanOrEqual(2);
    const notes = (await d.get("/me/notifications").expect(200)).body as { kind: string }[];
    expect(notes.some((n) => n.kind === "access_changed")).toBe(true);
  });

  it("admin terdelegasi: tidak bisa memberi hak yang tidak dimiliki / membuat admin", async () => {
    const um = (
      await a
        .post("/roles", {
          code: "user_admin",
          name: "Admin Pengguna",
          permissions: ["user.read", "user.write", "hr.write", "company.read"],
        })
        .expect(201)
    ).body;
    await createUser("Rina Admin", "rina@example.com", [um.id]);
    const r = await login("rina@example.com");
    const viewer = (
      await a.post("/roles", { code: "hr_viewer", name: "Lihat SDM", permissions: ["hr.read"] }).expect(201)
    ).body;
    const hrStaff = (await r.get("/roles").expect(200)).body.find(
      (x: { code: string }) => x.code === "hr_staff",
    );
    const acct = (await r.get("/roles").expect(200)).body.find((x: { code: string }) => x.code === "acct");
    const target = (
      await r
        .post("/users", {
          name: "Toni",
          email: "toni@example.com",
          password: "rahasia123",
          roleIds: [viewer.id],
          companyIds: [companyA],
        })
        .expect(201)
    ).body.id;
    await r
      .post("/users", {
        name: "Xena",
        email: "x@example.com",
        password: "rahasia123",
        roleIds: [acct.id],
        companyIds: [companyA],
      })
      .expect(403);
    await r.put(`/users/${target}/roles`, { roles: [{ roleId: adminRole }] }).expect(403);
    await r.put(`/users/${target}/roles`, { roles: [{ roleId: hrStaff.id }] }).expect(403); // hr.manage tidak dimiliki
    await r
      .put(`/users/${target}/overrides`, { overrides: [{ permission: "accounting.read", effect: "grant" }] })
      .expect(403);
    await r
      .put(`/users/${target}/overrides`, {
        overrides: [{ permission: "hr.recruitment.read", effect: "deny" }],
      })
      .expect(200);
    await r.post("/roles", { code: "x", name: "X", permissions: [] }).expect(403); // butuh role.manage
    await r.post(`/users/${adminId}/deactivate`).expect(403); // admin di atas haknya
  });

  it("pengaman: tidak mengubah diri sendiri, admin terakhir tetap ada, nonaktif → token 401", async () => {
    await a.post(`/users/${adminId}/deactivate`).expect(403);
    await a.put(`/users/${adminId}/roles`, { roles: [] }).expect(403);
    const hr = (await a.get("/roles").expect(200)).body.find((r: { code: string }) => r.code === "hr_staff");
    const eko = await createUser("Eko", "eko@example.com", [hr.id]);
    const e = await login("eko@example.com");
    await e.get("/employees").expect(200);
    await a.post(`/users/${eko}/deactivate`).expect(201);
    await e.get("/employees").expect(401);
    await a.post(`/users/${eko}/activate`).expect(201);

    // Peran admin bawaan: hak tidak bisa diubah.
    await a
      .put(`/roles/${adminRole}`, { code: "admin", name: "Administrator", permissions: ["hr.read"] })
      .expect(400);
    const detail = (await a.get(`/users/${eko}`).expect(200)).body;
    expect(detail.roles[0].roleName).toBe("Staf SDM");
    await a.patch(`/users/${eko}`, { companyIds: [companyB], defaultCompanyId: companyB }).expect(200);
    expect(
      (await a.get(`/users/${eko}`).expect(200)).body.companies.map(
        (c: { companyId: string }) => c.companyId,
      ),
    ).toEqual([companyB]);
  });
});
