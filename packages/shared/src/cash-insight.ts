/**
 * Arus uang: dari mana kas datang & ke mana perginya (metode langsung dari jurnal yang menyentuh kas/bank), siklus
 * konversi kas (DSO/DIO/DPO/CCC), dan proyeksi kas mingguan dari piutang, utang, pesanan, PO, dan payroll.
 */

export const CASH_CATEGORIES = {
  customers: { label: ["Pelanggan", "Customers"], dir: "in" },
  financing_in: { label: ["Pinjaman & modal", "Loans & equity"], dir: "in" },
  intercompany_in: { label: ["Antar perusahaan (masuk)", "Intercompany (in)"], dir: "in" },
  other_in: { label: ["Penerimaan lain", "Other receipts"], dir: "in" },
  suppliers: { label: ["Pemasok", "Suppliers"], dir: "out" },
  payroll: { label: ["Gaji & tunjangan", "Payroll & benefits"], dir: "out" },
  tax: { label: ["Pajak", "Taxes"], dir: "out" },
  opex: { label: ["Beban operasional", "Operating expenses"], dir: "out" },
  capex: { label: ["Aset tetap", "Fixed assets"], dir: "out" },
  financing_out: { label: ["Angsuran, bunga & dividen", "Loan repayments & dividends"], dir: "out" },
  intercompany_out: { label: ["Antar perusahaan (keluar)", "Intercompany (out)"], dir: "out" },
  other_out: { label: ["Pengeluaran lain", "Other payments"], dir: "out" },
} as const satisfies Record<string, { label: [string, string]; dir: "in" | "out" }>;
export type CashCategory = keyof typeof CASH_CATEGORIES;

const has = (name: string, re: RegExp) => re.test(name.toLowerCase());
const INTERCOMPANY = /antar perusahaan|intercompany|inter-company/;
const TAX = /pajak|ppn|pph|tax|vat|bea /;
const PAYROLL = /gaji|upah|salary|wage|payroll|bpjs|thr|tunjangan/;

/**
 * Kategori arus kas dari akun lawan baris jurnal yang menyentuh kas. `amount` > 0 = kas masuk.
 * null = perpindahan antar kas/bank (bukan arus kas).
 */
export function cashCategory(accountType: string, accountName: string, amount: number): CashCategory | null {
  const inflow = amount > 0;
  if (accountType === "asset_cash") return null;
  if (has(accountName, INTERCOMPANY)) return inflow ? "intercompany_in" : "intercompany_out";
  switch (accountType) {
    case "asset_receivable":
      return inflow ? "customers" : "other_out";
    case "liability_payable":
      return inflow ? "other_in" : "suppliers";
    case "liability_current":
      if (has(accountName, TAX)) return inflow ? "other_in" : "tax";
      if (has(accountName, PAYROLL)) return inflow ? "other_in" : "payroll";
      return inflow ? "other_in" : "other_out";
    case "expense":
    case "expense_other":
    case "expense_direct_cost":
    case "expense_depreciation":
      if (!inflow && has(accountName, PAYROLL)) return "payroll";
      if (!inflow && has(accountName, TAX)) return "tax";
      if (!inflow && has(accountName, /bunga|interest/)) return "financing_out";
      return inflow ? "other_in" : "opex";
    case "income":
    case "income_other":
      return inflow ? "other_in" : "other_out";
    case "asset_fixed":
    case "asset_non_current":
      return inflow ? "other_in" : "capex";
    case "liability_non_current":
    case "equity":
      return inflow ? "financing_in" : "financing_out";
    default:
      return inflow ? "other_in" : "other_out";
  }
}

/** Satu baris lawan kas: `amount` = −saldo baris (positif = kas masuk). */
export interface CashLine {
  accountType: string;
  accountName: string;
  month: string;
  amount: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function summarizeCash(lines: CashLine[], opts: { opening: number; closing: number }) {
  const totals = new Map<CashCategory, number>();
  const months = new Map<string, { inflow: number; outflow: number }>();
  for (const l of lines) {
    if (!l.amount) continue;
    const cat = cashCategory(l.accountType, l.accountName, l.amount);
    if (!cat) continue;
    totals.set(cat, (totals.get(cat) ?? 0) + l.amount);
    const m = months.get(l.month) ?? { inflow: 0, outflow: 0 };
    if (l.amount > 0) m.inflow += l.amount;
    else m.outflow -= l.amount;
    months.set(l.month, m);
  }
  const list = (dir: "in" | "out") =>
    (Object.keys(CASH_CATEGORIES) as CashCategory[])
      .filter((k) => CASH_CATEGORIES[k].dir === dir && totals.get(k))
      .map((k) => ({ key: k, label: CASH_CATEGORIES[k].label, amount: round2(Math.abs(totals.get(k)!)) }))
      .sort((a, b) => b.amount - a.amount);
  const inflows = list("in");
  const outflows = list("out");
  const inflow = round2(inflows.reduce((s, x) => s + x.amount, 0));
  const outflow = round2(outflows.reduce((s, x) => s + x.amount, 0));
  const net = round2(inflow - outflow);
  return {
    opening: round2(opts.opening),
    closing: round2(opts.closing),
    inflow,
    outflow,
    net,
    inflows,
    outflows,
    /** Selisih terhadap perubahan saldo kas (harus 0: semua arus kas terklasifikasi). */
    unexplained: round2(opts.closing - opts.opening - net),
    byMonth: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        inflow: round2(v.inflow),
        outflow: round2(v.outflow),
        net: round2(v.inflow - v.outflow),
      })),
  };
}

/**
 * Siklus konversi kas per bulan (rata-rata bergulir 3 bulan agar stabil): DSO = piutang akhir ÷ penjualan × hari,
 * DIO = persediaan akhir ÷ HPP × hari, DPO = utang usaha akhir ÷ HPP × hari, CCC = DSO + DIO − DPO.
 */
export function cashCycle(
  months: {
    month: string;
    days: number;
    revenue: number;
    cogs: number;
    ar: number;
    ap: number;
    inventory: number;
  }[],
) {
  return months.map((m, i) => {
    const win = months.slice(Math.max(0, i - 2), i + 1);
    const days = win.reduce((s, x) => s + x.days, 0);
    const revenue = win.reduce((s, x) => s + x.revenue, 0);
    const cogs = win.reduce((s, x) => s + x.cogs, 0);
    const ratio = (num: number, den: number) => (den > 0 ? Math.round((num / den) * days * 10) / 10 : null);
    const dso = ratio(m.ar, revenue);
    const dio = ratio(m.inventory, cogs);
    const dpo = ratio(m.ap, cogs);
    return {
      month: m.month,
      revenue: round2(m.revenue),
      cogs: round2(m.cogs),
      ar: round2(m.ar),
      ap: round2(m.ap),
      inventory: round2(m.inventory),
      dso,
      dio,
      dpo,
      ccc: dso !== null && dio !== null && dpo !== null ? Math.round((dso + dio - dpo) * 10) / 10 : null,
    };
  });
}

export type ForecastSource = "receivables" | "sales" | "payables" | "purchases" | "payroll";
export const FORECAST_SOURCES: Record<ForecastSource, { label: [string, string]; dir: "in" | "out" }> = {
  receivables: { label: ["Piutang jatuh tempo", "Receivables due"], dir: "in" },
  sales: { label: ["Pesanan belum ditagih", "Uninvoiced orders"], dir: "in" },
  payables: { label: ["Utang jatuh tempo", "Payables due"], dir: "out" },
  purchases: { label: ["PO belum ditagih", "Unbilled POs"], dir: "out" },
  payroll: { label: ["Payroll", "Payroll"], dir: "out" },
};

/**
 * Proyeksi kas mingguan mulai minggu berjalan: saldo awal + arus masuk − arus keluar per minggu. Pos yang sudah
 * lewat tanggalnya (mis. piutang lewat jatuh tempo) masuk minggu pertama dan ditandai `overdue`.
 */
export function cashForecast(input: {
  today: string;
  opening: number;
  weeks: number;
  items: { source: ForecastSource; date: string; amount: number }[];
}) {
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const start = t(input.today);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const weeks = Array.from({ length: input.weeks }, (_, i) => ({
    index: i + 1,
    start: iso(start + i * 7 * 864e5),
    end: iso(start + (i * 7 + 6) * 864e5),
    receivables: 0,
    sales: 0,
    payables: 0,
    purchases: 0,
    payroll: 0,
    inflow: 0,
    outflow: 0,
    net: 0,
    balance: 0,
  }));
  const overdue: Record<ForecastSource, number> = {
    receivables: 0,
    sales: 0,
    payables: 0,
    purchases: 0,
    payroll: 0,
  };
  let beyond = 0;
  for (const it of input.items) {
    if (!it.amount) continue;
    const diff = Math.floor((t(it.date) - start) / (7 * 864e5));
    if (diff >= input.weeks) {
      beyond += FORECAST_SOURCES[it.source].dir === "in" ? it.amount : -it.amount;
      continue;
    }
    if (t(it.date) < start) overdue[it.source] += it.amount;
    weeks[Math.max(0, diff)]![it.source] += it.amount;
  }
  let balance = input.opening;
  for (const w of weeks) {
    w.inflow = round2(w.receivables + w.sales);
    w.outflow = round2(w.payables + w.purchases + w.payroll);
    w.net = round2(w.inflow - w.outflow);
    balance += w.net;
    w.balance = round2(balance);
    for (const k of Object.keys(FORECAST_SOURCES) as ForecastSource[]) w[k] = round2(w[k]);
  }
  const lowest = weeks.reduce((m, w) => (w.balance < m.balance ? w : m), weeks[0]!);
  return {
    opening: round2(input.opening),
    weeks,
    overdue: Object.fromEntries(Object.entries(overdue).map(([k, v]) => [k, round2(v)])) as Record<
      ForecastSource,
      number
    >,
    /** Arus bersih yang jatuh setelah horizon proyeksi. */
    beyond: round2(beyond),
    lowest: { week: lowest.index, balance: lowest.balance },
    firstNegative: weeks.find((w) => w.balance < 0)?.index ?? null,
  };
}
