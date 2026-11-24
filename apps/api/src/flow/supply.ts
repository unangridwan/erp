import { Controller, Get, Inject, Query } from "@nestjs/common";
import { sql } from "@erp/db";
import { businessToday, otif, otifByMonth, recordHref, stockAging, supplierScore } from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v: unknown) => (v === "" ? undefined : v);
const querySchema = z
  .object({
    from: z.preprocess(blank, z.string().regex(ISO).optional()),
    to: z.preprocess(blank, z.string().regex(ISO).optional()),
    /** Toleransi keterlambatan (hari) yang masih dianggap tepat waktu. */
    tolerance: z.preprocess(blank, z.coerce.number().int().min(0).max(30).default(0)),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Tanggal awal harus sebelum tanggal akhir",
    path: ["to"],
  });
/** Periode bawaan: 12 bulan terakhir. */
const period = (q: { from?: string; to?: string }) => {
  const today = businessToday();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from: q.from ?? d.toISOString().slice(0, 10), to: q.to ?? today };
};
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Rantai pasok: pengiriman ke pelanggan tepat waktu & tepat jumlah (OTIF), kinerja pemasok (tepat waktu, tepat
 * jumlah, lolos mutu, lead time aktual vs rencana), dan umur persediaan & stok mati.
 */
@Controller("flow/supply")
export class FlowSupplyController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get("deliveries")
  @RequirePermission("inventory.read")
  deliveries(@Query() query: unknown) {
    const q = parse(querySchema, query);
    const { from, to } = period(q);
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const today = businessToday();
      const rows = await tx.execute<{
        id: string;
        name: string;
        partner: string | null;
        scheduled: string;
        done: string;
        month: string;
        on_time: boolean;
        in_full: boolean | null;
      }>(sql`
        select t.id, t.name, pa.name as partner, t.scheduled_date::text as scheduled,
          t.date_done::date::text as done, to_char(t.date_done::date, 'YYYY-MM') as month,
          t.date_done::date <= t.scheduled_date + ${q.tolerance}::int as on_time,
          bool_and(mv.quantity_done >= mv.quantity) filter (where mv.state <> 'cancel') as in_full
        from stock_pickings t
        join stock_moves mv on mv.picking_id = t.id
        left join partners pa on pa.id = t.partner_id
        where t.company_id = ${c} and t.picking_type = 'outgoing' and t.return_of_id is null and t.state = 'done'
          and t.date_done::date between ${from} and ${to}
        group by t.id, pa.name`);
      const list = [...rows].map((r) => ({ ...r, onTime: !!r.on_time, inFull: r.in_full !== false }));
      const byCustomer = new Map<string, typeof list>();
      for (const r of list) {
        const k = r.partner ?? "—";
        byCustomer.set(k, [...(byCustomer.get(k) ?? []), r]);
      }
      const open = await tx.execute<{
        id: string;
        name: string;
        partner: string | null;
        scheduled: string;
      }>(sql`
        select t.id, t.name, pa.name as partner, t.scheduled_date::text as scheduled
        from stock_pickings t left join partners pa on pa.id = t.partner_id
        where t.company_id = ${c} and t.picking_type = 'outgoing' and t.state not in ('done', 'cancel')
          and t.scheduled_date < ${today}
        order by t.scheduled_date limit 50`);
      return {
        from,
        to,
        tolerance: q.tolerance,
        summary: otif(list),
        byMonth: otifByMonth(list),
        customers: [...byCustomer.entries()]
          .map(([partner, l]) => ({ partner, ...otif(l) }))
          .filter((x) => x.count >= 3)
          .sort((a, b) => (a.otif ?? 0) - (b.otif ?? 0) || b.count - a.count)
          .slice(0, 15),
        late: list
          .filter((r) => !r.onTime || !r.inFull)
          .sort((a, b) => b.done.localeCompare(a.done))
          .slice(0, 20)
          .map((r) => ({
            id: r.id,
            name: r.name,
            partner: r.partner,
            scheduled: r.scheduled,
            done: r.done,
            daysLate: Math.max(0, Math.round((Date.parse(r.done) - Date.parse(r.scheduled)) / 864e5)),
            onTime: r.onTime,
            inFull: r.inFull,
            href: recordHref("stock_picking", r.id),
          })),
        openLate: [...open].map((r) => ({
          ...r,
          daysLate: Math.round((Date.parse(today) - Date.parse(r.scheduled)) / 864e5),
          href: recordHref("stock_picking", r.id),
        })),
      };
    });
  }

  @Get("suppliers")
  @RequirePermission("purchase.read")
  suppliers(@Query() query: unknown) {
    const q = parse(querySchema, query);
    const { from, to } = period(q);
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const receipts = await tx.execute<{
        partner_id: string | null;
        partner: string | null;
        on_time: boolean;
        in_full: boolean | null;
        lead: number | null;
      }>(sql`
        select coalesce(t.partner_id, p.partner_id) as partner_id, pa.name as partner,
          t.date_done::date <= coalesce(p.date_planned::date, t.scheduled_date) + ${q.tolerance}::int as on_time,
          bool_and(mv.quantity_done >= mv.quantity) filter (where mv.state <> 'cancel') as in_full,
          (t.date_done::date - p.date_order) as lead
        from stock_pickings t
        join stock_moves mv on mv.picking_id = t.id
        left join purchase_orders p on p.id = t.purchase_order_id
        left join partners pa on pa.id = coalesce(t.partner_id, p.partner_id)
        where t.company_id = ${c} and t.picking_type = 'incoming' and t.return_of_id is null and t.state = 'done'
          and t.date_done::date between ${from} and ${to}
        group by t.id, p.id, pa.name`);
      const qc = await tx.execute<{ partner_id: string | null; passed: string; failed: string }>(sql`
        select coalesce(q.partner_id, t.partner_id) as partner_id,
          count(*) filter (where q.state = 'passed') as passed,
          count(*) filter (where q.state in ('failed', 'conditional')) as failed
        from quality_checks q left join stock_pickings t on t.id = q.picking_id
        where q.company_id = ${c} and q.picking_id is not null and q.state <> 'pending'
          and q.decided_at::date between ${from} and ${to}
        group by 1`);
      const planned = await tx.execute<{ partner_id: string; delay: string }>(sql`
        select s.partner_id, avg(s.delay_days) as delay from product_suppliers s
        where s.partner_id is not null group by 1`);
      const spend = await tx.execute<{ partner_id: string; amount: string; orders: string }>(sql`
        select p.partner_id, sum(p.amount_untaxed) as amount, count(*) as orders from purchase_orders p
        where p.company_id = ${c} and p.state = 'purchase' and p.date_order between ${from} and ${to}
        group by 1`);
      const qcBy = new Map([...qc].map((r) => [r.partner_id ?? "", r]));
      const planBy = new Map([...planned].map((r) => [r.partner_id, num(r.delay)]));
      const spendBy = new Map([...spend].map((r) => [r.partner_id, r]));
      type Receipt = (typeof receipts)[number];
      const groups = new Map<string, { partner: string; rows: Receipt[] }>();
      for (const r of receipts) {
        const k = r.partner_id ?? "";
        const g = groups.get(k) ?? { partner: r.partner ?? "—", rows: [] };
        g.rows.push(r);
        groups.set(k, g);
      }
      const items = [...groups.entries()].map(([id, g]) => {
        const rows = g.rows;
        const onTime = pct(rows.filter((r) => r.on_time).length, rows.length);
        const inFull = pct(rows.filter((r) => r.in_full !== false).length, rows.length);
        const qcRow = qcBy.get(id);
        const checked = qcRow ? num(qcRow.passed) + num(qcRow.failed) : 0;
        const qcPass = qcRow ? pct(num(qcRow.passed), checked) : null;
        const leads = rows.map((r) => r.lead).filter((x): x is number => x !== null);
        const s = spendBy.get(id);
        return {
          partnerId: id || null,
          partner: g.partner,
          receipts: rows.length,
          onTime,
          inFull,
          qcPass,
          qcChecked: checked,
          leadActual: leads.length
            ? Math.round((leads.reduce((a, b) => a + num(b), 0) / leads.length) * 10) / 10
            : null,
          leadPlanned: planBy.has(id) ? Math.round(planBy.get(id)! * 10) / 10 : null,
          spend: s ? num(s.amount) : 0,
          orders: s ? num(s.orders) : 0,
          score: supplierScore({ onTime, inFull, qcPass }),
        };
      });
      items.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || b.spend - a.spend);
      const all = [...receipts];
      return {
        from,
        to,
        tolerance: q.tolerance,
        summary: {
          suppliers: items.length,
          receipts: all.length,
          onTime: pct(all.filter((r) => r.on_time).length, all.length),
          inFull: pct(all.filter((r) => r.in_full !== false).length, all.length),
        },
        items,
      };
    });
  }

  /** Umur persediaan dari lapisan valuasi yang masih bersisa, stok mati, dan perputaran persediaan 12 bulan. */
  @Get("stock")
  @RequirePermission("inventory.read")
  stock() {
    return this.tenantDb.run(async (tx) => {
      const c = currentContext().companyId;
      const today = businessToday();
      // Tanggal masuk lapisan = tanggal pergerakan stoknya (data impor/riwayat), bukan waktu pembuatan baris.
      const layers = await tx.execute<{ age: number; qty: string; value: string }>(sql`
        select (${today}::date - coalesce(mv.date, v.created_at)::date) as age, v.remaining_qty as qty,
          v.remaining_value as value
        from stock_valuation_layers v left join stock_moves mv on mv.id = v.stock_move_id
        where v.company_id = ${c} and v.remaining_qty > 0`);
      const products = await tx.execute<{
        id: string;
        sku: string | null;
        name: string;
        qty: string;
        value: string;
        oldest: string;
        last_out: string | null;
      }>(sql`
        -- Pengeluaran terakhir: lapisan valuasi keluar (pengiriman, pemakaian produksi, scrap, dll.).
        with out as (
          select v.product_id, max(coalesce(mv.date, v.created_at))::date::text as last_out
          from stock_valuation_layers v left join stock_moves mv on mv.id = v.stock_move_id
          where v.company_id = ${c} and v.quantity < 0
          group by 1
        )
        select pr.id, pr.sku, pr.name, sum(v.remaining_qty) as qty, sum(v.remaining_value) as value,
          min(coalesce(mv.date, v.created_at))::date::text as oldest, max(o.last_out) as last_out
        from stock_valuation_layers v join products pr on pr.id = v.product_id
        left join stock_moves mv on mv.id = v.stock_move_id
        left join out o on o.product_id = pr.id
        where v.company_id = ${c} and v.remaining_qty > 0
        group by pr.id, pr.sku, pr.name`);
      // Perputaran: nilai keluar 12 bulan ÷ rata-rata nilai persediaan akhir bulan.
      const monthly = await tx.execute<{ month: string; inflow: string; outflow: string }>(sql`
        select to_char(date_trunc('month', coalesce(mv.date, v.created_at)), 'YYYY-MM') as month,
          sum(case when v.value > 0 then v.value else 0 end) as inflow,
          sum(case when v.value < 0 then -v.value else 0 end) as outflow
        from stock_valuation_layers v left join stock_moves mv on mv.id = v.stock_move_id
        where v.company_id = ${c} and coalesce(mv.date, v.created_at) < (${today}::date + 1)
        group by 1 order by 1`);
      const months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - 11 + i);
        return d.toISOString().slice(0, 7);
      });
      const valueAt = (m: string) =>
        [...monthly].filter((r) => r.month <= m).reduce((s, r) => s + num(r.inflow) - num(r.outflow), 0);
      const avgInventory = months.reduce((s, m) => s + valueAt(m), 0) / months.length;
      const outflow12 = [...monthly]
        .filter((r) => r.month >= months[0]!)
        .reduce((s, r) => s + num(r.outflow), 0);
      const turnover = avgInventory > 0 ? Math.round((outflow12 / avgInventory) * 100) / 100 : null;
      const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 864e5).toISOString().slice(0, 10);
      const dead = [...products]
        .filter((p) => num(p.value) > 0 && p.oldest <= cutoff && (!p.last_out || p.last_out < cutoff))
        .sort((a, b) => num(b.value) - num(a.value));
      const total = [...products].reduce((s, p) => s + num(p.value), 0);
      return {
        today,
        value: Math.round(total * 100) / 100,
        aging: stockAging(
          [...layers].map((l) => ({ ageDays: Number(l.age), quantity: num(l.qty), value: num(l.value) })),
        ),
        turnover,
        daysOfInventory: turnover ? Math.round((365 / turnover) * 10) / 10 : null,
        deadStock: {
          count: dead.length,
          value: Math.round(dead.reduce((s, p) => s + num(p.value), 0) * 100) / 100,
          items: dead.slice(0, 20).map((p) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            quantity: num(p.qty),
            value: num(p.value),
            oldest: p.oldest,
            lastOut: p.last_out,
            href: recordHref("product", p.id),
          })),
        },
      };
    });
  }
}
