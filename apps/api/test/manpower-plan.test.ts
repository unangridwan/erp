import type { INestApplication } from "@nestjs/common";
import { eq, schema } from "@erp/db";
import { planSummary } from "@erp/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Line = {
  id: string;
  jobId: string;
  kind: string;
  quantity: number;
  monthlyWage: string | null;
  jobOpeningId: string | null;
  realization: string | null;
  hired: number;
};

/** Man Power Planning: rencana posisi → persetujuan → anggaran tenaga kerja & akuntansi → lowongan & realisasi. */
describe.skipIf(!hasDb)("Man Power Planning", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let rina: ReturnType<typeof client>;
  let budi: ReturnType<typeof client>;
  let sari: ReturnType<typeof client>;
  let tenantId: string;
  let itDept: string;
  let finDept: string;
  let staff: string;
  let programmer: string;
  let planId: string;
  const year = 2027;

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
    a = await signup(app, "mpp");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
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
    const budiUser = await mkUser("Budi Kepala IT", "budi@example.com", [await mkRole("staf", [])]);
    await mkUser("Sari SDM", "sari@example.com", [await mkRole("staf_sdm", ["hr.read"])]);
    rina = await login("rina@example.com");
    budi = await login("budi@example.com");
    sari = await login("sari@example.com");

    itDept = (await a.post("/departments", { name: "IT" }).expect(201)).body.id;
    finDept = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;
    staff = (await a.post("/job-positions", { name: "Staf" }).expect(201)).body.id;
    programmer = (await a.post("/job-positions", { name: "Programmer" }).expect(201)).body.id;
    const emp = async (
      name: string,
      departmentId: string,
      jobId: string,
      wage: string,
      extra: object = {},
    ) => {
      const id = (
        await a
          .post("/employees", { name, departmentId, jobId, joinDate: "2020-01-02", ...extra })
          .expect(201)
      ).body.id as string;
      const c = (await a.post("/contracts", { employeeId: id, wage, dateStart: "2026-01-01" }).expect(201))
        .body;
      await a.post(`/contracts/${c.id}/start`).expect(200);
      return id;
    };
    const budiEmp = await emp("Budi", itDept, programmer, "12000000", { userId: budiUser });
    await emp("Cici", itDept, programmer, "10000000");
    await emp("Dedi", itDept, staff, "6000000");
    await emp("Eka", finDept, staff, "7000000");
    await a.patch(`/departments/${itDept}`, { managerId: budiEmp }).expect(200);
  });
  afterAll(() => app?.close());

  it("buat MPP: posisi terisi otomatis dari karyawan aktif; kepala departemen hanya departemennya", async () => {
    await budi.post("/manpower-plans", { year, departmentId: finDept }).expect(403);
    const plan = (await budi.post("/manpower-plans", { year, departmentId: itDept }).expect(201)).body;
    planId = plan.id;
    expect(plan).toMatchObject({ name: `MPP IT ${year}`, state: "draft", canEdit: true, showCost: false });
    const lines = plan.lines as Line[];
    expect(lines.map((l) => [l.jobId, l.kind, l.quantity])).toEqual(
      expect.arrayContaining([
        [programmer, "existing", 2],
        [staff, "existing", 1],
      ]),
    );
    // Kepala departemen tanpa payroll.read tidak melihat upah.
    expect(lines[0]!.monthlyWage).toBeNull();
    await a.post("/manpower-plans", { year, departmentId: itDept }).expect(400);
    // Admin melihat upah rata-rata kontrak.
    const full = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect(full.lines.find((l: Line) => l.jobId === programmer).monthlyWage).toBe("11000000.00");
    await sari.put(`/manpower-plans/${planId}`, { note: "x" }).expect(403);
    const list = (await budi.get(`/manpower-plans?year=${year}`).expect(200)).body;
    expect(list.rows.map((r: { department: string }) => r.department)).toEqual(["IT"]);
  });

  it("ubah baris: tambahan & pengganti; upah lama dipertahankan untuk yang tak berhak melihat", async () => {
    const plan = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    const lines = (plan.lines as Line[]).map((l) => ({
      jobId: l.jobId,
      kind: l.kind,
      quantity: l.quantity,
      monthlyWage: l.monthlyWage,
    }));
    lines.push({ jobId: programmer, kind: "new", quantity: 2, monthlyWage: "9000000.00" });
    await a
      .put(`/manpower-plans/${planId}`, {
        thrMonth: 3,
        lines: [...lines, { jobId: programmer, kind: "new", quantity: 1, startMonth: 9, endMonth: 3 }],
      })
      .expect(400);
    const saved = (
      await a
        .put(`/manpower-plans/${planId}`, {
          thrMonth: 3,
          lines: [
            ...lines.slice(0, 2),
            {
              jobId: programmer,
              kind: "new",
              quantity: 2,
              startMonth: 7,
              monthlyWage: 9000000,
              reason: "Proyek baru",
            },
            { jobId: staff, kind: "replacement", quantity: 1, startMonth: 4, monthlyWage: 6000000 },
          ],
        })
        .expect(200)
    ).body;
    expect(saved.summary).toMatchObject({
      startHeadcount: 3,
      endHeadcount: 5,
      additions: 2,
      replacements: 1,
    });
    // Budi (tanpa payroll.read) menyimpan ulang: upah tidak hilang.
    const mine = (await budi.get(`/manpower-plans/${planId}`).expect(200)).body;
    await budi
      .put(`/manpower-plans/${planId}`, {
        lines: (mine.lines as (Line & { startMonth: number; reason: string | null })[]).map((l) => ({
          jobId: l.jobId,
          kind: l.kind,
          quantity: l.quantity,
          startMonth: l.startMonth,
          reason: l.reason,
        })),
      })
      .expect(200);
    const after = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect(after.summary.annualCost).toBe(saved.summary.annualCost);
  });

  it("ajukan → disetujui HR: anggaran tenaga kerja per jabatan × bulan & anggaran akuntansi terisi", async () => {
    const submitted = (await budi.post(`/manpower-plans/${planId}/submit`).expect(200)).body;
    expect(submitted.state).toBe("in_approval");
    await budi.put(`/manpower-plans/${planId}`, { note: "x" }).expect(400);
    const req = (await a.get(`/approval-requests/${submitted.approvalRequest.id}`).expect(200)).body;
    expect(req.category.code).toBe("MPP");
    await budi.post(`/approval-requests/${req.id}/approve`, {}).expect(403);
    await rina.post(`/approval-requests/${req.id}/approve`, { note: "OK" }).expect(200);

    // Status & anggaran langsung diperbarui saat keputusan (tanpa membuka MPP).
    const db = app.get(TenantDb);
    const [row] = await db.runAs(tenantId, (tx) =>
      tx.select().from(schema.manpowerPlans).where(eq(schema.manpowerPlans.id, planId)),
    );
    expect(row!.state).toBe("approved");
    const budgets = (await a.get(`/manpower-budgets?year=${year}`).expect(200)).body as {
      jobId: string;
      month: number;
      headcount: string;
      cost: string;
      sourcePlanId: string;
    }[];
    const prog = (m: number) => budgets.find((b) => b.jobId === programmer && b.month === m)!;
    expect(prog(1).headcount).toBe("2.00");
    expect(prog(7).headcount).toBe("4.00");
    expect(prog(1).sourcePlanId).toBe(planId);

    const detail = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect(detail.accountingBudget).toBeTruthy();
    const budget = (await a.get(`/budgets/${detail.accountingBudget.id}`).expect(200)).body;
    expect(budget).toMatchObject({ name: `Anggaran SDM ${year}`, source: "manpower" });
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    const total = budget.lines.reduce((s: number, l: { amount: string }) => s + Number(l.amount), 0);
    expect(total).toBe(detail.summary.annualCost);
    const salaryLine = budget.lines.find(
      (l: { accountId: string }) => l.accountId === settings.salaryExpenseAccountId,
    );
    expect(Number(salaryLine.amount)).toBe(detail.summary.salary);
    // Cocok dengan perhitungan shared.
    const expected = planSummary(
      detail.lines.map(
        (l: Line & { startMonth: number; endMonth: number | null; monthlyAllowance: string }) => l,
      ),
      { jkkRate: settings.jkkRate, kesWageCap: settings.kesWageCap, jpWageCap: settings.jpWageCap },
      3,
    );
    expect(detail.summary.annualCost).toBe(expected.annualCost);
    // Anggaran MPP tidak bisa diubah manual dari Akuntansi.
    await a
      .patch(`/budgets/${budget.id}`, {
        name: "X",
        dateFrom: `${year}-01-01`,
        dateTo: `${year}-12-31`,
        lines: [],
      })
      .expect(400);
    await a.delete(`/budgets/${budget.id}`).expect(400);
  });

  it("lowongan dari posisi tambahan & realisasi dari pelamar diterima", async () => {
    const detail = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    const newLine = (detail.lines as Line[]).find((l) => l.kind === "new")!;
    const existing = (detail.lines as Line[]).find((l) => l.kind === "existing")!;
    expect(newLine.realization).toBe("not_started");
    await a.post(`/manpower-plan-lines/${existing.id}/job-opening`).expect(400);
    await budi.post(`/manpower-plan-lines/${newLine.id}/job-opening`).expect(403);
    const opening = (await a.post(`/manpower-plan-lines/${newLine.id}/job-opening`).expect(201)).body;
    expect(opening).toMatchObject({
      quota: 2,
      departmentId: itDept,
      jobId: programmer,
      targetDate: `${year}-07-01`,
      manpowerPlanLineId: newLine.id,
    });
    await a.post(`/manpower-plan-lines/${newLine.id}/job-opening`).expect(400);
    const applicant = (await a.post("/applicants", { openingId: opening.id, name: "Fajar" }).expect(201))
      .body;
    const db = app.get(TenantDb);
    await db.runAs(tenantId, (tx) =>
      tx
        .update(schema.applicants)
        .set({ stage: "hired", hiredAt: new Date() })
        .where(eq(schema.applicants.id, applicant.id)),
    );
    const after = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect((after.lines as Line[]).find((l) => l.id === newLine.id)).toMatchObject({
      realization: "partial",
      hired: 1,
    });
    const list = (await a.get(`/manpower-plans?year=${year}`).expect(200)).body;
    expect(list.totals).toMatchObject({ toFill: 3, filled: 1, approved: 1 });
    const x = await a.get(`/manpower-plans/${planId}/export`).expect(200);
    expect(x.headers["content-type"]).toContain("spreadsheetml");
  });

  it("revisi → setujui ulang mengganti anggaran; batal mencabut anggaran", async () => {
    await a.post(`/manpower-plans/${planId}/revise`).expect(200);
    const d = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    // Anggaran lama tetap berlaku saat revisi.
    expect((await a.get(`/manpower-budgets?year=${year}`).expect(200)).body.length).toBeGreaterThan(0);
    const lines = (d.lines as (Line & { startMonth: number })[]).map((l) => ({
      jobId: l.jobId,
      kind: l.kind,
      quantity: l.kind === "new" ? 3 : l.quantity,
      startMonth: l.startMonth,
      monthlyWage: l.monthlyWage,
    }));
    await a.put(`/manpower-plans/${planId}`, { lines }).expect(200);
    // Lowongan tetap tertaut setelah revisi.
    const kept = (await a.get(`/manpower-plans/${planId}`).expect(200)).body;
    expect((kept.lines as Line[]).find((l) => l.kind === "new")!.jobOpeningId).toBeTruthy();
    const sub = (await a.post(`/manpower-plans/${planId}/submit`).expect(200)).body;
    await rina.post(`/approval-requests/${sub.approvalRequest.id}/approve`, {}).expect(200);
    const budgets = (await a.get(`/manpower-budgets?year=${year}`).expect(200)).body as {
      jobId: string;
      month: number;
      headcount: string;
    }[];
    expect(budgets.find((b) => b.jobId === programmer && b.month === 12)!.headcount).toBe("5.00");

    // Ditolak → kembali draft (uji di departemen lain).
    const fin = (await a.post("/manpower-plans", { year, departmentId: finDept }).expect(201)).body;
    const finSub = (await a.post(`/manpower-plans/${fin.id}/submit`).expect(200)).body;
    await rina.post(`/approval-requests/${finSub.approvalRequest.id}/refuse`, { note: "Tunda" }).expect(200);
    expect((await a.get(`/manpower-plans/${fin.id}`).expect(200)).body.state).toBe("draft");

    await a.post(`/manpower-plans/${planId}/cancel`).expect(200);
    expect((await a.get(`/manpower-budgets?year=${year}`).expect(200)).body).toHaveLength(0);
    const budgetsList = (await a.get("/budgets").expect(200)).body as {
      source: string;
      sourceYear: number;
    }[];
    expect(budgetsList.some((b) => b.source === "manpower" && b.sourceYear === year)).toBe(false);
  });
});
