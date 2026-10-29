import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

interface Proposal {
  id: string;
  employeeId: string;
  currentWage: string;
  newWage: string;
  suggestedPercent: string;
  proposedPercent: string;
  rating: string | null;
  gradeFlag: string | null;
}

/** Siklus kenaikan gaji: saran dari appraisal, anggaran, usulan atasan, persetujuan, penerapan + rapel, total rewards. */
describe.skipIf(!hasDb)("Kompensasi: siklus kenaikan gaji & total rewards", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let budiApi: ReturnType<typeof client>;
  let rinaApi: ReturnType<typeof client>;
  const emp: Record<string, string> = {};
  let cycleId: string;

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
  const employee = async (name: string, wage: string, extra: object = {}) => {
    const id = (await a.post("/employees", { name, joinDate: "2025-01-02", ...extra }).expect(201)).body.id;
    const c = (await a.post("/contracts", { employeeId: id, wage, dateStart: "2026-01-01" }).expect(201))
      .body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    return id as string;
  };
  const postRun = async (period: string) => {
    const run = (await a.post("/payroll-runs", { period, paymentDate: `${period}-28` }).expect(201)).body;
    return run.id as string;
  };
  const detail = async () => (await a.get(`/compensation-cycles/${cycleId}`).expect(200)).body;
  const proposalOf = (d: { proposals: Proposal[] }, employeeId: string) =>
    d.proposals.find((p) => p.employeeId === employeeId)!;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "komp");
    const me = (await a.get("/auth/me")).body;
    const db = app.get(TenantDb);
    const roles = (await a.get("/roles").expect(200)).body as { id: string; code: string }[];
    const [staffRole] = await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.roles)
        .values({ code: "karyawan", name: "Karyawan" })
        .returning({ id: schema.roles.id }),
    );
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
    const budiUser = await user("Budi Manajer", "budi@example.com", staffRole!.id);
    await user("Rina Direktur", "rina@example.com", roles.find((r) => r.code === "admin")!.id);
    budiApi = await login("budi@example.com");
    rinaApi = await login("rina@example.com");

    const grade = (
      await a
        .post("/salary-grades", { code: "G1", name: "Staf", minWage: "5000000", maxWage: "11000000" })
        .expect(201)
    ).body.id;
    emp.budi = await employee("Budi Manajer", "15000000", { userId: budiUser });
    emp.dewi = await employee("Dewi Staf", "10000000", { managerId: emp.budi, gradeId: grade });
    emp.eko = await employee("Eko Staf", "8000000", { gradeId: grade });

    // Penilaian kinerja selesai: Dewi A (kalibrasi 12%), Budi C (bawaan 4%), Eko belum dinilai.
    await db.runAs(me.tenantId, async (tx) => {
      const [cycle] = await tx
        .insert(schema.appraisalCycles)
        .values({
          companyId: me.activeCompanyId,
          name: "PA 2025",
          dateStart: "2025-01-01",
          dateEnd: "2025-12-31",
          state: "closed",
        })
        .returning({ id: schema.appraisalCycles.id });
      await tx.insert(schema.appraisals).values([
        {
          companyId: me.activeCompanyId,
          cycleId: cycle!.id,
          employeeId: emp.dewi!,
          state: "done",
          rating: "A",
          raisePercent: "12",
          doneAt: new Date(),
        },
        {
          companyId: me.activeCompanyId,
          cycleId: cycle!.id,
          employeeId: emp.budi!,
          state: "done",
          rating: "C",
          doneAt: new Date(),
        },
      ]);
    });

    // Juli & Agustus sudah diposting dengan upah lama (kenaikan nanti berlaku mundur 1 Juli).
    for (const period of ["2026-07", "2026-08"])
      await a.post(`/payroll-runs/${await postRun(period)}/post`).expect(200);
  });
  afterAll(() => app?.close());

  it("siklus & usulan otomatis: saran dari rating appraisal, peringatan skala golongan", async () => {
    await a
      .post("/compensation-cycles", {
        name: "X",
        effectiveDate: "2026-07-01",
        budgetKind: "percent",
        budgetValue: 150,
      })
      .expect(400);
    cycleId = (
      await a
        .post("/compensation-cycles", {
          name: "Kenaikan 2026",
          effectiveDate: "2026-07-01",
          budgetKind: "percent",
          budgetValue: 5,
        })
        .expect(201)
    ).body.id;
    const generated = (await a.post(`/compensation-cycles/${cycleId}/generate`).expect(200)).body;
    expect(generated.added).toBe(3);
    // Idempoten: karyawan yang sudah ada tidak ditambah lagi.
    expect((await a.post(`/compensation-cycles/${cycleId}/generate`).expect(200)).body.added).toBe(0);
    const d = generated.detail;
    expect(proposalOf(d, emp.dewi!)).toMatchObject({
      rating: "A",
      suggestedPercent: "12.00",
      newWage: "11200000",
      gradeFlag: "above",
    });
    expect(proposalOf(d, emp.budi!)).toMatchObject({
      rating: "C",
      suggestedPercent: "4.00",
      newWage: "15600000",
    });
    expect(proposalOf(d, emp.eko!)).toMatchObject({ rating: null, newWage: "8000000" });
    expect(d.budget).toMatchObject({
      baseline: "33000000",
      budget: "1650000",
      used: "1800000",
      overBudget: true,
    });
    expect(Number(d.annualCost)).toBeGreaterThan(1_800_000 * 13);
  });

  it("melebihi anggaran ditolak; atasan langsung menyesuaikan usulan bawahannya saja", async () => {
    const over = await a.post(`/compensation-cycles/${cycleId}/submit`).expect(400);
    expect(over.body.message).toMatch(/melebihi anggaran/);

    const team = (await budiApi.get("/me/team-compensation").expect(200)).body;
    expect(team).toHaveLength(1);
    expect(team[0].proposals.map((p: { employeeId: string }) => p.employeeId)).toEqual([emp.dewi]);
    const d = await detail();
    await budiApi
      .put(`/compensation-proposals/${proposalOf(d, emp.eko!).id}`, { proposedPercent: 5 })
      .expect(403);
    await budiApi.get(`/compensation-cycles/${cycleId}`).expect(403);
    const updated = (
      await budiApi
        .put(`/compensation-proposals/${proposalOf(d, emp.dewi!).id}`, {
          proposedPercent: 10,
          reason: "Sesuai anggaran",
        })
        .expect(200)
    ).body;
    expect(updated).toMatchObject({ newWage: "11000000.00", proposedPercent: "10.00" });
    const after = await detail();
    expect(after.budget).toMatchObject({ used: "1600000", overBudget: false });
    expect(proposalOf(after, emp.dewi!).gradeFlag).toBeNull();
  });

  it("persetujuan lewat mesin persetujuan: pengaju tidak bisa menyetujui sendiri; usulan terkunci", async () => {
    const submitted = (await a.post(`/compensation-cycles/${cycleId}/submit`).expect(200)).body;
    expect(submitted.state).toBe("in_approval");
    expect(submitted.approvalRequest).toMatchObject({ state: "submitted" });
    const requestId = submitted.approvalRequest.id;
    const req = (await a.get(`/approval-requests/${requestId}`).expect(200)).body;
    expect(req.category.code).toBe("KENAIKAN");
    expect(req.amount).toBe(`${submitted.annualCost}.00`);
    await a.post(`/compensation-cycles/${cycleId}/apply`).expect(400);
    await a
      .put(`/compensation-proposals/${proposalOf(submitted, emp.eko!).id}`, { proposedPercent: 1 })
      .expect(400);
    await a.post(`/approval-requests/${requestId}/approve`, {}).expect(403);
    await rinaApi.post(`/approval-requests/${requestId}/approve`, { note: "OK" }).expect(200);
    expect((await detail()).state).toBe("approved");
  });

  it("terapkan: kontrak baru per tanggal berlaku, rapel bulan yang sudah dibayar, kenaikan 0 dilewati", async () => {
    const applied = (await a.post(`/compensation-cycles/${cycleId}/apply`).expect(200)).body;
    expect(applied.applied).toBe(2);
    expect(applied.detail.state).toBe("applied");
    await a.post(`/compensation-cycles/${cycleId}/apply`).expect(400);
    const contracts = (await a.get(`/contracts?employeeId=${emp.dewi}`).expect(200)).body.items as {
      wage: string;
      state: string;
      dateStart: string;
    }[];
    expect(contracts.find((c) => c.state === "running")).toMatchObject({
      wage: "11000000.00",
      dateStart: "2026-07-01",
    });
    expect(
      (
        (await a.get(`/contracts?employeeId=${emp.eko}`).expect(200)).body.items as { state: string }[]
      ).filter((c) => c.state === "running"),
    ).toHaveLength(1);

    const sept = await postRun("2026-09");
    const retro = (await a.post(`/payroll-runs/${sept}/retro`).expect(200)).body as {
      total: string;
      items: { employeeId: string; total: string }[];
    };
    expect(retro.items.find((i) => i.employeeId === emp.dewi)?.total).toBe("2000000");
    expect(retro.items.find((i) => i.employeeId === emp.budi)?.total).toBe("1200000");
    await a.post(`/payroll-runs/${sept}/post`).expect(200);
  });

  it("total rewards setahun: tunai (gaji, rapel) + dibayar perusahaan (BPJS); PDF; portal", async () => {
    const tr = (await a.get(`/employees/${emp.dewi}/total-rewards?year=2026`).expect(200)).body;
    expect(tr.months).toBe(3);
    expect(tr.currentWage).toBe("11000000");
    expect(tr.cash).toEqual(
      expect.arrayContaining([
        { name: "Gaji pokok", amount: "31000000" },
        { name: "Rapel kenaikan upah", amount: "2000000" },
      ]),
    );
    expect(tr.employer.map((e: { name: string }) => e.name)).toContain("BPJS Kesehatan (perusahaan)");
    expect(Number(tr.total)).toBe(Number(tr.cashTotal) + Number(tr.employerTotal));
    const pdf = await a.get(`/employees/${emp.dewi}/total-rewards/pdf?year=2026`).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");

    const mine = (await budiApi.get("/me/total-rewards?year=2026").expect(200)).body;
    expect(mine.employee.name).toBe("Budi Manajer");
    await budiApi.get(`/employees/${emp.dewi}/total-rewards`).expect(403);
    await budiApi.get("/me/total-rewards/pdf?year=2026").expect(200);
  });
});
