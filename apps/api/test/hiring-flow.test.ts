import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Alur penuh penambahan karyawan: MPP disetujui → FPK dari baris MPP (kepala departemen, dibatasi sisa kuota) →
 * persetujuan → lowongan → pelamar → penawaran diterima → calon karyawan + kontrak draft (belum aktif, belum di
 * payroll) → kontrak dimulai → karyawan aktif + onboarding (tugas atasan ke kepala departemen) → realisasi MPP.
 */
describe.skipIf(!hasDb)("Alur penambahan karyawan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let rina: ReturnType<typeof client>;
  let budi: ReturnType<typeof client>;
  let budiUser: string;
  let itDept: string;
  let programmer: string;
  let lineId: string;
  let planId: string;
  let fpkId: string;
  let openingId: string;
  const year = new Date().getFullYear() + 1;

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
    a = await signup(app, "alurrekrut");
    const me = (await a.get("/auth/me")).body;
    const mkRole = async (code: string, permissions: string[]) =>
      (await a.post("/roles", { code, name: code, permissions }).expect(201)).body.id as string;
    const mkUser = async (name: string, email: string, roleIds: string[]) =>
      (
        await a
          .post("/users", { name, email, password: "rahasia123", roleIds, companyIds: [me.activeCompanyId] })
          .expect(201)
      ).body.id as string;
    await mkUser("Rina HR", "rina@example.com", [
      await mkRole("hr_mgr", ["hr.read", "hr.write", "hr.manage"]),
    ]);
    budiUser = await mkUser("Budi Kepala IT", "budi@example.com", [await mkRole("staf", [])]);
    rina = await login("rina@example.com");
    budi = await login("budi@example.com");
    itDept = (await a.post("/departments", { name: "IT" }).expect(201)).body.id;
    programmer = (await a.post("/job-positions", { name: "Programmer" }).expect(201)).body.id;
    const budiEmp = (
      await a
        .post("/employees", {
          name: "Budi",
          departmentId: itDept,
          jobId: programmer,
          userId: budiUser,
          joinDate: "2020-01-02",
        })
        .expect(201)
    ).body.id;
    await a.patch(`/departments/${itDept}`, { managerId: budiEmp }).expect(200);

    // MPP IT: tambahan 2 programmer, disetujui HR.
    const plan = (await budi.post("/manpower-plans", { year, departmentId: itDept, lines: [] }).expect(201))
      .body;
    planId = plan.id;
    // Upah diisi HR (kepala departemen tanpa payroll.read tidak bisa mengisi upah).
    await a
      .put(`/manpower-plans/${planId}`, {
        lines: [
          { jobId: programmer, kind: "existing", quantity: 1, monthlyWage: "12000000" },
          {
            jobId: programmer,
            kind: "new",
            quantity: 2,
            startMonth: 3,
            monthlyWage: "9000000",
            reason: "Proyek baru",
          },
        ],
      })
      .expect(200);
    const submitted = (await budi.post(`/manpower-plans/${planId}/submit`).expect(200)).body;
    await rina.post(`/approval-requests/${submitted.approvalRequest.id}/approve`, {}).expect(200);
    const detail = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect(detail.state).toBe("approved");
    lineId = detail.lines.find((l: { kind: string }) => l.kind === "new").id;
  });
  afterAll(() => app?.close());

  it("MPP → FPK oleh kepala departemen (sisa kuota) → disetujui → lowongan", async () => {
    await budi.post(`/manpower-plan-lines/${lineId}/hiring-request`, { quantity: 3 }).expect(400);
    const fpk = (await budi.post(`/manpower-plan-lines/${lineId}/hiring-request`, {}).expect(201)).body;
    fpkId = fpk.id;
    expect(fpk).toMatchObject({
      quantity: 2,
      unplanned: false,
      state: "draft",
      departmentId: itDept,
      jobId: programmer,
      wageMin: "9000000.00",
      targetDate: `${year}-03-01`,
      plan: expect.objectContaining({ id: planId }),
    });
    expect(fpk.progress).toMatchObject({ plan: "done", request: "current", approval: "pending" });
    // Revisi MPP tidak boleh mengurangi posisi di bawah yang sudah diajukan.
    const submitted = (await budi.post(`/hiring-requests/${fpkId}/submit`).expect(200)).body;
    expect(submitted).toMatchObject({ state: "in_approval", number: expect.stringMatching(/^FPK/) });
    await budi.post(`/hiring-requests/${fpkId}/job-opening`).expect(403);
    await budi.post(`/approval-requests/${submitted.approvalRequest.id}/approve`, {}).expect(403);
    await rina.post(`/approval-requests/${submitted.approvalRequest.id}/approve`, {}).expect(200);
    const approved = (await a.get(`/hiring-requests/${fpkId}`).expect(200)).body;
    expect(approved).toMatchObject({ state: "approved", progress: { approval: "done", opening: "current" } });
    const opening = (await rina.post(`/hiring-requests/${fpkId}/job-opening`).expect(201)).body;
    openingId = opening.id;
    expect(opening).toMatchObject({
      quota: 2,
      jobId: programmer,
      hiringRequestId: fpkId,
      manpowerPlanLineId: lineId,
    });
    // Sisa kuota baris MPP sudah habis.
    await budi.post(`/manpower-plan-lines/${lineId}/hiring-request`, {}).expect(400);
  });

  it("FPK di luar MPP memakai kategori persetujuan sendiri", async () => {
    const fpk = (
      await budi
        .post("/hiring-requests", {
          departmentId: itDept,
          jobId: programmer,
          quantity: 1,
          reason: "Mendadak",
        })
        .expect(201)
    ).body;
    expect(fpk).toMatchObject({ unplanned: true, plan: null, progress: { plan: "skipped" } });
    const submitted = (await budi.post(`/hiring-requests/${fpk.id}/submit`).expect(200)).body;
    const req = (await a.get(`/approval-requests/${submitted.approvalRequest.id}`).expect(200)).body;
    expect(req.categoryCode ?? req.category?.code ?? req.categoryName).toMatch(/FPK_NP|di luar MPP/);
    await budi.post(`/hiring-requests/${fpk.id}/cancel`).expect(200);
  });

  it("pelamar → penawaran diterima → calon karyawan (belum aktif) → kontrak dimulai → aktif & onboarding", async () => {
    const apply = async (name: string) =>
      (await a.post("/applicants", { openingId, name, email: `${name.toLowerCase()}@contoh.id` }).expect(201))
        .body.id as string;
    const fajar = await apply("Fajar");
    const gita = await apply("Gita");
    const hana = await apply("Hana");
    await a.post(`/applicants/${fajar}/hire`, {}).expect(400); // belum ada penawaran diterima
    const offer = async (applicant: string) => {
      const o = (
        await a
          .post(`/applicants/${applicant}/offers`, {
            body: "Penawaran",
            wage: "9500000",
            contractType: "pkwtt",
            startDate: inDays(14),
            validUntil: inDays(7),
          })
          .expect(201)
      ).body;
      await a.post(`/job-offers/${o.id}/send`).expect(200);
      await a.post(`/job-offers/${o.id}/accept`).expect(200);
    };
    await offer(fajar);
    const hired = (await a.post(`/applicants/${fajar}/hire`, {}).expect(200)).body;
    const emp = (await a.get(`/employees/${hired.employeeId}`).expect(200)).body;
    expect(emp).toMatchObject({ active: false, pendingStart: true, departmentId: itDept, jobId: programmer });
    expect(emp.managerId).toBeTruthy();
    const progress1 = (await a.get(`/hiring-requests/${fpkId}`).expect(200)).body;
    expect(progress1.progress).toMatchObject({ offer: "current", contract: "current", active: "pending" });

    // Batal sebelum kontrak dimulai → pelamar kembali ke penawaran, data calon hilang.
    await a.post(`/applicants/${fajar}/cancel-hire`).expect(200);
    await a.get(`/employees/${hired.employeeId}`).expect(404);
    expect((await a.get(`/applicants/${fajar}`).expect(200)).body.stage).toBe("offer");
    const again = (await a.post(`/applicants/${fajar}/hire`, {}).expect(200)).body;

    await a.post(`/contracts/${again.contractId}/start`).expect(200);
    await a.post(`/applicants/${fajar}/cancel-hire`).expect(400); // sudah aktif
    expect((await a.get(`/employees/${again.employeeId}`).expect(200)).body).toMatchObject({
      active: true,
      pendingStart: false,
    });
    const [list] = (await a.get(`/hr-checklists?employeeId=${again.employeeId}`).expect(200)).body;
    const checklist = (await a.get(`/hr-checklists/${list.id}`).expect(200)).body;
    const managerTask = checklist.tasks.find((t: { responsible: string }) => t.responsible === "manager");
    expect(managerTask?.responsibleUserId).toBe(budiUser);

    // Kuota 2: Gita masuk, Hana ditolak karena kuota penuh.
    await offer(gita);
    await a.post(`/applicants/${gita}/hire`, {}).expect(200);
    await offer(hana);
    await a.post(`/applicants/${hana}/hire`, {}).expect(400);

    const done = (await a.get(`/hiring-requests/${fpkId}`).expect(200)).body;
    expect(done.progress).toMatchObject({ offer: "done", contract: "done", active: "current" });
    expect(done.people).toHaveLength(3);
    const plan = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect(plan.lines.find((l: { id: string }) => l.id === lineId)).toMatchObject({
      hired: 2,
      realization: "fulfilled",
    });
  });
});
