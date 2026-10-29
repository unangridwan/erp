import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

interface Line {
  code: string;
  name: string;
  category: string;
  amount: string;
}

/** Tunjangan per kehadiran, asuransi kesehatan swasta (natura), DPLK, jurnal utang premi, plafon klaim per golongan. */
describe.skipIf(!hasDb)("Kompensasi & benefit", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const acc: Record<string, string> = {};
  const emp: Record<string, string> = {};
  let health: string;
  let dplk: string;
  let runId: string;

  const employee = async (name: string, wage = "80000000", extra: object = {}) => {
    const id = (await a.post("/employees", { name, joinDate: "2026-01-02", ...extra }).expect(201)).body.id;
    const c = (await a.post("/contracts", { employeeId: id, wage, dateStart: "2026-01-02" }).expect(201))
      .body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    return id as string;
  };
  const slipOf = async (employeeId: string) => {
    const body = (await a.get(`/payroll-runs/${runId}`).expect(200)).body;
    const slip = body.payslips.find((p: { employeeId: string }) => p.employeeId === employeeId);
    return (await a.get(`/payslips/${slip.id}`).expect(200)).body as {
      pph21: string;
      net: string;
      lines: Line[];
    };
  };
  const line = (slip: { lines: Line[] }, code: string, category?: string) =>
    slip.lines.find((l) => l.code === code && (!category || l.category === category));
  /** Hari kerja Senin–Jumat dalam Desember 2026. */
  const weekdays = () =>
    Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`).filter((d) => {
      const day = new Date(`${d}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    });
  const attend = (employeeId: string, date: string) =>
    a
      .post("/attendance", {
        employeeId,
        checkIn: `${date}T08:00:00+07:00`,
        checkOut: `${date}T17:00:00+07:00`,
      })
      .expect(201);

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "benefit");
    for (const x of (await a.get("/accounts?limit=300").expect(200)).body.items as {
      id: string;
      code: string;
    }[])
      acc[x.code] = x.id;
    // Uang makan per hari hadir (berlaku semua karyawan) & premi kehadiran (hilang bila absen > 1 hari).
    await a
      .post("/salary-components", {
        code: "UMAKAN",
        name: "Uang makan",
        kind: "allowance",
        calc: "per_attendance_day",
        rate: "50000",
        autoAssign: true,
      })
      .expect(201);
    await a
      .post("/salary-components", {
        code: "PREMI",
        name: "Premi kehadiran",
        kind: "allowance",
        calc: "attendance_premium",
        rate: "300000",
        autoAssign: true,
        premiumMaxAbsent: 1,
      })
      .expect(201);
    // Komponen kehadiran tidak boleh jadi tunjangan tetap (dasar BPJS).
    await a
      .post("/salary-components", {
        code: "SALAH",
        name: "Salah",
        kind: "allowance",
        calc: "per_attendance_day",
        fixed: true,
      })
      .expect(400);

    emp.base = await employee("Dasar");
    emp.insured = await employee("Berasuransi");
    emp.pension = await employee("Peserta DPLK");
    emp.diligent = await employee("Rajin", "6000000");
    emp.lazy = await employee("Jarang Hadir", "6000000");
    for (const d of weekdays()) await attend(emp.diligent, d);
    for (const d of weekdays().slice(0, 3)) await attend(emp.lazy, d);
  });
  afterAll(() => app?.close());

  it("paket benefit: validasi akun & persen, kode unik, kepesertaan dengan tanggungan", async () => {
    const provider = (await a.post("/partners", { name: "PT Asuransi Sehat" }).expect(201)).body.id;
    await a
      .post("/benefit-plans", { code: "X", name: "X", kind: "health_insurance", employerAmount: "100000" })
      .expect(400); // tanpa akun utang
    await a
      .post("/benefit-plans", {
        code: "X",
        name: "X",
        kind: "pension",
        calc: "percent_wage",
        employerAmount: "150",
        payableAccountId: acc["2-1700"],
      })
      .expect(400);
    health = (
      await a
        .post("/benefit-plans", {
          code: "ASKES",
          name: "Asuransi Kesehatan",
          kind: "health_insurance",
          providerId: provider,
          policyNo: "POL-001",
          employerAmount: "500000",
          employeeAmount: "100000",
          dependentAmount: "200000",
          expenseAccountId: acc["6-5000"],
          payableAccountId: acc["2-1700"],
        })
        .expect(201)
    ).body.id;
    await a
      .post("/benefit-plans", {
        code: "askes",
        name: "Dobel",
        kind: "other",
        payableAccountId: acc["2-1700"],
      })
      .expect(400);
    dplk = (
      await a
        .post("/benefit-plans", {
          code: "DPLK",
          name: "DPLK",
          kind: "pension",
          calc: "percent_wage",
          employerAmount: "5",
          employeeAmount: "5",
          wageCap: "15000000",
          payableAccountId: acc["2-1700"],
        })
        .expect(201)
    ).body;
    expect(dplk).toMatchObject({ taxable: false });
    dplk = (dplk as unknown as { id: string }).id;

    const spouse = (
      await a.post(`/employees/${emp.insured}/family`, { relation: "spouse", name: "Pasangan" }).expect(201)
    ).body.id;
    const strangerFamily = (
      await a.post(`/employees/${emp.base}/family`, { relation: "child", name: "Anak Orang" }).expect(201)
    ).body.id;
    await a
      .post("/benefit-enrollments", {
        planId: health,
        employeeId: emp.insured,
        dateStart: "2026-01-01",
        dependentIds: [strangerFamily],
      })
      .expect(400);
    await a
      .post("/benefit-enrollments", {
        planId: health,
        employeeId: emp.insured,
        dateStart: "2026-01-01",
        memberNo: "M-1",
        dependentIds: [spouse],
      })
      .expect(201);
    // Tumpang tindih periode ditolak.
    await a
      .post("/benefit-enrollments", { planId: health, employeeId: emp.insured, dateStart: "2026-06-01" })
      .expect(400);
    await a
      .post("/benefit-enrollments", { planId: dplk, employeeId: emp.pension, dateStart: "2026-01-01" })
      .expect(201);

    const mine = (await a.get(`/employees/${emp.insured}/benefits`).expect(200)).body;
    expect(mine).toEqual([
      expect.objectContaining({
        planCode: "ASKES",
        provider: "PT Asuransi Sehat",
        memberNo: "M-1",
        dependents: [expect.objectContaining({ name: "Pasangan" })],
      }),
    ]);
    const plans = (await a.get("/benefit-plans").expect(200)).body as { code: string; members: number }[];
    expect(plans.find((p) => p.code === "ASKES")?.members).toBe(1);

    runId = (await a.post("/payroll-runs", { period: "2026-12", paymentDate: "2026-12-28" }).expect(201)).body
      .id;
  });

  it("uang makan per hari hadir & premi kehadiran hilang bila sering absen", async () => {
    const diligent = await slipOf(emp.diligent);
    expect(Number(line(diligent, "UMAKAN")!.amount)).toBe(weekdays().length * 50_000);
    expect(Number(line(diligent, "PREMI")!.amount)).toBe(300_000);
    const lazy = await slipOf(emp.lazy);
    expect(Number(line(lazy, "UMAKAN")!.amount)).toBe(150_000);
    expect(line(lazy, "PREMI")).toBeUndefined();
    // Tanpa absensi sama sekali: tidak ada tunjangan kehadiran.
    const base = await slipOf(emp.base);
    expect(line(base, "UMAKAN")).toBeUndefined();
    expect(line(base, "PREMI")).toBeUndefined();
  });

  it("asuransi: porsi perusahaan natura menaikkan PPh 21, porsi karyawan + tanggungan dipotong", async () => {
    const base = await slipOf(emp.base);
    const insured = await slipOf(emp.insured);
    // Premi pasangan ditanggung perusahaan (pembayar bawaan).
    expect(Number(line(insured, "ASKES", "benefit_employer")!.amount)).toBe(700_000);
    expect(Number(line(insured, "ASKES", "deduction")!.amount)).toBe(-100_000);
    expect(Number(insured.pph21)).toBeGreaterThan(Number(base.pph21));
    // Porsi perusahaan tidak dibayarkan ke karyawan.
    expect(Number(base.net) - Number(insured.net)).toBe(100_000 + Number(insured.pph21) - Number(base.pph21));
  });

  it("DPLK: % upah dibatasi, iuran karyawan mengurangi PPh 21 tahunan (Desember)", async () => {
    const base = await slipOf(emp.base);
    const pension = await slipOf(emp.pension);
    expect(Number(line(pension, "DPLK", "benefit_employer")!.amount)).toBe(750_000);
    expect(Number(line(pension, "DPLK", "deduction")!.amount)).toBe(-750_000);
    expect(Number(pension.pph21)).toBeLessThan(Number(base.pph21));
  });

  it("jurnal payroll: beban premi & utang ke penyedia; laporan premi per paket", async () => {
    await a.post(`/payroll-runs/${runId}/post`).expect(200);
    const run = (await a.get(`/payroll-runs/${runId}`).expect(200)).body;
    const move = (await a.get(`/moves/${run.accountMoveId}`).expect(200)).body as {
      lines: { accountId: string; debit: string; credit: string }[];
    };
    const sum = (id: string, side: "debit" | "credit") =>
      move.lines.filter((l) => l.accountId === id).reduce((s, l) => s + Number(l[side]), 0);
    // Utang: ASKES 700rb + 100rb, DPLK 750rb + 750rb.
    expect(sum(acc["2-1700"]!, "credit") - sum(acc["2-1700"]!, "debit")).toBe(2_300_000);
    expect(sum(acc["6-5000"]!, "debit")).toBe(700_000);

    const report = (await a.get("/payroll/reports/benefits?from=2026-12&to=2026-12").expect(200)).body;
    expect(report.summary).toEqual([
      expect.objectContaining({
        code: "ASKES",
        members: 1,
        employer: "700000",
        employee: "100000",
        total: "800000",
      }),
      expect.objectContaining({ code: "DPLK", members: 1, employer: "750000", employee: "750000" }),
    ]);
    const xlsx = await a.get("/payroll/reports/benefits?from=2026-12&to=2026-12&format=xlsx").expect(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    // Paket terpakai tidak bisa dihapus.
    await a.delete(`/benefit-plans/${health}`).expect(400);
  });

  it("plafon klaim per golongan menimpa plafon kategori", async () => {
    const grade = (
      await a
        .post("/salary-grades", { code: "G1", name: "Staf", minWage: "1", maxWage: "100000000" })
        .expect(201)
    ).body.id;
    const staff = await employee("Golongan Staf", "8000000", { gradeId: grade });
    const category = (
      await a
        .post("/expense-categories", { name: "Kacamata", accountId: acc["6-5000"], annualLimit: "2000000" })
        .expect(201)
    ).body.id;
    await a
      .put(`/expense-categories/${category}/limits`, {
        limits: [
          { gradeId: grade, annualLimit: "500000" },
          { gradeId: grade, annualLimit: "1" },
        ],
      })
      .expect(400);
    await a
      .put(`/expense-categories/${category}/limits`, { limits: [{ gradeId: grade, annualLimit: "500000" }] })
      .expect(200);
    expect((await a.get(`/expense-categories/${category}/limits`).expect(200)).body).toEqual([
      expect.objectContaining({ gradeId: grade, annualLimit: "500000.00" }),
    ]);
    const claim = async (employeeId: string) =>
      (
        await a
          .post("/expense-claims", {
            employeeId,
            date: "2026-05-05",
            lines: [{ categoryId: category, date: "2026-05-05", amount: "800000" }],
          })
          .expect(201)
      ).body.id;
    const over = await a.post(`/expense-claims/${await claim(staff)}/submit`).expect(400);
    expect(over.body.message).toMatch(/plafon tahunan/);
    // Tanpa golongan: plafon kategori (2 jt) berlaku.
    await a.post(`/expense-claims/${await claim(emp.base)}/submit`).expect(200);
  });
});
