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
  Query,
} from "@nestjs/common";
import { eq, schema } from "@erp/db";
import {
  activitySchema,
  convertLeadSchema,
  crmStageSchema,
  leadSchema,
  lostReasonSchema,
  markLostSchema,
  salesTeamSchema,
} from "@erp/shared";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";
import { ScheduleService } from "./activity-schedule.service.js";
import { assertCompanyUser, assertUsers } from "./checks.js";
import { LeadService, type LeadQuery } from "./lead.service.js";

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

  @Get(":id")
  @RequirePermission("crm.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.leads.get(tx, id));
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
    ScheduledActivitiesController,
  ],
  providers: [ActivityService, LeadService, ScheduleService],
  exports: [LeadService],
})
export class CrmModule {}
