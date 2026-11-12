import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountingScheduler } from "../src/accounting/recurring.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  debit: string;
  credit: string;
  deferralAccountId: string | null;
}

describe.skipIf(!hasDb)("Penangguhan, pembalik otomatis & jurnal berulang", () => {
  let app: INestApplication;
  let a: Api;
  let tenantId: string;
  let customer: string;
  let vendor: string;
  let scheduler: AccountingScheduler;
  const acc: Record<string, string> = {};
  const jr: Record<string, string> = {};

  const balance = async (code: string, dateTo = "2026-12-31") => {
    const tb = (await a.get(`/reports/trial-balance?dateFrom=2026-01-01&dateTo=${dateTo}`).expect(200)).body;
    const row = tb.lines.find((r: { code: string }) => r.code === code);
    return row ? Number(row.closing) : 0;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "defr");
    tenantId = (await a.get("/auth/me")).body.tenantId;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    customer = (await a.post("/partners", { name: "PT Langganan", isCustomer: true }).expect(201)).body.id;
    vendor = (await a.post("/partners", { name: "PT Sewa Gedung", isSupplier: true }).expect(201)).body.id;
    scheduler = app.get(AccountingScheduler);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pengaturan akun penangguhan terisi dari bagan akun standar", async () => {
    const s = (await a.get("/accounting/settings").expect(200)).body;
    expect(s.deferredRevenueAccountId).toBe(acc["2-1650"]);
    expect(s.deferredExpenseAccountId).toBe(acc["1-1700"]);
  });

  it("validasi periode penangguhan", async () => {
    const res = await a
      .post("/moves", {
        moveType: "out_invoice",
        partnerId: customer,
        date: "2026-01-15",
        lines: [{ name: "x", priceUnit: 100, accountId: acc["4-1100"], deferralStart: "2026-02-01" }],
      })
      .expect(400);
    expect(res.body.errors[0].path).toBe("lines.0.deferralEnd");
  });

  let invoiceId: string;
  it("faktur penjualan ditangguhkan: pendapatan masuk akun penangguhan + jadwal prorata per bulan", async () => {
    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-01-15",
          lines: [
            {
              name: "Langganan smart farming 1 tahun",
              priceUnit: 12_000_000,
              accountId: acc["4-1100"],
              deferralStart: "2026-01-15",
              deferralEnd: "2027-01-14",
            },
          ],
        })
        .expect(201)
    ).body;
    invoiceId = inv.id;
    const posted = (await a.post(`/moves/${inv.id}/post`).expect(200)).body;
    const product = posted.lines.find((l: Line) => l.deferralAccountId);
    expect(product).toMatchObject({
      accountId: acc["2-1650"],
      deferralAccountId: acc["4-1100"],
      credit: "12000000.00",
    });

    const schedule = (await a.get(`/moves/${inv.id}/deferrals`).expect(200)).body;
    expect(schedule).toHaveLength(13);
    expect(
      schedule.every((s: { state: string; autoPost: boolean }) => s.state === "draft" && s.autoPost),
    ).toBe(true);
    expect(schedule[0].date).toBe("2026-01-31");
    expect(schedule.reduce((t: number, s: { amount: string }) => t + Number(s.amount), 0)).toBeCloseTo(
      12_000_000,
      2,
    );
  });

  it("penjadwal memposting pengakuan yang jatuh tempo; pendapatan bertambah, penangguhan berkurang", async () => {
    const result = await scheduler.runDue("2026-03-31", [tenantId]);
    expect(result.posted).toBe(3);
    const schedule = (await a.get(`/moves/${invoiceId}/deferrals`).expect(200)).body;
    expect(schedule.filter((s: { state: string }) => s.state === "posted")).toHaveLength(3);
    const recognized = schedule
      .slice(0, 3)
      .reduce((t: number, s: { amount: string }) => t + Number(s.amount), 0);
    expect(await balance("4-1100")).toBeCloseTo(-recognized, 2);
    expect(await balance("2-1650")).toBeCloseTo(-(12_000_000 - recognized), 2);
  });

  it("membalik faktur juga membalik pengakuan terposting dan menghapus draft sisanya", async () => {
    await a.post(`/moves/${invoiceId}/reverse`, { date: "2026-04-01" }).expect(201);
    const schedule = (await a.get(`/moves/${invoiceId}/deferrals`).expect(200)).body;
    expect(schedule).toHaveLength(3);
    expect(await balance("4-1100")).toBeCloseTo(0, 2);
    expect(await balance("2-1650")).toBeCloseTo(0, 2);
  });

  it("tagihan pembelian ditangguhkan memakai akun biaya dibayar di muka", async () => {
    const bill = (
      await a
        .post("/moves", {
          moveType: "in_invoice",
          partnerId: vendor,
          date: "2026-06-01",
          lines: [
            {
              name: "Sewa gudang 6 bulan",
              priceUnit: 6_000_000,
              accountId: acc["6-2000"],
              deferralStart: "2026-06-01",
              deferralEnd: "2026-11-30",
            },
          ],
        })
        .expect(201)
    ).body;
    const posted = (await a.post(`/moves/${bill.id}/post`).expect(200)).body;
    expect(posted.lines.find((l: Line) => l.deferralAccountId)).toMatchObject({
      accountId: acc["1-1700"],
      debit: "6000000.00",
    });
    const schedule = (await a.get(`/moves/${bill.id}/deferrals`).expect(200)).body;
    // Prorata hari: Juni 30 dari 183 hari.
    expect(schedule).toHaveLength(6);
    expect(schedule[0].amount).toBe(((6_000_000 * 30) / 183).toFixed(2));
    expect(schedule.reduce((t: number, s: { amount: string }) => t + Number(s.amount), 0)).toBeCloseTo(
      6_000_000,
      2,
    );
  });

  it("jurnal akrual dengan pembalik otomatis", async () => {
    await a
      .post("/moves", {
        date: "2026-07-31",
        autoReverseDate: "2026-07-31",
        lines: [
          { accountId: acc["6-3000"], debit: 500_000 },
          { accountId: acc["2-1700"], credit: 500_000 },
        ],
      })
      .expect(400);
    const entry = (
      await a
        .post("/moves", {
          date: "2026-07-31",
          autoReverseDate: "2026-08-01",
          ref: "Akrual listrik Juli",
          lines: [
            { accountId: acc["6-3000"], debit: 500_000 },
            { accountId: acc["2-1700"], credit: 500_000 },
          ],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${entry.id}/post`).expect(200);
    expect(await balance("2-1700", "2026-07-31")).toBe(-500_000);
    expect(await balance("2-1700", "2026-08-01")).toBe(0);
  });

  let recurringId: string;
  it("jurnal berulang bulanan: validasi, buat draft saat jatuh tempo, catch-up & jumlah kali", async () => {
    const lines = [
      { accountId: acc["6-2000"], debit: "2000000" },
      { accountId: acc["2-1700"], credit: "2000000" },
    ];
    const bad = await a
      .post("/recurring-entries", {
        name: "x",
        journalId: jr.MISC,
        frequency: "monthly",
        startDate: "2026-01-31",
        lines: [lines[0], { ...lines[1], credit: "1" }],
      })
      .expect(400);
    expect(bad.body.errors[0].path).toBe("lines");
    const t = (
      await a
        .post("/recurring-entries", {
          name: "Sewa kantor",
          journalId: jr.MISC,
          frequency: "monthly",
          startDate: "2026-01-31",
          remainingCount: 4,
          lines,
        })
        .expect(201)
    ).body;
    recurringId = t.id;
    expect(t.nextDate).toBe("2026-01-31");

    const run = await scheduler.runDue("2026-03-15", [tenantId]);
    expect(run.created).toBe(2);
    const detail = (await a.get(`/recurring-entries/${t.id}`).expect(200)).body;
    expect(detail.entries.map((e: { date: string; state: string }) => [e.date, e.state])).toEqual([
      ["2026-02-28", "draft"],
      ["2026-01-31", "draft"],
    ]);
    expect(detail).toMatchObject({ nextDate: "2026-03-31", remainingCount: 2 });
    expect(detail.upcoming).toEqual(["2026-03-31", "2026-04-30"]);
    await a.delete(`/recurring-entries/${t.id}`).expect(400);
  });

  it("posting otomatis per template & berhenti setelah jumlah kali habis", async () => {
    const current = (await a.get(`/recurring-entries/${recurringId}`).expect(200)).body;
    await a
      .put(`/recurring-entries/${recurringId}`, {
        ...current,
        autoPost: true,
        lines: current.lines,
      })
      .expect(200);
    const res = (
      await a.post(`/recurring-entries/${recurringId}/generate`, { until: "2026-12-31" }).expect(200)
    ).body;
    expect(res.created).toHaveLength(2);
    expect(res.created.every((c: { name: string | null }) => c.name)).toBe(true);
    expect(res.template).toMatchObject({ active: false, nextDate: null, remainingCount: 0 });
  });

  it("jurnal berulang dengan pembalik otomatis (akrual bulanan)", async () => {
    const t = (
      await a
        .post("/recurring-entries", {
          name: "Akrual gaji harian lepas",
          journalId: jr.MISC,
          frequency: "monthly",
          startDate: "2026-09-30",
          endDate: "2026-10-31",
          autoPost: true,
          autoReverse: true,
          lines: [
            { accountId: acc["6-1000"], debit: "750000" },
            { accountId: acc["2-1500"], credit: "750000" },
          ],
        })
        .expect(201)
    ).body;
    const res = (await a.post(`/recurring-entries/${t.id}/generate`, { until: "2026-12-31" }).expect(200))
      .body;
    expect(res.created.map((c: { date: string }) => c.date)).toEqual(["2026-09-30", "2026-10-31"]);
    expect(await balance("2-1500", "2026-10-31")).toBe(-750_000);
    expect(await balance("2-1500", "2026-11-01")).toBe(0);
    expect(res.template.active).toBe(false);
  });
});
