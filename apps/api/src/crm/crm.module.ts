import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { eq, schema } from "@erp/db";
import {
  activitySchema,
  assignmentRuleSchema,
  campaignEmailSchema,
  campaignError,
  campaignMembersSchema,
  campaignSchema,
  scoringRuleSchema,
  webFormSchema,
  contactRolesSchema,
  convertLeadSchema,
  crmStageSchema,
  forecastAdjustmentSchema,
  leadProductsSchema,
  leadSchema,
  lostReasonSchema,
  markLostSchema,
  mergeLeadsSchema,
  quotasSchema,
  salesTeamSchema,
  territorySchema,
} from "@erp/shared";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { parse, parsePartial } from "../common/zod.js";
import { Public } from "../auth/decorators.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { fieldError } from "../accounting/context.js";
import type { Request, Response } from "express";
import { MarketingService } from "./marketing.service.js";
import { ScheduleService } from "./activity-schedule.service.js";
import { assertCompanyUser, assertUsers } from "./checks.js";
import { ForecastService } from "./forecast.service.js";
import { LeadService, type LeadQuery } from "./lead.service.js";
import { SalesCloudService } from "./sales-cloud.service.js";

const period = (from?: string, to?: string) => {
  const date = z.string().date().optional();
  return [parse(date, from), parse(date, to)] as const;
};

const StagesController = createCrudController({
  path: "crm-stages",
  model: "crm_stage",
  table: schema.crmStages,
  schema: crmStageSchema,
  read: "crm.read",
  write: "crm.manage",
  searchColumns: [schema.crmStages.name],
  orderBy: schema.crmStages.sequence,
  beforeDelete: async (tx, row) => {
    const [used] = await tx
      .select({ id: schema.crmLeads.id })
      .from(schema.crmLeads)
      .where(eq(schema.crmLeads.stageId, String(row.id)))
      .limit(1);
    if (used) throw new BadRequestException("Tahap masih dipakai lead; pindahkan lead-nya dulu");
  },
});

const LostReasonsController = createCrudController({
  path: "lost-reasons",
  model: "crm_lost_reason",
  table: schema.crmLostReasons,
  schema: lostReasonSchema,
  read: "crm.read",
  write: "crm.manage",
  searchColumns: [schema.crmLostReasons.name],
  orderBy: schema.crmLostReasons.name,
});

const SalesTeamsController = createCrudController({
  path: "sales-teams",
  model: "sales_team",
  table: schema.salesTeams,
  schema: salesTeamSchema,
  read: "crm.read",
  write: "crm.manage",
  searchColumns: [schema.salesTeams.name],
  orderBy: schema.salesTeams.name,
  companyColumn: schema.salesTeams.companyId,
  refs: { companyId: schema.companies },
  beforeSave: async (tx, values) => {
    if (typeof values.leaderId === "string") await assertCompanyUser(tx, values.leaderId, "leaderId");
    if (Array.isArray(values.memberIds)) await assertUsers(tx, values.memberIds as string[], "memberIds");
  },
});

@Controller("leads")
class LeadsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(SalesCloudService) private readonly cloud: SalesCloudService,
  ) {}

  @Get()
  @RequirePermission("crm.read")
  list(@Query() query: LeadQuery) {
    return this.tenantDb.run((tx) => this.leads.list(tx, query));
  }

  @Get("pipeline")
  @RequirePermission("crm.read")
  pipeline(@Query("from") from?: string, @Query("to") to?: string) {
    const date = z.string().date().optional();
    return this.tenantDb.run((tx) => this.leads.pipeline(tx, parse(date, from), parse(date, to)));
  }

  /** Corong lead → peluang → menang. Didaftarkan sebelum `:id`. */
  @Get("reports/funnel")
  @RequirePermission("crm.read")
  funnel(@Query("from") from?: string, @Query("to") to?: string) {
    const [f, t] = period(from, to);
    return this.tenantDb.run((tx) => this.cloud.funnel(tx, f, t));
  }

  @Get("reports/velocity")
  @RequirePermission("crm.read")
  velocity(@Query("from") from?: string, @Query("to") to?: string) {
    const [f, t] = period(from, to);
    return this.tenantDb.run((tx) => this.cloud.velocity(tx, f, t));
  }

  @Get(":id")
  @RequirePermission("crm.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.cloud.detail(tx, id));
  }

  @Get(":id/duplicates")
  @RequirePermission("crm.read")
  duplicates(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.cloud.duplicates(tx, id));
  }

  @Put(":id/products")
  @RequirePermission("crm.write")
  products(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(leadProductsSchema, body);
    return this.tenantDb.run((tx) => this.cloud.setProducts(tx, id, input));
  }

  @Put(":id/contact-roles")
  @RequirePermission("crm.write")
  contactRoles(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(contactRolesSchema, body);
    return this.tenantDb.run((tx) => this.cloud.setContactRoles(tx, id, input));
  }

  @Post(":id/merge")
  @HttpCode(200)
  @RequirePermission("crm.write")
  merge(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(mergeLeadsSchema, body);
    return this.tenantDb.run((tx) => this.cloud.merge(tx, id, input.sourceIds));
  }

  @Post()
  @RequirePermission("crm.write")
  create(@Body() body: unknown) {
    const input = parse(leadSchema, body);
    return this.tenantDb.run((tx) => this.leads.create(tx, input));
  }

  @Patch(":id")
  @RequirePermission("crm.write")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const values = parse(leadSchema.partial().strip(), body);
    // Hanya field yang dikirim yang diubah (default zod tidak menimpa nilai lama).
    const sent = Object.fromEntries(
      Object.entries(values).filter(([k]) => body !== null && typeof body === "object" && k in body),
    );
    return this.tenantDb.run((tx) => this.leads.update(tx, id, sent));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("crm.write")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.leads.remove(tx, id));
  }

  @Post(":id/won")
  @HttpCode(200)
  @RequirePermission("crm.write")
  won(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leads.markWon(tx, id));
  }

  @Post(":id/lost")
  @HttpCode(200)
  @RequirePermission("crm.write")
  lost(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(markLostSchema, body ?? {});
    return this.tenantDb.run((tx) => this.leads.markLost(tx, id, input));
  }

  @Post(":id/reopen")
  @HttpCode(200)
  @RequirePermission("crm.write")
  reopen(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leads.reopen(tx, id));
  }

  @Post(":id/convert")
  @HttpCode(200)
  @RequirePermission("crm.write")
  convert(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(convertLeadSchema, body ?? {});
    return this.tenantDb.run((tx) => this.leads.convert(tx, id, input));
  }
}

/** Akun (perusahaan pelanggan) & kontak (perorangan) dengan tampilan 360°. */
@Controller("crm")
class AccountsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SalesCloudService) private readonly cloud: SalesCloudService,
  ) {}

  @Get("accounts")
  @RequirePermission("crm.read")
  accounts(@Query("kind") kind?: string) {
    const k = parse(z.enum(["company", "person"]).default("company"), kind);
    return this.tenantDb.run((tx) => this.cloud.accounts(tx, k));
  }

  @Get("accounts/:id")
  @RequirePermission("crm.read")
  account(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.cloud.account360(tx, id));
  }
}

const TerritoriesController = createCrudController({
  path: "crm/territories",
  model: "crm_territory",
  table: schema.crmTerritories,
  schema: territorySchema,
  read: "crm.read",
  write: "crm.manage",
  searchColumns: [schema.crmTerritories.name],
  orderBy: schema.crmTerritories.sequence,
  companyColumn: schema.crmTerritories.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    if (typeof values.managerId === "string") await assertCompanyUser(tx, values.managerId, "managerId");
    if (Array.isArray(values.memberIds)) await assertUsers(tx, values.memberIds as string[], "memberIds");
  },
});

const yearSchema = z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear());

/** Forecast, kuota penjualan, dan penerapan aturan wilayah. */
@Controller("crm")
class ForecastController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ForecastService) private readonly forecasts: ForecastService,
  ) {}

  @Get("forecast")
  @RequirePermission("crm.read")
  forecast(@Query("period") period?: string) {
    const key = parse(z.string().min(7).max(7), period);
    return this.tenantDb.run((tx) => this.forecasts.forecast(tx, key));
  }

  @Get("forecast/attainment")
  @RequirePermission("crm.read")
  attainment(@Query("year") year?: string) {
    const y = parse(yearSchema, year);
    return this.tenantDb.run((tx) => this.forecasts.attainment(tx, y));
  }

  @Put("forecast/adjustments")
  @RequirePermission("crm.write")
  adjust(@Body() body: unknown) {
    const input = parse(forecastAdjustmentSchema, body);
    return this.tenantDb.run((tx) => this.forecasts.adjust(tx, input));
  }

  @Get("quotas")
  @RequirePermission("crm.read")
  quotas(@Query("year") year?: string) {
    const y = parse(yearSchema, year);
    return this.tenantDb.run((tx) => this.forecasts.quotas(tx, y));
  }

  @Put("quotas")
  @RequirePermission("crm.manage")
  saveQuotas(@Body() body: unknown) {
    const input = parse(quotasSchema, body);
    return this.tenantDb.run((tx) => this.forecasts.saveQuotas(tx, input));
  }

  @Get("territory-report")
  @RequirePermission("crm.read")
  territoryReport() {
    return this.tenantDb.run((tx) => this.forecasts.territoryReport(tx));
  }

  @Post("territory-assign")
  @HttpCode(200)
  @RequirePermission("crm.manage")
  assign() {
    return this.tenantDb.run((tx) => this.forecasts.assignTerritories(tx));
  }
}

const CampaignsController = createCrudController({
  path: "crm/campaigns",
  model: "crm_campaign",
  table: schema.crmCampaigns,
  schema: campaignSchema,
  read: "crm.read",
  write: "crm.write",
  searchColumns: [schema.crmCampaigns.name],
  orderBy: schema.crmCampaigns.name,
  companyColumn: schema.crmCampaigns.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    const error = campaignError(values as { dateStart?: string | null; dateEnd?: string | null });
    if (error) throw fieldError(error[0], error[1]);
    if (typeof values.userId === "string") await assertCompanyUser(tx, values.userId);
  },
});

const ScoringRulesController = createCrudController({
  path: "crm/scoring-rules",
  model: "crm_scoring_rule",
  table: schema.crmScoringRules,
  schema: scoringRuleSchema,
  read: "crm.read",
  write: "crm.manage",
  searchColumns: [schema.crmScoringRules.name],
  orderBy: schema.crmScoringRules.name,
  companyColumn: schema.crmScoringRules.companyId,
  perCompany: true,
});

const AssignmentRulesController = createCrudController({
  path: "crm/assignment-rules",
  model: "crm_assignment_rule",
  table: schema.crmAssignmentRules,
  schema: assignmentRuleSchema,
  read: "crm.read",
  write: "crm.manage",
  searchColumns: [schema.crmAssignmentRules.name],
  orderBy: schema.crmAssignmentRules.sequence,
  companyColumn: schema.crmAssignmentRules.companyId,
  perCompany: true,
  refs: { teamId: schema.salesTeams },
  beforeSave: async (tx, values) => {
    if (Array.isArray(values.userIds))
      for (const id of values.userIds as string[]) await assertCompanyUser(tx, id, "userIds");
  },
});

const memberStatusSchema = z.object({ status: z.enum(["targeted", "sent", "responded"]) });

/** Kampanye (hasil, anggota, email massal), skor, penugasan, dan formulir web. */
@Controller("crm")
class MarketingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MarketingService) private readonly marketing: MarketingService,
  ) {}

  @Get("campaign-stats")
  @RequirePermission("crm.read")
  stats() {
    return this.tenantDb.run(async (tx) => ({ items: await this.marketing.stats(tx) }));
  }

  @Get("campaign-stats/:id")
  @RequirePermission("crm.read")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.marketing.detail(tx, id));
  }

  @Post("campaigns/:id/members")
  @HttpCode(200)
  @RequirePermission("crm.write")
  addMembers(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(campaignMembersSchema, body ?? {});
    return this.tenantDb.run((tx) => this.marketing.addMembers(tx, id, input));
  }

  @Patch("campaigns/:id/members/:memberId")
  @RequirePermission("crm.write")
  memberStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Body() body: unknown,
  ) {
    const input = parse(memberStatusSchema, body);
    return this.tenantDb.run((tx) => this.marketing.setMemberStatus(tx, id, memberId, input.status));
  }

  @Delete("campaigns/:id/members/:memberId")
  @HttpCode(204)
  @RequirePermission("crm.write")
  async removeMember(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
  ) {
    await this.tenantDb.run((tx) => this.marketing.removeMember(tx, id, memberId));
  }

  @Post("campaigns/:id/emails")
  @HttpCode(200)
  @RequirePermission("crm.write")
  sendEmail(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(campaignEmailSchema, body);
    return this.tenantDb.run((tx) => this.marketing.sendEmail(tx, id, input));
  }

  @Post("scoring-recompute")
  @HttpCode(200)
  @RequirePermission("crm.manage")
  recompute() {
    return this.tenantDb.run((tx) => this.marketing.recomputeScores(tx));
  }

  @Post("assignment-apply")
  @HttpCode(200)
  @RequirePermission("crm.manage")
  applyAssignment() {
    return this.tenantDb.run((tx) => this.marketing.applyAssignment(tx));
  }

  @Get("web-forms")
  @RequirePermission("crm.read")
  forms() {
    return this.tenantDb.run((tx) => this.marketing.forms(tx));
  }

  @Post("web-forms")
  @RequirePermission("crm.manage")
  createForm(@Body() body: unknown) {
    const input = parse(webFormSchema, body);
    return this.tenantDb.run((tx) => this.marketing.createForm(tx, input));
  }

  @Patch("web-forms/:id")
  @RequirePermission("crm.manage")
  updateForm(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const values = parsePartial(webFormSchema, body);
    return this.tenantDb.run((tx) => this.marketing.updateForm(tx, id, values));
  }

  @Delete("web-forms/:id")
  @HttpCode(204)
  @RequirePermission("crm.manage")
  async removeForm(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.marketing.removeForm(tx, id));
  }

  @Post("web-forms/:id/rotate-key")
  @HttpCode(200)
  @RequirePermission("crm.manage")
  rotateKey(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.marketing.rotateKey(tx, id));
  }
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, message: string) =>
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center"><h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;

/** Endpoint publik tanpa login: formulir web-to-lead dan berhenti langganan email kampanye. */
@Controller("public")
class PublicMarketingController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MarketingService) private readonly marketing: MarketingService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Get("web-forms/:key")
  async form(@Param("key") key: string, @Req() req: Request) {
    await this.limiter.consume(`web-form-view:${req.ip ?? "unknown"}`, 120, 15 * 60_000);
    const { tenantId, hash } = this.marketing.parseKey(key);
    return this.tenantDb.runAs(tenantId, (tx) => this.marketing.publicConfig(tx, hash));
  }

  /** Menerima JSON (halaman formulir ERP) atau form HTML biasa (dipasang di situs lain → balasan halaman/redirect). */
  @Public()
  @Post("web-forms/:key")
  @HttpCode(200)
  async submit(@Param("key") key: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { tenantId, hash } = this.marketing.parseKey(key);
    await this.limiter.consume(`web-form:${req.ip ?? "unknown"}`, 20, 15 * 60_000);
    await this.limiter.consume(`web-form-key:${hash}`, 300, 60 * 60_000);
    const result = await this.tenantDb.runAs(tenantId, (tx) => this.marketing.submit(tx, hash, body));
    if (req.is("application/json")) return res.json({ ok: true, message: result.message });
    if (result.redirectUrl) return res.redirect(303, result.redirectUrl);
    return res
      .type("html")
      .send(
        page(
          "Terima kasih",
          result.message ?? "Data Anda sudah kami terima. Kami akan segera menghubungi Anda.",
        ),
      );
  }

  @Public()
  @Get("crm/unsubscribe/:token")
  async unsubscribe(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    await this.limiter.consume(`crm-unsubscribe:${req.ip ?? "unknown"}`, 30, 15 * 60_000);
    const parsed = this.marketing.parseUnsubscribeToken(token);
    const ok = parsed
      ? await this.tenantDb.runAs(parsed.tenantId, (tx) => this.marketing.unsubscribe(tx, parsed.memberId))
      : false;
    res
      .status(ok ? 200 : 404)
      .type("html")
      .send(
        ok
          ? page("Berhenti langganan berhasil", "Anda tidak akan menerima email kampanye dari kami lagi.")
          : page("Tautan tidak berlaku", "Tautan berhenti langganan ini tidak dikenali."),
      );
  }
}

const doneSchema = z.object({ feedback: z.string().trim().max(2000).nullish() });

/** Aktivitas terjadwal (telepon, rapat, email, to-do). Permission diperiksa per jenis dokumen. */
@Controller("activities")
class ScheduledActivitiesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ScheduleService) private readonly schedule: ScheduleService,
  ) {}

  @Get()
  list(@Query("resModel") resModel: string, @Query("resId") resId: string) {
    const query = parse(activitySchema.pick({ resModel: true, resId: true }), { resModel, resId });
    return this.tenantDb.run((tx) => this.schedule.listFor(tx, query.resModel, query.resId));
  }

  @Get("mine")
  mine() {
    return this.tenantDb.run((tx) => this.schedule.mine(tx));
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(activitySchema, body);
    return this.tenantDb.run((tx) => this.schedule.create(tx, input));
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(activitySchema.omit({ resModel: true, resId: true }).partial().strip(), body);
    const sent = Object.fromEntries(
      Object.entries(input).filter(([k]) => body !== null && typeof body === "object" && k in body),
    );
    return this.tenantDb.run((tx) => this.schedule.update(tx, id, sent));
  }

  @Post(":id/done")
  @HttpCode(200)
  done(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(doneSchema, body ?? {});
    return this.tenantDb.run((tx) => this.schedule.done(tx, id, input.feedback));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.schedule.remove(tx, id));
  }
}

@Module({
  controllers: [
    StagesController,
    LostReasonsController,
    SalesTeamsController,
    LeadsController,
    AccountsController,
    ForecastController,
    TerritoriesController,
    MarketingController,
    PublicMarketingController,
    CampaignsController,
    ScoringRulesController,
    AssignmentRulesController,
    ScheduledActivitiesController,
  ],
  providers: [
    ActivityService,
    ForecastService,
    LeadService,
    MarketingService,
    RateLimiter,
    SalesCloudService,
    ScheduleService,
  ],
  exports: [LeadService],
})
export class CrmModule {}
