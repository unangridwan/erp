import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** Proyek, task, & timesheet dari aplikasi terhubung → tampil per karyawan di ERP. */
describe.skipIf(!hasDb)("Integrasi proyek (aplikasi terhubung)", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let svc: ReturnType<typeof client>;
  let rina: string;
  let budi: string;
  let projectId: string;
  const today = new Date().toISOString().slice(0, 10);

  async function connect(name: string, permissions: string[]) {
    const role = (
      await a
        .post("/roles", { code: `r_${Math.random().toString(36).slice(2, 8)}`, name, permissions })
        .expect(201)
    ).body.id;
    const created = (await a.post("/connected-apps", { name, serviceRoleIds: [role] }).expect(201)).body;
    const res = await request(app.getHttpServer())
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "client_credentials",
        client_id: created.clientId,
        client_secret: created.clientSecret,
      })
      .expect(200);
    return client(app, res.body.access_token);
  }

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "proj");
    const adminId = (await a.get("/auth/me")).body.userId;
    rina = (
      await a
        .post("/employees", {
          name: "Rina Proyek",
          joinDate: "2024-01-02",
          workEmail: "rina@example.com",
          userId: adminId,
        })
        .expect(201)
    ).body.id;
    budi = (
      await a
        .post("/employees", { name: "Budi Proyek", joinDate: "2024-01-02", employeeNumber: "EMP-77" })
        .expect(201)
    ).body.id;
    svc = await connect("Aplikasi Proyek", ["project.write", "hr.read"]);
  });
  afterAll(() => app?.close());

  it("proyek: upsert idempoten, anggota lewat email/nomor/id, anggota tak dikenal dilaporkan", async () => {
    const body = {
      name: "Implementasi ERP",
      code: "PRJ-1",
      status: "active",
      startDate: "2026-01-01",
      url: "https://proyek.example.com/p/1",
      manager: { employeeEmail: "RINA@example.com" },
      members: [
        { employeeEmail: "rina@example.com", role: "PM", allocation: 50 },
        { employeeNumber: "EMP-77", role: "Developer", allocation: 100 },
        { employeeEmail: "tidak.ada@example.com" },
      ],
    };
    const first = (await svc.put("/integrations/projects/p-1", body).expect(200)).body;
    expect(first.skipped).toEqual([{ index: 2, reason: "Karyawan tidak ditemukan" }]);
    projectId = first.project.id;
    expect(first.project.managerEmployeeId).toBe(rina);
    const again = (
      await svc
        .put("/integrations/projects/p-1", { ...body, members: [{ employeeId: budi, role: "Lead" }] })
        .expect(200)
    ).body;
    expect(again.project.id).toBe(projectId);
    const detail = (await a.get(`/projects/${projectId}`).expect(200)).body;
    expect(detail.members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ["Budi Proyek", "Lead"],
    ]);
    await svc
      .put("/integrations/projects/p-1", { ...body, startDate: "2026-02-01", endDate: "2026-01-01" })
      .expect(400);
  });

  it("task: penanggung jawab, selesai mengisi closedAt, dibuka lagi mengosongkan; proyek belum ada 404", async () => {
    await svc.put("/integrations/tasks/t-x", { projectExternalId: "tidak-ada", title: "X" }).expect(404);
    const t = (
      await svc
        .put("/integrations/tasks/t-1", {
          projectExternalId: "p-1",
          title: "Migrasi data karyawan",
          assignee: { employeeEmail: "rina@example.com" },
          dueDate: "2026-12-31",
          priority: "high",
        })
        .expect(200)
    ).body.task;
    expect(t).toMatchObject({ assigneeEmployeeId: rina, status: "todo", closedAt: null });
    const done = (
      await svc
        .put("/integrations/tasks/t-2", { projectExternalId: "p-1", title: "Kickoff", status: "done" })
        .expect(200)
    ).body.task;
    expect(done.closedAt).not.toBeNull();
    const reopened = (
      await svc
        .put("/integrations/tasks/t-2", { projectExternalId: "p-1", title: "Kickoff", status: "todo" })
        .expect(200)
    ).body.task;
    expect(reopened.closedAt).toBeNull();
    expect(reopened.id).toBe(done.id);
  });

  it("timesheet batch: baris valid tersimpan, baris salah dilaporkan, kirim ulang memperbarui", async () => {
    const res = (
      await svc
        .post("/integrations/timesheets/batch", {
          entries: [
            {
              externalId: "ts-1",
              projectExternalId: "p-1",
              taskExternalId: "t-1",
              employeeEmail: "rina@example.com",
              date: today,
              hours: 3.5,
            },
            { externalId: "ts-2", projectExternalId: "p-1", employeeNumber: "EMP-77", date: today, hours: 8 },
            { externalId: "ts-3", projectExternalId: "p-1", employeeId: budi, date: today, hours: 30 },
            { externalId: "ts-4", projectExternalId: "nope", employeeId: budi, date: today, hours: 1 },
            {
              externalId: "ts-5",
              projectExternalId: "p-1",
              employeeEmail: "x@example.com",
              date: today,
              hours: 1,
            },
          ],
        })
        .expect(200)
    ).body;
    expect(res.upserted).toBe(2);
    expect(res.errors.map((e: { index: number }) => e.index)).toEqual([2, 3, 4]);
    await svc
      .post("/integrations/timesheets/batch", {
        entries: [{ externalId: "ts-1", projectExternalId: "p-1", employeeId: rina, date: today, hours: 4 }],
      })
      .expect(200);

    const mine = (await a.get(`/employees/${rina}/projects`).expect(200)).body;
    // Rina tidak lagi anggota, tetapi tetap manajer & penanggung jawab task.
    expect(mine.projects).toHaveLength(1);
    expect(mine.projects[0]).toMatchObject({
      name: "Implementasi ERP",
      isManager: true,
      hoursThisMonth: "4.00",
    });
    expect(mine.openTasks.map((t: { title: string }) => t.title)).toEqual(["Migrasi data karyawan"]);
    expect(mine.hoursThisMonth).toBe("4.00");
    const overview = (await a.get(`/employees/${budi}/overview`).expect(200)).body;
    expect(overview).toMatchObject({ projects: 1, projectHoursThisMonth: "8.00" });
    const list = (await a.get("/projects?status=active").expect(200)).body;
    expect(list[0]).toMatchObject({
      name: "Implementasi ERP",
      members: 1,
      openTasks: 2,
      hoursThisMonth: "12.00",
    });
    // Portal: admin tertaut ke Rina.
    expect((await a.get("/me/projects").expect(200)).body.projects).toHaveLength(1);
  });

  it("hanya akun layanan dengan project.write; tiap aplikasi punya ruang externalId sendiri", async () => {
    await a.put("/integrations/projects/p-9", { name: "Admin" }).expect(403);
    const readOnly = await connect("Aplikasi Baca", ["hr.read"]);
    await readOnly.put("/integrations/projects/p-1", { name: "X" }).expect(403);
    const other = await connect("Aplikasi Lain", ["project.write"]);
    const p = (await other.put("/integrations/projects/p-1", { name: "Proyek Lain" }).expect(200)).body
      .project;
    expect(p.id).not.toBe(projectId);
  });

  it("hapus proyek ikut menghapus task & timesheet", async () => {
    await svc.delete("/integrations/projects/p-1").expect(204);
    await a.get(`/projects/${projectId}`).expect(404);
    const mine = (await a.get(`/employees/${rina}/projects`).expect(200)).body;
    expect(mine).toMatchObject({ projects: [], openTasks: [], recentTimesheets: [] });
  });
});
