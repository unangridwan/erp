import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

interface SlipLine {
  code: string;
  name: string;
  category: string;
  amount: string;
}

describe.skipIf(!hasDb)("Item tunda Fase 4: SDM & payroll", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  /** Tenant baru beserta helper user, kontrak, dan akun. */
  const setup = async (prefix: string) => {
    const a = await signup(app, prefix);
    const me = (await a.get("/auth/me")).body;
    const acc: Record<string, string> = {};
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.roles)
        .values({ code: "karyawan", name: "Karyawan" })
        .returning({ id: schema.roles.id }),
    );
    const user = async (name: string, email: string) => {
      await a
        .post("/users", {
          name,
          email,
          password: "rahasia123",
          roleIds: [role!.id],
          companyIds: [me.activeCompanyId],
        })
        .expect(201);
      const token = (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email, password: "rahasia123" })
          .expect(200)
      ).body.token;
      const api = client(app, token);
      return { id: (await api.get("/auth/me")).body.userId as string, api };
    };
    const employee = async (body: object) => (await a.post("/employees", body).expect(201)).body.id as string;
    const contract = async (employeeId: string, body: object) => {
      const c = (await a.post("/contracts", { employeeId, dateStart: "2026-01-01", ...body }).expect(201))
        .body;
      await a.post(`/contracts/${c.id}/start`).expect(200);
      return c.id as string;
    };
    const run = async (period: string, post = true) => {
      const r = (await a.post("/payroll-runs", { period, paymentDate: `${period}-28` }).expect(201)).body;
      if (post) await a.post(`/payroll-runs/${r.id}/post`).expect(200);
      return (await a.get(`/payroll-runs/${r.id}`).expect(200)).body as {
        id: string;
        accountMoveId: string;
        payslips: { id: string; employeeId: string; net: string; pph21: string; gross: string }[];
      };
    };
    const slip = async (id: string) =>
      (await a.get(`/payslips/${id}`).expect(200)).body as { lines: SlipLine[]; net: string; pph21: string };
    const entry = async (moveId: string) =>
      (
        (await a.get(`/moves/${moveId}`).expect(200)).body.lines as {
          accountId: string;
          debit: string;
          credit: string;
        }[]
      )
        .map((l) => [Object.entries(acc).find(([, v]) => v === l.accountId)?.[0], l.debit, l.credit])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    return { a, me, acc, user, employee, contract, run, slip, entry };
  };

  it("approval berjenjang: cuti atasan → atasan dari atasan; lembur ke atasan; tidak bisa menyetujui sendiri", async () => {
    const { a, user, employee } = await setup("appr");
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a
      .put("/payroll/settings", { ...settings, leaveApprovalLevels: 2, overtimeApprovalLevels: 1 })
      .expect(200);
    const boss = await user("Bos", "bos@example.com");
    const manager = await user("Manajer", "mgr@example.com");
    const staff = await user("Staf", "staf@example.com");
    const bossEmp = await employee({ name: "Bos Besar", userId: boss.id, joinDate: "2020-01-01" });
    const mgrEmp = await employee({
      name: "Manajer Tim",
      userId: manager.id,
      managerId: bossEmp,
      joinDate: "2021-01-01",
    });
    const staffEmp = await employee({
      name: "Staf Muda",
      userId: staff.id,
      managerId: mgrEmp,
      joinDate: "2024-01-01",
    });
    const annual = (await a.get("/leave-types").expect(200)).body.items.find(
      (t: { name: string }) => t.name === "Cuti tahunan",
    ).id;
    await a
      .post("/leave-allocations", {
        employeeId: staffEmp,
        leaveTypeId: annual,
        days: "12",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
      })
      .expect(201);
    const leave = (
      await staff.api
        .post("/leaves", { leaveTypeId: annual, dateFrom: "2026-05-04", dateTo: "2026-05-05" })
        .expect(201)
    ).body;
    expect(leave).toMatchObject({ state: "confirm", approvalStep: 1, approvalLevels: 2 });

    await staff.api.post(`/leaves/${leave.id}/approve`).expect(403);
    await boss.api.post(`/leaves/${leave.id}/approve`).expect(403); // masih tahap atasan langsung
    expect((await manager.api.get("/approvals/pending").expect(200)).body).toEqual([
      expect.objectContaining({ model: "leave_request", id: leave.id, mine: true, step: 1 }),
    ]);
    const step1 = (await manager.api.post(`/leaves/${leave.id}/approve`, { note: "OK" }).expect(200)).body;
    expect(step1).toMatchObject({ state: "confirm", approvalStep: 2 });
    await manager.api.post(`/leaves/${leave.id}/approve`).expect(403);
    const done = (await boss.api.post(`/leaves/${leave.id}/approve`).expect(200)).body;
    expect(done).toMatchObject({ state: "approved" });
    const status = (await a.get(`/approvals/leave_request/${leave.id}`).expect(200)).body;
    expect(
      status.history.map((h: { step: number; userName: string; note: string | null }) => [
        h.step,
        h.userName,
        h.note,
      ]),
    ).toEqual([
      [1, "Manajer", "OK"],
      [2, "Bos", null],
    ]);

    // Lembur (1 tahap): menunggu atasan; lembur belum disetujui tidak dibayar.
    const ot = (
      await a.post("/overtimes", { employeeId: staffEmp, date: "2026-05-06", hours: "2" }).expect(201)
    ).body;
    const pendingOt = (await a.get(`/approvals/overtime/${ot.id}`).expect(200)).body;
    expect(pendingOt).toMatchObject({ state: "confirm", step: 1, levels: 1, waitingFor: "Manajer" });
    await staff.api.post(`/approvals/overtime/${ot.id}/approve`).expect(403);
    const otDone = (await manager.api.post(`/approvals/overtime/${ot.id}/approve`).expect(200)).body;
    expect(otDone).toMatchObject({ state: "approved", waitingFor: null });
    // Penolakan di tahap mana pun menutup pengajuan.
    const leave2 = (
      await staff.api
        .post("/leaves", { leaveTypeId: annual, dateFrom: "2026-06-01", dateTo: "2026-06-01" })
        .expect(201)
    ).body;
    expect((await manager.api.post(`/leaves/${leave2.id}/refuse`).expect(200)).body.state).toBe("refused");
  });

  it("keterlambatan dari jadwal & shift dipotong di slip; pinjaman dicairkan dan dicicil sampai lunas", async () => {
    const { a, acc, employee, contract, run, slip, entry } = await setup("late");
    const day = (
      await a
        .post("/work-schedules", {
          name: "Reguler",
          startTime: "08:00",
          endTime: "17:00",
          toleranceMinutes: 10,
          penaltyPerMinute: "1000",
          penaltyPerOccurrence: "5000",
        })
        .expect(201)
    ).body.id;
    const night = (
      await a
        .post("/work-schedules", {
          name: "Malam",
          startTime: "20:00",
          endTime: "05:00",
          penaltyPerMinute: "500",
        })
        .expect(201)
    ).body.id;
    const emp = await employee({ name: "Budi Telat", joinDate: "2025-06-01", scheduleId: day });
    await contract(emp, { wage: "6000000" });
    await a
      .post("/shift-assignments", {
        employeeId: emp,
        scheduleId: night,
        dateFrom: "2026-03-09",
        dateTo: "2026-03-09",
      })
      .expect(201);
    for (const checkIn of [
      "2026-03-02T01:05:00Z",
      "2026-03-03T01:30:00Z",
      "2026-03-06T01:11:00Z",
      "2026-03-09T13:20:00Z",
    ])
      await a
        .post("/attendance", {
          employeeId: emp,
          checkIn,
          checkOut: new Date(Date.parse(checkIn) + 8 * 3600e3).toISOString(),
        })
        .expect(201);
    const late = (await a.get("/attendance/lateness?from=2026-03-01&to=2026-03-31").expect(200)).body;
    expect(late).toEqual([
      expect.objectContaining({
        employeeId: emp,
        occurrences: 3,
        minutes: 61,
        penalty: "61000",
        days: [
          { date: "2026-03-03", minutes: 30, penalty: "35000" },
          { date: "2026-03-06", minutes: 11, penalty: "16000" },
          { date: "2026-03-09", minutes: 20, penalty: "10000" },
        ],
      }),
    ]);

    const loan = (
      await a
        .post("/employee-loans", {
          employeeId: emp,
          name: "Kasbon renovasi",
          principal: "1000000",
          installment: "400000",
          startPeriod: "2026-03",
        })
        .expect(201)
    ).body;
    await a
      .post("/employee-loans", {
        employeeId: emp,
        name: "X",
        principal: "100",
        installment: "200",
        startPeriod: "2026-03",
      })
      .expect(400);
    const bank = (await a.get("/journals").expect(200)).body.items.find(
      (j: { code: string }) => j.code === "BNK1",
    ).id;
    const disbursed = (
      await a.post(`/employee-loans/${loan.id}/disburse`, { journalId: bank, date: "2026-02-25" }).expect(200)
    ).body;
    expect(disbursed).toMatchObject({ state: "running", remaining: "1000000.00" });
    expect(await entry(disbursed.disbursementMoveId)).toEqual([
      ["1-1200", "0.00", "1000000.00"],
      ["1-1800", "1000000.00", "0.00"],
    ]);

    const march = await run("2026-03");
    const lines = (await slip(march.payslips[0]!.id)).lines;
    expect(lines.find((l) => l.code === "LATE")).toMatchObject({ amount: "-61000.00", category: "unpaid" });
    expect(lines.find((l) => l.code === "LOAN")).toMatchObject({
      name: "Cicilan Kasbon renovasi",
      amount: "-400000.00",
    });
    expect((await entry(march.accountMoveId)).find((l) => l[0] === "1-1800")).toEqual([
      "1-1800",
      "0.00",
      "400000.00",
    ]);
    expect((await a.get(`/employee-loans/${loan.id}`).expect(200)).body).toMatchObject({
      paid: "400000.00",
      remaining: "600000.00",
      state: "running",
    });
    await a.post(`/employee-loans/${loan.id}/cancel`).expect(400);
    await run("2026-04");
    const may = await run("2026-05");
    expect((await slip(may.payslips[0]!.id)).lines.find((l) => l.code === "LOAN")?.amount).toBe("-200000.00");
    const closed = (await a.get(`/employee-loans/${loan.id}`).expect(200)).body;
    expect(closed).toMatchObject({ state: "done", remaining: "0.00" });
    expect(closed.installments).toHaveLength(3);
    const june = await run("2026-06", false);
    expect((await slip(june.payslips[0]!.id)).lines.some((l) => l.code === "LOAN")).toBe(false);
    expect(acc["1-1800"]).toBeTruthy();
  });

  it("pekerja harian & borongan: upah dari kehadiran/hasil kerja, BPJS JKK+JKM saja di awal, PPh harian; pesangon PP 35/2021", async () => {
    const { a, employee, contract, run, slip, entry } = await setup("casual");
    const daily = await employee({ name: "Harian Baru", joinDate: "2026-03-01" });
    await contract(daily, { wage: "200000", wageType: "daily", dateStart: "2026-03-01" });
    for (const dte of ["02", "03", "04", "05", "06"])
      await a
        .post("/attendance", {
          employeeId: daily,
          checkIn: `2026-03-${dte}T01:00:00Z`,
          checkOut: `2026-03-${dte}T09:00:00Z`,
        })
        .expect(201);
    const piece = await employee({ name: "Borongan Lama", joinDate: "2025-01-01" });
    await contract(piece, { wage: "5000", wageType: "piece" });
    const e1 = (
      await a.post("/work-entries", { employeeId: piece, date: "2026-03-02", quantity: "300" }).expect(201)
    ).body.id;
    await a.post("/work-entries", { employeeId: piece, date: "2026-03-03", quantity: "500" }).expect(201);

    const march = await run("2026-03");
    const of = (id: string) => march.payslips.find((p) => p.employeeId === id)!;
    const dailySlip = await slip(of(daily).id);
    expect(dailySlip.lines.map((l) => [l.code, l.amount])).toEqual([
      ["BASIC", "1000000.00"],
      ["JKK", "2400.00"],
      ["JKM", "3000.00"],
    ]);
    expect(dailySlip.lines[0]!.name).toBe("Upah harian (5 hari)");
    expect(of(daily)).toMatchObject({ net: "1000000.00", pph21: "0.00" });
    // Rp2.090.800/hari × 0,5% × 120% (tanpa NPWP) = 12.544/hari × 2 hari.
    expect(of(piece)).toMatchObject({ gross: "4181600.00", pph21: "25088.00", net: "3814912.00" });
    expect((await slip(of(piece).id)).lines[0]).toMatchObject({
      name: "Upah borongan",
      amount: "4000000.00",
    });
    await a.patch(`/work-entries/${e1}`, { quantity: "1" }).expect(400);

    // Pesangon: efisiensi karena merugi, masa kerja 8 tahun 2 bulan.
    const senior = await employee({ name: "Senior Lama", joinDate: "2018-01-15" });
    await contract(senior, { wage: "10000000", dateStart: "2018-01-15" });
    const annual = (await a.get("/leave-types").expect(200)).body.items.find(
      (t: { name: string }) => t.name === "Cuti tahunan",
    ).id;
    await a
      .post("/leave-allocations", {
        employeeId: senior,
        leaveTypeId: annual,
        days: "12",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
      })
      .expect(201);
    const preview = (
      await a
        .post(`/employees/${senior}/severance/preview`, { reason: "efficiency_loss", endDate: "2026-03-31" })
        .expect(200)
    ).body;
    expect(preview).toMatchObject({
      monthlyWage: "10000000.00",
      unusedLeaveDays: "12",
      up: "45000000",
      upmk: "30000000",
    });
    const saved = (
      await a
        .post(`/employees/${senior}/severances`, {
          reason: "efficiency_loss",
          endDate: "2026-03-31",
          unusedLeaveDays: 5,
        })
        .expect(201)
    ).body;
    expect(saved).toMatchObject({
      gross: "77380952.00",
      tax: "1369047.00",
      net: "76011905.00",
      state: "posted",
    });
    expect(await entry(saved.moveId)).toEqual([
      ["2-1300", "0.00", "1369047.00"],
      ["2-1500", "0.00", "76011905.00"],
      ["6-1000", "77380952.00", "0.00"],
    ]);
    expect((await a.get(`/employees/${senior}`).expect(200)).body.resignDate).toBe("2026-03-31");
    expect((await a.get(`/employees/${senior}/severances`).expect(200)).body).toHaveLength(1);
  });
});
