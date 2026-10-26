import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** Pesan error validasi: pesan field pertama, atau pesan umum. */
const msg = (res: { body: { message: string; errors?: { message: string }[] } }) =>
  res.body.errors?.[0]?.message ?? res.body.message;
const pdf = {
  name: "surat.pdf",
  type: "application/pdf",
  data: Buffer.from("%PDF-1.4 dokter").toString("base64"),
};

/**
 * Cuti lanjutan: akrual tahunan setelah 12 bulan (idempoten), carry-over berbatas & kedaluwarsa, saldo FIFO, setengah
 * hari, maks. berturut, lampiran wajib, tanggal blok, saldo minus berbatas, cuti massal, cuti pengganti dari lembur.
 */
describe.skipIf(!hasDb)("SDM: cuti lanjutan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let staff: ReturnType<typeof client>;
  let siti: string;
  let budi: string;
  let planId: string;
  const types: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "lvx");
    const me = (await a.get("/auth/me")).body;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.roles)
        .values({ code: "karyawan", name: "Karyawan" })
        .returning({ id: schema.roles.id }),
    );
    const userId = (
      await a
        .post("/users", {
          name: "Siti",
          email: "siti@example.com",
          password: "rahasia123",
          roleIds: [role!.id],
          companyIds: [me.activeCompanyId],
        })
        .expect(201)
    ).body.id;
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "siti@example.com", password: "rahasia123" })
        .expect(200)
    ).body.token;
    staff = client(app, token);
    siti = (await a.post("/employees", { name: "Siti Aminah", userId, joinDate: "2024-03-15" }).expect(201))
      .body.id;
    budi = (await a.post("/employees", { name: "Budi Santoso", joinDate: "2023-01-02" }).expect(201)).body.id;
    for (const t of (await a.get("/leave-types?limit=100").expect(200)).body.items) types[t.name] = t.id;
  });
  afterAll(() => app?.close());

  const leave = (who: ReturnType<typeof client>, body: object) => who.post("/leaves", body);
  const balance = async (date: string, typeName = "Cuti tahunan") => {
    const report = (await a.get(`/leaves/balance-report?date=${date}`).expect(200)).body;
    const row = report.rows.find((r: { id: string }) => r.id === siti);
    return row.balances.find((b: { leaveTypeId: string }) => b.leaveTypeId === types[typeName]);
  };

  it("jenis cuti bawaan baru tersedia; sakit wajib lampiran", async () => {
    expect(Object.keys(types)).toEqual(
      expect.arrayContaining(["Cuti menikah", "Cuti ayah/paternitas", "Cuti duka", "Cuti pengganti"]),
    );
    const sick = (await a.get(`/leave-types/${types["Sakit (dengan surat dokter)"]}`).expect(200)).body;
    expect(sick).toMatchObject({ requiresAttachment: true });
  });

  it("akrual tahunan UU setelah 12 bulan, idempoten; carry-over berbatas 6 hari s.d. 31 Maret", async () => {
    planId = (
      await a
        .post("/leave-accrual-plans", {
          leaveTypeId: types["Cuti tahunan"],
          name: "Cuti tahunan UU",
          frequency: "yearly",
          daysPerPeriod: "12",
          startAfterMonths: 12,
          carryOver: "limited",
          carryOverMax: "6",
          carryOverExpiryMonths: 3,
        })
        .expect(201)
    ).body.id;
    expect(
      (
        await a
          .post(`/leave-accrual-plans/${planId}/assign`, { employeeIds: [siti], dateFrom: "2024-01-01" })
          .expect(200)
      ).body,
    ).toEqual({ assigned: 1 });
    expect(
      (await a.post(`/leave-accrual-plans/${planId}/run?until=2025-12-31`).expect(200)).body,
    ).toMatchObject({ created: 1 });
    expect(
      (await a.post(`/leave-accrual-plans/${planId}/run?until=2025-12-31`).expect(200)).body,
    ).toMatchObject({ created: 0 });
    // Masa kerja 12 bulan tercapai 15 Maret 2025.
    expect(await balance("2025-03-14")).toMatchObject({ allocated: "0.00" });
    expect(await balance("2025-06-01")).toMatchObject({ allocated: "12.00", remaining: "12.00" });

    const used = (
      await leave(staff, {
        leaveTypeId: types["Cuti tahunan"],
        dateFrom: "2025-06-02",
        dateTo: "2025-06-06",
      }).expect(201)
    ).body;
    await a.post(`/leaves/${used.id}/approve`).expect(200);
    expect((await a.post(`/leave-accrual-plans/${planId}/carry-over?year=2025`).expect(200)).body).toEqual({
      created: 1,
      days: "6.00",
    });
    expect((await a.post(`/leave-accrual-plans/${planId}/carry-over?year=2025`).expect(200)).body).toEqual({
      created: 0,
      days: "0.00",
    });
    await a.post(`/leave-accrual-plans/${planId}/run?until=2026-01-15`).expect(200);
    expect(await balance("2026-02-01")).toMatchObject({
      allocated: "18.00",
      remaining: "18.00",
      expiringSoon: "0.00",
    });
    expect(await balance("2026-03-10")).toMatchObject({ expiringSoon: "6.00", expiringOn: "2026-03-31" });

    // Cuti Februari memakai sisa carry-over lebih dulu; sisanya hangus setelah 31 Maret.
    const feb = (
      await leave(staff, {
        leaveTypeId: types["Cuti tahunan"],
        dateFrom: "2026-02-02",
        dateTo: "2026-02-04",
      }).expect(201)
    ).body;
    await a.post(`/leaves/${feb.id}/approve`).expect(200);
    expect(await balance("2026-04-15")).toMatchObject({ allocated: "12.00", remaining: "12.00" });
    const ledger = (
      await a.get(`/leaves/ledger?employeeId=${siti}&leaveTypeId=${types["Cuti tahunan"]}`).expect(200)
    ).body;
    expect(ledger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "expire", date: "2026-04-01", days: "3.00" }),
        expect.objectContaining({
          kind: "credit",
          label: expect.stringContaining("berlaku s.d. 2026-03-31"),
        }),
      ]),
    );
  });

  it("setengah hari pagi & siang di hari yang sama; tidak bisa dobel", async () => {
    const am = (
      await leave(staff, {
        leaveTypeId: types["Cuti tahunan"],
        dateFrom: "2026-11-02",
        dateTo: "2026-11-02",
        halfDay: "am",
      }).expect(201)
    ).body;
    expect(am.days).toBe("0.50");
    await leave(staff, {
      leaveTypeId: types["Cuti tahunan"],
      dateFrom: "2026-11-02",
      dateTo: "2026-11-02",
      halfDay: "pm",
    }).expect(201);
    await leave(staff, {
      leaveTypeId: types["Cuti tahunan"],
      dateFrom: "2026-11-02",
      dateTo: "2026-11-02",
      halfDay: "am",
    }).expect(400);
    await leave(staff, {
      leaveTypeId: types["Cuti tahunan"],
      dateFrom: "2026-11-02",
      dateTo: "2026-11-03",
      halfDay: "am",
    }).expect(400);
  });

  it("maks. hari berturut, lampiran wajib, jenis cuti khusus HR", async () => {
    await a.patch(`/leave-types/${types["Cuti menikah"]}`, { maxConsecutiveDays: "3" }).expect(200);
    const long = await leave(staff, {
      leaveTypeId: types["Cuti menikah"],
      dateFrom: "2026-11-16",
      dateTo: "2026-11-19",
    }).expect(400);
    expect(msg(long)).toContain("maksimal 3 hari");

    await leave(staff, {
      leaveTypeId: types["Sakit (dengan surat dokter)"],
      dateFrom: "2026-10-05",
      dateTo: "2026-10-05",
    }).expect(400);
    const sick = (
      await leave(staff, {
        leaveTypeId: types["Sakit (dengan surat dokter)"],
        dateFrom: "2026-10-05",
        dateTo: "2026-10-05",
        attachment: pdf,
        delegateEmployeeId: budi,
        delegateNote: "Laporan harian",
      }).expect(201)
    ).body;
    expect(sick).toMatchObject({ attachmentName: "surat.pdf", delegateEmployeeId: budi });
    expect((await staff.get(`/leaves/${sick.id}/attachment`).expect(200)).headers["content-type"]).toContain(
      "pdf",
    );
    const listed = (await a.get(`/leaves?employeeId=${siti}`).expect(200)).body;
    expect(listed.find((l: { id: string }) => l.id === sick.id)).toMatchObject({
      hasAttachment: true,
      delegateName: "Budi Santoso",
    });
    expect(listed[0]).not.toHaveProperty("attachment");

    types["Cuti bersama"] = (
      await a
        .post("/leave-types", { name: "Cuti bersama", requiresAllocation: false, employeeRequestable: false })
        .expect(201)
    ).body.id;
    await leave(staff, {
      leaveTypeId: types["Cuti bersama"],
      dateFrom: "2026-11-23",
      dateTo: "2026-11-23",
    }).expect(400);
    expect(
      (await staff.get("/me/leave-types").expect(200)).body.map((t: { name: string }) => t.name),
    ).not.toContain("Cuti bersama");
  });

  it("tanggal blok cuti: karyawan ditolak, HR (hr.manage) boleh", async () => {
    await a
      .post("/leave-block-dates", {
        dateFrom: "2026-12-21",
        dateTo: "2026-12-23",
        reason: "Tutup buku akhir tahun",
      })
      .expect(201);
    const blocked = await leave(staff, {
      leaveTypeId: types["Cuti tahunan"],
      dateFrom: "2026-12-22",
      dateTo: "2026-12-22",
    }).expect(400);
    expect(msg(blocked)).toContain("Tutup buku akhir tahun");
    await leave(a, {
      employeeId: siti,
      leaveTypeId: types["Cuti tahunan"],
      dateFrom: "2026-12-22",
      dateTo: "2026-12-22",
    }).expect(201);
  });

  it("saldo minus hanya bila diizinkan dan sampai batasnya", async () => {
    // Sisa 2026: 12 − 1 (setengah hari ×2) − 1 (22 Des) = 10.
    expect(await balance("2026-11-01")).toMatchObject({ remaining: "10.00" });
    const twelve = { leaveTypeId: types["Cuti tahunan"], dateFrom: "2026-11-09", dateTo: "2026-11-24" };
    expect(msg(await leave(staff, twelve).expect(400))).toContain("tidak cukup");
    await a
      .patch(`/leave-types/${types["Cuti tahunan"]}`, { allowNegative: true, negativeLimit: "2" })
      .expect(200);
    const ok = (await leave(staff, twelve).expect(201)).body;
    expect(ok.days).toBe("12.00");
    expect(await balance("2026-11-25")).toMatchObject({ remaining: "-2.00" });
    const more = await leave(staff, {
      leaveTypeId: types["Cuti tahunan"],
      dateFrom: "2026-11-30",
      dateTo: "2026-11-30",
      halfDay: "am",
    }).expect(400);
    expect(msg(more)).toContain("batas minus");
  });

  it("cuti massal: bentrok dilewati, bisa dibatalkan sekaligus", async () => {
    await leave(a, {
      employeeId: budi,
      leaveTypeId: types["Cuti menikah"],
      dateFrom: "2026-12-24",
      dateTo: "2026-12-24",
    }).expect(201);
    const bulk = (
      await a
        .post("/leaves/bulk", {
          leaveTypeId: types["Cuti bersama"],
          dateFrom: "2026-12-24",
          dateTo: "2026-12-24",
          reason: "Cuti bersama Natal",
        })
        .expect(200)
    ).body;
    expect(bulk.created.map((c: { employeeName: string }) => c.employeeName)).toEqual(["Siti Aminah"]);
    expect(bulk.skipped).toEqual([
      expect.objectContaining({ employeeName: "Budi Santoso", reason: expect.stringContaining("Sudah ada") }),
    ]);
    const rows = (await a.get(`/leaves?employeeId=${siti}&state=approved`).expect(200)).body;
    expect(rows.find((r: { bulkId: string | null }) => r.bulkId === bulk.bulkId)).toMatchObject({
      dateFrom: "2026-12-24",
    });
    expect((await a.get("/leaves/bulk").expect(200)).body[0]).toMatchObject({
      bulkId: bulk.bulkId,
      employees: 1,
    });
    expect((await a.post(`/leaves/bulk/${bulk.bulkId}/cancel`).expect(200)).body).toEqual({ cancelled: 1 });
    await a.post(`/leaves/bulk/${bulk.bulkId}/cancel`).expect(404);
  });

  it("cuti pengganti dari lembur hari libur; lembur itu tidak dibayar di payroll", async () => {
    const ct = (
      await a.post("/contracts", { employeeId: siti, wage: "8000000", dateStart: "2024-03-15" }).expect(201)
    ).body;
    await a.post(`/contracts/${ct.id}/start`).expect(200);
    const rest = (
      await a
        .post("/overtimes", { employeeId: siti, date: "2026-10-04", hours: "8", dayType: "rest_day" })
        .expect(201)
    ).body;
    const work = (
      await a
        .post("/overtimes", { employeeId: siti, date: "2026-10-06", hours: "2", dayType: "workday" })
        .expect(201)
    ).body;
    await a.post(`/overtimes/${work.id}/compensate`).expect(400);
    const listed = (await a.get("/leaves/compensable-overtimes").expect(200)).body.map(
      (o: { id: string }) => o.id,
    );
    expect(listed).toEqual([rest.id]);
    const alloc = (await a.post(`/overtimes/${rest.id}/compensate`).expect(200)).body;
    expect(alloc).toMatchObject({
      days: "1.00",
      dateFrom: "2026-10-04",
      dateTo: "2027-01-03",
      source: "compensatory",
    });
    await a.post(`/overtimes/${rest.id}/compensate`).expect(400);
    expect((await a.get("/leaves/compensable-overtimes").expect(200)).body).toEqual([]);
    expect(await balance("2026-11-01", "Cuti pengganti")).toMatchObject({ remaining: "1.00" });

    const run = (await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201))
      .body;
    const slipId = (await a.get(`/payroll-runs/${run.id}`).expect(200)).body.payslips.find(
      (p: { employeeId: string }) => p.employeeId === siti,
    ).id;
    const lines = (await a.get(`/payslips/${slipId}`).expect(200)).body.lines as {
      code: string;
      amount: string;
    }[];
    const ot = lines.find((l) => l.code === "OT");
    // Hanya lembur hari kerja 2 jam yang dibayar: 1,5 + 2 jam × upah/173.
    expect(Number(ot?.amount)).toBe(Math.round((1.5 + 2) * (8_000_000 / 173)));
  });

  it("portal: saldo dengan sisa yang akan kedaluwarsa", async () => {
    const mine = (await staff.get("/me/leaves").expect(200)).body;
    expect(
      mine.balances.find((b: { leaveTypeName: string }) => b.leaveTypeName === "Cuti tahunan"),
    ).toHaveProperty("expiringSoon");
  });
});
