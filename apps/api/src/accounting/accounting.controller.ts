import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { and, count, desc, eq, ilike, or, schema, sql, type SQL } from "@erp/db";
import {
  accountingSettingsSchema,
  INVOICE_TYPES,
  invoiceSchema,
  journalEntrySchema,
  paymentSchema,
  reconcileSchema,
} from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { installInventory } from "../inventory/setup.js";
import { installPayroll } from "../payroll/setup.js";
import { installChart } from "./chart-template.js";
import { MoveService } from "./move.service.js";
import { PaymentService } from "./payment.service.js";
import { ReconcileService } from "./reconcile.service.js";
import { reportQuery, ReportService } from "./reports.service.js";

const moveListQuery = z.object({
  type: z.enum(["entry", ...INVOICE_TYPES]).optional(),
  state: z.enum(["draft", "posted"]).optional(),
  partnerId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const reverseBody = z.object({ date: z.string().date().optional() });

@Controller("accounting")
export class AccountingController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  /** Pasang bagan akun, jurnal, dan pajak standar untuk perusahaan aktif (idempoten). */
  @Post("setup")
  @HttpCode(200)
  @RequirePermission("accounting.manage")
  setup() {
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const installed = await installChart(tx, companyId);
      // Persediaan & payroll memakai akun dari bagan akun standar.
      await installInventory(tx, companyId);
      await installPayroll(tx, companyId);
      return { installed };
    });
  }

  @Get("settings")
  @RequirePermission("accounting.read")
  settings() {
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.accountingSettings)
        .where(eq(schema.accountingSettings.companyId, currentContext().companyId));
      return row ?? null;
    });
  }

  @Patch("settings")
  @RequirePermission("accounting.manage")
  updateSettings(@Body() body: unknown) {
    const input = parse(accountingSettingsSchema, body);
    // Hanya field yang dikirim yang diubah; null mengosongkan.
    const sent = (key: string) => body !== null && typeof body === "object" && key in body;
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .update(schema.accountingSettings)
        .set({
          ...(sent("lockDate") ? { lockDate: input.lockDate ?? null } : {}),
          ...(sent("purchaseApprovalAmount")
            ? { purchaseApprovalAmount: input.purchaseApprovalAmount ?? null }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(schema.accountingSettings.companyId, currentContext().companyId))
        .returning();
      if (!row) throw new NotFoundException("Akuntansi belum disiapkan untuk perusahaan ini");
      return row;
    });
  }
}

@Controller("moves")
export class MovesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MoveService) private readonly moves: MoveService,
  ) {}

  @Get()
  @RequirePermission("accounting.read")
  list(@Query() query: unknown) {
    const q = parse(moveListQuery, query);
    const m = schema.accountMoves;
    const filters: (SQL | undefined)[] = [eq(m.companyId, currentContext().companyId)];
    if (q.type) filters.push(eq(m.moveType, q.type));
    if (q.state) filters.push(eq(m.state, q.state));
    if (q.partnerId) filters.push(eq(m.partnerId, q.partnerId));
    if (q.q) {
      const term = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(m.name, term), ilike(m.ref, term), ilike(schema.partners.name, term)));
    }
    const where = and(...filters);
    return this.tenantDb.run(async (tx) => {
      const items = await tx
        .select({
          id: m.id,
          name: m.name,
          moveType: m.moveType,
          state: m.state,
          date: m.date,
          dueDate: m.dueDate,
          ref: m.ref,
          partnerId: m.partnerId,
          partnerName: schema.partners.name,
          currencyCode: m.currencyCode,
          amountTotal: m.amountTotal,
          amountResidual: m.amountResidual,
          paymentState: m.paymentState,
          journalId: m.journalId,
        })
        .from(m)
        .leftJoin(schema.partners, eq(schema.partners.id, m.partnerId))
        .where(where)
        .orderBy(desc(m.date), desc(m.createdAt))
        .limit(q.limit)
        .offset(q.offset);
      const [{ total } = { total: 0 }] = await tx
        .select({ total: count() })
        .from(m)
        .leftJoin(schema.partners, eq(schema.partners.id, m.partnerId))
        .where(where);
      return { items, total, limit: q.limit, offset: q.offset };
    });
  }

  @Get(":id")
  @RequirePermission("accounting.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.moves.get(tx, id));
  }

  /** Buat draft: jurnal umum (tanpa `moveType`/`moveType: "entry"`) atau faktur/tagihan. */
  @Post()
  @RequirePermission("accounting.write")
  create(@Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const id = this.isInvoice(body)
        ? await this.moves.createInvoice(tx, parse(invoiceSchema, body))
        : await this.moves.createEntry(tx, parse(journalEntrySchema, body));
      return this.moves.get(tx, id);
    });
  }

  @Patch(":id")
  @RequirePermission("accounting.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      await this.moves.updateDraft(
        tx,
        id,
        this.isInvoice(body) ? parse(invoiceSchema, body) : parse(journalEntrySchema, body),
      );
      return this.moves.get(tx, id);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("accounting.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.moves.deleteDraft(tx, id));
  }

  @Post(":id/post")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  post(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.moves.post(tx, id);
      return this.moves.get(tx, id);
    });
  }

  @Post(":id/reverse")
  @RequirePermission("accounting.post")
  reverse(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { date } = parse(reverseBody, body ?? {});
    return this.tenantDb.run(async (tx) => {
      const reversal = await this.moves.reverse(tx, id, date);
      return this.moves.get(tx, reversal.id);
    });
  }

  private isInvoice(body: unknown) {
    const type = (body as { moveType?: unknown } | null)?.moveType;
    if (
      type !== undefined &&
      type !== "entry" &&
      !INVOICE_TYPES.includes(type as (typeof INVOICE_TYPES)[number])
    ) {
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: [{ path: "moveType", message: "Jenis dokumen tidak dikenal" }],
      });
    }
    return type !== undefined && type !== "entry";
  }
}

@Controller()
export class PaymentsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PaymentService) private readonly payments: PaymentService,
    @Inject(ReconcileService) private readonly reconcile: ReconcileService,
  ) {}

  @Get("payments")
  @RequirePermission("accounting.read")
  list() {
    const p = schema.payments;
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: p.id,
          date: p.date,
          paymentType: p.paymentType,
          amount: p.amount,
          currencyCode: p.currencyCode,
          memo: p.memo,
          partnerName: schema.partners.name,
          journalName: schema.journals.name,
          moveId: p.moveId,
          moveName: schema.accountMoves.name,
        })
        .from(p)
        .innerJoin(schema.partners, eq(schema.partners.id, p.partnerId))
        .innerJoin(schema.journals, eq(schema.journals.id, p.journalId))
        .innerJoin(schema.accountMoves, eq(schema.accountMoves.id, p.moveId))
        .where(eq(p.companyId, currentContext().companyId))
        .orderBy(desc(p.date), desc(p.createdAt))
        .limit(200),
    );
  }

  @Post("payments")
  @RequirePermission("accounting.post")
  register(@Body() body: unknown) {
    const input = parse(paymentSchema, body);
    return this.tenantDb.run((tx) => this.payments.register(tx, input));
  }

  @Post("reconcile")
  @HttpCode(200)
  @RequirePermission("accounting.post")
  reconcileLines(@Body() body: unknown) {
    const { lineIds } = parse(reconcileSchema, body);
    return this.tenantDb.run((tx) => this.reconcile.reconcileLines(tx, lineIds));
  }
}

@Controller("reports")
export class ReportsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  @Get("trial-balance")
  @RequirePermission("accounting.read")
  trialBalance(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.reports.trialBalance(tx, parse(reportQuery, query)));
  }

  @Get("general-ledger")
  @RequirePermission("accounting.read")
  generalLedger(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.reports.generalLedger(tx, parse(reportQuery, query)));
  }

  @Get("balance-sheet")
  @RequirePermission("accounting.read")
  balanceSheet(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.reports.balanceSheet(tx, parse(reportQuery, query)));
  }

  @Get("profit-loss")
  @RequirePermission("accounting.read")
  profitLoss(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.reports.profitLoss(tx, parse(reportQuery, query)));
  }

  @Get("aged")
  @RequirePermission("accounting.read")
  aged(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.reports.aged(tx, parse(reportQuery, query)));
  }

  @Get("branch-clearing")
  @RequirePermission("accounting.read")
  branchClearing(@Query() query: unknown) {
    return this.tenantDb.run((tx) => this.reports.branchClearing(tx, parse(reportQuery, query)));
  }
}
