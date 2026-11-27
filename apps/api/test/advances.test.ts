import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface SlipLine {
  code: string;
  name: string;
  amount: string;
}

/** PNG 1×1 untuk bukti klaim. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe.skipIf(!hasDb)("Kasbon (uang muka karyawan) & tarif lembur", { timeout: 60_000 }, () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let budi: Api;
  let rina: Api;
  let sari: Api;
  let budiEmp = "";
  let bank = "";
  let transport = "";
  let hotel = "";
  const acc: Record<string, string> = {};

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
  /** Baris jurnal sebagai [kode akun, debit, kredit], urut kode. */
  const entry = async (moveId: string) =>
    (
      (await a.get(`/moves/${moveId}`).expect(200)).body.lines as {
        accountId: string;
        debit: string;
        credit: string;
      }[]
    )
      .map((l) => [Object.entries(acc).find(([, v]) => v === l.accountId)?.[0], l.debit, l.credit])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])));
  const approve = async (adv: { approval: { id: string } | null }) =>
    rina.post(`/approval-requests/${adv.approval!.id}/approve`, {}).expect(200);
  const approvedClaim = async (advanceId: string, lines: object[]) => {
    const c = (await budi.post("/expense-claims", { date: "2026-03-10", advanceId, lines }).expect(201)).body;
    await budi.post(`/expense-claims/${c.id}/submit`).expect(200);
    await rina.post(`/expense-claims/${c.id}/approve`, {}).expect(200);
    return c.id as string;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "kasbon");
    const me = (await a.get("/auth/me")).body;
    for (const r of (await a.get("/accounts?limit=300").expect(200)).body.items as {
      id: string;
      code: string;
    }[])
      acc[r.code] = r.id;
    bank = (await a.get("/journals").expect(200)).body.items.find(
      (j: { code: string }) => j.code === "BNK1",
    ).id;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "staf", name: "Staf" }).returning({ id: schema.roles.id }),
    );
    const user = async (name: string, email: string) =>
      (
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
    const rinaEmp = (
      await a
        .post("/employees", {
          name: "Rina Manajer",
          userId: await user("Rina Manajer", "rina@example.com"),
          joinDate: "2024-01-01",
        })
        .expect(201)
    ).body.id;
    budiEmp = (
      await a
        .post("/employees", {
          name: "Budi Staf",
          userId: await user("Budi Staf", "budi@example.com"),
          managerId: rinaEmp,
          joinDate: "2025-01-01",
        })
        .expect(201)
    ).body.id;
    await a
      .post("/employees", {
        name: "Sari Lain",
        userId: await user("Sari Lain", "sari@example.com"),
        joinDate: "2025-01-01",
      })
      .expect(201);
    const c = (
      await a
        .post("/contracts", { employeeId: budiEmp, wage: "3460000", dateStart: "2025-01-01" })
        .expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    transport = (
      await a
        .post("/expense-categories", { name: "Transport", accountId: acc["6-2100"] ?? acc["6-5000"] })
        .expect(201)
    ).body.id;
    hotel = (
      await a
        .post("/expense-categories", { name: "Hotel", accountId: acc["6-5000"], receiptRequired: true })
        .expect(201)
    ).body.id;
    budi = await login("budi@example.com");
    rina = await login("rina@example.com");
    sari = await login("sari@example.com");
  });
  afterAll(() => app?.close());

  it("ajukan → disetujui atasan → cairkan → klaim (bukti wajib) → selesaikan, sisa dipotong di payroll", async () => {
    const adv = (
      await budi
        .post("/employee-advances", {
          date: "2026-03-02",
          purpose: "Dinas ke Medan",
          amount: "1000000",
          settleBy: "2026-03-20",
        })
        .expect(201)
    ).body;
    expect(adv).toMatchObject({ state: "draft", employeeId: budiEmp });
    expect(adv.name).toMatch(/^KSB/);
    await sari.get(`/employee-advances/${adv.id}`).expect(403);
    await sari.get("/employee-advances").expect(403);
    expect((await budi.get("/employee-advances?mine=1").expect(200)).body).toHaveLength(1);

    const submitted = (await budi.post(`/employee-advances/${adv.id}/submit`).expect(200)).body;
    expect(submitted.state).toBe("confirm");
    await a
      .post(`/employee-advances/${adv.id}/disburse`, { journalId: bank, date: "2026-03-03" })
      .expect(400);
    // Atasan langsung (kategori KASBON: atasan lebih dulu).
    await approve(submitted);
    expect((await a.get(`/employee-advances/${adv.id}`).expect(200)).body.state).toBe("approved");
    await budi
      .post(`/employee-advances/${adv.id}/disburse`, { journalId: bank, date: "2026-03-03" })
      .expect(403);
    const paid = (
      await a
        .post(`/employee-advances/${adv.id}/disburse`, { journalId: bank, date: "2026-03-03" })
        .expect(200)
    ).body;
    expect(paid.state).toBe("paid");
    expect(await entry(paid.disbursementMove.id)).toEqual([
      ["1-1200", "0.00", "1000000.00"],
      ["1-1810", "1000000.00", "0.00"],
    ]);
    await budi.post(`/employee-advances/${adv.id}/cancel`).expect(400);

    // Bukti wajib: baris Hotel tanpa lampiran ditolak saat diajukan.
    const draft = (
      await budi
        .post("/expense-claims", {
          date: "2026-03-10",
          advanceId: adv.id,
          lines: [
            { categoryId: transport, date: "2026-03-04", amount: "300000" },
            { categoryId: hotel, date: "2026-03-04", amount: "500000" },
          ],
        })
        .expect(201)
    ).body;
    const refused = await budi.post(`/expense-claims/${draft.id}/submit`).expect(400);
    expect(refused.body.message).toContain("Hotel");
    await budi
      .put(`/expense-claims/${draft.id}`, {
        date: "2026-03-10",
        advanceId: adv.id,
        lines: [
          { categoryId: transport, date: "2026-03-04", amount: "300000" },
          {
            categoryId: hotel,
            date: "2026-03-04",
            amount: "500000",
            attachment: { name: "hotel.png", type: "image/png", data: PNG },
          },
        ],
      })
      .expect(200);
    await budi.post(`/expense-claims/${draft.id}/submit`).expect(200);
    // Klaim kasbon belum disetujui: belum bisa diselesaikan.
    await a
      .post(`/employee-advances/${adv.id}/settle`, { date: "2026-03-21", remainderMethod: "payslip" })
      .expect(400);
    await rina.post(`/expense-claims/${draft.id}/approve`, {}).expect(200);
    await a.post(`/expense-claims/${draft.id}/pay`, { journalId: bank, date: "2026-03-21" }).expect(400);

    const settled = (
      await a
        .post(`/employee-advances/${adv.id}/settle`, { date: "2026-03-21", remainderMethod: "payslip" })
        .expect(200)
    ).body;
    expect(settled).toMatchObject({ state: "paid", remainder: "200000.00", awaitingPayslip: true });
    const settlement = await entry(settled.settlementMove.id);
    expect(settlement.find((l) => l[0] === "1-1810")).toEqual(["1-1810", "0.00", "800000.00"]);
    expect(settlement.reduce((s, l) => s + Number(l[1]), 0)).toBe(800000);
    expect(settled.claims[0].state).toBe("paid");

    // Payroll Maret: sisa kasbon dipotong & akun uang muka dikredit; kasbon selesai.
    const run = (await a.post("/payroll-runs", { period: "2026-03", paymentDate: "2026-03-28" }).expect(201))
      .body;
    await a.post(`/payroll-runs/${run.id}/post`).expect(200);
    const posted = (await a.get(`/payroll-runs/${run.id}`).expect(200)).body;
    const slip = posted.payslips.find((p: { employeeId: string }) => p.employeeId === budiEmp);
    const lines = (await a.get(`/payslips/${slip.id}`).expect(200)).body.lines as SlipLine[];
    expect(lines.find((l) => l.code === "ADV")).toMatchObject({
      name: `Sisa kasbon ${adv.name}`,
      amount: "-200000.00",
    });
    // Klaim kasbon tidak ikut dibayar lewat slip.
    expect(lines.some((l) => l.name.includes(draft.name))).toBe(false);
    expect((await entry(posted.accountMoveId)).find((l) => l[0] === "1-1810")).toEqual([
      "1-1810",
      "0.00",
      "200000.00",
    ]);
    expect((await a.get(`/employee-advances/${adv.id}`).expect(200)).body).toMatchObject({
      state: "settled",
      awaitingPayslip: false,
    });
  });

  it("diajukan HR atas nama karyawan; klaim melebihi kasbon → selisih dibayar; sisa dikembalikan tunai", async () => {
    const adv = (
      await a
        .post("/employee-advances", {
          employeeId: budiEmp,
          date: "2026-04-01",
          purpose: "Pameran Jakarta",
          amount: "500000",
          settleBy: "2026-04-15",
        })
        .expect(201)
    ).body;
    // Atasan karyawan (bukan atasan HR) menjadi penyetuju pertama.
    await approve((await a.post(`/employee-advances/${adv.id}/submit`).expect(200)).body);
    await a
      .post(`/employee-advances/${adv.id}/disburse`, { journalId: bank, date: "2026-04-01" })
      .expect(200);
    await approvedClaim(adv.id, [{ categoryId: transport, date: "2026-04-02", amount: "700000" }]);
    await a.post(`/employee-advances/${adv.id}/settle`, { date: "2026-04-16" }).expect(400);
    const done = (
      await a.post(`/employee-advances/${adv.id}/settle`, { date: "2026-04-16", journalId: bank }).expect(200)
    ).body;
    expect(done).toMatchObject({ state: "settled", remainder: "0.00" });
    const e = await entry(done.settlementMove.id);
    expect(e.find((l) => l[0] === "1-1810")).toEqual(["1-1810", "0.00", "500000.00"]);
    expect(e.find((l) => l[0] === "1-1200")).toEqual(["1-1200", "0.00", "200000.00"]);

    // Kasbon tanpa klaim, lewat batas pertanggungjawaban: kasbon baru ditolak sampai diselesaikan.
    const idle = (
      await budi
        .post("/employee-advances", {
          date: "2026-05-01",
          purpose: "Uang muka",
          amount: "400000",
          settleBy: "2026-05-10",
        })
        .expect(201)
    ).body;
    await approve((await budi.post(`/employee-advances/${idle.id}/submit`).expect(200)).body);
    await a
      .post(`/employee-advances/${idle.id}/disburse`, { journalId: bank, date: "2026-05-01" })
      .expect(200);
    const blocked = await budi
      .post("/employee-advances", {
        date: "2026-05-20",
        purpose: "Lagi",
        amount: "100000",
        settleBy: "2026-05-30",
      })
      .expect(400);
    expect(blocked.body.message).toContain(idle.name);
    const returned = (
      await a
        .post(`/employee-advances/${idle.id}/settle`, {
          date: "2026-05-12",
          journalId: bank,
          remainderMethod: "return",
        })
        .expect(200)
    ).body;
    expect(returned).toMatchObject({ state: "settled", remainder: "400000.00", remainderMethod: "return" });
    expect(await entry(returned.settlementMove.id)).toEqual([
      ["1-1200", "400000.00", "0.00"],
      ["1-1810", "0.00", "400000.00"],
    ]);
  });

  it("master tarif lembur: bawaan PP 35/2021, tarif kustom mengubah upah lembur slip", async () => {
    await a.post("/overtimes", { employeeId: budiEmp, date: "2026-06-09", hours: "2" }).expect(201);
    const run = (await a.post("/payroll-runs", { period: "2026-06", paymentDate: "2026-06-28" }).expect(201))
      .body;
    const ot = async () => {
      const r = (await a.get(`/payroll-runs/${run.id}`).expect(200)).body;
      const slip = r.payslips.find((p: { employeeId: string }) => p.employeeId === budiEmp);
      return ((await a.get(`/payslips/${slip.id}`).expect(200)).body.lines as SlipLine[]).find(
        (l) => l.code === "OT",
      )?.amount;
    };
    // Upah sejam 3.460.000 / 173 = 20.000; jam ke-1 × 1,5 + jam ke-2 × 2.
    expect(await ot()).toBe("70000.00");
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    const bad = await a
      .put("/payroll/settings", {
        ...settings,
        overtimeRates: {
          divisor: 173,
          workday: [{ upToHour: 2, multiplier: 2 }],
          rest_day: [{ upToHour: null, multiplier: 2 }],
        },
      })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("tanpa batas");
    await a
      .put("/payroll/settings", {
        ...settings,
        overtimeRates: {
          divisor: 173,
          workday: [{ upToHour: null, multiplier: 2 }],
          rest_day: [{ upToHour: null, multiplier: 3 }],
        },
      })
      .expect(200);
    await a.post(`/payroll-runs/${run.id}/compute`).expect(200);
    expect(await ot()).toBe("80000.00");
  });
});
