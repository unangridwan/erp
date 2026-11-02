import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import { addDays } from "@erp/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { Mailer } from "../src/common/mailer.js";
import { HrReminderService } from "../src/hr/recruitment.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
const PDF = Buffer.from("%PDF-1.4\n%uji\n").toString("base64");
const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!hasDb)("HR: rekrutmen, dokumen, checklist, pengingat", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let tenantId: string;
  let companyId: string;
  let staffRole: string;
  let opening: string;
  let sari: string;
  let employee: string;

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
  const user = async (name: string, email: string) =>
    (
      await a
        .post("/users", {
          name,
          email,
          password: "rahasia123",
          roleIds: [staffRole],
          companyIds: [companyId],
        })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "recruit");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    companyId = me.activeCompanyId;
    // Peran tanpa permission (hanya portal).
    const [role] = await app
      .get(TenantDb)
      .runAs(tenantId, (tx) =>
        tx.insert(schema.roles).values({ code: "portal", name: "Portal" }).returning({ id: schema.roles.id }),
      );
    staffRole = role!.id;
  });
  afterAll(() => app?.close());

  it("lowongan & pelamar: tahap kanban, penolakan beralasan, wawancara", async () => {
    const dept = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;
    const job = (await a.post("/job-positions", { name: "Staf Akuntansi" }).expect(201)).body.id;
    opening = (
      await a
        .post("/job-openings", { name: "Staf Akuntansi 2026", jobId: job, departmentId: dept, quota: 1 })
        .expect(201)
    ).body.id;
    sari = (
      await a
        .post("/applicants", {
          openingId: opening,
          name: "Sari Lestari",
          email: "sari@contoh.id",
          phone: "0812",
          source: "jobportal",
          expectedWage: "6500000",
        })
        .expect(201)
    ).body.id;
    const tono = (await a.post("/applicants", { openingId: opening, name: "Tono" }).expect(201)).body.id;
    await a.post(`/applicants/${tono}/stage`, { stage: "refused" }).expect(400);
    // Alasan dari master alasan penolakan (wajib), catatan teks opsional.
    const reason = (await a.get("/refuse-reasons").expect(200)).body.find(
      (r: { name: string }) => r.name === "Tidak memenuhi kualifikasi",
    ).id;
    await a
      .post(`/applicants/${tono}/stage`, {
        stage: "refused",
        refuseReasonId: reason,
        refuseReason: "Pengalaman kurang",
      })
      .expect(200);

    await a
      .post("/hr-documents", {
        applicantId: sari,
        kind: "cv",
        name: "CV Sari",
        file: { name: "cv.pdf", type: "application/pdf", data: PDF },
      })
      .expect(201);
    await a
      .post("/hr-documents", {
        applicantId: sari,
        kind: "cv",
        name: "X",
        file: { name: "a.gif", type: "image/gif", data: "AAAA" },
      })
      .expect(400);

    await a.post(`/applicants/${sari}/stage`, { stage: "screening" }).expect(200);
    const withInterview = (
      await a
        .post(`/applicants/${sari}/interviews`, {
          scheduledAt: `${addDays(today, 2)}T03:00:00Z`,
          location: "Ruang rapat 1",
        })
        .expect(201)
    ).body;
    expect(withInterview).toMatchObject({
      stage: "interview",
      interviews: [expect.objectContaining({ done: false })],
    });
    const list = (await a.get(`/applicants?openingId=${opening}`).expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === sari).nextInterview).toBeTruthy();
    const done = (
      await a
        .put(`/applicants/${sari}/interviews/${withInterview.interviews[0].id}`, {
          scheduledAt: `${addDays(today, 2)}T03:00:00Z`,
          result: "Komunikasi baik",
          score: 4,
          done: true,
        })
        .expect(200)
    ).body;
    expect(done.interviews[0]).toMatchObject({ score: 4, done: true });
    await a.post(`/applicants/${sari}/stage`, { stage: "offer" }).expect(200);
  });

  it("terima pelamar: penawaran wajib → calon karyawan + kontrak draft + dokumen; kontrak dimulai → aktif + onboarding", async () => {
    const join = addDays(today, 10);
    // Belum ada penawaran yang diterima.
    await a
      .post(`/applicants/${sari}/hire`, {
        joinDate: join,
        wage: "6000000",
        contractType: "pkwt",
        dateEnd: addDays(join, 364),
      })
      .expect(400);
    const offer = (
      await a
        .post(`/applicants/${sari}/offers`, {
          body: "Penawaran kerja Sari",
          wage: "6000000",
          contractType: "pkwt",
          contractEnd: addDays(join, 364),
          startDate: join,
          validUntil: addDays(today, 5),
        })
        .expect(201)
    ).body;
    await a.post(`/job-offers/${offer.id}/send`).expect(200);
    await a.post(`/job-offers/${offer.id}/accept`).expect(200);
    const hired = (await a.post(`/applicants/${sari}/hire`, {}).expect(200)).body;
    employee = hired.employeeId;
    expect(hired.checklistId).toBeNull();
    expect((await a.get(`/employees/${employee}`).expect(200)).body).toMatchObject({
      name: "Sari Lestari",
      workEmail: "sari@contoh.id",
      joinDate: join,
      active: false,
      pendingStart: true,
    });
    expect((await a.get(`/contracts/${hired.contractId}`).expect(200)).body).toMatchObject({
      state: "draft",
      contractType: "pkwt",
      wage: "6000000.00",
    });
    const docs = (await a.get(`/hr-documents?employeeId=${employee}`).expect(200)).body;
    expect(docs).toEqual([expect.objectContaining({ kind: "cv", name: "CV Sari", applicantId: sari })]);
    const file = await a.get(`/hr-documents/${docs[0].id}/file`).expect(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect((await a.get(`/hr-checklists?employeeId=${employee}`).expect(200)).body).toEqual([]);

    // Kontrak dimulai → karyawan aktif & onboarding (tugas tanda tangan kontrak langsung selesai).
    await a.post(`/contracts/${hired.contractId}/start`).expect(200);
    expect((await a.get(`/employees/${employee}`).expect(200)).body).toMatchObject({
      active: true,
      pendingStart: false,
    });
    const [started] = (await a.get(`/hr-checklists?employeeId=${employee}`).expect(200)).body;
    const checklist = (await a.get(`/hr-checklists/${started.id}`).expect(200)).body;
    expect(checklist).toMatchObject({ kind: "onboarding", baseDate: join, state: "open" });
    expect(checklist.tasks).toHaveLength(5);
    expect(checklist.tasks.find((t: { name: string }) => t.name.startsWith("Daftarkan BPJS")).dueDate).toBe(
      addDays(join, 7),
    );
    expect(checklist.tasks.find((t: { name: string }) => /kontrak/i.test(t.name)).doneAt).toBeTruthy();

    expect((await a.get(`/job-openings/${opening}`).expect(200)).body).toMatchObject({
      state: "closed",
      dateClose: today,
    });
    await a.post(`/applicants/${sari}/hire`, { joinDate: join, wage: "1" }).expect(400);
    await a.post("/applicants", { openingId: opening, name: "Telat" }).expect(400);
  });

  it("template onboarding bawaan perusahaan dipakai untuk karyawan baru; tugas karyawan di portal", async () => {
    await a
      .post("/hr-checklist-templates", { kind: "onboarding", name: "Onboarding kantor", items: [] })
      .expect(400);
    await a
      .post("/hr-checklist-templates", {
        kind: "onboarding",
        name: "Onboarding kantor",
        isDefault: true,
        items: [
          { name: "Ambil kartu akses", responsible: "employee", dueDays: 0 },
          { name: "Briefing K3", responsible: "hr", dueDays: 2 },
        ],
      })
      .expect(201);
    const uid = await user("Rudi Baru", "rudi@example.com");
    const rudi = (
      await a.post("/employees", { name: "Rudi Baru", userId: uid, joinDate: addDays(today, -5) }).expect(201)
    ).body.id;
    const [list] = (await a.get(`/hr-checklists?employeeId=${rudi}`).expect(200)).body;
    expect(list).toMatchObject({ name: "Onboarding kantor", tasks: 2, done: 0, overdue: 2 });
    // Karyawan lama yang diimpor (masuk > 30 hari lalu) tidak dibuatkan onboarding.
    const old = (await a.post("/employees", { name: "Lama", joinDate: "2020-01-01" }).expect(201)).body.id;
    expect((await a.get(`/hr-checklists?employeeId=${old}`).expect(200)).body).toEqual([]);

    const rudiApi = await login("rudi@example.com");
    const mine = (await rudiApi.get("/me/checklist-tasks").expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ name: "Ambil kartu akses", employeeName: "Rudi Baru" })]);
    const detail = (await a.get(`/hr-checklists/${list.id}`).expect(200)).body;
    const hrTask = detail.tasks.find((t: { name: string }) => t.name === "Briefing K3");
    await rudiApi.post(`/hr-checklists/tasks/${hrTask.id}`, { done: true }).expect(403);
    await rudiApi.post(`/hr-checklists/tasks/${mine[0].id}`, { done: true }).expect(200);
    const finished = (await a.post(`/hr-checklists/tasks/${hrTask.id}`, { done: true }).expect(200)).body;
    expect(finished.state).toBe("done");
  });

  it("offboarding otomatis saat tanggal keluar diisi; tugas nonaktifkan akun menonaktifkan login", async () => {
    const uid = await user("Budi Keluar", "budi@example.com");
    const budi = (
      await a.post("/employees", { name: "Budi Keluar", userId: uid, joinDate: "2022-01-01" }).expect(201)
    ).body.id;
    await a.post("/hr-checklists", { employeeId: budi, kind: "offboarding" }).expect(400); // tanggal keluar kosong
    await login("budi@example.com");
    await a.patch(`/employees/${budi}`, { resignDate: addDays(today, 14) }).expect(200);
    const [off] = (await a.get(`/hr-checklists?employeeId=${budi}`).expect(200)).body;
    expect(off).toMatchObject({ kind: "offboarding", baseDate: addDays(today, 14), tasks: 5 });
    const detail = (await a.get(`/hr-checklists/${off.id}`).expect(200)).body;
    expect(detail.tasks.map((t: { action: string | null }) => t.action).filter(Boolean)).toEqual([
      "severance",
      "deactivate_user",
    ]);
    const deactivate = detail.tasks.find((t: { action: string }) => t.action === "deactivate_user");
    await a.post(`/hr-checklists/tasks/${deactivate.id}`, { done: true }).expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "budi@example.com", password: "rahasia123" })
      .expect(401);
  });

  it("pengingat: dokumen kedaluwarsa, kontrak PKWT berakhir, tugas lewat tenggat; email harian sekali per hari", async () => {
    await a
      .post("/hr-documents", {
        employeeId: employee,
        kind: "certificate",
        name: "Sertifikat Brevet",
        issuedDate: "2024-01-01",
        expiryDate: addDays(today, 10),
        file: { name: "brevet.pdf", type: "application/pdf", data: PDF },
      })
      .expect(201);
    await a
      .post("/hr-documents", {
        employeeId: employee,
        kind: "certificate",
        name: "Salah",
        issuedDate: "2024-01-01",
        expiryDate: "2023-01-01",
        file: { name: "x.pdf", type: "application/pdf", data: PDF },
      })
      .expect(400);
    const pkwt = (await a.post("/employees", { name: "Kontrak Habis", joinDate: "2025-01-01" }).expect(201))
      .body.id;
    const c = (
      await a
        .post("/contracts", {
          employeeId: pkwt,
          contractType: "pkwt",
          wage: "5000000",
          dateStart: "2025-01-01",
          dateEnd: addDays(today, 20),
        })
        .expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);

    const r = (await a.get("/hr/reminders").expect(200)).body;
    expect(r.documents).toEqual([
      expect.objectContaining({ name: "Sertifikat Brevet", expiry: { days: 10, status: "soon" } }),
    ]);
    expect(r.contracts).toEqual([
      expect.objectContaining({ employeeName: "Kontrak Habis", expiry: { days: 20, status: "soon" } }),
    ]);
    expect(r.overdueTasks.length).toBeGreaterThanOrEqual(0);
    expect((await a.get("/hr-documents/expiring?days=5").expect(200)).body).toEqual([]);

    const mailer = app.get(Mailer);
    const before = mailer.outbox.length;
    const reminder = app.get(HrReminderService);
    expect(await reminder.runDaily([tenantId])).toBe(1); // hanya admin yang punya hr.manage
    const mail = mailer.outbox.at(-1)!;
    expect(mailer.outbox.length).toBe(before + 1);
    expect(mail).toMatchObject({ to: "admin@example.com", subject: expect.stringContaining("Pengingat HR") });
    expect(mail.text).toContain("Kontrak PKWT");
    expect(mail.text).toContain("Sertifikat Brevet");
    expect(await reminder.runDaily([tenantId])).toBe(0);
  });

  it("dokumen khusus hr.manage; hapus dokumen", async () => {
    const staff = await login("rudi@example.com");
    await staff.get(`/hr-documents?employeeId=${employee}`).expect(403);
    await staff.get("/hr/reminders").expect(403);
    const docs = (await a.get(`/hr-documents?employeeId=${employee}`).expect(200)).body;
    await a.delete(`/hr-documents/${docs[0].id}`).expect(204);
    expect((await a.get(`/hr-documents?employeeId=${employee}`).expect(200)).body).toHaveLength(
      docs.length - 1,
    );
  });
});
