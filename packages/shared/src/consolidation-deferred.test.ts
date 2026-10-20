import { describe, expect, it } from "vitest";
import {
  consolidate,
  consolidatedStatements,
  equityChanges,
  segmentReport,
  worksheet,
  type EntityInput,
  type GroupAccountInfo,
} from "./consolidation.js";

const acc = (id: string, code: string, accountType: string, role: GroupAccountInfo["role"] = null) => ({
  id,
  code,
  name: id,
  accountType,
  role,
});
const ACCOUNTS: GroupAccountInfo[] = [
  acc("cash", "1-1100", "asset_cash"),
  acc("inventory", "1-1400", "asset_current", "inventory"),
  acc("investment", "1-3100", "asset_non_current", "investment"),
  acc("assoc_inv", "1-3200", "asset_non_current", "associate_investment"),
  acc("goodwill", "1-3900", "asset_non_current", "goodwill"),
  acc("ic_diff", "2-9900", "liability_current", "ic_difference"),
  acc("capital", "3-1000", "equity"),
  acc("re", "3-2000", "equity", "retained_earnings"),
  acc("cta", "3-8100", "equity", "cta"),
  acc("nci", "3-8000", "equity", "nci_equity"),
  acc("eq_tx", "3-8300", "equity", "equity_transactions"),
  acc("nci_profit", "3-8200", "equity_unaffected", "nci_profit"),
  acc("revenue", "4-1000", "income"),
  acc("assoc_income", "4-9300", "income_other", "associate_income"),
  acc("disposal", "4-9400", "income_other", "disposal_gain"),
  acc("recycled", "4-9600", "income_other", "cta_reclassified"),
  acc("remeasure", "4-9700", "income_other", "remeasurement_gain"),
  acc("cogs", "5-1000", "expense_direct_cost", "cost_of_sales"),
  acc("expense", "6-5000", "expense"),
];
const entity = (e: Partial<EntityInput> & Pick<EntityInput, "companyId" | "balances">): EntityInput => ({
  name: e.companyId,
  isRoot: false,
  method: "full",
  effectivePct: 100,
  closingRate: 1,
  averageRate: 1,
  historicalRate: 1,
  links: [],
  priorUnallocated: 0,
  intercompany: [],
  ...e,
});
const run = (entities: EntityInput[], options = {}) => {
  const r = consolidate(ACCOUNTS, entities, options);
  const rows = worksheet(ACCOUNTS, r.balances, r.entries);
  return { r, rows, s: consolidatedStatements(rows) };
};
const sumLines = (e: { lines: { groupAccountId: string; amount: string }[] } | undefined, id: string) =>
  (e?.lines ?? []).filter((l) => l.groupAccountId === id).reduce((t, l) => t + Number(l.amount), 0);

describe("goodwill entitas asing", () => {
  it("dijabarkan kurs penutupan; selisihnya ke selisih kurs penjabaran bagian induk, KNP tidak berubah", () => {
    const base = (acquisitionRate?: number) =>
      run([
        entity({
          companyId: "H",
          isRoot: true,
          balances: [
            { groupAccountId: "cash", amount: 3200 },
            { groupAccountId: "investment", amount: 800 },
            { groupAccountId: "capital", amount: -4000 },
          ],
        }),
        entity({
          companyId: "B",
          effectivePct: 80,
          closingRate: 2,
          averageRate: 2,
          historicalRate: 1,
          ...(acquisitionRate ? { acquisitionRate } : {}),
          links: [{ parentId: "H", pct: 80, consideration: 800, acquiredNetAssets: 900 }],
          balances: [
            { groupAccountId: "cash", amount: 1000 },
            { groupAccountId: "capital", amount: -900 },
            { groupAccountId: "revenue", amount: -100 },
          ],
        }),
      ]);
    const plain = base();
    const foreign = base(1);
    const inv = (x: ReturnType<typeof run>) => x.r.entries.find((e) => e.kind === "investment");
    expect(sumLines(inv(plain), "goodwill")).toBe(80); // 800 − 80% × 900
    expect(sumLines(inv(foreign), "goodwill")).toBe(160); // 80 USD-setara × kurs 2/1
    expect(sumLines(inv(foreign), "cta") - sumLines(inv(plain), "cta")).toBe(-80);
    expect(sumLines(inv(foreign), "nci")).toBe(sumLines(inv(plain), "nci"));
    expect(foreign.s.balanceSheet.difference).toBe("0.00");
    expect(Number(foreign.s.balanceSheet.totalEquity) - Number(plain.s.balanceSheet.totalEquity)).toBe(80);
  });
});

describe("pelepasan entitas asing", () => {
  const disposed = (cta: number | undefined) =>
    run([
      entity({
        companyId: "H",
        isRoot: true,
        balances: [
          { groupAccountId: "cash", amount: 2300 },
          { groupAccountId: "capital", amount: -2000 },
          { groupAccountId: "disposal", amount: -300 },
        ],
      }),
      entity({
        companyId: "S",
        effectivePct: 80,
        closingRate: 1.5,
        averageRate: 1.5,
        acquisitionRate: 1,
        disposal: { date: "2026-06-30", ...(cta !== undefined ? { cta } : {}) },
        postAcquisitionPrior: -100,
        links: [{ parentId: "H", pct: 80, consideration: 900, acquiredNetAssets: 1000 }],
        balances: [{ groupAccountId: "revenue", amount: -100 }],
      }),
    ]);

  it("bagian induk atas selisih kurs kumulatif (termasuk goodwill) dipisah ke akun reklasifikasi; laba bersih tetap", () => {
    const without = disposed(undefined);
    const withCta = disposed(-200);
    const entry = withCta.r.entries.find((e) => e.description.startsWith("Reklasifikasi"))!;
    // 80% × 200 + goodwill 100 × (1,5 − 1) = 160 + 50.
    expect(sumLines(entry, "recycled")).toBe(-210);
    expect(sumLines(entry, "disposal")).toBe(210);
    expect(withCta.s.profitLoss.netProfit).toBe(without.s.profitLoss.netProfit);
    expect(withCta.s.balanceSheet.difference).toBe("0.00");
    // Tidak ada lagi peringatan untuk membuat jurnal manual.
    expect(withCta.r.warnings.join(" ")).not.toMatch(/direklasifikasi/);

    // Laporan perubahan ekuitas: penurunan cadangan kurs disajikan sebagai reklasifikasi, bukan OCI.
    const opening = [
      { groupAccountId: "cash", amount: 2000 },
      { groupAccountId: "investment", amount: 900 },
      { groupAccountId: "capital", amount: -2000 },
      { groupAccountId: "re", amount: -690 },
      { groupAccountId: "cta", amount: -210 },
    ];
    const changes = equityChanges(ACCOUNTS, opening, withCta.rows);
    const row = (key: string) => changes.rows.find((r) => r.key === key)?.values.cta;
    expect(row("reclassification")).toBe("-210.00");
    expect(row("translation")).toBe("0.00");
    // Tanpa data selisih kurs entitas: hanya selisih penjabaran goodwill (100 × 0,5) yang direklasifikasi.
    expect(
      equityChanges(ACCOUNTS, opening, without.rows).rows.find((r) => r.key === "reclassification")?.values
        .cta,
    ).toBe("-50.00");
  });
});

describe("laba belum terealisasi dengan asosiasi", () => {
  const group = (options = {}) =>
    run(
      [
        entity({
          companyId: "H",
          isRoot: true,
          balances: [
            { groupAccountId: "cash", amount: 700 },
            { groupAccountId: "inventory", amount: 100 },
            { groupAccountId: "assoc_inv", amount: 300 },
            { groupAccountId: "capital", amount: -1000 },
            { groupAccountId: "revenue", amount: -400 },
            { groupAccountId: "cogs", amount: 300 },
          ],
        }),
        entity({
          companyId: "A",
          method: "equity",
          effectivePct: 30,
          balances: [
            { groupAccountId: "cash", amount: 1100 },
            { groupAccountId: "capital", amount: -1000 },
            { groupAccountId: "revenue", amount: -100 },
          ],
        }),
      ],
      options,
    );

  it("downstream: bagian investor (30%) mengurangi bagian laba & investasi; awal periode lewat saldo laba", () => {
    const { r, s } = group({
      associateProfits: [
        { associateId: "A", groupEntityId: "H", direction: "downstream", closing: 50, opening: 20 },
      ],
    });
    const e = r.entries.find((x) => x.kind === "unrealized_profit")!;
    expect(sumLines(e, "assoc_income")).toBe(9); // 30% × (50 − 20)
    expect(sumLines(e, "assoc_inv")).toBe(-15);
    expect(sumLines(e, "re")).toBe(6);
    // Bagian laba asosiasi 30% × 100 = 30 dikurangi 9.
    expect(s.profitLoss.otherIncome.total).toBe("21.00");
    expect(s.balanceSheet.difference).toBe("0.00");
  });

  it("upstream: mengurangi persediaan entitas grup pembeli", () => {
    const { r } = group({
      associateProfits: [
        { associateId: "A", groupEntityId: "H", direction: "upstream", closing: 40, opening: 0 },
      ],
    });
    const e = r.entries.find((x) => x.kind === "unrealized_profit")!;
    expect(e.lines).toContainEqual({ groupAccountId: "inventory", companyId: "H", amount: "-12.00" });
    expect(sumLines(e, "assoc_income")).toBe(12);
  });
});

describe("akuisisi bertahap: pengukuran ulang nilai wajar kepemilikan sebelumnya", () => {
  // H memiliki 30% S (asosiasi, biaya 300) lalu membeli 50% lagi (biaya 600) → 80%, aset neto 1.000.
  const build = (rm?: NonNullable<EntityInput["links"][number]["remeasurement"]>) =>
    run([
      entity({
        companyId: "H",
        isRoot: true,
        balances: [
          { groupAccountId: "cash", amount: 1100 },
          { groupAccountId: "investment", amount: 900 },
          { groupAccountId: "capital", amount: -2000 },
        ],
      }),
      entity({
        companyId: "S",
        effectivePct: 80,
        links: [
          {
            parentId: "H",
            pct: 80,
            consideration: 900,
            acquiredNetAssets: 1000,
            ...(rm ? { remeasurement: rm } : {}),
          },
        ],
        balances: [
          { groupAccountId: "cash", amount: 1000 },
          { groupAccountId: "capital", amount: -1000 },
        ],
      }),
    ]);

  it("nilai wajar 360 (biaya 300, bagian laba ekuitas 20): goodwill +60, laba pengukuran ulang 40", () => {
    const base = build();
    const fv = build({ uplift: 60, equityShareBefore: 0, equityShareInPeriod: 20, inPeriod: true });
    const inv = (x: ReturnType<typeof run>) => x.r.entries.find((e) => e.kind === "investment")!;
    expect(sumLines(inv(base), "goodwill")).toBe(100); // 900 − 80% × 1.000
    expect(sumLines(inv(fv), "goodwill")).toBe(160);
    expect(sumLines(inv(fv), "remeasure")).toBe(-40);
    expect(sumLines(inv(fv), "assoc_income")).toBe(-20);
    expect(sumLines(inv(fv), "nci")).toBe(sumLines(inv(base), "nci"));
    expect(fv.s.profitLoss.netProfit).toBe("60.00");
    expect(fv.s.balanceSheet.difference).toBe("0.00");
  });

  it("periode setelah pengendalian: seluruh kenaikan nilai wajar di saldo laba", () => {
    const later = build({ uplift: 60, equityShareBefore: 20, equityShareInPeriod: 0, inPeriod: false });
    const inv = later.r.entries.find((e) => e.kind === "investment")!;
    expect(sumLines(inv, "remeasure")).toBe(0);
    expect(later.s.profitLoss.netProfit).toBe("0.00");
    expect(later.s.balanceSheet.difference).toBe("0.00");
  });
});

describe("laporan segmen", () => {
  it("jumlah segmen + eliminasi = laba rugi konsolidasian", () => {
    const { r, rows, s } = run([
      entity({
        companyId: "H",
        isRoot: true,
        balances: [
          { groupAccountId: "cash", amount: 500 },
          { groupAccountId: "capital", amount: -300 },
          { groupAccountId: "revenue", amount: -500 },
          { groupAccountId: "cogs", amount: 300 },
        ],
      }),
      entity({
        companyId: "A",
        balances: [
          { groupAccountId: "cash", amount: 100 },
          { groupAccountId: "revenue", amount: -200 },
          { groupAccountId: "expense", amount: 100 },
        ],
      }),
    ]);
    const segments = ["H", "A"].map((c) => ({
      key: c,
      name: c,
      balances: r.balances.filter((b) => b.companyId === c),
    }));
    // Penyesuaian manual: eliminasi penjualan 50 ke H.
    const adjusted = rows.map((x) =>
      x.groupAccountId === "revenue" ? { ...x, consolidated: String(Number(x.consolidated) + 50) } : x,
    );
    const rep = segmentReport(ACCOUNTS, segments, adjusted);
    expect(rep.segments.map((x) => [x.key, x.income, x.grossProfit, x.netProfit])).toEqual([
      ["H", "500.00", "200.00", "200.00"],
      ["A", "200.00", "200.00", "100.00"],
    ]);
    expect(rep.eliminations.income).toBe("-50.00");
    expect(rep.eliminations.netProfit).toBe("-50.00");
    expect(rep.total.netProfit).toBe("250.00");
    expect(s.profitLoss.netProfit).toBe("300.00");
  });
});
