import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/**
 * Kalender kerja: hari cuti mengikuti jadwal kerja karyawan (bukan Senin–Jumat tetap), penugasan shift, libur per
 * perusahaan, impor libur nasional, payroll (hari kerja & potongan tanpa upah per jadwal), pesangon 1/25.
 */
describe.skipIf(!hasDb)("Kalender kerja", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let hqId: string;
  let sixDays: string;
  let shift: string;
  const types: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "kalender");
    hqId = (await a.get("/auth/me")).body.activeCompanyId;
    for (const t of (await a.get("/leave-types?limit=100").expect(200)).body.items) types[t.name] = t.id;
    sixDays = (
      await a
        .post("/work-schedules", {
          name: "Senin–Sabtu",
          startTime: "08:00",
          endTime: "15:00",
          workDays: [1, 2, 3, 4, 5, 6],
        })
        .expect(201)
    ).body.id;
    // Shift libur Selasa & Rabu.
    shift = (
      await a
        .post("/work-schedules", {
          name: "Shift toko",
          startTime: "10:00",
          endTime: "18:00",
          workDays: [0, 1, 4, 5, 6],
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app?.close());

  const employee = async (body: object) =>
    (await a.post("/employees", { joinDate: "2024-01-02", ...body }).expect(201)).body.id as string;
  const allocate = (employeeId: string) =>
    a
      .post("/leave-allocations", {
        employeeId,
        leaveTypeId: types["Cuti tahunan"],
        days: "12",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
      })
      .expect(201);
  const leave = async (employeeId: string, dateFrom: string, dateTo: string, type = "Cuti tahunan") => {
    const row = (
      await a.post("/leaves", { employeeId, leaveTypeId: types[type], dateFrom, dateTo }).expect(201)
    ).body;
    return row as { id: string; days: string };
  };

  it("cuti seminggu: 5 hari untuk Senin–Jumat, 6 hari untuk Senin–Sabtu, 5 hari untuk shift libur Selasa–Rabu", async () => {
    const office = await employee({ name: "Ani Kantor" });
    const store = await employee({ name: "Budi Pabrik", scheduleId: sixDays });
    const cashier = await employee({ name: "Cici Toko", scheduleId: shift });
    for (const e of [office, store, cashier]) await allocate(e);
    // 2026-11-02 Senin s.d. 2026-11-08 Minggu.
    expect((await leave(office, "2026-11-02", "2026-11-08")).days).toBe("5.00");
    expect((await leave(store, "2026-11-02", "2026-11-08")).days).toBe("6.00");
    expect((await leave(cashier, "2026-11-02", "2026-11-08")).days).toBe("5.00");

    // Sabtu adalah hari kerja jadwal 6 hari; Selasa bukan hari kerja shift.
    expect((await leave(store, "2026-11-14", "2026-11-14")).days).toBe("1.00");
    const tuesday = await a
      .post("/leaves", {
        employeeId: cashier,
        leaveTypeId: types["Cuti tahunan"],
        dateFrom: "2026-11-10",
        dateTo: "2026-11-10",
      })
      .expect(400);
    expect(tuesday.body.errors?.[0]?.message).toBe("Rentang cuti tidak mencakup hari kerja");

    // Penugasan shift sementara mengubah hitungan.
    await a
      .post("/shift-assignments", {
        employeeId: office,
        scheduleId: sixDays,
        dateFrom: "2026-11-16",
        dateTo: "2026-11-22",
      })
      .expect(201);
    expect((await leave(office, "2026-11-16", "2026-11-22")).days).toBe("6.00");
  });

  it("pratinjau hari cuti menyebut tanggal yang dilewati", async () => {
    const store = await employee({ name: "Dedi Gudang", scheduleId: sixDays });
    await a
      .post("/public-holidays", { date: "2026-11-03", name: "Ulang tahun kota", kind: "company" })
      .expect(201);
    const preview = (
      await a
        .post("/work-calendar/leave-days", {
          employeeId: store,
          leaveTypeId: types["Cuti tahunan"],
          dateFrom: "2026-11-02",
          dateTo: "2026-11-08",
        })
        .expect(201)
    ).body;
    expect(preview).toMatchObject({ days: 5, calendarDays: false });
    expect(preview.skipped).toEqual([
      { date: "2026-11-03", reason: "company", name: "Ulang tahun kota" },
      { date: "2026-11-08", reason: "day_off" },
    ]);
    const maternity = (
      await a
        .post("/work-calendar/leave-days", {
          employeeId: store,
          leaveTypeId: types["Cuti melahirkan"],
          dateFrom: "2026-11-02",
          dateTo: "2026-11-08",
        })
        .expect(201)
    ).body;
    expect(maternity).toMatchObject({ days: 7, calendarDays: true });
  });

  it("libur khusus perusahaan tidak berlaku di perusahaan lain", async () => {
    const childId = (
      await a
        .post("/companies", { code: "CAB", name: "PT Cabang", entityType: "subsidiary", parentId: hqId })
        .expect(201)
    ).body.id;
    const child = client(app, a.token, childId);
    await a
      .post("/public-holidays", { date: "2026-12-07", name: "Libur pusat", kind: "company", companyId: hqId })
      .expect(201);
    const hqEmp = await employee({ name: "Eka Pusat" });
    const childEmp = (
      await child.post("/employees", { name: "Fajar Cabang", joinDate: "2024-01-02" }).expect(201)
    ).body.id;
    const days = async (api: typeof child, employeeId: string) =>
      (
        await api
          .post("/work-calendar/leave-days", { employeeId, dateFrom: "2026-12-07", dateTo: "2026-12-11" })
          .expect(201)
      ).body.days;
    expect(await days(a as unknown as typeof child, hqEmp)).toBe(4);
    expect(await days(child, childEmp)).toBe(5);
    const list = (await child.get(`/work-calendar/holidays?year=2026&companyId=${childId}`).expect(200)).body;
    expect(list.items.map((h: { name: string }) => h.name)).not.toContain("Libur pusat");
  });

  it("impor libur nasional idempoten; tahun tanpa data ditolak", async () => {
    const first = (await a.post("/work-calendar/holidays/import-national", { year: 2026 }).expect(201)).body;
    expect(first.created).toBeGreaterThan(15);
    expect(first.skipped).toBe(0);
    const again = (await a.post("/work-calendar/holidays/import-national", { year: 2026 }).expect(201)).body;
    expect(again).toEqual({ created: 0, skipped: first.created });
    const list = (await a.get("/work-calendar/holidays?year=2026").expect(200)).body;
    expect(list.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-08-17", kind: "national", source: "import", companyId: null }),
        expect.objectContaining({ date: "2026-12-24", kind: "collective" }),
      ]),
    );
    await a.post("/work-calendar/holidays/import-national", { year: 2031 }).expect(400);
    // Tanggal sama untuk semua perusahaan tidak boleh dobel.
    await a.post("/public-holidays", { date: "2026-08-17", name: "Dobel" }).expect(409);
  });

  it("payroll & pesangon mengikuti jadwal 6 hari kerja", async () => {
    const acc: Record<string, string> = {};
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    const worker = await employee({ name: "Gita Produksi", scheduleId: sixDays, joinDate: "2020-01-06" });
    const c = (
      await a.post("/contracts", { employeeId: worker, wage: "5000000", dateStart: "2026-01-01" }).expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    // Izin tanpa upah Senin–Sabtu 2026-10-05 s.d. 2026-10-10 = 6 hari kerja.
    const unpaid = await leave(worker, "2026-10-05", "2026-10-10", "Izin tanpa upah");
    expect(unpaid.days).toBe("6.00");
    await a.post(`/leaves/${unpaid.id}/approve`).expect(200);
    const run = (await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201))
      .body;
    const slip = run.payslips.find((p: { employeeId: string }) => p.employeeId === worker);
    // Oktober 2026 Senin–Sabtu = 27 hari, dikurangi libur nasional hasil impor pada hari kerja (tidak ada di Oktober).
    expect(slip.workingDays).toBe(27);
    expect(Number(slip.unpaidDays)).toBe(6);

    const preview = (
      await a
        .post(`/employees/${worker}/severance/preview`, {
          reason: "efficiency_loss",
          endDate: "2026-10-31",
          unusedLeaveDays: 5,
        })
        .expect(200)
    ).body;
    // Upah harian 5.000.000 / 25 × 5 hari.
    expect(preview.uph).toBe("1000000");
  });
});
