import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, schema, sql, type Db } from "@erp/db";
import { PROFIT_LOSS_GROUPS, PROFIT_LOSS_TYPES, type budgetSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { assertCompanyAccounts, assertDimensions } from "./context.js";

type BudgetInput = z.infer<typeof budgetSchema>;
const INCOME_TYPES: readonly string[] = [...PROFIT_LOSS_GROUPS.income, ...PROFIT_LOSS_GROUPS.otherIncome];

@Injectable()
export class BudgetService {
  list(tx: Db) {
    return tx
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.companyId, currentContext().companyId))
      .orderBy(desc(schema.budgets.dateFrom));
  }

  async get(tx: Db, id: string) {
    const [budget] = await tx
      .select()
      .from(schema.budgets)
      .where(and(eq(schema.budgets.id, id), eq(schema.budgets.companyId, currentContext().companyId)));
    if (!budget) throw new NotFoundException("Anggaran tidak ditemukan");
    const lines = await tx
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.budgetId, id))
      .orderBy(asc(schema.budgetLines.id));
    return { ...budget, lines };
  }

  async save(tx: Db, input: BudgetInput, id?: string) {
    const companyId = currentContext().companyId;
    if (input.dateTo < input.dateFrom) throw new BadRequestException("Tanggal akhir sebelum tanggal awal");
    const accounts = await assertCompanyAccounts(
      tx,
      companyId,
      input.lines.map((l, i) => ({ path: `lines.${i}.accountId`, id: l.accountId })),
    );
    input.lines.forEach((l, i) => {
      if (!PROFIT_LOSS_TYPES.includes(accounts.get(l.accountId)!.accountType)) {
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [{ path: `lines.${i}.accountId`, message: "Anggaran hanya untuk akun pendapatan/beban" }],
        });
      }
    });
    await assertDimensions(tx, companyId, input.lines);

    let budgetId = id;
    if (id) {
      this.assertManual(await this.get(tx, id));
      await tx
        .update(schema.budgets)
        .set({ name: input.name, dateFrom: input.dateFrom, dateTo: input.dateTo, updatedAt: sql`now()` })
        .where(eq(schema.budgets.id, id));
      await tx.delete(schema.budgetLines).where(eq(schema.budgetLines.budgetId, id));
    } else {
      const [row] = await tx
        .insert(schema.budgets)
        .values({ companyId, name: input.name, dateFrom: input.dateFrom, dateTo: input.dateTo })
        .returning({ id: schema.budgets.id });
      budgetId = row!.id;
    }
    if (input.lines.length) {
      await tx.insert(schema.budgetLines).values(
        input.lines.map((l) => ({
          budgetId: budgetId!,
          accountId: l.accountId,
          amount: l.amount,
          businessUnitId: l.businessUnitId ?? null,
          branchId: l.branchId ?? null,
        })),
      );
    }
    return this.get(tx, budgetId!);
  }

  async remove(tx: Db, id: string) {
    this.assertManual(await this.get(tx, id));
    await tx.delete(schema.budgets).where(eq(schema.budgets.id, id));
  }

  /** Anggaran dari Man Power Planning dibangun ulang otomatis; tidak boleh diubah manual. */
  private assertManual(budget: { source: string }) {
    if (budget.source === "manpower")
      throw new BadRequestException("Anggaran ini dikelola dari Man Power Planning (SDM); ubah lewat MPP");
  }

  /** Anggaran vs realisasi per baris anggaran (realisasi dari entri posted, tanpa entri penutup). */
  async report(tx: Db, id: string) {
    const budget = await this.get(tx, id);
    const lines = [];
    const totals = {
      income: { budget: new Decimal(0), actual: new Decimal(0) },
      expense: { budget: new Decimal(0), actual: new Decimal(0) },
    };
    for (const line of budget.lines) {
      const [account] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, line.accountId));
      const [row] = await tx.execute<{ balance: string }>(sql`
        select coalesce(sum(l.balance), 0) as balance
        from account_move_lines l join account_moves m on m.id = l.move_id
        where m.state = 'posted' and m.closing_year is null and l.company_id = ${budget.companyId}
          and l.account_id = ${line.accountId} and m.date between ${budget.dateFrom} and ${budget.dateTo}
          ${line.businessUnitId ? sql`and l.business_unit_id = ${line.businessUnitId}` : sql``}
          ${line.branchId ? sql`and l.branch_id = ${line.branchId}` : sql``}`);
      const income = INCOME_TYPES.includes(account!.accountType);
      const actual = new Decimal(row?.balance ?? 0).times(income ? -1 : 1);
      const planned = new Decimal(line.amount);
      const bucket = income ? totals.income : totals.expense;
      bucket.budget = bucket.budget.plus(planned);
      bucket.actual = bucket.actual.plus(actual);
      lines.push({
        id: line.id,
        accountId: account!.id,
        code: account!.code,
        name: account!.name,
        kind: income ? "income" : "expense",
        businessUnitId: line.businessUnitId,
        branchId: line.branchId,
        budget: planned.toFixed(2),
        actual: actual.toFixed(2),
        variance: actual.minus(planned).toFixed(2),
        achievement: planned.isZero() ? null : actual.div(planned).times(100).toDecimalPlaces(1).toNumber(),
      });
    }
    lines.sort((a, b) => a.code.localeCompare(b.code));
    const out = (t: { budget: Decimal; actual: Decimal }) => ({
      budget: t.budget.toFixed(2),
      actual: t.actual.toFixed(2),
      variance: t.actual.minus(t.budget).toFixed(2),
    });
    return {
      budget: { id: budget.id, name: budget.name, dateFrom: budget.dateFrom, dateTo: budget.dateTo },
      lines,
      totals: { income: out(totals.income), expense: out(totals.expense) },
    };
  }
}
