import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  key: string;
  code?: string;
  label: string;
  amount: string;
}

describe.skipIf(!hasDb)("Laporan arus kas (metode tidak langsung)", () => {
  let app: INestApplication;
  let a: Api;
  const acc: Record<string, string> = {};
  const jr: Record<string, string> = {};

  const entry = async (date: string, lines: { accountId: string; debit?: number; credit?: number }[]) => {
    const m = (await a.post("/moves", { date, lines }).expect(201)).body;
    await a.post(`/moves/${m.id}/post`).expect(200);
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "cf");
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    const customer = (await a.post("/partners", { name: "PT Pembeli", isCustomer: true }).expect(201)).body
      .id;

    // Saldo awal sebelum periode: setoran modal 100 jt ke bank.
    await entry("2025-12-31", [
      { accountId: acc["1-1200"], debit: 100_000_000 },
      { accountId: acc["3-1000"], credit: 100_000_000 },
    ]);
    // Periode 2026: penjualan kredit 50 jt, diterima 30 jt.
    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-02-10",
          lines: [{ name: "Benih", priceUnit: 50_000_000, accountId: acc["4-1000"] }],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${inv.id}/post`).expect(200);
    await a
      .post("/payments", {
        paymentType: "inbound",
        partnerId: customer,
        journalId: jr.BNK1,
        amount: 30_000_000,
        date: "2026-03-01",
        moveIds: [inv.id],
      })
      .expect(201);
    // Beli traktor tunai 40 jt, penyusutan 2 jt, beban sewa tunai 5 jt, pinjaman bank 20 jt.
    await entry("2026-03-05", [
      { accountId: acc["1-2200"], debit: 40_000_000 },
      { accountId: acc["1-1200"], credit: 40_000_000 },
    ]);
    await entry("2026-06-30", [
      { accountId: acc["6-4000"], debit: 2_000_000 },
      { accountId: acc["1-2290"], credit: 2_000_000 },
    ]);
    await entry("2026-04-01", [
      { accountId: acc["6-2000"], debit: 5_000_000 },
      { accountId: acc["1-1200"], credit: 5_000_000 },
    ]);
    await entry("2026-05-01", [
      { accountId: acc["1-1200"], debit: 20_000_000 },
      { accountId: acc["2-2100"], credit: 20_000_000 },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("menyusun arus kas operasi, investasi, pendanaan yang cocok dengan perubahan kas", async () => {
    const r = (await a.get("/reports/cash-flow?dateFrom=2026-01-01&dateTo=2026-12-31").expect(200)).body;
    const amount = (lines: Line[], key: string) => lines.find((l) => l.key === key || l.code === key)?.amount;
    expect(amount(r.operating.lines, "net_profit")).toBe("43000000.00"); // 50 − 5 − 2
    expect(amount(r.operating.lines, "depreciation")).toBe("2000000.00");
    expect(amount(r.operating.lines, "1-1300")).toBe("-20000000.00");
    expect(r.operating.total).toBe("25000000.00");
    expect(r.investing.total).toBe("-40000000.00");
    expect(r.financing.total).toBe("20000000.00");
    expect(r).toMatchObject({
      cashOpening: "100000000.00",
      cashClosing: "105000000.00",
      netChange: "5000000.00",
      difference: "0.00",
    });
  });

  it("pemetaan per akun memindahkan akun ke kelompok lain", async () => {
    const account = (await a.get(`/accounts/${acc["2-2100"]}`).expect(200)).body;
    await a.patch(`/accounts/${acc["2-2100"]}`, { ...account, cashFlowCategory: "operating" }).expect(200);
    const r = (await a.get("/reports/cash-flow?dateFrom=2026-01-01&dateTo=2026-12-31").expect(200)).body;
    expect(r.financing.total).toBe("0.00");
    expect(r.operating.total).toBe("45000000.00");
    expect(r.difference).toBe("0.00");
    await a.patch(`/accounts/${acc["2-2100"]}`, { ...account, cashFlowCategory: null }).expect(200);
  });

  it("filter periode & ekspor Excel", async () => {
    const q1 = (await a.get("/reports/cash-flow?dateFrom=2026-01-01&dateTo=2026-03-31").expect(200)).body;
    expect(q1).toMatchObject({ cashOpening: "100000000.00", cashClosing: "90000000.00", difference: "0.00" });
    const res = await a.get("/reports/cash-flow/export?dateFrom=2026-01-01&dateTo=2026-12-31").expect(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });
});
