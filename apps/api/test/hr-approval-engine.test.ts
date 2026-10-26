import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = () => new Date().toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const pdf = {
  name: "nota.pdf",
  type: "application/pdf",
  data: Buffer.from("%PDF-1.4 nota").toString("base64"),
};

interface Step {
  sequence: number;
  approverUserId: string | null;
  label: string | null;
  state: string;
  delegated: boolean;
}

/** Mesin persetujuan generik: kategori & field wajib, DoA, berurutan/paralel, delegasi, self-approval, resign. */
describe.skipIf(!hasDb)("SDM: mesin persetujuan generik", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  type User = { id: string; api: ReturnType<typeof client> };
  let staff: User;
  let manager: User;
  let director: User;
  let holding: User;
  let deputy: User;
  let staffEmp: string;
  const cat: Record<string, { id: string; [k: string]: unknown }> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "apv");
    const me = (await a.get("/auth/me")).body;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
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
    staff = await user("Staf", "staf@example.com");
    manager = await user("Manajer", "mgr@example.com");
    director = await user("Direktur", "dir@example.com");
    holding = await user("Direksi Holding", "holding@example.com");
    deputy = await user("Wakil", "wakil@example.com");
    const mgrEmp = (
      await a
        .post("/employees", { name: "Manajer Unit", userId: manager.id, joinDate: "2020-01-01" })
        .expect(201)
    ).body.id;
    staffEmp = (
      await a
        .post("/employees", {
          name: "Staf Keuangan",
          userId: staff.id,
          managerId: mgrEmp,
          joinDate: "2024-01-01",
        })
        .expect(201)
    ).body.id;
    for (const c of (await staff.api.get("/approval-categories?active=1").expect(200)).body) cat[c.code] = c;
  });
  afterAll(() => app?.close());

  const create = async (u: User, body: object) =>
    (await u.api.post("/approval-requests", body).expect(201)).body as { id: string; state: string };
  const steps = async (id: string) =>
    (await a.get(`/approval-requests/${id}`).expect(200)).body.steps as Step[];

  it("kategori bawaan BLST tersedia untuk semua user; konfigurasi hanya hr.manage", async () => {
    expect(Object.keys(cat)).toEqual(
      expect.arrayContaining(["FPK", "DINAS", "UANG_MUKA", "LEMBUR", "PINJAM", "KONTRAK", "BAYAR", "UMUM"]),
    );
    expect(cat.FPK).toMatchObject({ prefix: "FPK", managerFirst: true, approvalMode: "sequential" });
    await staff.api.put(`/approval-categories/${cat.BAYAR!.id}`, { ...cat.BAYAR, approvers: [] }).expect(403);
    await staff.api.get("/approval-requests").expect(403);
  });

  it("DoA berurutan: atasan → direktur (≥10 jt); field wajib; nomor otomatis; tidak bisa setujui sendiri", async () => {
    const bayar = (
      await a
        .put(`/approval-categories/${cat.BAYAR!.id}`, {
          ...cat.BAYAR,
          approvers: [
            { userId: director.id, label: "Direktur", minAmount: "10000000" },
            { userId: holding.id, label: "Direksi Holding", minAmount: "100000000" },
          ],
        })
        .expect(200)
    ).body;
    expect(bayar.approvers).toHaveLength(2);

    const r = await create(staff, { categoryId: cat.BAYAR!.id, subject: "Bayar vendor", amount: "50000000" });
    const missing = await staff.api.post(`/approval-requests/${r.id}/submit`).expect(400);
    expect(missing.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      "attachment",
      "contact",
    ]);
    await staff.api
      .put(`/approval-requests/${r.id}`, {
        categoryId: cat.BAYAR!.id,
        subject: "Bayar vendor",
        amount: "50000000",
        contact: "CV Maju",
        attachment: pdf,
      })
      .expect(200);
    const submitted = (await staff.api.post(`/approval-requests/${r.id}/submit`).expect(200)).body;
    expect(submitted.number).toMatch(/^PMB\/\d{4}\/0001$/);
    expect(submitted.steps.map((s: Step) => [s.approverUserId, s.label])).toEqual([
      [manager.id, "Atasan langsung"],
      [director.id, "Direktur"],
    ]);
    await staff.api.post(`/approval-requests/${r.id}/approve`).expect(403);
    await staff.api
      .put(`/approval-requests/${r.id}`, { categoryId: cat.BAYAR!.id, subject: "x" })
      .expect(400);

    // Berurutan: direktur belum bisa memutuskan sebelum atasan.
    await director.api.post(`/approval-requests/${r.id}/approve`).expect(403);
    const inbox = (await manager.api.get("/approvals/pending").expect(200)).body;
    expect(inbox).toEqual([
      expect.objectContaining({
        model: "approval_request",
        id: r.id,
        employeeName: "Staf",
        step: 1,
        levels: 2,
      }),
    ]);
    expect((await director.api.get("/approval-requests?review=1").expect(200)).body).toEqual([]);
    expect(
      (await manager.api.post(`/approval-requests/${r.id}/approve`, { note: "OK" }).expect(200)).body.state,
    ).toBe("submitted");
    expect((await director.api.get("/approval-requests?review=1").expect(200)).body).toHaveLength(1);
    const done = (await director.api.post(`/approval-requests/${r.id}/approve`).expect(200)).body;
    expect(done.state).toBe("approved");
    expect(done.steps.map((s: Step) => s.state)).toEqual(["approved", "approved"]);
    await director.api.post(`/approval-requests/${r.id}/approve`).expect(400);

    // Lampiran bisa diunduh pemohon; nominal kecil hanya ke atasan.
    const file = await staff.api.get(`/approval-requests/${r.id}/attachment`).expect(200);
    expect(file.headers["content-type"]).toContain("application/pdf");
    const small = await create(staff, {
      categoryId: cat.BAYAR!.id,
      subject: "Bayar kecil",
      amount: "2000000",
      contact: "Toko",
      attachment: pdf,
    });
    const smallSteps = (await staff.api.post(`/approval-requests/${small.id}/submit`).expect(200)).body.steps;
    expect(smallSteps.map((s: Step) => s.approverUserId)).toEqual([manager.id]);
    expect((await staff.api.get("/approval-requests?mine=1").expect(200)).body).toHaveLength(2);
    // Penolakan mana pun menolak permintaan.
    expect((await manager.api.post(`/approval-requests/${small.id}/refuse`).expect(200)).body.state).toBe(
      "refused",
    );
  });

  it("paralel dengan minimum persetujuan; tahap tersisa dilewati", async () => {
    await a
      .put(`/approval-categories/${cat.UMUM!.id}`, {
        ...cat.UMUM,
        managerFirst: false,
        approvalMode: "parallel",
        minApprovals: 1,
        approvers: [
          { userId: director.id, required: false },
          { userId: holding.id, required: false },
        ],
      })
      .expect(200);
    const r = await create(staff, { categoryId: cat.UMUM!.id, subject: "Ganti meja", description: "Rusak" });
    await staff.api.post(`/approval-requests/${r.id}/submit`).expect(200);
    expect((await director.api.get("/approval-requests?review=1").expect(200)).body).toHaveLength(1);
    expect((await holding.api.get("/approval-requests?review=1").expect(200)).body).toHaveLength(1);
    const done = (await holding.api.post(`/approval-requests/${r.id}/approve`).expect(200)).body;
    expect(done.state).toBe("approved");
    expect(done.steps.map((s: Step) => s.state)).toEqual(["skipped", "approved"]);
  });

  it("tanpa penyetuju → HR (hr.manage); pemohon tanpa data karyawan", async () => {
    await a
      .put(`/approval-categories/${cat.PINJAM!.id}`, { ...cat.PINJAM, managerFirst: false, approvers: [] })
      .expect(200);
    const r = await create(deputy, {
      categoryId: cat.PINJAM!.id,
      subject: "Pinjam mobil",
      dateFrom: shift(1),
      dateTo: shift(2),
      reference: "B 1234 XY",
    });
    const s = (await deputy.api.post(`/approval-requests/${r.id}/submit`).expect(200)).body.steps;
    expect(s).toEqual([expect.objectContaining({ approverUserId: null, label: "HR" })]);
    await director.api.post(`/approval-requests/${r.id}/approve`).expect(403);
    expect((await a.get("/approvals/pending").expect(200)).body.map((p: { id: string }) => p.id)).toContain(
      r.id,
    );
    expect((await a.post(`/approval-requests/${r.id}/approve`).expect(200)).body.state).toBe("approved");
  });

  it("delegasi: wakil memutuskan atas nama direktur & atasan (permintaan generik dan cuti)", async () => {
    await director.api
      .post("/approval-delegations", { delegateUserId: director.id, dateFrom: today(), dateTo: today() })
      .expect(400);
    await staff.api
      .post("/approval-delegations", {
        userId: director.id,
        delegateUserId: deputy.id,
        dateFrom: today(),
        dateTo: today(),
      })
      .expect(403);
    await director.api
      .post("/approval-delegations", {
        delegateUserId: deputy.id,
        dateFrom: shift(-1),
        dateTo: shift(3),
        reason: "Cuti",
      })
      .expect(201);
    // Delegasi yang sudah lewat tidak berlaku.
    await manager.api
      .post("/approval-delegations", { delegateUserId: holding.id, dateFrom: shift(-10), dateTo: shift(-5) })
      .expect(201);
    expect((await deputy.api.get("/approval-delegations").expect(200)).body).toEqual([
      expect.objectContaining({ userName: "Direktur", delegateName: "Wakil" }),
    ]);

    const r = await create(staff, {
      categoryId: cat.BAYAR!.id,
      subject: "Sewa gedung",
      amount: "20000000",
      contact: "PT Gedung",
      attachment: pdf,
    });
    await staff.api.post(`/approval-requests/${r.id}/submit`).expect(200);
    await holding.api.post(`/approval-requests/${r.id}/approve`).expect(403);
    await manager.api.post(`/approval-requests/${r.id}/approve`).expect(200);
    const done = (
      await deputy.api.post(`/approval-requests/${r.id}/approve`, { note: "a.n. Direktur" }).expect(200)
    ).body;
    expect(done.state).toBe("approved");
    expect(done.steps[1]).toMatchObject({ approverUserId: director.id, delegated: true, state: "approved" });

    // Delegasi juga berlaku untuk cuti: atasan mendelegasikan ke wakil.
    await manager.api
      .post("/approval-delegations", { delegateUserId: deputy.id, dateFrom: today(), dateTo: today() })
      .expect(201);
    const annual = (await a.get("/leave-types").expect(200)).body.items.find(
      (t: { name: string }) => t.name === "Cuti tahunan",
    ).id;
    await a
      .post("/leave-allocations", {
        employeeId: staffEmp,
        leaveTypeId: annual,
        days: "12",
        dateFrom: "2026-01-01",
        dateTo: "2027-12-31",
      })
      .expect(201);
    const leave = (
      await staff.api
        .post("/leaves", { leaveTypeId: annual, dateFrom: shift(14), dateTo: shift(14) })
        .expect(201)
    ).body;
    expect((await deputy.api.get("/approvals/pending").expect(200)).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ model: "leave_request", id: leave.id, mine: true })]),
    );
    expect((await deputy.api.post(`/leaves/${leave.id}/approve`).expect(200)).body.state).toBe("approved");
  });

  it("karyawan resign: permintaan & cuti tidak bisa diputuskan; isolasi perusahaan", async () => {
    const r = await create(staff, {
      categoryId: cat.FPK!.id,
      subject: "Tambah staf",
      quantity: "2",
      description: "Beban kerja",
    });
    await staff.api.post(`/approval-requests/${r.id}/submit`).expect(200);
    const annual = (await a.get("/leave-types").expect(200)).body.items.find(
      (t: { name: string }) => t.name === "Cuti tahunan",
    ).id;
    const leave = (
      await staff.api
        .post("/leaves", { leaveTypeId: annual, dateFrom: shift(21), dateTo: shift(21) })
        .expect(201)
    ).body;
    await a.patch(`/employees/${staffEmp}`, { resignDate: shift(-1) }).expect(200);
    expect((await manager.api.post(`/leaves/${leave.id}/approve`).expect(400)).body.message).toContain(
      "resign",
    );
    const res = await manager.api.post(`/approval-requests/${r.id}/approve`).expect(400);
    expect(res.body.message).toContain("resign");
    expect((await manager.api.get("/approval-requests?review=1").expect(200)).body).toHaveLength(1);
    expect((await steps(r.id)).map((s) => s.state)).toEqual(["pending"]);
    await staff.api.post(`/approval-requests/${r.id}/cancel`).expect(200);

    const other = await signup(app, "apv2");
    await other.get(`/approval-requests/${r.id}`).expect(404);
    await other.get(`/approval-categories/${cat.FPK!.id}`).expect(404);
  });
});
