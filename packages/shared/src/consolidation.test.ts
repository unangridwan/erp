import { describe, expect, it } from "vitest";
import {
  closingPosition,
  consolidate,
  consolidatedCashFlow,
  consolidatedStatements,
  equityChanges,
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

describe("konsolidasi lanjutan", () => {
  const MORE = [
    ...ACCOUNTS,
    acc("inventory", "1-1400", "asset_current", "inventory"),
    acc("fixed", "1-2100", "asset_fixed"),
    acc("dividends", "3-3000", "equity", "dividends"),
    acc("eq_tx", "3-8300", "equity", "equity_transactions"),
    acc("cogs", "5-1000", "expense_direct_cost", "cost_of_sales"),
    acc("disposal", "4-9400", "income_other", "disposal_gain"),
    acc("div_income", "4-9000", "income_other"),
    acc("depr", "6-4000", "expense_depreciation"),
  ];
  const holding = (balances: EntityInput["balances"], intercompany: EntityInput["intercompany"] = []) =>
    entity({ companyId: "H", isRoot: true, balances, intercompany });
  const run = (entities: EntityInput[], options = {}) => {
    const r = consolidate(MORE, entities, options);
    const rows = worksheet(MORE, r.balances, r.entries);
    return { r, rows, s: consolidatedStatements(rows) };
  };
  const lineOf = (
    e: { lines: { groupAccountId: string; companyId: string | null; amount: string }[] } | undefined,
    id: string,
    company?: string | null,
  ) =>
    e?.lines
      .filter((l) => l.groupAccountId === id && (company === undefined || l.companyId === company))
      .reduce((s, l) => s + Number(l.amount), 0);

  it("akuisisi bertahap: selisih harga ke ekuitas, saldo laba & KNP ditimbang per tahap", () => {
    const { r, s } = run([
      holding([
        { groupAccountId: "cash", amount: 1000 },
        { groupAccountId: "investment", amount: 1000 },
        { groupAccountId: "capital", amount: -2000 },
      ]),
      entity({
        companyId: "S",
        effectivePct: 80,
        links: [
          {
            parentId: "H",
            pct: 80,
            consideration: 700,
            acquiredNetAssets: 1000,
            changes: [
              {
                date: "2026-07-01",
                pctBefore: 60,
                pctAfter: 80,
                consideration: 300,
                netAssets: 1200,
                inPeriod: true,
                periodProfitBefore: 100,
              },
            ],
          },
        ],
        balances: [
          { groupAccountId: "cash", amount: 1400 },
          { groupAccountId: "capital", amount: -1000 },
          { groupAccountId: "re", amount: -100 },
          { groupAccountId: "revenue", amount: -300 },
        ],
        profitSegments: [
          { effectivePct: 60, profit: -100 },
          { effectivePct: 80, profit: -200 },
        ],
      }),
    ]);
    const inv = r.entries.find((e) => e.kind === "investment")!;
    expect(lineOf(inv, "goodwill")).toBe(100); // 700 − 60% × 1.000
    expect(lineOf(inv, "eq_tx")).toBe(60); // 300 − 20% × 1.200
    expect(lineOf(inv, "investment")).toBe(-1000);
    expect(lineOf(inv, "re", null)).toBe(-60); // 60% × (1.100 − 1.000)
    expect(lineOf(inv, "nci")).toBe(-200);
    expect(s.profitLoss).toMatchObject({ attributableToNci: "80.00", attributableToOwners: "220.00" });
    expect(s.balanceSheet).toMatchObject({ nonControllingInterest: "280.00", difference: "0.00" });
  });

  it("penjualan sebagian tanpa kehilangan pengendalian: laba induk dibalik ke ekuitas", () => {
    const { r, s } = run([
      holding([
        { groupAccountId: "cash", amount: 1350 },
        { groupAccountId: "investment", amount: 700 },
        { groupAccountId: "capital", amount: -2000 },
        { groupAccountId: "disposal", amount: -50 },
      ]),
      entity({
        companyId: "S",
        effectivePct: 70,
        links: [
          {
            parentId: "H",
            pct: 70,
            consideration: 900,
            acquiredNetAssets: 1000,
            changes: [
              {
                date: "2026-07-01",
                pctBefore: 90,
                pctAfter: 70,
                consideration: 250,
                netAssets: 1100,
                inPeriod: true,
                periodProfitBefore: 100,
              },
            ],
          },
        ],
        balances: [
          { groupAccountId: "cash", amount: 1200 },
          { groupAccountId: "capital", amount: -1000 },
          { groupAccountId: "revenue", amount: -200 },
        ],
        profitSegments: [
          { effectivePct: 90, profit: -100 },
          { effectivePct: 70, profit: -100 },
        ],
      }),
    ]);
    const inv = r.entries.find((e) => e.kind === "investment")!;
    expect(lineOf(inv, "investment")).toBe(-700); // 900 − 900 × 20/90
    expect(lineOf(inv, "disposal")).toBe(50); // laba 250 − 200 di buku induk dibalik
    expect(lineOf(inv, "eq_tx")).toBe(-30); // 250 − 20% × 1.100
    expect(s.profitLoss).toMatchObject({ attributableToNci: "40.00", attributableToOwners: "160.00" });
    expect(s.balanceSheet).toMatchObject({ nonControllingInterest: "360.00", difference: "0.00" });
  });

  it("pelepasan entitas anak di tengah periode: laba rugi sampai tanggal lepas, laba pelepasan grup", () => {
    const { r, s } = run([
      holding([
        { groupAccountId: "cash", amount: 2300 },
        { groupAccountId: "capital", amount: -2000 },
        { groupAccountId: "disposal", amount: -300 },
      ]),
      entity({
        companyId: "S",
        effectivePct: 80,
        disposal: { date: "2026-06-30" },
        postAcquisitionPrior: -100,
        links: [{ parentId: "H", pct: 80, consideration: 800, acquiredNetAssets: 1000 }],
        balances: [{ groupAccountId: "revenue", amount: -150 }],
      }),
    ]);
    expect(r.entries.some((e) => e.kind === "investment")).toBe(false);
    expect(
      r.entries.find((e) => e.kind === "disposal")!.lines.reduce((t, l) => t + Number(l.amount), 0),
    ).toBe(0);
    // Laba grup = laba S 150 + laba pelepasan grup (1.100 − 80% × 1.250) 100.
    expect(s.profitLoss).toMatchObject({
      netProfit: "250.00",
      attributableToNci: "30.00",
      attributableToOwners: "220.00",
    });
    expect(s.balanceSheet).toMatchObject({
      nonControllingInterest: "0.00",
      totalEquity: "2300.00",
      difference: "0.00",
    });
  });

  it("laba belum terealisasi persediaan (upstream) & eliminasi penjualan barang ke HPP", () => {
    const { r, s, rows } = run(
      [
        holding(
          [
            { groupAccountId: "cash", amount: 1210 },
            { groupAccountId: "investment", amount: 240 },
            { groupAccountId: "inventory", amount: 200 },
            { groupAccountId: "ap_ic", amount: -500 },
            { groupAccountId: "capital", amount: -1000 },
            { groupAccountId: "revenue", amount: -450 },
            { groupAccountId: "cogs", amount: 300 },
          ],
          [{ groupAccountId: "ap_ic", counterpartId: "S", amount: -500 }],
        ),
        entity({
          companyId: "S",
          effectivePct: 80,
          links: [{ parentId: "H", pct: 80, consideration: 240, acquiredNetAssets: 300 }],
          balances: [
            { groupAccountId: "ar_ic", amount: 500 },
            { groupAccountId: "capital", amount: -300 },
            { groupAccountId: "ic_revenue", amount: -500 },
            { groupAccountId: "cogs", amount: 300 },
          ],
          intercompany: [
            { groupAccountId: "ar_ic", counterpartId: "H", amount: 500 },
            { groupAccountId: "ic_revenue", counterpartId: "H", amount: -500 },
          ],
        }),
      ],
      {
        icGoods: [{ sellerId: "S", buyerId: "H", amount: 500 }],
        unrealizedProfits: [{ sellerId: "S", buyerId: "H", closing: 80, opening: 0 }],
      },
    );
    expect(r.warnings).toEqual([]);
    expect(consolidated(rows, "cogs")).toBe("180.00"); // 60% × 300 harga pokok grup
    expect(consolidated(rows, "inventory")).toBe("120.00"); // 40% × 300
    expect(s.profitLoss).toMatchObject({ netProfit: "270.00", attributableToNci: "24.00" });
    expect(s.balanceSheet.difference).toBe("0.00");
  });

  it("dividen antar perusahaan & dari asosiasi; selisih kurs IC ke CTA tanpa peringatan", () => {
    const { r, s, rows } = run([
      holding(
        [
          { groupAccountId: "cash", amount: 330 },
          { groupAccountId: "investment", amount: 800 },
          { groupAccountId: "assoc_inv", amount: 300 },
          { groupAccountId: "capital", amount: -1300 },
          { groupAccountId: "div_income", amount: -130 },
        ],
        [
          { groupAccountId: "div_income", counterpartId: "S", amount: -80 },
          { groupAccountId: "div_income", counterpartId: "C", amount: -50 },
        ],
      ),
      entity({
        companyId: "S",
        effectivePct: 80,
        links: [{ parentId: "H", pct: 80, consideration: 800, acquiredNetAssets: 1000 }],
        balances: [
          { groupAccountId: "cash", amount: 900 },
          { groupAccountId: "capital", amount: -1000 },
          { groupAccountId: "dividends", amount: 100 },
        ],
        intercompany: [{ groupAccountId: "dividends", counterpartId: "H", amount: 80 }],
      }),
      entity({
        companyId: "C",
        method: "equity",
        effectivePct: 30,
        balances: [
          { groupAccountId: "cash", amount: 950 },
          { groupAccountId: "capital", amount: -1000 },
          { groupAccountId: "dividends", amount: 50 },
        ],
        intercompany: [{ groupAccountId: "dividends", counterpartId: "H", amount: 50 }],
      }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(consolidated(rows, "div_income")).toBe("0.00");
    expect(consolidated(rows, "assoc_inv")).toBe("250.00");
    // Akun dividen konsolidasian hanya berisi dividen induk (S sudah tereliminasi seluruhnya).
    expect(consolidated(rows, "dividends")).toBe("0.00");
    expect(consolidated(rows, "re")).toBe("0.00");
    expect(s.balanceSheet).toMatchObject({ nonControllingInterest: "180.00", difference: "0.00" });

    const fx = consolidate(ACCOUNTS, [
      entity({
        companyId: "A",
        isRoot: true,
        balances: [
          { groupAccountId: "cash", amount: -200 },
          { groupAccountId: "capital", amount: 400 },
          { groupAccountId: "ic_revenue", amount: -200 },
        ],
        intercompany: [{ groupAccountId: "ic_revenue", counterpartId: "B", amount: -200 }],
      }),
      entity({
        companyId: "B",
        closingRate: 2,
        averageRate: 1.9,
        links: [{ parentId: "A", pct: 100, consideration: 0, acquiredNetAssets: 0 }],
        balances: [
          { groupAccountId: "cash", amount: -100 },
          { groupAccountId: "ic_expense", amount: 100 },
        ],
        intercompany: [{ groupAccountId: "ic_expense", counterpartId: "A", amount: 100 }],
      }),
    ]);
    expect(fx.warnings).toEqual([]);
    const ic = fx.entries.find((e) => e.kind === "intercompany")!;
    expect(ic.lines.at(-1)).toEqual({ groupAccountId: "cta", companyId: null, amount: "-10.00" });
  });

  it("laporan perubahan ekuitas & arus kas konsolidasian rekonsiliasi dengan neraca", () => {
    const result = consolidate(ACCOUNTS, ENTITIES);
    const rows = worksheet(ACCOUNTS, result.balances, result.entries);
    const opening = [
      { groupAccountId: "cash", amount: "3000.00" },
      { groupAccountId: "capital", amount: "-3000.00" },
    ];
    const eq = equityChanges(ACCOUNTS, opening, rows);
    const total = (key: string) => eq.rows.find((r) => r.key === key)!.values;
    expect(total("opening").total).toBe("3000.00");
    expect(total("profit")).toMatchObject({ retained: "938.00", nci: "80.00" });
    expect(total("closing")).toMatchObject({ owners: "5024.00", nci: "280.00", total: "5304.00" });
    const cf = consolidatedCashFlow(ACCOUNTS, opening, rows);
    expect(cf.cashOpening).toBe("3000.00");
    expect(cf.cashClosing).toBe("4900.00");
    expect(cf.operating.items[0]).toEqual({ label: "Laba bersih", amount: "1018.00" });
    expect(cf.difference).toBe("0.00");
    // Posisi akhir terlipat: laba ditutup ke saldo laba, tetap seimbang.
    const position = closingPosition(ACCOUNTS, rows);
    expect(position.reduce((t, p) => t + Number(p.amount), 0)).toBe(0);
    expect(position.some((p) => p.groupAccountId === "revenue" || p.groupAccountId === "nci_profit")).toBe(
      false,
    );
  });
});

describe("laba belum terealisasi aset tetap antar perusahaan", () => {
  const MORE = [
    ...ACCOUNTS,
    acc("fixed", "1-2100", "asset_fixed"),
    acc("disposal", "4-9500", "income_other"),
    acc("depr", "6-4000", "expense_depreciation"),
  ];
  it("penjualan dalam periode: laba penjual dibalik, kelebihan penyusutan pembeli dikoreksi, bagian KNP", () => {
    const r = consolidate(
      MORE,
      [
        entity({ companyId: "H", isRoot: true, balances: [] }),
        entity({
          companyId: "S",
          effectivePct: 80,
          links: [{ parentId: "H", pct: 80, consideration: 0, acquiredNetAssets: 0 }],
          balances: [],
        }),
      ],
      {
        assetProfits: [
          {
            sellerId: "S",
            buyerId: "H",
            name: "Mesin",
            gain: 200,
            closing: 150,
            opening: 0,
            inPeriod: true,
            gainAccountId: "disposal",
            assetAccountId: "fixed",
            expenseAccountId: "depr",
          },
        ],
      },
    );
    const e = r.entries.find((x) => x.kind === "unrealized_profit")!;
    expect(e.lines.map((l) => [l.groupAccountId, l.companyId, l.amount])).toEqual([
      ["disposal", "S", "200.00"],
      ["fixed", "H", "-150.00"],
      ["depr", "H", "-50.00"],
      ["nci_profit", null, "-30.00"],
      ["nci", null, "30.00"],
    ]);
  });
  it("penjualan periode lalu: sisa awal ke saldo laba", () => {
    const r = consolidate(
      MORE,
      [
        entity({ companyId: "H", isRoot: true, balances: [] }),
        entity({
          companyId: "A",
          links: [{ parentId: "H", pct: 100, consideration: 0, acquiredNetAssets: 0 }],
          balances: [],
        }),
      ],
      {
        assetProfits: [
          {
            sellerId: "H",
            buyerId: "A",
            name: "Mobil",
            gain: 120,
            closing: 60,
            opening: 90,
            inPeriod: false,
            gainAccountId: "disposal",
            assetAccountId: "fixed",
            expenseAccountId: "depr",
          },
        ],
      },
    );
    const e = r.entries.find((x) => x.kind === "unrealized_profit")!;
    expect(e.lines.map((l) => [l.groupAccountId, l.amount])).toEqual([
      ["re", "90.00"],
      ["fixed", "-60.00"],
      ["depr", "-30.00"],
    ]);
  });
});
