import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/** Usia pensiun per perusahaan + pengecualian jabatan/golongan/departemen + usia khusus karyawan. */
describe.skipIf(!hasDb)("Usia pensiun", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let directorJob: string;
  let senior: string;
  let staff: string;
  let director: string;

  const employee = async (name: string, extra: object, contract: object = {}) =>
    (
      await a
        .post("/employees", {
          name,
          ...extra,
          contract: { contractType: "pkwtt", dateStart: "2020-01-06", wage: 8000000, ...contract },
        })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "pensiun");
    directorJob = (await a.post("/job-positions", { name: "Direktur" }).expect(201)).body.id;
    // Lahir Mei 1971 → usia 56 pada Mei 2027.
    staff = await employee("Staf", { birthDate: "1971-05-17" });
    director = await employee("Direktur", { birthDate: "1971-05-17", jobId: directorJob });
    senior = await employee("Senior", { birthDate: "1970-12-10" });
  });
  afterAll(() => app?.close());

  it("kebijakan bawaan & simpan pengecualian per jabatan", async () => {
    expect((await a.get("/retirement-policy").expect(200)).body).toMatchObject({
      retirementAge: 56,
      dateRule: "end_of_month",
      rules: [],
    });
    const saved = (
      await a
        .put("/retirement-policy", {
          retirementAge: 56,
          dateRule: "end_of_month",
          reminderMonths: 12,
          rules: [{ kind: "job", refId: directorJob, retirementAge: 60, note: "Direksi" }],
        })
        .expect(200)
    ).body;
    expect(saved.rules).toEqual([expect.objectContaining({ refName: "Direktur", retirementAge: 60 })]);
    expect((await a.get(`/employees/${staff}/retirement`).expect(200)).body).toEqual({
      age: 56,
      source: "company",
      date: "2027-05-31",
    });
    expect((await a.get(`/employees/${director}/retirement`).expect(200)).body).toMatchObject({
      age: 60,
      source: "job",
      date: "2031-05-31",
    });
    // Usia di luar batas & referensi tak dikenal ditolak.
    await a.put("/retirement-policy", { retirementAge: 30 }).expect(400);
    const bad = await a
      .put("/retirement-policy", {
        retirementAge: 56,
        rules: [{ kind: "department", refId: "00000000-0000-4000-8000-000000000000", retirementAge: 55 }],
      })
      .expect(400);
    expect(bad.body.errors[0].path).toBe("rules.0.refId");
  });

  it("aturan tanggal per perusahaan & usia khusus karyawan", async () => {
    await a
      .put("/retirement-policy", {
        retirementAge: 56,
        dateRule: "next_month_start",
        reminderMonths: 12,
        rules: [{ kind: "job", refId: directorJob, retirementAge: 60 }],
      })
      .expect(200);
    expect((await a.get(`/employees/${senior}/retirement`).expect(200)).body.date).toBe("2027-01-01");
    await a.patch(`/employees/${senior}`, { retirementAge: 58 }).expect(200);
    expect((await a.get(`/employees/${senior}/retirement`).expect(200)).body).toMatchObject({
      age: 58,
      source: "employee",
      date: "2029-01-01",
    });
  });

  it("daftar akan pensiun & pengingat HR", async () => {
    const list = (await a.get("/retirement/upcoming?months=24").expect(200)).body as { name: string }[];
    expect(list.map((r) => r.name)).toEqual(["Staf"]);
    const reminders = (await a.get("/hr/reminders?days=30").expect(200)).body;
    expect(reminders.retirements.map((r: { name: string }) => r.name)).toContain("Staf");
    const overview = (await a.get(`/employees/${staff}/overview`).expect(200)).body;
    expect(overview.retirement).toMatchObject({ age: 56, date: "2027-06-01" });
  });

  it("kontrak tidak boleh melewati tanggal pensiun", async () => {
    const res = await a
      .post("/contracts", {
        employeeId: staff,
        contractType: "pkwt",
        wage: 8000000,
        dateStart: "2026-12-01",
        dateEnd: "2027-11-30",
      })
      .expect(400);
    expect(res.body.errors[0].path).toBe("dateEnd");
    expect(res.body.errors[0].message).toMatch(/tanggal pensiun 2027-06-01/);
    const late = await a
      .post("/employees", {
        name: "Terlalu Tua",
        birthDate: "1960-01-01",
        contract: { contractType: "pkwtt", dateStart: "2026-11-16", wage: 5000000 },
      })
      .expect(400);
    expect(late.body.errors[0].path).toBe("contract.dateStart");
  });
});
