import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
} from "@nestjs/common";
import { and, desc, eq, inArray, schema, type Db } from "@erp/db";
import {
  AUTOMATION_FIELDS,
  automationRuleSchema,
  automationRunSchema,
  CUSTOM_FIELD_MODELS,
  PARTNER_FIELD,
  RESPONSIBLE_FIELD,
  type AutomationField,
  type AutomationRuleInput,
  type CustomFieldModel,
} from "@erp/shared";
import { randomBytes } from "node:crypto";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { encrypt } from "../common/crypto.js";
import { TenantDb } from "../common/database.js";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { loadCustomDefs } from "../customization/custom-values.js";
import { HrModule } from "../hr/hr.module.js";
import { AutomationEngine, MODEL_TABLES } from "./automation.engine.js";

const RULE = schema.automationRules;
const RUN = schema.automationRuns;
type Rule = typeof RULE.$inferSelect;

const isModel = (m: string): m is CustomFieldModel => m in CUSTOM_FIELD_MODELS;
const CUSTOM_TYPE: Record<string, AutomationField["type"]> = {
  number: "number",
  money: "number",
  date: "date",
  boolean: "boolean",
  select: "select",
};

/** Pengaturan › Aturan Otomatis: pemicu → syarat → aksi, uji coba, dan log eksekusi. */
@Controller("automation-rules")
@RequirePermission("customization.manage")
export class AutomationController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AutomationEngine) private readonly engine: AutomationEngine,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Field yang bisa dipakai di syarat/isian/tanggal untuk satu model (termasuk field kustom). */
  private async fields(tx: Db, model: CustomFieldModel): Promise<AutomationField[]> {
    const custom = await loadCustomDefs(tx, model, { activeOnly: true });
    return [
      ...AUTOMATION_FIELDS[model],
      ...custom.map((d) => ({
        key: `custom.${d.key}`,
        label: [d.label, d.labelEn || d.label] as [string, string],
        type: CUSTOM_TYPE[d.fieldType] ?? "text",
        ...(d.options?.length
          ? { options: d.options.map((o) => [o.value, [o.label, o.label]] as [string, [string, string]]) }
          : {}),
      })),
    ];
  }

  @Get("fields")
  fieldList(@Query("model") model: string) {
    if (!isModel(model)) throw new BadRequestException("Model tidak dikenal");
    return this.tenantDb.run(async (tx) => ({
      fields: await this.fields(tx, model),
      responsible: RESPONSIBLE_FIELD[model] ?? null,
    }));
  }

  @Get()
  list() {
    return this.tenantDb.run(async (tx) => {
      const rules = await tx
        .select()
        .from(RULE)
        .where(eq(RULE.companyId, currentContext().companyId))
        .orderBy(RULE.name);
      const last = rules.length
        ? await tx
            .selectDistinctOn([RUN.ruleId], { ruleId: RUN.ruleId, status: RUN.status, at: RUN.createdAt })
            .from(RUN)
            .where(
              inArray(
                RUN.ruleId,
                rules.map((r) => r.id),
              ),
            )
            .orderBy(RUN.ruleId, desc(RUN.createdAt))
        : [];
      const byRule = new Map(last.map((l) => [l.ruleId, l]));
      return rules.map((r) => ({ ...this.view(r), lastRun: byRule.get(r.id) ?? null }));
    });
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => this.view(await this.find(tx, id)));
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(automationRuleSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.validate(tx, input);
      const ctx = currentContext();
      const secret = this.needsSecret(input) ? randomBytes(24).toString("base64url") : null;
      const [row] = await tx
        .insert(RULE)
        .values({
          ...this.values(input),
          companyId: ctx.companyId,
          ownerId: ctx.userId,
          webhookSecretEnc: secret ? encrypt(secret, this.config.encryptionKey) : null,
        })
        .returning();
      await this.activity.log(tx, {
        resModel: "automation_rule",
        resId: row!.id,
        action: "create",
        message: row!.name,
      });
      return { ...this.view(row!), webhookSecret: secret };
    });
  }

  @Put(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(automationRuleSchema, body);
    return this.tenantDb.run(async (tx) => {
      const rule = await this.find(tx, id);
      await this.validate(tx, input);
      const ctx = currentContext();
      const secret =
        this.needsSecret(input) && !rule.webhookSecretEnc ? randomBytes(24).toString("base64url") : null;
      const [row] = await tx
        .update(RULE)
        .set({
          ...this.values(input),
          // Aturan dijalankan dengan hak pengubah terakhir (yang sudah memeriksa isinya).
          ownerId: ctx.userId,
          ...(secret ? { webhookSecretEnc: encrypt(secret, this.config.encryptionKey) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(RULE.id, id))
        .returning();
      await this.activity.log(tx, {
        resModel: "automation_rule",
        resId: id,
        action: "update",
        message: row!.name,
      });
      return { ...this.view(row!), webhookSecret: secret };
    });
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const rule = await this.find(tx, id);
      await tx.delete(RULE).where(eq(RULE.id, id));
      await this.activity.log(tx, {
        resModel: "automation_rule",
        resId: id,
        action: "delete",
        message: rule.name,
      });
    });
  }

  /** Buat ulang rahasia webhook (ditampilkan sekali). */
  @Post(":id/webhook-secret")
  rotateSecret(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      const secret = randomBytes(24).toString("base64url");
      await tx
        .update(RULE)
        .set({ webhookSecretEnc: encrypt(secret, this.config.encryptionKey) })
        .where(eq(RULE.id, id));
      return { webhookSecret: secret };
    });
  }

  /**
   * Jalankan sekarang: untuk satu data (`resId`, wajib bagi pemicu dibuat/diubah) atau, untuk pemicu tanggal/jadwal,
   * semua data yang memenuhi syarat. Syarat tetap diperiksa; aksi benar-benar dijalankan.
   */
  @Post(":id/run")
  @HttpCode(200)
  async run(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { resId } = parse(automationRunSchema, body ?? {});
    const ctx = currentContext();
    const rule = await this.tenantDb.run((tx) => this.find(tx, id));
    if (!resId) {
      if (rule.trigger === "created" || rule.trigger === "updated")
        throw fieldError("resId", "Pilih data untuk menguji aturan ini");
      const executed = await this.engine.scanRule(ctx.tenantId, rule, new Date(), true);
      return { executed };
    }
    const record = await this.tenantDb.run((tx) =>
      this.engine.loadRecord(tx, rule.model as CustomFieldModel, resId),
    );
    if (!record || (record.company_id && record.company_id !== rule.companyId))
      throw new NotFoundException("Data tidak ditemukan");
    const result = await this.engine.execute(ctx.tenantId, rule, resId, "manual", null, 0);
    return { executed: 1, ...result };
  }

  @Get(":id/runs")
  runs(@Param("id", ParseUUIDPipe) id: string, @Query("limit") limit?: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id);
      return tx
        .select()
        .from(RUN)
        .where(eq(RUN.ruleId, id))
        .orderBy(desc(RUN.createdAt))
        .limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
    });
  }

  /** Data contoh untuk dipilih saat uji coba (nama/nomor terbaru). */
  @Get(":id/records")
  records(@Param("id", ParseUUIDPipe) id: string, @Query("q") q?: string) {
    return this.tenantDb.run(async (tx) => {
      const rule = await this.find(tx, id);
      return this.engine.searchRecords(tx, rule, q ?? "");
    });
  }

  // ---- bantu ----

  private async find(tx: Db, id: string): Promise<Rule> {
    const [rule] = await tx
      .select()
      .from(RULE)
      .where(and(eq(RULE.id, id), eq(RULE.companyId, currentContext().companyId)));
    if (!rule) throw new NotFoundException("Aturan otomatis tidak ditemukan");
    return rule;
  }

  private view(r: Rule) {
    const { webhookSecretEnc, tenantId: _t, ...rest } = r;
    return { ...rest, hasWebhookSecret: !!webhookSecretEnc };
  }

  private values(input: AutomationRuleInput) {
    const date = input.trigger === "date";
    const sched = input.trigger === "scheduled";
    return {
      name: input.name,
      description: input.description ?? null,
      model: input.model,
      trigger: input.trigger,
      conditions: input.conditions as unknown as Record<string, unknown>[],
      onlyWhenChanges: input.trigger === "updated" && input.onlyWhenChanges,
      dateField: date ? (input.dateField ?? null) : null,
      offsetDays: date ? input.offsetDays : 0,
      frequency: sched ? (input.frequency ?? null) : null,
      hour: input.hour,
      weekday: sched && input.frequency === "weekly" ? (input.weekday ?? null) : null,
      monthday: sched && input.frequency === "monthly" ? (input.monthday ?? null) : null,
      actions: input.actions as unknown as Record<string, unknown>[],
      active: input.active,
    };
  }

  private needsSecret(input: AutomationRuleInput) {
    return input.actions.some((a) => a.type === "webhook");
  }

  /** Field, pengguna, peran, & kategori yang dirujuk aturan harus ada di perusahaan ini. */
  private async validate(tx: Db, input: AutomationRuleInput) {
    const model = input.model;
    if (!MODEL_TABLES[model]) throw fieldError("model", "Model tidak dikenal");
    const fields = await this.fields(tx, model);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    input.conditions.forEach((c, i) => {
      if (!byKey.has(c.field)) throw fieldError(`conditions.${i}.field`, "Field tidak dikenal");
    });
    if (input.trigger === "date") {
      const f = byKey.get(input.dateField ?? "");
      if (!f || f.type !== "date") throw fieldError("dateField", "Pilih kolom tanggal");
    }
    const companyId = currentContext().companyId;
    const users = new Set<string>();
    const roles = new Set<string>();
    for (const [i, a] of input.actions.entries()) {
      if (a.type === "notify") {
        a.users.forEach((u) => users.add(u));
        a.roleIds.forEach((r) => roles.add(r));
        if (a.responsible && !RESPONSIBLE_FIELD[model])
          throw fieldError(`actions.${i}.responsible`, "Data ini tidak punya penanggung jawab");
      }
      if (a.type === "activity" && a.assignTo === "user" && a.userId) users.add(a.userId);
      if (a.type === "set_field") {
        const ok = a.field.startsWith("custom.") ? byKey.has(a.field) : a.field === RESPONSIBLE_FIELD[model];
        if (!ok) throw fieldError(`actions.${i}.field`, "Field tidak bisa diubah aturan otomatis");
      }
      if (a.type === "approval") {
        const [cat] = await tx
          .select({ id: schema.approvalCategories.id })
          .from(schema.approvalCategories)
          .where(
            and(
              eq(schema.approvalCategories.id, a.categoryId),
              eq(schema.approvalCategories.companyId, companyId),
              eq(schema.approvalCategories.active, true),
            ),
          );
        if (!cat) throw fieldError(`actions.${i}.categoryId`, "Kategori persetujuan tidak ditemukan");
        if (a.amountField && byKey.get(a.amountField)?.type !== "number")
          throw fieldError(`actions.${i}.amountField`, "Pilih kolom angka");
      }
      if (a.type === "email" && a.to === "partner" && !PARTNER_FIELD[model])
        throw fieldError(`actions.${i}.to`, "Data ini tidak punya kontak");
    }
    if (users.size) {
      const found = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.id, [...users]));
      if (found.length !== users.size) throw fieldError("actions", "Pengguna tidak ditemukan");
    }
    if (roles.size) {
      const found = await tx
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(inArray(schema.roles.id, [...roles]));
      if (found.length !== roles.size) throw fieldError("actions", "Peran tidak ditemukan");
    }
  }
}

@Module({
  imports: [HrModule],
  controllers: [AutomationController],
  providers: [AutomationEngine, ActivityService],
  exports: [AutomationEngine],
})
export class AutomationModule {}
