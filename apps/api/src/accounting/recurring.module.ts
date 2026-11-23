import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, isNotNull, lte, schema, sql, type Db } from "@erp/db";
import {
  addDays,
  nextRecurringDate,
  recurringDates,
  recurringEntrySchema,
  type RecurringEntryInput,
  businessToday,
} from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { CONFIG, type AppConfig } from "../config.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { currentContext, runWithContext, type RequestContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { assertCompanyAccounts, assertCompanyJournal, fieldError } from "./context.js";
import { MoveService } from "./move.service.js";

const R = schema.recurringEntries;
const M = schema.accountMoves;
const today = () => businessToday();
/** Batas pembuatan sekaligus (catch-up) per template per jalan. */
const CATCH_UP = 24;

export type Recurring = typeof R.$inferSelect;

@Injectable()
export class RecurringService {
  constructor(@Inject(MoveService) private readonly moves: MoveService) {}

  async list(tx: Db, companyId: string) {
    return tx
      .select({
        template: R,
        journal: schema.journals.name,
        generated: sql<number>`(select count(*)::int from account_moves m where m.recurring_id = ${R.id})`,
      })
      .from(R)
      .leftJoin(schema.journals, eq(schema.journals.id, R.journalId))
      .where(eq(R.companyId, companyId))
      .orderBy(desc(R.active), asc(R.nextDate), asc(R.name))
      .then((rows) => rows.map((r) => ({ ...r.template, journalName: r.journal, generated: r.generated })));
  }

  async get(tx: Db, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, id), eq(R.companyId, companyId)));
    if (!row) throw new NotFoundException("Jurnal berulang tidak ditemukan");
    const entries = await tx
      .select({ id: M.id, name: M.name, date: M.date, state: M.state, autoPost: M.autoPost })
      .from(M)
      .where(eq(M.recurringId, id))
      .orderBy(desc(M.date))
      .limit(100);
    return { ...row, entries, upcoming: this.upcoming(row, 6) };
  }

  /** Tanggal berikutnya yang akan dibuat (pratinjau). */
  upcoming(t: Recurring, n: number) {
    if (!t.active || !t.nextDate) return [];
    const dates = recurringDates(t, t.nextDate, "9999-12-31", n);
    return t.remainingCount === null ? dates : dates.slice(0, t.remainingCount);
  }

  async save(tx: Db, companyId: string, id: string | null, input: RecurringEntryInput, userId: string) {
    await assertCompanyJournal(tx, companyId, input.journalId, [
      "general",
      "bank",
      "cash",
      "sale",
      "purchase",
    ]);
    await assertCompanyAccounts(
      tx,
      companyId,
      input.lines.map((l, i) => ({ path: `lines.${i}.accountId`, id: l.accountId })),
    );
    const values = {
      name: input.name,
      journalId: input.journalId,
      ref: input.ref ?? null,
      narration: input.narration ?? null,
      lines: input.lines.map((l) => ({
        accountId: l.accountId,
        name: l.name ?? null,
        debit: l.debit,
        credit: l.credit,
        partnerId: l.partnerId ?? null,
        businessUnitId: l.businessUnitId ?? null,
        branchId: l.branchId ?? null,
        costCenterId: l.costCenterId ?? null,
        profitCenterId: l.profitCenterId ?? null,
      })),
      frequency: input.frequency,
      interval: input.interval,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      remainingCount: input.remainingCount ?? null,
      autoPost: input.autoPost,
      autoReverse: input.autoReverse,
      active: input.active,
    };
    if (!id) {
      const [row] = await tx
        .insert(R)
        .values({ ...values, companyId, nextDate: input.startDate, createdBy: userId })
        .returning();
      return row!;
    }
    const current = await this.get(tx, companyId, id);
    // Jadwal diubah: tanggal berikutnya dihitung ulang dari jadwal baru setelah entri terakhir yang dibuat.
    const last = current.entries[0]?.date ?? null;
    const nextDate = last ? nextRecurringDate(values, last) : input.startDate;
    const [row] = await tx
      .update(R)
      .set({ ...values, nextDate, lastError: null, updatedAt: sql`now()` })
      .where(eq(R.id, id))
      .returning();
    return row!;
  }

  async remove(tx: Db, companyId: string, id: string) {
    const t = await this.get(tx, companyId, id);
    if (t.entries.length) {
      throw new BadRequestException("Jurnal berulang sudah menghasilkan entri; nonaktifkan saja");
    }
    await tx.delete(R).where(eq(R.id, id));
  }

  /**
   * Buat entri untuk semua tanggal jatuh tempo ≤ `until` (maks. 24 sekaligus). Posting otomatis bila diatur;
   * gagal posting (mis. periode terkunci) membiarkan draft dan mencatat galat di template.
   */
  async generate(tx: Db, t: Recurring, until: string) {
    if (!t.active || !t.nextDate || t.nextDate > until) return [];
    let dates = recurringDates(t, t.nextDate, until, CATCH_UP);
    if (t.remainingCount !== null) dates = dates.slice(0, t.remainingCount);
    const created: { id: string; date: string; name: string | null; error?: string }[] = [];
    let error: string | null = null;
    for (const date of dates) {
      const id = await this.moves.createEntry(
        tx,
        {
          journalId: t.journalId,
          date,
          ref: t.ref ?? t.name,
          narration: t.narration,
          autoReverseDate: t.autoReverse ? addDays(date, 1) : null,
          lines: t.lines.map((l) => ({ ...l, debit: l.debit, credit: l.credit })),
        },
        t.companyId,
      );
      await tx.update(M).set({ recurringId: t.id, autoPost: t.autoPost }).where(eq(M.id, id));
      let name: string | null = null;
      if (t.autoPost) {
        try {
          await tx.execute(sql`savepoint recurring_post`);
          name = await this.moves.post(tx, id);
          await tx.execute(sql`release savepoint recurring_post`);
        } catch (e) {
          await tx.execute(sql`rollback to savepoint recurring_post`);
          error = e instanceof Error ? e.message : String(e);
        }
      }
      created.push({ id, date, name, ...(error ? { error } : {}) });
    }
    const last = dates.at(-1);
    const remaining = t.remainingCount === null ? null : t.remainingCount - dates.length;
    const nextDate = last ? nextRecurringDate(t, last) : t.nextDate;
    await tx
      .update(R)
      .set({
        nextDate: remaining === 0 ? null : nextDate,
        remainingCount: remaining,
        active: remaining === 0 || nextDate === null ? false : t.active,
        lastRunAt: sql`now()`,
        lastError: error,
        updatedAt: sql`now()`,
      })
      .where(eq(R.id, t.id));
    return created;
  }
}

const generateBody = z.object({ until: z.string().date().optional() });

@Controller("recurring-entries")
export class RecurringController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(RecurringService) private readonly recurring: RecurringService,
  ) {}

  @Get()
  @RequirePermission("accounting.read")
  list() {
    return this.tenantDb.run((tx) => this.recurring.list(tx, currentContext().companyId));
  }

  @Get(":id")
  @RequirePermission("accounting.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.recurring.get(tx, currentContext().companyId, id));
  }

  @Post()
  @RequirePermission("accounting.write")
  create(@Body() body: unknown) {
    const input = parse(recurringEntrySchema, body);
    const ctx = currentContext();
    return this.tenantDb.run((tx) => this.recurring.save(tx, ctx.companyId, null, input, ctx.userId));
  }

  @Put(":id")
  @RequirePermission("accounting.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(recurringEntrySchema, body);
    const ctx = currentContext();
    return this.tenantDb.run((tx) => this.recurring.save(tx, ctx.companyId, id, input, ctx.userId));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("accounting.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.recurring.remove(tx, currentContext().companyId, id));
  }

  /** Buat sekarang semua entri yang jatuh tempo s.d. `until` (bawaan hari ini). */
  @Post(":id/generate")
  @HttpCode(200)
  @RequirePermission("accounting.write")
  generate(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Query() _q: unknown) {
    const { until } = parse(generateBody, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const t = await this.recurring.get(tx, currentContext().companyId, id);
      if (!t.active) throw fieldError("active", "Jurnal berulang tidak aktif");
      const created = await this.recurring.generate(tx, t, until ?? today());
      return { created, template: await this.recurring.get(tx, currentContext().companyId, id) };
    });
  }
}

/**
 * Penjadwal akuntansi (tiap jam): posting draft `auto_post` yang tanggalnya sudah tiba (pengakuan penangguhan,
 * jurnal berulang yang gagal diposting) lalu membuat jurnal berulang yang jatuh tempo.
 */
@Injectable()
export class AccountingScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccountingScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(RecurringService) private readonly recurring: RecurringService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.accounting.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "accounting-scheduler" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Mengembalikan jumlah entri yang diposting dan dibuat. */
  async runDue(date = today(), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let posted = 0;
    let created = 0;
    for (const tenantId of tenants) {
      const drafts = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .select({ id: M.id, companyId: M.companyId, createdBy: M.createdBy })
          .from(M)
          .where(and(eq(M.state, "draft"), eq(M.autoPost, true), lte(M.date, date)))
          .orderBy(asc(M.date)),
      );
      for (const d of drafts) {
        try {
          await runWithContext(this.systemContext(tenantId, d.companyId, d.createdBy), () =>
            this.tenantDb.run((tx) => this.moves.post(tx, d.id)),
          );
          posted++;
        } catch (e) {
          this.logger.warn(`Gagal posting otomatis ${d.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const due = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .select()
          .from(R)
          .where(and(eq(R.active, true), isNotNull(R.nextDate), lte(R.nextDate, date))),
      );
      for (const t of due) {
        try {
          const rows = await runWithContext(this.systemContext(tenantId, t.companyId, t.createdBy), () =>
            this.tenantDb.run((tx) => this.recurring.generate(tx, t, date)),
          );
          created += rows.length;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Gagal membuat jurnal berulang ${t.id}: ${message}`);
          await this.tenantDb.runAs(tenantId, (tx) =>
            tx
              .update(R)
              .set({ lastError: message.slice(0, 500), lastRunAt: sql`now()` })
              .where(eq(R.id, t.id)),
          );
        }
      }
    }
    return { posted, created };
  }

  /** Konteks pembuat entri (dicatat sebagai pembuat/pemosting); tanpa hak tambahan. */
  private systemContext(tenantId: string, companyId: string, userId: string | null): RequestContext {
    return {
      tenantId,
      userId: userId ?? "00000000-0000-0000-0000-000000000000",
      companyIds: [companyId],
      companyId,
      permissions: [],
    };
  }
}
