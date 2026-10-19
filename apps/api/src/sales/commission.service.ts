import { Injectable } from "@nestjs/common";
import { and, eq, schema, sql, type Db } from "@erp/db";
import { hasPermission, type commissionReportSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { loadBooks } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import type { Sheet } from "../accounting/report-export.js";

type Plan = typeof schema.commissionPlans.$inferSelect;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/**
 * Komisi penjual dari faktur penjualan terposting (nota kredit mengurangi). Dasar komisi = penjualan bersih
 * sebelum pajak dalam mata uang perusahaan. Penjual diambil dari pesanan penjualan faktur, atau penjual
 * pelanggan. Aturan: khusus penjual → tim pesanan/tim penjual → bawaan perusahaan.
 */
@Injectable()
export class CommissionService {
  async report(tx: Db, input: z.infer<typeof commissionReportSchema>) {
    const ctx = currentContext();
    const books = await loadBooks(tx, ctx.companyId);
    const plans = await tx
      .select()
      .from(schema.commissionPlans)
      .where(
        and(eq(schema.commissionPlans.companyId, ctx.companyId), eq(schema.commissionPlans.active, true)),
      );
    const teams = await tx
      .select({
        id: schema.salesTeams.id,
        leaderId: schema.salesTeams.leaderId,
        memberIds: schema.salesTeams.memberIds,
      })
      .from(schema.salesTeams)
      .where(eq(schema.salesTeams.active, true));
    const own = !hasPermission(ctx.permissions, "sales.all");
    const userFilter = own ? ctx.userId : input.userId;

    const rows = await tx.execute<{
      id: string;
      name: string;
      date: string;
      move_type: "out_invoice" | "out_refund";
      payment_state: string;
      partner_name: string;
      user_id: string | null;
      user_name: string | null;
      team_id: string | null;
      base: string;
    }>(sql`
      with inv as (
        select m.id, m.name, m.date, m.move_type, m.payment_state, p.name as partner_name,
          coalesce(
            (select so.user_id from account_move_lines l join sale_order_lines sol on sol.id = l.sale_line_id
               join sale_orders so on so.id = sol.order_id where l.move_id = m.id and so.user_id is not null limit 1),
            p.salesperson_id) as user_id,
          (select so.team_id from account_move_lines l join sale_order_lines sol on sol.id = l.sale_line_id
             join sale_orders so on so.id = sol.order_id where l.move_id = m.id and so.team_id is not null limit 1)
            as team_id,
          -(select coalesce(sum(l.balance), 0) from account_move_lines l
              where l.move_id = m.id and l.display_type = 'product') as base
        from account_moves m
        join partners p on p.id = m.partner_id
        where m.company_id = ${ctx.companyId} and m.state = 'posted'
          and m.move_type in ('out_invoice', 'out_refund')
          and m.date between ${input.dateFrom} and ${input.dateTo}
      )
      select inv.id, inv.name, inv.date::text as date, inv.move_type, inv.payment_state, inv.partner_name,
        inv.user_id, u.name as user_name, inv.team_id, inv.base::text as base
      from inv left join users u on u.id = inv.user_id
      where ${userFilter ? sql`inv.user_id = ${userFilter}` : sql`true`}
      order by u.name nulls last, inv.date, inv.name`);

    const planFor = (userId: string | null, teamId: string | null): Plan | undefined => {
      const byUser = userId ? plans.find((p) => p.userId === userId) : undefined;
      if (byUser) return byUser;
      const team =
        teamId ??
        (userId ? teams.find((t) => t.leaderId === userId || t.memberIds.includes(userId))?.id : undefined);
      const byTeam = team ? plans.find((p) => !p.userId && p.teamId === team) : undefined;
      return byTeam ?? plans.find((p) => !p.userId && !p.teamId);
    };

    const lines = rows.map((r) => {
      const plan = planFor(r.user_id, r.team_id);
      // Dasar "lunas": hanya faktur yang sudah lunas (atau dibalik, yang berpasangan dengan nota kreditnya).
      const eligible = plan && (plan.basis === "invoiced" || ["paid", "reversed"].includes(r.payment_state));
      const base = d(r.base);
      const commission = eligible
        ? base.times(plan.rate).div(100).toDecimalPlaces(books.decimals, Decimal.ROUND_HALF_UP)
        : d(0);
      return {
        moveId: r.id,
        name: r.name,
        date: r.date,
        moveType: r.move_type,
        paymentState: r.payment_state,
        partnerName: r.partner_name,
        userId: r.user_id,
        userName: r.user_name,
        base: base.toFixed(2),
        planName: plan?.name ?? null,
        rate: plan ? d(plan.rate).toString() : null,
        basis: plan?.basis ?? null,
        eligible: Boolean(eligible),
        commission: commission.toFixed(2),
      };
    });

    const byUser = new Map<
      string,
      { userId: string | null; userName: string | null; base: Decimal; commission: Decimal; invoices: number }
    >();
    for (const l of lines) {
      const key = l.userId ?? "";
      const s = byUser.get(key) ?? {
        userId: l.userId,
        userName: l.userName,
        base: d(0),
        commission: d(0),
        invoices: 0,
      };
      s.base = s.base.plus(l.base);
      s.commission = s.commission.plus(l.commission);
      s.invoices++;
      byUser.set(key, s);
    }
    const salespeople = [...byUser.values()].map((s) => ({
      ...s,
      base: s.base.toFixed(2),
      commission: s.commission.toFixed(2),
    }));
    return {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      currencyCode: books.currencyCode,
      salespeople,
      lines,
      total: lines.reduce((s, l) => s.plus(l.commission), d(0)).toFixed(2),
    };
  }

  /** Lembar ekspor: ringkasan per penjual dan rincian faktur. */
  sheets(data: Awaited<ReturnType<CommissionService["report"]>>): Sheet[] {
    const subtitle = `Periode ${data.dateFrom} s.d. ${data.dateTo} (${data.currencyCode})`;
    return [
      {
        title: "Komisi per Penjual",
        subtitle,
        columns: [
          { header: "Penjual", width: 30 },
          { header: "Jumlah faktur", width: 14, numeric: true },
          { header: "Penjualan bersih", width: 20, numeric: true },
          { header: "Komisi", width: 18, numeric: true },
        ],
        rows: [
          ...data.salespeople.map((s) => ({
            cells: [s.userName ?? "—", s.invoices, Number(s.base), Number(s.commission)],
          })),
          { cells: ["Total", null, null, Number(data.total)], bold: true },
        ],
      },
      {
        title: "Rincian Komisi",
        subtitle,
        columns: [
          { header: "Penjual", width: 24 },
          { header: "Faktur", width: 20 },
          { header: "Tanggal", width: 12 },
          { header: "Pelanggan", width: 28 },
          { header: "Aturan", width: 20 },
          { header: "Tarif %", width: 10, numeric: true },
          { header: "Penjualan bersih", width: 18, numeric: true },
          { header: "Komisi", width: 16, numeric: true },
        ],
        rows: data.lines.map((l) => ({
          cells: [
            l.userName ?? "—",
            l.name,
            l.date,
            l.partnerName,
            l.planName ?? "—",
            l.rate === null ? null : Number(l.rate),
            Number(l.base),
            Number(l.commission),
          ],
        })),
      },
    ];
  }
}
