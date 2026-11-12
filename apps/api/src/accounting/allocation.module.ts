import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db } from "@erp/db";
import {
  allocateAmount,
  allocationCycleSchema,
  allocationRunSchema,
  monthEnd,
  statisticalKeySchema,
  statisticalKeyValuesSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { assertCompanyAccounts, assertCompanyJournal, fieldError } from "./context.js";
import { employeeCostCenters } from "./cost-center-source.js";
import { MoveService } from "./move.service.js";

type CycleInput = z.infer<typeof allocationCycleSchema>;
type Cycle = typeof schema.allocationCycles.$inferSelect;
const EXPENSE_TYPES = ["expense", "expense_direct_cost", "expense_depreciation", "expense_other"];
const C = schema.allocationCycles;
const K = schema.statisticalKeys;
const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
const periodQuery = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Format bulan YYYY-MM")
    .transform((v) => `${v}-01`),
});

export const StatisticalKeysController = createCrudController({
  path: "statistical-keys",
  model: "statistical_key",
  table: K,
  schema: statisticalKeySchema,
  read: "accounting.read",
  write: "accounting.manage",
  searchColumns: [K.code, K.name],
  orderBy: K.code,
  companyColumn: K.companyId,
  perCompany: true,
  beforeDelete: async (tx, row) => {
    const [used] = await tx
      .select({ id: C.id })
      .from(C)
      .where(eq(C.keyId, String(row.id)))
      .limit(1);
    if (used) throw new BadRequestException("Kunci statistik dipakai siklus alokasi; nonaktifkan saja");
  },
});

export interface Plan {
  cycleId: string;
  code: string;
  name: string;
  sequence: number;
  amount: string;
  status: "ready" | "done" | "empty" | "error";
  message?: string;
  runId?: string;
  accounts: { accountId: string; code: string; name: string; amount: string }[];
  receivers: { costCenterId: string; code: string; name: string; basis: string; amount: string }[];
}

@Injectable()
export class AllocationService {
  constructor(@Inject(MoveService) private readonly moves: MoveService) {}

  private async centers(tx: Db, companyId: string) {
    return tx
      .select({
        id: schema.costCenters.id,
        code: schema.costCenters.code,
        name: schema.costCenters.name,
        active: schema.costCenters.active,
      })
      .from(schema.costCenters)
      .where(eq(schema.costCenters.companyId, companyId));
  }

  // ---- Kunci statistik ----

  /** Nilai kunci per cost center untuk bulan `period`: nilai manual terakhir ≤ bulan itu, atau jumlah karyawan aktif. */
  async keyValues(tx: Db, keyId: string, period: string) {
    const companyId = currentContext().companyId;
    const [key] = await tx
      .select()
      .from(K)
      .where(and(eq(K.id, keyId), eq(K.companyId, companyId)));
    if (!key) throw new NotFoundException("Kunci statistik tidak ditemukan");
    const values = new Map<string, string>();
    if (key.kind === "headcount") {
      const end = monthEnd(period);
      const employees = await tx
        .select({ id: schema.employees.id })
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.companyId, companyId),
            sql`(${schema.employees.joinDate} is null or ${schema.employees.joinDate} <= ${end})`,
            sql`(${schema.employees.resignDate} is null or ${schema.employees.resignDate} >= ${period})`,
            sql`not coalesce(${schema.employees.pendingStart}, false)`,
          ),
        );
      const map = await employeeCostCenters(
        tx,
        employees.map((e) => e.id),
      );
      for (const cc of map.values()) if (cc) values.set(cc, String(Number(values.get(cc) ?? 0) + 1));
    } else {
      const rows = await tx.execute<{ cost_center_id: string; value: string }>(sql`
        select distinct on (cost_center_id) cost_center_id, value::text
        from statistical_key_values
        where key_id = ${keyId} and period <= ${period}
        order by cost_center_id, period desc`);
      for (const r of rows) values.set(r.cost_center_id, r.value);
    }
    const centers = await this.centers(tx, companyId);
    return {
      key,
      period,
      rows: centers
        .filter((c) => c.active || values.has(c.id))
        .sort((a, b) => a.code.localeCompare(b.code, "id", { numeric: true }))
        .map((c) => ({ costCenterId: c.id, code: c.code, name: c.name, value: values.get(c.id) ?? null })),
    };
  }

  async saveKeyValues(tx: Db, keyId: string, body: unknown) {
    const input = parse(statisticalKeyValuesSchema, body);
    const companyId = currentContext().companyId;
    const [key] = await tx
      .select()
      .from(K)
      .where(and(eq(K.id, keyId), eq(K.companyId, companyId)));
    if (!key) throw new NotFoundException("Kunci statistik tidak ditemukan");
    if (key.kind !== "manual")
      throw new BadRequestException("Kunci jumlah karyawan dihitung otomatis dan tidak bisa diisi");
    const centers = new Set((await this.centers(tx, companyId)).map((c) => c.id));
    input.values.forEach((v, i) => {
      if (!centers.has(v.costCenterId))
        throw fieldError(`values.${i}.costCenterId`, "Cost center tidak ditemukan di perusahaan ini");
    });
    for (const v of input.values) {
      await tx
        .insert(schema.statisticalKeyValues)
        .values({ keyId, costCenterId: v.costCenterId, period: input.period, value: v.value })
        .onConflictDoUpdate({
          target: [
            schema.statisticalKeyValues.keyId,
            schema.statisticalKeyValues.costCenterId,
            schema.statisticalKeyValues.period,
          ],
          set: { value: v.value, updatedAt: sql`now()` },
        });
    }
    return this.keyValues(tx, keyId, input.period);
  }

  // ---- Siklus ----

  async listCycles(tx: Db) {
    const companyId = currentContext().companyId;
    const cycles = await tx
      .select()
      .from(C)
      .where(eq(C.companyId, companyId))
      .orderBy(asc(C.sequence), asc(C.code));
    const receivers = cycles.length
      ? await tx
          .select()
          .from(schema.allocationReceivers)
          .where(
            inArray(
              schema.allocationReceivers.cycleId,
              cycles.map((c) => c.id),
            ),
          )
      : [];
    return cycles.map((c) => ({ ...c, receivers: receivers.filter((r) => r.cycleId === c.id) }));
  }

  async getCycle(tx: Db, id: string) {
    const [cycle] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    if (!cycle) throw new NotFoundException("Siklus alokasi tidak ditemukan");
    const receivers = await tx
      .select()
      .from(schema.allocationReceivers)
      .where(eq(schema.allocationReceivers.cycleId, id));
    return { ...cycle, receivers };
  }

  private async validateCycle(tx: Db, companyId: string, input: CycleInput) {
    const centers = await tx
      .select({ id: schema.costCenters.id, active: schema.costCenters.active })
      .from(schema.costCenters)
      .where(eq(schema.costCenters.companyId, companyId));
    const known = new Map(centers.map((c) => [c.id, c.active]));
    if (!known.has(input.sourceCostCenterId))
      throw fieldError("sourceCostCenterId", "Cost center tidak ditemukan di perusahaan ini");
    input.receivers.forEach((r, i) => {
      if (!known.get(r.costCenterId))
        throw fieldError(
          `receivers.${i}.costCenterId`,
          "Cost center tidak ditemukan atau tidak aktif di perusahaan ini",
        );
    });
    if (input.keyId) {
      const [key] = await tx
        .select({ id: K.id })
        .from(K)
        .where(and(eq(K.id, input.keyId), eq(K.companyId, companyId)));
      if (!key) throw fieldError("keyId", "Kunci statistik tidak ditemukan");
    }
    if (input.journalId) await assertCompanyJournal(tx, companyId, input.journalId, ["general"]);
    if (input.accountIds.length)
      await assertCompanyAccounts(
        tx,
        companyId,
        input.accountIds.map((id, i) => ({ path: `accountIds.${i}`, id })),
      );
  }

  private values(input: CycleInput) {
    return {
      code: input.code,
      name: input.name,
      sequence: input.sequence,
      sourceCostCenterId: input.sourceCostCenterId,
      accountIds: input.accountIds,
      method: input.method,
      keyId: input.method === "key" ? (input.keyId ?? null) : null,
      journalId: input.journalId ?? null,
      active: input.active,
      note: input.note ?? null,
    };
  }

  private async saveReceivers(tx: Db, cycleId: string, input: CycleInput) {
    await tx.delete(schema.allocationReceivers).where(eq(schema.allocationReceivers.cycleId, cycleId));
    await tx.insert(schema.allocationReceivers).values(
      input.receivers.map((r) => ({
        cycleId,
        costCenterId: r.costCenterId,
        percent: input.method === "percent" ? String(r.percent) : null,
      })),
    );
  }

  async createCycle(tx: Db, body: unknown) {
    const input = parse(allocationCycleSchema, body);
    const companyId = currentContext().companyId;
    await this.validateCycle(tx, companyId, input);
    const [dup] = await tx
      .select({ id: C.id })
      .from(C)
      .where(and(eq(C.companyId, companyId), eq(C.code, input.code)));
    if (dup) throw fieldError("code", "Kode sudah dipakai");
    const [row] = await tx
      .insert(C)
      .values({ companyId, ...this.values(input) })
      .returning({ id: C.id });
    await this.saveReceivers(tx, row!.id, input);
    return this.getCycle(tx, row!.id);
  }

  async updateCycle(tx: Db, id: string, body: unknown) {
    const before = await this.getCycle(tx, id);
    const input = parse(allocationCycleSchema, body);
    await this.validateCycle(tx, before.companyId, input);
    const [dup] = await tx
      .select({ id: C.id })
      .from(C)
      .where(and(eq(C.companyId, before.companyId), eq(C.code, input.code), sql`${C.id} <> ${id}`));
    if (dup) throw fieldError("code", "Kode sudah dipakai");
    await tx
      .update(C)
      .set({ ...this.values(input), updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.saveReceivers(tx, id, input);
    return this.getCycle(tx, id);
  }

  async deleteCycle(tx: Db, id: string) {
    await this.getCycle(tx, id);
    const [run] = await tx
      .select({ id: schema.allocationRuns.id })
      .from(schema.allocationRuns)
      .where(eq(schema.allocationRuns.cycleId, id))
      .limit(1);
    if (run) throw new BadRequestException("Siklus sudah pernah dijalankan; nonaktifkan saja");
    await tx.delete(C).where(eq(C.id, id));
  }

  // ---- Menjalankan ----

  /** Biaya cost center sumber per akun dalam bulan itu (tanpa hasil alokasi siklus ini & pembaliknya). */
  private async sourceCosts(tx: Db, cycle: Cycle, period: string) {
    return tx.execute<{ id: string; code: string; name: string; balance: string }>(sql`
      select a.id, a.code, a.name, sum(l.balance)::text as balance
      from account_move_lines l join account_moves m on m.id = l.move_id join accounts a on a.id = l.account_id
      where m.state = 'posted' and m.closing_year is null and l.company_id = ${cycle.companyId}
        and m.date between ${period} and ${monthEnd(period)}
        and l.cost_center_id = ${cycle.sourceCostCenterId}
        and a.account_type in (${list(EXPENSE_TYPES)})
        ${cycle.accountIds.length ? sql`and a.id in (${list(cycle.accountIds)})` : sql``}
        and m.allocation_cycle_id is distinct from ${cycle.id}
        and (m.reversed_entry_id is null or m.reversed_entry_id not in (
          select id from account_moves where allocation_cycle_id = ${cycle.id}))
      group by a.id, a.code, a.name
      having sum(l.balance) <> 0
      order by a.code`);
  }

  private async plan(tx: Db, cycle: Cycle, period: string): Promise<Plan> {
    const centers = new Map((await this.centers(tx, cycle.companyId)).map((c) => [c.id, c]));
    const receivers = await tx
      .select()
      .from(schema.allocationReceivers)
      .where(eq(schema.allocationReceivers.cycleId, cycle.id));
    const base: Plan = {
      cycleId: cycle.id,
      code: cycle.code,
      name: cycle.name,
      sequence: cycle.sequence,
      amount: "0.00",
      status: "ready",
      accounts: [],
      receivers: [],
    };
    const [done] = await tx
      .select({ id: schema.allocationRuns.id, amount: schema.allocationRuns.amount })
      .from(schema.allocationRuns)
      .where(
        and(
          eq(schema.allocationRuns.cycleId, cycle.id),
          eq(schema.allocationRuns.period, period),
          eq(schema.allocationRuns.state, "posted"),
        ),
      );
    if (done) return { ...base, status: "done", runId: done.id, amount: done.amount };

    let weights: { costCenterId: string; basis: string }[];
    if (cycle.method === "percent") {
      weights = receivers.map((r) => ({ costCenterId: r.costCenterId, basis: String(r.percent ?? 0) }));
    } else {
      const kv = await this.keyValues(tx, cycle.keyId!, period);
      const byCenter = new Map(kv.rows.map((r) => [r.costCenterId, r.value ?? "0"]));
      weights = receivers.map((r) => ({
        costCenterId: r.costCenterId,
        basis: byCenter.get(r.costCenterId) ?? "0",
      }));
    }
    const label = (id: string) => ({ code: centers.get(id)?.code ?? "", name: centers.get(id)?.name ?? "" });
    const totalWeight = weights.reduce((s, w) => s.plus(w.basis), new Decimal(0));
    if (totalWeight.lte(0))
      return {
        ...base,
        status: "error",
        message:
          cycle.method === "key"
            ? "Nilai kunci statistik semua penerima nol untuk bulan ini"
            : "Total persen penerima nol",
        receivers: weights.map((w) => ({ ...w, ...label(w.costCenterId), amount: "0.00" })),
      };

    const costs = await this.sourceCosts(tx, cycle, period);
    const total = costs.reduce((s, c) => s.plus(c.balance), new Decimal(0));
    if (!costs.length)
      return {
        ...base,
        status: "empty",
        message: "Tidak ada biaya di cost center sumber pada bulan ini",
        receivers: weights.map((w) => ({ ...w, ...label(w.costCenterId), amount: "0.00" })),
      };
    const shares = allocateAmount(
      total,
      weights.map((w) => w.basis),
    );
    return {
      ...base,
      amount: total.toFixed(2),
      accounts: costs.map((c) => ({
        accountId: c.id,
        code: c.code,
        name: c.name,
        amount: new Decimal(c.balance).toFixed(2),
      })),
      receivers: weights.map((w, i) => ({ ...w, ...label(w.costCenterId), amount: shares[i]! })),
    };
  }

  private async activeCycles(tx: Db, cycleIds?: string[]) {
    const companyId = currentContext().companyId;
    return tx
      .select()
      .from(C)
      .where(
        and(
          eq(C.companyId, companyId),
          eq(C.active, true),
          cycleIds?.length ? inArray(C.id, cycleIds) : undefined,
        ),
      )
      .orderBy(asc(C.sequence), asc(C.code));
  }

  /** Pratinjau tanpa memposting. Siklus bertingkat menghitung dari data terposting saat ini. */
  async preview(tx: Db, body: unknown) {
    const input = parse(allocationRunSchema, body);
    const plans = [];
    for (const cycle of await this.activeCycles(tx, input.cycleIds))
      plans.push(await this.plan(tx, cycle, input.period));
    return { period: input.period, date: monthEnd(input.period), cycles: plans };
  }

  /**
   * Jalankan siklus aktif berurutan: tiap siklus membuat satu jurnal alokasi bertanggal akhir bulan (kredit sumber,
   * debit penerima, per akun asal) lalu memposting. Siklus berikutnya ikut membagi biaya yang baru diterima.
   */
  async run(tx: Db, body: unknown) {
    const input = parse(allocationRunSchema, body);
    const date = monthEnd(input.period);
    const results: Plan[] = [];
    for (const cycle of await this.activeCycles(tx, input.cycleIds)) {
      const plan = await this.plan(tx, cycle, input.period);
      if (plan.status !== "ready") {
        results.push(plan);
        continue;
      }
      const lines: {
        accountId: string;
        name: string;
        debit: string;
        credit: string;
        costCenterId: string;
      }[] = [];
      const weights = plan.receivers.map((r) => r.basis);
      for (const acc of plan.accounts) {
        const amount = new Decimal(acc.amount);
        const label = `Alokasi ${cycle.code} ${input.period.slice(0, 7)}`;
        // Sumber dikurangi sebesar biayanya; penerima menerima bagian masing-masing di akun yang sama.
        lines.push({
          accountId: acc.accountId,
          name: label,
          debit: amount.lt(0) ? amount.negated().toFixed(2) : "0",
          credit: amount.gt(0) ? amount.toFixed(2) : "0",
          costCenterId: cycle.sourceCostCenterId,
        });
        allocateAmount(amount, weights).forEach((share, i) => {
          const v = new Decimal(share);
          if (v.isZero()) return;
          lines.push({
            accountId: acc.accountId,
            name: label,
            debit: v.gt(0) ? v.toFixed(2) : "0",
            credit: v.lt(0) ? v.negated().toFixed(2) : "0",
            costCenterId: plan.receivers[i]!.costCenterId,
          });
        });
      }
      const moveId = await this.moves.createEntry(
        tx,
        {
          journalId: cycle.journalId ?? undefined,
          date,
          ref: `Alokasi biaya ${cycle.code} ${input.period.slice(0, 7)}`,
          narration: cycle.name,
          lines,
        },
        cycle.companyId,
      );
      await tx
        .update(schema.accountMoves)
        .set({ allocationCycleId: cycle.id })
        .where(eq(schema.accountMoves.id, moveId));
      await this.moves.post(tx, moveId);
      const [row] = await tx
        .insert(schema.allocationRuns)
        .values({
          companyId: cycle.companyId,
          cycleId: cycle.id,
          period: input.period,
          amount: plan.amount,
          details: { accounts: plan.accounts, receivers: plan.receivers },
          moveId,
          createdBy: currentContext().userId,
        })
        .returning({ id: schema.allocationRuns.id });
      results.push({ ...plan, status: "done", runId: row!.id });
    }
    return { period: input.period, date, cycles: results };
  }

  async runs(tx: Db, period?: string) {
    const companyId = currentContext().companyId;
    return tx
      .select({
        id: schema.allocationRuns.id,
        cycleId: schema.allocationRuns.cycleId,
        code: C.code,
        name: C.name,
        period: schema.allocationRuns.period,
        state: schema.allocationRuns.state,
        amount: schema.allocationRuns.amount,
        details: schema.allocationRuns.details,
        moveId: schema.allocationRuns.moveId,
        moveName: schema.accountMoves.name,
        reversalMoveId: schema.allocationRuns.reversalMoveId,
        createdAt: schema.allocationRuns.createdAt,
        reversedAt: schema.allocationRuns.reversedAt,
      })
      .from(schema.allocationRuns)
      .innerJoin(C, eq(C.id, schema.allocationRuns.cycleId))
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.allocationRuns.moveId))
      .where(
        and(
          eq(schema.allocationRuns.companyId, companyId),
          period ? eq(schema.allocationRuns.period, period) : undefined,
        ),
      )
      .orderBy(desc(schema.allocationRuns.period), asc(C.sequence), desc(schema.allocationRuns.createdAt))
      .limit(500);
  }

  /** Balik hasil alokasi (jurnal pembalik bertanggal sama); siklus bisa dijalankan ulang untuk bulan itu. */
  async reverse(tx: Db, id: string) {
    const [run] = await tx
      .select()
      .from(schema.allocationRuns)
      .where(
        and(
          eq(schema.allocationRuns.id, id),
          eq(schema.allocationRuns.companyId, currentContext().companyId),
        ),
      )
      .for("update");
    if (!run) throw new NotFoundException("Hasil alokasi tidak ditemukan");
    if (run.state !== "posted") throw new BadRequestException("Hasil alokasi ini sudah dibalik");
    // Siklus lain yang memakai cost center penerima sebagai sumber pada bulan yang sama harus dibalik dulu.
    const receivers = ((run.details as { receivers?: { costCenterId: string }[] }).receivers ?? []).map(
      (r) => r.costCenterId,
    );
    const [cycle] = await tx.select({ sequence: C.sequence }).from(C).where(eq(C.id, run.cycleId));
    if (receivers.length) {
      const later = await tx
        .select({ code: C.code })
        .from(schema.allocationRuns)
        .innerJoin(C, eq(C.id, schema.allocationRuns.cycleId))
        .where(
          and(
            eq(schema.allocationRuns.period, run.period),
            eq(schema.allocationRuns.state, "posted"),
            inArray(C.sourceCostCenterId, receivers),
            sql`${C.sequence} >= ${cycle!.sequence}`,
            sql`${schema.allocationRuns.id} <> ${run.id}`,
          ),
        );
      if (later.length)
        throw new BadRequestException(
          `Balik dulu alokasi lanjutan yang memakai hasil ini: ${later.map((l) => l.code).join(", ")}`,
        );
    }
    const reversal = await this.moves.reverse(tx, run.moveId!, monthEnd(run.period));
    await tx
      .update(schema.allocationRuns)
      .set({
        state: "reversed",
        reversalMoveId: reversal.id,
        reversedBy: currentContext().userId,
        reversedAt: sql`now()`,
      })
      .where(eq(schema.allocationRuns.id, id));
    return { id, reversalMoveId: reversal.id, reversalName: reversal.name };
  }
}

@Controller()
export class AllocationController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AllocationService) private readonly service: AllocationService,
  ) {}

  @Get("statistical-keys/:id/values")
  @RequirePermission("accounting.read")
  keyValues(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown) {
    const { period } = parse(periodQuery, query);
    return this.tenantDb.run((tx) => this.service.keyValues(tx, id, period));
  }

  @Put("statistical-keys/:id/values")
  @RequirePermission("accounting.manage")
  saveKeyValues(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.saveKeyValues(tx, id, body));
  }

  @Get("allocation-cycles")
  @RequirePermission("accounting.read")
  listCycles() {
    return this.tenantDb.run((tx) => this.service.listCycles(tx));
  }

  @Get("allocation-cycles/:id")
  @RequirePermission("accounting.read")
  getCycle(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.getCycle(tx, id));
  }

  @Post("allocation-cycles")
  @RequirePermission("accounting.manage")
  createCycle(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.createCycle(tx, body));
  }

  @Put("allocation-cycles/:id")
  @RequirePermission("accounting.manage")
  updateCycle(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.updateCycle(tx, id, body));
  }

  @Delete("allocation-cycles/:id")
  @HttpCode(204)
  @RequirePermission("accounting.manage")
  async deleteCycle(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.service.deleteCycle(tx, id));
  }

  @Post("allocation-runs/preview")
  @HttpCode(200)
  @RequirePermission("accounting.read")
  preview(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.preview(tx, body));
  }

  @Post("allocation-runs")
  @RequirePermission("accounting.post")
  run(@Body() body: unknown) {
    return this.tenantDb.run((tx) => this.service.run(tx, body));
  }

  @Get("allocation-runs")
  @RequirePermission("accounting.read")
  runs(@Query("period") period?: string) {
    const p = period && /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : undefined;
    return this.tenantDb.run((tx) => this.service.runs(tx, p));
  }

  @Post("allocation-runs/:id/reverse")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  reverse(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.service.reverse(tx, id));
  }
}
