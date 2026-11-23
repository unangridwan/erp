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
interface Segment {
  key: string;
  name: string;
  income: string;
  netProfit: string;
}
type Line = [code: string, debit: number, credit: number, extra?: { businessUnitId?: string }];

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
 * - S: asosiasi 30% sejak D0 (biaya 300.000), dikendalikan 80% sejak MID (tambahan 600.000; aset neto 1.000.000;
 *   nilai wajar kepemilikan 30% sebelumnya 360.000).
 * - F: 100% (USD) sejak D0, goodwill 100.000 pada kurs 16.000.
 * - G: 100% (USD) sejak D0, dijual seluruhnya pada MID.
 * - A: asosiasi 25%; HQ menjual barang ke A yang belum dijual kembali.
 */
describe.skipIf(!hasDb)("Fase 5b: item tunda konsolidasi", () => {
  let app: INestApplication;
  let hq: Api & { slug: string };
  const id: Record<string, string> = {};
  const api: Record<string, Api> = {};
  const ic: Record<string, string> = {};
  let retail: string;
  let runId: string;

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
  const consolidated = (list: Row[], code: string) =>
    list.find((r) => r.code === code)?.consolidated ?? "0.00";

  beforeAll(async () => {
    app = await createApp();
    hq = await signup(app, "konsd");
    id.HQ = (await hq.get("/auth/me")).body.activeCompanyId;
    for (const [code, name, currencyCode, entityType] of [
      ["S", "PT Bertahap", "IDR", "subsidiary"],
      ["F", "F Overseas Ltd", "USD", "subsidiary"],
      ["G", "G Divested Ltd", "USD", "subsidiary"],
      ["A", "PT Asosiasi", "IDR", "associate"],
    ] as const) {
      id[code] = (
        await hq.post("/companies", { code, name, entityType, currencyCode, parentId: id.HQ }).expect(201)
      ).body.id;
    }
    for (const c of ["HQ", "S", "F", "G", "A"]) api[c] = client(app, hq.token, id[c]);
    for (const [date, rate] of [
      [D0, 16000],
      [addDays(MID, -10), 16500],
      [addDays(today, -5), 17000],
    ] as const)
      await hq.post("/currency-rates", { currencyCode: "USD", rateDate: date, rate }).expect(201);
    const partners = (await hq.get("/partners?limit=200&active=all").expect(200)).body.items as {
      id: string;
      icCompanyId: string | null;
    }[];
    for (const c of ["HQ", "A"]) ic[c] = partners.find((p) => p.icCompanyId === id[c])!.id;
    retail = (await hq.post("/business-units", { code: "RTL", name: "Ritel" }).expect(201)).body.id;

    const own = (child: string, pct: number, method: string, validFrom: string, extra: object = {}) =>
      hq
        .post("/ownerships", {
          parentCompanyId: id.HQ,
          childCompanyId: id[child],
          pct,
          method,
          validFrom,
          ...extra,
        })
        .expect(201);
    await own("S", 30, "equity", D0, {
      validTo: addDays(MID, -1),
      consideration: "300000",
      acquiredNetAssets: "900000",
    });
    await own("S", 80, "full", MID, {
      consideration: "600000",
      acquiredNetAssets: "1000000",
      previousInterestFairValue: "360000",
    });
    await own("F", 100, "full", D0, { consideration: "1700000", acquiredNetAssets: "1600000" });
    await own("G", 100, "full", D0, { validTo: MID, consideration: "1600000", acquiredNetAssets: "1600000" });
    await own("A", 25, "equity", D0, { consideration: "250000", acquiredNetAssets: "1000000" });

    await entry("HQ", D0, [
      ["1-1200", 10_000_000, 0],
      ["3-1000", 0, 10_000_000],
    ]);
    await entry("HQ", D0, [
      ["1-3100", 3_850_000, 0],
      ["1-1200", 0, 3_850_000],
    ]);
    await entry("S", D0, [
      ["1-1200", 900_000, 0],
      ["3-1000", 0, 900_000],
    ]);
    await entry("S", addDays(D0, 30), [
      ["1-1200", 100_000, 0],
      ["4-1100", 0, 100_000],
    ]);
    for (const c of ["F", "G"])
      await entry(c, D0, [
        ["1-1200", 100, 0],
        ["3-1000", 0, 100],
      ]);
    await entry("G", addDays(D0, 20), [
      ["1-1200", 10, 0],
      ["4-1100", 0, 10],
    ]);
    await entry("A", D0, [
      ["1-1200", 1_000_000, 0],
      ["3-1000", 0, 1_000_000],
    ]);
    await entry("A", addDays(D0, 5), [
      ["1-1200", 40_000, 0],
      ["4-1100", 0, 40_000],
    ]);
    // HQ: tambahan 50% S dan penjualan G (laba di buku HQ 300.000).
    await entry("HQ", MID, [
      ["1-3100", 600_000, 0],
      ["1-1200", 0, 600_000],
    ]);
    await entry("HQ", MID, [
      ["1-1200", 1_900_000, 0],
      ["1-3100", 0, 1_600_000],
      ["4-9400", 0, 300_000],
    ]);
    // S setelah pengendalian: penjualan ritel 150.000 (unit bisnis) + 50.000 tanpa unit; beban ritel 40.000.
    await entry("S", addDays(MID, 10), [
      ["1-1200", 200_000, 0],
      ["4-1100", 0, 150_000, { businessUnitId: retail }],
      ["4-1100", 0, 50_000],
    ]);
    await entry("S", addDays(MID, 12), [
      ["6-1100", 40_000, 0, { businessUnitId: retail }],
      ["1-1200", 0, 40_000],
    ]);

    // Downstream: HQ membeli 10 @10.000 dan mengirim ke A; A menerimanya @15.000 (belum dijual).
    const uom = (await hq.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (await hq.post("/products", { uomId: uom, sku: "BRG", name: "Barang" }).expect(201)).body
      .id;
    const vendor = (await hq.post("/partners", { name: "Pemasok", isSupplier: true }).expect(201)).body.id;
    const picking = async (company: string, pickingType: string, partnerId: string, priceUnit?: string) => {
      const p = (
        await api[company]!.post("/pickings", {
          pickingType,
          scheduledDate: today,
          partnerId,
          moves: [{ productId: product, quantity: "10", ...(priceUnit ? { priceUnit } : {}) }],
        }).expect(201)
      ).body;
      await api[company]!.post(`/pickings/${p.id}/validate`, {}).expect(200);
    };
    await picking("HQ", "incoming", vendor, "10000");
    await picking("HQ", "outgoing", ic.A!);
    await picking("A", "incoming", ic.HQ!, "15000");

    await hq.post("/consolidation/bootstrap").expect(200);
    const run = (
      await hq.post("/consolidation/runs", { rootCompanyId: id.HQ, dateFrom: D0, dateTo: today }).expect(201)
    ).body;
    runId = run.id;
  });

  afterAll(() => app?.close());

  it("struktur: kepemilikan sebelum pengendalian & nilai wajarnya", async () => {
    const s = (await hq.get(`/consolidation/structure?dateFrom=${D0}&dateTo=${today}`).expect(200)).body;
    const S = s.entities.find((e: { companyId: string }) => e.companyId === id.S);
    expect(S).toMatchObject({ method: "full", acquisitionDate: MID });
    expect(S.links[0]).toMatchObject({
      consideration: "900000.00",
      previousFairValue: "360000.00",
      previousCost: "300000.00",
      previous: [{ validFrom: D0, validTo: addDays(MID, -1), pct: "30.0000", method: "equity" }],
    });
  });

  it("goodwill asing, pengukuran ulang, reklasifikasi CTA, asosiasi", async () => {
    const run = (await hq.get(`/consolidation/runs/${runId}`).expect(200)).body;
    expect(run.warnings).toEqual([]);
    const list = (await hq.get(`/consolidation/runs/${runId}/worksheet`).expect(200)).body.rows as Row[];
    // S: 900.000 − 80% × 1.000.000 + (360.000 − 300.000); F: 100.000 × 17.000 / 16.000.
    expect(consolidated(list, "1-3900")).toBe("266250.00");
    // Laba pengukuran ulang = kenaikan 60.000 − bagian laba ekuitas 30% × 100.000 yang sudah diakui.
    expect(consolidated(list, "4-9700")).toBe("-30000.00");
    // F: kas 100 USD × 17.000 − modal × 16.000, ditambah selisih penjabaran goodwill 6.250.
    expect(consolidated(list, "3-8100")).toBe("-106250.00");
    // G: aset neto 110 USD × 16.500 − modal 100 × 16.000 − laba 10 × kurs rata-rata 16.250.
    expect(consolidated(list, "4-9600")).toBe("-52500.00");

    const upe = run.entries.find(
      (e: { kind: string; companyId: string | null }) => e.kind === "unrealized_profit",
    );
    expect(upe.description).toMatch(/asosiasi/i);
    const assocLines = upe.lines as { amount: string }[];
    expect(assocLines.map((l) => l.amount).sort()).toEqual(["-12500.00", "12500.00"]); // 25% × 10 × 5.000

    const report = (await hq.get(`/consolidation/runs/${runId}/report`).expect(200)).body;
    expect(report.balanceSheet.difference).toBe("0.00");
    const reclass = report.equityChanges.rows.find((r: { key: string }) => r.key === "reclassification");
    expect(reclass.values.cta).toBe("-52500.00"); // cadangan kurs berkurang
  });

  it("laporan segmen per unit bisnis & per perusahaan merekonsiliasi ke konsolidasian", async () => {
    const report = (await hq.get(`/consolidation/runs/${runId}/report`).expect(200)).body;
    for (const by of ["business_unit", "company", "branch"]) {
      const seg = (await hq.get(`/consolidation/runs/${runId}/segments?by=${by}`).expect(200)).body as {
        segments: Segment[];
        eliminations: Segment;
        total: Segment;
      };
      expect(seg.total.netProfit).toBe(report.profitLoss.netProfit);
      const sum = seg.segments.reduce((s, x) => s + Number(x.netProfit), Number(seg.eliminations.netProfit));
      expect(sum.toFixed(2)).toBe(seg.total.netProfit);
      if (by === "business_unit")
        expect(seg.segments.find((x) => x.key === retail)).toMatchObject({
          name: "RTL — Ritel",
          income: "150000.00",
          netProfit: "110000.00",
        });
      if (by === "company")
        expect(seg.segments.find((x) => x.key === id.S)).toMatchObject({ income: "200000.00" });
    }
    await hq.get(`/consolidation/runs/${runId}/segments?by=region`).expect(400);
  });
});
