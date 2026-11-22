import {
  BadRequestException,
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
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { and, eq, schema, sql, type Db } from "@erp/db";
import {
  allowedFor,
  CUSTOM_FIELD_MODELS,
  customFieldSchema,
  customValuesUpdateSchema,
  type CustomFieldModel,
} from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext, hasAllCompanies } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CUSTOM_TABLES, customKeyUsed, loadCustomDefs, normalizeCustom } from "./custom-values.js";

const CF = schema.customFields;

/** Path API tiap model (untuk pemetaan hak per fitur). */
const MODEL_PATHS: Record<CustomFieldModel, string> = {
  partner: "/partners",
  product: "/products",
  employee: "/employees",
  fleet_vehicle: "/fleet-vehicles",
  crm_lead: "/leads",
  sale_order: "/sale-orders",
  purchase_order: "/purchase-orders",
  account_move: "/moves",
  stock_picking: "/pickings",
  production_order: "/production-orders",
  equipment: "/equipment",
  maintenance_request: "/maintenance-requests",
};

const isModel = (m: string): m is CustomFieldModel => m in CUSTOM_FIELD_MODELS;

/** Pengaturan › Field Kustom: definisi kolom tambahan per model + ubah nilai di data yang sudah terkunci. */
@Controller()
export class CustomFieldsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Definisi untuk form & daftar (semua pengguna login). `all=true` menyertakan yang nonaktif. */
  @Get("custom-fields")
  list(@Query("model") model?: string, @Query("all") all?: string) {
    if (model && !isModel(model)) throw new BadRequestException("Model field kustom tidak dikenal");
    return this.tenantDb.run(async (tx) => {
      const where = and(
        model ? eq(CF.model, model) : undefined,
        all === "true" ? undefined : eq(CF.active, true),
        sql`(${CF.companyId} is null or ${CF.companyId} = ${currentContext().companyId})`,
      );
      return tx.select().from(CF).where(where).orderBy(CF.model, CF.sequence, CF.label);
    });
  }

  @Get("custom-fields/:id")
  @RequirePermission("customization.manage")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id);
      return { ...row, used: await customKeyUsed(tx, row.model as CustomFieldModel, row.key) };
    });
  }

  @Post("custom-fields")
  @RequirePermission("customization.manage")
  create(@Body() body: unknown) {
    const v = parse(customFieldSchema, body);
    return this.tenantDb.run(async (tx) => {
      this.assertCompany(v.companyId);
      const [dup] = await tx
        .select({ id: CF.id })
        .from(CF)
        .where(and(eq(CF.model, v.model), eq(CF.key, v.key)));
      if (dup)
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [{ path: "key", message: "Kunci sudah dipakai di data ini" }],
        });
      const [row] = await tx
        .insert(CF)
        .values({ ...this.values(v), model: v.model, key: v.key })
        .returning();
      await this.activity.log(tx, { resModel: "custom_field", resId: row!.id, action: "create" });
      return row;
    });
  }

  /** Model & kunci tidak bisa diubah; tipe hanya bisa diubah selama belum ada data yang mengisinya. */
  @Put("custom-fields/:id")
  @RequirePermission("customization.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const before = await this.find(tx, id);
      const v = parse(customFieldSchema, {
        ...(body as object),
        model: before.model,
        key: before.key,
      });
      this.assertCompany(v.companyId);
      if (
        (v.fieldType !== before.fieldType || (v.refModel ?? null) !== before.refModel) &&
        (await customKeyUsed(tx, before.model as CustomFieldModel, before.key))
      )
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [
            { path: "fieldType", message: "Tipe tidak bisa diubah karena sudah ada data yang mengisinya" },
          ],
        });
      const [row] = await tx
        .update(CF)
        .set({ ...this.values(v), updatedAt: sql`now()` })
        .where(eq(CF.id, id))
        .returning();
      await this.activity.log(tx, { resModel: "custom_field", resId: id, action: "update" });
      return row;
    });
  }

  /** Hapus definisi beserta nilainya di semua data. */
  @Delete("custom-fields/:id")
  @HttpCode(204)
  @RequirePermission("customization.manage")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const before = await this.find(tx, id);
      const t = CUSTOM_TABLES[before.model as CustomFieldModel];
      await tx
        .update(t)
        .set({ custom: sql`${t.custom} - ${before.key}` } as never)
        .where(sql`${t.custom} ? ${before.key}`);
      await tx.delete(CF).where(eq(CF.id, id));
      await this.activity.log(tx, { resModel: "custom_field", resId: id, action: "delete" });
    });
  }

  /** Ubah nilai field kustom saja — juga untuk dokumen yang sudah dikonfirmasi/diposting. */
  @Patch("custom-values/:model/:id")
  updateValues(@Param("model") model: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!isModel(model)) throw new NotFoundException("Model field kustom tidak dikenal");
    const ctx = currentContext();
    const write = CUSTOM_FIELD_MODELS[model].write;
    if (!allowedFor(ctx.permissions, write, { path: MODEL_PATHS[model], method: "PATCH" }))
      throw new ForbiddenException(`Butuh permission ${write}`);
    const input = parse(customValuesUpdateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const t = CUSTOM_TABLES[model] as unknown as typeof schema.partners;
      const [row] = (await tx.select().from(t).where(eq(t.id, id))) as unknown as Record<string, unknown>[];
      if (!row) throw new NotFoundException("Data tidak ditemukan");
      const companyId = (row.companyId as string | null | undefined) ?? null;
      const all = hasAllCompanies();
      if (companyId && !all && !ctx.companyIds.includes(companyId))
        throw new NotFoundException("Data tidak ditemukan");
      // Lead & pesanan milik salesperson lain hanya bisa diubah dengan hak melihat semua.
      const ownerOnly =
        (model === "crm_lead" && !allowedFor(ctx.permissions, "crm.all", { path: "/leads" })) ||
        (model === "sale_order" && !allowedFor(ctx.permissions, "sales.all", { path: "/sale-orders" }));
      if (ownerOnly && row.userId && row.userId !== ctx.userId)
        throw new NotFoundException("Data tidak ditemukan");
      const before = (row.custom ?? {}) as Record<string, unknown>;
      const custom = await normalizeCustom(tx, model, input.custom, before, companyId ?? ctx.companyId);
      await tx
        .update(t)
        .set({ custom } as never)
        .where(eq(t.id, id));
      await this.activity.log(tx, {
        resModel: model,
        resId: id,
        action: "update",
        changes: { custom: { from: before, to: custom } },
      });
      return { custom };
    });
  }

  private values(v: ReturnType<typeof customFieldSchema.parse>) {
    const choice = v.fieldType === "select" || v.fieldType === "multiselect";
    return {
      companyId: v.companyId ?? null,
      label: v.label,
      labelEn: v.labelEn || null,
      fieldType: v.fieldType,
      options: choice ? v.options : [],
      refModel: v.fieldType === "ref" ? (v.refModel ?? null) : null,
      required: v.required,
      defaultValue: v.defaultValue === undefined || v.defaultValue === "" ? null : v.defaultValue,
      help: v.help || null,
      section: v.section || null,
      sequence: v.sequence,
      showInList: v.showInList,
      showOnPdf: v.showOnPdf,
      active: v.active,
    };
  }

  private assertCompany(companyId: string | null | undefined) {
    const ctx = currentContext();
    if (companyId && !hasAllCompanies() && !ctx.companyIds.includes(companyId))
      throw new NotFoundException("Perusahaan tidak ditemukan");
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx.select().from(CF).where(eq(CF.id, id));
    if (!row) throw new NotFoundException("Field kustom tidak ditemukan");
    return row;
  }
}

/** Dipakai service lain lewat fungsi `normalizeCustom` (tanpa DI). */
export { loadCustomDefs, normalizeCustom };

@Module({ controllers: [CustomFieldsController], providers: [ActivityService] })
export class CustomizationModule {}
