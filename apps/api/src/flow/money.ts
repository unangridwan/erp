import { Controller, Get, Inject, Query } from "@nestjs/common";
import { schema, sql, eq, and, type Db } from "@erp/db";
import { businessToday, cashCycle, cashForecast, summarizeCash, type ForecastSource } from "@erp/shared";
import { z } from "zod";
import { ControllingService } from "../accounting/controlling.module.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v: unknown) => (v === "" ? undefined : v);
const periodSchema = z
  .object({
    from: z.preprocess(blank, z.string().regex(ISO).optional()),
    to: z.preprocess(blank, z.string().regex(ISO).optional()),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  });
const forecastSchema = z.object({
  weeks: z.preprocess(blank, z.coerce.number().int().min(4).max(26).default(13)),
});
/** Periode bawaan: awal tahun berjalan s.d. hari ini. */
const period = (q: { from?: string; to?: string }) => {
  const today = businessToday();
  return { from: q.from ?? `${today.slice(0, 4)}-01-01`, to: q.to ?? today };
};
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
/** Akun kas & bank: kategori arus kas "kas" (diatur) atau tipe kas & bank. */
const CASH = sql.raw(
  `coalesce(a.cash_flow_category, case when a.account_type = 'asset_cash' then 'cash' else '' end) = 'cash'`,
);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Arus uang: dari mana kas datang & ke mana perginya, siklus konversi kas (DSO/DIO/DPO/CCC), proyeksi kas mingguan,
 * dan anggaran vs realisasi per departemen. Semua diturunkan dari jurnal terposting & dokumen terbuka.
 */
@Controller("flow/money")
export class FlowMoneyController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ControllingService) private readonly controlling: ControllingService,
  ) {}

  /** Arus kas metode langsung: baris lawan kas pada jurnal yang menyentuh kas/bank, per kategori & per bulan. */
  @Get("cash")
  @RequirePermission("accounting.read")
  cash(@Query() query: unknown) {
    const { from, to } = period(parse(periodSchema, query));
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const [bal] = await tx.execute<{ opening: string | null; closing: string | null }>(sql`
        select sum(case when m.date < ${from} then l.balance else 0 end) as opening, sum(l.balance) as closing
        from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
        where m.company_id = ${c} and m.state = 'posted' and m.date <= ${to} and ${CASH}`);
      const lines = await tx.execute<{
        account_type: string;
        name: string;
        month: string;
        amount: string;
      }>(sql`
        with cm as (
          select distinct l.move_id from account_move_lines l
          join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
          where m.company_id = ${c} and m.state = 'posted' and m.date between ${from} and ${to} and ${CASH}
        )
        select a.account_type, a.name, to_char(m.date, 'YYYY-MM') as month, sum(-l.balance) as amount
        from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
        where l.move_id in (select move_id from cm) and not (${CASH})
        group by 1, 2, 3`);
      return {
        from,
        to,
        ...summarizeCash(
          [...lines].map((l) => ({
            accountType: l.account_type,
            accountName: l.name,
            month: l.month,
            amount: num(l.amount),
          })),
          { opening: num(bal?.opening), closing: num(bal?.closing) },
        ),
      };
    });
  }

  /** Siklus konversi kas 12 bulan sampai `to`: penjualan, HPP, saldo piutang/utang/persediaan akhir bulan. */
  @Get("cycle")
  @RequirePermission("accounting.read")
  cycle(@Query() query: unknown) {
    const requested = period(parse(periodSchema, query)).to;
    // Bulan berjalan belum lengkap (penjualan/HPP belum penuh): siklus dihitung s.d. akhir bulan sebelumnya.
    const to =
      requested.slice(0, 7) === businessToday().slice(0, 7)
        ? new Date(Date.UTC(Number(requested.slice(0, 4)), Number(requested.slice(5, 7)) - 1, 0))
            .toISOString()
            .slice(0, 10)
        : requested;
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const rows = await tx.execute<{ month: string; account_type: string; amount: string }>(sql`
        select to_char(date_trunc('month', m.date), 'YYYY-MM') as month, a.account_type, sum(l.balance) as amount
        from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
        where m.company_id = ${c} and m.state = 'posted' and m.closing_year is null and m.date <= ${to}
          and a.account_type in ('income', 'expense_direct_cost', 'asset_receivable', 'liability_payable')
        group by 1, 2`);
      const stock = await tx.execute<{ month: string; amount: string }>(sql`
        select to_char(date_trunc('month', coalesce(mv.date, v.created_at)), 'YYYY-MM') as month, sum(v.value) as amount
        from stock_valuation_layers v left join stock_moves mv on mv.id = v.stock_move_id
        where v.company_id = ${c} and coalesce(mv.date, v.created_at) < (${to}::date + 1)
        group by 1`);
      const months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - 11 + i);
        const end = new Date(d);
        end.setUTCMonth(end.getUTCMonth() + 1);
        end.setUTCDate(0);
        return { month: d.toISOString().slice(0, 7), days: end.getUTCDate() };
      });
      const flow = (type: string, month: string) =>
        [...rows]
          .filter((r) => r.account_type === type && r.month === month)
          .reduce((s, r) => s + num(r.amount), 0);
      const upTo = (type: string, month: string) =>
        [...rows]
          .filter((r) => r.account_type === type && r.month <= month)
          .reduce((s, r) => s + num(r.amount), 0);
      const inventory = (month: string) =>
        [...stock].filter((r) => r.month <= month).reduce((s, r) => s + num(r.amount), 0);
      const series = cashCycle(
        months.map((m) => ({
          ...m,
          revenue: -flow("income", m.month),
          cogs: flow("expense_direct_cost", m.month),
          ar: upTo("asset_receivable", m.month),
          ap: -upTo("liability_payable", m.month),
          inventory: inventory(m.month),
        })),
      );
      return { to, months: series, latest: series.at(-1) ?? null };
    });
  }

  /**
   * Proyeksi kas mingguan dari saldo kas hari ini: + piutang menurut jatuh tempo, + pesanan yang belum ditagih,
   * − utang menurut jatuh tempo, − PO yang belum ditagih pemasok, − payroll rutin (rata-rata 3 periode terakhir).
   */
  @Get("forecast")
  @RequirePermission("accounting.read")
  forecast(@Query() query: unknown) {
    const { weeks } = parse(forecastSchema, query);
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const today = businessToday();
      const [cash] = await tx.execute<{ balance: string | null }>(sql`
        select sum(l.balance) as balance
        from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
        where m.company_id = ${c} and m.state = 'posted' and m.date <= ${today} and ${CASH}`);
      const items: { source: ForecastSource; date: string; amount: number }[] = [];

      const open = await tx.execute<{ account_type: string; due: string; amount: string }>(sql`
        select a.account_type, coalesce(m.due_date, m.date)::text as due, sum(l.amount_residual) as amount
        from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
        where m.company_id = ${c} and m.state = 'posted' and not l.reconciled and l.amount_residual <> 0
          and a.account_type in ('asset_receivable', 'liability_payable')
        group by 1, 2`);
      for (const r of open) {
        const v = num(r.amount);
        if (r.account_type === "asset_receivable" && v > 0)
          items.push({ source: "receivables", date: r.due, amount: v });
        if (r.account_type === "liability_payable" && v < 0)
          items.push({ source: "payables", date: r.due, amount: -v });
      }

      // Pesanan & PO yang belum ditagih: sisa nilai (termasuk pajak), cair setelah termin pembayaran.
      const orders = await tx.execute<{
        date: string;
        untaxed: string;
        total: string;
        days: number;
        billed: string;
      }>(sql`
        with billed as (
          select sl.order_id, sum(-l.balance) as amount
          from account_move_lines l join account_moves m on m.id = l.move_id
          join sale_order_lines sl on sl.id = l.sale_line_id
          where m.company_id = ${c} and m.state = 'posted'
          group by 1
        )
        select s.date_order::text as date, s.amount_untaxed as untaxed, s.amount_total as total,
          coalesce(pt.days, 30) as days, coalesce(b.amount, 0) as billed
        from sale_orders s left join payment_terms pt on pt.id = s.payment_term_id
        left join billed b on b.order_id = s.id
        where s.company_id = ${c} and s.state = 'sale' and s.invoice_status <> 'invoiced'`);
      const pos = await tx.execute<{
        date: string;
        untaxed: string;
        total: string;
        days: number;
        billed: string;
      }>(sql`
        with billed as (
          select pl.order_id, sum(l.balance) as amount
          from account_move_lines l join account_moves m on m.id = l.move_id
          join purchase_order_lines pl on pl.id = l.purchase_line_id
          where m.company_id = ${c} and m.state = 'posted'
          group by 1
        )
        select coalesce(p.date_planned::date, p.date_order)::text as date, p.amount_untaxed as untaxed,
          p.amount_total as total, coalesce(pt.days, 30) as days, coalesce(b.amount, 0) as billed
        from purchase_orders p left join payment_terms pt on pt.id = p.payment_term_id
        left join billed b on b.order_id = p.id
        where p.company_id = ${c} and p.state = 'purchase' and coalesce(b.amount, 0) < p.amount_untaxed`);
      const remaining = (r: { untaxed: string; total: string; billed: string }) => {
        const untaxed = num(r.untaxed);
        const rest = Math.max(0, untaxed - num(r.billed));
        return untaxed > 0 ? Math.round(((rest * num(r.total)) / untaxed) * 100) / 100 : 0;
      };
      const due = (r: { date: string; days: number }) => {
        const d = addDays(r.date, Number(r.days));
        return d < today ? today : d;
      };
      for (const r of orders) items.push({ source: "sales", date: due(r), amount: remaining(r) });
      for (const r of pos) items.push({ source: "purchases", date: due(r), amount: remaining(r) });

      // Payroll rutin: rata-rata gaji bersih 3 periode terakhir, dibayar bulanan pada tanggal yang sama.
      const runs = await tx.execute<{ payment_date: string; net: string }>(sql`
        with r as (
          select id, payment_date from payroll_runs
          where company_id = ${c} and kind = 'regular' and state in ('done', 'paid') and payment_date is not null
          order by payment_date desc limit 3
        )
        select r.payment_date::text as payment_date, (select sum(s.net) from payslips s where s.run_id = r.id) as net
        from r order by r.payment_date desc`);
      if (runs.length) {
        const avg = runs.reduce((s, r) => s + num(r.net), 0) / runs.length;
        const last = new Date(`${runs[0]!.payment_date}T00:00:00Z`);
        const horizon = addDays(today, weeks * 7);
        for (let i = 1; i <= 24; i++) {
          const d = new Date(last);
          d.setUTCMonth(d.getUTCMonth() + i);
          const iso = d.toISOString().slice(0, 10);
          if (iso > horizon) break;
          if (iso >= today) items.push({ source: "payroll", date: iso, amount: Math.round(avg * 100) / 100 });
        }
      }
      return { today, ...cashForecast({ today, opening: num(cash?.balance), weeks, items }) };
    });
  }

  /** Anggaran vs realisasi beban per departemen (lewat cost center departemen), periode bawaan tahun berjalan. */
  @Get("budget")
  @RequirePermission("accounting.read")
  budget(@Query() query: unknown) {
    const q = parse(periodSchema, query);
    const year = businessToday().slice(0, 4);
    const from = q.from ?? `${year}-01-01`;
    const to = q.to ?? `${year}-12-31`;
    return this.tenantDb.run(async (tx: Db) => {
      const c = currentContext().companyId;
      const report = await this.controlling.costCenters(tx, { dateFrom: from, dateTo: to });
      const byCenter = new Map(report.rows.map((r) => [r.id, r]));
      const D = schema.departments;
      const deps = await tx
        .select({ id: D.id, name: D.name, costCenterId: D.costCenterId })
        .from(D)
        .where(and(eq(D.companyId, c), eq(D.active, true)))
        .orderBy(D.name);
      return {
        from,
        to,
        items: deps.map((d) => {
          const r = d.costCenterId ? byCenter.get(d.costCenterId) : undefined;
          return {
            departmentId: d.id,
            department: d.name,
            costCenter: r ? `${r.code} ${r.name}` : null,
            budget: r ? num(r.budget) : null,
            actual: r ? num(r.actual) : null,
            variance: r ? num(r.variance) : null,
            percent: r?.percent ?? null,
          };
        }),
        unassigned: num(report.unassigned),
        total: { budget: num(report.total.budget), actual: num(report.total.actual) },
      };
    });
  }
}
