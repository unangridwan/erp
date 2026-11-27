import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../src/common/mailer.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;

describe.skipIf(!hasDb)("Persetujuan offboarding/F&F & OTP slip gaji", { timeout: 60_000 }, () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let hr2: Api;
  let sari: Api;
  const emp: Record<string, string> = {};

  const login = async (email: string) =>
    client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email, password: "rahasia123" })
          .expect(200)
      ).body.token,
    );

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "offapproval");
    const me = (await a.get("/auth/me")).body;
    const role = async (code: string, permissions: string[]) =>
      (await a.post("/roles", { code, name: code, permissions }).expect(201)).body.id as string;
    const hrRole = await role("hr2", ["hr.read", "hr.write", "hr.manage"]);
    const staffRole = await role("staf", []);
    const user = async (name: string, email: string, roleId: string) =>
      (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [roleId],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
    await user("Hana HR", "hana@example.com", hrRole);
    const sariUser = await user("Sari Staf", "sari@example.com", staffRole);
    for (const [key, name, userId] of [
      ["budi", "Budi Keluar", null],
      ["dodi", "Dodi Ditolak", null],
      ["sari", "Sari Staf", sariUser],
    ] as const) {
      emp[key] = (
        await a
          .post("/employees", { name, joinDate: "2024-01-01", ...(userId ? { userId } : {}) })
          .expect(201)
      ).body.id;
      const c = (
        await a
          .post("/contracts", { employeeId: emp[key], wage: "5000000", dateStart: "2024-01-01" })
          .expect(201)
      ).body;
      await a.post(`/contracts/${c.id}/start`).expect(200);
      emp[`${key}Contract`] = c.id;
    }
    hr2 = await login("hana@example.com");
    sari = await login("sari@example.com");
  });
  afterAll(() => app?.close());

  it("persetujuan offboarding: keluar diajukan dulu, diproses setelah disetujui; ditolak = tetap aktif", async () => {
    // Tanpa pengaturan: langsung diproses seperti biasa (diuji di test offboarding lain); aktifkan persetujuan.
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, offboardingApproval: true }).expect(200);

    const res = (
      await a
        .post(`/employees/${emp.budi}/offboard`, {
          resignDate: "2026-11-30",
          resignReason: "resign",
          resignNote: "Pindah kota",
        })
        .expect(200)
    ).body;
    expect(res.pending).toBe(true);
    expect(res.request.approval.number).toMatch(/^OFB/);
    expect((await a.get(`/employees/${emp.budi}`).expect(200)).body.resignDate).toBeNull();
    // Sekali saja selama masih menunggu; Akhiri kontrak → keluar juga harus lewat pengajuan.
    await a
      .post(`/employees/${emp.budi}/offboard`, { resignDate: "2026-11-30", resignReason: "resign" })
      .expect(400);
    const close = await a
      .post(`/contracts/${emp.budiContract}/close`, {
        dateEnd: "2026-11-30",
        exit: true,
        resignReason: "resign",
      })
      .expect(400);
    expect(close.body.message).toMatch(/Persetujuan offboarding aktif/);

    // Rincian permintaan memuat cuplikan F&F; pemohon tidak boleh menyetujui sendiri.
    const req = (await a.get(`/approval-requests/${res.request.approval.id}`).expect(200)).body;
    expect(req.description).toContain("Keluar 2026-11-30");
    await a.post(`/approval-requests/${res.request.approval.id}/approve`, {}).expect(403);
    await hr2.post(`/approval-requests/${res.request.approval.id}/approve`, {}).expect(200);
    expect((await a.get(`/employees/${emp.budi}`).expect(200)).body).toMatchObject({
      resignDate: "2026-11-30",
      resignReason: "resign",
    });
    const fnf = (await a.get(`/employees/${emp.budi}/final-settlement`).expect(200)).body;
    expect(fnf.offboardingApproval).toBe(true);
    expect(fnf.approvals.exit).toMatchObject({ state: "approved" });

    // Persetujuan F&F setelah keluar; status tercetak di PDF.
    const st = (await a.post(`/employees/${emp.budi}/final-settlement/approval`).expect(201)).body;
    expect(st).toMatchObject({ kind: "settlement", state: "pending" });
    await a.post(`/employees/${emp.budi}/final-settlement/approval`).expect(400);
    await hr2.post(`/approval-requests/${st.approval.id}/approve`, {}).expect(200);
    expect(
      (await a.get(`/employees/${emp.budi}/final-settlement`).expect(200)).body.approvals.settlement.state,
    ).toBe("approved");
    await a.get(`/employees/${emp.budi}/final-settlement/pdf`).expect(200);

    // Ditolak: karyawan tetap aktif; F&F sebelum keluar ditolak.
    await a.post(`/employees/${emp.dodi}/final-settlement/approval`).expect(400);
    const dodi = (
      await a
        .post(`/employees/${emp.dodi}/offboard`, { resignDate: "2026-12-15", resignReason: "termination" })
        .expect(200)
    ).body;
    await hr2.post(`/approval-requests/${dodi.request.approval.id}/refuse`, { note: "Belum" }).expect(200);
    expect((await a.get(`/employees/${emp.dodi}`).expect(200)).body.resignDate).toBeNull();
    expect(
      (await a.get(`/employees/${emp.dodi}/final-settlement`).expect(200)).body.approvals.exit.state,
    ).toBe("refused");
  });

  it("OTP email membuka slip gaji (sekali pakai, jeda kirim 1 menit)", async () => {
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, payslipPinRequired: true }).expect(200);
    expect((await sari.get("/me/payslip-pin").expect(200)).body).toMatchObject({
      required: true,
      hasPin: false,
      otpAvailable: true,
      unlocked: false,
    });
    const mailer = app.get(Mailer);
    const before = mailer.outbox.length;
    const sent = (await sari.post("/me/payslip-pin/otp").expect(200)).body;
    expect(sent.sentTo).toBe("sa***@example.com");
    const mail = mailer.outbox.slice(before).find((m) => m.to === "sari@example.com")!;
    const code = /(\d{6})/.exec(mail.text)![1]!;
    await sari.post("/me/payslip-pin/otp").expect(400);
    await sari.post("/me/payslip-pin/verify", { otp: code === "000000" ? "111111" : "000000" }).expect(400);
    await sari.post("/me/payslip-pin/verify", { pin: "123456", otp: code }).expect(400);
    await sari.post("/me/payslip-pin/verify", { otp: code }).expect(200);
    expect((await sari.get("/me/payslip-pin").expect(200)).body.unlocked).toBe(true);
    // Sekali pakai.
    expect((await sari.post("/me/payslip-pin/verify", { otp: code }).expect(400)).body.errors[0].path).toBe(
      "otp",
    );
  });
});
