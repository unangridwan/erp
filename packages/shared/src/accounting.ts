import { Decimal } from "decimal.js";

export interface TaxRule {
  id: string;
  /** Persen tarif; negatif untuk pajak yang dipotong (mis. PPh 23 = -2). */
  amount: Decimal.Value;
  /** Rasio DPP terhadap dasar (PPN 12% non-mewah: 11/12). */
  baseRatio: Decimal.Value;
}

export interface InvoiceLineInput {
  quantity: Decimal.Value;
  priceUnit: Decimal.Value;
  /** Diskon persen (0–100). */
  discount?: Decimal.Value;
  taxIds?: string[];
}

export interface InvoiceComputation {
  lines: { subtotal: string }[];
  taxes: { taxId: string; base: string; taxBase: string; amount: string }[];
  amountUntaxed: string;
  amountTax: string;
  amountTotal: string;
}

const round = (v: Decimal, decimals: number) => v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);

/**
 * Hitung subtotal per baris dan pajak per tarif.
 * Subtotal dibulatkan per baris; pajak dihitung dari total dasar per tarif (DPP = dasar × rasio, dibulatkan,
 * lalu pajak = DPP × tarif, dibulatkan) — sama seperti penyusunan Faktur Pajak.
 */
export function computeInvoice(
  lines: InvoiceLineInput[],
  taxes: TaxRule[],
  decimals: number,
): InvoiceComputation {
  const byId = new Map(taxes.map((t) => [t.id, t]));
  const subtotals = lines.map((l) => {
    const gross = new Decimal(l.quantity).times(l.priceUnit);
    const discount = new Decimal(l.discount ?? 0);
    return round(gross.times(new Decimal(100).minus(discount)).div(100), decimals);
  });

  const bases = new Map<string, Decimal>();
  lines.forEach((l, i) => {
    for (const taxId of new Set(l.taxIds ?? [])) {
      if (!byId.has(taxId)) throw new Error(`Pajak ${taxId} tidak dikenal`);
      bases.set(taxId, (bases.get(taxId) ?? new Decimal(0)).plus(subtotals[i]!));
    }
  });

  const taxLines = [...bases.entries()].map(([taxId, base]) => {
    const rule = byId.get(taxId)!;
    // Rasio disimpan desimal (0.9166666667); pulihkan pecahan sederhananya (11/12) agar DPP eksak di nilai besar.
    const [num, den] = new Decimal(rule.baseRatio).toFraction(1000) as [Decimal, Decimal];
    const taxBase = round(base.times(num).div(den), decimals);
    const amount = round(taxBase.times(rule.amount).div(100), decimals);
    return { taxId, base, taxBase, amount };
  });

  const untaxed = subtotals.reduce((a, b) => a.plus(b), new Decimal(0));
  const tax = taxLines.reduce((a, t) => a.plus(t.amount), new Decimal(0));
  const fmt = (v: Decimal) => v.toFixed(decimals);
  return {
    lines: subtotals.map((s) => ({ subtotal: fmt(s) })),
    taxes: taxLines.map((t) => ({
      taxId: t.taxId,
      base: fmt(t.base),
      taxBase: fmt(t.taxBase),
      amount: fmt(t.amount),
    })),
    amountUntaxed: fmt(untaxed),
    amountTax: fmt(tax),
    amountTotal: fmt(untaxed.plus(tax)),
  };
}

/** Kelompok jenis akun untuk laporan. */
export const BALANCE_SHEET_GROUPS = {
  asset: ["asset_receivable", "asset_cash", "asset_current", "asset_non_current", "asset_fixed"],
  liability: ["liability_payable", "liability_current", "liability_non_current"],
  equity: ["equity", "equity_unaffected"],
} as const;

export const PROFIT_LOSS_GROUPS = {
  income: ["income"],
  directCost: ["expense_direct_cost"],
  expense: ["expense", "expense_depreciation"],
  otherIncome: ["income_other"],
  otherExpense: ["expense_other"],
} as const;

export const PROFIT_LOSS_TYPES: readonly string[] = Object.values(PROFIT_LOSS_GROUPS).flat();
