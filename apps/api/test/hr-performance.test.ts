import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
const PDF = Buffer.from("%PDF-1.4\n%sertifikat\n").toString("base64");
const year = new Date().getUTCFullYear();

describe.skipIf(!hasDb)("HR: penilaian kinerja, pelatihan, riwayat karir, org chart, dashboard", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let companyId: string;
  let budi: string;
  let dewi: string;
  let eko: string;
  let job: string;
  let budiApi: Api;
  let dewiApi: Api;
  let cycle: string;
  const appraisal: Record<string, { id: string; lines: { id: string; name: string }[] }> = {};

  const login = async (email: string) =>
    client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email, password: "rahasia123" })
          .expect(200)
      ).body.token,
    );

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "perf");
    const me = (await a.get("/auth/me")).body;
    companyId = me.activeCompanyId;
    const [role] = await app
      .get(TenantDb)
      .runAs(me.tenantId, (tx) =>
        tx.insert(schema.roles).values({ code: "portal", name: "Portal" }).returning({ id: schema.roles.id }),
      );
    const user = async (name: string, email: string) =>
      (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [role!.id],
            companyIds: [companyId],
          })
          .expect(201)
      ).body.id as string;
    job = (await a.post("/job-positions", { name: "Staf" }).expect(201)).body.id;
    budi = (
      await a
        .post("/employees", {
          name: "Budi Manajer",
          userId: await user("Budi", "budi@example.com"),
          joinDate: `${year}-01-02`,
        })
        .expect(201)
    ).body.id;
    dewi = (
      await a
        .post("/employees", {
          name: "Dewi Staf",
          userId: await user("Dewi", "dewi@example.com"),
          managerId: budi,
          jobId: job,
          joinDate: `${year}-01-05`,
          gender: "female",
        })
        .expect(201)
    ).body.id;
    eko = (await a.post("/employees", { name: "Eko Lapangan", joinDate: "2020-03-01" }).expect(201)).body.id;
    budiApi = await login("budi@example.com");
    dewiApi = await login("dewi@example.com");
  });
  afterAll(() => app?.close());

  it("template KPI per jabatan & siklus penilaian (template umum/bawaan untuk yang lain)", async () => {
    await a.post("/appraisal-templates", { name: "KPI Staf", jobId: job, items: [] }).expect(400);
    await a
      .post("/appraisal-templates", {
        name: "KPI Staf",
        jobId: job,
        items: [
          { name: "Ketepatan laporan", weight: 60 },
          { name: "Kerja sama", weight: 40 },
        ],
      })
      .expect(201);
    await a
      .post("/appraisal-cycles", { name: "Kinerja", dateStart: `${year}-12-31`, dateEnd: `${year}-01-01` })
      .expect(400);
    cycle = (
      await a
        .post("/appraisal-cycles", {
          name: `Kinerja ${year}`,
          dateStart: `${year}-01-01`,
          dateEnd: `${year}-12-31`,
        })
        .expect(201)
    ).body.id;
    expect((await a.post(`/appraisal-cycles/${cycle}/start`).expect(200)).body).toEqual({ created: 3 });
    expect((await a.post(`/appraisal-cycles/${cycle}/start`).expect(200)).body).toEqual({ created: 0 }); // idempoten
    const list = (await a.get(`/appraisals?cycleId=${cycle}`).expect(200)).body;
    for (const row of list)
      appraisal[row.employeeName] = (await a.get(`/appraisals/${row.id}`).expect(200)).body;
    expect(appraisal["Dewi Staf"]!.lines.map((l) => l.name)).toEqual(["Ketepatan laporan", "Kerja sama"]);
    expect(appraisal["Eko Lapangan"]!.lines).toHaveLength(4); // KPI bawaan
    expect(list.find((r: { employeeName: string }) => r.employeeName === "Dewi Staf")).toMatchObject({
      state: "self",
      managerName: "Budi",
    });
  });

  it("penilaian diri → atasan → kalibrasi HR (skor tertimbang, predikat, usulan kenaikan)", async () => {
    const d = appraisal["Dewi Staf"]!;
    const [l1, l2] = d.lines as [{ id: string }, { id: string }];
    await budiApi.put(`/appraisals/${d.id}/self`, { lines: [{ id: l1.id, score: 4 }] }).expect(403);
    await dewiApi.put(`/appraisals/${d.id}/self`, { lines: [{ id: l1.id, score: 4 }] }).expect(400);
    await dewiApi
      .put(`/appraisals/${d.id}/self`, {
        lines: [
          { id: l1.id, score: 6 },
          { id: l2.id, score: 5 },
        ],
      })
      .expect(400);
    const self = (
      await dewiApi
        .put(`/appraisals/${d.id}/self`, {
          lines: [
            { id: l1.id, score: 4 },
            { id: l2.id, score: 5, comment: "Membantu tim audit" },
          ],
          comment: "Target tercapai",
        })
        .expect(200)
    ).body;
    expect(self).toMatchObject({ state: "manager", selfScore: "4.40", employeeComment: "Target tercapai" });
    await dewiApi
      .put(`/appraisals/${d.id}/manager`, {
        lines: [
          { id: l1.id, score: 5 },
          { id: l2.id, score: 5 },
        ],
      })
      .expect(403);

    const mine = (await budiApi.get("/me/appraisals").expect(200)).body;
    expect(mine.map((r: { employeeName: string; role: string }) => [r.employeeName, r.role]).sort()).toEqual([
      ["Budi Manajer", "self"],
      ["Dewi Staf", "manager"],
    ]);
    await budiApi.get(`/appraisals/${appraisal["Eko Lapangan"]!.id}`).expect(403);
    const mgr = (
      await budiApi
        .put(`/appraisals/${d.id}/manager`, {
          lines: [
            { id: l1.id, score: 4 },
            { id: l2.id, score: 4 },
          ],
          comment: "Baik",
        })
        .expect(200)
    ).body;
    expect(mgr).toMatchObject({ state: "calibration", managerScore: "4.00" });
    await budiApi.post(`/appraisals/${d.id}/calibrate`).expect(403);
    expect((await a.post(`/appraisals/${d.id}/calibrate`, {}).expect(200)).body).toMatchObject({
      state: "done",
      finalScore: "4.00",
      rating: "B",
      raisePercent: "7.00",
    });
    await a.post(`/appraisal-cycles/${cycle}/close`).expect(400);

    // Eko tanpa akun & atasan: HR menilai langsung lalu kalibrasi dengan predikat khusus.
    const e = appraisal["Eko Lapangan"]!;
    await a
      .put(`/appraisals/${e.id}/manager`, { lines: e.lines.map((l) => ({ id: l.id, score: 5 })) })
      .expect(200);
    expect(
      (
        await a
          .post(`/appraisals/${e.id}/calibrate`, { rating: "A", raisePercent: 12, comment: "Teladan" })
          .expect(200)
      ).body,
    ).toMatchObject({ finalScore: "5.00", rating: "A", raisePercent: "12.00" });
    // Budi tanpa atasan ber-akun: penilaian diri langsung ke kalibrasi.
    const b = appraisal["Budi Manajer"]!;
    expect(
      (
        await budiApi
          .put(`/appraisals/${b.id}/self`, { lines: b.lines.map((l) => ({ id: l.id, score: 3 })) })
          .expect(200)
      ).body.state,
    ).toBe("calibration");
    expect((await a.post(`/appraisals/${b.id}/calibrate`).expect(200)).body).toMatchObject({
      finalScore: "3.00",
      rating: "C",
    });
    expect((await a.post(`/appraisal-cycles/${cycle}/close`).expect(200)).body.state).toBe("closed");
    await a.post(`/appraisal-cycles/${cycle}/start`).expect(400);
  });

  it("riwayat karir otomatis: masuk, mutasi departemen, ganti jabatan, kenaikan upah", async () => {
    const dept = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;
    const senior = (await a.post("/job-positions", { name: "Staf Senior" }).expect(201)).body.id;
    await a.patch(`/employees/${dewi}`, { departmentId: dept, jobId: senior }).expect(200);
    const c1 = (
      await a
        .post("/contracts", { employeeId: dewi, wage: "6000000", dateStart: `${year}-01-05` })
        .expect(201)
    ).body;
    await a.post(`/contracts/${c1.id}/start`).expect(200);
    await a.post(`/contracts/${c1.id}/close`, { dateEnd: `${year}-06-30` }).expect(200);
    const c2 = (
      await a
        .post("/contracts", { employeeId: dewi, wage: "6600000", dateStart: `${year}-07-01` })
        .expect(201)
    ).body;
    await a.post(`/contracts/${c2.id}/start`).expect(200);

    const h = (await a.get(`/employees/${dewi}/history`).expect(200)).body;
    const kinds = h.history.map((x: { kind: string; oldValue: string | null; newValue: string | null }) => [
      x.kind,
      x.oldValue,
      x.newValue,
    ]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["join", null, `${year}-01-05`],
        ["department", null, "Keuangan"],
        ["job", "Staf", "Staf Senior"],
        ["wage", null, "6000000"],
        ["wage", "6000000", "6600000"],
      ]),
    );
    expect(h.appraisals).toEqual([expect.objectContaining({ rating: "B", finalScore: "4.00" })]);
    await dewiApi.get(`/employees/${dewi}/history`).expect(403);
  });

  it("pelatihan: peserta, hasil, sertifikat menjadi dokumen berkedaluwarsa", async () => {
    await a
      .post("/trainings", { name: "Brevet", dateStart: `${year}-03-10`, dateEnd: `${year}-03-01` })
      .expect(400);
    const t = (
      await a
        .post("/trainings", {
          name: "Brevet Pajak A/B",
          provider: "IKPI",
          dateStart: `${year}-03-01`,
          dateEnd: `${year}-03-10`,
          cost: "4500000",
          certificateValidMonths: 24,
        })
        .expect(201)
    ).body;
    const withPeople = (
      await a.post(`/trainings/${t.id}/participants`, { employeeIds: [dewi, eko] }).expect(200)
    ).body;
    expect(withPeople.participants).toHaveLength(2);
    const pDewi = withPeople.participants.find((p: { employeeId: string }) => p.employeeId === dewi);
    const pEko = withPeople.participants.find((p: { employeeId: string }) => p.employeeId === eko);
    const done = (
      await a
        .put(`/trainings/${t.id}/participants/${pDewi.id}`, {
          state: "completed",
          certificate: { name: "brevet.pdf", type: "application/pdf", data: PDF },
        })
        .expect(200)
    ).body;
    expect(done.participants.find((p: { id: string }) => p.id === pDewi.id)).toMatchObject({
      state: "completed",
      certificateExpiry: `${year + 2}-03-10`,
      certificateDocumentId: expect.any(String),
    });
    await a.put(`/trainings/${t.id}/participants/${pEko.id}`, { state: "absent" }).expect(200);
    const docs = (await a.get(`/hr-documents?employeeId=${dewi}`).expect(200)).body;
    expect(docs).toEqual([
      expect.objectContaining({
        kind: "certificate",
        name: "Sertifikat Brevet Pajak A/B",
        expiryDate: `${year + 2}-03-10`,
      }),
    ]);
    expect((await a.get("/trainings").expect(200)).body[0]).toMatchObject({ participants: 2, completed: 1 });
    const h = (await a.get(`/employees/${dewi}/history`).expect(200)).body;
    expect(h.trainings).toEqual([expect.objectContaining({ name: "Brevet Pajak A/B", state: "completed" })]);
  });

  it("struktur organisasi & dashboard HR", async () => {
    const tree = (await a.get("/hr/org-chart").expect(200)).body;
    const root = tree.find((n: { name: string }) => n.name === "Budi Manajer");
    expect(root.reports.map((r: { name: string }) => r.name)).toEqual(["Dewi Staf"]);
    expect(tree.map((n: { name: string }) => n.name).sort()).toEqual(["Budi Manajer", "Eko Lapangan"]);

    await a.patch(`/employees/${eko}`, { resignDate: `${year}-01-31` }).expect(200);
    const dash = (await a.get(`/hr/dashboard?year=${year}`).expect(200)).body;
    expect(dash).toMatchObject({ year, joins: 2, leavers: 1, trainingCost: "4500000" });
    expect(dash.months).toHaveLength(12);
    expect(dash.months[0]).toMatchObject({ month: `${year}-01`, joins: 2, leaves: 1, headcount: 2 });
    expect(dash.byGender).toEqual(expect.arrayContaining([{ key: "female", count: 1 }]));
    expect(dash.ratings).toEqual([
      { rating: "A", count: 1 },
      { rating: "B", count: 1 },
      { rating: "C", count: 1 },
    ]);
    // Awal tahun 1 (Eko), akhir 2 → rata-rata 1,5; 1 keluar → 66,67%.
    expect(dash.turnover).toBe(66.67);
  });
});
