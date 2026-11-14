import { BadRequestException, Injectable } from "@nestjs/common";
import { eq, inArray, schema, sql, type Db, type SQL } from "@erp/db";
import {
  BALANCE_SHEET_GROUPS,
  cashFlowStatement,
  PROFIT_LOSS_GROUPS,
  PROFIT_LOSS_TYPES,
  type CashFlowCategory,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { companiesWith, currentContext } from "../common/request-context.js";

const today = () => new Date().toISOString().slice(0, 10);

export const reportQuery = z.object({
  /** Daftar perusahaan dipisah koma; default perusahaan aktif. Hasil = penjumlahan (belum eliminasi konsolidasi). */
  companyIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined)),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().default(today),
  businessUnitId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** Termasuk cost/profit center turunannya. */
  costCenterId: z.string().uuid().optional(),
  profitCenterId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  type: z.enum(["receivable", "payable"]).default("receivable"),
});
export type ReportQuery = z.infer<typeof reportQuery>;

interface Scope {
  companyIds: string[];
  fyStart: string;
  where: SQL;
}

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const fmt = (v: Decimal) => v.toFixed(2);
const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Subquery id center beserta turunannya (rekursif). */
const centerTree = (table: "cost_centers" | "profit_centers", id: string) => sql`
  with recursive t as (
    select id from ${sql.raw(table)} where id = ${id}
    union select c.id from ${sql.raw(table)} c join t on c.parent_id = t.id
  ) select id from t`;

type AccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: string;
};

@Injectable()
export class ReportService {
  /** Neraca saldo: saldo awal, mutasi debit/kredit, saldo akhir per akun. */
  async trialBalance(tx: Db, q: ReportQuery) {
    const s = await this.scope(tx, q);
    const from = q.dateFrom ?? s.fyStart;
    const rows = await tx.execute<AccountRow & { opening: string; debit: string; credit: string }>(sql`
      select a.id, a.code, a.name, a.account_type,
        sum(case when m.date < ${from} then l.balance else 0 end) as opening,
        sum(case when m.date >= ${from} then l.debit else 0 end) as debit,
        sum(case when m.date >= ${from} then l.credit else 0 end) as credit
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where ${s.where} and m.date <= ${q.dateTo}
        and (a.account_type not in (${list(PROFIT_LOSS_TYPES)}) or m.date >= ${s.fyStart})
      group by a.id, a.code, a.name, a.account_type
      order by a.code`);
    const unallocated = await this.profitLossSum(tx, s, undefined, s.fyStart, true);

    const lines = rows.map((r) => {
      const opening = dec(r.opening);
      return {
        accountId: r.id,
        code: r.code,
        name: r.name,
        accountType: r.account_type,
        opening: fmt(opening),
        debit: fmt(dec(r.debit)),
        credit: fmt(dec(r.credit)),
        closing: fmt(opening.plus(r.debit).minus(r.credit)),
      };
    });
    if (!unallocated.isZero()) {
      lines.push({
        accountId: "",
        code: "",
        name: "Laba/rugi tahun sebelumnya (belum dialokasi)",
        accountType: "equity_unaffected",
        opening: fmt(unallocated),
        debit: "0.00",
        credit: "0.00",
        closing: fmt(unallocated),
      });
    }
    const total = (key: "opening" | "debit" | "credit" | "closing") =>
      fmt(lines.reduce((t, l) => t.plus(l[key]), dec(0)));
    return {
      dateFrom: from,
      dateTo: q.dateTo,
      lines,
      totals: {
        opening: total("opening"),
        debit: total("debit"),
        credit: total("credit"),
        closing: total("closing"),
      },
    };
  }

  /** Buku besar satu akun dengan saldo berjalan. */
  async generalLedger(tx: Db, q: ReportQuery) {
    if (!q.accountId) throw new BadRequestException("Parameter accountId wajib diisi");
    const s = await this.scope(tx, q);
    const [account] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, q.accountId));
    if (!account || !s.companyIds.includes(account.companyId))
      throw new BadRequestException("Akun tidak ditemukan");
    const from = q.dateFrom ?? s.fyStart;
    const pl = PROFIT_LOSS_TYPES.includes(account.accountType);
    const [opening] = await tx.execute<{ balance: string }>(sql`
      select coalesce(sum(l.balance), 0) as balance
      from account_move_lines l join account_moves m on m.id = l.move_id
      where ${s.where} and l.account_id = ${account.id} and m.date < ${from}
        ${pl ? sql`and m.date >= ${s.fyStart}` : sql``}`);
    const rows = await tx.execute<{
      id: string;
      move_id: string;
      date: string;
      move_name: string;
      ref: string | null;
      label: string | null;
      partner: string | null;
      debit: string;
      credit: string;
    }>(sql`
      select l.id, l.move_id, m.date, m.name as move_name, m.ref, l.name as label, p.name as partner, l.debit, l.credit
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      left join partners p on p.id = l.partner_id
      where ${s.where} and l.account_id = ${account.id} and m.date between ${from} and ${q.dateTo}
      order by m.date, m.name, l.sequence`);
    let running = dec(opening?.balance);
    const lines = rows.map((r) => {
      running = running.plus(r.debit).minus(r.credit);
      return { ...r, debit: fmt(dec(r.debit)), credit: fmt(dec(r.credit)), balance: fmt(running) };
    });
    return {
      account: { id: account.id, code: account.code, name: account.name },
      dateFrom: from,
      dateTo: q.dateTo,
      opening: fmt(dec(opening?.balance)),
      lines,
      closing: fmt(running),
    };
  }

  /** Neraca per tanggal; laba tahun berjalan & laba tahun lalu yang belum dialokasi masuk ekuitas. */
  async balanceSheet(tx: Db, q: ReportQuery) {
    const s = await this.scope(tx, q);
    const bsTypes = Object.values(BALANCE_SHEET_GROUPS).flat();
    const rows = await tx.execute<AccountRow & { balance: string }>(sql`
      select a.id, a.code, a.name, a.account_type, sum(l.balance) as balance
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where ${s.where} and m.date <= ${q.dateTo} and a.account_type in (${list(bsTypes)})
      group by a.id, a.code, a.name, a.account_type
      having sum(l.balance) <> 0
      order by a.code`);
    const section = (types: readonly string[], sign: 1 | -1) => {
      const accounts = rows
        .filter((r) => types.includes(r.account_type))
        .map((r) => ({
          accountId: r.id,
          code: r.code,
          name: r.name,
          amount: fmt(dec(r.balance).times(sign)),
        }));
      return { accounts, total: accounts.reduce((t, a) => t.plus(a.amount), dec(0)) };
    };
    const assets = section(BALANCE_SHEET_GROUPS.asset, 1);
    const liabilities = section(BALANCE_SHEET_GROUPS.liability, -1);
    const equity = section(BALANCE_SHEET_GROUPS.equity, -1);

    const currentEarnings = (await this.profitLossSum(tx, s, s.fyStart, q.dateTo)).negated();
    const priorEarnings = (await this.profitLossSum(tx, s, undefined, s.fyStart, true)).negated();
    if (!priorEarnings.isZero()) {
      equity.accounts.push({
        accountId: "",
        code: "",
        name: "Laba/rugi tahun sebelumnya (belum dialokasi)",
        amount: fmt(priorEarnings),
      });
    }
    equity.accounts.push({
      accountId: "",
      code: "",
      name: "Laba/rugi tahun berjalan",
      amount: fmt(currentEarnings),
    });
    equity.total = equity.total.plus(currentEarnings).plus(priorEarnings);

    const liabilitiesAndEquity = liabilities.total.plus(equity.total);
    const out = (x: { accounts: unknown[]; total: Decimal }) => ({
      accounts: x.accounts,
      total: fmt(x.total),
    });
    return {
      date: q.dateTo,
      fiscalYearStart: s.fyStart,
      assets: out(assets),
      liabilities: out(liabilities),
      equity: out(equity),
      totalLiabilitiesAndEquity: fmt(liabilitiesAndEquity),
      balanced: assets.total.equals(liabilitiesAndEquity),
    };
  }

  /** Laba rugi periode: pendapatan, HPP, laba kotor, beban, laba usaha, lain-lain, laba bersih. */
  async profitLoss(tx: Db, q: ReportQuery) {
    const s = await this.scope(tx, q);
    const from = q.dateFrom ?? s.fyStart;
    const rows = await tx.execute<AccountRow & { balance: string }>(sql`
      select a.id, a.code, a.name, a.account_type, sum(l.balance) as balance
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where ${s.where} and m.date between ${from} and ${q.dateTo} and a.account_type in (${list(PROFIT_LOSS_TYPES)})
        and m.closing_year is null
      group by a.id, a.code, a.name, a.account_type
      order by a.code`);
    const section = (types: readonly string[], sign: 1 | -1) => {
      const accounts = rows
        .filter((r) => types.includes(r.account_type))
        .map((r) => ({
          accountId: r.id,
          code: r.code,
          name: r.name,
          amount: fmt(dec(r.balance).times(sign)),
        }));
      return { accounts, total: accounts.reduce((t, a) => t.plus(a.amount), dec(0)) };
    };
    const income = section(PROFIT_LOSS_GROUPS.income, -1);
    const directCost = section(PROFIT_LOSS_GROUPS.directCost, 1);
    const expense = section(PROFIT_LOSS_GROUPS.expense, 1);
    const otherIncome = section(PROFIT_LOSS_GROUPS.otherIncome, -1);
    const otherExpense = section(PROFIT_LOSS_GROUPS.otherExpense, 1);
    const grossProfit = income.total.minus(directCost.total);
    const operatingProfit = grossProfit.minus(expense.total);
    const netProfit = operatingProfit.plus(otherIncome.total).minus(otherExpense.total);
    const out = (x: { accounts: unknown[]; total: Decimal }) => ({
      accounts: x.accounts,
      total: fmt(x.total),
    });
    return {
      dateFrom: from,
      dateTo: q.dateTo,
      income: out(income),
      directCost: out(directCost),
      grossProfit: fmt(grossProfit),
      expense: out(expense),
      operatingProfit: fmt(operatingProfit),
      otherIncome: out(otherIncome),
      otherExpense: out(otherExpense),
      netProfit: fmt(netProfit),
    };
  }

  /** Umur piutang/utang per partner berdasarkan jatuh tempo (sisa saat ini). */
  async aged(tx: Db, q: ReportQuery) {
    const s = await this.scope(tx, q);
    const accountType = q.type === "receivable" ? "asset_receivable" : "liability_payable";
    const sign = q.type === "receivable" ? 1 : -1;
    const rows = await tx.execute<{
      partner_id: string | null;
      partner: string | null;
      days: number;
      residual: string;
    }>(sql`
      select l.partner_id, p.name as partner,
        (${q.dateTo}::date - coalesce(m.due_date, m.date)) as days, l.amount_residual as residual
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      left join partners p on p.id = l.partner_id
      where ${s.where} and m.date <= ${q.dateTo} and a.account_type = ${accountType}
        and not l.reconciled and l.amount_residual <> 0`);
    const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "over90"] as const;
    const bucketOf = (days: number) =>
      days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "over90";
    const partners = new Map<
      string,
      { partnerId: string | null; partner: string; buckets: Record<string, Decimal>; total: Decimal }
    >();
    const totals = Object.fromEntries(BUCKETS.map((b) => [b, dec(0)])) as Record<string, Decimal>;
    for (const r of rows) {
      const key = r.partner_id ?? "";
      const entry = partners.get(key) ?? {
        partnerId: r.partner_id,
        partner: r.partner ?? "—",
        buckets: Object.fromEntries(BUCKETS.map((b) => [b, dec(0)])),
        total: dec(0),
      };
      const amount = dec(r.residual).times(sign);
      const bucket = bucketOf(Number(r.days));
      entry.buckets[bucket] = entry.buckets[bucket]!.plus(amount);
      entry.total = entry.total.plus(amount);
      totals[bucket] = totals[bucket]!.plus(amount);
      partners.set(key, entry);
    }
    const fmtBuckets = (b: Record<string, Decimal>) =>
      Object.fromEntries(Object.entries(b).map(([k, v]) => [k, fmt(v)]));
    return {
      type: q.type,
      date: q.dateTo,
      partners: [...partners.values()]
        .sort((a, b) => a.partner.localeCompare(b.partner))
        .map((p) => ({
          partnerId: p.partnerId,
          partner: p.partner,
          ...fmtBuckets(p.buckets),
          total: fmt(p.total),
        })),
      totals: {
        ...fmtBuckets(totals),
        total: fmt(Object.values(totals).reduce((a, b) => a.plus(b), dec(0))),
      },
    };
  }

  /**
   * Rekonsiliasi rekening antar kantor (RK pusat–cabang): saldo akun RK per cabang s.d. tanggal. Dalam satu
   * perusahaan jumlah semua cabang harus nol; selisih menandakan transaksi antar kantor yang belum dicatat pasangannya.
   */
  async branchClearing(tx: Db, q: ReportQuery) {
    const s = await this.scope(tx, { ...q, branchId: undefined });
    const rows = await tx.execute<{
      account_id: string;
      code: string;
      name: string;
      branch_id: string | null;
      branch: string | null;
      balance: string;
    }>(sql`
      select a.id as account_id, a.code, a.name, l.branch_id, b.name as branch, sum(l.balance)::text as balance
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      left join branches b on b.id = l.branch_id
      where ${s.where} and m.date <= ${q.dateTo} and a.branch_clearing
      group by a.id, a.code, a.name, l.branch_id, b.name
      having sum(l.balance) <> 0
      order by a.code, b.name nulls first`);
    const accounts = new Map<
      string,
      {
        accountId: string;
        code: string;
        name: string;
        branches: { branchId: string | null; branch: string; balance: string }[];
        total: Decimal;
      }
    >();
    for (const r of rows) {
      const a = accounts.get(r.account_id) ?? {
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        branches: [],
        total: dec(0),
      };
      a.branches.push({
        branchId: r.branch_id,
        branch: r.branch ?? "Kantor pusat (tanpa cabang)",
        balance: fmt(dec(r.balance)),
      });
      a.total = a.total.plus(r.balance);
      accounts.set(r.account_id, a);
    }
    const list = [...accounts.values()].map((a) => ({ ...a, total: fmt(a.total) }));
    const total = list.reduce((sum, a) => sum.plus(a.total), dec(0));
    return { date: q.dateTo, accounts: list, total: fmt(total), balanced: total.isZero() };
  }

  /**
   * Laporan arus kas metode tidak langsung untuk rentang `dateFrom`..`dateTo` (bawaan: awal tahun fiskal).
   * Entri tutup buku diabaikan agar laba bersih tidak muncul lagi sebagai perubahan ekuitas.
   */
  async cashFlow(tx: Db, q: ReportQuery) {
    const s = await this.scope(tx, q);
    const from = q.dateFrom ?? s.fyStart;
    const rows = await tx.execute<
      AccountRow & {
        cash_flow_category: CashFlowCategory | null;
        opening: string;
        closing: string;
        period: string;
      }
    >(sql`
      select a.id, a.code, a.name, a.account_type, a.cash_flow_category,
        coalesce(sum(case when m.date < ${from} then l.balance else 0 end), 0) as opening,
        coalesce(sum(l.balance), 0) as closing,
        coalesce(sum(case when m.date >= ${from} then l.balance else 0 end), 0) as period
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where ${s.where} and m.date <= ${q.dateTo} and m.closing_year is null
      group by a.id, a.code, a.name, a.account_type, a.cash_flow_category
      order by a.code`);
    const pl = rows.filter((r) => (PROFIT_LOSS_TYPES as readonly string[]).includes(r.account_type));
    // Laba bersih = −(saldo debit akun laba rugi) dalam periode.
    const netProfit = pl.reduce((t, r) => t.minus(r.period), dec(0));
    const depreciation = pl
      .filter((r) => r.account_type === "expense_depreciation")
      .reduce((t, r) => t.plus(r.period), dec(0));
    const statement = cashFlowStatement({
      netProfit: netProfit.toFixed(2),
      depreciation: depreciation.toFixed(2),
      accounts: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        accountType: r.account_type,
        cashFlowCategory: r.cash_flow_category,
        opening: r.opening,
        closing: r.closing,
      })),
    });
    return { dateFrom: from, dateTo: q.dateTo, ...statement };
  }

  // ---- Internal ----

  private async scope(tx: Db, q: ReportQuery): Promise<Scope> {
    const ctx = currentContext();
    const companyIds = q.companyIds ?? [ctx.companyId];
    // Laporan gabungan: wajib punya hak baca akuntansi di setiap perusahaan yang diminta, bukan sekadar akses.
    const readable = new Set([ctx.companyId, ...companiesWith("accounting.read", "/reports")]);
    for (const id of companyIds) {
      if (!readable.has(id)) throw new BadRequestException("Tidak punya akses ke salah satu perusahaan");
    }
    const companies = await tx
      .select({ id: schema.companies.id, month: schema.companies.fiscalYearStartMonth })
      .from(schema.companies)
      .where(inArray(schema.companies.id, companyIds));
    const month = companies.find((c) => c.id === companyIds[0])?.month ?? 1;
    const [y, m] = q.dateTo.split("-").map(Number) as [number, number];
    const fyYear = m >= month ? y : y - 1;
    const fyStart = `${fyYear}-${String(month).padStart(2, "0")}-01`;

    const filters: SQL[] = [sql`m.state = 'posted'`, sql`l.company_id in (${list(companyIds)})`];
    if (q.businessUnitId) filters.push(sql`l.business_unit_id = ${q.businessUnitId}`);
    if (q.branchId) filters.push(sql`l.branch_id = ${q.branchId}`);
    if (q.costCenterId)
      filters.push(sql`l.cost_center_id in (${centerTree("cost_centers", q.costCenterId)})`);
    if (q.profitCenterId)
      filters.push(sql`l.profit_center_id in (${centerTree("profit_centers", q.profitCenterId)})`);
    return { companyIds, fyStart, where: sql.join(filters, sql` and `) };
  }

  /** Jumlah saldo akun laba rugi dalam rentang tanggal (bertanda debit +). */
  private async profitLossSum(tx: Db, s: Scope, from: string | undefined, to: string, exclusiveTo = false) {
    const [row] = await tx.execute<{ balance: string }>(sql`
      select coalesce(sum(l.balance), 0) as balance
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join accounts a on a.id = l.account_id
      where ${s.where} and a.account_type in (${list(PROFIT_LOSS_TYPES)})
        ${from ? sql`and m.date >= ${from}` : sql``}
        and m.date ${exclusiveTo ? sql`<` : sql`<=`} ${to}`);
    return dec(row?.balance);
  }
}
