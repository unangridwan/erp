import type { INestApplication } from "@nestjs/common";
import { eq, schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { Mailer } from "../src/common/mailer.js";
import { ReportScheduler } from "../src/reports/reports.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const DAY = 86_400_000;

/** Pembuat laporan kustom: agregasi, izin dataset & kolom sensitif, berbagi, jadwal email tepat sekali per periode. */
describe.skipIf(!hasDb)("Laporan kustom & terjadwal", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sari: ReturnType<typeof client>;
  let sariId: string;
  let tenantId: string;
  let reportId: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "lapkus");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    const role = (
      await a.post("/roles", { code: "staf_sdm", name: "Staf SDM", permissions: ["hr.read"] }).expect(201)
    ).body.id;
    sariId = (
      await a
        .post("/users", {
          name: "Sari SDM",
          email: "sari@example.com",
          password: "rahasia123",
          roleIds: [role],
          companyIds: [me.activeCompanyId],
        })
        .expect(201)
    ).body.id;
    sari = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const it = (await a.post("/departments", { name: "IT" }).expect(201)).body.id;
    const fin = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;
    const people: [string, string, "male" | "female", string][] = [
      ["Ani", fin, "female", "8000000"],
      ["Budi", fin, "male", "12000000"],
      ["Cici", it, "female", "15000000"],
      ["Dedi", it, "male", "9000000"],
      ["Eka", it, "female", "11000000"],
    ];
    for (const [name, departmentId, gender, wage] of people) {
      const id = (
        await a
          .post("/employees", { name, departmentId, gender, joinDate: "2024-01-02", nik: "3201010101010001" })
          .expect(201)
      ).body.id;
      await a.post("/contracts", { employeeId: id, wage, dateStart: "2024-01-02" }).expect(201);
    }
  });
  afterAll(() => app?.close());

  it("katalog dataset mengikuti hak: tanpa payroll.read dataset slip tidak muncul; kolom sensitif disembunyikan", async () => {
    const all = (await a.get("/reports/datasets").expect(200)).body as {
      key: string;
      columns: { key: string }[];
    }[];
    expect(all.map((d) => d.key)).toEqual(expect.arrayContaining(["employees", "contracts", "payslips"]));
    const mine = (await sari.get("/reports/datasets").expect(200)).body as typeof all;
    expect(mine.map((d) => d.key)).not.toContain("payslips");
    expect(mine.find((d) => d.key === "employees")!.columns.map((c) => c.key)).not.toContain("nik");
    expect(all.find((d) => d.key === "employees")!.columns.map((c) => c.key)).toContain("nik");
  });

  it("pratinjau: kelompok & agregasi, syarat, urutan", async () => {
    const byDept = (
      await a
        .post("/saved-reports/preview", {
          dataset: "employees",
          config: {
            groupBy: ["department"],
            aggregates: [{ column: "*", fn: "count" }],
            sort: { column: "department", dir: "asc" },
          },
        })
        .expect(200)
    ).body;
    expect(byDept.rows).toEqual([
      { department: "IT", "count__*": 3 },
      { department: "Keuangan", "count__*": 2 },
    ]);
    const wages = (
      await a
        .post("/saved-reports/preview", {
          dataset: "contracts",
          config: {
            groupBy: ["contractType"],
            aggregates: [
              { column: "wage", fn: "sum" },
              { column: "wage", fn: "avg" },
              { column: "wage", fn: "max" },
            ],
            conditions: [{ column: "wage", op: "gte", value: "9000000" }],
            filters: { state: "all" },
          },
        })
        .expect(200)
    ).body;
    expect(wages.rows).toHaveLength(1);
    expect(wages.rows[0]).toMatchObject({ sum__wage: 47000000, avg__wage: 11750000, max__wage: 15000000 });
    await a
      .post("/saved-reports/preview", { dataset: "employees", config: { columns: ["salary"] } })
      .expect(400);
  });

  it("izin dataset & kolom sensitif dicek setiap kali dijalankan", async () => {
    await sari.post("/saved-reports/preview", { dataset: "payslips", config: {} }).expect(403);
    await sari
      .post("/saved-reports/preview", { dataset: "employees", config: { columns: ["name", "nik"] } })
      .expect(403);
    await sari
      .post("/saved-reports/preview", {
        dataset: "employees",
        config: { conditions: [{ column: "nik", op: "notEmpty" }] },
      })
      .expect(403);
    const ok = (
      await sari
        .post("/saved-reports/preview", { dataset: "employees", config: { columns: ["name", "gender"] } })
        .expect(200)
    ).body;
    expect(ok.total).toBe(5);
  });

  it("laporan tersimpan: pribadi vs dibagikan, hanya pemilik yang mengubah, ekspor xlsx/csv/pdf", async () => {
    reportId = (
      await a
        .post("/saved-reports", {
          name: "Karyawan per departemen",
          dataset: "employees",
          config: {
            groupBy: ["department", "gender"],
            aggregates: [{ column: "*", fn: "count" }],
            chart: { type: "bar", x: "department", y: "count__*" },
          },
        })
        .expect(201)
    ).body.id;
    expect((await sari.get("/saved-reports").expect(200)).body).toEqual([]);
    await sari.get(`/saved-reports/${reportId}`).expect(404);
    await a.patch(`/saved-reports/${reportId}`, { visibility: "shared" }).expect(200);
    expect((await sari.get("/saved-reports").expect(200)).body).toEqual([
      expect.objectContaining({ id: reportId, mine: false, ownerName: expect.any(String) }),
    ]);
    const run = (await sari.get(`/saved-reports/${reportId}/run`).expect(200)).body;
    expect(run.rows).toHaveLength(4);
    await sari.patch(`/saved-reports/${reportId}`, { name: "X" }).expect(404);
    await sari.delete(`/saved-reports/${reportId}`).expect(404);
    for (const [format, type] of [
      ["xlsx", "spreadsheetml"],
      ["csv", "text/csv"],
      ["pdf", "application/pdf"],
    ])
      expect(
        (await a.get(`/saved-reports/${reportId}/export?format=${format}`).expect(200)).headers[
          "content-type"
        ],
      ).toContain(type);
    // Dataset slip tanpa periode: memakai payroll terposting terakhir (belum ada → 400).
    await a
      .post("/saved-reports/preview", { dataset: "payslips", config: { filters: { runId: "latest" } } })
      .expect(400);
  });

  it("jadwal: dikirim tepat sekali per periode dengan lampiran; pemilik kehilangan hak → gagal tercatat", async () => {
    await a
      .post(`/saved-reports/${reportId}/schedules`, { frequency: "weekly", recipients: ["hr@example.com"] })
      .expect(400);
    await sari
      .post(`/saved-reports/${reportId}/schedules`, { frequency: "daily", recipients: ["x@example.com"] })
      .expect(404);
    const schedule = (
      await a
        .post(`/saved-reports/${reportId}/schedules`, {
          frequency: "daily",
          hour: 7,
          format: "xlsx",
          recipients: ["HR@example.com", "direksi@example.com"],
        })
        .expect(201)
    ).body;
    expect(schedule.lastPeriod).toBeTruthy();
    const scheduler = app.get(ReportScheduler);
    const outbox = app.get(Mailer).outbox;
    const before = outbox.length;
    // Periode berjalan sudah dianggap terkirim saat jadwal dibuat.
    expect(await scheduler.runDue(new Date(), [tenantId])).toBe(0);
    const later = new Date(Date.now() + 2 * DAY);
    expect(await scheduler.runDue(later, [tenantId])).toBe(1);
    expect(await scheduler.runDue(later, [tenantId])).toBe(0);
    const mail = outbox.slice(before).find((m) => m.subject.includes("Karyawan per departemen"))!;
    expect(mail.to).toBe("hr@example.com, direksi@example.com");
    expect(mail.attachments?.[0]?.filename).toMatch(/\.xlsx$/);
    const deliveries = (await a.get(`/report-schedules/${schedule.id}/deliveries`).expect(200)).body;
    expect(deliveries).toEqual([expect.objectContaining({ status: "sent", rows: 4, manual: false })]);
    expect((await a.post(`/report-schedules/${schedule.id}/send-now`).expect(200)).body).toMatchObject({
      status: "sent",
    });

    // Laporan milik Sari; hak hr.read dicabut → pengiriman berikutnya gagal & tercatat, tanpa email.
    const own = (
      await sari
        .post("/saved-reports", {
          name: "Daftar karyawan",
          dataset: "employees",
          config: { columns: ["name"] },
        })
        .expect(201)
    ).body.id;
    const sched = (
      await sari
        .post(`/saved-reports/${own}/schedules`, {
          frequency: "daily",
          hour: 6,
          recipients: ["sari@example.com"],
        })
        .expect(201)
    ).body;
    await app
      .get(TenantDb)
      .runAs(tenantId, (tx) => tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, sariId)));
    const count = outbox.length;
    await scheduler.runDue(new Date(Date.now() + 4 * DAY), [tenantId]);
    expect(outbox.slice(count).some((m) => m.to === "sari@example.com")).toBe(false);
    const failed = await app
      .get(TenantDb)
      .runAs(tenantId, (tx) =>
        tx.select().from(schema.reportDeliveries).where(eq(schema.reportDeliveries.scheduleId, sched.id)),
      );
    expect(failed).toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringMatching(/hr\.read/) }),
    ]);
  });
});
