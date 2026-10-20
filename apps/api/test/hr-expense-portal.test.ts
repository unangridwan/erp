import type { INestApplication } from "@nestjs/common";
import { eq, schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

/** PNG 1×1 untuk bukti klaim. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe.skipIf(!hasDb)("HR: klaim biaya & portal karyawan", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let tenantId: string;
  let companyId: string;
  let dewiApi: Api;
  let budiApi: Api;
  let dewi: string;
  let transport: string;
  let medical: string;
  let expenseAccount: string;
  let bankJournal: string;
  const claims: Record<string, string> = {};

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
  const user = async (name: string, email: string, roleId: string) =>
    (
      await a
        .post("/users", { name, email, password: "rahasia123", roleIds: [roleId], companyIds: [companyId] })
        .expect(201)
    ).body.id as string;
  const entry = async (moveId: string) =>
    ((await a.get(`/moves/${moveId}`).expect(200)).body.lines as Line[]).map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
    }));
  const claim = (api: Api, body: object) => api.post("/expense-claims", body);

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "expense");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    companyId = me.activeCompanyId;
    const accounts = (await a.get("/accounts?limit=300").expect(200)).body.items as {
      id: string;
      code: string;
    }[];
    expenseAccount = accounts.find(
      (x) => x.code.startsWith("6-") && !["6-1000", "6-1100", "6-1110"].includes(x.code),
    )!.id;
    bankJournal = (await a.get("/journals").expect(200)).body.items.find(
      (j: { code: string }) => j.code === "BNK1",
    ).id;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "staff", name: "Staf" }).returning({ id: schema.roles.id }),
    );
    const managerUser = await user("Budi Manajer", "budi@example.com", role!.id);
    const dewiUser = await user("Dewi Staf", "dewi@example.com", role!.id);
    const budi = (
      await a
        .post("/employees", { name: "Budi Manajer", userId: managerUser, joinDate: "2024-01-01" })
        .expect(201)
    ).body.id;
    dewi = (
      await a
        .post("/employees", {
          name: "Dewi Staf",
          userId: dewiUser,
          managerId: budi,
          joinDate: "2025-01-01",
          bankName: "BCA",
          bankAccount: "1234567890",
        })
        .expect(201)
    ).body.id;
    const c = (
      await a.post("/contracts", { employeeId: dewi, wage: "6000000", dateStart: "2025-01-01" }).expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    dewiApi = await login("dewi@example.com");
    budiApi = await login("budi@example.com");
  });
  afterAll(() => app?.close());

  it("kategori klaim dengan plafon tahunan & akun beban; portal melihat kategori aktif", async () => {
    await a
      .post("/expense-categories", { name: "X", accountId: "00000000-0000-4000-8000-000000000000" })
      .expect(400);
    transport = (
      await a
        .post("/expense-categories", {
          name: "Transport dinas",
          accountId: expenseAccount,
          annualLimit: "1000000",
        })
        .expect(201)
    ).body.id;
    medical = (
      await a
        .post("/expense-categories", { name: "Kesehatan", accountId: expenseAccount, taxable: true })
        .expect(201)
    ).body.id;
    await dewiApi.get("/expense-categories").expect(403);
    const mine = (await dewiApi.get("/me/expense-categories").expect(200)).body;
    expect(mine.map((x: { name: string }) => x.name)).toEqual(["Kesehatan", "Transport dinas"]);
  });

  it("karyawan mengajukan klaim dengan bukti; plafon tahunan ditegakkan", async () => {
    const c1 = (
      await claim(dewiApi, {
        date: "2026-03-05",
        description: "Kunjungan klien",
        lines: [
          {
            categoryId: transport,
            date: "2026-03-04",
            amount: "600000",
            note: "Taksi",
            attachment: { name: "struk.png", type: "image/png", data: PNG },
          },
        ],
      }).expect(201)
    ).body;
    expect(c1).toMatchObject({ name: "KLM/2026/0001", state: "draft", total: "600000.00", employeeId: dewi });
    expect(c1.lines[0]).toMatchObject({ attachmentName: "struk.png", categoryName: "Transport dinas" });
    expect(c1.lines[0].attachment).toBeUndefined();
    claims.c1 = c1.id;
    // Ubah draft tanpa bukti baru: bukti lama tetap ada.
    const edited = (
      await dewiApi
        .put(`/expense-claims/${c1.id}`, {
          date: "2026-03-05",
          lines: [{ id: c1.lines[0].id, categoryId: transport, date: "2026-03-04", amount: "600000" }],
        })
        .expect(200)
    ).body;
    expect(edited.lines[0].attachmentName).toBe("struk.png");
    claims.c1line = edited.lines[0].id;
    await dewiApi.post(`/expense-claims/${c1.id}/submit`).expect(200);
    await dewiApi.put(`/expense-claims/${c1.id}`, { date: "2026-03-05", lines: [] }).expect(400);

    const c2 = (
      await claim(dewiApi, {
        date: "2026-03-10",
        lines: [{ categoryId: transport, date: "2026-03-10", amount: "500000" }],
      }).expect(201)
    ).body;
    const over = await dewiApi.post(`/expense-claims/${c2.id}/submit`).expect(400);
    expect(over.body.message).toMatch(/melebihi plafon tahunan \(sisa Rp 400000, lebih Rp 100000\)/);
    await dewiApi.delete(`/expense-claims/${c2.id}`).expect(204);

    // Karyawan biasa tidak bisa membuat klaim untuk orang lain atau melihat semua klaim.
    await claim(budiApi, {
      employeeId: dewi,
      date: "2026-03-10",
      lines: [{ categoryId: medical, date: "2026-03-10", amount: "1" }],
    }).expect(403);
    await dewiApi.get("/expense-claims").expect(403);
    expect((await dewiApi.get("/expense-claims?mine=1").expect(200)).body).toHaveLength(1);
  });

  it("persetujuan atasan langsung; bukti bisa diunduh penyetuju", async () => {
    await dewiApi.post(`/expense-claims/${claims.c1}/approve`).expect(403);
    const pending = (await budiApi.get("/approvals/pending").expect(200)).body;
    expect(pending).toEqual([
      expect.objectContaining({
        model: "expense_claim",
        id: claims.c1,
        mine: true,
        summary: expect.stringContaining("KLM/2026/0001"),
      }),
    ]);
    const file = await budiApi
      .get(`/expense-claims/${claims.c1}/lines/${claims.c1line}/attachment`)
      .expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(file.body).subarray(1, 4).toString()).toBe("PNG");
    const approved = (await budiApi.post(`/expense-claims/${claims.c1}/approve`, { note: "OK" }).expect(200))
      .body;
    expect(approved).toMatchObject({
      state: "approved",
      approval: { history: [expect.objectContaining({ note: "OK" })] },
    });
    await budiApi.get(`/expense-claims/${claims.c1}`).expect(403); // bukan penyetuju lagi
  });

  it("dibayar lewat slip: tidak kena pajak kecuali kategori objek PPh 21; jurnal ke akun beban; tidak dibayar dua kali", async () => {
    // Klaim kedua (kesehatan, objek PPh 21) dibuat HR, disetujui HR (ambil alih tahap atasan).
    const c3 = (
      await claim(a, {
        employeeId: dewi,
        date: "2026-03-12",
        lines: [{ categoryId: medical, date: "2026-03-12", amount: "300000" }],
      }).expect(201)
    ).body;
    await a.post(`/expense-claims/${c3.id}/submit`).expect(200);
    await a.post(`/expense-claims/${c3.id}/approve`).expect(200);
    claims.c3 = c3.id;

    const run = (await a.post("/payroll-runs", { period: "2026-03", paymentDate: "2026-03-25" }).expect(201))
      .body;
    const slip = run.payslips[0];
    const detail = (await a.get(`/payslips/${slip.id}`).expect(200)).body;
    expect(
      detail.lines
        .filter((l: { code: string }) => l.code === "RMB")
        .map((l: { name: string; amount: string }) => [l.name, l.amount]),
    ).toEqual([
      ["Penggantian biaya KLM/2026/0001", "600000.00"],
      ["Penggantian biaya KLM/2026/0003 (objek PPh 21)", "300000.00"],
    ]);
    // Pendapatan 6,9 jt; bruto PPh 21 = 6 jt + 300 rb + premi BPJS perusahaan (tanpa 600 rb transport).
    expect(slip.earnings).toBe("6900000.00");
    expect(Number(slip.gross)).toBeLessThan(6_600_000);
    expect(Number(slip.gross)).toBeGreaterThan(6_300_000);

    const posted = (await a.post(`/payroll-runs/${run.id}/post`).expect(200)).body;
    const lines = await entry(posted.accountMove.id);
    expect(lines.filter((l) => l.accountId === expenseAccount)).toEqual([
      { accountId: expenseAccount, debit: "900000.00", credit: "0.00" },
    ]);
    expect((await a.get(`/expense-claims/${claims.c1}`).expect(200)).body).toMatchObject({
      state: "paid",
      payslipId: slip.id,
    });
    const april = (
      await a.post("/payroll-runs", { period: "2026-04", paymentDate: "2026-04-25" }).expect(201)
    ).body;
    const aprilLines = (await a.get(`/payslips/${april.payslips[0].id}`).expect(200)).body.lines;
    expect(aprilLines.find((l: { code: string }) => l.code === "RMB")).toBeUndefined();
    claims.april = april.id;
  });

  it("klaim dibatalkan setelah payroll dihitung: posting ditolak sampai dihitung ulang", async () => {
    const c4 = (
      await claim(dewiApi, {
        date: "2026-04-02",
        lines: [{ categoryId: medical, date: "2026-04-02", amount: "100000" }],
      }).expect(201)
    ).body;
    await dewiApi.post(`/expense-claims/${c4.id}/submit`).expect(200);
    await budiApi.post(`/expense-claims/${c4.id}/approve`).expect(200);
    await a.post(`/payroll-runs/${claims.april}/compute`).expect(200);
    await dewiApi.post(`/expense-claims/${c4.id}/cancel`).expect(200);
    const res = await a.post(`/payroll-runs/${claims.april}/post`).expect(400);
    expect(res.body.message).toMatch(/KLM\/2026\/0004 sudah berubah; hitung ulang payroll/);
    await a.post(`/payroll-runs/${claims.april}/compute`).expect(200);
    await a.post(`/payroll-runs/${claims.april}/post`).expect(200);
  });

  it("dibayar langsung dari kas/bank: Dr beban / Cr bank", async () => {
    const c5 = (
      await claim(dewiApi, {
        date: "2026-05-02",
        payMethod: "cash",
        lines: [{ categoryId: transport, date: "2026-05-02", amount: "250000" }],
      }).expect(201)
    ).body;
    await a.post(`/expense-claims/${c5.id}/pay`, { journalId: bankJournal, date: "2026-05-03" }).expect(400); // belum disetujui
    await dewiApi.post(`/expense-claims/${c5.id}/submit`).expect(200);
    await budiApi.post(`/expense-claims/${c5.id}/refuse`, { note: "Lengkapi bukti" }).expect(200);
    expect((await dewiApi.get(`/expense-claims/${c5.id}`).expect(200)).body.state).toBe("refused");

    const c6 = (
      await claim(dewiApi, {
        date: "2026-05-04",
        payMethod: "cash",
        lines: [{ categoryId: transport, date: "2026-05-04", amount: "250000" }],
      }).expect(201)
    ).body;
    await dewiApi.post(`/expense-claims/${c6.id}/submit`).expect(200);
    await budiApi.post(`/expense-claims/${c6.id}/approve`).expect(200);
    await dewiApi
      .post(`/expense-claims/${c6.id}/pay`, { journalId: bankJournal, date: "2026-05-05" })
      .expect(403);
    const paid = (
      await a.post(`/expense-claims/${c6.id}/pay`, { journalId: bankJournal, date: "2026-05-05" }).expect(200)
    ).body;
    expect(paid.state).toBe("paid");
    const lines = await entry(paid.move.id);
    expect(lines).toEqual(
      expect.arrayContaining([
        { accountId: expenseAccount, debit: "250000.00", credit: "0.00" },
        expect.objectContaining({ debit: "0.00", credit: "250000.00" }),
      ]),
    );
    await a.post(`/expense-claims/${c6.id}/pay`, { journalId: bankJournal, date: "2026-05-05" }).expect(400);
  });

  it("portal: ajukan lembur (selalu butuh persetujuan), pinjaman & bukti potong sendiri", async () => {
    const ot = (
      await dewiApi.post("/me/overtimes", { date: "2026-05-09", hours: "2", employeeId: "abc" }).expect(201)
    ).body;
    expect(ot).toMatchObject({ employeeId: dewi, state: "confirm", approvalLevels: 1 });
    expect((await dewiApi.get("/me/overtimes").expect(200)).body).toHaveLength(1);
    await budiApi.post(`/approvals/overtime/${ot.id}/approve`).expect(200);

    await a
      .post("/employee-loans", {
        employeeId: dewi,
        name: "Kasbon",
        principal: "1000000",
        installment: "250000",
        startPeriod: "2026-06",
      })
      .expect(201);
    expect((await dewiApi.get("/me/loans").expect(200)).body).toEqual([
      expect.objectContaining({ name: "Kasbon", principal: "1000000.00" }),
    ]);
    expect((await budiApi.get("/me/loans").expect(200)).body).toEqual([]);
    expect((await dewiApi.get("/me/withholding-slips").expect(200)).body).toEqual([]);
  });

  it("perubahan data pribadi: rekening terenkripsi, disetujui HR lalu diterapkan", async () => {
    await dewiApi.post("/me/change-requests", { note: "kosong" }).expect(400);
    const req = (
      await dewiApi
        .post("/me/change-requests", {
          bankAccount: "999-888-7776",
          address: "Jl. Melati 1, Bandung",
          ptkpStatus: "K/0",
        })
        .expect(201)
    ).body;
    expect(req.changes).toEqual({
      address: "Jl. Melati 1, Bandung",
      ptkpStatus: "K/0",
      bankAccount: "••••7776",
    });
    await dewiApi.post("/me/change-requests", { address: "lain" }).expect(400); // masih ada yang menunggu
    const [raw] = await app
      .get(TenantDb)
      .runAs(tenantId, (tx) =>
        tx.select().from(schema.employeeChangeRequests).where(eq(schema.employeeChangeRequests.id, req.id)),
      );
    expect(raw!.changes.bankAccountEnc).toMatch(/^v1\./);
    expect(JSON.stringify(raw!.changes)).not.toContain("9998887776");

    await dewiApi.get("/employee-change-requests").expect(403);
    await dewiApi.post(`/employee-change-requests/${req.id}/approve`).expect(403);
    const list = (await a.get("/employee-change-requests?state=confirm").expect(200)).body;
    expect(list[0]).toMatchObject({
      employeeName: "Dewi Staf",
      changes: { bankAccount: "9998887776" },
      current: { bankAccount: "1234567890", address: null, ptkpStatus: "TK/0" },
    });
    await a.post(`/employee-change-requests/${req.id}/approve`, { note: "Sesuai buku tabungan" }).expect(200);
    await a.post(`/employee-change-requests/${req.id}/approve`).expect(400);
    expect((await a.get(`/employees/${dewi}`).expect(200)).body).toMatchObject({
      bankAccount: "9998887776",
      address: "Jl. Melati 1, Bandung",
      ptkpStatus: "K/0",
    });
    expect((await dewiApi.get("/me/change-requests").expect(200)).body[0]).toMatchObject({
      state: "approved",
      decisionNote: "Sesuai buku tabungan",
    });
  });
});
