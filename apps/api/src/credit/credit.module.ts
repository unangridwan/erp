import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { eq, schema, type Db } from "@erp/db";
import {
  dunningLevelSchema,
  dunningSendSchema,
  dunningSettingsSchema,
  partnerCreditSchema,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { CONFIG, type AppConfig } from "../config.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { MasterModule } from "../master/master.module.js";
import { SaleOrderService } from "../sales/sale-order.service.js";
import { SalesModule } from "../sales/sales.module.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { CreditService, creditWarnings } from "./credit.service.js";

const dateQuery = z.object({ date: z.string().date().optional() });
const lettersQuery = z.object({ partnerId: z.string().uuid().optional(), state: z.string().optional() });
const resendSchema = z.object({ to: z.string().trim().email().max(200).nullish() });

@Controller()
export class CreditController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(CreditService) private readonly credit: CreditService,
  ) {}

  @Get("partners/:id/credit")
  @RequirePermission("partner.read")
  status(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown) {
    const { date } = parse(dateQuery, query);
    return this.tenantDb.run((tx) => this.credit.status(tx, currentContext().companyId, id, { date }));
  }

  @Put("partners/:id/credit")
  @RequirePermission("accounting.manage")
  save(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(partnerCreditSchema, body);
    return this.tenantDb.run((tx) => this.credit.saveLimit(tx, currentContext().companyId, id, input));
  }

  @Get("sale-orders/:id/credit-check")
  @RequirePermission("sales.read")
  orderCheck(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.credit.orderCheck(tx, id));
  }
}

@Controller()
export class DunningController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(CreditService) private readonly credit: CreditService,
  ) {}

  @Get("dunning-levels")
  @RequirePermission("accounting.read")
  levels() {
    return this.tenantDb.run((tx) => this.credit.levels(tx, currentContext().companyId));
  }

  @Post("dunning-levels")
  @RequirePermission("accounting.manage")
  createLevel(@Body() body: unknown) {
    const input = parse(dunningLevelSchema, body);
    return this.tenantDb.run((tx) => this.credit.saveLevel(tx, currentContext().companyId, null, input));
  }

  @Put("dunning-levels/:id")
  @RequirePermission("accounting.manage")
  updateLevel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(dunningLevelSchema, body);
    return this.tenantDb.run((tx) => this.credit.saveLevel(tx, currentContext().companyId, id, input));
  }

  @Delete("dunning-levels/:id")
  @HttpCode(204)
  @RequirePermission("accounting.manage")
  async removeLevel(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.credit.removeLevel(tx, currentContext().companyId, id));
  }

  @Get("dunning/settings")
  @RequirePermission("accounting.read")
  settings() {
    return this.tenantDb.run((tx) => this.credit.settings(tx, currentContext().companyId));
  }

  @Put("dunning/settings")
  @RequirePermission("accounting.manage")
  saveSettings(@Body() body: unknown) {
    const input = parse(dunningSettingsSchema, body);
    return this.tenantDb.run((tx) => this.credit.saveSettings(tx, currentContext().companyId, input));
  }

  @Get("dunning/preview")
  @RequirePermission("accounting.read")
  preview(@Query() query: unknown) {
    const { date } = parse(dateQuery, query);
    return this.tenantDb.run((tx) => this.credit.preview(tx, currentContext().companyId, date));
  }

  @Post("dunning/send")
  @HttpCode(200)
  @RequirePermission("accounting.write")
  send(@Body() body: unknown) {
    const input = parse(dunningSendSchema, body);
    const ctx = currentContext();
    return this.tenantDb.run((tx) =>
      this.credit.send(tx, ctx.companyId, {
        date: input.date,
        partnerIds: input.partnerIds,
        userId: ctx.userId,
      }),
    );
  }

  @Get("dunning-letters")
  @RequirePermission("accounting.read")
  letters(@Query() query: unknown) {
    const q = parse(lettersQuery, query);
    return this.tenantDb.run((tx) => this.credit.letters(tx, currentContext().companyId, q));
  }

  @Get("dunning-letters/:id")
  @RequirePermission("accounting.read")
  letter(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.credit.letter(tx, currentContext().companyId, id));
  }

  @Get("dunning-letters/:id/pdf")
  @RequirePermission("accounting.read")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.credit.letterPdf(tx, currentContext().companyId, id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    res.send(file.content);
  }

  @Post("dunning-letters/:id/resend")
  @HttpCode(200)
  @RequirePermission("accounting.write")
  resend(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { to } = parse(resendSchema, body ?? {});
    const ctx = currentContext();
    return this.tenantDb.run((tx) => this.credit.resend(tx, ctx.companyId, id, to, ctx.userId));
  }
}

/** Kirim surat teguran otomatis sekali sehari untuk perusahaan yang mengaktifkan dunning. */
@Injectable()
export class DunningScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DunningScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(CreditService) private readonly credit: CreditService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.dunning.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "dunning-scheduler" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /**
   * Proses semua perusahaan yang mengaktifkan dunning (atau tenant tertentu). Aman dijalankan berkali-kali sehari:
   * faktur yang sudah mencapai tingkatnya tidak ditagih lagi. Mengembalikan jumlah surat yang dibuat.
   */
  async runDue(date = new Date().toISOString().slice(0, 10), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let created = 0;
    for (const tenantId of tenants) {
      const companies = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .select({ companyId: schema.accountingSettings.companyId })
          .from(schema.accountingSettings)
          .where(eq(schema.accountingSettings.dunningEnabled, true)),
      );
      for (const { companyId } of companies) {
        try {
          const letters = await this.tenantDb.runAs(tenantId, (tx) =>
            this.credit.send(tx, companyId, { date, userId: null }),
          );
          created += letters.length;
        } catch (e) {
          this.logger.error(e);
          reportError(e, { job: "dunning-scheduler", tenantId, companyId });
        }
      }
    }
    return created;
  }
}

/** Catat peringatan kredit di riwayat pesanan saat dikonfirmasi (tidak memblokir). */
@Injectable()
export class CreditConfirmHook implements OnModuleInit {
  constructor(
    @Inject(SaleOrderService) private readonly sales: SaleOrderService,
    @Inject(CreditService) private readonly credit: CreditService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    this.sales.confirmHooks.push(async (tx, order) => {
      const status = await this.credit.status(tx, order.companyId, order.partnerId, { orderId: order.id });
      const warnings = creditWarnings(status);
      if (!warnings.length) return;
      await this.activity.log(tx, {
        resModel: "sale_order",
        resId: order.id,
        action: "comment",
        message: `Dikonfirmasi dengan peringatan kredit: ${warnings.join("; ")}`,
      });
    });
  }
}

@Module({
  imports: [MasterModule, SalesModule],
  controllers: [CreditController, DunningController],
  providers: [CreditService, DunningScheduler, CreditConfirmHook, SequenceService, ActivityService],
  exports: [CreditService, DunningScheduler],
})
export class CreditModule {}
