import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, or, gte, schema, sql, type Db } from "@erp/db";
import {
  BASE_CURRENCY,
  PROFIT_LOSS_TYPES,
  consolidate,
  consolidatedStatements,
  effectiveOwnership,
  intercompanyReconciliation,
  worksheet,
  type EntityInput,
  type GroupAccountInfo,
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

  /** Entitas dalam lingkup konsolidasi `rootId` per tanggal: metode, kepemilikan langsung & efektif, kurs bawaan. */
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
    const links = await tx
      .select()
      .from(schema.ownershipHistory)
      .where(
        and(
          lte(schema.ownershipHistory.validFrom, dateTo),
          or(isNull(schema.ownershipHistory.validTo), gte(schema.ownershipHistory.validTo, dateTo)),
        ),
      );

    // Telusuri dari induk: anak metode penuh/proporsional ditelusuri lebih lanjut, asosiasi berhenti di situ.
    const method = new Map<string, Method>([[rootId, "full"]]);
    const queue = [rootId];
    while (queue.length) {
      const parent = queue.shift()!;
      for (const link of links.filter((l) => l.parentCompanyId === parent && l.method !== "none")) {
        const m = link.method as Method;
        const current = method.get(link.childCompanyId);
        if (link.childCompanyId === rootId || (current && RANK[current] >= RANK[m])) continue;
        method.set(link.childCompanyId, m);
        if (m !== "equity") queue.push(link.childCompanyId);
      }
    }
    const scopeLinks = links.filter(
      (l) =>
        method.has(l.parentCompanyId) && method.get(l.parentCompanyId) !== "equity" && l.method !== "none",
    );
    const ownership = scopeLinks.map((l) => ({
      parentId: l.parentCompanyId,
      childId: l.childCompanyId,
      pct: l.pct,
    }));

    const entities = [];
    for (const [companyId, m] of method) {
      const company = byId.get(companyId)!;
      const isRoot = companyId === rootId;
      const parents = scopeLinks.filter((l) => l.childCompanyId === companyId);
      const rate = await this.defaultRates(tx, company.currency, root.currency, dateFrom, dateTo);
      entities.push({
        companyId,
        name: company.name,
        isRoot,
        method: m,
        currencyCode: company.currency,
        directPct: isRoot ? "100" : parents.reduce((s, l) => s.plus(l.pct), D(0)).toString(),
        effectivePct: isRoot
          ? "100"
          : effectiveOwnership(ownership, rootId, companyId).toDecimalPlaces(4).toString(),
        links: parents.map((l) => ({
          parentId: l.parentCompanyId,
          pct: l.pct,
          consideration: l.consideration,
          acquiredNetAssets: l.acquiredNetAssets,
          validFrom: l.validFrom,
        })),
        ...rate,
      });
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

  /** Hitung ulang saldo & jurnal otomatis (draft); jurnal manual dipertahankan. */
  async compute(tx: Db, runId: string, rates: Rates = []) {
    const run = await this.find(tx, runId);
    if (run.state === "final") throw new BadRequestException("Konsolidasi final tidak bisa dihitung ulang");
    const previous = await tx
      .select()
      .from(schema.consolidationEntities)
      .where(eq(schema.consolidationEntities.runId, runId));
    const { entities } = await this.structure(tx, run.rootCompanyId, run.dateFrom, run.dateTo);
    for (const e of entities) this.assertCompany(e.companyId);
    // Kurs manual: dari permintaan ini, atau yang tersimpan pada perhitungan sebelumnya.
    for (const e of entities) {
      const prev = previous.find((p) => p.companyId === e.companyId);
      const override = rates.find((r) => r.companyId === e.companyId);
      if (e.currencyCode === run.currencyCode) continue;
      e.closingRate = override?.closingRate ?? prev?.closingRate ?? e.closingRate;
      e.averageRate = override?.averageRate ?? prev?.averageRate ?? e.averageRate;
      e.historicalRate = override?.historicalRate ?? prev?.historicalRate ?? e.historicalRate;
    }

    const companyIds = entities.map((e) => e.companyId);
    const data = await this.loadBalances(tx, companyIds, run.dateFrom, run.dateTo);
    if (data.unmapped.length)
      throw new BadRequestException({
        message: "Ada akun bersaldo yang belum dipetakan ke bagan akun grup",
        errors: data.unmapped.map((u) => ({ path: u.companyName, message: `${u.code} ${u.name}` })),
      });
    const accounts = await this.groupAccounts(tx);

    const inputs: EntityInput[] = [];
    for (const e of entities) {
      const prior =
        e.method === "equity" && e.links[0]
          ? await this.postAcquisitionPrior(tx, e.companyId, e.links[0].validFrom, run.dateFrom)
          : "0";
      inputs.push({
        companyId: e.companyId,
        name: e.name,
        isRoot: e.isRoot,
        method: e.method,
        effectivePct: e.effectivePct,
        closingRate: e.closingRate,
        averageRate: e.averageRate,
        historicalRate: e.historicalRate,
        links: e.links,
        balances: data.balances.filter((b) => b.companyId === e.companyId),
        priorUnallocated: data.prior.get(e.companyId) ?? "0",
        postAcquisitionPrior: prior,
        intercompany: data.intercompany.filter((i) => i.companyId === e.companyId),
      });
    }
    let result: ReturnType<typeof consolidate>;
    try {
      result = consolidate(accounts, inputs);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    await tx.delete(schema.consolidationEntities).where(eq(schema.consolidationEntities.runId, runId));
    await tx.delete(schema.consolidationBalances).where(eq(schema.consolidationBalances.runId, runId));
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
      })),
    );
    if (result.balances.length)
      await tx.insert(schema.consolidationBalances).values(result.balances.map((b) => ({ ...b, runId })));
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
      .set({ warnings: result.warnings, computedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.consolidationRuns.id, runId));
    return this.get(tx, runId);
  }

  /**
   * Saldo per perusahaan per akun grup: akun neraca kumulatif s.d. tanggal akhir (tanpa jurnal tutup buku
   * dalam periode), akun laba rugi selama periode (tanpa jurnal tutup buku), dan laba/rugi sebelum periode
   * yang belum ditutup. Ketiganya bersama-sama seimbang.
   */
  private async loadBalances(tx: Db, companyIds: string[], from: string, to: string) {
    const pl = list(PROFIT_LOSS_TYPES);
    const rows = await tx.execute<{
      company_id: string;
      company_name: string;
      account_id: string;
      code: string;
      name: string;
      group_account_id: string | null;
      amount: string;
    }>(sql`
      select l.company_id, c.name as company_name, a.id as account_id, a.code, a.name, map.group_account_id,
             sum(l.balance)::text as amount
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      join companies c on c.id = l.company_id
      left join consolidation_account_map map on map.account_id = a.id
      where m.state = 'posted' and l.company_id in (${list(companyIds)}) and m.date <= ${to}
        and ((a.account_type not in (${pl}) and not (m.closing_year is not null and m.date >= ${from}))
          or (a.account_type in (${pl}) and m.date >= ${from} and m.closing_year is null))
      group by l.company_id, c.name, a.id, a.code, a.name, map.group_account_id
      having sum(l.balance) <> 0`);
    const priorRows = await tx.execute<{ company_id: string; amount: string }>(sql`
      select l.company_id, sum(l.balance)::text as amount
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where m.state = 'posted' and l.company_id in (${list(companyIds)}) and m.date < ${from}
        and a.account_type in (${pl})
      group by l.company_id`);
    const icRows = await tx.execute<{
      company_id: string;
      group_account_id: string;
      ic_company_id: string;
      amount: string;
    }>(sql`
      select l.company_id, map.group_account_id, l.ic_company_id, sum(l.balance)::text as amount
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      join consolidation_account_map map on map.account_id = a.id
      where m.state = 'posted' and l.company_id in (${list(companyIds)}) and m.date <= ${to}
        and l.ic_company_id is not null and l.display_type <> 'tax'
        and a.account_type in (${list(IC_TYPES)})
        and ((a.account_type not in (${pl}) and not (m.closing_year is not null and m.date >= ${from}))
          or (a.account_type in (${pl}) and m.date >= ${from} and m.closing_year is null))
      group by l.company_id, map.group_account_id, l.ic_company_id
      having sum(l.balance) <> 0`);
    // Saldo per akun grup (beberapa akun lokal bisa dipetakan ke akun grup yang sama).
    const balances = new Map<string, { companyId: string; groupAccountId: string; amount: Decimal }>();
    for (const r of rows) {
      if (!r.group_account_id) continue;
      const key = `${r.company_id}:${r.group_account_id}`;
      const b = balances.get(key) ?? {
        companyId: r.company_id,
        groupAccountId: r.group_account_id,
        amount: D(0),
      };
      b.amount = b.amount.plus(r.amount);
      balances.set(key, b);
    }
    return {
      balances: [...balances.values()].map((b) => ({ ...b, amount: b.amount.toFixed(2) })),
      unmapped: rows
        .filter((r) => !r.group_account_id)
        .map((r) => ({ companyName: r.company_name, code: r.code, name: r.name })),
      prior: new Map(priorRows.map((r) => [r.company_id, r.amount])),
      intercompany: icRows.map((r) => ({
        companyId: r.company_id,
        groupAccountId: r.group_account_id,
        counterpartId: r.ic_company_id,
        amount: r.amount,
      })),
    };
  }

  /** Metode ekuitas: laba/rugi asosiasi sejak tanggal kepemilikan sampai sebelum periode (tanpa tutup buku). */
  private async postAcquisitionPrior(tx: Db, companyId: string, since: string, from: string) {
    const [row] = await tx.execute<{ amount: string | null }>(sql`
      select sum(l.balance)::text as amount
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where m.state = 'posted' and l.company_id = ${companyId} and m.closing_year is null
        and m.date >= ${since} and m.date < ${from} and a.account_type in (${list(PROFIT_LOSS_TYPES)})`);
    return row?.amount ?? "0";
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
    return { run: ws.run, ...consolidatedStatements(ws.rows) };
  }

  /** Rekonsiliasi saldo antar perusahaan (dalam mata uang penyajian, kurs proses). */
  async icReconciliation(tx: Db, runId: string) {
    const run = await this.get(tx, runId);
    const aggregated = run.entities.filter((e) => e.method !== "equity");
    const data = await this.loadBalances(
      tx,
      aggregated.map((e) => e.companyId),
      run.dateFrom,
      run.dateTo,
    );
    const accounts = new Map((await this.groupAccounts(tx)).map((a) => [a.id, a]));
    const pl = new Set(PROFIT_LOSS_TYPES);
    const rate = (e: (typeof aggregated)[number], groupAccountId: string) =>
      pl.has(accounts.get(groupAccountId)!.accountType) ? e.averageRate : e.closingRate;
    const side = (kind: "balance" | "result") =>
      intercompanyReconciliation(
        aggregated.map((e) => ({
          companyId: e.companyId,
          name: e.name,
          intercompany: data.intercompany
            .filter(
              (i) =>
                i.companyId === e.companyId &&
                pl.has(accounts.get(i.groupAccountId)!.accountType) === (kind === "result"),
            )
            .map((i) => ({
              counterpartId: i.counterpartId,
              amount: D(i.amount).times(rate(e, i.groupAccountId)),
            })),
        })),
      );
    return { balances: side("balance"), transactions: side("result") };
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
