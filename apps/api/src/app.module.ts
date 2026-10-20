import { Inject, Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AccountingModule } from "./accounting/accounting.module.js";
import { ActivityController, ActivityService } from "./activity/activity.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthService } from "./auth/auth.service.js";
import { SsoController } from "./auth/sso.controller.js";
import { SsoService } from "./auth/sso.service.js";
import { DatabaseModule } from "./common/database.js";
import { DbExceptionFilter } from "./common/db-exception.filter.js";
import { MailModule } from "./common/mailer.js";
import { RateLimiter } from "./common/rate-limiter.js";
import { JsonLogger, requestMiddleware } from "./common/observability.js";
import { contextMiddleware } from "./common/request-context.js";
import { CONFIG, type AppConfig } from "./config.js";
import { CrmModule } from "./crm/crm.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { PurchaseModule } from "./purchase/purchase.module.js";
import { IntercompanyModule } from "./intercompany/intercompany.module.js";
import { PortalModule } from "./portal/portal.module.js";
import { ExpenseModule } from "./hr/expense.module.js";
import { HrModule } from "./hr/hr.module.js";
import { PerformanceModule } from "./hr/performance.module.js";
import { RecruitmentModule } from "./hr/recruitment.module.js";
import { PayrollModule } from "./payroll/payroll.module.js";
import { TaxModule } from "./tax/tax.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { ConsolidationModule } from "./consolidation/consolidation.module.js";
import { HealthController } from "./health/health.controller.js";
import { MasterModule } from "./master/master.module.js";
import { SequenceController, SequenceService } from "./sequences/sequence.service.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

@Module({
  imports: [
    DatabaseModule,
    BillingModule,
    MailModule,
    MasterModule,
    AccountingModule,
    CrmModule,
    SalesModule,
    InventoryModule,
    PurchaseModule,
    IntercompanyModule,
    PortalModule,
    HrModule,
    ExpenseModule,
    RecruitmentModule,
    PerformanceModule,
    PayrollModule,
    TaxModule,
    OnboardingModule,
    ConsolidationModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    SsoController,
    ActivityController,
    SequenceController,
    UsersController,
  ],
  providers: [
    AuthService,
    SsoService,
    ActivityService,
    SequenceService,
    UsersService,
    RateLimiter,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: DbExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        contextMiddleware,
        requestMiddleware(new JsonLogger(this.config.logFormat), process.env.NODE_ENV === "production"),
      )
      .forRoutes("*");
  }
}
