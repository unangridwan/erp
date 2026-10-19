import {
  Body,
  Controller,
  Get,
  Global,
  Headers,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { adminSubscriptionSchema, planSchema, subscribeSchema } from "@erp/shared";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Principal } from "../auth/auth.service.js";
import { AllowInactive, PlatformAdmin, Public, RequirePermission } from "../auth/decorators.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { BillingService } from "./billing.service.js";

type AuthedRequest = Request & { principal: Principal };

/** Halaman langganan tenant — tetap bisa dipakai walau langganan berakhir. */
@AllowInactive()
@Controller("billing")
class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get()
  @RequirePermission("billing.manage")
  summary() {
    return this.billing.summary(currentContext().tenantId);
  }

  @Post("subscribe")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  subscribe(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.billing.subscribe(
      currentContext().tenantId,
      parse(subscribeSchema, body),
      req.principal.email,
    );
  }

  @Post("invoices/:id/pay")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  pay(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.billing.pay(currentContext().tenantId, id, req.principal.email);
  }

  @Post("cancel")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  cancel() {
    return this.billing.setCancelAtPeriodEnd(currentContext().tenantId, true);
  }

  @Post("resume")
  @HttpCode(200)
  @RequirePermission("billing.manage")
  resume() {
    return this.billing.setCancelAtPeriodEnd(currentContext().tenantId, false);
  }
}

const xenditEvent = z.object({
  external_id: z.string().uuid(),
  status: z.string(),
  id: z.string().optional(),
  paid_at: z.string().optional(),
});

/** Notifikasi pembayaran dari Xendit (Invoice callback), diverifikasi dengan token callback. */
@Controller("billing/webhooks")
class BillingWebhookController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("xendit")
  @HttpCode(200)
  async xendit(@Headers("x-callback-token") token: string | undefined, @Body() body: unknown) {
    const expected = this.config.billing.xenditCallbackToken;
    if (!expected || !token || !safeEqual(token, expected))
      throw new UnauthorizedException("Token callback tidak valid");
    const event = parse(xenditEvent, body);
    if (event.status === "PAID" || event.status === "SETTLED") {
      await this.billing.markPaid(
        event.external_id,
        event.paid_at ? new Date(event.paid_at) : new Date(),
        event.id,
      );
    }
    return { ok: true };
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const markPaidSchema = z.object({ paidAt: z.string().datetime({ offset: true }).optional() });

/** Operator SaaS: daftar tenant, paket, tagihan terbuka, konfirmasi transfer manual. */
@PlatformAdmin()
@Controller("platform")
class PlatformController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("tenants")
  tenants() {
    return this.billing.tenants();
  }

  @Patch("tenants/:id/subscription")
  updateSubscription(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.billing.adminUpdate(id, parse(adminSubscriptionSchema, body));
  }

  @Get("plans")
  plans() {
    return this.billing.allPlans();
  }

  @Put("plans")
  savePlan(@Body() body: unknown) {
    return this.billing.savePlan(parse(planSchema, body));
  }

  @Get("invoices")
  invoices() {
    return this.billing.openInvoices();
  }

  @Post("invoices/:id/mark-paid")
  @HttpCode(200)
  markPaid(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { paidAt } = parse(markPaidSchema, body ?? {});
    return this.billing.markPaid(id, paidAt ? new Date(paidAt) : new Date());
  }

  @Post("billing/run")
  @HttpCode(200)
  run() {
    return this.billing.runRenewals();
  }
}

@Global()
@Module({
  controllers: [BillingController, BillingWebhookController, PlatformController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
