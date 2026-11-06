import type { INestApplication } from "@nestjs/common";
import { eq, schema, sql } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { HrReminderService } from "../src/hr/recruitment.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Masa percobaan PKWTT, UU PDP (persetujuan & retensi pelamar, log akses data pribadi), dan PIN slip gaji. */
describe.skipIf(!hasDb)("Masa percobaan, UU PDP & PIN slip", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let me: { tenantId: string; activeCompanyId: string };
  let sari: ReturnType<typeof client>;
  let sariEmployee: string;
  let contractId: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "pdppin");
    me = (await a.get("/auth/me").expect(200)).body;
    const roles = (await a.get("/roles").expect(200)).body as { id: string; code: string }[];
    const db = app.get(TenantDb);
    const [staff] = await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.roles)
        .values({ code: "karyawan", name: "Karyawan" })
        .returning({ id: schema.roles.id }),
    );
    expect(roles.length).toBeGreaterThan(0);
    const userId = (
      await a
        .post("/users", {
          name: "Sari",
          email: "sari@example.com",
          password: "rahasia123",
          roleIds: [staff!.id],
          companyIds: [me.activeCompanyId],
        })
        .expect(201)
    ).body.id;
    const hired = (
      await a
        .post("/employees", {
          name: "Sari Staf",
          userId,
          nik: "3201010101010005",
          contract: { contractType: "pkwtt", dateStart: inDays(-80), wage: 7000000, probationMonths: 3 },
        })
        .expect(201)
    ).body;
    sariEmployee = hired.id;
    contractId = hired.contractId;
    sari = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
  });
  afterAll(() => app?.close());

  it("masa percobaan hanya PKWTT, maks. 3 bulan; muncul di pengingat & daftar", async () => {
    const pkwt = await a
      .post("/employees", {
        name: "Kontrak",
        contract: {
          contractType: "pkwt",
          dateStart: inDays(0),
          dateEnd: inDays(300),
          wage: 5000000,
          probationMonths: 2,
        },
      })
      .expect(400);
    expect(pkwt.body.errors?.[0]?.path).toBe("contract.probationMonths");
    await a
      .post("/employees", {
        name: "Lama",
        contract: { contractType: "pkwtt", dateStart: inDays(0), wage: 5000000, probationMonths: 4 },
      })
      .expect(400);

    const c = (await a.get(`/contracts/${contractId}`).expect(200)).body;
    expect(c.probationMonths).toBe(3);
    expect(c.probationEnd).toBeTruthy();
    const list = (await a.get("/hr/probations").expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ employeeName: "Sari Staf", probationResult: null })]);
    const reminders = (await a.get("/hr/reminders?days=30").expect(200)).body;
    expect(reminders.probations.map((p: { employeeName: string }) => p.employeeName)).toContain("Sari Staf");
  });

  it("evaluasi lulus → surat pengangkatan; keluar dari daftar berjalan", async () => {
    await a.get(`/contracts/${contractId}/appointment-letter`).expect(400);
    const decided = (
      await a
        .post(`/contracts/${contractId}/probation`, { result: "passed", note: "Kinerja baik" })
        .expect(200)
    ).body;
    expect(decided.probationResult).toBe("passed");
    const pdf = await a.get(`/contracts/${contractId}/appointment-letter`).expect(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect((await a.get("/hr/probations").expect(200)).body).toHaveLength(0);
    expect((await a.get("/hr/probations?state=all").expect(200)).body).toHaveLength(1);
  });

  it("persetujuan pelamar dicatat; anonimisasi manual & otomatis (retensi)", async () => {
    const opening = (await a.post("/job-openings", { name: "Admin", quota: 1 }).expect(201)).body.id;
    const withConsent = (
      await a
        .post("/applicants", { openingId: opening, name: "Rudi", email: "rudi@example.com", consent: true })
        .expect(201)
    ).body;
    expect(withConsent.consentAt).toBeTruthy();
    expect(withConsent.consentSource).toBe("form");
    const anon = (await a.post(`/applicants/${withConsent.id}/anonymize`).expect(200)).body;
    expect(anon).toMatchObject({ name: "Pelamar (dianonimkan)", email: null });
    expect(anon.anonymizedAt).toBeTruthy();
    await a.put(`/applicants/${withConsent.id}`, { openingId: opening, name: "X" }).expect(400);

    const old = (await a.post("/applicants", { openingId: opening, name: "Tono", phone: "0812" }).expect(201))
      .body;
    await a
      .post(`/applicants/${old.id}/stage`, { stage: "refused", refuseReason: "Tidak sesuai" })
      .catch(() => undefined);
    await app.get(TenantDb).runAs(me.tenantId, (tx) =>
      tx
        .update(schema.applicants)
        .set({ stage: "refused", stageChangedAt: sql`now() - interval '13 months'` })
        .where(eq(schema.applicants.id, old.id)),
    );
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, applicantRetentionMonths: 12 }).expect(200);
    await app.get(HrReminderService).runDaily([me.tenantId]);
    const after = (await a.get(`/applicants/${old.id}`).expect(200)).body;
    expect(after).toMatchObject({ name: "Pelamar (dianonimkan)", phone: null });
  });

  it("akses data pribadi oleh HR dicatat; akses karyawan atas datanya sendiri tidak", async () => {
    await a.get(`/employees/${sariEmployee}`).expect(200);
    const logs = (await a.get(`/personal-data-access-logs?employeeId=${sariEmployee}`).expect(200)).body;
    expect(logs[0]).toMatchObject({ purpose: "Membuka data karyawan", employeeName: "Sari Staf" });
    expect(logs[0].fields).toContain("nik");
    await sari.get("/personal-data-access-logs").expect(403);
  });

  it("PIN slip: wajib diatur & dimasukkan sebelum melihat slip; 5 kali salah terkunci; HR atur ulang", async () => {
    const run = (
      await a.post("/payroll-runs", { period: inDays(0).slice(0, 7), paymentDate: inDays(0) }).expect(201)
    ).body;
    await a.post(`/payroll-runs/${run.id}/post`).expect(200);
    const slipId = run.payslips.find((p: { employeeId: string }) => p.employeeId === sariEmployee).id;
    // Belum diwajibkan: slip langsung terbuka.
    await sari.get("/me/payslips").expect(200);

    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, payslipPinRequired: true }).expect(200);
    expect((await sari.get("/me/payslips").expect(403)).body.message).toMatch(/Atur PIN/);
    expect((await sari.get("/me/payslip-pin").expect(200)).body).toMatchObject({
      required: true,
      hasPin: false,
    });

    await sari.put("/me/payslip-pin", { pin: "12ab" }).expect(400);
    await sari.put("/me/payslip-pin", { pin: "246810" }).expect(200);
    await sari.get(`/payslips/${slipId}`).expect(200);
    // Mengubah PIN butuh PIN lama.
    await sari.put("/me/payslip-pin", { pin: "135790" }).expect(400);

    // Sesi buka habis → harus memasukkan PIN lagi.
    await app
      .get(TenantDb)
      .runAs(me.tenantId, (tx) =>
        tx
          .update(schema.employees)
          .set({ payslipUnlockedUntil: null })
          .where(eq(schema.employees.id, sariEmployee)),
      );
    expect((await sari.get(`/payslips/${slipId}`).expect(403)).body.message).toMatch(/Masukkan PIN/);
    for (let i = 0; i < 5; i++) await sari.post("/me/payslip-pin/verify", { pin: "000000" }).expect(400);
    expect((await sari.post("/me/payslip-pin/verify", { pin: "246810" }).expect(403)).body.message).toMatch(
      /terkunci/,
    );

    await a.post(`/employees/${sariEmployee}/payslip-pin/reset`).expect(200);
    expect((await sari.get("/me/payslip-pin").expect(200)).body).toMatchObject({
      hasPin: false,
      lockedUntil: null,
    });
    await sari.put("/me/payslip-pin", { pin: "246810" }).expect(200);
    await sari.post("/me/payslip-pin/verify", { pin: "246810" }).expect(200);
    await sari.get("/me/payslips").expect(200);

    // HR membuka slip karyawan → tercatat sebagai akses gaji; hash PIN tidak pernah dikirim.
    await a.get(`/payslips/${slipId}`).expect(200);
    const logs = (await a.get(`/personal-data-access-logs?employeeId=${sariEmployee}`).expect(200)).body;
    expect(logs.some((l: { fields: string[] }) => l.fields.includes("salary"))).toBe(true);
    const employee = (await a.get(`/employees/${sariEmployee}`).expect(200)).body;
    expect(employee.payslipPinHash).toBeUndefined();
    expect(employee.hasPayslipPin).toBe(true);
  });
});
