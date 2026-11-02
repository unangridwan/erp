import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

/**
 * Lembur dari absensi: jam lembur dihitung dari absen pulang terhadap jadwal (hari libur seluruh jam kerja), masuk ke
 * atasan langsung, atasan boleh mengurangi jam saat menyetujui atau menolak; hanya lembur disetujui dibayar.
 */
describe.skipIf(!hasDb)("Lembur dari absensi", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let manager: ReturnType<typeof client>;
  let staff: ReturnType<typeof client>;
  let staffEmp: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "lemburabs");
    const me = (await a.get("/auth/me")).body;
    const [role] = await app
      .get(TenantDb)
      .runAs(me.tenantId, (tx) =>
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
    const mgr = await user("Manajer", "mgr@example.com");
    const stf = await user("Staf", "staf@example.com");
    manager = mgr.api;
    staff = stf.api;
    const schedule = (
      await a.post("/work-schedules", { name: "Kantor", startTime: "08:00", endTime: "17:00" }).expect(201)
    ).body.id;
    const mgrEmp = (
      await a
        .post("/employees", { name: "Manajer Produksi", userId: mgr.id, joinDate: "2020-01-02" })
        .expect(201)
    ).body.id;
    staffEmp = (
      await a
        .post("/employees", {
          name: "Staf Produksi",
          userId: stf.id,
          managerId: mgrEmp,
          scheduleId: schedule,
          joinDate: "2024-01-02",
        })
        .expect(201)
    ).body.id;
    const c = (
      await a
        .post("/contracts", { employeeId: staffEmp, wage: "5190000", dateStart: "2026-01-01" })
        .expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, overtimeFromAttendance: true }).expect(200);
    // Senin 2 Nov pulang 19:50 (2 jam 50 mnt → 2,5 jam), Selasa pulang 17:10 (tidak lembur),
    // Rabu pulang 21:00 (4 jam), Sabtu (hari istirahat) 08:00–12:00 (4 jam).
    for (const [date, out] of [
      ["2026-11-02", "19:50"],
      ["2026-11-03", "17:10"],
      ["2026-11-04", "21:00"],
    ])
      await a
        .post("/attendance", {
          employeeId: staffEmp,
          checkIn: `${date}T07:55:00+07:00`,
          checkOut: `${date}T${out}:00+07:00`,
        })
        .expect(201);
    await a
      .post("/attendance", {
        employeeId: staffEmp,
        checkIn: "2026-11-07T08:00:00+07:00",
        checkOut: "2026-11-07T12:00:00+07:00",
      })
      .expect(201);
  });
  afterAll(() => app?.close());

  const overtimes = async () =>
    (await a.get("/overtimes?limit=50").expect(200)).body.items as {
      id: string;
      date: string;
      hours: string;
      computedHours: string | null;
      dayType: string;
      source: string;
      state: string;
      description: string;
    }[];

  it("dihitung dari absensi, idempoten, menunggu atasan", async () => {
    expect(
      (await a.post("/overtimes/from-attendance", { from: "2026-11-01", to: "2026-11-08" }).expect(200)).body,
    ).toEqual({ created: 3, updated: 0, removed: 0 });
    expect(
      (await a.post("/overtimes/from-attendance", { from: "2026-11-01", to: "2026-11-08" }).expect(200)).body,
    ).toEqual({ created: 0, updated: 0, removed: 0 });
    const rows = (await overtimes()).sort((x, y) => x.date.localeCompare(y.date));
    expect(rows.map((r) => [r.date, r.hours, r.dayType, r.source, r.state])).toEqual([
      ["2026-11-02", "2.50", "workday", "attendance", "confirm"],
      ["2026-11-04", "4.00", "workday", "attendance", "confirm"],
      ["2026-11-07", "4.00", "rest_day", "attendance", "confirm"],
    ]);
    expect(rows[0]!.description).toBe("Dari absensi 07:55–19:50 (jadwal s.d. 17:00)");
    const pending = (await manager.get("/approvals/pending").expect(200)).body;
    expect(pending).toHaveLength(3);
    expect(pending[0]).toMatchObject({ model: "overtime", mine: true, overtime: { source: "attendance" } });
  });

  it("absensi diganti sebelum diputuskan → lembur lama dihapus, dihitung ulang", async () => {
    const att = (await a.get(`/attendance?employeeId=${staffEmp}&from=2026-11-04&to=2026-11-04`).expect(200))
      .body as { id: string }[];
    await a.delete(`/attendance/${att[0]!.id}`).expect(204);
    await a
      .post("/attendance", {
        employeeId: staffEmp,
        checkIn: "2026-11-04T07:55:00+07:00",
        checkOut: "2026-11-04T18:00:00+07:00",
      })
      .expect(201);
    expect(
      (await a.post("/overtimes/from-attendance", { from: "2026-11-04", to: "2026-11-04" }).expect(200)).body,
    ).toEqual({ created: 1, updated: 0, removed: 1 });
    expect((await overtimes()).find((r) => r.date === "2026-11-04")!.hours).toBe("1.00");
  });

  it("atasan menyetujui dengan jam dikurangi, menolak; karyawan tidak bisa menyetujui sendiri", async () => {
    const rows = await overtimes();
    const mon = rows.find((r) => r.date === "2026-11-02")!;
    const wed = rows.find((r) => r.date === "2026-11-04")!;
    const sat = rows.find((r) => r.date === "2026-11-07")!;
    await staff.post(`/approvals/overtime/${mon.id}/approve`).expect(403);
    await manager.post(`/approvals/overtime/${mon.id}/approve`, { hours: 3 }).expect(400);
    const approved = (
      await manager
        .post(`/approvals/overtime/${mon.id}/approve`, { hours: 2, note: "Sesuai SPL" })
        .expect(200)
    ).body;
    expect(approved).toMatchObject({ state: "approved" });
    await manager.post(`/approvals/overtime/${wed.id}/approve`).expect(200);
    await manager.post(`/approvals/overtime/${sat.id}/refuse`, { note: "Tanpa perintah lembur" }).expect(200);
    const after = await overtimes();
    expect(after.find((r) => r.id === mon.id)).toMatchObject({
      hours: "2.00",
      computedHours: "2.50",
      state: "approved",
    });
    expect(after.find((r) => r.id === sat.id)).toMatchObject({ state: "refused" });
    // Sudah diputuskan → tidak diubah lagi oleh hitung ulang.
    expect(
      (await a.post("/overtimes/from-attendance", { from: "2026-11-01", to: "2026-11-08" }).expect(200)).body,
    ).toEqual({ created: 0, updated: 0, removed: 0 });
  });

  it("payroll membayar jam yang disetujui saja", async () => {
    const run = (await a.post("/payroll-runs", { period: "2026-11", paymentDate: "2026-11-28" }).expect(201))
      .body;
    const slipId = run.payslips.find((p: { employeeId: string }) => p.employeeId === staffEmp).id;
    const slip = (await a.get(`/payslips/${slipId}`).expect(200)).body;
    const ot = slip.lines.find((e: { code: string }) => e.code === "OT");
    // Upah sejam 5.190.000 / 173 = 30.000. Senin 2 jam: 1,5 + 2 = 3,5; Rabu 1 jam: 1,5 → 5 × 30.000.
    expect(ot.amount).toBe("150000.00");
  });
});
