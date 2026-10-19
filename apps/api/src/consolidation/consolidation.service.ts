import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, schema, sql, type Db, type SQL } from "@erp/db";
import {
  BALANCE_SHEET_GROUPS,
  BASE_CURRENCY,
  PROFIT_LOSS_TYPES,
  closingPosition,
  consolidate,
  consolidatedCashFlow,
  consolidatedStatements,
  effectiveOwnership,
  equityChanges,
  intercompanyReconciliation,
  worksheet,
  type ConsolidationOptions,
  type EntityInput,
  type GroupAccountInfo,
  type OwnershipInput,
  type consolidationManualEntrySchema,
  type consolidationRatesSchema,
  type consolidationRunSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { FxService } from "../master/fx.controller.js";

type Rates = z.infer<typeof consolidationRatesSchema>;
type Method = "full" | "proportional" | "equity";

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const EQUITY_TYPES: readonly string[] = BALANCE_SHEET_GROUPS.equity;
const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
/** Penjabaran per tanggal transaksi (kurs tanggal transaksi, atau tanggal akuisisi bila lebih awal). */
interface Translation {
  currency: string;
  presentation: string;
  since: string | null;
  /** Dipakai bila Kurs Harian belum ada pada/sebelum tanggal itu. */
  fallback: string;
}
const rateAt = (code: string, date: SQL) =>
  code === BASE_CURRENCY
    ? sql`1::numeric`
    : sql`(select cr.rate from currency_rates cr where cr.currency_code = ${code} and cr.rate_date <= ${date}
          order by cr.rate_date desc limit 1)`;
const datedRate = (t: Translation, date: SQL) => {
  const at = t.since ? sql`greatest(${date}, ${t.since}::date)` : date;
  return sql`coalesce(${rateAt(t.currency, at)} / nullif(${rateAt(t.presentation, at)}, 0), ${t.fallback}::numeric)`;
};
const RANK: Record<Method, number> = { equity: 1, proportional: 2, full: 3 };
/** Jenis akun yang ikut eliminasi antar perusahaan (bukan kas, pajak, atau investasi). */
const IC_TYPES = [
  "asset_receivable",
  "liability_payable",
  "income",
  "income_other",
  "expense",
  "expense_direct_cost",
  "expense_other",
  // Dividen yang diumumkan kepada perusahaan grup.
  "equity",
];

/** Akun grup khusus yang dibuat bersama bagan akun grup. */
const ROLE_ACCOUNTS = [
  { code: "1-3900", name: "Goodwill", accountType: "asset_non_current", role: "goodwill" },
  {
    code: "2-9900",
    name: "Selisih Eliminasi Antar Perusahaan",
    accountType: "liability_current",
    role: "ic_difference",
  },
  { code: "3-8000", name: "Kepentingan Non-Pengendali", accountType: "equity", role: "nci_equity" },
  { code: "3-8100", name: "Selisih Kurs Penjabaran Laporan Keuangan", accountType: "equity", role: "cta" },
  {
    code: "3-8300",
    name: "Selisih Transaksi dengan Kepentingan Non-Pengendali",
    accountType: "equity",
    role: "equity_transactions",
  },
  {
    code: "3-8200",
    name: "Laba Diatribusikan ke Kepentingan Non-Pengendali",
    accountType: "equity_unaffected",
    role: "nci_profit",
  },
  {
    code: "4-9300",
    name: "Bagian Laba Entitas Asosiasi",
    accountType: "income_other",
    role: "associate_income",
  },
] as const;
/** Peran untuk akun bawaan bagan akun standar (kode sama di semua perusahaan). */
const ROLE_BY_CODE: Record<string, (typeof schema.GROUP_ACCOUNT_ROLES)[number]> = {
  "1-3100": "investment",
  "1-3200": "associate_investment",
  "3-2000": "retained_earnings",
  "1-1400": "inventory",
  "5-1000": "cost_of_sales",
  "3-3000": "dividends",
  "4-9400": "disposal_gain",
};

@Injectable()
export class ConsolidationService {
  constructor(@Inject(FxService) private readonly fx: FxService) {}

  // ---- Bagan akun grup & pemetaan ----

  /** Buat bagan akun grup dari bagan akun perusahaan aktif + akun khusus konsolidasi, lalu petakan otomatis. */
  async bootstrap(tx: Db) {
    const companyId = currentContext().companyId;
    const accounts = await tx
      .select({ code: schema.accounts.code, name: schema.accounts.name, type: schema.accounts.accountType })
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId))
      .orderBy(asc(schema.accounts.code));
    const taken = new Set(
      (await tx.select({ role: schema.groupAccounts.role }).from(schema.groupAccounts)).map((r) => r.role),
    );
    const rows = [
      ...accounts.map((a) => {
        const role = ROLE_BY_CODE[a.code];
        return {
          code: a.code,
          name: a.name,
          accountType: a.type,
          role: role && !taken.has(role) ? role : null,
        };
      }),
      ...ROLE_ACCOUNTS.map((a) => ({ ...a, role: taken.has(a.role) ? null : a.role })),
    ];
    const created = await tx
      .insert(schema.groupAccounts)
      .values(rows)
      .onConflictDoNothing({ target: [schema.groupAccounts.tenantId, schema.groupAccounts.code] })
      .returning({ id: schema.groupAccounts.id });
    // Bagan akun grup lama: lengkapi peran yang belum ada pada akun berkode standar.
    const roleByCode = new Map<string, (typeof schema.GROUP_ACCOUNT_ROLES)[number]>([
      ...Object.entries(ROLE_BY_CODE),
      ...ROLE_ACCOUNTS.map((a) => [a.code, a.role] as const),
    ]);
    const assigned = new Set(
      (await tx.select({ role: schema.groupAccounts.role }).from(schema.groupAccounts)).map((r) => r.role),
    );
    for (const [code, role] of roleByCode) {
      if (assigned.has(role)) continue;
      await tx
        .update(schema.groupAccounts)
        .set({ role, updatedAt: sql`now()` })
        .where(and(eq(schema.groupAccounts.code, code), isNull(schema.groupAccounts.role)));
    }
    const mapped = await this.autoMap(tx);
    return { created: created.length, ...mapped };
  }

  /** Petakan setiap akun yang belum dipetakan ke akun grup berkode sama (dibuat bila belum ada). */
  async autoMap(tx: Db) {
    const unmapped = await tx
      .select({
        id: schema.accounts.id,
        companyId: schema.accounts.companyId,
        code: schema.accounts.code,
        name: schema.accounts.name,
        type: schema.accounts.accountType,
      })
      .from(schema.accounts)
      .leftJoin(
        schema.consolidationAccountMap,
        eq(schema.consolidationAccountMap.accountId, schema.accounts.id),
      )
      .where(isNull(schema.consolidationAccountMap.accountId));
    if (!unmapped.length) return { mapped: 0, groupAccountsCreated: 0 };
    const existing = new Map(
      (
        await tx
          .select({ id: schema.groupAccounts.id, code: schema.groupAccounts.code })
          .from(schema.groupAccounts)
      ).map((g) => [g.code, g.id]),
    );
    let created = 0;
    for (const a of unmapped) {
      if (existing.has(a.code)) continue;
      const [g] = await tx
        .insert(schema.groupAccounts)
        .values({ code: a.code, name: a.name, accountType: a.type })
        .returning({ id: schema.groupAccounts.id });
      existing.set(a.code, g!.id);
      created++;
    }
    await tx.insert(schema.consolidationAccountMap).values(
      unmapped.map((a) => ({
        accountId: a.id,
        companyId: a.companyId,
        groupAccountId: existing.get(a.code)!,
      })),
    );
    return { mapped: unmapped.length, groupAccountsCreated: created };
  }

  async mapping(tx: Db, companyId: string) {
    this.assertCompany(companyId);
    return tx
      .select({
        accountId: schema.accounts.id,
        code: schema.accounts.code,
        name: schema.accounts.name,
        accountType: schema.accounts.accountType,
        groupAccountId: schema.consolidationAccountMap.groupAccountId,
      })
      .from(schema.accounts)
      .leftJoin(
        schema.consolidationAccountMap,
        eq(schema.consolidationAccountMap.accountId, schema.accounts.id),
      )
      .where(eq(schema.accounts.companyId, companyId))
      .orderBy(asc(schema.accounts.code));
  }

  async saveMapping(
    tx: Db,
    input: { companyId: string; items: { accountId: string; groupAccountId: string | null }[] },
  ) {
    this.assertCompany(input.companyId);
    const ids = input.items.map((i) => i.accountId);
    if (!ids.length) return this.mapping(tx, input.companyId);
    const owned = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(inArray(schema.accounts.id, ids), eq(schema.accounts.companyId, input.companyId)));
    if (owned.length !== new Set(ids).size)
      throw new BadRequestException("Sebagian akun bukan milik perusahaan ini");
    const groupIds = [
      ...new Set(input.items.map((i) => i.groupAccountId).filter((v): v is string => Boolean(v))),
    ];
    if (groupIds.length) {
      const found = await tx
        .select({ id: schema.groupAccounts.id })
        .from(schema.groupAccounts)
        .where(inArray(schema.groupAccounts.id, groupIds));
      if (found.length !== groupIds.length) throw new BadRequestException("Akun grup tidak ditemukan");
    }
    await tx
      .delete(schema.consolidationAccountMap)
      .where(inArray(schema.consolidationAccountMap.accountId, ids));
    const rows = input.items
      .filter((i) => i.groupAccountId)
      .map((i) => ({
        accountId: i.accountId,
        companyId: input.companyId,
        groupAccountId: i.groupAccountId!,
      }));
    if (rows.length) await tx.insert(schema.consolidationAccountMap).values(rows);
    return this.mapping(tx, input.companyId);
  }

  // ---- Struktur & kurs ----

  /**
   * Entitas dalam lingkup konsolidasi `rootId`: yang dikendalikan/dipengaruhi per `dateTo` (metode, kepemilikan
   * langsung & efektif, tanggal akuisisi, perubahan kepemilikan) dan yang dilepas di dalam periode.
   */
  async structure(tx: Db, rootId: string, dateFrom: string, dateTo: string) {
    const companies = await tx
      .select({
        id: schema.companies.id,
        name: schema.companies.name,
        currency: schema.companies.currencyCode,
      })
      .from(schema.companies);
    const byId = new Map(companies.map((c) => [c.id, c]));
    const root = byId.get(rootId);
    if (!root) throw new NotFoundException("Perusahaan induk tidak ditemukan");
    const history = (
      await tx
        .select()
        .from(schema.ownershipHistory)
        .where(lte(schema.ownershipHistory.validFrom, dateTo))
        .orderBy(asc(schema.ownershipHistory.validFrom))
    ).filter((l) => l.method !== "none");
    type Link = (typeof history)[number];
    const validAt = (date: string) =>
      history.filter((l) => l.validFrom <= date && (l.validTo === null || l.validTo >= date));

    // Telusuri dari induk: anak metode penuh/proporsional ditelusuri lebih lanjut, asosiasi berhenti di situ.
    const scopeAt = (date: string) => {
      const links = validAt(date);
      const method = new Map<string, Method>([[rootId, "full"]]);
      const queue = [rootId];
      while (queue.length) {
        const parent = queue.shift()!;
        for (const link of links.filter((l) => l.parentCompanyId === parent)) {
          const m = link.method as Method;
          const current = method.get(link.childCompanyId);
          if (link.childCompanyId === rootId || (current && RANK[current] >= RANK[m])) continue;
          method.set(link.childCompanyId, m);
          if (m !== "equity") queue.push(link.childCompanyId);
        }
      }
      const scopeLinks = links.filter(
        (l) => method.has(l.parentCompanyId) && method.get(l.parentCompanyId) !== "equity",
      );
      return { method, scopeLinks };
    };
    /** Rangkaian baris kepemilikan berurutan (tanpa jeda) untuk pasangan induk–anak yang berakhir di `last`. */
    const chainOf = (last: Link) => {
      const rows = history.filter(
        (l) => l.parentCompanyId === last.parentCompanyId && l.childCompanyId === last.childCompanyId,
      );
      const chain = [last];
      for (;;) {
        const first = chain[0]!;
        const before = rows.find(
          (r) =>
            r !== first &&
            r.validFrom < first.validFrom &&
            r.validTo !== null &&
            r.validTo >= dayBefore(first.validFrom),
        );
        if (!before) break;
        chain.unshift(before);
      }
      return chain;
    };
    const describe = (
      companyId: string,
      m: Method,
      parents: Link[],
      ownership: { parentId: string; childId: string; pct: string }[],
    ) => {
      const isRoot = companyId === rootId;
      let acquisitionDate: string | null = null;
      const links = parents.map((l) => {
        const chain = chainOf(l);
        // Pengendalian (atau pengaruh signifikan) diperoleh pada baris pertama dengan metode yang berlaku sekarang;
        // biaya kepemilikan sebelumnya ikut menjadi harga perolehan (tanpa pengukuran ulang nilai wajar).
        const k = Math.max(
          0,
          chain.findIndex((r) => m === "equity" || r.method === "full" || r.method === "proportional"),
        );
        const control = chain[k]!;
        if (!acquisitionDate || control.validFrom < acquisitionDate) acquisitionDate = control.validFrom;
        const costs = chain.slice(0, k + 1).filter((r) => r.consideration !== null);
        const changes = chain.slice(k + 1).flatMap((r, i) => {
          const prev = chain[k + i]!;
          if (D(prev.pct).eq(r.pct)) return [];
          return [
            {
              date: r.validFrom,
              pctBefore: prev.pct,
              pctAfter: r.pct,
              consideration: r.consideration,
              netAssets: r.acquiredNetAssets,
              inPeriod: r.validFrom >= dateFrom,
            },
          ];
        });
        return {
          parentId: l.parentCompanyId,
          pct: l.pct,
          controlPct: changes[0]?.pctBefore ?? l.pct,
          consideration: costs.length
            ? costs.reduce((s, r) => s.plus(r.consideration!), D(0)).toFixed(2)
            : null,
          acquiredNetAssets: control.acquiredNetAssets,
          validFrom: control.validFrom,
          changes,
        };
      });
      return {
        companyId,
        name: byId.get(companyId)!.name,
        isRoot,
        method: m,
        currencyCode: byId.get(companyId)!.currency,
        directPct: isRoot ? "100" : parents.reduce((s, l) => s.plus(l.pct), D(0)).toString(),
        effectivePct: isRoot
          ? "100"
          : effectiveOwnership(ownership, rootId, companyId).toDecimalPlaces(4).toString(),
        links,
        acquisitionDate: isRoot ? null : (acquisitionDate as string | null),
        disposalDate: null as string | null,
      };
    };
    const toOwnership = (links: Link[]) =>
      links.map((l) => ({ parentId: l.parentCompanyId, childId: l.childCompanyId, pct: l.pct }));

    const end = scopeAt(dateTo);
    const described = [...end.method].map(([companyId, m]) =>
      describe(
        companyId,
        m,
        end.scopeLinks.filter((l) => l.childCompanyId === companyId),
        toOwnership(end.scopeLinks),
      ),
    );
    // Dilepas di dalam periode: relasi berakhir sebelum `dateTo` dan entitas tidak lagi dalam lingkup.
    for (const l of history) {
      if (!l.validTo || l.validTo < dateFrom || l.validTo >= dateTo) continue;
      if (described.some((d) => d.companyId === l.childCompanyId)) continue;
      const at = scopeAt(l.validTo);
      const m = at.method.get(l.childCompanyId);
      if (!m || !at.method.has(l.parentCompanyId)) continue;
      const entity = describe(
        l.childCompanyId,
        m,
        at.scopeLinks.filter((x) => x.childCompanyId === l.childCompanyId),
        toOwnership(at.scopeLinks),
      );
      entity.disposalDate = l.validTo;
      described.push(entity);
    }

    const entities = [];
    for (const e of described) {
      const rate = await this.defaultRates(
        tx,
        e.currencyCode,
        root.currency,
        dateFrom,
        e.disposalDate ?? dateTo,
      );
      entities.push({ ...e, ...rate, historicalRateManual: false });
    }
    return { root, entities };
  }

  /** Kurs penutupan (per tanggal akhir), rata-rata (selama periode), dan historis (bawaan = penutupan). */
  private async defaultRates(tx: Db, currency: string, presentation: string, from: string, to: string) {
    if (currency === presentation) return { closingRate: "1", averageRate: "1", historicalRate: "1" };
    const closing = async (code: string) => D((await this.fx.rateOn(tx, code, to)).rate);
    const average = async (code: string) => {
      if (code === BASE_CURRENCY) return D(1);
      const [row] = await tx.execute<{ avg: string | null }>(sql`
        select avg(rate)::text as avg from currency_rates
        where currency_code = ${code} and rate_date between ${from} and ${to}`);
      return row?.avg ? D(row.avg) : closing(code);
    };
    try {
      const closingRate = (await closing(currency)).div(await closing(presentation));
      const averageRate = (await average(currency)).div(await average(presentation));
      const c = closingRate.toDecimalPlaces(10).toString();
      return { closingRate: c, averageRate: averageRate.toDecimalPlaces(10).toString(), historicalRate: c };
    } catch (e) {
      throw new BadRequestException(
        `Kurs ${currency} terhadap ${presentation} belum tersedia (${(e as Error).message}); isi Kurs Harian atau kurs manual`,
      );
    }
  }

  // ---- Proses konsolidasi ----

  async list(tx: Db) {
    return tx
      .select({ run: schema.consolidationRuns, rootName: schema.companies.name })
      .from(schema.consolidationRuns)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.consolidationRuns.rootCompanyId))
      .orderBy(desc(schema.consolidationRuns.dateTo), desc(schema.consolidationRuns.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.run, rootName: r.rootName })));
  }

  async create(tx: Db, input: z.infer<typeof consolidationRunSchema>) {
    this.assertCompany(input.rootCompanyId);
    const [root] = await tx
      .select({
        name: schema.companies.name,
        currency: schema.companies.currencyCode,
        month: schema.companies.fiscalYearStartMonth,
      })
      .from(schema.companies)
      .where(eq(schema.companies.id, input.rootCompanyId));
    if (!root) throw new NotFoundException("Perusahaan induk tidak ditemukan");
    const [y, m] = input.dateTo.split("-").map(Number) as [number, number];
    const fyYear = m >= root.month ? y : y - 1;
    const dateFrom = input.dateFrom ?? `${fyYear}-${String(root.month).padStart(2, "0")}-01`;
    if (dateFrom > input.dateTo) throw new BadRequestException("Tanggal awal setelah tanggal akhir");
    const [run] = await tx
      .insert(schema.consolidationRuns)
      .values({
        name: input.name || `Konsolidasi ${root.name} ${input.dateTo}`,
        rootCompanyId: input.rootCompanyId,
        dateFrom,
        dateTo: input.dateTo,
        currencyCode: root.currency,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.consolidationRuns.id });
    await this.compute(tx, run!.id, input.rates);
    return this.get(tx, run!.id);
  }

  /** Hitung ulang saldo, jurnal otomatis, dan saldo awal (draft); jurnal manual dipertahankan. */
  async compute(tx: Db, runId: string, rates: Rates = []) {
    const run = await this.find(tx, runId);
    if (run.state === "final") throw new BadRequestException("Konsolidasi final tidak bisa dihitung ulang");
    const previous = await tx
      .select()
      .from(schema.consolidationEntities)
      .where(eq(schema.consolidationEntities.runId, runId));
    const { entities, result } = await this.calculate(tx, {
      rootId: run.rootCompanyId,
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
      currency: run.currencyCode,
      rates,
      previous,
      withOpening: true,
    });
    const opening = await this.opening(tx, run);
    if (opening.warning) result.warnings.push(opening.warning);

    await tx.delete(schema.consolidationEntities).where(eq(schema.consolidationEntities.runId, runId));
    await tx.delete(schema.consolidationBalances).where(eq(schema.consolidationBalances.runId, runId));
    await tx
      .delete(schema.consolidationOpeningBalances)
      .where(eq(schema.consolidationOpeningBalances.runId, runId));
    await tx
      .delete(schema.consolidationEntries)
      .where(
        and(
          eq(schema.consolidationEntries.runId, runId),
          sql`${schema.consolidationEntries.kind} <> 'manual'`,
        ),
      );
    await tx.insert(schema.consolidationEntities).values(
      entities.map((e) => ({
        runId,
        companyId: e.companyId,
        method: e.method,
        directPct: e.directPct,
        effectivePct: e.effectivePct,
        currencyCode: e.currencyCode,
        closingRate: e.closingRate,
        averageRate: e.averageRate,
        historicalRate: e.historicalRate,
        historicalRateManual: e.historicalRateManual,
        acquisitionDate: e.acquisitionDate,
        disposalDate: e.disposalDate,
      })),
    );
    if (result.balances.length)
      await tx.insert(schema.consolidationBalances).values(result.balances.map((b) => ({ ...b, runId })));
    if (opening.position.length)
      await tx
        .insert(schema.consolidationOpeningBalances)
        .values(opening.position.map((p) => ({ ...p, runId })));
    for (const entry of result.entries) {
      const [row] = await tx
        .insert(schema.consolidationEntries)
        .values({ runId, kind: entry.kind, companyId: entry.companyId, description: entry.description })
        .returning({ id: schema.consolidationEntries.id });
      await tx
        .insert(schema.consolidationEntryLines)
        .values(entry.lines.map((l) => ({ ...l, entryId: row!.id })));
    }
    await tx
      .update(schema.consolidationRuns)
      .set({
        warnings: result.warnings,
        openingSource: opening.source,
        openingRunId: opening.runId,
        computedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.consolidationRuns.id, runId));
    return this.get(tx, runId);
  }

  /** Susun masukan mesin konsolidasi dari buku besar, persediaan & kepemilikan, lalu hitung (tanpa menyimpan). */
  private async calculate(
    tx: Db,
    p: {
      rootId: string;
      dateFrom: string;
      dateTo: string;
      currency: string;
      rates: Rates;
      previous: (typeof schema.consolidationEntities.$inferSelect)[];
      withOpening: boolean;
    },
  ) {
    const { entities } = await this.structure(tx, p.rootId, p.dateFrom, p.dateTo);
    for (const e of entities) this.assertCompany(e.companyId);
    // Kurs manual: dari permintaan ini, atau yang tersimpan pada perhitungan sebelumnya.
    for (const e of entities) {
      if (e.currencyCode === p.currency) continue;
      const prev = p.previous.find((x) => x.companyId === e.companyId);
      const override = p.rates.find((r) => r.companyId === e.companyId);
      e.closingRate = override?.closingRate ?? prev?.closingRate ?? e.closingRate;
      e.averageRate = override?.averageRate ?? prev?.averageRate ?? e.averageRate;
      if (override?.historicalByDate) e.historicalRateManual = false;
      else if (override?.historicalRate) {
        e.historicalRate = override.historicalRate;
        e.historicalRateManual = true;
      } else if (prev?.historicalRateManual) {
        e.historicalRate = prev.historicalRate;
        e.historicalRateManual = true;
      }
    }
    const accounts = await this.groupAccounts(tx);
    const types = new Map(accounts.map((a) => [a.id, a.accountType]));
    const isEquity = (id: string) => EQUITY_TYPES.includes(types.get(id) ?? "");
    const disposedCutoffs = new Map(
      entities.filter((e) => e.disposalDate).map((e) => [e.companyId, e.disposalDate!]),
    );

    const warnings: string[] = [];
    const unmapped: { companyName: string; code: string; name: string }[] = [];
    const inputs: EntityInput[] = [];
    const windows = new Map<string, { from: string; to: string }>();
    for (const e of entities) {
      const from = e.acquisitionDate && e.acquisitionDate > p.dateFrom ? e.acquisitionDate : p.dateFrom;
      const to = e.disposalDate ?? p.dateTo;
      windows.set(e.companyId, { from, to });
      const translation: Translation | null =
        e.currencyCode !== p.currency && !e.historicalRateManual
          ? {
              currency: e.currencyCode,
              presentation: p.currency,
              since: e.acquisitionDate,
              fallback: e.historicalRate,
            }
          : null;
      const dated = translation !== null;
      const data = await this.loadEntity(tx, {
        companyId: e.companyId,
        companyName: e.name,
        runFrom: p.dateFrom,
        from,
        to,
        profitLossOnly: Boolean(e.disposalDate),
        translation,
        icCutoffs: disposedCutoffs,
      });
      unmapped.push(...data.unmapped);
      if (!data.branchClearing.isZero())
        warnings.push(
          `${e.name}: saldo rekening antar kantor (RK pusat–cabang) tidak nol (${data.branchClearing.toFixed(2)}) — periksa laporan RK Pusat–Cabang`,
        );

      // Laba rugi sejak akuisisi sebelum periode: metode ekuitas & entitas yang dilepas.
      let prior: { local: string; translated: string | null } = { local: "0", translated: null };
      if ((e.method === "equity" || e.disposalDate) && e.acquisitionDate && e.acquisitionDate < p.dateFrom)
        prior = await this.profitBetween(
          tx,
          e.companyId,
          e.acquisitionDate,
          dayBefore(p.dateFrom),
          translation,
        );

      // Perubahan kepemilikan: aset neto pada tanggal perubahan & laba periode sebelum tanggal itu.
      const links: OwnershipInput[] = [];
      for (const l of e.links) {
        const changes = [];
        for (const c of l.changes) {
          const before =
            c.inPeriod && c.date > from
              ? await this.profitBetween(tx, e.companyId, from, dayBefore(c.date), null)
              : null;
          const netAssets =
            c.netAssets ?? (await this.bookNetAssets(tx, e.companyId, c.date, e.currencyCode, p.currency));
          changes.push({
            ...c,
            netAssets,
            periodProfitBefore: before ? D(before.local).negated().times(e.averageRate).toFixed(2) : "0",
          });
        }
        links.push({
          parentId: l.parentId,
          pct: l.pct,
          consideration: l.consideration,
          acquiredNetAssets: l.acquiredNetAssets,
          changes,
        });
      }
      // Laba per segmen kepemilikan bila kepemilikan berubah di dalam periode.
      let profitSegments: EntityInput["profitSegments"];
      const boundaries = [
        ...new Set(
          e.links.flatMap((l) => l.changes.filter((c) => c.inPeriod && c.date > from).map((c) => c.date)),
        ),
      ].sort();
      if (boundaries.length && e.method === "full") {
        const pNow = e.links.reduce((s, l) => s.plus(l.pct), D(0));
        const starts = [from, ...boundaries];
        profitSegments = [];
        for (let i = 0; i < starts.length; i++) {
          const segFrom = starts[i]!;
          const segTo = i + 1 < starts.length ? dayBefore(starts[i + 1]!) : to;
          const direct = e.links.reduce((s, l) => {
            const last = [...l.changes].reverse().find((c) => c.date <= segFrom);
            return s.plus(last ? last.pctAfter : l.controlPct);
          }, D(0));
          const profit = await this.profitBetween(tx, e.companyId, segFrom, segTo, null);
          profitSegments.push({
            effectivePct: pNow.isZero() ? "0" : D(e.effectivePct).times(direct).div(pNow).toString(),
            profit: profit.local,
          });
        }
      }

      inputs.push({
        companyId: e.companyId,
        name: e.name,
        isRoot: e.isRoot,
        method: e.method,
        effectivePct: e.effectivePct,
        closingRate: e.closingRate,
        averageRate: e.averageRate,
        historicalRate: e.historicalRate,
        links,
        balances: data.balances.map((b) => ({
          groupAccountId: b.groupAccountId,
          amount: b.amount,
          ...(dated && isEquity(b.groupAccountId) ? { translated: b.translated } : {}),
        })),
        // Entitas yang dilepas tidak membawa posisi keuangan, termasuk saldo laba sebelum periode.
        priorUnallocated: e.disposalDate ? "0" : data.prior.local,
        ...(data.prior.translated !== null && !e.disposalDate
          ? { priorTranslated: data.prior.translated }
          : {}),
        postAcquisitionPrior: prior.local,
        ...(prior.translated !== null ? { postAcquisitionPriorTranslated: prior.translated } : {}),
        intercompany: data.intercompany.map((i) => ({
          groupAccountId: i.groupAccountId,
          counterpartId: i.counterpartId,
          amount: i.amount,
          ...(dated && isEquity(i.groupAccountId) ? { translated: i.translated } : {}),
        })),
        ...(profitSegments ? { profitSegments } : {}),
        ...(e.disposalDate ? { disposal: { date: e.disposalDate } } : {}),
      });
    }
    if (unmapped.length)
      throw new BadRequestException({
        message: "Ada akun bersaldo yang belum dipetakan ke bagan akun grup",
        errors: unmapped.map((u) => ({ path: u.companyName, message: `${u.code} ${u.name}` })),
      });

    // Persediaan antar perusahaan: nilai pembelian dalam periode & laba belum terealisasi akhir/awal.
    const options: ConsolidationOptions = { icGoods: [], unrealizedProfits: [] };
    const trading = entities.filter((e) => e.method !== "equity" && !e.disposalDate);
    const openingDate = dayBefore(p.dateFrom);
    for (const buyer of trading) {
      for (const seller of trading) {
        if (buyer.companyId === seller.companyId) continue;
        const w = windows.get(buyer.companyId)!;
        const goods = await this.icGoodsValue(tx, buyer.companyId, seller.companyId, w.from, w.to);
        if (!goods.isZero())
          options.icGoods!.push({
            sellerId: seller.companyId,
            buyerId: buyer.companyId,
            amount: goods.times(buyer.averageRate).toFixed(2),
          });
        const closing = await this.unrealizedProfit(tx, buyer, seller, p.dateTo);
        const bothBefore = [buyer, seller].every(
          (x) => !x.acquisitionDate || x.acquisitionDate <= openingDate,
        );
        const opening =
          p.withOpening && bothBefore ? await this.unrealizedProfit(tx, buyer, seller, openingDate) : D(0);
        if (!closing.isZero() || !opening.isZero())
          options.unrealizedProfits!.push({
            sellerId: seller.companyId,
            buyerId: buyer.companyId,
            closing: closing.toFixed(2),
            opening: opening.toFixed(2),
          });
      }
    }

    options.assetProfits = await this.assetProfits(tx, trading, p.dateFrom, p.dateTo, warnings);

    let result: ReturnType<typeof consolidate>;
    try {
      result = consolidate(accounts, inputs, options);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    result.warnings.unshift(...warnings);
    return { entities, result };
  }

  /**
   * Saldo awal: posisi akhir proses final periode sebelumnya (per hari sebelum `dateFrom`), atau dihitung ulang
   * per tanggal itu tanpa jurnal manual.
   */
  private async opening(tx: Db, run: typeof schema.consolidationRuns.$inferSelect) {
    const date = dayBefore(run.dateFrom);
    const [prev] = await tx
      .select({ id: schema.consolidationRuns.id })
      .from(schema.consolidationRuns)
      .where(
        and(
          eq(schema.consolidationRuns.rootCompanyId, run.rootCompanyId),
          eq(schema.consolidationRuns.state, "final"),
          eq(schema.consolidationRuns.dateTo, date),
        ),
      )
      .orderBy(desc(schema.consolidationRuns.finalizedAt))
      .limit(1);
    const accounts = await this.groupAccounts(tx);
    if (prev) {
      const ws = await this.worksheet(tx, prev.id);
      return {
        source: "previous_run" as const,
        runId: prev.id,
        position: closingPosition(accounts, ws.rows),
        warning: null,
      };
    }
    try {
      const { result } = await this.calculate(tx, {
        rootId: run.rootCompanyId,
        dateFrom: date,
        dateTo: date,
        currency: run.currencyCode,
        rates: [],
        previous: [],
        withOpening: false,
      });
      const rows = worksheet(accounts, result.balances, result.entries);
      return {
        source: "computed" as const,
        runId: null,
        position: closingPosition(accounts, rows),
        warning: null,
      };
    } catch (err) {
      const response = err instanceof BadRequestException ? err.getResponse() : null;
      const message =
        response && typeof response === "object" && "message" in response
          ? String((response as { message: unknown }).message)
          : (err as Error).message;
      return {
        source: null,
        runId: null,
        position: [] as { groupAccountId: string; amount: string }[],
        warning: `Saldo awal per ${date} tidak dapat dihitung (${message}) — laporan perubahan ekuitas & arus kas tidak tersedia`,
      };
    }
  }

  /**
   * Saldo satu perusahaan per akun grup: akun neraca kumulatif s.d. `to` (tanpa jurnal tutup buku dalam periode),
   * akun laba rugi dalam jendela `from`–`to`, laba/rugi sebelum `from` yang belum ditutup, dan bagian saldo antar
   * perusahaan. Bila `translation` diisi, setiap baris juga dijabarkan dengan kurs pada tanggal transaksinya.
   */
  private async loadEntity(
    tx: Db,
    w: {
      companyId: string;
      companyName: string;
      runFrom: string;
      from: string;
      to: string;
      profitLossOnly: boolean;
      translation: Translation | null;
      icCutoffs: Map<string, string>;
    },
  ) {
    const pl = list(PROFIT_LOSS_TYPES);
    const rate = w.translation ? datedRate(w.translation, sql`m.date`) : sql`1::numeric`;
    const window = sql`((a.account_type not in (${pl}) and ${!w.profitLossOnly}
          and not (m.closing_year is not null and m.date >= ${w.runFrom}))
        or (a.account_type in (${pl}) and m.date >= ${w.from} and m.closing_year is null))`;
    const rows = await tx.execute<{
      code: string;
      name: string;
      group_account_id: string | null;
      amount: string;
      translated: string;
      clearing: boolean;
    }>(sql`
      select a.code, a.name, a.branch_clearing as clearing, map.group_account_id,
             sum(l.balance)::text as amount, sum(l.balance * ${rate})::text as translated
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      left join consolidation_account_map map on map.account_id = a.id
      where m.state = 'posted' and l.company_id = ${w.companyId} and m.date <= ${w.to} and ${window}
      group by a.id, a.code, a.name, a.branch_clearing, map.group_account_id
      having sum(l.balance) <> 0`);
    const [priorRow] = await tx.execute<{ amount: string | null; translated: string | null }>(sql`
      select sum(l.balance)::text as amount, sum(l.balance * ${rate})::text as translated
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where m.state = 'posted' and l.company_id = ${w.companyId} and m.date < ${w.from}
        and a.account_type in (${pl})`);
    const cutoffs = [...w.icCutoffs];
    const cutoff = cutoffs.length
      ? sql`and m.date <= (case l.ic_company_id ${sql.join(
          cutoffs.map(([id, d]) => sql`when ${id}::uuid then ${d}::date`),
          sql` `,
        )} else ${w.to}::date end)`
      : sql``;
    const icRows = await tx.execute<{
      group_account_id: string;
      ic_company_id: string;
      amount: string;
      translated: string;
    }>(sql`
      select map.group_account_id, l.ic_company_id, sum(l.balance)::text as amount,
             sum(l.balance * ${rate})::text as translated
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      join consolidation_account_map map on map.account_id = a.id
      where m.state = 'posted' and l.company_id = ${w.companyId} and m.date <= ${w.to}
        and l.ic_company_id is not null and l.display_type <> 'tax'
        -- Faktur penjualan aset ke perusahaan grup: hanya piutangnya yang dieliminasi di sini; labanya lewat
        -- eliminasi laba belum terealisasi aset tetap.
        and not (a.account_type <> 'asset_receivable'
                 and m.id in (select x.disposal_invoice_id from assets x where x.disposal_invoice_id is not null))
        and a.account_type in (${list(IC_TYPES)}) and ${window} ${cutoff}
      group by map.group_account_id, l.ic_company_id
      having sum(l.balance) <> 0`);
    // Saldo per akun grup (beberapa akun lokal bisa dipetakan ke akun grup yang sama).
    const balances = new Map<string, { groupAccountId: string; amount: Decimal; translated: Decimal }>();
    for (const r of rows) {
      if (!r.group_account_id) continue;
      const b = balances.get(r.group_account_id) ?? {
        groupAccountId: r.group_account_id,
        amount: D(0),
        translated: D(0),
      };
      b.amount = b.amount.plus(r.amount);
      b.translated = b.translated.plus(r.translated);
      balances.set(r.group_account_id, b);
    }
    return {
      balances: [...balances.values()].map((b) => ({
        groupAccountId: b.groupAccountId,
        amount: b.amount.toFixed(2),
        translated: b.translated.toFixed(2),
      })),
      unmapped: rows
        .filter((r) => !r.group_account_id)
        .map((r) => ({ companyName: w.companyName, code: r.code, name: r.name })),
      branchClearing: rows.filter((r) => r.clearing).reduce((s, r) => s.plus(r.amount), D(0)),
      prior: {
        local: priorRow?.amount ?? "0",
        translated: w.translation ? D(priorRow?.translated ?? 0).toFixed(2) : null,
      },
      intercompany: icRows.map((r) => ({
        groupAccountId: r.group_account_id,
        counterpartId: r.ic_company_id,
        amount: r.amount,
        translated: D(r.translated).toFixed(2),
      })),
    };
  }

  /** Laba rugi (debit positif) antara dua tanggal tanpa jurnal tutup buku; opsional dijabarkan per tanggal. */
  private async profitBetween(
    tx: Db,
    companyId: string,
    from: string,
    to: string,
    translation: Translation | null,
  ) {
    const rate = translation ? datedRate(translation, sql`m.date`) : sql`1::numeric`;
    const [row] = await tx.execute<{ amount: string | null; translated: string | null }>(sql`
      select sum(l.balance)::text as amount, sum(l.balance * ${rate})::text as translated
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where m.state = 'posted' and l.company_id = ${companyId} and m.closing_year is null
        and m.date >= ${from} and m.date <= ${to} and a.account_type in (${list(PROFIT_LOSS_TYPES)})`);
    return {
      local: row?.amount ?? "0",
      translated: translation ? D(row?.translated ?? 0).toFixed(2) : null,
    };
  }

  /** Nilai buku aset neto (ekuitas + laba rugi) sebelum `date`, dijabarkan dengan kurs tanggal itu. */
  private async bookNetAssets(
    tx: Db,
    companyId: string,
    date: string,
    currency: string,
    presentation: string,
  ) {
    const [row] = await tx.execute<{ amount: string | null }>(sql`
      select sum(l.balance)::text as amount
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where m.state = 'posted' and l.company_id = ${companyId} and m.date < ${date}
        and a.account_type in (${list([...EQUITY_TYPES, ...PROFIT_LOSS_TYPES])})`);
    const local = D(row?.amount).negated();
    if (currency === presentation) return local.toFixed(2);
    const rate = D((await this.fx.rateOn(tx, currency, date)).rate).div(
      (await this.fx.rateOn(tx, presentation, date)).rate,
    );
    return local.times(rate).toFixed(2);
  }

  /**
   * Aset tetap yang dijual antar perusahaan dalam lingkup: laba penjual dan sisanya yang belum terealisasi per
   * akhir & awal periode = laba × (1 − akumulasi penyusutan pembeli ÷ dasar penyusutan), nol bila pembeli sudah
   * melepas asetnya.
   */
  private async assetProfits(
    tx: Db,
    trading: { companyId: string; closingRate: string }[],
    dateFrom: string,
    dateTo: string,
    warnings: string[],
  ) {
    const ids = trading.map((e) => e.companyId);
    if (ids.length < 2) return [];
    const rows = await tx.execute<{
      id: string;
      name: string;
      buyer_id: string;
      cost: string;
      salvage: string;
      buyer_disposal: string | null;
      seller_id: string;
      gain: string;
      sold_on: string;
      g_gain: string | null;
      g_asset: string | null;
      g_expense: string | null;
      decimals: number;
    }>(sql`
      select b.id, b.name, b.company_id as buyer_id, cur.decimals, b.cost::text as cost, b.salvage_value::text as salvage,
             b.disposal_date as buyer_disposal, s.company_id as seller_id, s.disposal_gain::text as gain,
             s.disposal_date as sold_on, ga.group_account_id as g_gain, gb.group_account_id as g_asset,
             ge.group_account_id as g_expense
      from assets b
      join assets s on s.id = b.source_asset_id
      join companies bc on bc.id = b.company_id
      join currencies cur on cur.code = bc.currency_code
      join accounting_settings ss on ss.company_id = s.company_id
      left join consolidation_account_map ga on ga.account_id = ss.asset_disposal_account_id
      left join consolidation_account_map gb on gb.account_id = b.asset_account_id
      left join consolidation_account_map ge on ge.account_id = b.expense_account_id
      where b.company_id in (${list(ids)}) and s.company_id in (${list(ids)}) and b.company_id <> s.company_id
        and s.disposal_gain is not null and s.disposal_date <= ${dateTo}`);
    const remaining = async (r: (typeof rows)[number], date: string) => {
      if (r.sold_on > date) return D(0);
      if (r.buyer_disposal && r.buyer_disposal <= date) return D(0);
      const [row] = await tx.execute<{ amount: string | null }>(sql`
        select sum(amount)::text as amount from asset_depreciation_lines
        where asset_id = ${r.id} and move_id is not null and date <= ${date}`);
      const base = D(r.cost).minus(r.salvage);
      if (base.isZero()) return D(0);
      // Kelebihan penyusutan pembeli atas laba itu, dibulatkan seperti jadwal penyusutannya.
      const realized = Decimal.min(D(r.gain), D(r.gain).times(D(row?.amount)).div(base)).toDecimalPlaces(
        Number(r.decimals),
        Decimal.ROUND_HALF_UP,
      );
      return D(r.gain).minus(realized);
    };
    const result: NonNullable<ConsolidationOptions["assetProfits"]> = [];
    const openingDate = dayBefore(dateFrom);
    for (const r of rows) {
      if (!r.g_gain || !r.g_asset || !r.g_expense) {
        warnings.push(
          `Aset ${r.name}: akun belum dipetakan ke bagan akun grup — laba belum terealisasi tidak dieliminasi`,
        );
        continue;
      }
      const rate = trading.find((e) => e.companyId === r.seller_id)!.closingRate;
      const inPeriod = r.sold_on >= dateFrom;
      result.push({
        sellerId: r.seller_id,
        buyerId: r.buyer_id,
        name: r.name,
        gain: D(r.gain).times(rate).toFixed(2),
        closing: (await remaining(r, dateTo)).times(rate).toFixed(2),
        opening: inPeriod ? "0" : (await remaining(r, openingDate)).times(rate).toFixed(2),
        inPeriod,
        gainAccountId: r.g_gain,
        assetAccountId: r.g_asset,
        expenseAccountId: r.g_expense,
      });
    }
    return result;
  }

  /** Nilai lapisan persediaan yang diterima `buyerId` dari mitra antar perusahaan `sellerId` dalam jendela. */
  private async icGoodsValue(tx: Db, buyerId: string, sellerId: string, from: string, to: string) {
    const [row] = await tx.execute<{ value: string | null }>(sql`
      select sum(v.value)::text as value
      from stock_valuation_layers v
      join stock_moves sm on sm.id = v.stock_move_id
      join stock_pickings pk on pk.id = sm.picking_id
      join partners pa on pa.id = pk.partner_id
      where v.company_id = ${buyerId} and v.quantity > 0 and pa.ic_company_id = ${sellerId}
        and v.created_at >= ${from}::date and v.created_at < ${to}::date + 1`);
    return D(row?.value);
  }

  /**
   * Laba belum terealisasi atas persediaan `buyer` per `date` yang berasal dari `seller` (mata uang penyajian).
   * Stok akhir dialokasikan ke penerimaan terakhir (FIFO); biaya penjual = rata-rata HPP pengirimannya ke pembeli.
   */
  private async unrealizedProfit(
    tx: Db,
    buyer: { companyId: string; closingRate: string },
    seller: { companyId: string; closingRate: string },
    date: string,
  ) {
    const layers = await tx.execute<{
      product_id: string;
      quantity: string;
      unit_cost: string;
      source: string | null;
    }>(sql`
      select v.product_id, v.quantity::text as quantity, v.unit_cost::text as unit_cost,
             pa.ic_company_id as source
      from stock_valuation_layers v
      left join stock_moves sm on sm.id = v.stock_move_id
      left join stock_pickings pk on pk.id = sm.picking_id
      left join partners pa on pa.id = pk.partner_id
      where v.company_id = ${buyer.companyId} and v.created_at < ${date}::date + 1
      order by v.product_id, v.created_at desc, v.id desc`);
    if (!layers.some((l) => l.source === seller.companyId && D(l.quantity).gt(0))) return D(0);
    const costs = await tx.execute<{ product_id: string; value: string; quantity: string }>(sql`
      select v.product_id, sum(-v.value)::text as value, sum(-v.quantity)::text as quantity
      from stock_valuation_layers v
      join stock_moves sm on sm.id = v.stock_move_id
      join stock_pickings pk on pk.id = sm.picking_id
      join partners pa on pa.id = pk.partner_id
      where v.company_id = ${seller.companyId} and v.quantity < 0 and pa.ic_company_id = ${buyer.companyId}
        and v.created_at < ${date}::date + 1
      group by v.product_id`);
    const sellerCost = new Map(
      costs.filter((c) => D(c.quantity).gt(0)).map((c) => [c.product_id, D(c.value).div(c.quantity)]),
    );
    type Layer = (typeof layers)[number];
    const products = new Map<string, Layer[]>();
    for (const l of layers) products.set(l.product_id, [...(products.get(l.product_id) ?? []), l]);
    let total = D(0);
    for (const [productId, productLayers] of products) {
      const cost = sellerCost.get(productId);
      if (!cost) continue;
      let remaining = productLayers.reduce((s, l) => s.plus(l.quantity), D(0));
      for (const l of productLayers) {
        if (remaining.lte(0)) break;
        if (D(l.quantity).lte(0)) continue;
        const take = Decimal.min(remaining, l.quantity);
        remaining = remaining.minus(take);
        if (l.source !== seller.companyId) continue;
        total = total.plus(
          take.times(l.unit_cost).times(buyer.closingRate).minus(take.times(cost).times(seller.closingRate)),
        );
      }
    }
    return total.toDecimalPlaces(2);
  }

  private async groupAccounts(tx: Db): Promise<GroupAccountInfo[]> {
    return tx
      .select({
        id: schema.groupAccounts.id,
        code: schema.groupAccounts.code,
        name: schema.groupAccounts.name,
        accountType: schema.groupAccounts.accountType,
        role: schema.groupAccounts.role,
      })
      .from(schema.groupAccounts)
      .orderBy(asc(schema.groupAccounts.code));
  }

  async get(tx: Db, runId: string) {
    const run = await this.find(tx, runId);
    const entities = await tx
      .select({
        entity: schema.consolidationEntities,
        name: schema.companies.name,
        code: schema.companies.code,
      })
      .from(schema.consolidationEntities)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.consolidationEntities.companyId))
      .where(eq(schema.consolidationEntities.runId, runId))
      .orderBy(asc(schema.companies.code));
    const entries = await this.entries(tx, runId);
    return {
      ...run,
      entities: entities.map((e) => ({ ...e.entity, name: e.name, code: e.code })),
      entries,
    };
  }

  private async entries(tx: Db, runId: string) {
    const entries = await tx
      .select()
      .from(schema.consolidationEntries)
      .where(eq(schema.consolidationEntries.runId, runId))
      .orderBy(asc(schema.consolidationEntries.createdAt));
    const lines = entries.length
      ? await tx
          .select({
            line: schema.consolidationEntryLines,
            code: schema.groupAccounts.code,
            name: schema.groupAccounts.name,
          })
          .from(schema.consolidationEntryLines)
          .innerJoin(
            schema.groupAccounts,
            eq(schema.groupAccounts.id, schema.consolidationEntryLines.groupAccountId),
          )
          .where(
            inArray(
              schema.consolidationEntryLines.entryId,
              entries.map((e) => e.id),
            ),
          )
      : [];
    return entries.map((e) => ({
      ...e,
      lines: lines
        .filter((l) => l.line.entryId === e.id)
        .map((l) => ({ ...l.line, code: l.code, name: l.name })),
    }));
  }

  async worksheet(tx: Db, runId: string) {
    const run = await this.get(tx, runId);
    const balances = await tx
      .select()
      .from(schema.consolidationBalances)
      .where(eq(schema.consolidationBalances.runId, runId));
    const rows = worksheet(await this.groupAccounts(tx), balances, run.entries);
    return {
      run: {
        id: run.id,
        name: run.name,
        state: run.state,
        dateFrom: run.dateFrom,
        dateTo: run.dateTo,
        currencyCode: run.currencyCode,
      },
      columns: run.entities
        .filter((e) => e.method !== "equity")
        .map((e) => ({ companyId: e.companyId, name: e.name, method: e.method })),
      rows,
    };
  }

  async report(tx: Db, runId: string) {
    const ws = await this.worksheet(tx, runId);
    const [run] = await tx
      .select({ openingSource: schema.consolidationRuns.openingSource })
      .from(schema.consolidationRuns)
      .where(eq(schema.consolidationRuns.id, runId));
    const opening = run?.openingSource
      ? await tx
          .select({
            groupAccountId: schema.consolidationOpeningBalances.groupAccountId,
            amount: schema.consolidationOpeningBalances.amount,
          })
          .from(schema.consolidationOpeningBalances)
          .where(eq(schema.consolidationOpeningBalances.runId, runId))
      : null;
    const accounts = await this.groupAccounts(tx);
    return {
      run: { ...ws.run, openingSource: run?.openingSource ?? null },
      ...consolidatedStatements(ws.rows),
      equityChanges: opening ? equityChanges(accounts, opening, ws.rows) : null,
      cashFlow: opening ? consolidatedCashFlow(accounts, opening, ws.rows) : null,
    };
  }

  /** Rekonsiliasi saldo antar perusahaan (dalam mata uang penyajian, kurs proses). */
  async icReconciliation(tx: Db, runId: string) {
    const run = await this.get(tx, runId);
    const aggregated = run.entities.filter((e) => e.method !== "equity");
    const accounts = new Map((await this.groupAccounts(tx)).map((a) => [a.id, a]));
    const pl = new Set(PROFIT_LOSS_TYPES);
    const cutoffs = new Map(
      aggregated.filter((e) => e.disposalDate).map((e) => [e.companyId, e.disposalDate!]),
    );
    const lines: { companyId: string; counterpartId: string; result: boolean; amount: Decimal }[] = [];
    for (const e of aggregated) {
      const from = e.acquisitionDate && e.acquisitionDate > run.dateFrom ? e.acquisitionDate : run.dateFrom;
      const data = await this.loadEntity(tx, {
        companyId: e.companyId,
        companyName: e.name,
        runFrom: run.dateFrom,
        from,
        to: e.disposalDate ?? run.dateTo,
        profitLossOnly: Boolean(e.disposalDate),
        translation: null,
        icCutoffs: cutoffs,
      });
      for (const i of data.intercompany) {
        const type = accounts.get(i.groupAccountId)!.accountType;
        const result = pl.has(type) || EQUITY_TYPES.includes(type);
        lines.push({
          companyId: e.companyId,
          counterpartId: i.counterpartId,
          result,
          amount: D(i.amount).times(
            pl.has(type) ? e.averageRate : EQUITY_TYPES.includes(type) ? e.historicalRate : e.closingRate,
          ),
        });
      }
    }
    const side = (result: boolean) =>
      intercompanyReconciliation(
        aggregated.map((e) => ({
          companyId: e.companyId,
          name: e.name,
          intercompany: lines.filter((l) => l.companyId === e.companyId && l.result === result),
        })),
      );
    return { balances: side(false), transactions: side(true) };
  }

  async addManualEntry(tx: Db, runId: string, input: z.infer<typeof consolidationManualEntrySchema>) {
    const run = await this.get(tx, runId);
    if (run.state === "final") throw new BadRequestException("Konsolidasi final tidak bisa diubah");
    const lines = input.lines.map((l) => ({
      groupAccountId: l.groupAccountId,
      companyId: l.companyId ?? null,
      amount: D(l.debit).minus(l.credit),
    }));
    const total = lines.reduce((s, l) => s.plus(l.amount), D(0));
    if (!total.isZero()) throw new BadRequestException(`Jurnal tidak seimbang (selisih ${total.toFixed(2)})`);
    if (lines.every((l) => l.amount.isZero())) throw new BadRequestException("Jurnal kosong");
    const companyIds = new Set(run.entities.map((e) => e.companyId));
    if (lines.some((l) => l.companyId && !companyIds.has(l.companyId)))
      throw new BadRequestException("Perusahaan di luar lingkup konsolidasi");
    const groupIds = [...new Set(lines.map((l) => l.groupAccountId))];
    const found = await tx
      .select({ id: schema.groupAccounts.id })
      .from(schema.groupAccounts)
      .where(inArray(schema.groupAccounts.id, groupIds));
    if (found.length !== groupIds.length) throw new BadRequestException("Akun grup tidak ditemukan");
    const [entry] = await tx
      .insert(schema.consolidationEntries)
      .values({ runId, kind: "manual", description: input.description, createdBy: currentContext().userId })
      .returning({ id: schema.consolidationEntries.id });
    await tx.insert(schema.consolidationEntryLines).values(
      lines
        .filter((l) => !l.amount.isZero())
        .map((l) => ({
          entryId: entry!.id,
          groupAccountId: l.groupAccountId,
          companyId: l.companyId,
          amount: l.amount.toFixed(2),
        })),
    );
    return this.get(tx, runId);
  }

  async deleteManualEntry(tx: Db, runId: string, entryId: string) {
    const run = await this.find(tx, runId);
    if (run.state === "final") throw new BadRequestException("Konsolidasi final tidak bisa diubah");
    const [entry] = await tx
      .select({ kind: schema.consolidationEntries.kind })
      .from(schema.consolidationEntries)
      .where(and(eq(schema.consolidationEntries.id, entryId), eq(schema.consolidationEntries.runId, runId)));
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.kind !== "manual") throw new BadRequestException("Jurnal otomatis diatur lewat Hitung ulang");
    await tx.delete(schema.consolidationEntries).where(eq(schema.consolidationEntries.id, entryId));
  }

  async finalize(tx: Db, runId: string) {
    const run = await this.find(tx, runId);
    if (run.state === "final") return this.get(tx, runId);
    const report = await this.report(tx, runId);
    if (!D(report.balanceSheet.difference).isZero())
      throw new BadRequestException(
        `Kertas kerja tidak seimbang (selisih ${report.balanceSheet.difference})`,
      );
    await tx
      .update(schema.consolidationRuns)
      .set({ state: "final", finalizedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.consolidationRuns.id, runId));
    return this.get(tx, runId);
  }

  async remove(tx: Db, runId: string) {
    const run = await this.find(tx, runId);
    if (run.state === "final") throw new BadRequestException("Konsolidasi final tidak bisa dihapus");
    await tx.delete(schema.consolidationRuns).where(eq(schema.consolidationRuns.id, runId));
  }

  private async find(tx: Db, runId: string) {
    const [run] = await tx
      .select()
      .from(schema.consolidationRuns)
      .where(eq(schema.consolidationRuns.id, runId));
    if (!run) throw new NotFoundException("Proses konsolidasi tidak ditemukan");
    this.assertCompany(run.rootCompanyId);
    return run;
  }

  /** Konsolidasi menyentuh banyak perusahaan: user harus punya akses ke semuanya. */
  private assertCompany(companyId: string) {
    if (!currentContext().companyIds.includes(companyId))
      throw new ForbiddenException("Tidak punya akses ke salah satu perusahaan dalam lingkup konsolidasi");
  }
}
