import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Row = {
  department: string;
  months: {
    month: number;
    plannedHeadcount: number;
    actualHeadcount: number | null;
    headcountVariance: { diff: number; percent: number | null } | null;
    actualCost?: number;
    plannedCost?: number;
  }[];
  current: { month: number; plannedHeadcount: number; actualHeadcount: number };
  openVacancies: number;
  plannedCost?: number;
};

/** Anggaran tenaga kerja vs aktual & analitik SDM (turnover, retensi, demografi, kesetaraan gaji). */
describe.skipIf(!hasDb)("Anggaran tenaga kerja & analitik SDM", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sari: ReturnType<typeof client>;
  let itDept: string;
  let fin: string;
  const year = 2026;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "tenaga");
    const me = (await a.get("/auth/me")).body;
    const role = (
      await a.post("/roles", { code: "staf_sdm", name: "Staf SDM", permissions: ["hr.read"] }).expect(201)
    ).body.id;
    await a
      .post("/users", {
        name: "Sari SDM",
        email: "sari@example.com",
        password: "rahasia123",
        roleIds: [role],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    sari = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    itDept = (await a.post("/departments", { name: "IT" }).expect(201)).body.id;
    fin = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;
    const grade = (
      await a
        .post("/salary-grades", { code: "G1", name: "Staf", minWage: "6000000", maxWage: "14000000" })
        .expect(201)
    ).body.id;
    const people: [string, string, "male" | "female", string, string, string | null, string | null][] = [
      // nama, dept, gender, lahir, masuk, upah, golongan
      ["Ani", itDept, "female", "1995-04-01", "2020-01-01", "10000000", grade],
      ["Budi", itDept, "male", "1985-06-01", "2025-03-01", "12000000", grade],
      ["Cici", fin, "female", "1990-01-01", "2023-01-01", null, null],
      ["Dedi", fin, "male", "2003-01-01", "2026-02-01", "8000000", null],
      ["Eka", fin, "male", "1970-01-01", "2014-01-01", null, null],
    ];
    const ids: Record<string, string> = {};
    for (const [name, departmentId, gender, birthDate, joinDate, wage, gradeId] of people) {
      const id = (
        await a.post("/employees", { name, departmentId, gender, birthDate, joinDate, gradeId }).expect(201)
      ).body.id as string;
      ids[name] = id;
      if (wage) {
        const c = (
          await a
            .post("/contracts", {
              employeeId: id,
              wage,
              dateStart: joinDate > "2026-01-01" ? joinDate : "2026-01-01",
            })
            .expect(201)
        ).body;
        await a.post(`/contracts/${c.id}/start`).expect(200);
      }
    }
    await a
      .post(`/employees/${ids.Ani}/education`, { level: "s1", institution: "ITB", yearEnd: 2017 })
      .expect(201);
    await a
      .post(`/employees/${ids.Cici}/offboard`, { resignDate: "2026-05-31", resignReason: "resign" })
      .expect(200);
    await a
      .post(`/employees/${ids.Eka}/offboard`, { resignDate: "2026-08-31", resignReason: "termination" })
      .expect(200);
    await a.post("/job-openings", { name: "Staf Keuangan", departmentId: fin, quota: 2 }).expect(201);
    const run = (await a.post("/payroll-runs", { period: "2026-09", paymentDate: "2026-09-28" }).expect(201))
      .body;
    await a.post(`/payroll-runs/${run.id}/post`).expect(200);
  });
  afterAll(() => app?.close());

  it("analitik: turnover, retensi, sukarela vs tidak, distribusi", async () => {
    const r = (await a.get(`/hr/analytics?year=${year}`).expect(200)).body;
    // Awal tahun: Ani, Budi, Cici, Eka (4); aktif sekarang: Ani, Budi, Dedi (3); keluar: Cici, Eka.
    expect(r.summary).toMatchObject({
      startHeadcount: 4,
      headcount: 3,
      hires: 1,
      leavers: 2,
      turnover: 57.14,
      voluntaryTurnover: 28.57,
      involuntaryTurnover: 28.57,
      retention: 50,
    });
    expect(r.leaveReasons).toEqual(
      expect.arrayContaining([
        { label: "Mengundurkan diri", count: 1 },
        { label: "PHK", count: 1 },
      ]),
    );
    expect(r.leaversByTenure.map((x: { label: string }) => x.label)).toEqual(["3–5 thn", "≥ 10 thn"]);
    expect(r.byDepartment).toEqual([
      expect.objectContaining({ department: "IT", start: 2, end: 2, leavers: 0, turnover: 0 }),
      expect.objectContaining({
        department: "Keuangan",
        start: 2,
        end: 1,
        leavers: 2,
        hires: 1,
        turnover: 133.33,
      }),
    ]);
    expect(r.distribution.gender).toEqual([
      { label: "Laki-laki", count: 2 },
      { label: "Perempuan", count: 1 },
    ]);
    expect(r.distribution.age.map((x: { label: string }) => x.label)).toEqual(["< 25", "25–34", "35–44"]);
    expect(r.distribution.education).toEqual([
      { label: "S1", count: 1 },
      { label: "—", count: 2 },
    ]);
    expect(r.distribution.contractType).toEqual([{ label: "PKWTT (tetap)", count: 3 }]);
    expect(r.months[0]).toMatchObject({ month: "2026-01", headcount: 4, hires: 0, leavers: 0 });
    expect(r.months[4]).toMatchObject({ month: "2026-05", leavers: 1 });
    expect(r.months[11].headcount).toBeNull();
    // Pay equity: median L (8 jt, 12 jt) = 10 jt, P = 10 jt; compa-ratio G1 (titik tengah 10 jt) 1.0 & 1.2.
    expect(r.payEquity.overall).toEqual({ maleMedian: 10000000, femaleMedian: 10000000, gap: 0 });
    expect(r.payEquity.byGrade.find((g: { grade: string }) => g.grade === "Staf")).toMatchObject({
      maleCount: 1,
      femaleCount: 1,
      compaRatio: 1.1,
      gap: 16.67,
    });

    const itOnly = (await a.get(`/hr/analytics?year=${year}&departmentId=${itDept}`).expect(200)).body;
    expect(itOnly.summary).toMatchObject({ headcount: 2, leavers: 0, retention: 100 });

    const x = await a.get(`/hr/analytics?year=${year}&format=xlsx`).expect(200);
    expect(x.headers["content-type"]).toContain("spreadsheetml");
  });

  it("anggaran: simpan, dobel ditolak, departemen asing ditolak, rencana vs aktual", async () => {
    const lines = [
      ...Array.from({ length: 12 }, (_, i) => ({
        departmentId: itDept,
        month: i + 1,
        headcount: 2,
        cost: 25000000,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        departmentId: fin,
        month: i + 1,
        headcount: 3,
        cost: 30000000,
      })),
    ];
    await a.put(`/manpower-budgets?year=${year}`, { lines: [lines[0], lines[0]] }).expect(400);
    await a
      .put(`/manpower-budgets?year=${year}`, {
        lines: [{ departmentId: "00000000-0000-4000-8000-000000000000", month: 1, headcount: 1 }],
      })
      .expect(400);
    const saved = (await a.put(`/manpower-budgets?year=${year}`, { lines }).expect(200)).body;
    expect(saved).toHaveLength(24);
    expect(saved[0]).toMatchObject({ department: "IT", month: 1, headcount: "2.00", cost: "25000000.00" });

    const rep = (await a.get(`/manpower-budgets/report?year=${year}`).expect(200)).body as {
      showCost: boolean;
      rows: Row[];
      months: { plannedHeadcount: number; actualHeadcount: number | null }[];
    };
    expect(rep.showCost).toBe(true);
    const itRow = rep.rows.find((r) => r.department === "IT")!;
    const finRow = rep.rows.find((r) => r.department === "Keuangan")!;
    // Bulan berjalan (tahun uji sudah lewat → Desember); bulan setelahnya belum punya aktual.
    const now = new Date();
    const currentMonth = now.getFullYear() > year ? 12 : now.getMonth() + 1;
    expect(itRow.current).toMatchObject({ month: currentMonth, plannedHeadcount: 2, actualHeadcount: 2 });
    expect(finRow.months[9]).toMatchObject({
      plannedHeadcount: 3,
      actualHeadcount: 1,
      headcountVariance: { diff: -2, percent: -66.67 },
    });
    if (currentMonth < 12) expect(finRow.months[currentMonth]!.actualHeadcount).toBeNull();
    expect(finRow.openVacancies).toBe(2);
    expect(itRow.plannedCost).toBe(300000000);
    expect(itRow.months[8]!.actualCost).toBeGreaterThan(22000000);
    expect(itRow.months[7]!.actualCost).toBe(0);
    expect(rep.months[0]).toMatchObject({ plannedHeadcount: 5, actualHeadcount: 4 });
    const x = await a.get(`/manpower-budgets/report?year=${year}&format=xlsx`).expect(200);
    expect(x.headers["content-type"]).toContain("spreadsheetml");
  });

  it("impor anggaran CSV: nama departemen, error per baris, mengganti tahun itu", async () => {
    const bad = await a
      .post(`/manpower-budgets/import?year=2027`, {
        csv: "Departemen,Jabatan,Bulan,Headcount,Biaya\nIT,,2027-01,4,30000000\nGudang,,1,1,0\nIT,,13,1,0\n",
      })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("Gudang");
    const ok = (
      await a
        .post(`/manpower-budgets/import?year=2027`, {
          csv: "Departemen,Jabatan,Bulan,Headcount,Biaya\nIT,,2027-01,4,30000000\nKeuangan,,2,1,1.500.000\n,,,,\n",
        })
        .expect(200)
    ).body;
    expect(ok.imported).toBe(2);
    const rows = (await a.get(`/manpower-budgets?year=2027`).expect(200)).body;
    expect(rows.map((r: { department: string; cost: string }) => [r.department, r.cost])).toEqual([
      ["IT", "30000000.00"],
      ["Keuangan", "1500000.00"],
    ]);
    const t = await a.get(`/manpower-budgets/template?year=2027`).expect(200);
    expect(t.headers["content-type"]).toContain("spreadsheetml");
    // Tahun 2026 tidak tersentuh.
    expect((await a.get(`/manpower-budgets?year=${year}`).expect(200)).body).toHaveLength(24);
  });

  it("tanpa payroll.read: biaya & kesetaraan gaji disembunyikan; tanpa hr.manage tidak bisa mengubah", async () => {
    const rows = (await sari.get(`/manpower-budgets?year=${year}`).expect(200)).body;
    expect(rows[0].cost).toBeNull();
    const rep = (await sari.get(`/manpower-budgets/report?year=${year}`).expect(200)).body;
    expect(rep.showCost).toBe(false);
    expect(rep.rows[0]).not.toHaveProperty("plannedCost");
    expect(rep.rows[0].months[0]).not.toHaveProperty("actualCost");
    const an = (await sari.get(`/hr/analytics?year=${year}`).expect(200)).body;
    expect(an.payEquity).toBeNull();
    expect(an.summary.headcount).toBe(3);
    await sari.put(`/manpower-budgets?year=${year}`, { lines: [] }).expect(403);
    await sari.post(`/manpower-budgets/import?year=${year}`, { csv: "Departemen\n" }).expect(403);
  });
});
