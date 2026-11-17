import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import {
  approvalCategorySchema,
  approvalDecisionSchema,
  approvalDelegationSchema,
  approvalRequestSchema,
  allowedFor,
} from "@erp/shared";
import type { Response } from "express";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ApprovalEngineService } from "./approval-engine.service.js";
import { HrModule } from "./hr.module.js";

/**
 * Kategori persetujuan: dibaca semua user perusahaan (untuk membuat permintaan). Diatur dari Pengaturan › Aturan
 * Persetujuan oleh pemegang `approval.manage` atau HR (`hr.manage`).
 */
function assertCanManage(method: "POST" | "PUT" | "DELETE") {
  const granted = currentContext().permissions;
  const request = { path: "/approval-categories", method };
  if (!allowedFor(granted, "approval.manage", request) && !allowedFor(granted, "hr.manage", request))
    throw new ForbiddenException("Butuh permission approval.manage atau hr.manage");
}

@Controller("approval-categories")
class ApprovalCategoriesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService,
  ) {}

  @Get()
  list(@Query("active") active?: string) {
    return this.tenantDb.run((tx) => this.engine.listCategories(tx, active === "1"));
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.engine.getCategory(tx, id));
  }

  @Post()
  create(@Body() body: unknown) {
    assertCanManage("POST");
    const input = parse(approvalCategorySchema, body);
    return this.tenantDb.run((tx) => this.engine.saveCategory(tx, null, input));
  }

  @Put(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    assertCanManage("PUT");
    const input = parse(approvalCategorySchema, body);
    return this.tenantDb.run((tx) => this.engine.saveCategory(tx, id, input));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    assertCanManage("DELETE");
    await this.tenantDb.run((tx) => this.engine.removeCategory(tx, id));
  }
}

/** Permintaan persetujuan: dibuat user mana pun; `mine=1` milik sendiri, `review=1` menunggu saya, lainnya hr.read. */
@Controller("approval-requests")
class ApprovalRequestsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService,
  ) {}

  @Get()
  list(@Query() query: { mine?: string; review?: string; state?: string; categoryId?: string }) {
    return this.tenantDb.run((tx) => this.engine.listRequests(tx, query));
  }

  @Get("summary")
  summary() {
    return this.tenantDb.run((tx) => this.engine.summary(tx));
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.engine.getRequest(tx, id));
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(approvalRequestSchema, body);
    return this.tenantDb.run((tx) => this.engine.createRequest(tx, input));
  }

  @Put(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(approvalRequestSchema, body);
    return this.tenantDb.run((tx) => this.engine.updateRequest(tx, id, input));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.engine.removeRequest(tx, id));
  }

  @Post(":id/submit")
  @HttpCode(200)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.engine.submit(tx, id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.engine.cancel(tx, id));
  }

  @Get(":id/attachment")
  async attachment(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.engine.attachment(tx, id));
    res.type(file.type).attachment(file.name).send(file.data);
  }

  @Post(":id/:decision")
  @HttpCode(200)
  decide(@Param("id", ParseUUIDPipe) id: string, @Param("decision") decision: string, @Body() body: unknown) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) =>
      this.engine.decide(tx, id, decision === "approve" ? "approved" : "refused", input.note),
    );
  }
}

/** Delegasi penyetuju: milik sendiri (atau semua dengan `all=1`, hr.manage). */
@Controller("approval-delegations")
class ApprovalDelegationsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService,
  ) {}

  @Get()
  list(@Query("all") all?: string) {
    return this.tenantDb.run((tx) => this.engine.listDelegations(tx, all === "1"));
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(approvalDelegationSchema, body);
    return this.tenantDb.run((tx) => this.engine.createDelegation(tx, input));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.engine.removeDelegation(tx, id));
  }
}

/** Mesin persetujuan generik (kategori, permintaan, delegasi). */
@Module({
  imports: [HrModule],
  controllers: [ApprovalCategoriesController, ApprovalRequestsController, ApprovalDelegationsController],
})
export class ApprovalRequestModule {}
