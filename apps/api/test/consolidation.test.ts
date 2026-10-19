import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Row {
  code: string;
  role: string | null;
  byCompany: Record<string, string>;
  total: string;
  adjustments: string;
  consolidated: string;
}

/**
 * Grup: holding HQ (IDR) memiliki 100% A (IDR), 80% B (USD), 30% asosiasi C (IDR).
 * A menjual jasa Rp200.000 ke B (antar perusahaan). Angka diharapkan dihitung manual.
 */
describe.skipIf(!hasDb)("Fase 5b: konsolidasi grup", () => {
  let app: INestApplication;
  let hq: Api & { slug: string };
  let token: string;
  const id: Record<string, string> = {};
  const api: Record<string, Api> = {};
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
  const entry = async (company: string, date: string, lines: [string, number, number][]) => {
    const acc = await accounts(company);
    const move = (
      await api[company]!.post("/moves", {
        date,
        lines: lines.map(([code, debit, credit]) => ({ accountId: acc[code], debit, credit })),
      }).expect(201)
    ).body;
    await api[company]!.post(`/moves/${move.id}/post`).expect(200);
  };
  const icPartner = async (company: string) =>
    (
      (await hq.get("/partners?limit=200&active=all").expect(200)).body.items as {
        id: string;
        icCompanyId: string;
      }[]
    ).find((p) => p.icCompanyId === id[company])!.id;
  const row = (rows: Row[], code: string) => rows.find((r) => r.code === code);

  beforeAll(async () => {
    app = await createApp();
    hq = await signup(app, "kons");
    token = hq.token;
    const me = (await hq.get("/auth/me")).body;
    id.HQ = me.activeCompanyId;
    for (const [code, name, entityType, currencyCode] of [
      ["A", "PT Anak Satu", "subsidiary", "IDR"],
      ["B", "B Global Ltd", "subsidiary", "USD"],
      ["C", "PT Asosiasi", "associate", "IDR"],
    ] as const) {
      id[code] = (
        await hq.post("/companies", { code, name, entityType, currencyCode, parentId: id.HQ }).expect(201)
      ).body.id;
    }
    for (const c of ["HQ", "A", "B", "C"]) api[c] = client(app, token, id[c]);
    await hq
      .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-01-01", rate: 16000 })
      .expect(201);

    const own = (child: string, pct: number, method: string, extra: object = {}) =>
      hq
        .post("/ownerships", {
          parentCompanyId: id.HQ,
          childCompanyId: id[child],
          pct,
          method,
          validFrom: "2026-01-01",
          ...extra,
        })
        .expect(201);
    await own("A", 100, "full", { consideration: "1000000", acquiredNetAssets: "1000000" });
    await own("B", 80, "full", { consideration: "1300000", acquiredNetAssets: "1500000" });
    await own("C", 30, "equity");

    await entry("HQ", "2026-01-01", [
      ["1-1200", 10_000_000, 0],
      ["3-1000", 0, 10_000_000],
    ]);
    await entry("HQ", "2026-01-02", [
      ["1-3100", 2_300_000, 0],
      ["1-3200", 300_000, 0],
      ["1-1200", 0, 2_600_000],
    ]);
    await entry("HQ", "2026-03-01", [
      ["1-1200", 3_000_000, 0],
      ["4-1000", 0, 3_000_000],
    ]);
    await entry("A", "2026-01-01", [
      ["1-1200", 1_000_000, 0],
      ["3-1000", 0, 1_000_000],
    ]);
    await entry("B", "2026-01-01", [
      ["1-1200", 100, 0],
      ["3-1000", 0, 100],
    ]);
    await entry("C", "2026-01-01", [
      ["1-1200", 1_000_000, 0],
      ["3-1000", 0, 1_000_000],
    ]);
    await entry("C", "2026-04-01", [
      ["1-1200", 500_000, 0],
      ["4-1000", 0, 500_000],
    ]);

    // Penjualan antar perusahaan A → B (Rp200.000; di buku B = USD 12,5).
    const aAcc = await accounts("A");
    const inv = (
      await api
        .A!.post("/moves", {
          moveType: "out_invoice",
          partnerId: await icPartner("B"),
          date: "2026-06-30",
          lines: [{ name: "Jasa manajemen", quantity: 1, priceUnit: 200_000, accountId: aAcc["4-1200"] }],
        })
        .expect(201)
    ).body;
    await api.A!.post(`/moves/${inv.id}/post`).expect(200);
    const bAcc = await accounts("B");
    const bill = (
      await api
        .B!.post("/moves", {
          moveType: "in_invoice",
          partnerId: await icPartner("A"),
          date: "2026-06-30",
          currencyCode: "IDR",
          lines: [{ name: "Jasa manajemen", quantity: 1, priceUnit: 200_000, accountId: bAcc["6-7000"] }],
        })
        .expect(201)
    ).body;
    await api.B!.post(`/moves/${bill.id}/post`).expect(200);
  });

  afterAll(() => app?.close());

  it("bagan akun grup & pemetaan otomatis", async () => {
    const res = (await hq.post("/consolidation/bootstrap").expect(200)).body;
    expect(res.created).toBeGreaterThan(50);
    expect(res.mapped).toBeGreaterThan(200);
    const groups = (await hq.get("/group-accounts?limit=200").expect(200)).body.items as {
      code: string;
      role: string;
    }[];
    expect(Object.fromEntries(groups.filter((g) => g.role).map((g) => [g.role, g.code]))).toEqual({
      investment: "1-3100",
      associate_investment: "1-3200",
      retained_earnings: "3-2000",
      goodwill: "1-3900",
      ic_difference: "2-9900",
      nci_equity: "3-8000",
      cta: "3-8100",
      nci_profit: "3-8200",
      associate_income: "4-9300",
    });
    expect((await hq.post("/consolidation/bootstrap").expect(200)).body).toMatchObject({
      created: 0,
      mapped: 0,
    });
    const mapping = (await hq.get(`/consolidation/mapping?companyId=${id.B}`).expect(200)).body;
    expect(mapping.every((m: { groupAccountId: string | null }) => m.groupAccountId)).toBe(true);
  });

  it("struktur: metode & kepemilikan efektif, kurs dari Kurs Harian", async () => {
    const s = (await hq.get("/consolidation/structure?dateTo=2026-06-30").expect(200)).body;
    const byCompany = Object.fromEntries(s.entities.map((e: { companyId: string }) => [e.companyId, e]));
    expect(byCompany[id.B!]).toMatchObject({ method: "full", effectivePct: "80", closingRate: "16000" });
    expect(byCompany[id.C!]).toMatchObject({ method: "equity", effectivePct: "30" });
  });

  it("proses: translasi, eliminasi investasi & antar perusahaan, KNP, metode ekuitas", async () => {
    const run = (
      await hq
        .post("/consolidation/runs", {
          rootCompanyId: id.HQ,
          dateTo: "2026-06-30",
          rates: [{ companyId: id.B, historicalRate: "15000" }],
        })
        .expect(201)
    ).body;
    runId = run.id;
    expect(run).toMatchObject({ state: "draft", dateFrom: "2026-01-01", currencyCode: "IDR", warnings: [] });
    expect(run.entries.map((e: { kind: string }) => e.kind).sort()).toEqual([
      "equity_method",
      "intercompany",
      "investment",
      "investment",
      "nci_profit",
    ]);

    const ws = (await hq.get(`/consolidation/runs/${runId}/worksheet`).expect(200)).body;
    expect(ws.columns.map((c: { name: string }) => c.name).sort()).toEqual(
      ["B Global Ltd", "PT Anak Satu", `PT ${hq.slug}`].sort(),
    );
    const rows = ws.rows as Row[];
    expect(row(rows, "1-1200")!.byCompany[id.B!]).toBe("1600000.00");
    expect(row(rows, "3-1000")!.byCompany[id.B!]).toBe("-1500000.00");
    expect(row(rows, "3-8100")!.byCompany[id.B!]).toBe("-100000.00");
    expect(row(rows, "1-3100")!.consolidated).toBe("0.00");
    expect(row(rows, "1-1310")!.consolidated).toBe("0.00");
    expect(row(rows, "2-1110")!.consolidated).toBe("0.00");
    expect(row(rows, "1-3900")!.consolidated).toBe("100000.00"); // 1.300.000 − 80% × 1.500.000
    expect(row(rows, "3-8100")!.consolidated).toBe("-80000.00"); // bagian induk atas selisih kurs
    expect(row(rows, "3-8000")!.consolidated).toBe("-280000.00"); // 20% × 1.600.000 − 20% × rugi 200.000
    expect(row(rows, "1-3200")!.consolidated).toBe("450000.00"); // 300.000 + 30% × 500.000

    const report = (await hq.get(`/consolidation/runs/${runId}/report`).expect(200)).body;
    expect(report.profitLoss).toMatchObject({
      netProfit: "3150000.00",
      attributableToNci: "-40000.00",
      attributableToOwners: "3190000.00",
    });
    expect(report.balanceSheet).toMatchObject({
      nonControllingInterest: "280000.00",
      totalEquity: "13550000.00",
      difference: "0.00",
    });
    expect(report.balanceSheet.assets.total).toBe("13550000.00");

    const ic = (await hq.get(`/consolidation/runs/${runId}/intercompany`).expect(200)).body;
    expect(ic.balances).toEqual([expect.objectContaining({ difference: "0.00" })]);
    expect(ic.transactions).toEqual([expect.objectContaining({ difference: "0.00" })]);

    const csv = await hq.get(`/consolidation/runs/${runId}/worksheet?format=csv`).expect(200);
    expect(csv.text).toContain("Eliminasi & penyesuaian");
  });

  it("akun belum dipetakan, jurnal manual, finalisasi", async () => {
    const a = await accounts("A");
    const extra = (
      await api
        .A!.post("/accounts", { code: "6-9999", name: "Beban Khusus A", accountType: "expense" })
        .expect(201)
    ).body.id;
    await entry("A", "2026-05-01", [
      ["6-9999", 50_000, 0],
      ["1-1200", 0, 50_000],
    ]);
    void a;
    const unmapped = (await hq.post(`/consolidation/runs/${runId}/compute`, {}).expect(400)).body;
    expect(unmapped.errors[0].message).toContain("6-9999");
    await hq.post("/consolidation/mapping/auto").expect(200);
    const mapping = (await hq.get(`/consolidation/mapping?companyId=${id.A}`).expect(200)).body;
    expect(mapping.find((m: { accountId: string }) => m.accountId === extra).groupAccountId).toBeTruthy();
    const recomputed = (await hq.post(`/consolidation/runs/${runId}/compute`, {}).expect(200)).body;
    // Kurs historis manual tetap dipakai saat hitung ulang.
    expect(recomputed.entities.find((e: { companyId: string }) => e.companyId === id.B).historicalRate).toBe(
      "15000.0000000000",
    );

    const groups = Object.fromEntries(
      (
        (await hq.get("/group-accounts?limit=200").expect(200)).body.items as { code: string; id: string }[]
      ).map((g) => [g.code, g.id]),
    );
    await hq
      .post(`/consolidation/runs/${runId}/entries`, {
        description: "Tidak seimbang",
        lines: [
          { groupAccountId: groups["3-2000"], debit: 1 },
          { groupAccountId: groups["1-1200"], credit: 2 },
        ],
      })
      .expect(400);
    const withManual = (
      await hq
        .post(`/consolidation/runs/${runId}/entries`, {
          description: "Laba belum terealisasi atas persediaan",
          lines: [
            { groupAccountId: groups["5-1000"], debit: 10_000 },
            { groupAccountId: groups["1-1400"], companyId: id.B, credit: 10_000 },
          ],
        })
        .expect(201)
    ).body;
    const manual = withManual.entries.find((e: { kind: string }) => e.kind === "manual");
    expect(manual.lines).toHaveLength(2);
    const report = (await hq.get(`/consolidation/runs/${runId}/report`).expect(200)).body;
    expect(report.profitLoss.netProfit).toBe("3090000.00"); // −50.000 beban A, −10.000 penyesuaian
    expect(report.balanceSheet.difference).toBe("0.00");
    // Jurnal manual bertahan saat hitung ulang.
    expect(
      (await hq.post(`/consolidation/runs/${runId}/compute`, {}).expect(200)).body.entries.filter(
        (e: { kind: string }) => e.kind === "manual",
      ),
    ).toHaveLength(1);

    const final = (await hq.post(`/consolidation/runs/${runId}/finalize`).expect(200)).body;
    expect(final.state).toBe("final");
    await hq.post(`/consolidation/runs/${runId}/compute`, {}).expect(400);
    await hq.delete(`/consolidation/runs/${runId}/entries/${manual.id}`).expect(400);
    await hq.delete(`/consolidation/runs/${runId}`).expect(400);
    expect((await hq.get("/consolidation/runs").expect(200)).body).toHaveLength(1);
  });
});
