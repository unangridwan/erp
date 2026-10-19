import { Module } from "@nestjs/common";
import { ActivityService } from "../activity/activity.service.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { SalesModule } from "../sales/sales.module.js";
import {
  PortalAdminController,
  PortalAuthController,
  PortalController,
  PortalGuard,
} from "./portal.controller.js";
import { PortalService } from "./portal.service.js";

/** Portal pelanggan (akun & API terpisah dari user internal). */
@Module({
  imports: [SalesModule],
  controllers: [PortalAuthController, PortalController, PortalAdminController],
  providers: [ActivityService, RateLimiter, PortalService, PortalGuard],
})
export class PortalModule {}
