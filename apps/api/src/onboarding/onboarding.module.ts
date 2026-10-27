import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  Put,
} from "@nestjs/common";
import { and, count, eq, inArray, isNull, ne, schema, sql, type Db } from "@erp/db";
import {
  ONBOARDING_STEPS,
  onboardingCompanySchema,
  onboardingStepSchema,
  openingBalanceSchema,
  type OnboardingStep,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { MoveService } from "../accounting/move.service.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { BillingService } from "../billing/billing.service.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";

const OPENING_REF = "SALDO-AWAL";
const OPENING_EQUITY = { code: "3-9900", name: "Ekuitas Saldo Awal" };

const STEP_LABELS: Record<OnboardingStep, string> = {
  company: "Lengkapi profil & NPWP perusahaan",
  tax: "Atur status PKP & pajak bawaan",
  opening: "Masukkan saldo awal",
  partners: "Impor pelanggan & pemasok",
  products: "Impor produk",
  users: "Undang tim Anda",
  plan: "Pilih paket langganan",
};

@Injectable()
class OnboardingService {
  constructor(
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /** Checklist: sebagian dideteksi dari data, sisanya ditandai selesai/dilewati manual. */
  async status(tx: Db) {
    const { companyId, tenantId } = currentContext();
    const [company] = await tx.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    const total = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const partners = await total(
      tx.select({ n: count() }).from(schema.partners).where(isNull(schema.partners.icCompanyId)),
    );
    const products = await total(tx.select({ n: count() }).from(schema.products));
    const users = await total(
      tx
        .select({ n: count() })
        .from(schema.users)
        .where(and(eq(schema.users.active, true), eq(schema.users.kind, "human"))),
    );
    const opening = await this.openingMove(tx, companyId);
    const access = await this.billing.access(tenantId);
    const auto: Record<OnboardingStep, boolean> = {
      company: Boolean(company?.npwp && company.street),
      tax: false,
      opening: Boolean(opening),
      partners: partners > 0,
      products: products > 0,
      users: users > 1,
      plan: access.status === "active" || access.status === "cancelling",
    };
    const manual = company?.onboarding ?? {};
    const steps = ONBOARDING_STEPS.map((key) => ({
      key,
      label: STEP_LABELS[key],
      status: auto[key] ? "done" : (manual[key] ?? "todo"),
    }));
    return {
      company,
      steps,
      remaining: steps.filter((s) => s.status === "todo").length,
      completedAt: company?.onboardingCompletedAt ?? null,
    };
  }

  /** Profil perusahaan + status PKP. Non-PKP tidak memungut PPN, jadi pajak penjualan bawaan dikosongkan. */
  async saveCompany(tx: Db, input: z.infer<typeof onboardingCompanySchema>) {
    const { companyId } = currentContext();
    const [company] = await tx
      .update(schema.companies)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(schema.companies.id, companyId))
      .returning();
    const [ppn] = await tx
      .select({ id: schema.taxes.id })
      .from(schema.taxes)
      .where(
        and(
          eq(schema.taxes.companyId, companyId),
          eq(schema.taxes.typeTaxUse, "sale"),
          eq(schema.taxes.taxKind, "vat"),
          eq(schema.taxes.active, true),
        ),
      )
      .limit(1);
    await tx
      .update(schema.accountingSettings)
      .set({ defaultSaleTaxId: input.pkp ? (ppn?.id ?? null) : null, updatedAt: sql`now()` })
      .where(eq(schema.accountingSettings.companyId, companyId));
    await this.mark(tx, "tax", "done");
    return company;
  }

  async mark(tx: Db, step: OnboardingStep, status: "done" | "skipped") {
    await tx
      .update(schema.companies)
      .set({
        onboarding: sql`${schema.companies.onboarding} || ${JSON.stringify({ [step]: status })}::jsonb`,
      })
      .where(eq(schema.companies.id, currentContext().companyId));
  }

  async complete(tx: Db) {
    await tx
      .update(schema.companies)
      .set({ onboardingCompletedAt: sql`now()` })
      .where(eq(schema.companies.id, currentContext().companyId));
    return this.status(tx);
  }

  private async openingMove(tx: Db, companyId: string) {
    const [move] = await tx
      .select({ id: schema.accountMoves.id })
      .from(schema.accountMoves)
      .where(
        and(
          eq(schema.accountMoves.companyId, companyId),
          eq(schema.accountMoves.ref, OPENING_REF),
          ne(schema.accountMoves.state, "draft"),
        ),
      );
    return move;
  }

  /**
   * Saldo awal per akun sebagai satu jurnal umum posted. Selisih debit/kredit dibukukan ke
   * "Ekuitas Saldo Awal" agar neraca seimbang; akun piutang/utang boleh per partner.
   */
  async openingBalance(tx: Db, input: z.infer<typeof openingBalanceSchema>) {
    const { companyId } = currentContext();
    if (await this.openingMove(tx, companyId))
      throw new ConflictException("Saldo awal sudah diposting; koreksi lewat jurnal umum");
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await tx
      .select({ id: schema.accounts.id, code: schema.accounts.code })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.companyId, companyId), inArray(schema.accounts.code, codes)));
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: missing.map((c) => ({ path: "lines", message: `Akun ${c} tidak ditemukan` })),
      });

    const lines = input.lines
      .filter((l) => !new Decimal(l.debit).isZero() || !new Decimal(l.credit).isZero())
      .map((l) => ({
        accountId: byCode.get(l.accountCode)!,
        partnerId: l.partnerId ?? null,
        name: l.name ?? "Saldo awal",
        debit: l.debit,
        credit: l.credit,
      }));
    const diff = lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), new Decimal(0));
    if (!diff.isZero()) {
      lines.push({
        accountId: await this.equityAccount(tx, companyId),
        partnerId: null,
        name: "Selisih saldo awal",
        debit: diff.lt(0) ? diff.abs().toFixed(2) : "0",
        credit: diff.gt(0) ? diff.toFixed(2) : "0",
      });
    }
    if (lines.length < 2) throw new BadRequestException("Saldo awal minimal dua baris bernilai");
    const id = await this.moves.createEntry(tx, {
      date: input.date,
      ref: OPENING_REF,
      narration: "Saldo awal (onboarding)",
      lines,
    });
    await this.moves.post(tx, id);
    await this.mark(tx, "opening", "done");
    return { moveId: id, balancingAmount: diff.toFixed(2) };
  }

  private async equityAccount(tx: Db, companyId: string) {
    const [existing] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.code, OPENING_EQUITY.code)));
    if (existing) return existing.id;
    const [created] = await tx
      .insert(schema.accounts)
      .values({ companyId, ...OPENING_EQUITY, accountType: "equity" })
      .returning({ id: schema.accounts.id });
    return created!.id;
  }
}

@Controller("onboarding")
class OnboardingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  @RequirePermission("company.read")
  status() {
    return this.tenantDb.run((tx) => this.onboarding.status(tx));
  }

  @Put("company")
  @RequirePermission("company.write")
  async company(@Body() body: unknown) {
    const input = parse(onboardingCompanySchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.onboarding.saveCompany(tx, input);
      return this.onboarding.status(tx);
    });
  }

  @Post("opening-balance")
  @RequirePermission("accounting.post")
  openingBalance(@Body() body: unknown) {
    const input = parse(openingBalanceSchema, body);
    return this.tenantDb.run((tx) => this.onboarding.openingBalance(tx, input));
  }

  @Post("steps")
  @HttpCode(200)
  @RequirePermission("company.write")
  step(@Body() body: unknown) {
    const { step, status } = parse(onboardingStepSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.onboarding.mark(tx, step, status);
      return this.onboarding.status(tx);
    });
  }

  @Post("complete")
  @HttpCode(200)
  @RequirePermission("company.write")
  complete() {
    return this.tenantDb.run((tx) => this.onboarding.complete(tx));
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [OnboardingController],
  providers: [ActivityService, OnboardingService],
})
export class OnboardingModule {}
