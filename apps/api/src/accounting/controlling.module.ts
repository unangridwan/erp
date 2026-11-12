import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { and, eq, schema, sql, type Db } from "@erp/db";
import {
  budgetVariance,
  controllingReportQuery,
  costCenterSchema,
  descendantIds,
  profitCenterSchema,
  profitCenterStatement,
  PROFIT_CENTER_KEYS,
  rollupTree,
  wouldCycle,
  type Amounts,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { fieldError } from "./context.js";

type Query = z.infer<typeof controllingReportQuery>;
type CenterTable = typeof schema.costCenters | typeof schema.profitCenters;

const EXPENSE_TYPES = ["expense", "expense_direct_cost", "expense_depreciation", "expense_other"];
const PL_TYPES = ["income", "income_other", ...EXPENSE_TYPES];

/** Induk harus satu perusahaan dan tidak membentuk siklus; profit center cost center juga satu perusahaan. */
const validateCenter =
  (table: CenterTable) => async (tx: Db, values: Record<string, unknown>, id?: string) => {
    const companyId = String(values.companyId ?? "");
    const parentId = values.parentId as string | null | undefined;
    if (parentId) {
      const nodes = await tx
        .select({ id: table.id, parentId: table.parentId, code: table.code })
        .from(table)
        .where(eq(table.companyId, companyId));
      if (!nodes.some((n) => n.id === parentId))
        throw fieldError("parentId", "Induk tidak ditemukan di perusahaan ini");
      if (id && wouldCycle(nodes, id, parentId))
        throw fieldError("parentId", "Induk tidak boleh dirinya sendiri atau turunannya");
    }
    const profitCenterId = values.profitCenterId as string | null | undefined;
    if (profitCenterId) {
      const [pc] = await tx
        .select({ id: schema.profitCenters.id })
        .from(schema.profitCenters)
        .where(
          and(eq(schema.profitCenters.id, profitCenterId), eq(schema.profitCenters.companyId, companyId)),
        );
      if (!pc) throw fieldError("profitCenterId", "Profit center tidak ditemukan di perusahaan ini");
    }
  };

/** Center yang sudah dipakai jurnal atau punya turunan tidak bisa dihapus; nonaktifkan saja. */
const guardDelete =
  (table: CenterTable, column: "cost_center_id" | "profit_center_id") =>
  async (tx: Db, row: Record<string, unknown>) => {
    const id = String(row.id);
    const [child] = await tx.select({ id: table.id }).from(table).where(eq(table.parentId, id)).limit(1);
    if (child) throw new BadRequestException("Masih punya turunan; pindahkan atau hapus turunannya dulu");
    const [used] = await tx.execute<{ n: number }>(
      sql`select 1 as n from account_move_lines where ${sql.raw(column)} = ${id} limit 1`,
    );
    if (used) throw new BadRequestException("Sudah dipakai di jurnal; nonaktifkan saja");
  };

export const ProfitCentersController = createCrudController({
  path: "profit-centers",
  model: "profit_center",
  table: schema.profitCenters,
  schema: profitCenterSchema,
  read: "accounting.read",
  write: "accounting.manage",
  searchColumns: [schema.profitCenters.code, schema.profitCenters.name],
  orderBy: schema.profitCenters.code,
  companyColumn: schema.profitCenters.companyId,
  perCompany: true,
  refs: { parentId: schema.profitCenters, managerEmployeeId: schema.employees },
  beforeSave: validateCenter(schema.profitCenters),
  beforeDelete: guardDelete(schema.profitCenters, "profit_center_id"),
});

export const CostCentersController = createCrudController({
  path: "cost-centers",
  model: "cost_center",
  table: schema.costCenters,
  schema: costCenterSchema,
  read: "accounting.read",
  write: "accounting.manage",
  searchColumns: [schema.costCenters.code, schema.costCenters.name],
  orderBy: schema.costCenters.code,
  companyColumn: schema.costCenters.companyId,
  perCompany: true,
  refs: {
    parentId: schema.costCenters,
    profitCenterId: schema.profitCenters,
    managerEmployeeId: schema.employees,
  },
  beforeSave: validateCenter(schema.costCenters),
  beforeDelete: guardDelete(schema.costCenters, "cost_center_id"),
});

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

const dayMs = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;

/** Laporan controlling perusahaan aktif: biaya per cost center (vs anggaran) dan laba rugi per profit center. */
@Injectable()
export class ControllingService {
  private base(q: Query, companyId: string) {
    return sql`m.state = 'posted' and m.closing_year is null and l.company_id = ${companyId}
      and m.date between ${q.dateFrom} and ${q.dateTo}
      ${q.branchId ? sql`and l.branch_id = ${q.branchId}` : sql``}`;
  }

  private assertRange(q: Query) {
    if (q.dateFrom > q.dateTo) throw fieldError("dateFrom", "Tanggal awal setelah tanggal akhir");
  }

  /**
   * Anggaran beban per cost center untuk periode laporan: baris anggaran ber-cost center, diprorata menurut
   * jumlah hari yang beririsan dengan periode.
   */
  private async budgets(tx: Db, companyId: string, q: Query) {
    const rows = await tx.execute<{
      cost_center_id: string;
      amount: string;
      date_from: string;
      date_to: string;
    }>(sql`
      select bl.cost_center_id, bl.amount, b.date_from::text, b.date_to::text
      from budget_lines bl join budgets b on b.id = bl.budget_id
      join accounts a on a.id = bl.account_id
      where b.company_id = ${companyId} and bl.cost_center_id is not null
        and a.account_type in (${list(EXPENSE_TYPES)})
        and b.date_from <= ${q.dateTo} and b.date_to >= ${q.dateFrom}`);
    const out = new Map<string, Decimal>();
    for (const r of rows) {
      const from = r.date_from > q.dateFrom ? r.date_from : q.dateFrom;
      const to = r.date_to < q.dateTo ? r.date_to : q.dateTo;
      const share = new Decimal(days(from, to)).div(days(r.date_from, r.date_to));
      out.set(
        r.cost_center_id,
        (out.get(r.cost_center_id) ?? new Decimal(0)).plus(new Decimal(r.amount).times(share)),
      );
    }
    return out;
  }

  async costCenters(tx: Db, input: Query) {
    this.assertRange(input);
    const companyId = currentContext().companyId;
    const centers = await tx
      .select()
      .from(schema.costCenters)
      .where(eq(schema.costCenters.companyId, companyId));
    const actual = await tx.execute<{
      cost_center_id: string | null;
      account_type: string;
      balance: string;
    }>(sql`
      select l.cost_center_id, a.account_type, sum(l.balance)::text as balance
      from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
      where ${this.base(input, companyId)} and a.account_type in (${list(EXPENSE_TYPES)})
      group by l.cost_center_id, a.account_type`);
    const budgets = await this.budgets(tx, companyId, input);
    const own = new Map<string, Amounts>();
    let unassigned = new Decimal(0);
    for (const r of actual) {
      if (!r.cost_center_id) {
        unassigned = unassigned.plus(r.balance);
        continue;
      }
      const cur = own.get(r.cost_center_id) ?? { actual: "0", budget: "0" };
      cur.actual = new Decimal(cur.actual!).plus(r.balance).toFixed(2);
      own.set(r.cost_center_id, cur);
    }
    for (const [id, amount] of budgets) {
      const cur = own.get(id) ?? { actual: "0", budget: "0" };
      // Anggaran prorata dibulatkan ke rupiah penuh.
      cur.budget = amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(2);
      own.set(id, cur);
    }
    const rows = rollupTree(centers, own, ["actual", "budget"]).map((r) => ({
      id: r.node.id,
      code: r.node.code,
      name: r.node.name,
      category: r.node.category,
      profitCenterId: r.node.profitCenterId,
      active: r.node.active,
      depth: r.depth,
      hasChildren: r.hasChildren,
      ownActual: r.own.actual!,
      actual: r.total.actual!,
      budget: r.total.budget!,
      ...budgetVariance(r.total.actual!, r.total.budget!),
    }));
    const roots = rows.filter((r) => r.depth === 0);
    const assigned = roots.reduce((s, r) => s.plus(r.actual), new Decimal(0));
    const budget = roots.reduce((s, r) => s.plus(r.budget), new Decimal(0));
    return {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      rows,
      unassigned: unassigned.toFixed(2),
      total: { actual: assigned.plus(unassigned).toFixed(2), budget: budget.toFixed(2) },
    };
  }

  /** Rincian per akun untuk satu cost center (beserta turunannya). */
  async costCenterAccounts(tx: Db, id: string, input: Query) {
    this.assertRange(input);
    const companyId = currentContext().companyId;
    const centers = await tx
      .select({
        id: schema.costCenters.id,
        parentId: schema.costCenters.parentId,
        code: schema.costCenters.code,
      })
      .from(schema.costCenters)
      .where(eq(schema.costCenters.companyId, companyId));
    if (!centers.some((c) => c.id === id)) throw new NotFoundException("Cost center tidak ditemukan");
    const ids = descendantIds(centers, id);
    const rows = await tx.execute<{
      id: string;
      code: string;
      name: string;
      account_type: string;
      balance: string;
    }>(sql`
      select a.id, a.code, a.name, a.account_type, sum(l.balance)::text as balance
      from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
      where ${this.base(input, companyId)} and a.account_type in (${list(EXPENSE_TYPES)})
        and l.cost_center_id in (${list(ids)})
      group by a.id, a.code, a.name, a.account_type
      order by a.code`);
    return rows.map((r) => ({
      accountId: r.id,
      code: r.code,
      name: r.name,
      accountType: r.account_type,
      actual: new Decimal(r.balance).toFixed(2),
    }));
  }

  async profitCenters(tx: Db, input: Query) {
    this.assertRange(input);
    const companyId = currentContext().companyId;
    const centers = await tx
      .select()
      .from(schema.profitCenters)
      .where(eq(schema.profitCenters.companyId, companyId));
    const balances = await tx.execute<{
      profit_center_id: string | null;
      account_type: string;
      balance: string;
    }>(sql`
      select l.profit_center_id, a.account_type, sum(l.balance)::text as balance
      from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
      where ${this.base(input, companyId)} and a.account_type in (${list(PL_TYPES)})
      group by l.profit_center_id, a.account_type`);
    const byCenter = new Map<string, Record<string, string>>();
    for (const r of balances) {
      const key = r.profit_center_id ?? "";
      byCenter.set(key, { ...(byCenter.get(key) ?? {}), [r.account_type]: r.balance });
    }
    const own = new Map<string, Amounts>();
    for (const [key, types] of byCenter) {
      if (!key) continue;
      const { margin: _m, ...amounts } = profitCenterStatement(types);
      own.set(key, amounts);
    }
    const keys = [...PROFIT_CENTER_KEYS];
    const withMargin = (t: Amounts) => {
      const revenue = new Decimal(t.revenue ?? 0);
      return {
        ...t,
        margin: revenue.isZero()
          ? null
          : new Decimal(t.netProfit ?? 0).div(revenue).times(100).toDecimalPlaces(1).toNumber(),
      };
    };
    const rows = rollupTree(centers, own, keys).map((r) => ({
      id: r.node.id,
      code: r.node.code,
      name: r.node.name,
      active: r.node.active,
      depth: r.depth,
      hasChildren: r.hasChildren,
      ...withMargin(r.total),
    }));
    const unassigned = profitCenterStatement(byCenter.get("") ?? {});
    const total = profitCenterStatement(
      balances.reduce<Record<string, Decimal>>((acc, r) => {
        acc[r.account_type] = (acc[r.account_type] ?? new Decimal(0)).plus(r.balance);
        return acc;
      }, {}),
    );
    return { dateFrom: input.dateFrom, dateTo: input.dateTo, rows, unassigned, total };
  }
}

@Controller("controlling")
export class ControllingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ControllingService) private readonly service: ControllingService,
  ) {}

  @Get("cost-centers")
  @RequirePermission("accounting.read")
  costCenters(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.service.costCenters(tx, parse(controllingReportQuery, query)));
  }

  @Get("cost-centers/:id/accounts")
  @RequirePermission("accounting.read")
  costCenterAccounts(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.tenantDb.run((tx) =>
      this.service.costCenterAccounts(tx, id, parse(controllingReportQuery, query)),
    );
  }

  @Get("profit-centers")
  @RequirePermission("accounting.read")
  profitCenters(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.service.profitCenters(tx, parse(controllingReportQuery, query)));
  }
}
