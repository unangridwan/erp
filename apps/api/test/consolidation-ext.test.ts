import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

type Api = ReturnType<typeof client>;
interface Row {
  code: string;
  byCompany: Record<string, string>;
  consolidated: string;
}
type Line = [code: string, debit: number, credit: number, extra?: { partnerId?: string; branchId?: string }];

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = businessToday();
const D0 = addDays(today, -200);
const MID = addDays(today, -100);

/**
 * Grup HQ (IDR):
 * - S: 60% sejak D0, naik ke 80% sejak MID (harga 250.000, aset neto = nilai buku); menjual barang ke HQ dan
 *   membagi dividen.
 * - D: 100% sejak D0, dijual seluruhnya pada MID (laba di buku HQ 100.000).
 * - F: 100% (USD) sejak D0; ekuitas dijabarkan dengan kurs tanggal setoran.
 */
describe.skipIf(!hasDb)("Fase 5b lanjutan: konsolidasi grup", () => {
  let app: INestApplication;
  let hq: Api & { slug: string };
  const id: Record<string, string> = {};
  const api: Record<string, Api> = {};
  const ic: Record<string, string> = {};
  let product: string;
  let mainRun: string;

  const accounts = async (company: string) =>
    Object.fromEntries(
      (
        (await api[company]!.get("/accounts?limit=200").expect(200)).body.items as {
          code: string;
          id: string;
        }[]
      ).map((a) => [a.code, a.id]),
    );
  const entry = async (company: string, date: string, lines: Line[]) => {
    const acc = await accounts(company);
    const move = (
      await api[company]!.post("/moves", {
        date,
        lines: lines.map(([code, debit, credit, extra]) => ({
          accountId: acc[code],
          debit,
          credit,
          ...extra,
        })),
      }).expect(201)
    ).body;
    await api[company]!.post(`/moves/${move.id}/post`).expect(200);
  };
  const invoice = async (
    company: string,
    moveType: string,
    partnerId: string,
    code: string,
    amount: number,
  ) => {
    const acc = await accounts(company);
    const move = (
      await api[company]!.post("/moves", {
        moveType,
        partnerId,
        date: today,
        lines: [{ name: "Barang dagang", quantity: 1, priceUnit: amount, accountId: acc[code] }],
      }).expect(201)
    ).body;
    await api[company]!.post(`/moves/${move.id}/post`).expect(200);
  };
  const picking = async (
    company: string,
    pickingType: string,
    partnerId: string,
    quantity: string,
    priceUnit?: string,
  ) => {
    const p = (
      await api[company]!.post("/pickings", {
        pickingType,
        scheduledDate: today,
        partnerId,
        moves: [{ productId: product, quantity, ...(priceUnit ? { priceUnit } : {}) }],
      }).expect(201)
    ).body;
    await api[company]!.post(`/pickings/${p.id}/validate`, {}).expect(200);
  };
  const rows = async (runId: string) =>
    (await hq.get(`/consolidation/runs/${runId}/worksheet`).expect(200)).body.rows as Row[];
  const consolidated = (list: Row[], code: string) =>
    list.find((r) => r.code === code)?.consolidated ?? "0.00";

  beforeAll(async () => {
    app = await createApp();
    hq = await signup(app, "konsx");
    const me = (await hq.get("/auth/me")).body;
    id.HQ = me.activeCompanyId;
    for (const [code, name, currencyCode] of [
      ["S", "PT Dagang Anak", "IDR"],
      ["D", "PT Dilepas", "IDR"],
      ["F", "F Overseas Ltd", "USD"],
    ] as const) {
      id[code] = (
        await hq
          .post("/companies", { code, name, entityType: "subsidiary", currencyCode, parentId: id.HQ })
          .expect(201)
      ).body.id;
    }
    for (const c of ["HQ", "S", "D", "F"]) api[c] = client(app, hq.token, id[c]);
    await hq.post("/currency-rates", { currencyCode: "USD", rateDate: D0, rate: 16000 }).expect(201);
    await hq
      .post("/currency-rates", { currencyCode: "USD", rateDate: addDays(today, -5), rate: 17000 })
      .expect(201);
    const partners = (await hq.get("/partners?limit=200&active=all").expect(200)).body.items as {
      id: string;
      icCompanyId: string | null;
    }[];
    for (const c of ["HQ", "S"]) ic[c] = partners.find((p) => p.icCompanyId === id[c])!.id;

    const own = (child: string, pct: number, validFrom: string, extra: object = {}) =>
      hq
        .post("/ownerships", {
          parentCompanyId: id.HQ,
          childCompanyId: id[child],
          pct,
          method: "full",
          validFrom,
          ...extra,
        })
        .expect(201);
    await own("S", 60, D0, {
      validTo: addDays(MID, -1),
      consideration: "600000",
      acquiredNetAssets: "1000000",
    });
    await own("S", 80, MID, { consideration: "250000" });
    await own("D", 100, D0, { validTo: MID, consideration: "300000", acquiredNetAssets: "300000" });
    await own("F", 100, D0, { consideration: "1600000", acquiredNetAssets: "1600000" });

    // Setoran modal & investasi.
    await entry("HQ", D0, [
      ["1-1200", 5_000_000, 0],
      ["3-1000", 0, 5_000_000],
    ]);
    await entry("HQ", D0, [
      ["1-3100", 2_500_000, 0],
      ["1-1200", 0, 2_500_000],
    ]);
    await entry("S", D0, [
      ["1-1200", 1_000_000, 0],
      ["3-1000", 0, 1_000_000],
    ]);
    await entry("D", D0, [
      ["1-1200", 300_000, 0],
      ["3-1000", 0, 300_000],
    ]);
    await entry("F", D0, [
      ["1-1200", 100, 0],
      ["3-1000", 0, 100],
    ]);
    // Laba S sebelum & sesudah kenaikan kepemilikan; laba D sebelum dilepas.
    await entry("S", addDays(D0, 30), [
      ["1-1200", 100_000, 0],
      ["4-1100", 0, 100_000],
    ]);
    await entry("D", addDays(D0, 20), [
      ["1-1200", 50_000, 0],
      ["4-1100", 0, 50_000],
    ]);
    await entry("S", addDays(MID, 10), [
      ["1-1200", 200_000, 0],
      ["4-1100", 0, 200_000],
    ]);
    // HQ membeli tambahan 20% S dan menjual seluruh D.
    await entry("HQ", MID, [
      ["1-3100", 250_000, 0],
      ["1-1200", 0, 250_000],
    ]);
    await entry("HQ", MID, [
      ["1-1200", 400_000, 0],
      ["1-3100", 0, 300_000],
      ["4-9400", 0, 100_000],
    ]);
    // Dividen S: 50.000 ke HQ (antar perusahaan), 12.500 ke pemegang saham lain.
    await entry("S", addDays(MID, 20), [
      ["3-3000", 50_000, 0, { partnerId: ic.HQ }],
      ["3-3000", 12_500, 0],
      ["1-1200", 0, 62_500],
    ]);
    await entry("HQ", addDays(MID, 20), [
      ["1-1200", 50_000, 0],
      ["4-9000", 0, 50_000, { partnerId: ic.S }],
    ]);

    // Barang: S membeli 10 @10.000, menjual ke HQ @15.000; HQ menjual 4 ke pelanggan @20.000.
    const uom = (await hq.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    product = (await hq.post("/products", { uomId: uom, sku: "BRG", name: "Barang Grup" }).expect(201)).body
      .id;
    const vendor = (await api.S!.post("/partners", { name: "Pemasok Luar", isSupplier: true }).expect(201))
      .body.id;
    const customer = (await hq.post("/partners", { name: "Pelanggan Luar", isCustomer: true }).expect(201))
      .body.id;
    await picking("S", "incoming", vendor, "10", "10000");
    await picking("S", "outgoing", ic.HQ, "10");
    await invoice("S", "out_invoice", ic.HQ, "4-1000", 150_000);
    await picking("HQ", "incoming", ic.S, "10", "15000");
    await invoice("HQ", "in_invoice", ic.S, "2-1800", 150_000);
    await picking("HQ", "outgoing", customer, "4");
    await invoice("HQ", "out_invoice", customer, "4-1000", 80_000);

    await hq.post("/consolidation/bootstrap").expect(200);
  });

  afterAll(() => app?.close());

  it("struktur: akuisisi bertahap, entitas dilepas, tanggal akuisisi", async () => {
    const s = (await hq.get(`/consolidation/structure?dateFrom=${D0}&dateTo=${today}`).expect(200)).body;
    const by = Object.fromEntries(s.entities.map((e: { companyId: string }) => [e.companyId, e]));
    expect(by[id.S!]).toMatchObject({ effectivePct: "80", acquisitionDate: D0, disposalDate: null });
    expect(by[id.S!].links[0].changes).toEqual([
      expect.objectContaining({ date: MID, pctBefore: "60.0000", pctAfter: "80.0000", inPeriod: true }),
    ]);
    expect(by[id.D!]).toMatchObject({ method: "full", disposalDate: MID });
  });

  it("proses: perubahan kepemilikan, pelepasan, dividen, laba belum terealisasi, kurs per tanggal", async () => {
    const run = (
      await hq.post("/consolidation/runs", { rootCompanyId: id.HQ, dateFrom: D0, dateTo: today }).expect(201)
    ).body;
    mainRun = run.id;
    expect(run.warnings).toEqual([]);
    expect(run.openingSource).toBe("computed");
    expect(run.entities.find((e: { companyId: string }) => e.companyId === id.D)).toMatchObject({
      disposalDate: MID,
    });
    expect(run.entries.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining(["investment", "nci_profit", "intercompany", "unrealized_profit"]),
    );

    const list = await rows(mainRun);
    expect(consolidated(list, "1-3100")).toBe("0.00");
    expect(consolidated(list, "1-3900")).toBe("0.00");
    expect(consolidated(list, "3-8300")).toBe("30000.00"); // 250.000 − 20% × 1.100.000
    expect(consolidated(list, "5-1000")).toBe("40000.00"); // 4 unit × biaya grup 10.000
    expect(consolidated(list, "1-1400")).toBe("60000.00"); // 6 unit × 10.000
    expect(consolidated(list, "4-9000")).toBe("0.00"); // dividen S ke HQ dieliminasi
    expect(consolidated(list, "4-9400")).toBe("-50000.00"); // laba pelepasan grup 400.000 − 350.000
    expect(consolidated(list, "3-8100")).toBe("-100000.00"); // F: kas 100 USD × 17.000 − modal × 16.000
    expect(list.find((r) => r.code === "3-1000")!.byCompany[id.F!]).toBe("-1600000.00");

    const report = (await hq.get(`/consolidation/runs/${mainRun}/report`).expect(200)).body;
    expect(report.profitLoss).toMatchObject({
      netProfit: "440000.00",
      attributableToNci: "84000.00", // 40% × 100.000 + 20% × 250.000 − 20% × 30.000
      attributableToOwners: "356000.00",
    });
    expect(report.balanceSheet).toMatchObject({
      nonControllingInterest: "251500.00",
      totalEquity: "5677500.00",
      difference: "0.00",
    });
    const closing = report.equityChanges.rows.find((r: { key: string }) => r.key === "closing").values;
    expect(closing).toMatchObject({ owners: "5426000.00", nci: "251500.00", total: "5677500.00" });
    // Dividen S ke HQ antar perusahaan; induk sendiri tidak membagi dividen.
    expect(
      report.equityChanges.rows.find((r: { key: string }) => r.key === "dividends").values.retained,
    ).toBe("0.00");
    expect(report.cashFlow).toMatchObject({
      cashOpening: "0.00",
      cashClosing: "5637500.00",
      difference: "0.00",
    });

    const xlsx = await hq.get(`/consolidation/runs/${mainRun}/export`).expect(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
  });

  it("saldo awal dari proses final periode sebelumnya", async () => {
    const first = (
      await hq
        .post("/consolidation/runs", { rootCompanyId: id.HQ, dateFrom: D0, dateTo: addDays(MID, -1) })
        .expect(201)
    ).body;
    const firstReport = (await hq.get(`/consolidation/runs/${first.id}/report`).expect(200)).body;
    expect(firstReport.balanceSheet.difference).toBe("0.00");
    await hq.post(`/consolidation/runs/${first.id}/finalize`).expect(200);

    const second = (
      await hq.post("/consolidation/runs", { rootCompanyId: id.HQ, dateFrom: MID, dateTo: today }).expect(201)
    ).body;
    expect(second).toMatchObject({ openingSource: "previous_run", openingRunId: first.id });
    // Pelepasan D di awal periode: laba sejak akuisisi (50.000) direklasifikasi dari laba pelepasan ke saldo laba.
    const disposal = second.entries.find((e: { kind: string }) => e.kind === "disposal");
    expect(disposal.lines).toEqual(expect.arrayContaining([expect.objectContaining({ amount: "50000.00" })]));
    const report = (await hq.get(`/consolidation/runs/${second.id}/report`).expect(200)).body;
    expect(report.balanceSheet.difference).toBe("0.00");
    expect(report.cashFlow.difference).toBe("0.00");
    const eq = report.equityChanges.rows;
    expect(eq.find((r: { key: string }) => r.key === "opening").values.total).toBe(
      firstReport.balanceSheet.totalEquity,
    );
    expect(eq.find((r: { key: string }) => r.key === "closing").values.total).toBe(
      report.balanceSheet.totalEquity,
    );
    expect(report.balanceSheet.totalEquity).toBe("5677500.00");
  });

  it("RK pusat–cabang: laporan rekonsiliasi & peringatan konsolidasi", async () => {
    const branch = (
      await hq.post("/branches", { companyId: id.HQ, code: "SBY", name: "Cabang Surabaya" }).expect(201)
    ).body.id;
    await entry("HQ", today, [
      ["1-1900", 100_000, 0],
      ["1-1200", 0, 100_000],
    ]);
    const open = (await hq.get(`/reports/branch-clearing?dateTo=${today}`).expect(200)).body;
    expect(open).toMatchObject({ total: "100000.00", balanced: false });
    const recomputed = (await hq.post(`/consolidation/runs/${mainRun}/compute`, {}).expect(200)).body;
    expect(recomputed.warnings.some((w: string) => w.includes("RK pusat–cabang"))).toBe(true);

    await entry("HQ", today, [
      ["1-1200", 100_000, 0, { branchId: branch }],
      ["1-1900", 0, 100_000, { branchId: branch }],
    ]);
    const done = (await hq.get(`/reports/branch-clearing?dateTo=${today}`).expect(200)).body;
    expect(done).toMatchObject({ total: "0.00", balanced: true });
    expect(done.accounts[0].branches.map((b: { branch: string }) => b.branch)).toEqual([
      "Kantor pusat (tanpa cabang)",
      "Cabang Surabaya",
    ]);
    const xlsx = await hq.get(`/reports/branch-clearing/export?dateTo=${today}`).expect(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
  });
});
