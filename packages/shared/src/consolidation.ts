import { Decimal } from "decimal.js";
import { BALANCE_SHEET_GROUPS, PROFIT_LOSS_GROUPS, PROFIT_LOSS_TYPES } from "./accounting.js";

/**
 * Mesin konsolidasi grup (PSAK 65 konsolidasi, PSAK 15 metode ekuitas, PSAK 10 translasi):
 * menerjemahkan saldo entitas ke mata uang penyajian, menerapkan metode penuh/proporsional/ekuitas,
 * mengeliminasi investasi vs ekuitas anak (goodwill & KNP), transaksi/saldo antar perusahaan, lalu
 * menyusun kertas kerja dan laporan konsolidasian. Semua jumlah: debit positif, kredit negatif.
 */

export const GROUP_ACCOUNT_ROLES = [
  "investment",
  "goodwill",
  "nci_equity",
  "nci_profit",
  "cta",
  "retained_earnings",
  "associate_investment",
  "associate_income",
  "ic_difference",
] as const;
export type GroupAccountRole = (typeof GROUP_ACCOUNT_ROLES)[number];

export interface GroupAccountInfo {
  id: string;
  code: string;
  name: string;
  accountType: string;
  role: GroupAccountRole | null;
}

export interface OwnershipInput {
  parentId: string;
  /** Kepemilikan langsung (persen). */
  pct: Decimal.Value;
  consideration: Decimal.Value | null;
  acquiredNetAssets: Decimal.Value | null;
}

export interface EntityInput {
  companyId: string;
  name: string;
  isRoot: boolean;
  method: "full" | "proportional" | "equity";
  /** Kepemilikan efektif induk utama (persen). */
  effectivePct: Decimal.Value;
  /** Kurs ke mata uang penyajian (1 unit mata uang entitas = rate unit penyajian). */
  closingRate: Decimal.Value;
  averageRate: Decimal.Value;
  historicalRate: Decimal.Value;
  /** Relasi dari induk yang ada dalam lingkup konsolidasi. */
  links: OwnershipInput[];
  /** Saldo lokal per akun grup: akun neraca kumulatif, akun laba rugi selama periode. */
  balances: { groupAccountId: string; amount: Decimal.Value }[];
  /** Laba/rugi sebelum periode yang belum ditutup ke saldo laba (lokal). */
  priorUnallocated: Decimal.Value;
  /** Metode ekuitas: laba/rugi sejak akuisisi sampai awal periode (lokal). */
  postAcquisitionPrior?: Decimal.Value;
  /** Bagian saldo yang berlawanan dengan perusahaan lain dalam grup (subset dari `balances`). */
  intercompany: { groupAccountId: string; counterpartId: string; amount: Decimal.Value }[];
}

export interface EntryLine {
  groupAccountId: string;
  companyId: string | null;
  amount: string;
}
export interface ConsolidationEntry {
  kind: "translation" | "investment" | "nci_profit" | "intercompany" | "equity_method" | "manual";
  companyId: string | null;
  description: string;
  lines: EntryLine[];
}

export interface ConsolidationResult {
  balances: { companyId: string; groupAccountId: string; localAmount: string; amount: string }[];
  entries: ConsolidationEntry[];
  warnings: string[];
}

const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const EQUITY_TYPES: readonly string[] = BALANCE_SHEET_GROUPS.equity;
const ASSET_LIABILITY_TYPES: readonly string[] = [
  ...BALANCE_SHEET_GROUPS.asset,
  ...BALANCE_SHEET_GROUPS.liability,
];
const isPL = (type: string) => PROFIT_LOSS_TYPES.includes(type);

/** Kurs translasi per jenis akun: aset/liabilitas kurs penutupan, laba rugi kurs rata-rata, ekuitas kurs historis. */
function rateFor(type: string, e: EntityInput) {
  if (ASSET_LIABILITY_TYPES.includes(type)) return D(e.closingRate);
  if (isPL(type)) return D(e.averageRate);
  return D(e.historicalRate);
}

export function consolidate(accounts: GroupAccountInfo[], entities: EntityInput[]): ConsolidationResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const role = (r: GroupAccountRole) => {
    const account = accounts.find((a) => a.role === r);
    if (!account)
      throw new Error(`Akun grup dengan peran "${r}" belum ada — buat bagan akun grup terlebih dahulu`);
    return account.id;
  };
  const typeOf = (id: string) => {
    const account = byId.get(id);
    if (!account) throw new Error(`Akun grup ${id} tidak dikenal`);
    return account.accountType;
  };
  const warnings: string[] = [];
  const entries: ConsolidationEntry[] = [];
  const balances: ConsolidationResult["balances"] = [];
  const aggregated = entities.filter((e) => e.method !== "equity");
  const inScope = new Set(aggregated.map((e) => e.companyId));
  const retained = role("retained_earnings");

  /** Saldo terjemahan per entitas (setelah faktor metode), dipakai eliminasi. */
  const translated = new Map<string, Map<string, Decimal>>();

  for (const e of entities) {
    const factor = e.method === "proportional" ? D(e.effectivePct).div(100) : D(1);
    const rows = new Map<string, { local: Decimal; amount: Decimal }>();
    const add = (accountId: string, local: Decimal, amount: Decimal) => {
      const row = rows.get(accountId) ?? { local: D(0), amount: D(0) };
      row.local = row.local.plus(local);
      row.amount = row.amount.plus(amount);
      rows.set(accountId, row);
    };
    for (const b of e.balances) {
      add(
        b.groupAccountId,
        D(b.amount),
        r2(
          D(b.amount)
            .times(rateFor(typeOf(b.groupAccountId), e))
            .times(factor),
        ),
      );
    }
    const prior = D(e.priorUnallocated);
    if (!prior.isZero()) add(retained, prior, r2(prior.times(e.historicalRate).times(factor)));
    // Selisih kurs penjabaran menyeimbangkan neraca saldo terjemahan (bagian dari ekuitas entitas).
    const total = [...rows.values()].reduce((s, r) => s.plus(r.amount), D(0));
    if (!total.isZero()) add(role("cta"), D(0), total.negated());

    const map = new Map([...rows].map(([id, r]) => [id, r.amount]));
    translated.set(e.companyId, map);
    if (e.method === "equity") continue;
    for (const [groupAccountId, r] of rows) {
      if (r.local.isZero() && r.amount.isZero()) continue;
      balances.push({
        companyId: e.companyId,
        groupAccountId,
        localAmount: r.local.toFixed(2),
        amount: r.amount.toFixed(2),
      });
    }
  }

  const sumWhere = (rows: Map<string, Decimal>, pred: (type: string) => boolean) =>
    [...rows].filter(([id]) => pred(typeOf(id))).reduce((s, [, v]) => s.plus(v), D(0));
  const line = (groupAccountId: string, companyId: string | null, amount: Decimal): EntryLine => ({
    groupAccountId,
    companyId,
    amount: r2(amount).toFixed(2),
  });
  const nonZero = (lines: EntryLine[]) => lines.filter((l) => !D(l.amount).isZero());

  // ---- Eliminasi investasi vs ekuitas entitas anak (metode penuh) & bagian laba KNP ----
  for (const e of entities.filter((x) => x.method === "full" && !x.isRoot)) {
    const rows = translated.get(e.companyId)!;
    const pEff = D(e.effectivePct).div(100);
    const links = e.links.filter((l) => inScope.has(l.parentId));
    if (!links.length) {
      warnings.push(`${e.name}: tidak ada induk dalam lingkup konsolidasi`);
      continue;
    }
    const equityRows = [...rows].filter(([id]) => EQUITY_TYPES.includes(typeOf(id)));
    const equity = equityRows.reduce((s, [, v]) => s.minus(v), D(0)); // ekuitas = saldo kredit
    // Selisih kurs penjabaran dipisah: bagian induk tetap disajikan sebagai selisih kurs (OCI) grup.
    const ctaId = role("cta");
    const ctaEquity = D(rows.get(ctaId)).negated();
    const otherEquity = equity.minus(ctaEquity);
    const missing = links.some((l) => l.consideration === null) || links[0]!.acquiredNetAssets === null;
    if (missing)
      warnings.push(
        `${e.name}: data akuisisi (harga perolehan & aset bersih) belum diisi di Kepemilikan — investasi dianggap sebesar bagian ekuitas saat ini tanpa goodwill`,
      );
    const acquired = links[0]!.acquiredNetAssets === null ? otherEquity : D(links[0]!.acquiredNetAssets);

    const lines: EntryLine[] = equityRows.map(([id, v]) => line(id, e.companyId, v.negated()));
    let goodwillTotal = D(0);
    for (const l of links) {
      const p = D(l.pct).div(100);
      const cost = l.consideration === null || missing ? r2(p.times(acquired)) : D(l.consideration);
      lines.push(line(role("investment"), l.parentId, cost.negated()));
      goodwillTotal = goodwillTotal.plus(cost.minus(p.times(acquired)));
    }
    // Goodwill negatif (pembelian dengan diskon) langsung diakui di saldo laba.
    if (goodwillTotal.gte(0)) lines.push(line(role("goodwill"), null, goodwillTotal));
    else lines.push(line(retained, null, goodwillTotal));
    lines.push(line(retained, null, pEff.times(otherEquity.minus(acquired)).negated()));
    lines.push(line(ctaId, null, pEff.times(ctaEquity).negated()));
    // KNP = (1 − p_efektif)·E − (Σp_langsung − p_efektif)·A; dihitung sebagai penyeimbang agar entri tepat nol
    // (sekaligus menyerap selisih pembulatan).
    const rest = lines.reduce((s, l) => s.plus(l.amount), D(0));
    lines.push(line(role("nci_equity"), null, rest.negated()));
    entries.push({
      kind: "investment",
      companyId: e.companyId,
      description: `Eliminasi investasi & ekuitas ${e.name} (kepemilikan efektif ${pEff.times(100).toFixed(2)}%)`,
      lines: nonZero(lines),
    });

    const profit = sumWhere(rows, isPL).negated();
    const nciShare = r2(D(1).minus(pEff).times(profit));
    if (!nciShare.isZero())
      entries.push({
        kind: "nci_profit",
        companyId: e.companyId,
        description: `Bagian laba ${e.name} untuk kepentingan non-pengendali`,
        lines: [line(role("nci_profit"), null, nciShare), line(role("nci_equity"), null, nciShare.negated())],
      });
  }

  // ---- Metode ekuitas (asosiasi / ventura bersama) ----
  for (const e of entities.filter((x) => x.method === "equity")) {
    const rows = translated.get(e.companyId)!;
    const share = D(e.effectivePct).div(100);
    const profit = r2(share.times(sumWhere(rows, isPL).negated()));
    const prior = r2(share.times(D(e.postAcquisitionPrior).negated()).times(e.historicalRate));
    const lines = nonZero([
      line(role("associate_investment"), null, profit.plus(prior)),
      line(role("associate_income"), null, profit.negated()),
      line(retained, null, prior.negated()),
    ]);
    if (lines.length)
      entries.push({
        kind: "equity_method",
        companyId: e.companyId,
        description: `Bagian laba ${e.name} (metode ekuitas ${share.times(100).toFixed(2)}%)`,
        lines,
      });
  }

  // ---- Eliminasi saldo & transaksi antar perusahaan dalam lingkup ----
  const icLines: EntryLine[] = [];
  for (const e of aggregated) {
    const factor = e.method === "proportional" ? D(e.effectivePct).div(100) : D(1);
    const byAccount = new Map<string, Decimal>();
    for (const ic of e.intercompany) {
      if (!inScope.has(ic.counterpartId) || ic.counterpartId === e.companyId) continue;
      const amount = r2(
        D(ic.amount)
          .times(rateFor(typeOf(ic.groupAccountId), e))
          .times(factor),
      );
      byAccount.set(ic.groupAccountId, (byAccount.get(ic.groupAccountId) ?? D(0)).plus(amount));
    }
    for (const [id, amount] of byAccount) icLines.push(line(id, e.companyId, amount.negated()));
  }
  const icResidual = icLines.reduce((s, l) => s.plus(l.amount), D(0));
  if (!icResidual.isZero()) {
    icLines.push(line(role("ic_difference"), null, icResidual.negated()));
    warnings.push(
      `Saldo antar perusahaan tidak saling hapus, selisih ${icResidual.negated().toFixed(2)} dipindah ke akun selisih eliminasi — periksa rekonsiliasi antar perusahaan`,
    );
  }
  if (nonZero(icLines).length)
    entries.push({
      kind: "intercompany",
      companyId: null,
      description: "Eliminasi saldo & transaksi antar perusahaan",
      lines: nonZero(icLines),
    });

  return { balances, entries, warnings };
}

// ---- Kertas kerja & laporan ----

export interface WorksheetRow {
  groupAccountId: string;
  code: string;
  name: string;
  accountType: string;
  role: GroupAccountRole | null;
  byCompany: Record<string, string>;
  total: string;
  adjustments: string;
  consolidated: string;
}

/** Kertas kerja: kolom per entitas → jumlah gabungan → eliminasi/penyesuaian → konsolidasian. */
export function worksheet(
  accounts: GroupAccountInfo[],
  balances: { companyId: string; groupAccountId: string; amount: Decimal.Value }[],
  entries: { lines: { groupAccountId: string; amount: Decimal.Value }[] }[],
): WorksheetRow[] {
  const rows = new Map<string, { byCompany: Map<string, Decimal>; adjustments: Decimal }>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { byCompany: new Map(), adjustments: D(0) }));
    return r;
  };
  for (const b of balances) {
    const r = row(b.groupAccountId);
    r.byCompany.set(b.companyId, (r.byCompany.get(b.companyId) ?? D(0)).plus(b.amount));
  }
  for (const e of entries)
    for (const l of e.lines)
      row(l.groupAccountId).adjustments = row(l.groupAccountId).adjustments.plus(l.amount);
  return accounts
    .filter((a) => rows.has(a.id))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => {
      const r = rows.get(a.id)!;
      const total = [...r.byCompany.values()].reduce((s, v) => s.plus(v), D(0));
      return {
        groupAccountId: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        role: a.role,
        byCompany: Object.fromEntries([...r.byCompany].map(([k, v]) => [k, v.toFixed(2)])),
        total: total.toFixed(2),
        adjustments: r.adjustments.toFixed(2),
        consolidated: total.plus(r.adjustments).toFixed(2),
      };
    })
    .filter((r) => !(D(r.total).isZero() && D(r.adjustments).isZero()));
}

export interface StatementLine {
  code: string;
  name: string;
  amount: string;
}
const section = (rows: WorksheetRow[], types: readonly string[], sign: 1 | -1) => {
  const accounts: StatementLine[] = rows
    .filter((r) => types.includes(r.accountType) && !D(r.consolidated).isZero())
    .map((r) => ({ code: r.code, name: r.name, amount: D(r.consolidated).times(sign).toFixed(2) }));
  return { accounts, total: accounts.reduce((s, a) => s.plus(a.amount), D(0)).toFixed(2) };
};

/** Laporan posisi keuangan & laba rugi konsolidasian, dengan atribusi laba ke pemilik induk dan KNP. */
export function consolidatedStatements(rows: WorksheetRow[]) {
  const pl = rows.filter((r) => isPL(r.accountType));
  const income = section(pl, PROFIT_LOSS_GROUPS.income, -1);
  const directCost = section(pl, PROFIT_LOSS_GROUPS.directCost, 1);
  const expense = section(pl, PROFIT_LOSS_GROUPS.expense, 1);
  const otherIncome = section(pl, PROFIT_LOSS_GROUPS.otherIncome, -1);
  const otherExpense = section(pl, PROFIT_LOSS_GROUPS.otherExpense, 1);
  const grossProfit = D(income.total).minus(directCost.total);
  const operatingProfit = grossProfit.minus(expense.total);
  const netProfit = operatingProfit.plus(otherIncome.total).minus(otherExpense.total);
  const nciProfit = rows
    .filter((r) => r.role === "nci_profit")
    .reduce((s, r) => s.plus(r.consolidated), D(0));
  const nciEquity = rows
    .filter((r) => r.role === "nci_equity")
    .reduce((s, r) => s.minus(r.consolidated), D(0));

  const bs = rows.filter((r) => !isPL(r.accountType));
  const assets = section(bs, BALANCE_SHEET_GROUPS.asset, 1);
  const liabilities = section(bs, BALANCE_SHEET_GROUPS.liability, -1);
  const ownerRows = bs.filter((r) => r.role !== "nci_equity" && r.role !== "nci_profit");
  const equity = section(ownerRows, BALANCE_SHEET_GROUPS.equity, -1);
  const ownersProfit = netProfit.minus(nciProfit);
  equity.accounts.push({
    code: "",
    name: "Laba tahun berjalan diatribusikan ke pemilik entitas induk",
    amount: ownersProfit.toFixed(2),
  });
  const ownersEquity = D(equity.total).plus(ownersProfit);
  const totalEquity = ownersEquity.plus(nciEquity);
  return {
    profitLoss: {
      income,
      directCost,
      expense,
      otherIncome,
      otherExpense,
      grossProfit: grossProfit.toFixed(2),
      operatingProfit: operatingProfit.toFixed(2),
      netProfit: netProfit.toFixed(2),
      attributableToOwners: ownersProfit.toFixed(2),
      attributableToNci: nciProfit.toFixed(2),
    },
    balanceSheet: {
      assets,
      liabilities,
      equity: { accounts: equity.accounts, total: ownersEquity.toFixed(2) },
      nonControllingInterest: nciEquity.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      totalLiabilitiesEquity: D(liabilities.total).plus(totalEquity).toFixed(2),
      // Nol bila kertas kerja seimbang.
      difference: D(assets.total).minus(liabilities.total).minus(totalEquity).toFixed(2),
    },
  };
}

/** Rekonsiliasi antar perusahaan: saldo A terhadap B dibandingkan saldo B terhadap A (jumlah harus nol). */
export function intercompanyReconciliation(
  entities: {
    companyId: string;
    name: string;
    intercompany: { counterpartId: string; amount: Decimal.Value }[];
  }[],
) {
  const names = new Map(entities.map((e) => [e.companyId, e.name]));
  const pairs = new Map<string, { a: string; b: string; aSide: Decimal; bSide: Decimal }>();
  for (const e of entities) {
    for (const ic of e.intercompany) {
      if (!names.has(ic.counterpartId) || ic.counterpartId === e.companyId) continue;
      const [a, b] = [e.companyId, ic.counterpartId].sort() as [string, string];
      const key = `${a}:${b}`;
      const pair = pairs.get(key) ?? { a, b, aSide: D(0), bSide: D(0) };
      if (e.companyId === a) pair.aSide = pair.aSide.plus(ic.amount);
      else pair.bSide = pair.bSide.plus(ic.amount);
      pairs.set(key, pair);
    }
  }
  return [...pairs.values()].map((p) => ({
    companyA: p.a,
    companyAName: names.get(p.a)!,
    companyB: p.b,
    companyBName: names.get(p.b)!,
    balanceA: p.aSide.toFixed(2),
    balanceB: p.bSide.toFixed(2),
    difference: p.aSide.plus(p.bSide).toFixed(2),
  }));
}
