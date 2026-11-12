import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface MoveLine {
  accountId: string;
  debit: string;
  credit: string;
  costCenterId: string | null;
  profitCenterId: string | null;
}

describe.skipIf(!hasDb)("Controlling: cost center & profit center", () => {
  let app: INestApplication;
  let a: Api;
  const acc: Record<string, string> = {};
  const cc: Record<string, string> = {};
  const pc: Record<string, string> = {};
  let customer = "";

  const lines = async (id: string) => (await a.get(`/moves/${id}`).expect(200)).body.lines as MoveLine[];
  const entry = async (
    date: string,
    body: {
      accountId: string;
      debit?: number;
      credit?: number;
      costCenterId?: string;
      profitCenterId?: string;
    }[],
    post = true,
  ) => {
    const m = (await a.post("/moves", { date, lines: body }).expect(201)).body;
    if (post) await a.post(`/moves/${m.id}/post`).expect(200);
    return m.id as string;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "co");
    for (const r of (await a.get("/accounts?limit=500").expect(200)).body.items) acc[r.code] = r.id;
    customer = (await a.post("/partners", { name: "PT Pembeli", isCustomer: true }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("CRUD berjenjang: induk satu perusahaan, tanpa siklus, kode unik", async () => {
    pc.HQ = (await a.post("/profit-centers", { code: "PC-HQ", name: "Kantor Pusat" }).expect(201)).body.id;
    pc.AGRO = (await a.post("/profit-centers", { code: "PC-AGRO", name: "Agro" }).expect(201)).body.id;
    cc.ADM = (
      await a
        .post("/cost-centers", {
          code: "CC-ADM",
          name: "Administrasi",
          profitCenterId: pc.HQ,
          category: "admin",
        })
        .expect(201)
    ).body.id;
    cc.IT = (
      await a
        .post("/cost-centers", {
          code: "CC-IT",
          name: "IT",
          parentId: cc.ADM,
          profitCenterId: pc.HQ,
          category: "service",
        })
        .expect(201)
    ).body.id;
    cc.SLS = (
      await a
        .post("/cost-centers", {
          code: "CC-SLS",
          name: "Penjualan",
          profitCenterId: pc.AGRO,
          category: "sales",
        })
        .expect(201)
    ).body.id;
    const cycle = await a.patch(`/cost-centers/${cc.ADM}`, { parentId: cc.IT }).expect(400);
    expect(JSON.stringify(cycle.body)).toContain("parentId");
    await a.post("/cost-centers", { code: "CC-ADM", name: "Dobel" }).expect(409);
    await a.post("/cost-centers", { code: "CC X", name: "Spasi" }).expect(400);
  });

  it("isi otomatis dari default akun dan dari cost center; isian baris menang", async () => {
    await a.patch(`/accounts/${acc["6-2000"]}`, { defaultCostCenterId: cc.ADM }).expect(200);
    await a.patch(`/accounts/${acc["4-1000"]}`, { defaultProfitCenterId: pc.AGRO }).expect(200);

    const m1 = await entry("2026-03-01", [
      { accountId: acc["6-2000"], debit: 5_000_000 },
      { accountId: acc["1-1200"], credit: 5_000_000 },
    ]);
    const l1 = await lines(m1);
    expect(l1.find((l) => l.accountId === acc["6-2000"])).toMatchObject({
      costCenterId: cc.ADM,
      profitCenterId: pc.HQ,
    });
    expect(l1.find((l) => l.accountId === acc["1-1200"])).toMatchObject({
      costCenterId: null,
      profitCenterId: null,
    });

    const m2 = await entry("2026-03-02", [
      { accountId: acc["6-2000"], debit: 2_000_000, costCenterId: cc.IT },
      { accountId: acc["6-2000"], debit: 3_000_000, costCenterId: cc.SLS },
      { accountId: acc["1-1200"], credit: 5_000_000 },
    ]);
    const l2 = await lines(m2);
    expect(
      l2.filter((l) => l.accountId === acc["6-2000"]).map((l) => [l.costCenterId, l.profitCenterId]),
    ).toEqual(
      expect.arrayContaining([
        [cc.IT, pc.HQ],
        [cc.SLS, pc.AGRO],
      ]),
    );

    // Faktur: pendapatan ke profit center default akun.
    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-03-10",
          lines: [{ name: "Benih", priceUnit: 20_000_000, accountId: acc["4-1000"] }],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${inv.id}/post`).expect(200);
    expect((await lines(inv.id)).find((l) => l.accountId === acc["4-1000"])?.profitCenterId).toBe(pc.AGRO);

    // Pembalikan menyalin dimensi.
    const rev = (await a.post(`/moves/${m2}/reverse`, { date: "2026-03-31" }).expect(201)).body;
    const revLines = await lines(rev.id);
    expect(revLines.filter((l) => l.costCenterId === cc.SLS)).toHaveLength(1);
  });

  it("menolak cost center nonaktif atau tidak dikenal", async () => {
    const off = (await a.post("/cost-centers", { code: "CC-OFF", name: "Lama", active: false }).expect(201))
      .body.id;
    const res = await a
      .post("/moves", {
        date: "2026-03-03",
        lines: [
          { accountId: acc["6-2000"], debit: 1, costCenterId: off },
          { accountId: acc["1-1200"], credit: 1 },
        ],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain("lines.0.costCenterId");
  });

  it("cost center wajib untuk akun beban saat posting bila diaktifkan", async () => {
    await a.patch("/accounting/settings", { costCenterRequired: true }).expect(200);
    const draft = await entry(
      "2026-04-01",
      [
        { accountId: acc["6-4000"], debit: 1_000_000 },
        { accountId: acc["1-2290"], credit: 1_000_000 },
      ],
      false,
    );
    const res = await a.post(`/moves/${draft}/post`).expect(400);
    expect(res.body.message).toContain("Cost center wajib");
    expect(res.body.message).toContain("6-4000");
    // Akun bukan beban (bank) & akun dengan default tidak terkena.
    await entry("2026-04-01", [
      { accountId: acc["6-4000"], debit: 1_000_000, costCenterId: cc.IT },
      { accountId: acc["1-2290"], credit: 1_000_000 },
    ]);
    await entry("2026-04-02", [
      { accountId: acc["6-2000"], debit: 500_000 },
      { accountId: acc["1-1200"], credit: 500_000 },
    ]);
    await a.patch("/accounting/settings", { costCenterRequired: false }).expect(200);
  });

  it("payroll: beban gaji ke cost center departemen karyawan (naik ke induk)", async () => {
    const parent = (await a.post("/departments", { name: "Operasional", costCenterId: cc.SLS }).expect(201))
      .body.id;
    const dept = (await a.post("/departments", { name: "Lapangan", parentId: parent }).expect(201)).body.id;
    const emp = (
      await a.post("/employees", { name: "Sari", departmentId: dept, joinDate: "2025-01-01" }).expect(201)
    ).body.id;
    const own = (
      await a
        .post("/employees", { name: "Tono", departmentId: dept, costCenterId: cc.IT, joinDate: "2025-01-01" })
        .expect(201)
    ).body.id;
    for (const id of [emp, own]) {
      const c = (
        await a.post("/contracts", { employeeId: id, wage: "5000000", dateStart: "2025-01-01" }).expect(201)
      ).body;
      await a.post(`/contracts/${c.id}/start`).expect(200);
    }
    const run = (await a.post("/payroll-runs", { period: "2026-05", paymentDate: "2026-05-25" }).expect(201))
      .body;
    const posted = (await a.post(`/payroll-runs/${run.id}/post`).expect(200)).body;
    const pl = await lines(posted.accountMove.id);
    const expense = pl.filter((l) => Number(l.debit) > 0 && l.costCenterId);
    expect(new Set(expense.map((l) => l.costCenterId))).toEqual(new Set([cc.SLS, cc.IT]));
  });

  it("laporan cost center (rollup, anggaran prorata) & laba rugi profit center", async () => {
    await a
      .post("/budgets", {
        name: "Anggaran IT 2026",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        lines: [{ accountId: acc["6-2000"], amount: "36500000", costCenterId: cc.IT }],
      })
      .expect(201);
    const r = (await a.get("/controlling/cost-centers?dateFrom=2026-03-01&dateTo=2026-03-31").expect(200))
      .body;
    const row = (code: string) => r.rows.find((x: { code: string }) => x.code === code);
    // Maret: ADM 5 jt (default akun), IT 2 jt − 2 jt (dibalik), SLS 3 jt − 3 jt.
    expect(row("CC-IT")).toMatchObject({ depth: 1, actual: "0.00", budget: "3100000.00" });
    expect(row("CC-ADM")).toMatchObject({ depth: 0, ownActual: "5000000.00", actual: "5000000.00" });
    expect(row("CC-ADM").budget).toBe("3100000.00");
    expect(row("CC-SLS").actual).toBe("0.00");

    const april = (await a.get("/controlling/cost-centers?dateFrom=2026-04-01&dateTo=2026-04-30").expect(200))
      .body;
    expect(april.rows.find((x: { code: string }) => x.code === "CC-ADM").actual).toBe("1500000.00"); // IT 1 jt + ADM 0,5 jt
    const detail = (
      await a
        .get(`/controlling/cost-centers/${cc.ADM}/accounts?dateFrom=2026-04-01&dateTo=2026-04-30`)
        .expect(200)
    ).body;
    expect(detail.map((d: { code: string; actual: string }) => [d.code, d.actual])).toEqual([
      ["6-2000", "500000.00"],
      ["6-4000", "1000000.00"],
    ]);

    const p = (await a.get("/controlling/profit-centers?dateFrom=2026-03-01&dateTo=2026-03-31").expect(200))
      .body;
    const agro = p.rows.find((x: { code: string }) => x.code === "PC-AGRO");
    expect(agro).toMatchObject({
      revenue: "20000000.00",
      opex: "0.00",
      netProfit: "20000000.00",
      margin: 100,
    });
    const hq = p.rows.find((x: { code: string }) => x.code === "PC-HQ");
    expect(hq).toMatchObject({ opex: "5000000.00", netProfit: "-5000000.00" });

    // Filter laporan laba rugi umum dengan cost center (termasuk turunan).
    const pl = (
      await a
        .get(`/reports/profit-loss?dateFrom=2026-04-01&dateTo=2026-04-30&costCenterId=${cc.ADM}`)
        .expect(200)
    ).body;
    expect(JSON.stringify(pl)).toContain("1500000.00");
  });

  it("tidak bisa menghapus center yang dipakai atau punya turunan", async () => {
    await a.delete(`/cost-centers/${cc.ADM}`).expect(400);
    await a.delete(`/cost-centers/${cc.IT}`).expect(400);
    const tmp = (await a.post("/cost-centers", { code: "CC-TMP", name: "Sementara" }).expect(201)).body.id;
    await a.delete(`/cost-centers/${tmp}`).expect(204);
  });
});
