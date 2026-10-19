import { describe, expect, it } from "vitest";
import {
  consolidate,
  consolidatedStatements,
  intercompanyReconciliation,
  worksheet,
  type EntityInput,
  type GroupAccountInfo,
} from "./consolidation.js";

const acc = (
  id: string,
  code: string,
  accountType: string,
  role: GroupAccountInfo["role"] = null,
): GroupAccountInfo => ({
  id,
  code,
  name: id,
  accountType,
  role,
});
const ACCOUNTS = [
  acc("cash", "1-1100", "asset_cash"),
  acc("ar_ic", "1-1310", "asset_receivable"),
  acc("investment", "1-3100", "asset_non_current", "investment"),
  acc("assoc_inv", "1-3200", "asset_non_current", "associate_investment"),
  acc("goodwill", "1-3900", "asset_non_current", "goodwill"),
  acc("ap_ic", "2-1110", "liability_payable"),
  acc("ic_diff", "2-9900", "liability_current", "ic_difference"),
  acc("capital", "3-1000", "equity"),
  acc("re", "3-2000", "equity", "retained_earnings"),
  acc("cta", "3-8100", "equity", "cta"),
  acc("nci", "3-8000", "equity", "nci_equity"),
  acc("nci_profit", "3-8200", "equity_unaffected", "nci_profit"),
  acc("revenue", "4-1000", "income"),
  acc("ic_revenue", "4-1200", "income"),
  acc("assoc_income", "4-9300", "income_other", "associate_income"),
  acc("expense", "6-5000", "expense"),
  acc("ic_expense", "6-7000", "expense"),
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

/** Holding H (IDR) 100% A (IDR), 80% B (USD), 30% asosiasi C; A menjual Rp200 ke B. */
const ENTITIES: EntityInput[] = [
  entity({
    companyId: "H",
    isRoot: true,
    balances: [
      { groupAccountId: "cash", amount: 2400 },
      { groupAccountId: "investment", amount: 1800 },
      { groupAccountId: "assoc_inv", amount: 300 },
      { groupAccountId: "capital", amount: -4000 },
      { groupAccountId: "revenue", amount: -500 },
    ],
  }),
  entity({
    companyId: "A",
    links: [{ parentId: "H", pct: 100, consideration: 1000, acquiredNetAssets: 1000 }],
    balances: [
      { groupAccountId: "cash", amount: 900 },
      { groupAccountId: "ar_ic", amount: 200 },
      { groupAccountId: "capital", amount: -1000 },
      { groupAccountId: "ic_revenue", amount: -200 },
      { groupAccountId: "expense", amount: 100 },
    ],
    intercompany: [
      { groupAccountId: "ar_ic", counterpartId: "B", amount: 200 },
      { groupAccountId: "ic_revenue", counterpartId: "B", amount: -200 },
    ],
  }),
  entity({
    companyId: "B",
    effectivePct: 80,
    closingRate: 2,
    averageRate: 2,
    historicalRate: 1,
    links: [{ parentId: "H", pct: 80, consideration: 800, acquiredNetAssets: 900 }],
    balances: [
      { groupAccountId: "cash", amount: 800 },
      { groupAccountId: "ap_ic", amount: -100 },
      { groupAccountId: "capital", amount: -500 },
      { groupAccountId: "ic_expense", amount: 100 },
      { groupAccountId: "revenue", amount: -300 },
    ],
    intercompany: [
      { groupAccountId: "ap_ic", counterpartId: "A", amount: -100 },
      { groupAccountId: "ic_expense", counterpartId: "A", amount: 100 },
    ],
  }),
  entity({
    companyId: "C",
    method: "equity",
    effectivePct: 30,
    balances: [
      { groupAccountId: "cash", amount: 160 },
      { groupAccountId: "capital", amount: -100 },
      { groupAccountId: "revenue", amount: -100 },
      { groupAccountId: "expense", amount: 40 },
    ],
    postAcquisitionPrior: -20,
  }),
];

const consolidated = (rows: ReturnType<typeof worksheet>, id: string) =>
  rows.find((r) => r.groupAccountId === id)?.consolidated ?? "0.00";

describe("konsolidasi", () => {
  const result = consolidate(ACCOUNTS, ENTITIES);
  const rows = worksheet(ACCOUNTS, result.balances, result.entries);

  it("translasi: aset/liabilitas kurs penutupan, laba rugi rata-rata, ekuitas historis, selisih ke CTA", () => {
    const b = result.balances.filter((x) => x.companyId === "B");
    const amount = (id: string) => b.find((x) => x.groupAccountId === id)?.amount;
    expect(amount("cash")).toBe("1600.00");
    expect(amount("ap_ic")).toBe("-200.00");
    expect(amount("capital")).toBe("-500.00");
    expect(amount("revenue")).toBe("-600.00");
    expect(amount("cta")).toBe("-500.00");
    // Asosiasi (metode ekuitas) tidak digabung baris per baris.
    expect(result.balances.some((x) => x.companyId === "C")).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("eliminasi investasi: goodwill, saldo laba pasca akuisisi, CTA bagian induk, KNP", () => {
    const b = result.entries.find((e) => e.kind === "investment" && e.companyId === "B")!;
    const line = (id: string, company: string | null = null) =>
      b.lines.find((l) => l.groupAccountId === id && l.companyId === company)?.amount;
    expect(line("capital", "B")).toBe("500.00");
    expect(line("cta", "B")).toBe("500.00");
    expect(line("investment", "H")).toBe("-800.00");
    expect(line("goodwill")).toBe("80.00"); // 800 − 80% × 900
    expect(line("re")).toBe("320.00"); // 80% × (500 − 900): penurunan ekuitas pasca akuisisi
    expect(line("cta")).toBe("-400.00"); // 80% × 500
    expect(line("nci")).toBe("-200.00"); // 20% × ekuitas 1000
    expect(b.lines.reduce((s, l) => s + Number(l.amount), 0)).toBe(0);
    const nci = result.entries.find((e) => e.kind === "nci_profit")!;
    expect(nci.lines).toEqual([
      { groupAccountId: "nci_profit", companyId: null, amount: "80.00" },
      { groupAccountId: "nci", companyId: null, amount: "-80.00" },
    ]);
  });

  it("metode ekuitas & eliminasi antar perusahaan", () => {
    const eq = result.entries.find((e) => e.kind === "equity_method")!;
    expect(eq.lines).toEqual([
      { groupAccountId: "assoc_inv", companyId: null, amount: "24.00" },
      { groupAccountId: "assoc_income", companyId: null, amount: "-18.00" },
      { groupAccountId: "re", companyId: null, amount: "-6.00" },
    ]);
    const ic = result.entries.find((e) => e.kind === "intercompany")!;
    expect(ic.lines.map((l) => [l.groupAccountId, l.companyId, l.amount])).toEqual([
      ["ar_ic", "A", "-200.00"],
      ["ic_revenue", "A", "200.00"],
      ["ap_ic", "B", "200.00"],
      ["ic_expense", "B", "-200.00"],
    ]);
    expect(consolidated(rows, "ar_ic")).toBe("0.00");
    expect(consolidated(rows, "investment")).toBe("0.00");
  });

  it("laporan konsolidasian seimbang dengan atribusi KNP", () => {
    const s = consolidatedStatements(rows);
    expect(s.profitLoss).toMatchObject({
      netProfit: "1018.00", // pendapatan 1.100 − beban 100 + bagian asosiasi 18
      attributableToNci: "80.00",
      attributableToOwners: "938.00",
    });
    expect(s.balanceSheet).toMatchObject({
      nonControllingInterest: "280.00",
      totalEquity: "5304.00",
      difference: "0.00",
    });
    expect(s.balanceSheet.assets.total).toBe("5304.00");
    expect(s.balanceSheet.equity.total).toBe("5024.00");
  });

  it("selisih antar perusahaan dipindah ke akun selisih eliminasi & dilaporkan", () => {
    const entities = ENTITIES.map((e) =>
      e.companyId === "B"
        ? {
            ...e,
            intercompany: [
              { groupAccountId: "ap_ic", counterpartId: "A", amount: -90 },
              { groupAccountId: "ic_expense", counterpartId: "A", amount: 100 },
            ],
          }
        : e,
    );
    const r = consolidate(ACCOUNTS, entities);
    const ic = r.entries.find((e) => e.kind === "intercompany")!;
    expect(ic.lines.at(-1)).toEqual({ groupAccountId: "ic_diff", companyId: null, amount: "20.00" });
    expect(r.warnings[0]).toMatch(/tidak saling hapus/);
    const recon = intercompanyReconciliation(
      entities.map((e) => ({
        ...e,
        intercompany: e.intercompany.filter((x) => x.groupAccountId.startsWith("a")),
      })),
    );
    expect(recon).toEqual([
      expect.objectContaining({
        companyA: "A",
        companyB: "B",
        balanceA: "200.00",
        balanceB: "-90.00",
        difference: "110.00",
      }),
    ]);
  });

  it("tanpa data akuisisi: tanpa goodwill, dengan peringatan; proporsional digabung sebagian", () => {
    const entities = ENTITIES.map((e) =>
      e.companyId === "B"
        ? { ...e, links: [{ parentId: "H", pct: 80, consideration: null, acquiredNetAssets: null }] }
        : e.companyId === "A"
          ? { ...e, method: "proportional" as const, effectivePct: 50 }
          : e,
    );
    const r = consolidate(ACCOUNTS, entities);
    expect(r.warnings.some((w) => w.startsWith("B: data akuisisi"))).toBe(true);
    const inv = r.entries.find((e) => e.kind === "investment" && e.companyId === "B")!;
    expect(inv.lines.find((l) => l.groupAccountId === "goodwill")).toBeUndefined();
    expect(inv.lines.find((l) => l.groupAccountId === "investment")?.amount).toBe("-400.00");
    expect(r.balances.find((b) => b.companyId === "A" && b.groupAccountId === "cash")?.amount).toBe("450.00");
    const s = consolidatedStatements(worksheet(ACCOUNTS, r.balances, r.entries));
    // Investasi H pada B tercatat 800 tetapi hanya 400 yang tereliminasi → sisa tetap di aset.
    expect(s.balanceSheet.difference).toBe("0.00");
  });

  it("peran akun wajib", () => {
    expect(() =>
      consolidate(
        ACCOUNTS.filter((a) => a.role !== "cta"),
        ENTITIES,
      ),
    ).toThrow(/peran "cta"/);
  });
});
