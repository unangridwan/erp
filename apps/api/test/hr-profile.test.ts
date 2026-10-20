import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
// PNG 1×1 piksel.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF = Buffer.from("%PDF-1.4\n%sk\n").toString("base64");

describe.skipIf(!hasDb)("HR: profil karyawan lengkap", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let companyId: string;
  let dewi: string;
  let budi: string;
  let staff: string;
  let spv: string;
  let dewiApi: Api;
  let viewerApi: Api;

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
    a = await signup(app, "prof");
    const me = (await a.get("/auth/me")).body;
    companyId = me.activeCompanyId;
    const [portal, viewer] = await app.get(TenantDb).runAs(me.tenantId, async (tx) => {
      const roles = await tx
        .insert(schema.roles)
        .values([
          { code: "portal", name: "Portal" },
          { code: "hrview", name: "HR viewer" },
        ])
        .returning({ id: schema.roles.id });
      await tx.insert(schema.rolePermissions).values({ roleId: roles[1]!.id, permission: "hr.read" });
      return roles;
    });
    const user = async (name: string, email: string, roleId: string) =>
      (
        await a
          .post("/users", { name, email, password: "rahasia123", roleIds: [roleId], companyIds: [companyId] })
          .expect(201)
      ).body.id as string;
    staff = (await a.post("/job-positions", { name: "Staf" }).expect(201)).body.id;
    spv = (await a.post("/job-positions", { name: "Supervisor" }).expect(201)).body.id;
    budi = (await a.post("/employees", { name: "Budi", joinDate: "2020-01-01" }).expect(201)).body.id;
    dewi = (
      await a
        .post("/employees", {
          name: "Dewi",
          jobId: staff,
          joinDate: "2024-01-01",
          gender: "male",
          maritalStatus: "married",
          ptkpStatus: "TK/0",
          kkNo: "3201.0101.0101.0001",
          bloodType: "O",
          rhesus: "+",
          religion: "islam",
          birthPlace: "Bandung",
          userId: await user("Dewi", "dewi@example.com", portal!.id),
        })
        .expect(201)
    ).body.id;
    await user("Vina", "vina@example.com", viewer!.id);
    dewiApi = await login("dewi@example.com");
    viewerApi = await login("vina@example.com");
  });
  afterAll(() => app?.close());

  it("biodata tambahan & no. KK terenkripsi (tersamar untuk non-hr.manage)", async () => {
    const full = (await a.get(`/employees/${dewi}`).expect(200)).body;
    expect(full).toMatchObject({ kkNo: "3201010101010001", bloodType: "O", rhesus: "+", nationality: "WNI" });
    expect(full).not.toHaveProperty("kkNoEnc");
    expect((await viewerApi.get(`/employees/${dewi}`).expect(200)).body.kkNo).toBe("••••0001");
    await a.patch(`/employees/${dewi}`, { bloodType: "Z" }).expect(400);
    await a.patch(`/employees/${dewi}`, { heightCm: 170, weightKg: 65 }).expect(200);
    const list = (await a.get("/employees").expect(200)).body.items;
    expect(list.find((e: { id: string }) => e.id === dewi)).not.toHaveProperty("kkNoEnc");
  });

  it("foto karyawan: tipe & tanda tangan berkas divalidasi, ETag, portal ganti foto sendiri", async () => {
    await a.put(`/employees/${dewi}/photo`, { type: "application/pdf", data: PDF }).expect(400);
    await a.put(`/employees/${dewi}/photo`, { type: "image/jpeg", data: PNG }).expect(400); // bukan JPEG
    // Batas 1 MB diuji di unit test skema (body parser test bawaan lebih kecil).
    await a.get(`/employees/${dewi}/photo`).expect(404);
    await a.put(`/employees/${dewi}/photo`, { type: "image/png", data: PNG }).expect(200);
    const res = await viewerApi.get(`/employees/${dewi}/photo`).expect(200);
    expect(res.headers["content-type"]).toContain("image/png");
    await viewerApi.get(`/employees/${dewi}/photo`).set("If-None-Match", res.headers.etag!).expect(304);
    await viewerApi.put(`/employees/${dewi}/photo`, { type: "image/png", data: PNG }).expect(403);
    const list = (await a.get("/employees").expect(200)).body.items;
    expect(list.find((e: { id: string }) => e.id === dewi).hasPhoto).toBe(true);
    await dewiApi.put("/me/photo", { type: "image/png", data: PNG }).expect(200);
    await dewiApi.get("/me/photo").expect(200);
    await dewiApi.get(`/employees/${budi}/photo`).expect(403);
  });

  it("keluarga (NIK terenkripsi), pendidikan, pengalaman & ringkasan profil (saran PTKP)", async () => {
    const spouse = (
      await a
        .post(`/employees/${dewi}/family`, { relation: "spouse", name: "Rina", nik: "3201010101010002" })
        .expect(201)
    ).body;
    expect(spouse.nik).toBe("3201010101010002");
    expect(spouse).not.toHaveProperty("nikEnc");
    for (const name of ["Anak 1", "Anak 2"])
      await a.post(`/employees/${dewi}/family`, { relation: "child", name, dependent: true }).expect(201);
    await viewerApi.post(`/employees/${dewi}/family`, { relation: "child", name: "X" }).expect(403);
    const viewed = (await viewerApi.get(`/employees/${dewi}/family`).expect(200)).body;
    expect(viewed).toHaveLength(3);
    expect(viewed[0].nik).toBe("••••0002");
    // Nilai tersamar dikirim balik = tidak diubah.
    await a
      .put(`/employees/${dewi}/family/${spouse.id}`, { relation: "spouse", name: "Rina S", nik: "••••0002" })
      .expect(200);
    expect((await a.get(`/employees/${dewi}/family`).expect(200)).body[0]).toMatchObject({
      name: "Rina S",
      nik: "3201010101010002",
    });

    const ijazah = (
      await a
        .post("/hr-documents", {
          employeeId: dewi,
          kind: "ijazah",
          name: "Ijazah S1",
          file: { name: "s1.pdf", type: "application/pdf", data: PDF },
        })
        .expect(201)
    ).body;
    const other = (await a.post("/employees", { name: "Lain", joinDate: "2024-01-01" }).expect(201)).body.id;
    const otherDoc = (
      await a
        .post("/hr-documents", {
          employeeId: other,
          kind: "ktp",
          number: "3201",
          name: "KTP",
          file: { name: "k.png", type: "image/png", data: PNG },
        })
        .expect(201)
    ).body;
    await a
      .post(`/employees/${dewi}/education`, { level: "s1", institution: "ITB", documentId: otherDoc.id })
      .expect(400);
    await a
      .post(`/employees/${dewi}/education`, {
        level: "s1",
        institution: "ITB",
        yearStart: 2015,
        yearEnd: 2010,
      })
      .expect(400);
    await a
      .post(`/employees/${dewi}/education`, {
        level: "s1",
        institution: "ITB",
        major: "Informatika",
        yearStart: 2015,
        yearEnd: 2019,
        gpa: 3.5,
        documentId: ijazah.id,
      })
      .expect(201);
    await a
      .post(`/employees/${dewi}/education`, { level: "sma", institution: "SMAN 1", yearEnd: 2015 })
      .expect(201);
    expect((await a.get(`/employees/${dewi}/education`).expect(200)).body[0]).toMatchObject({
      level: "s1",
      documentName: "Ijazah S1",
    });
    await a
      .post(`/employees/${dewi}/experiences`, {
        company: "PT Lama",
        position: "Staf",
        dateStart: "2019-08-01",
        dateEnd: "2023-12-31",
      })
      .expect(201);

    const docs = (await a.get(`/hr-documents?employeeId=${other}`).expect(200)).body;
    expect(docs[0]).toMatchObject({ kind: "ktp", number: "3201" });
    const inline = await a.get(`/hr-documents/${otherDoc.id}/file?inline=1`).expect(200);
    expect(inline.headers["content-disposition"]).toBe("inline");

    const summary = (await a.get(`/employees/${dewi}/profile-summary`).expect(200)).body;
    expect(summary).toMatchObject({
      hasPhoto: true,
      suggestedPtkp: "K/2",
      ptkpMismatch: true,
      highestEducation: { level: "s1" },
    });
    expect(summary.completeness.missing).toContain("doc:ktp");
    expect(summary.completeness.missing).not.toContain("family");
    expect(summary.completeness.missing).not.toContain("kkNo");
  });

  it("promosi dengan upah baru: kontrak lama diakhiri, kontrak baru berjalan, riwayat karir", async () => {
    const comp = (
      await a.post("/salary-components", {
        code: "TJPROMO",
        name: "Tunjangan jabatan",
        kind: "allowance",
        fixed: true,
      })
    ).body;
    const contract = (
      await a
        .post("/contracts", {
          employeeId: dewi,
          wage: "6000000",
          dateStart: "2024-01-01",
          allowances: [{ componentId: comp.id, amount: "500000" }],
        })
        .expect(201)
    ).body;
    await a.post(`/contracts/${contract.id}/start`).expect(200);

    await a
      .post("/employee-movements", { employeeId: dewi, kind: "promotion", effectiveDate: "2026-01-01" })
      .expect(400);
    await a
      .post("/employee-movements", {
        employeeId: dewi,
        kind: "promotion",
        effectiveDate: "2026-01-01",
        toManagerId: dewi,
      })
      .expect(400);
    const sk = (
      await a
        .post("/hr-documents", {
          employeeId: dewi,
          kind: "decree",
          name: "SK Promosi",
          file: { name: "sk.pdf", type: "application/pdf", data: PDF },
        })
        .expect(201)
    ).body;
    const move = (
      await a
        .post("/employee-movements", {
          employeeId: dewi,
          kind: "promotion",
          decreeNo: "001/SK/2026",
          effectiveDate: "2026-01-01",
          toJobId: spv,
          toManagerId: budi,
          newWage: "8000000",
          reason: "Kinerja A",
          documentId: sk.id,
        })
        .expect(201)
    ).body;
    expect(move.state).toBe("draft");
    await viewerApi.post(`/employee-movements/${move.id}/apply`).expect(403);
    const applied = (await a.post(`/employee-movements/${move.id}/apply`).expect(200)).body;
    expect(applied).toMatchObject({ state: "done", fromJobId: staff, oldWage: "6000000.00" });
    expect(applied.names).toMatchObject({ fromJobId: "Staf", toJobId: "Supervisor", toManagerId: "Budi" });
    await a.post(`/employee-movements/${move.id}/apply`).expect(400);
    await a
      .put(`/employee-movements/${move.id}`, {
        employeeId: dewi,
        kind: "promotion",
        effectiveDate: "2026-01-01",
        toJobId: staff,
      })
      .expect(400);

    expect((await a.get(`/employees/${dewi}`).expect(200)).body).toMatchObject({
      jobId: spv,
      managerId: budi,
    });
    const contracts = (await a.get(`/contracts?employeeId=${dewi}`).expect(200)).body.items;
    expect(contracts.find((c: { id: string }) => c.id === contract.id)).toMatchObject({
      state: "closed",
      dateEnd: "2025-12-31",
    });
    const fresh = contracts.find((c: { state: string }) => c.state === "running");
    expect(fresh).toMatchObject({ dateStart: "2026-01-01", wage: "8000000.00" });
    expect((await a.get(`/contracts/${fresh.id}`).expect(200)).body.allowances).toHaveLength(1);

    const history = (await a.get(`/employees/${dewi}/history`).expect(200)).body.history;
    expect(history.find((h: { kind: string }) => h.kind === "promotion")).toMatchObject({
      date: "2026-01-01",
      oldValue: "Staf",
      newValue: "Supervisor, Budi",
      note: "SK 001/SK/2026 — Kinerja A",
    });
    expect(
      history.find((h: { kind: string; date: string }) => h.kind === "wage" && h.date === "2026-01-01"),
    ).toMatchObject({
      oldValue: "6000000",
      newValue: "8000000",
    });
  });

  it("demosi tanpa perubahan upah & mutasi dibatalkan", async () => {
    const demotion = (
      await a
        .post("/employee-movements", {
          employeeId: dewi,
          kind: "demotion",
          effectiveDate: "2026-06-01",
          toJobId: staff,
        })
        .expect(201)
    ).body;
    await a.post(`/employee-movements/${demotion.id}/apply`).expect(200);
    const running = (await a.get(`/contracts?employeeId=${dewi}&state=running`).expect(200)).body.items;
    expect(running).toHaveLength(1);
    expect(running[0].wage).toBe("8000000.00");
    const transfer = (
      await a
        .post("/employee-movements", {
          employeeId: dewi,
          kind: "transfer",
          effectiveDate: "2026-07-01",
          toJobId: spv,
        })
        .expect(201)
    ).body;
    await a.post(`/employee-movements/${transfer.id}/cancel`).expect(200);
    await a.post(`/employee-movements/${transfer.id}/apply`).expect(400);
    // Tanpa perubahan nyata ditolak.
    const noop = (
      await a
        .post("/employee-movements", {
          employeeId: dewi,
          kind: "rotation",
          effectiveDate: "2026-07-01",
          toJobId: staff,
        })
        .expect(201)
    ).body;
    await a.post(`/employee-movements/${noop.id}/apply`).expect(400);
    const list = (await a.get(`/employee-movements?employeeId=${dewi}`).expect(200)).body;
    expect(list.map((m: { state: string }) => m.state).sort()).toEqual(["cancel", "done", "done", "draft"]);
  });

  it("surat peringatan: masa berlaku 6 bulan, riwayat, pengingat, portal", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await a
      .post("/employee-warnings", {
        employeeId: dewi,
        level: "sp1",
        date: today,
        validUntil: "2000-01-01",
        reason: "x",
      })
      .expect(400);
    await viewerApi.get("/employee-warnings").expect(403);
    const sp = (
      await a
        .post("/employee-warnings", {
          employeeId: dewi,
          level: "sp1",
          decreeNo: "SP/01",
          date: "2026-01-15",
          reason: "Mangkir 3 hari",
        })
        .expect(201)
    ).body;
    expect(sp.validUntil).toBe("2026-07-14");
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await a
      .post("/employee-warnings", {
        employeeId: dewi,
        level: "sp2",
        date: today,
        validUntil: soon,
        reason: "Terlambat",
      })
      .expect(201);
    const reminders = (await a.get("/hr/reminders").expect(200)).body;
    expect(reminders.warnings.map((w: { level: string }) => w.level)).toContain("sp2");
    const summary = (await a.get(`/employees/${dewi}/profile-summary`).expect(200)).body;
    expect(summary.activeWarnings.map((w: { level: string }) => w.level)).toContain("sp2");
    const history = (await a.get(`/employees/${dewi}/history`).expect(200)).body.history;
    expect(
      history
        .filter((h: { kind: string }) => h.kind === "warning")
        .map((h: { newValue: string }) => h.newValue),
    ).toEqual(expect.arrayContaining(["SP1", "SP2"]));

    const mine = (await dewiApi.get("/me/profile").expect(200)).body;
    expect(mine.family).toHaveLength(3);
    expect(mine.family[0].nik).toBe("••••0002");
    expect(mine.education).toHaveLength(2);
    expect(mine.experiences).toHaveLength(1);
    expect(mine.warnings).toHaveLength(2);
    expect(mine.hasPhoto).toBe(true);
  });

  it("portal: ajukan perubahan biodata baru (golongan darah, status nikah, kontak pribadi)", async () => {
    await dewiApi.post("/me/change-requests", { bloodType: "Z" }).expect(400);
    const req = (
      await dewiApi
        .post("/me/change-requests", { bloodType: "A", personalPhone: "0812", maritalStatus: "married" })
        .expect(201)
    ).body;
    await a.post(`/employee-change-requests/${req.id}/approve`).expect(200);
    expect((await a.get(`/employees/${dewi}`).expect(200)).body).toMatchObject({
      bloodType: "A",
      personalPhone: "0812",
    });
  });
});
