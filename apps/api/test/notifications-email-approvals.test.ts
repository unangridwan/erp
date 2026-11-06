import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../src/common/mailer.js";
import { NotificationMailer } from "../src/notifications/notifications.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Notifikasi juga dikirim lewat email (outbox setelah transaksi), dengan preferensi per pengguna; persetujuan opsional
 * sebelum payroll run diposting, mutasi diterapkan, dan penawaran kerja dikirim.
 */
describe.skipIf(!hasDb)("Email notifikasi & persetujuan payroll/mutasi/penawaran", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let rina: ReturnType<typeof client>;
  let tenantId: string;
  let employeeId: string;
  let runId: string;

  const outbox = () => app.get(Mailer).outbox;
  const flush = () => app.get(NotificationMailer).flush([tenantId]);
  const approve = (requestId: string) =>
    rina.post(`/approval-requests/${requestId}/approve`, { note: "OK" }).expect(200);

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "emailappr");
    const me = (await a.get("/auth/me").expect(200)).body;
    tenantId = me.tenantId;
    const roles = (await a.get("/roles").expect(200)).body as { id: string; code: string }[];
    await a
      .post("/users", {
        name: "Rina Direktur",
        email: "rina@example.com",
        password: "rahasia123",
        roleIds: [roles.find((r) => r.code === "admin")!.id],
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
    employeeId = (
      await a
        .post("/employees", {
          name: "Dewi Staf",
          contract: { contractType: "pkwtt", dateStart: "2026-01-05", wage: 8000000 },
        })
        .expect(201)
    ).body.id;
    runId = (await a.post("/payroll-runs", { period: "2026-02", paymentDate: "2026-02-25" }).expect(201)).body
      .id;
  });
  afterAll(() => app?.close());

  const enable = async (flags: Record<string, boolean>) => {
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, ...flags }).expect(200);
  };

  it("tanpa pengaturan persetujuan, payroll tetap bisa langsung diposting (perilaku lama)", async () => {
    const run = (await a.get(`/payroll-runs/${runId}`).expect(200)).body;
    expect(run.approval).toEqual({ required: false, request: null });
  });

  it("payroll run wajib disetujui sebelum diposting; penyetuju menerima email", async () => {
    await enable({ payrollRunApproval: true });
    expect((await a.post(`/payroll-runs/${runId}/post`).expect(400)).body.message).toMatch(
      /Ajukan persetujuan/,
    );
    const before = outbox().length;
    const submitted = (await a.post(`/payroll-runs/${runId}/submit-approval`).expect(200)).body;
    expect(submitted.approval.request).toMatchObject({ state: "submitted" });
    await a.post(`/payroll-runs/${runId}/submit-approval`).expect(400);
    expect((await a.post(`/payroll-runs/${runId}/post`).expect(400)).body.message).toMatch(
      /Menunggu persetujuan/,
    );

    // Email dikirim setelah transaksi oleh job pengirim, ke penyetuju (bukan ke pengaju).
    expect(await flush()).toBeGreaterThan(0);
    const mails = outbox().slice(before);
    expect(
      mails.some((m) => m.to === "rina@example.com" && /PYR\/2026/.test(m.subject) && /Payroll/.test(m.text)),
    ).toBe(true);
    expect(mails.every((m) => m.to !== "admin@example.com")).toBe(true);
    expect(await flush()).toBe(0);

    // Hitung ulang setelah diajukan: persetujuan batal, wajib ajukan ulang.
    await a.post(`/payroll-runs/${runId}/compute`).expect(200);
    expect((await a.get(`/payroll-runs/${runId}`).expect(200)).body.approval.request).toBeNull();
    const again = (await a.post(`/payroll-runs/${runId}/submit-approval`).expect(200)).body;
    await approve(again.approvalRequestId);
    await a.post(`/payroll-runs/${runId}/post`).expect(200);
  });

  it("pengguna yang mematikan email hanya mendapat notifikasi in-app", async () => {
    expect((await rina.get("/me/notification-settings").expect(200)).body).toMatchObject({
      email: true,
      address: "rina@example.com",
    });
    await flush(); // email notifikasi sebelumnya sudah terkirim
    await rina.put("/me/notification-settings", { email: false }).expect(200);
    await enable({ payrollRunApproval: true, movementApproval: true });
    const mv = (
      await a
        .post("/employee-movements", {
          employeeId,
          kind: "promotion",
          effectiveDate: "2026-03-01",
          newWage: "9000000",
          reason: "Kinerja baik",
        })
        .expect(201)
    ).body;
    const before = outbox().length;
    const unread = (await rina.get("/me/notifications/count").expect(200)).body.unread;
    await a.post(`/employee-movements/${mv.id}/submit-approval`).expect(200);
    await flush();
    expect(
      outbox()
        .slice(before)
        .some((m) => m.to === "rina@example.com"),
    ).toBe(false);
    expect((await rina.get("/me/notifications/count").expect(200)).body.unread).toBeGreaterThan(unread);
    await rina.put("/me/notification-settings", { email: true }).expect(200);
  });

  it("mutasi wajib disetujui; mengubah SK membatalkan persetujuan", async () => {
    const [mv] = (await a.get(`/employee-movements?employeeId=${employeeId}`).expect(200)).body;
    expect((await a.post(`/employee-movements/${mv.id}/apply`).expect(400)).body.message).toMatch(/Menunggu/);
    const detail = (await a.get(`/employee-movements/${mv.id}`).expect(200)).body;
    expect(detail.approval.required).toBe(true);
    await approve(detail.approval.request.id);
    // SK diubah setelah disetujui → wajib ajukan ulang.
    await a
      .put(`/employee-movements/${mv.id}`, {
        employeeId,
        kind: "promotion",
        effectiveDate: "2026-03-01",
        newWage: "9500000",
        reason: "Kinerja baik",
      })
      .expect(200);
    await a.post(`/employee-movements/${mv.id}/apply`).expect(400);
    const resubmitted = (await a.post(`/employee-movements/${mv.id}/submit-approval`).expect(200)).body;
    await approve(resubmitted.approvalRequestId);
    await a.post(`/employee-movements/${mv.id}/apply`).expect(200);
  });

  it("penawaran kerja wajib disetujui sebelum dikirim", async () => {
    await enable({ jobOfferApproval: true });
    const opening = (await a.post("/job-openings", { name: "Kasir", quota: 1 }).expect(201)).body.id;
    const applicant = (
      await a.post("/applicants", { openingId: opening, name: "Sinta", source: "referral" }).expect(201)
    ).body.id;
    const offer = (
      await a
        .post(`/applicants/${applicant}/offers`, {
          body: "Penawaran",
          wage: "5500000",
          startDate: inDays(10),
          validUntil: inDays(5),
        })
        .expect(201)
    ).body;
    await a.post(`/job-offers/${offer.id}/send`).expect(400);
    const submitted = (await a.post(`/job-offers/${offer.id}/submit-approval`).expect(200)).body;
    const [listed] = (await a.get(`/applicants/${applicant}/offers`).expect(200)).body;
    expect(listed.approval).toMatchObject({ required: true, request: { state: "submitted" } });
    await approve(submitted.approvalRequestId);
    await a.post(`/job-offers/${offer.id}/send`).expect(200);
  });
});
