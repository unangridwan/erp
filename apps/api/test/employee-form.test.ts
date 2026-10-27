import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../src/common/mailer.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** Form karyawan: tag, ringkasan (statistik, kontrak berjalan, akun portal), undang ke portal. */
describe.skipIf(!hasDb)("Form karyawan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let employeeId: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "empf");
    employeeId = (
      await a
        .post("/employees", {
          name: "Rina Wijaya",
          joinDate: "2024-01-02",
          workEmail: "rina@example.com",
          tags: ["Remote", "Gedung B", "Remote"],
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app?.close());

  it("tag disimpan tanpa duplikat & bisa dicari; maksimal 10", async () => {
    const e = (await a.get(`/employees/${employeeId}`).expect(200)).body;
    expect(e.tags).toEqual(["Remote", "Gedung B"]);
    const found = (await a.get("/employees?q=gedung").expect(200)).body.items;
    expect(found.map((x: { id: string }) => x.id)).toContain(employeeId);
    await a
      .patch(`/employees/${employeeId}`, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })
      .expect(400);
  });

  it("ringkasan: statistik, kontrak berjalan & tunjangan tetap, status akun", async () => {
    const empty = (await a.get(`/employees/${employeeId}/overview`).expect(200)).body;
    expect(empty).toMatchObject({
      appraisals: 0,
      goals: 0,
      hoursThisMonth: "0.00",
      hasPhoto: false,
      contract: null,
      account: { status: "none" },
    });
    const contract = (
      await a
        .post("/contracts", {
          employeeId,
          wage: "8000000",
          dateStart: "2024-01-02",
          taxMethod: "gross_up",
        })
        .expect(201)
    ).body;
    await a.post(`/contracts/${contract.id}/start`).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    await a
      .post("/attendance", {
        employeeId,
        checkIn: `${today}T01:00:00.000Z`,
        checkOut: `${today}T09:30:00.000Z`,
      })
      .expect(201);
    const after = (await a.get(`/employees/${employeeId}/overview`).expect(200)).body;
    expect(after.contract).toMatchObject({ id: contract.id, wage: "8000000.00", taxMethod: "gross_up" });
    expect(Number(after.hoursThisMonth)).toBeCloseTo(8.5, 1);
  });

  it("undang ke portal: email karyawan, terima → akun tertaut; tanpa email 400", async () => {
    const noEmail = (await a.post("/employees", { name: "Tanpa Email", joinDate: "2024-01-02" }).expect(201))
      .body.id;
    await a.post(`/employees/${noEmail}/invite`, {}).expect(400);

    const res = (await a.post(`/employees/${employeeId}/invite`, {}).expect(201)).body;
    expect(res).toMatchObject({ status: "invited", email: "rina@example.com" });
    expect((await a.get(`/employees/${employeeId}/overview`)).body.account).toMatchObject({
      status: "invited",
      email: "rina@example.com",
    });
    const mail = app.get(Mailer).outbox.at(-1)!;
    expect(mail.to).toBe("rina@example.com");
    const token = decodeURIComponent(mail.text.match(/#token=(\S+)/)![1]!);
    const session = (
      await request(app.getHttpServer())
        .post("/auth/accept-invite")
        .send({ token, password: "passwordRina1" })
        .expect(201)
    ).body;
    const rina = client(app, session.token);
    expect((await rina.get("/me/employee").expect(200)).body.id).toBe(employeeId);
    const overview = (await a.get(`/employees/${employeeId}/overview`)).body;
    expect(overview.account).toMatchObject({ status: "linked", email: "rina@example.com" });
    await a.post(`/employees/${employeeId}/invite`, {}).expect(400); // sudah punya akun
  });
});
