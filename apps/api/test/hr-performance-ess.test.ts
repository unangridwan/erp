import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface User {
  id: string;
  api: Api;
}

/** Sasaran bertingkat, feedback 360, catatan atasan, pengumuman, Who's Off, notifikasi in-app. */
describe.skipIf(!hasDb)("Kinerja lanjutan & layanan mandiri", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let adminId: string;
  let budi: User; // atasan
  let dewi: User; // staf, bawahan Budi
  let eko: User; // rekan, tanpa departemen
  let dewiEmp: string;
  let dept: string;
  let companyGoal: string;
  let dewiGoal: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "pfe");
    const me = (await a.get("/auth/me")).body;
    adminId = me.userId;
    const [role] = await app
      .get(TenantDb)
      .runAs(me.tenantId, (tx) =>
        tx
          .insert(schema.roles)
          .values({ code: "karyawan", name: "Karyawan" })
          .returning({ id: schema.roles.id }),
      );
    const user = async (name: string, email: string): Promise<User> => {
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
    budi = await user("Budi Manajer", "budi@example.com");
    dewi = await user("Dewi Staf", "dewi@example.com");
    eko = await user("Eko Rekan", "eko@example.com");
    dept = (await a.post("/departments", { name: "Penjualan" }).expect(201)).body.id;
    const budiEmp = (
      await a
        .post("/employees", {
          name: "Budi Manajer",
          userId: budi.id,
          joinDate: "2020-01-01",
          departmentId: dept,
        })
        .expect(201)
    ).body.id;
    dewiEmp = (
      await a
        .post("/employees", {
          name: "Dewi Staf",
          userId: dewi.id,
          managerId: budiEmp,
          joinDate: "2024-01-01",
          departmentId: dept,
        })
        .expect(201)
    ).body.id;
    await a.post("/employees", { name: "Eko Rekan", userId: eko.id, joinDate: "2024-01-01" }).expect(201);
  });
  afterAll(() => app?.close());

  it("sasaran bertingkat: hak akses, check-in, progres induk dari anak", async () => {
    companyGoal = (
      await a
        .post("/goals", { title: "Omzet 2026 Rp 12 M", metric: "currency", targetValue: 12_000_000_000 })
        .expect(201)
    ).body.id;
    await dewi.api.post("/goals", { title: "Sasaran perusahaan", targetValue: 10 }).expect(403);
    await a.post("/goals", { title: "x", startValue: 5, targetValue: 5 }).expect(400);
    // Atasan menurunkan sasaran ke bawahan; karyawan menambah sasaran turunan sendiri.
    dewiGoal = (
      await budi.api
        .post("/goals", {
          parentId: companyGoal,
          employeeId: dewiEmp,
          title: "Penjualan Dewi Rp 1 M",
          metric: "currency",
          targetValue: 1_000_000_000,
          weight: 2,
        })
        .expect(201)
    ).body.id;
    const sub = (
      await dewi.api
        .post("/goals", {
          parentId: dewiGoal,
          employeeId: dewiEmp,
          title: "20 pelanggan baru",
          metric: "number",
          targetValue: 20,
        })
        .expect(201)
    ).body.id;
    await eko.api.post(`/goals/${sub}/checkins`, { value: 5 }).expect(403);
    await dewi.api.post(`/goals/${sub}/checkins`, { value: 10, note: "Pameran Oktober" }).expect(201);
    await dewi.api.delete(`/goals/${dewiGoal}`).expect(403); // ditetapkan atasan
    await a
      .put(`/goals/${dewiGoal}`, { parentId: sub, employeeId: dewiEmp, title: "siklus", targetValue: 1 })
      .expect(400);

    const mine = (await dewi.api.get("/me/goals").expect(200)).body as { id: string; progress: number }[];
    expect(mine.find((g) => g.id === sub)?.progress).toBe(50);
    expect(mine.find((g) => g.id === dewiGoal)?.progress).toBe(50); // dari anak
    const all = (await a.get("/goals").expect(200)).body as { id: string; progress: number }[];
    expect(all.find((g) => g.id === companyGoal)?.progress).toBe(50);
    // Rekan tanpa relasi hanya melihat sasaran perusahaan.
    const ekoGoals = (await eko.api.get("/goals").expect(200)).body as { id: string }[];
    expect(ekoGoals.map((g) => g.id)).toEqual([companyGoal]);
    expect((await dewi.api.get(`/goals/${sub}/checkins`).expect(200)).body[0]).toMatchObject({
      value: "10.00",
      note: "Pameran Oktober",
    });
  });

  it("feedback 360: atasan meminta, penilai mengisi, ringkasan anonim", async () => {
    await dewi.api
      .post("/feedback-requests", { subjectEmployeeId: dewiEmp, reviewerUserIds: [eko.id], relation: "peer" })
      .expect(403);
    expect(
      (
        await budi.api
          .post("/feedback-requests", {
            subjectEmployeeId: dewiEmp,
            reviewerUserIds: [eko.id, adminId],
            relation: "peer",
            dueDate: "2026-12-01",
          })
          .expect(201)
      ).body,
    ).toEqual({ created: 2 });
    const req = (await eko.api.get("/me/feedback-requests").expect(200)).body[0];
    expect(req).toMatchObject({ subjectName: "Dewi Staf", state: "pending" });
    await eko.api.put(`/feedback-requests/${req.id}`, { scores: { charm: 5 } }).expect(400);
    await eko.api
      .put(`/feedback-requests/${req.id}`, {
        scores: { communication: 4, teamwork: 5 },
        strengths: "Ramah ke pelanggan",
        improvements: "Laporan tepat waktu",
      })
      .expect(200);
    await eko.api.put(`/feedback-requests/${req.id}`, { scores: { communication: 4 } }).expect(400);
    const adminReq = (await a.get("/me/feedback-requests").expect(200)).body[0];
    await a.post(`/feedback-requests/${adminReq.id}/decline`).expect(200);

    await eko.api.get(`/employees/${dewiEmp}/feedback-summary`).expect(403);
    const s = (await dewi.api.get(`/employees/${dewiEmp}/feedback-summary`).expect(200)).body;
    expect(s).toMatchObject({ responses: 1, pending: 0, strengths: ["Ramah ke pelanggan"] });
    // Satu respons rekan digabung ke "other" agar penilai tidak teridentifikasi.
    expect(s.competencies.find((c: { key: string }) => c.key === "communication")).toMatchObject({
      average: 4,
      byRelation: { other: 4 },
    });
    expect(JSON.stringify(s)).not.toContain("Eko");
    const status = (await budi.api.get(`/feedback-requests?subjectEmployeeId=${dewiEmp}`).expect(200)).body;
    expect(status.map((x: { state: string }) => x.state).sort()).toEqual(["declined", "submitted"]);
  });

  it("catatan atasan: privat vs terlihat HR; karyawan tidak bisa melihat", async () => {
    await budi.api.post(`/employees/${dewiEmp}/notes`, { body: "1-on-1: target Q4 dibahas" }).expect(201);
    await budi.api
      .post(`/employees/${dewiEmp}/notes`, { body: "Perlu pelatihan negosiasi", visibility: "hr" })
      .expect(201);
    expect((await budi.api.get(`/employees/${dewiEmp}/notes`).expect(200)).body).toHaveLength(2);
    const hr = (await a.get(`/employees/${dewiEmp}/notes`).expect(200)).body;
    expect(hr.map((n: { body: string }) => n.body)).toEqual(["Perlu pelatihan negosiasi"]);
    await dewi.api.get(`/employees/${dewiEmp}/notes`).expect(403);
    await eko.api.post(`/employees/${dewiEmp}/notes`, { body: "x" }).expect(403);
    await a.delete(`/employee-notes/${hr[0].id}`).expect(404); // hanya penulis
  });

  it("pengumuman: audiens per departemen, draft tidak tampil, tanda dibaca", async () => {
    await dewi.api.post("/announcements", { title: "x", body: "x" }).expect(403);
    await a
      .post("/announcements", {
        title: "Libur cuti bersama",
        body: "24–26 Desember kantor tutup.",
        pinned: true,
        publish: true,
      })
      .expect(201);
    await a
      .post("/announcements", {
        title: "Target tim penjualan",
        body: "Rapat Senin.",
        departmentId: dept,
        publish: true,
      })
      .expect(201);
    await a.post("/announcements", { title: "Draft", body: "Belum terbit" }).expect(201);
    const forDewi = (await dewi.api.get("/me/announcements").expect(200)).body;
    expect(forDewi.map((x: { title: string }) => x.title)).toEqual([
      "Libur cuti bersama",
      "Target tim penjualan",
    ]);
    expect((await eko.api.get("/me/announcements").expect(200)).body).toHaveLength(1);
    await dewi.api.post(`/me/announcements/${forDewi[0].id}/read`).expect(200);
    expect((await dewi.api.get("/me/announcements").expect(200)).body[0].readAt).toBeTruthy();
    const list = (await a.get("/announcements").expect(200)).body;
    expect(list.find((x: { title: string }) => x.title === "Libur cuti bersama").reads).toBe(1);
  });

  it("notifikasi cuti & Who's Off: penyetuju diberi tahu, keputusan ke karyawan, jenis cuti hanya untuk HR", async () => {
    const types = (await a.get("/leave-types").expect(200)).body.items as { id: string; name: string }[];
    const annual = types.find((t) => t.name === "Cuti tahunan")!.id;
    await a
      .post("/leave-allocations", {
        employeeId: dewiEmp,
        leaveTypeId: annual,
        days: "12",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
      })
      .expect(201);
    const leave = (
      await dewi.api
        .post("/leaves", { leaveTypeId: annual, dateFrom: "2026-11-02", dateTo: "2026-11-03" })
        .expect(201)
    ).body;
    const pending = (await budi.api.get("/me/notifications?unread=1").expect(200)).body;
    expect(pending[0]).toMatchObject({ kind: "approval.pending", link: "/hr/approvals" });
    expect(pending[0].title).toContain("Dewi Staf");
    await budi.api.post(`/leaves/${leave.id}/approve`).expect(200);
    const dewiN = (await dewi.api.get("/me/notifications").expect(200)).body;
    expect(dewiN.map((n: { kind: string }) => n.kind)).toContain("approval.approved");
    expect((await dewi.api.get("/me/notifications/count").expect(200)).body.unread).toBeGreaterThan(0);
    await dewi.api.post("/me/notifications/read-all").expect(200);
    expect((await dewi.api.get("/me/notifications/count").expect(200)).body.unread).toBe(0);
    // Eko mendapat permintaan feedback sebelumnya.
    expect(
      (await eko.api.get("/me/notifications").expect(200)).body.map((n: { kind: string }) => n.kind),
    ).toContain("feedback.request");

    const off = (await eko.api.get("/me/whos-off?from=2026-11-01&to=2026-11-07").expect(200)).body;
    expect(off.items).toEqual([
      expect.objectContaining({ employeeName: "Dewi Staf", departmentName: "Penjualan", leaveType: null }),
    ]);
    const offHr = (await a.get("/me/whos-off?from=2026-11-01&to=2026-11-07").expect(200)).body;
    expect(offHr.items[0].leaveType).toBe("Cuti tahunan");
    await a.get("/me/whos-off?from=2026-01-01&to=2026-12-31").expect(400);
  });

  it("permintaan persetujuan: penyetuju tahap berjalan & pemohon diberi tahu", async () => {
    const cats = (await dewi.api.get("/approval-categories?active=1").expect(200)).body as {
      id: string;
      code: string;
    }[];
    const umum = cats.find((c) => c.code === "UMUM")!.id;
    const r = (
      await dewi.api
        .post("/approval-requests", { categoryId: umum, subject: "Kursus Excel", description: "Pelatihan" })
        .expect(201)
    ).body;
    await dewi.api.post(`/approval-requests/${r.id}/submit`).expect(200);
    const n = (await budi.api.get("/me/notifications?unread=1").expect(200)).body;
    expect(n[0]).toMatchObject({
      kind: "approval.pending",
      link: `/hr/approval-requests/${r.id}`,
      body: "Kursus Excel",
    });
  });
});
