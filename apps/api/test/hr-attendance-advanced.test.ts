import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const msg = (res: { body: { message: string; errors?: { message: string }[] } }) =>
  res.body.errors?.[0]?.message ?? res.body.message;
/** Instan WIB (UTC+7). */
const wib = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();

/**
 * Absensi lanjutan: geofence, validasi, kiosk PIN, push mesin (idempoten), koreksi absensi & tukar shift berjenjang,
 * rekap status harian, kunci absensi, auto-checkout, kunci otomatis saat payroll diposting.
 */
describe.skipIf(!hasDb)("SDM: absensi lanjutan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let staff: ReturnType<typeof client>;
  let manager: ReturnType<typeof client>;
  let emp: string;
  let regular: string;
  let night: string;
  let deviceKey: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "atx");
    const me = (await a.get("/auth/me")).body;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.roles)
        .values({ code: "karyawan", name: "Karyawan" })
        .returning({ id: schema.roles.id }),
    );
    const user = async (name: string, email: string) => {
      const id = (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [role!.id],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
      const token = (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email, password: "rahasia123" })
          .expect(200)
      ).body.token;
      return { id, api: client(app, token) };
    };
    const s = await user("Siti", "siti@example.com");
    const m = await user("Mira", "mira@example.com");
    staff = s.api;
    manager = m.api;
    regular = (
      await a
        .post("/work-schedules", {
          name: "Reguler",
          startTime: "08:00",
          endTime: "17:00",
          toleranceMinutes: 10,
        })
        .expect(201)
    ).body.id;
    night = (
      await a
        .post("/work-schedules", {
          name: "Shift malam",
          startTime: "20:00",
          endTime: "05:00",
          workDays: [1, 2, 3, 4, 5],
        })
        .expect(201)
    ).body.id;
    const mgr = (
      await a.post("/employees", { name: "Mira Manajer", userId: m.id, joinDate: "2020-01-01" }).expect(201)
    ).body.id;
    emp = (
      await a
        .post("/employees", {
          name: "Siti Aminah",
          userId: s.id,
          managerId: mgr,
          joinDate: "2024-01-01",
          scheduleId: regular,
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app?.close());

  const settings = async (patch: object) => {
    const current = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...current, ...patch }).expect(200);
  };

  it("geofence lokasi kerja: di luar radius & tanpa GPS ditolak, di dalam dicatat jaraknya", async () => {
    const loc = (
      await a
        .post("/work-locations", {
          name: "Kantor Pusat",
          latitude: -6.2,
          longitude: 106.8166,
          radiusM: 100,
          enforceGeofence: true,
        })
        .expect(201)
    ).body;
    await a.patch(`/employees/${emp}`, { workLocationId: loc.id, badgeCode: "B001" }).expect(200);
    expect(
      msg(await staff.post("/attendance/check-in", { latitude: -6.25, longitude: 106.8166 }).expect(400)),
    ).toContain("Di luar area Kantor Pusat");
    expect(msg(await staff.post("/attendance/check-in", {}).expect(400))).toContain("Aktifkan lokasi");
    const inside = (
      await staff
        .post("/attendance/check-in", { latitude: -6.2003, longitude: 106.8166 })
        .set("User-Agent", "Playwright/Ponsel")
        .expect(200)
    ).body;
    expect(inside).toMatchObject({
      source: "web",
      state: "validated",
      workLocationId: loc.id,
      userAgent: "Playwright/Ponsel",
    });
    expect(inside.distanceM).toBeGreaterThan(20);
    expect(inside.distanceM).toBeLessThan(50);
    expect(inside).not.toHaveProperty("photo");
    await staff.post("/attendance/check-out", { latitude: -6.2003, longitude: 106.8166 }).expect(200);
  });

  it("validasi absensi: absensi baru draft sampai divalidasi HR", async () => {
    await settings({ attendanceValidation: true });
    const pin = await a.put(`/employees/${emp}/attendance-pin`, { pin: "1234" }).expect(204);
    expect(pin.body).toEqual({});
    expect(msg(await a.post("/attendance/kiosk", { code: "B001", pin: "0000" }).expect(400))).toContain(
      "PIN salah",
    );
    expect((await a.post("/attendance/kiosk", { code: "B001", pin: "1234" }).expect(200)).body).toMatchObject(
      {
        action: "in",
        employeeName: "Siti Aminah",
      },
    );
    expect((await a.post("/attendance/kiosk", { code: "B001", pin: "1234" }).expect(200)).body.action).toBe(
      "out",
    );
    const today = new Date().toISOString().slice(0, 10);
    const rows = (await a.get(`/attendance?employeeId=${emp}&from=${today}&to=${today}`).expect(200)).body;
    const kiosk = rows.find((r: { source: string }) => r.source === "kiosk");
    expect(kiosk.state).toBe("draft");
    expect((await a.post("/attendance/validate", { ids: [kiosk.id] }).expect(200)).body).toEqual({
      updated: 1,
    });
    const after = (await a.get(`/attendance?employeeId=${emp}&from=${today}&to=${today}`).expect(200)).body;
    expect(after.find((r: { id: string }) => r.id === kiosk.id).state).toBe("validated");
    await settings({ attendanceValidation: false });
    const employee = (await a.get(`/employees/${emp}`).expect(200)).body;
    expect(employee).toMatchObject({ hasAttendancePin: true, badgeCode: "B001" });
    expect(employee).not.toHaveProperty("attendancePinHash");
  });

  it("mesin absensi: kunci salah 401, log masuk/pulang idempoten, kode tak dikenal dilewati", async () => {
    const device = (await a.post("/attendance-devices", { name: "ZKTeco Lobi" }).expect(201)).body;
    deviceKey = device.key;
    expect(device).not.toHaveProperty("keyHash");
    const server = request(app.getHttpServer());
    const punches = [
      { code: "B001", timestamp: wib("2026-09-01", "07:58") },
      { code: "B001", timestamp: wib("2026-09-01", "17:03") },
      { code: "ZZZ", timestamp: wib("2026-09-01", "08:00") },
    ];
    await server
      .post("/attendance-devices/push")
      .set("X-Device-Key", `${deviceKey}x`)
      .send({ punches })
      .expect(401);
    await server.post("/attendance-devices/push").send({ punches }).expect(401);
    const first = (
      await server
        .post("/attendance-devices/push")
        .set("X-Device-Key", deviceKey)
        .send({ punches })
        .expect(200)
    ).body;
    expect(first).toMatchObject({ recorded: 2 });
    expect(first.skipped).toEqual([
      expect.objectContaining({ code: "ZZZ", reason: "Karyawan tidak dikenal" }),
    ]);
    const again = (
      await server
        .post("/attendance-devices/push")
        .set("X-Device-Key", deviceKey)
        .send({ punches })
        .expect(200)
    ).body;
    expect(again.recorded).toBe(0);
    expect(again.skipped.filter((x: { reason: string }) => x.reason === "Sudah tercatat")).toHaveLength(2);
    expect((await a.get("/attendance-devices").expect(200)).body[0].lastSeenAt).toBeTruthy();
  });

  it("koreksi absensi disetujui atasan → absensi dibuat; rekap status harian", async () => {
    const req = (
      await staff
        .post("/attendance-requests", {
          date: "2026-09-02",
          checkIn: "08:30",
          checkOut: "17:00",
          reason: "Lupa absen, rapat di klien",
        })
        .expect(201)
    ).body;
    expect(req).toMatchObject({ state: "confirm", approvalLevels: 1 });
    expect((await manager.get("/approvals/pending").expect(200)).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ model: "attendance_request", id: req.id })]),
    );
    await staff.post(`/attendance-requests/${req.id}/approve`).expect(403);
    const done = (await manager.post(`/attendance-requests/${req.id}/approve`).expect(200)).body;
    expect(done.state).toBe("approved");
    expect(done.attendanceId).toBeTruthy();

    const summary = (await a.get(`/attendance/summary?month=2026-09&employeeId=${emp}`).expect(200)).body;
    const days = Object.fromEntries(
      summary.rows[0].days.map((x: { date: string; status: string; lateMinutes: number }) => [x.date, x]),
    );
    expect(days["2026-09-01"]).toMatchObject({ status: "on_time" });
    expect(days["2026-09-02"]).toMatchObject({ status: "late", lateMinutes: 30 });
    expect(days["2026-09-03"].status).toBe("absent");
    expect(days["2026-09-05"].status).toBe("day_off");
    expect(summary.rows[0].summary.counts.on_time).toBe(1);
    const mine = (await staff.get("/me/attendance-summary?month=2026-09").expect(200)).body;
    expect(mine.row.employeeId).toBe(emp);
  });

  it("tukar shift disetujui → penugasan; ditolak bila jadwal berubah sejak diajukan", async () => {
    const r1 = (
      await staff
        .post("/shift-requests", {
          scheduleId: night,
          dateFrom: "2026-11-02",
          dateTo: "2026-11-06",
          reason: "Ganti jadwal",
        })
        .expect(201)
    ).body;
    expect(r1.currentScheduleId).toBe(regular);
    const ok = (await manager.post(`/shift-requests/${r1.id}/approve`).expect(200)).body;
    expect(ok).toMatchObject({ state: "approved" });
    expect(ok.assignmentId).toBeTruthy();

    const r2 = (
      await staff
        .post("/shift-requests", { scheduleId: night, dateFrom: "2026-11-16", dateTo: "2026-11-20" })
        .expect(201)
    ).body;
    const other = (
      await a.post("/work-schedules", { name: "Pagi", startTime: "06:00", endTime: "14:00" }).expect(201)
    ).body.id;
    await a.patch(`/employees/${emp}`, { scheduleId: other }).expect(200);
    expect(msg(await manager.post(`/shift-requests/${r2.id}/approve`).expect(400))).toContain(
      "sudah berubah",
    );
    expect((await manager.post(`/shift-requests/${r2.id}/refuse`).expect(200)).body.state).toBe("refused");
    await a.patch(`/employees/${emp}`, { scheduleId: regular }).expect(200);
  });

  it("kunci absensi: input, hapus, koreksi, dan log mesin pada tanggal terkunci ditolak", async () => {
    const sept = (await a.get(`/attendance?employeeId=${emp}&from=2026-09-01&to=2026-09-30`).expect(200))
      .body;
    await settings({ attendanceLockDate: "2026-09-30" });
    expect(
      msg(
        await a
          .post("/attendance", {
            employeeId: emp,
            checkIn: wib("2026-09-15", "08:00"),
            checkOut: wib("2026-09-15", "17:00"),
          })
          .expect(400),
      ),
    ).toContain("dikunci");
    await a.delete(`/attendance/${sept[0].id}`).expect(400);
    await staff
      .post("/attendance-requests", {
        date: "2026-09-10",
        checkIn: "08:00",
        checkOut: "17:00",
        reason: "Lupa",
      })
      .expect(400);
    const push = (
      await request(app.getHttpServer())
        .post("/attendance-devices/push")
        .set("X-Device-Key", deviceKey)
        .send({ punches: [{ code: "B001", timestamp: wib("2026-09-21", "08:00") }] })
        .expect(200)
    ).body;
    expect(push.skipped[0].reason).toContain("dikunci");
  });

  it("auto-checkout menutup absensi terbuka pada jam pulang jadwal", async () => {
    await settings({ autoCheckoutHours: 12 });
    const open = (
      await a.post("/attendance", { employeeId: emp, checkIn: wib("2026-10-01", "08:05") }).expect(201)
    ).body;
    expect((await a.post("/attendance/auto-checkout").expect(200)).body.closed).toBeGreaterThanOrEqual(1);
    const rows = (await a.get(`/attendance?employeeId=${emp}&from=2026-10-01&to=2026-10-01`).expect(200))
      .body;
    expect(rows.find((r: { id: string }) => r.id === open.id)).toMatchObject({
      autoCheckout: true,
      checkOut: wib("2026-10-01", "17:00").replace(".000Z", ".000Z"),
    });
    const today = (await a.get("/attendance/today").expect(200)).body;
    expect(
      Object.values(today.groups)
        .flat()
        .map((g) => (g as { employeeId: string }).employeeId),
    ).toContain(emp);
  });

  it("posting payroll memajukan tanggal kunci absensi ke akhir periode", async () => {
    const ct = (
      await a.post("/contracts", { employeeId: emp, wage: "7000000", dateStart: "2024-01-01" }).expect(201)
    ).body;
    await a.post(`/contracts/${ct.id}/start`).expect(200);
    const run = (await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201))
      .body;
    await a.post(`/payroll-runs/${run.id}/post`).expect(200);
    expect((await a.get("/payroll/settings").expect(200)).body.attendanceLockDate).toBe("2026-10-31");
  });
});
