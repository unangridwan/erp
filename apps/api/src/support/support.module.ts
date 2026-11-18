import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { eq, schema, sql, type Db } from "@erp/db";
import {
  inboundEmailSchema,
  portalTicketReplySchema,
  portalTicketSchema,
  slaPolicyError,
  slaPolicySchema,
  supportArticleSchema,
  supportSettingsSchema,
  supportTeamSchema,
  ticketMessageSchema,
  ticketRatingSchema,
  ticketSchema,
} from "@erp/shared";
import type { Request } from "express";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { fieldError } from "../accounting/context.js";
import { Public, RequirePermission } from "../auth/decorators.js";
import { parseTenantToken } from "../common/crypto.js";
import { createCrudController } from "../common/crud.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { currentContext } from "../common/request-context.js";
import { parse, parsePartial } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { assertCompanyUser, assertUsers } from "../crm/checks.js";
import { PortalGuard } from "../portal/portal.controller.js";
import { PortalModule } from "../portal/portal.module.js";
import type { PortalPrincipal } from "../portal/portal.service.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { SupportService, type TicketQuery } from "./support.service.js";

const TeamsController = createCrudController({
  path: "support/teams",
  model: "support_team",
  table: schema.supportTeams,
  schema: supportTeamSchema,
  read: "support.read",
  write: "support.manage",
  searchColumns: [schema.supportTeams.name],
  orderBy: schema.supportTeams.name,
  companyColumn: schema.supportTeams.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    if (typeof values.leaderId === "string") await assertCompanyUser(tx, values.leaderId, "leaderId");
    if (Array.isArray(values.memberIds)) await assertUsers(tx, values.memberIds as string[], "memberIds");
  },
});

const SlaPoliciesController = createCrudController({
  path: "support/sla-policies",
  model: "support_sla_policy",
  table: schema.supportSlaPolicies,
  schema: slaPolicySchema,
  read: "support.read",
  write: "support.manage",
  searchColumns: [schema.supportSlaPolicies.name],
  orderBy: schema.supportSlaPolicies.priority,
  companyColumn: schema.supportSlaPolicies.companyId,
  perCompany: true,
  refs: { teamId: schema.supportTeams },
  beforeSave: async (tx, values, id) => {
    let merged = values as { firstResponseHours?: string; resolutionHours?: string };
    if (id && (merged.firstResponseHours === undefined || merged.resolutionHours === undefined)) {
      const [row] = await tx
        .select()
        .from(schema.supportSlaPolicies)
        .where(eq(schema.supportSlaPolicies.id, id));
      merged = {
        firstResponseHours: row?.firstResponseHours,
        resolutionHours: row?.resolutionHours,
        ...merged,
      };
    }
    const error = slaPolicyError(merged);
    if (error) throw fieldError(error[0], error[1]);
  },
});

const ArticlesController = createCrudController({
  path: "support/articles",
  model: "support_article",
  table: schema.supportArticles,
  schema: supportArticleSchema,
  read: "support.read",
  write: "support.manage",
  searchColumns: [schema.supportArticles.title, schema.supportArticles.category, schema.supportArticles.body],
  orderBy: schema.supportArticles.title,
  companyColumn: schema.supportArticles.companyId,
  perCompany: true,
  beforeSave: async (_tx, values) => {
    if (values.published === true) values.publishedAt ??= new Date();
  },
});

const period = z.object({ from: z.string().date().optional(), to: z.string().date().optional() });

@Controller("support")
class SupportController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SupportService) private readonly support: SupportService,
  ) {}

  @Get("tickets")
  @RequirePermission("support.read")
  list(@Query() query: TicketQuery) {
    return this.tenantDb.run((tx) => this.support.list(tx, query));
  }

  @Get("tickets/:id")
  @RequirePermission("support.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.support.get(tx, id));
  }

  @Post("tickets")
  @RequirePermission("support.write")
  create(@Body() body: unknown) {
    const input = parse(ticketSchema, body);
    const ctx = currentContext();
    return this.tenantDb.run(async (tx) => {
      const ticket = await this.support.create(tx, input, {
        companyId: ctx.companyId,
        createdBy: ctx.userId,
      });
      return this.support.get(tx, ticket.id);
    });
  }

  @Patch("tickets/:id")
  @RequirePermission("support.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    // Waktu diterima hanya diisi saat tiket dibuat (tenggat SLA & nomor bergantung padanya).
    const { receivedAt: _receivedAt, ...values } = parsePartial(ticketSchema, body);
    return this.tenantDb.run((tx) => this.support.update(tx, id, values));
  }

  @Post("tickets/:id/messages")
  @HttpCode(200)
  @RequirePermission("support.write")
  message(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(ticketMessageSchema, body);
    return this.tenantDb.run((tx) => this.support.addMessage(tx, id, input));
  }

  @Get("reports")
  @RequirePermission("support.read")
  report(@Query() query: unknown) {
    const p = parse(period, query);
    return this.tenantDb.run((tx) => this.support.report(tx, p.from, p.to));
  }

  @Get("settings")
  @RequirePermission("support.read")
  settings() {
    return this.tenantDb.run((tx) => this.support.getSettings(tx));
  }

  @Put("settings")
  @RequirePermission("support.manage")
  saveSettings(@Body() body: unknown) {
    const input = parse(supportSettingsSchema, body);
    return this.tenantDb.run((tx) => this.support.saveSettings(tx, input));
  }

  @Post("settings/inbound-key")
  @HttpCode(200)
  @RequirePermission("support.manage")
  rotate() {
    return this.tenantDb.run((tx) => this.support.rotateInboundKey(tx));
  }
}

/** Webhook email masuk (layanan email meneruskan email ke sini): kunci per perusahaan di URL. */
@Controller("public/support")
class InboundController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Post("inbound/:key")
  @HttpCode(200)
  async inbound(@Param("key") key: string, @Body() body: unknown, @Req() req: Request) {
    await this.limiter.consume(`support-inbound:${req.ip ?? "unknown"}`, 600, 15 * 60_000);
    const parsed = parseTenantToken(key);
    if (!parsed) throw fieldError("key", "Kunci email masuk tidak dikenal");
    const input = parse(inboundEmailSchema, body);
    return this.tenantDb.runAs(parsed.tenantId, async (tx) => {
      const companyId = await this.support.companyForInboundKey(tx, parsed.hash);
      return this.support.inbound(tx, companyId, input);
    });
  }
}

type PortalRequest = Request & { portal?: PortalPrincipal };

/** Tiket & basis pengetahuan di portal pelanggan. */
@Public()
@UseGuards(PortalGuard)
@Controller("portal")
class PortalSupportController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SupportService) private readonly support: SupportService,
  ) {}

  @Get("tickets")
  tickets(@Req() req: PortalRequest) {
    return this.tenantDb.run((tx) => this.support.portalList(tx, req.portal!.partnerId));
  }

  @Post("tickets")
  create(@Req() req: PortalRequest, @Body() body: unknown) {
    const input = parse(portalTicketSchema, body);
    return this.tenantDb.run((tx) => this.support.portalCreate(tx, req.portal!, input));
  }

  @Get("tickets/:id")
  ticket(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.support.portalGet(tx, req.portal!.partnerId, id));
  }

  @Post("tickets/:id/messages")
  @HttpCode(200)
  reply(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(portalTicketReplySchema, body);
    return this.tenantDb.run((tx) => this.support.portalReply(tx, req.portal!, id, input.body));
  }

  @Post("tickets/:id/rating")
  @HttpCode(200)
  rate(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(ticketRatingSchema, body);
    return this.tenantDb.run((tx) =>
      this.support.portalRate(tx, req.portal!.partnerId, id, input.satisfaction, input.note),
    );
  }

  @Get("articles")
  articles(@Req() req: PortalRequest, @Query("q") q?: string) {
    return this.tenantDb.run((tx) =>
      this.support.portalArticles(tx, req.portal!.partnerId, q?.slice(0, 100)),
    );
  }

  @Post("articles/:id/view")
  @HttpCode(204)
  async viewed(@Req() req: PortalRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.support.portalArticleViewed(tx, req.portal!.partnerId, id));
  }
}

/** Job SLA: tiap 5 menit tandai pelanggaran, eskalasikan, dan tutup otomatis tiket selesai. */
@Injectable()
export class SupportScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Support");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SupportService) private readonly support: SupportService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.support.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "support" });
        }),
      5 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async runDue(now = new Date(), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (
        await this.ownerDb
          .selectDistinct({ id: schema.supportTickets.tenantId })
          .from(schema.supportTickets)
          .where(sql`${schema.supportTickets.status} in ('new', 'open', 'pending', 'resolved')`)
      ).map((t) => t.id);
    const total = { escalated: 0, closed: 0 };
    for (const tenantId of tenants) {
      const r = await this.tenantDb
        .runAs(tenantId, (tx) => this.support.checkSla(tx, now))
        .catch((e: unknown) => {
          this.logger.warn(`Support tenant ${tenantId}: ${(e as Error).message}`);
          return { escalated: 0, closed: 0 };
        });
      total.escalated += r.escalated;
      total.closed += r.closed;
    }
    return total;
  }
}

@Module({
  imports: [PortalModule],
  controllers: [
    SupportController,
    InboundController,
    PortalSupportController,
    TeamsController,
    SlaPoliciesController,
    ArticlesController,
  ],
  providers: [SupportService, SupportScheduler, SequenceService, ActivityService, RateLimiter],
  exports: [SupportService, SupportScheduler],
})
export class SupportModule {}
