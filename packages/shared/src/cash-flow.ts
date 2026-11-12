import { Decimal } from "decimal.js";

export const CASH_FLOW_CATEGORIES = ["cash", "operating", "investing", "financing"] as const;
export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number];
export const CASH_FLOW_CATEGORY_LABEL: Record<CashFlowCategory, [string, string]> = {
  cash: ["Kas & setara kas", "Cash & cash equivalents"],
  operating: ["Aktivitas operasi", "Operating activities"],
  investing: ["Aktivitas investasi", "Investing activities"],
  financing: ["Aktivitas pendanaan", "Financing activities"],
};

const PROFIT_LOSS = [
  "income",
  "income_other",
  "expense",
  "expense_direct_cost",
  "expense_depreciation",
  "expense_other",
];

/**
 * Kelompok arus kas bawaan dari jenis akun (PSAK 2, metode tidak langsung). Akun laba rugi dan "laba tahun
 * berjalan" tidak dikelompokkan (masuk lewat laba bersih).
 */
export function defaultCashFlowCategory(accountType: string): CashFlowCategory | null {
  if (accountType === "asset_cash") return "cash";
  if (["asset_receivable", "asset_current", "liability_payable", "liability_current"].includes(accountType))
    return "operating";
  if (["asset_fixed", "asset_non_current"].includes(accountType)) return "investing";
  if (["liability_non_current", "equity"].includes(accountType)) return "financing";
  return null;
}

export interface CashFlowAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
  cashFlowCategory?: CashFlowCategory | null;
  /** Saldo (debit − kredit) awal & akhir periode. */
  opening: Decimal.Value;
  closing: Decimal.Value;
}

export interface CashFlowLine {
  key: string;
  label: string;
  accountId?: string;
  code?: string;
  amount: string;
}

export interface CashFlowSection {
  lines: CashFlowLine[];
  total: string;
}

/**
 * Laporan arus kas metode tidak langsung. `netProfit` = laba bersih periode (positif = laba),
 * `depreciation` = beban penyusutan periode (positif). Setiap akun neraca non-kas menyumbang −(perubahan saldo)
 * ke kelompoknya; penyusutan ditambahkan kembali di operasi dan dikurangkan dari kelompok akun beban penyusutan
 * lawannya (aset tetap) agar tidak terhitung sebagai arus kas masuk.
 */
export function cashFlowStatement(input: {
  accounts: CashFlowAccount[];
  netProfit: Decimal.Value;
  depreciation: Decimal.Value;
}) {
  const d = (v: Decimal.Value) => new Decimal(v);
  const fmt = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  const sections: Record<Exclude<CashFlowCategory, "cash">, CashFlowLine[]> = {
    operating: [{ key: "net_profit", label: "Laba bersih", amount: fmt(d(input.netProfit)) }],
    investing: [],
    financing: [],
  };
  const depreciation = d(input.depreciation);
  if (!depreciation.isZero())
    sections.operating.push({
      key: "depreciation",
      label: "Penyusutan & amortisasi",
      amount: fmt(depreciation),
    });
  let cashOpening = d(0);
  let cashClosing = d(0);
  let fixedSeen = false;
  for (const a of [...input.accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    if (PROFIT_LOSS.includes(a.accountType) || a.accountType === "equity_unaffected") continue;
    const category = a.cashFlowCategory ?? defaultCashFlowCategory(a.accountType);
    if (!category) continue;
    if (category === "cash") {
      cashOpening = cashOpening.plus(a.opening);
      cashClosing = cashClosing.plus(a.closing);
      continue;
    }
    const change = d(a.closing).minus(a.opening);
    if (a.accountType === "asset_fixed" && category === "investing") fixedSeen = true;
    if (change.isZero()) continue;
    sections[category].push({
      key: a.id,
      accountId: a.id,
      code: a.code,
      label: a.name,
      amount: fmt(change.negated()),
    });
  }
  // Akumulasi penyusutan (kredit pada aset tetap) bukan arus kas: penyusutan periode dinetralkan langsung pada
  // baris aset tetap yang bertambah kreditnya (akumulasi penyusutan); sisanya, bila ada, ditampilkan terpisah.
  if (!depreciation.isZero()) {
    const target = fixedSeen ? sections.investing : sections.operating;
    let remaining = depreciation;
    for (const line of target) {
      if (remaining.lte(0)) break;
      const account = input.accounts.find((a) => a.id === line.accountId);
      if (account?.accountType !== "asset_fixed" || d(line.amount).lte(0)) continue;
      const used = Decimal.min(remaining, d(line.amount));
      line.amount = fmt(d(line.amount).minus(used));
      remaining = remaining.minus(used);
    }
    const kept = target.filter((l) => !(l.accountId && d(l.amount).isZero()));
    target.splice(0, target.length, ...kept);
    if (!remaining.isZero())
      target.push({
        key: "depreciation_offset",
        label: "Dikurangi: penyusutan (non-kas)",
        amount: fmt(remaining.negated()),
      });
  }
  const section = (lines: CashFlowLine[]): CashFlowSection => ({
    lines,
    total: fmt(lines.reduce((s, l) => s.plus(l.amount), d(0))),
  });
  const operating = section(sections.operating);
  const investing = section(sections.investing);
  const financing = section(sections.financing);
  const netChange = d(operating.total).plus(investing.total).plus(financing.total);
  return {
    operating,
    investing,
    financing,
    netChange: fmt(netChange),
    cashOpening: fmt(cashOpening),
    cashClosing: fmt(cashClosing),
    /** Nol bila semua perubahan posisi keuangan terklasifikasi. */
    difference: fmt(cashClosing.minus(cashOpening).minus(netChange)),
  };
}
