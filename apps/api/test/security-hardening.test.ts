import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** Hasil audit keamanan: SSRF lewat URL tenant, hak baca log aktivitas, pembatas percobaan PIN kiosk. */
describe.skipIf(!hasDb)("Pengerasan keamanan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let companyId: string;
  const flag = process.env.ALLOW_PRIVATE_WEBHOOKS;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "sec-hard");
    companyId = (await a.get("/auth/me")).body.activeCompanyId;
  });
  afterAll(async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = flag;
    await app?.close();
  });

  it("URL webhook & issuer SSO ke alamat internal ditolak saat disimpan", async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = "false";
    const appBody = (webhookUrl: string) => ({
      name: "Aplikasi Uji",
      redirectUris: ["https://app.example.com/callback"],
      webhookUrl,
      webhookEvents: ["employee.created"],
    });
    for (const url of ["http://127.0.0.1:6379/", "http://169.254.169.254/latest/", "http://localhost/hook"])
      await a.post("/connected-apps", appBody(url)).expect(400);
    await a.post("/connected-apps", appBody("https://hooks.example.com/erp")).expect(201);
    process.env.ALLOW_PRIVATE_WEBHOOKS = flag;
  });

  it("log aktivitas hanya untuk yang berhak membaca datanya", async () => {
    const emp = (await a.post("/employees", { name: "Rina", joinDate: "2024-01-01" }).expect(201)).body.id;
    await a.get(`/activity/employee/${emp}`).expect(200);
    await a.get(`/activity/tidak_dikenal/${emp}`).expect(403);

    const role = (
      await a
        .post("/roles", { code: "gudang_saja", name: "Gudang", permissions: ["inventory.read"] })
        .expect(201)
    ).body;
    await a
      .post("/users", {
        name: "Gilang",
        email: "gilang@example.com",
        password: "rahasia123",
        roleIds: [role.id],
        companyIds: [companyId],
      })
      .expect(201);
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "gilang@example.com", password: "rahasia123" })
        .expect(200)
    ).body.token as string;
    const g = client(app, token);
    await g.get(`/activity/employee/${emp}`).expect(403);
    await g.get(`/activity/payroll_run/${emp}`).expect(403);
    await g.get(`/activity/stock_picking/${emp}`).expect(200);
  });

  it("PIN kiosk: terkunci setelah 5 percobaan salah", async () => {
    const emp = (
      await a
        .post("/employees", { name: "Kiki Kiosk", joinDate: "2024-01-01", badgeCode: "K777" })
        .expect(201)
    ).body.id;
    await a.put(`/employees/${emp}/attendance-pin`, { pin: "4821" }).expect(204);
    for (let i = 0; i < 5; i++) await a.post("/attendance/kiosk", { code: "K777", pin: "0000" }).expect(400);
    // PIN benar pun ditolak selama masa kunci.
    await a.post("/attendance/kiosk", { code: "K777", pin: "4821" }).expect(429);
  });
});
