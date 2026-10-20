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
  "inventory",
  "cost_of_sales",
  "dividends",
  "equity_transactions",
  "disposal_gain",
  "cta_reclassified",
  "remeasurement_gain",
] as const;
export type GroupAccountRole = (typeof GROUP_ACCOUNT_ROLES)[number];

export interface GroupAccountInfo {
  id: string;
  code: string;
  name: string;
  accountType: string;
  role: GroupAccountRole | null;
}

/** Perubahan kepemilikan langsung setelah pengendalian diperoleh (akuisisi bertahap / penjualan sebagian). */
export interface OwnershipChange {
  date: string;
  /** Kepemilikan langsung sebelum & sesudah (persen). */
  pctBefore: Decimal.Value;
  pctAfter: Decimal.Value;
  /** Harga beli tambahan (bila naik) atau hasil penjualan (bila turun), mata uang penyajian. */
  consideration: Decimal.Value | null;
  /** Aset bersih entitas anak pada tanggal perubahan (mata uang penyajian). */
  netAssets: Decimal.Value;
  /** Perubahan terjadi di dalam periode laporan. */
  inPeriod: boolean;
  /** Laba periode berjalan sebelum tanggal perubahan (mata uang penyajian, laba positif). */
  periodProfitBefore?: Decimal.Value;
}

export interface OwnershipInput {
  parentId: string;
  /** Kepemilikan langsung saat ini (persen). */
  pct: Decimal.Value;
  /** Data akuisisi saat pengendalian diperoleh (mata uang penyajian). */
  consideration: Decimal.Value | null;
  acquiredNetAssets: Decimal.Value | null;
  changes?: OwnershipChange[];
  /**
   * Akuisisi bertahap (PSAK 22): kepemilikan sebelum pengendalian diukur ulang ke nilai wajar. `uplift` = nilai wajar −
   * biaya kepemilikan sebelumnya (menambah goodwill); `equityShare` = bagian laba metode ekuitas yang sudah diakui
   * selama kepemilikan sebelumnya (sebelum periode / di dalam periode); laba pengukuran ulang = uplift − equityShare.
   */
  remeasurement?: {
    uplift: Decimal.Value;
    equityShareBefore: Decimal.Value;
    equityShareInPeriod: Decimal.Value;
    /** Pengendalian diperoleh di dalam periode laporan. */
    inPeriod: boolean;
  };
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
  /**
   * Kurs pada tanggal pengendalian diperoleh (entitas asing): goodwill adalah aset entitas asing (PSAK 10) sehingga
   * dijabarkan ulang dengan kurs penutupan; selisihnya masuk selisih kurs penjabaran.
   */
  acquisitionRate?: Decimal.Value;
  /** Relasi dari induk yang ada dalam lingkup konsolidasi. */
  links: OwnershipInput[];
  /**
   * Saldo lokal per akun grup: akun neraca kumulatif, akun laba rugi selama periode. `translated` (opsional) adalah
   * jumlah dalam mata uang penyajian yang sudah dijabarkan (mis. ekuitas dengan kurs per tanggal transaksi).
   */
  balances: { groupAccountId: string; amount: Decimal.Value; translated?: Decimal.Value }[];
  /** Laba/rugi sebelum periode yang belum ditutup ke saldo laba (lokal; terjemahan opsional). */
  priorUnallocated: Decimal.Value;
  priorTranslated?: Decimal.Value;
  /** Laba/rugi sejak akuisisi sampai awal periode (lokal; metode ekuitas & entitas yang dilepas). */
  postAcquisitionPrior?: Decimal.Value;
  postAcquisitionPriorTranslated?: Decimal.Value;
  /** Bagian saldo yang berlawanan dengan perusahaan lain dalam grup (subset dari `balances`). */
  intercompany: {
    groupAccountId: string;
    counterpartId: string;
    amount: Decimal.Value;
    translated?: Decimal.Value;
  }[];
  /** Laba rugi lokal per segmen periode dengan kepemilikan efektif berbeda (bila kepemilikan berubah). */
  profitSegments?: { effectivePct: Decimal.Value; profit: Decimal.Value }[];
  /**
   * Pengendalian/pengaruh dilepas dalam periode: hanya laba rugi sampai tanggal ini yang digabung. `cta`: selisih kurs
   * penjabaran kumulatif entitas (100%, kredit negatif) pada tanggal pelepasan — bagian induk direklasifikasi ke laba rugi.
   */
  disposal?: { date: string; cta?: Decimal.Value };
}

export interface ConsolidationOptions {
  /** Laba belum terealisasi atas persediaan antar perusahaan (mata uang penyajian), akhir & awal periode. */
  unrealizedProfits?: { sellerId: string; buyerId: string; closing: Decimal.Value; opening: Decimal.Value }[];
  /** Nilai barang yang dibeli `buyerId` dari `sellerId` selama periode (mata uang penyajian). */
  icGoods?: { sellerId: string; buyerId: string; amount: Decimal.Value }[];
  /**
   * Aset tetap yang dijual antar perusahaan grup (mata uang penyajian): laba penjual (`gain`), sisa laba belum
   * terealisasi akhir/awal periode (berkurang seiring penyusutan pembeli), dan akun grup terkait.
   */
  assetProfits?: {
    sellerId: string;
    buyerId: string;
    name: string;
    gain: Decimal.Value;
    closing: Decimal.Value;
    opening: Decimal.Value;
    /** Penjualan terjadi di dalam periode (laba penjual ada di laba rugi periode ini). */
    inPeriod: boolean;
    gainAccountId: string;
    assetAccountId: string;
    expenseAccountId: string;
  }[];
  /**
   * Laba belum terealisasi atas persediaan dengan entitas asosiasi/ventura bersama (mata uang penyajian, 100%):
   * downstream = barang grup masih di asosiasi; upstream = barang asosiasi masih di entitas grup (`groupEntityId`).
   * Dieliminasi sebesar bagian investor (PSAK 15).
   */
  associateProfits?: {
    associateId: string;
    groupEntityId: string;
    direction: "downstream" | "upstream";
    closing: Decimal.Value;
    opening: Decimal.Value;
  }[];
}

export interface EntryLine {
  groupAccountId: string;
  companyId: string | null;
  amount: string;
}
export interface ConsolidationEntry {
  kind:
    | "translation"
    | "investment"
    | "nci_profit"
    | "intercompany"
    | "equity_method"
    | "manual"
    | "unrealized_profit"
    | "disposal";
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
const fmt = (v: Decimal) => v.toFixed(2);

/** Kurs translasi per jenis akun: aset/liabilitas kurs penutupan, laba rugi kurs rata-rata, ekuitas kurs historis. */
function rateFor(type: string, e: EntityInput) {
  if (ASSET_LIABILITY_TYPES.includes(type)) return D(e.closingRate);
  if (isPL(type)) return D(e.averageRate);
  return D(e.historicalRate);
}

export function consolidate(
  accounts: GroupAccountInfo[],
  entities: EntityInput[],
  options: ConsolidationOptions = {},
): ConsolidationResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const role = (r: GroupAccountRole) => {
    const account = accounts.find((a) => a.role === r);
    if (!account)
      throw new Error(
        `Akun grup dengan peran "${r}" belum ada — klik "Buat bagan akun grup" di Pemetaan Akun untuk melengkapinya`,
      );
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
  const disposed = new Set(entities.filter((e) => e.disposal).map((e) => e.companyId));
  const names = new Map(entities.map((e) => [e.companyId, e.name]));
  const retained = role("retained_earnings");
  const factorOf = (e: EntityInput) => (e.method === "proportional" ? D(e.effectivePct).div(100) : D(1));
  const translate = (
    e: EntityInput,
    item: { groupAccountId: string; amount: Decimal.Value; translated?: Decimal.Value },
  ) =>
    item.translated !== undefined && item.translated !== null
      ? D(item.translated)
      : D(item.amount).times(rateFor(typeOf(item.groupAccountId), e));

  /** Saldo terjemahan per entitas (setelah faktor metode), dipakai eliminasi. */
  const translated = new Map<string, Map<string, Decimal>>();
  /** Laba periode terjemahan per entitas (laba positif), sebelum penyeimbang pelepasan. */
  const profitOf = new Map<string, Decimal>();

  for (const e of entities) {
    const factor = factorOf(e);
    const rows = new Map<string, { local: Decimal; amount: Decimal }>();
    const add = (accountId: string, local: Decimal, amount: Decimal) => {
      const row = rows.get(accountId) ?? { local: D(0), amount: D(0) };
      row.local = row.local.plus(local);
      row.amount = row.amount.plus(amount);
      rows.set(accountId, row);
    };
    for (const b of e.balances) add(b.groupAccountId, D(b.amount), r2(translate(e, b).times(factor)));
    const prior = D(e.priorUnallocated);
    if (!prior.isZero() || e.priorTranslated !== undefined) {
      const amount = e.priorTranslated !== undefined ? D(e.priorTranslated) : prior.times(e.historicalRate);
      add(retained, prior, r2(amount.times(factor)));
    }
    const pl = [...rows].filter(([id]) => isPL(typeOf(id)));
    profitOf.set(
      e.companyId,
      pl.reduce((s, [, r]) => s.minus(r.amount), D(0)),
    );
    const total = [...rows.values()].reduce((s, r) => s.plus(r.amount), D(0));
    if (e.disposal) {
      // Entitas yang dilepas hanya membawa laba ruginya; aset neto yang dilepas menyeimbangkan kolomnya.
      const local = pl.reduce((s, [, r]) => s.minus(r.local), D(0));
      if (!total.isZero()) add(role("disposal_gain"), local, total.negated());
    } else if (!total.isZero()) {
      // Selisih kurs penjabaran menyeimbangkan neraca saldo terjemahan (bagian dari ekuitas entitas).
      add(role("cta"), D(0), total.negated());
    }

    const map = new Map([...rows].map(([id, r]) => [id, r.amount]));
    translated.set(e.companyId, map);
    if (e.method === "equity") continue;
    for (const [groupAccountId, r] of rows) {
      if (r.local.isZero() && r.amount.isZero()) continue;
      balances.push({
        companyId: e.companyId,
        groupAccountId,
        localAmount: fmt(r.local),
        amount: fmt(r.amount),
      });
    }
  }

  const line = (groupAccountId: string, companyId: string | null, amount: Decimal): EntryLine => ({
    groupAccountId,
    companyId,
    amount: fmt(r2(amount)),
  });
  const nonZero = (lines: EntryLine[]) => lines.filter((l) => !D(l.amount).isZero());
  const priorProfit = (e: EntityInput) =>
    (e.postAcquisitionPriorTranslated !== undefined
      ? D(e.postAcquisitionPriorTranslated)
      : D(e.postAcquisitionPrior).times(e.historicalRate)
    ).negated();

  /** Goodwill (mata uang penyajian pada tanggal akuisisi) dijabarkan ulang dengan kurs penutupan entitas asing. */
  const goodwillAtClosing = (e: EntityInput, goodwill: Decimal) =>
    e.acquisitionRate !== undefined && !D(e.acquisitionRate).isZero() && goodwill.gt(0)
      ? r2(goodwill.times(e.closingRate).div(e.acquisitionRate))
      : goodwill;
  /** Goodwill pada tanggal pengendalian dari data akuisisi (tanpa data → nol). */
  const goodwillOf = (e: EntityInput) => {
    const acquired = e.links[0]?.acquiredNetAssets;
    if (acquired === null || acquired === undefined) return D(0);
    return e.links.reduce((s, l) => {
      if (l.consideration === null) return s;
      const pK = D(l.changes?.[0]?.pctBefore ?? l.pct).div(100);
      return s.plus(D(l.consideration).minus(pK.times(acquired))).plus(l.remeasurement?.uplift ?? 0);
    }, D(0));
  };
  /**
   * Pelepasan entitas asing: bagian induk atas selisih kurs penjabaran kumulatif (termasuk atas goodwill) sudah ikut
   * dalam laba pelepasan grup; dipisahkan ke akun reklasifikasi agar terlihat sebagai reklasifikasi dari penghasilan
   * komprehensif lain ke laba rugi (PSAK 10).
   */
  const recycle = (e: EntityInput, share: Decimal) => {
    if (!e.disposal) return;
    let amount = r2(D(e.disposal.cta).negated().times(share));
    const gw = goodwillOf(e);
    if (gw.gt(0)) amount = amount.plus(goodwillAtClosing(e, gw).minus(gw));
    if (amount.isZero()) return;
    if (!accounts.some((a) => a.role === "cta_reclassified")) {
      warnings.push(
        `${e.name}: selisih kurs penjabaran ${fmt(amount)} ikut dalam laba pelepasan — klik "Buat bagan akun grup" agar reklasifikasinya disajikan terpisah`,
      );
      return;
    }
    entries.push({
      kind: "disposal",
      companyId: e.companyId,
      description: `Reklasifikasi selisih kurs penjabaran kumulatif ${e.name} ke laba rugi saat pelepasan`,
      lines: [
        line(role("disposal_gain"), null, amount),
        line(role("cta_reclassified"), null, amount.negated()),
      ],
    });
  };

  // ---- Eliminasi investasi vs ekuitas entitas anak (metode penuh), bagian laba KNP, pelepasan ----
  for (const e of entities.filter((x) => x.method === "full" && !x.isRoot)) {
    const rows = translated.get(e.companyId)!;
    const pEff = D(e.effectivePct).div(100);
    const profit = profitOf.get(e.companyId)!;
    const nciShare = e.profitSegments
      ? e.profitSegments.reduce(
          (s, seg) =>
            s.plus(
              r2(
                D(1).minus(D(seg.effectivePct).div(100)).times(D(seg.profit).negated().times(e.averageRate)),
              ),
            ),
          D(0),
        )
      : r2(D(1).minus(pEff).times(profit));
    if (!nciShare.isZero())
      entries.push({
        kind: "nci_profit",
        companyId: e.companyId,
        description: `Bagian laba ${e.name} untuk kepentingan non-pengendali`,
        lines: [line(role("nci_profit"), null, nciShare), line(role("nci_equity"), null, nciShare.negated())],
      });

    if (e.disposal) {
      // Laba pelepasan grup = laba di buku induk − bagian induk atas kenaikan aset neto sejak akuisisi.
      const prior = r2(priorProfit(e));
      const lines = nonZero([
        line(role("disposal_gain"), null, pEff.times(prior).minus(nciShare)),
        line(retained, null, pEff.times(prior).negated()),
        line(role("nci_equity"), null, nciShare),
      ]);
      if (lines.length)
        entries.push({
          kind: "disposal",
          companyId: e.companyId,
          description: `Pelepasan ${e.name} per ${e.disposal.date}: penyesuaian laba pelepasan & aset neto yang dilepas`,
          lines,
        });
      recycle(e, pEff);
      continue;
    }

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
    const pct = (v: Decimal.Value) => D(v).div(100);
    const pNow = links.reduce((s, l) => s.plus(pct(l.pct)), D(0));
    const pControl = links.reduce((s, l) => s.plus(pct(l.changes?.[0]?.pctBefore ?? l.pct)), D(0));
    // Kepemilikan efektif per satu satuan kepemilikan langsung (sama dengan 1 bila dimiliki langsung oleh induk utama).
    const scale = pNow.isZero() ? D(0) : pEff.div(pNow);

    const lines: EntryLine[] = equityRows.map(([id, v]) => line(id, e.companyId, v.negated()));
    let goodwillTotal = D(0);
    // Bagian induk atas perubahan ekuitas sejak akuisisi, ditimbang per tahap kepemilikan.
    let ownersBase = pEff.times(otherEquity).minus(scale.times(pControl).times(acquired));
    for (const l of links) {
      const pK = pct(l.changes?.[0]?.pctBefore ?? l.pct);
      const cost = l.consideration === null || missing ? r2(pK.times(acquired)) : D(l.consideration);
      let carrying = cost;
      goodwillTotal = goodwillTotal.plus(cost.minus(pK.times(acquired)));
      const rm = l.remeasurement;
      if (rm && !missing) {
        // Kepemilikan sebelumnya diukur ulang ke nilai wajar: goodwill bertambah sebesar kenaikannya; bagian laba
        // metode ekuitas yang sudah diakui tetap di saldo laba/laba periode, sisanya laba pengukuran ulang.
        const uplift = r2(D(rm.uplift));
        const before = r2(D(rm.equityShareBefore));
        const during = r2(D(rm.equityShareInPeriod));
        goodwillTotal = goodwillTotal.plus(uplift);
        const gain = uplift.minus(before).minus(during);
        if (rm.inPeriod) {
          lines.push(line(role("remeasurement_gain"), l.parentId, gain.negated()));
          lines.push(line(role("associate_income"), l.parentId, during.negated()));
        } else lines.push(line(retained, l.parentId, gain.plus(during).negated()));
        lines.push(line(retained, l.parentId, before.negated()));
      }
      for (const c of l.changes ?? []) {
        const before = pct(c.pctBefore);
        const delta = pct(c.pctAfter).minus(before);
        const netAssets = D(c.netAssets);
        if (c.consideration === null)
          warnings.push(
            `${e.name}: harga transaksi perubahan kepemilikan ${c.date} belum diisi — dianggap sebesar nilai buku`,
          );
        const price = c.consideration === null ? delta.abs().times(netAssets) : D(c.consideration);
        if (delta.gt(0)) {
          carrying = carrying.plus(price);
          // Pembelian dari KNP: selisih harga dengan bagian aset neto yang dibeli langsung ke ekuitas.
          lines.push(line(role("equity_transactions"), null, price.minus(delta.times(netAssets))));
        } else if (delta.lt(0)) {
          // Penjualan sebagian tanpa kehilangan pengendalian: biaya investasi dihentikan proporsional, laba di buku
          // induk dibalik dan selisih harga dengan bagian aset neto yang dijual masuk ekuitas.
          const derecognized = before.isZero() ? D(0) : carrying.times(delta.abs()).div(before);
          carrying = carrying.minus(derecognized);
          lines.push(
            line(c.inPeriod ? role("disposal_gain") : retained, l.parentId, price.minus(derecognized)),
          );
          lines.push(line(role("equity_transactions"), null, price.negated().minus(delta.times(netAssets))));
        }
        const base = netAssets.minus(c.inPeriod ? D(c.periodProfitBefore) : D(0));
        ownersBase = ownersBase.minus(scale.times(delta).times(base));
      }
      lines.push(line(role("investment"), l.parentId, r2(carrying).negated()));
    }
    // Goodwill negatif (pembelian dengan diskon) langsung diakui di saldo laba.
    if (goodwillTotal.gte(0)) {
      const gw = goodwillAtClosing(e, goodwillTotal);
      lines.push(line(role("goodwill"), null, gw));
      // Selisih penjabaran goodwill seluruhnya milik induk (goodwill hanya atas bagian induk).
      if (!gw.minus(goodwillTotal).isZero()) lines.push(line(ctaId, null, gw.minus(goodwillTotal).negated()));
    } else lines.push(line(retained, null, goodwillTotal));
    lines.push(line(retained, null, ownersBase.negated()));
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
  }

  for (const e of entities.filter((x) => x.method === "proportional" && x.disposal))
    recycle(e, D(e.effectivePct).div(100));

  // ---- Metode ekuitas (asosiasi / ventura bersama) ----
  for (const e of entities.filter((x) => x.method === "equity")) {
    const share = D(e.effectivePct).div(100);
    const profit = r2(share.times(profitOf.get(e.companyId)!));
    const prior = r2(share.times(priorProfit(e)));
    const lines = nonZero(
      e.disposal
        ? [
            line(role("associate_income"), null, profit.negated()),
            line(role("disposal_gain"), null, profit.plus(prior)),
            line(retained, null, prior.negated()),
          ]
        : [
            line(role("associate_investment"), null, profit.plus(prior)),
            line(role("associate_income"), null, profit.negated()),
            line(retained, null, prior.negated()),
          ],
    );
    if (lines.length)
      entries.push({
        kind: "equity_method",
        companyId: e.companyId,
        description: `Bagian laba ${e.name} (metode ekuitas ${share.times(100).toFixed(2)}%)`,
        lines,
      });

    // Dividen dari asosiasi mengurangi nilai investasi, bukan pendapatan grup.
    const declared = e.intercompany
      .filter((i) => inScope.has(i.counterpartId) && EQUITY_TYPES.includes(typeOf(i.groupAccountId)))
      .reduce((s, i) => s.plus(r2(translate(e, i))), D(0));
    if (declared.gt(0) && !e.disposal) {
      const received = aggregated.flatMap((p) =>
        p.intercompany
          .filter((i) => i.counterpartId === e.companyId && isPL(typeOf(i.groupAccountId)))
          .map((i) => ({
            companyId: p.companyId,
            groupAccountId: i.groupAccountId,
            amount: r2(translate(p, i)),
          }))
          .filter((i) => i.amount.lt(0)),
      );
      let remaining = Decimal.min(
        declared,
        received.reduce((s, i) => s.minus(i.amount), D(0)),
      );
      const total = remaining;
      const divLines: EntryLine[] = [];
      for (const r of received) {
        if (remaining.lte(0)) break;
        const take = Decimal.min(remaining, r.amount.negated());
        divLines.push(line(r.groupAccountId, r.companyId, take));
        remaining = remaining.minus(take);
      }
      if (total.gt(0)) {
        divLines.push(line(role("associate_investment"), null, total.negated()));
        entries.push({
          kind: "equity_method",
          companyId: e.companyId,
          description: `Dividen dari ${e.name} mengurangi investasi pada entitas asosiasi`,
          lines: divLines,
        });
      }
    }
  }

  // ---- Eliminasi saldo, transaksi & dividen antar perusahaan dalam lingkup ----
  type Side = { residual: Decimal; atClosing: Decimal };
  const pairs = new Map<string, { a: string; b: string; balance: Side; result: Side }>();
  const icLines: EntryLine[] = [];
  for (const e of aggregated) {
    const factor = factorOf(e);
    const byAccount = new Map<string, Decimal>();
    for (const ic of e.intercompany) {
      const cp = ic.counterpartId;
      if (!inScope.has(cp) || cp === e.companyId) continue;
      const type = typeOf(ic.groupAccountId);
      // Dividen (ekuitas) dipasangkan dengan pendapatan dividen induk di sisi transaksi.
      const side = isPL(type) || EQUITY_TYPES.includes(type) ? "result" : "balance";
      // Saldo dengan entitas yang sudah dilepas bukan lagi saldo antar perusahaan.
      if (side === "balance" && (e.disposal || disposed.has(cp))) continue;
      const amount = r2(translate(e, ic).times(factor));
      // Dividen entitas anak metode penuh: akun dividennya sudah tereliminasi bersama ekuitas, jadi pasangan
      // pendapatan dividen induk dieliminasi terhadap saldo laba (bagian induk atas laba yang dibagikan).
      const target =
        EQUITY_TYPES.includes(type) && e.method === "full" && !e.isRoot ? retained : ic.groupAccountId;
      byAccount.set(target, (byAccount.get(target) ?? D(0)).plus(amount));
      const [a, b] = [e.companyId, cp].sort() as [string, string];
      const key = `${a}:${b}`;
      const pair = pairs.get(key) ?? {
        a,
        b,
        balance: { residual: D(0), atClosing: D(0) },
        result: { residual: D(0), atClosing: D(0) },
      };
      pair[side].residual = pair[side].residual.minus(amount);
      pair[side].atClosing = pair[side].atClosing.minus(D(ic.amount).times(e.closingRate).times(factor));
      pairs.set(key, pair);
    }
    for (const [id, amount] of byAccount) icLines.push(line(id, e.companyId, amount.negated()));
  }
  const goods = (a: string, b: string) =>
    (options.icGoods ?? [])
      .filter((g) => (g.sellerId === a && g.buyerId === b) || (g.sellerId === b && g.buyerId === a))
      .reduce((s, g) => s.plus(g.amount), D(0));
  for (const pair of pairs.values()) {
    for (const kind of ["balance", "result"] as const) {
      let residual = r2(pair[kind].residual);
      let atClosing = pair[kind].atClosing;
      if (residual.isZero()) continue;
      // Penjualan barang antar perusahaan: pembeli mencatat persediaan/HPP tanpa pasangan IC, jadi pendapatan
      // penjual dieliminasi terhadap harga pokok penjualan grup.
      const g = kind === "result" ? goods(pair.a, pair.b) : D(0);
      if (g.gt(0) && residual.gt(0)) {
        const take = Decimal.min(residual, g);
        icLines.push(line(role("cost_of_sales"), null, take.negated()));
        residual = residual.minus(take);
        atClosing = atClosing.minus(take);
      }
      if (residual.isZero()) continue;
      if (atClosing.abs().lt(1)) {
        // Saldo cocok dalam mata uang asal; selisihnya hanya akibat kurs penjabaran.
        icLines.push(line(role("cta"), null, residual.negated()));
      } else {
        icLines.push(line(role("ic_difference"), null, residual.negated()));
        warnings.push(
          `${names.get(pair.a)} – ${names.get(pair.b)}: ${kind === "balance" ? "saldo" : "transaksi"} antar perusahaan tidak saling hapus, selisih ${fmt(residual.negated())} dipindah ke akun selisih eliminasi — periksa rekonsiliasi antar perusahaan`,
        );
      }
    }
  }
  if (nonZero(icLines).length)
    entries.push({
      kind: "intercompany",
      companyId: null,
      description: "Eliminasi saldo, transaksi & dividen antar perusahaan",
      lines: nonZero(icLines),
    });

  // ---- Laba belum terealisasi atas persediaan antar perusahaan ----
  const entityById = new Map(entities.map((e) => [e.companyId, e]));
  for (const u of options.unrealizedProfits ?? []) {
    const seller = entityById.get(u.sellerId);
    const buyer = entityById.get(u.buyerId);
    if (!seller || !buyer || !inScope.has(u.sellerId) || !inScope.has(u.buyerId)) continue;
    if (seller.disposal || buyer.disposal) continue;
    const closing = r2(D(u.closing));
    const opening = r2(D(u.opening));
    if (closing.isZero() && opening.isZero()) continue;
    // Penjualan dari entitas anak (upstream): KNP ikut menanggung bagiannya.
    const pSeller = seller.isRoot || seller.method !== "full" ? D(1) : D(seller.effectivePct).div(100);
    const nci = D(1).minus(pSeller);
    const lines = [
      line(role("inventory"), u.buyerId, closing.negated()),
      line(role("cost_of_sales"), null, closing.minus(opening)),
      line(retained, null, opening),
    ];
    if (nci.gt(0))
      lines.push(
        line(role("nci_profit"), null, nci.times(closing.minus(opening)).negated()),
        line(role("nci_equity"), null, nci.times(closing)),
        line(retained, null, nci.times(opening).negated()),
      );
    const rest = lines.reduce((s, l) => s.plus(l.amount), D(0));
    if (!rest.isZero()) lines.push(line(retained, null, rest.negated()));
    entries.push({
      kind: "unrealized_profit",
      companyId: u.sellerId,
      description: `Laba belum terealisasi atas persediaan ${buyer.name} yang dibeli dari ${seller.name}`,
      lines: nonZero(lines),
    });
  }

  // ---- Laba belum terealisasi atas aset tetap antar perusahaan ----
  for (const u of options.assetProfits ?? []) {
    const seller = entityById.get(u.sellerId);
    const buyer = entityById.get(u.buyerId);
    if (!seller || !buyer || !inScope.has(u.sellerId) || !inScope.has(u.buyerId)) continue;
    if (seller.disposal || buyer.disposal) continue;
    const closing = r2(D(u.closing));
    // Penjualan dalam periode: laba penjual dibalik; selain itu sisa awal periode dibebankan ke saldo laba.
    const gain = u.inPeriod ? r2(D(u.gain)) : D(0);
    const opening = u.inPeriod ? D(0) : r2(D(u.opening));
    if (closing.isZero() && gain.isZero() && opening.isZero()) continue;
    const pSeller = seller.isRoot || seller.method !== "full" ? D(1) : D(seller.effectivePct).div(100);
    const nci = D(1).minus(pSeller);
    const lines = [
      line(retained, null, opening),
      line(u.gainAccountId, u.sellerId, gain),
      line(u.assetAccountId, u.buyerId, closing.negated()),
      // Penyusutan pembeli atas laba yang belum terealisasi bukan beban grup.
      line(u.expenseAccountId, u.buyerId, closing.minus(opening).minus(gain)),
    ];
    const profitEffect = closing.minus(opening);
    if (nci.gt(0))
      lines.push(
        line(role("nci_profit"), null, nci.times(profitEffect).negated()),
        line(role("nci_equity"), null, nci.times(closing)),
        line(retained, null, nci.times(opening).negated()),
      );
    const rest = lines.reduce((s, l) => s.plus(l.amount), D(0));
    if (!rest.isZero()) lines.push(line(retained, null, rest.negated()));
    entries.push({
      kind: "unrealized_profit",
      companyId: u.sellerId,
      description: `Laba belum terealisasi atas aset tetap ${u.name} yang dijual ${seller.name} ke ${buyer.name}`,
      lines: nonZero(lines),
    });
  }

  // ---- Laba belum terealisasi atas persediaan dengan entitas asosiasi ----
  for (const u of options.associateProfits ?? []) {
    const associate = entityById.get(u.associateId);
    const other = entityById.get(u.groupEntityId);
    if (!associate || associate.method !== "equity" || associate.disposal) continue;
    if (!other || !inScope.has(u.groupEntityId) || other.disposal) continue;
    const share = D(associate.effectivePct).div(100);
    const closing = r2(D(u.closing).times(share));
    const opening = r2(D(u.opening).times(share));
    if (closing.isZero() && opening.isZero()) continue;
    // Downstream: mengurangi investasi pada asosiasi; upstream: mengurangi persediaan entitas grup pembeli.
    const asset =
      u.direction === "downstream"
        ? line(role("associate_investment"), null, closing.negated())
        : line(role("inventory"), u.groupEntityId, closing.negated());
    entries.push({
      kind: "unrealized_profit",
      companyId: u.associateId,
      description:
        u.direction === "downstream"
          ? `Bagian investor atas laba belum terealisasi: persediaan ${associate.name} yang dibeli dari ${other.name}`
          : `Bagian investor atas laba belum terealisasi: persediaan ${other.name} yang dibeli dari ${associate.name}`,
      lines: nonZero([
        line(role("associate_income"), null, closing.minus(opening)),
        asset,
        line(retained, null, opening),
      ]),
    });
  }

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

type PositionRow = { groupAccountId: string; amount: Decimal.Value };

/**
 * Posisi keuangan konsolidasian dengan laba rugi ditutup ke saldo laba: laba rugi periode dan bagian KNP-nya
 * (yang sudah dikreditkan ke KNP) dipindah ke akun saldo laba. Dipakai sebagai saldo awal periode berikutnya.
 */
export function closingPosition(
  accounts: GroupAccountInfo[],
  rows: { groupAccountId: string; consolidated: Decimal.Value }[],
): { groupAccountId: string; amount: string }[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const retained = accounts.find((a) => a.role === "retained_earnings");
  if (!retained) throw new Error('Akun grup dengan peran "retained_earnings" belum ada');
  const position = new Map<string, Decimal>();
  for (const r of rows) {
    const account = byId.get(r.groupAccountId);
    if (!account) continue;
    const target = isPL(account.accountType) || account.role === "nci_profit" ? retained.id : account.id;
    position.set(target, (position.get(target) ?? D(0)).plus(r.consolidated));
  }
  return [...position]
    .filter(([, v]) => !v.isZero())
    .map(([groupAccountId, v]) => ({ groupAccountId, amount: fmt(v) }));
}

const EQUITY_COLUMNS = ["capital", "retained", "cta", "transactions", "owners", "nci", "total"] as const;
type EquityColumn = (typeof EQUITY_COLUMNS)[number];

/** Laporan perubahan ekuitas konsolidasian (jumlah kredit positif) dari saldo awal dan kertas kerja akhir. */
export function equityChanges(accounts: GroupAccountInfo[], opening: PositionRow[], rows: WorksheetRow[]) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const column = (id: string): Exclude<EquityColumn, "owners" | "total"> | null => {
    const a = byId.get(id);
    if (!a || !EQUITY_TYPES.includes(a.accountType)) return null;
    if (a.role === "retained_earnings" || a.role === "dividends") return "retained";
    if (a.role === "cta") return "cta";
    if (a.role === "equity_transactions") return "transactions";
    if (a.role === "nci_equity") return "nci";
    return "capital";
  };
  const totals = (position: PositionRow[]) => {
    const t = { capital: D(0), retained: D(0), cta: D(0), transactions: D(0), nci: D(0) };
    for (const p of position) {
      const c = column(p.groupAccountId);
      if (c) t[c] = t[c].minus(p.amount);
    }
    return t;
  };
  const closePosition = closingPosition(accounts, rows);
  const open = totals(opening);
  const close = totals(closePosition);
  const sumRole = (position: PositionRow[], r: GroupAccountRole) =>
    position.filter((p) => byId.get(p.groupAccountId)?.role === r).reduce((s, p) => s.plus(p.amount), D(0));
  const statements = consolidatedStatements(rows);
  // Selisih kurs yang direklasifikasi ke laba rugi periode ini (kredit positif).
  const recycled = rows
    .filter((r) => r.role === "cta_reclassified")
    .reduce((s, r) => s.minus(r.consolidated), D(0));
  const zero = { capital: D(0), retained: D(0), cta: D(0), transactions: D(0), nci: D(0) };
  const movements: { key: string; label: string; values: typeof zero }[] = [
    {
      key: "profit",
      label: "Laba tahun berjalan",
      values: {
        ...zero,
        retained: D(statements.profitLoss.attributableToOwners),
        nci: D(statements.profitLoss.attributableToNci),
      },
    },
    {
      key: "translation",
      label: "Selisih kurs penjabaran laporan keuangan (penghasilan komprehensif lain)",
      values: { ...zero, cta: close.cta.minus(open.cta).plus(recycled) },
    },
    {
      key: "reclassification",
      label: "Reklasifikasi selisih kurs penjabaran ke laba rugi (pelepasan entitas asing)",
      values: { ...zero, cta: recycled.negated() },
    },
    {
      key: "dividends",
      label: "Dividen",
      values: {
        ...zero,
        retained: sumRole(closePosition, "dividends").minus(sumRole(opening, "dividends")).negated(),
      },
    },
    {
      key: "transactions",
      label: "Transaksi dengan kepentingan non-pengendali",
      values: { ...zero, transactions: close.transactions.minus(open.transactions) },
    },
  ];
  const other = { ...zero };
  for (const c of ["capital", "retained", "cta", "transactions", "nci"] as const) {
    other[c] = movements.reduce((s, m) => s.minus(m.values[c]), close[c].minus(open[c]));
  }
  movements.push({
    key: "other",
    label: "Setoran modal, perubahan lingkup & lain-lain",
    values: other,
  });
  const render = (key: string, label: string, v: typeof zero) => {
    const owners = v.capital.plus(v.retained).plus(v.cta).plus(v.transactions);
    return {
      key,
      label,
      values: {
        capital: fmt(v.capital),
        retained: fmt(v.retained),
        cta: fmt(v.cta),
        transactions: fmt(v.transactions),
        owners: fmt(owners),
        nci: fmt(v.nci),
        total: fmt(owners.plus(v.nci)),
      } as Record<EquityColumn, string>,
    };
  };
  return {
    columns: EQUITY_COLUMNS,
    rows: [
      render("opening", "Saldo awal", open),
      ...movements
        .filter((m) => m.key !== "reclassification" || !recycled.isZero())
        .map((m) => render(m.key, m.label, m.values)),
      render("closing", "Saldo akhir", close),
    ],
  };
}

/**
 * Laporan arus kas konsolidasian metode tidak langsung, disusun dari perubahan posisi keuangan awal–akhir.
 * Pengaruh selisih kurs penjabaran disajikan terpisah agar arus kas bersih sama dengan perubahan kas.
 */
export function consolidatedCashFlow(
  accounts: GroupAccountInfo[],
  opening: PositionRow[],
  rows: WorksheetRow[],
) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const close = new Map(closingPosition(accounts, rows).map((p) => [p.groupAccountId, D(p.amount)]));
  const open = new Map(opening.map((p) => [p.groupAccountId, D(p.amount)]));
  const delta = (pred: (a: GroupAccountInfo) => boolean) =>
    [...new Set([...close.keys(), ...open.keys()])]
      .filter((id) => byId.has(id) && pred(byId.get(id)!))
      .reduce((s, id) => s.plus(close.get(id) ?? 0).minus(open.get(id) ?? 0), D(0));
  const plSum = (pred: (r: WorksheetRow) => boolean) =>
    rows.filter(pred).reduce((s, r) => s.plus(r.consolidated), D(0));
  const typeIs =
    (...types: string[]) =>
    (a: GroupAccountInfo) =>
      types.includes(a.accountType);

  const netProfit = D(consolidatedStatements(rows).profitLoss.netProfit);
  const depreciation = plSum((r) => r.accountType === "expense_depreciation");
  const associateShare = plSum((r) => r.role === "associate_income");
  const cashOpening = [...open].filter(([id]) => byId.get(id)?.accountType === "asset_cash");
  const cashClosing = [...close].filter(([id]) => byId.get(id)?.accountType === "asset_cash");
  const sum = (list: [string, Decimal][]) => list.reduce((s, [, v]) => s.plus(v), D(0));

  const item = (label: string, amount: Decimal) => ({ label, amount: fmt(amount) });
  const section = (items: ReturnType<typeof item>[]) => ({
    items: items.filter((i) => !D(i.amount).isZero() || i.label === items[0]!.label),
    total: fmt(items.reduce((s, i) => s.plus(i.amount), D(0))),
  });
  const operating = section([
    item("Laba bersih", netProfit),
    item("Penyusutan", depreciation),
    item("Bagian laba entitas asosiasi", associateShare),
    item("Perubahan piutang", delta(typeIs("asset_receivable")).negated()),
    item("Perubahan persediaan & aset lancar lain", delta(typeIs("asset_current")).negated()),
    item("Perubahan utang usaha", delta(typeIs("liability_payable")).negated()),
    item("Perubahan liabilitas lancar lain", delta(typeIs("liability_current")).negated()),
  ]);
  const investing = section([
    item("Perolehan aset tetap (neto)", delta(typeIs("asset_fixed")).plus(depreciation).negated()),
    item(
      "Investasi, goodwill & aset tidak lancar lain",
      delta(typeIs("asset_non_current")).plus(associateShare).negated(),
    ),
  ]);
  const financing = section([
    item("Pinjaman & liabilitas jangka panjang", delta(typeIs("liability_non_current")).negated()),
    item(
      "Setoran modal, dividen & transaksi dengan KNP",
      delta((a) => EQUITY_TYPES.includes(a.accountType) && a.role !== "cta")
        .negated()
        .minus(netProfit),
    ),
  ]);
  const translation = delta((a) => a.role === "cta").negated();
  const netChange = D(operating.total).plus(investing.total).plus(financing.total).plus(translation);
  return {
    operating,
    investing,
    financing,
    translationEffect: fmt(translation),
    netChange: fmt(netChange),
    cashOpening: fmt(sum(cashOpening)),
    cashClosing: fmt(sum(cashClosing)),
    // Nol bila semua perubahan posisi keuangan terklasifikasi.
    difference: fmt(sum(cashClosing).minus(sum(cashOpening)).minus(netChange)),
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

/** Selisih kurs penjabaran kumulatif satu entitas (100%, kredit negatif) dari saldonya sendiri. */
export function translationReserve(accounts: GroupAccountInfo[], e: EntityInput): string {
  const cta = accounts.find((a) => a.role === "cta");
  if (!cta) return "0.00";
  const { disposal: _disposal, profitSegments: _segments, ...rest } = e;
  const r = consolidate(accounts, [
    { ...rest, isRoot: true, method: "full", effectivePct: 100, links: [], intercompany: [] },
  ]);
  return r.balances.find((b) => b.groupAccountId === cta.id)?.amount ?? "0.00";
}

export interface SegmentInput {
  key: string;
  name: string;
  /** Saldo laba rugi segmen dalam mata uang penyajian (debit positif), sebelum eliminasi. */
  balances: { groupAccountId: string; amount: Decimal.Value }[];
}
export interface SegmentRow {
  key: string;
  name: string;
  income: string;
  directCost: string;
  grossProfit: string;
  expense: string;
  otherNet: string;
  netProfit: string;
}

/**
 * Laporan segmen (PSAK 5): laba rugi per segmen sebelum eliminasi, ditambah baris "Eliminasi & penyesuaian" yang
 * merekonsiliasi jumlah segmen ke laba rugi konsolidasian kertas kerja.
 */
export function segmentReport(accounts: GroupAccountInfo[], segments: SegmentInput[], rows: WorksheetRow[]) {
  const typeOf = new Map(accounts.map((a) => [a.id, a.accountType]));
  const summarize = (
    key: string,
    name: string,
    items: { groupAccountId: string; amount: Decimal.Value }[],
  ) => {
    const sum = (types: readonly string[]) =>
      items
        .filter((i) => types.includes(typeOf.get(i.groupAccountId) ?? ""))
        .reduce((s, i) => s.plus(i.amount), D(0));
    const income = sum(PROFIT_LOSS_GROUPS.income).negated();
    const directCost = sum(PROFIT_LOSS_GROUPS.directCost);
    const expense = sum(PROFIT_LOSS_GROUPS.expense);
    const otherNet = sum([...PROFIT_LOSS_GROUPS.otherIncome, ...PROFIT_LOSS_GROUPS.otherExpense]).negated();
    const grossProfit = income.minus(directCost);
    return {
      key,
      name,
      income: fmt(income),
      directCost: fmt(directCost),
      grossProfit: fmt(grossProfit),
      expense: fmt(expense),
      otherNet: fmt(otherNet),
      netProfit: fmt(grossProfit.minus(expense).plus(otherNet)),
    };
  };
  const out: SegmentRow[] = segments
    .map((s) => summarize(s.key, s.name, s.balances))
    .filter((s) => !(D(s.income).isZero() && D(s.netProfit).isZero() && D(s.expense).isZero()));
  const total = summarize(
    "consolidated",
    "Konsolidasian",
    rows.map((r) => ({ groupAccountId: r.groupAccountId, amount: r.consolidated })),
  );
  const fields = ["income", "directCost", "grossProfit", "expense", "otherNet", "netProfit"] as const;
  const eliminations = {
    key: "eliminations",
    name: "Eliminasi & penyesuaian",
    ...Object.fromEntries(fields.map((f) => [f, fmt(out.reduce((s, r) => s.minus(r[f]), D(total[f])))])),
  } as SegmentRow;
  return { segments: out, eliminations, total };
}
