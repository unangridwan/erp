import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { asc, eq, schema, type Db } from "@erp/db";
import {
  branchSchema,
  businessUnitSchema,
  companySchema,
  currencyRateSchema,
  generateVariantsSchema,
  ownershipSchema,
  partnerSchema,
  productAttributeSchema,
  productAttributeValueSchema,
  productCategorySchema,
  productSchema,
  uomSchema,
} from "@erp/shared";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { TenantDb } from "../common/database.js";
import { installChart } from "../accounting/chart-template.js";
import { installInventory } from "../inventory/setup.js";
import { installPayroll } from "../payroll/setup.js";
import { assertCompanyLimit } from "../billing/limits.js";
import { createCrudController } from "../common/crud.js";
import { FxController, FxService, FxSettingsController, FxSyncService } from "./fx.controller.js";
import { RegionsController } from "./regions.controller.js";
import { assertProductUoms } from "./uom.js";
import { VariantService } from "./variant.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { parse } from "../common/zod.js";

/** Tolak parent yang membuat siklus (perusahaan menjadi induk dari leluhurnya sendiri). */
async function assertNoCompanyCycle(tx: Db, values: Record<string, unknown>, id?: string) {
  let parentId = values.parentId as string | null | undefined;
  if (!id || !parentId) return;
  for (let depth = 0; parentId && depth < 50; depth++) {
    if (parentId === id) throw new BadRequestException("Struktur perusahaan tidak boleh melingkar");
    const [parent] = await tx
      .select({ parentId: schema.companies.parentId })
      .from(schema.companies)
      .where(eq(schema.companies.id, parentId));
    parentId = parent?.parentId;
  }
}

/** Setiap perusahaan grup otomatis punya partner intercompany (dipakai transaksi antar perusahaan). */
export async function createIntercompanyPartner(tx: Db, company: Record<string, unknown> & { id: string }) {
  await tx.insert(schema.partners).values({
    name: String(company.name),
    kind: "company",
    isCustomer: true,
    isSupplier: true,
    npwp: (company.npwp as string | null) ?? null,
    icCompanyId: company.id,
  });
}

const CompaniesController = createCrudController({
  path: "companies",
  model: "company",
  table: schema.companies,
  schema: companySchema,
  read: "company.read",
  write: "company.write",
  searchColumns: [schema.companies.code, schema.companies.name],
  orderBy: schema.companies.code,
  companyColumn: schema.companies.id,
  refs: { parentId: schema.companies },
  beforeSave: async (tx, values, id) => {
    if (!id) await assertCompanyLimit(tx);
    await assertNoCompanyCycle(tx, values, id);
  },
  afterCreate: async (tx, company) => {
    await createIntercompanyPartner(tx, company);
    await installChart(tx, company.id);
    await installInventory(tx, company.id);
    await installPayroll(tx, company.id);
  },
});

const OwnershipController = createCrudController({
  path: "ownerships",
  model: "ownership",
  table: schema.ownershipHistory,
  schema: ownershipSchema,
  read: "company.read",
  write: "company.write",
  searchColumns: [],
  orderBy: schema.ownershipHistory.validFrom,
  refs: { parentCompanyId: schema.companies, childCompanyId: schema.companies },
});

const BusinessUnitsController = createCrudController({
  path: "business-units",
  model: "business_unit",
  table: schema.businessUnits,
  schema: businessUnitSchema,
  read: "company.read",
  write: "company.write",
  searchColumns: [schema.businessUnits.code, schema.businessUnits.name],
  orderBy: schema.businessUnits.code,
});

const BranchesController = createCrudController({
  path: "branches",
  model: "branch",
  table: schema.branches,
  schema: branchSchema,
  read: "company.read",
  write: "company.write",
  searchColumns: [schema.branches.code, schema.branches.name],
  orderBy: schema.branches.code,
  companyColumn: schema.branches.companyId,
  refs: { companyId: schema.companies },
});

const PartnersController = createCrudController({
  path: "partners",
  customModel: "partner",
  model: "partner",
  table: schema.partners,
  schema: partnerSchema,
  read: "partner.read",
  write: "partner.write",
  searchColumns: [schema.partners.name, schema.partners.email, schema.partners.npwp, schema.partners.city],
  orderBy: schema.partners.name,
  companyColumn: schema.partners.companyId,
  refs: {
    companyId: schema.companies,
    parentId: schema.partners,
    paymentTermId: schema.paymentTerms,
    pricelistId: schema.pricelists,
    salespersonId: schema.users,
  },
});

const ProductCategoriesController = createCrudController({
  path: "product-categories",
  model: "product_category",
  table: schema.productCategories,
  schema: productCategorySchema,
  read: "product.read",
  write: "product.write",
  searchColumns: [schema.productCategories.name],
  orderBy: schema.productCategories.name,
  refs: { parentId: schema.productCategories },
});

const UomCategoriesController = createCrudController({
  path: "uom-categories",
  model: "uom_category",
  table: schema.uomCategories,
  schema: z.object({ name: z.string().trim().min(1).max(50) }),
  read: "uom.read",
  write: "uom.write",
  searchColumns: [schema.uomCategories.name],
  orderBy: schema.uomCategories.name,
});

const UomsController = createCrudController({
  path: "uoms",
  model: "uom",
  table: schema.uoms,
  schema: uomSchema,
  read: "uom.read",
  write: "uom.write",
  searchColumns: [schema.uoms.name],
  orderBy: schema.uoms.name,
  refs: { categoryId: schema.uomCategories },
});

const ProductsController = createCrudController({
  path: "products",
  customModel: "product",
  model: "product",
  table: schema.products,
  schema: productSchema,
  read: "product.read",
  write: "product.write",
  searchColumns: [schema.products.sku, schema.products.name, schema.products.barcode],
  orderBy: schema.products.name,
  companyColumn: schema.products.companyId,
  refs: {
    companyId: schema.companies,
    categoryId: schema.productCategories,
    uomId: schema.uoms,
    saleUomId: schema.uoms,
    purchaseUomId: schema.uoms,
  },
  beforeSave: (tx, values, id) => assertProductUoms(tx, values, id),
});

const ProductAttributesController = createCrudController({
  path: "product-attributes",
  model: "product_attribute",
  table: schema.productAttributes,
  schema: productAttributeSchema,
  read: "product.read",
  write: "product.write",
  searchColumns: [schema.productAttributes.name],
  orderBy: schema.productAttributes.sequence,
});

const ProductAttributeValuesController = createCrudController({
  path: "product-attribute-values",
  model: "product_attribute_value",
  table: schema.productAttributeValues,
  schema: productAttributeValueSchema,
  read: "product.read",
  write: "product.write",
  searchColumns: [schema.productAttributeValues.name],
  orderBy: schema.productAttributeValues.sequence,
  refs: { attributeId: schema.productAttributes },
});

/** Varian produk: daftar & pembuatan dari kombinasi nilai atribut. */
@Controller("products")
class ProductVariantsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(VariantService) private readonly variants: VariantService,
  ) {}

  @Get(":id/variants")
  @RequirePermission("product.read")
  list(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.variants.list(tx, id));
  }

  @Post(":id/variants")
  @RequirePermission("product.write")
  generate(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(generateVariantsSchema, body);
    return this.tenantDb.run((tx) => this.variants.generate(tx, id, input));
  }
}

const CurrencyRatesController = createCrudController({
  path: "currency-rates",
  model: "currency_rate",
  table: schema.currencyRates,
  schema: currencyRateSchema,
  read: "currency.read",
  write: "currency.write",
  searchColumns: [schema.currencyRates.currencyCode],
  orderBy: schema.currencyRates.rateDate,
  refs: {},
  beforeSave: async (tx, values) => {
    if (typeof values.currencyCode !== "string") return;
    const [currency] = await tx
      .select()
      .from(schema.currencies)
      .where(eq(schema.currencies.code, values.currencyCode));
    if (!currency) throw new BadRequestException(`Mata uang ${values.currencyCode} tidak dikenal`);
    if (currency.code === "IDR") throw new BadRequestException("IDR adalah mata uang dasar (kurs selalu 1)");
  },
});

/** Mata uang adalah master global (read-only bagi tenant). */
@Controller("currencies")
class CurrenciesController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  list() {
    return this.tenantDb.run((tx) =>
      tx.select().from(schema.currencies).orderBy(asc(schema.currencies.code)),
    );
  }
}

@Module({
  controllers: [
    CompaniesController,
    OwnershipController,
    BusinessUnitsController,
    BranchesController,
    PartnersController,
    ProductCategoriesController,
    UomCategoriesController,
    UomsController,
    ProductsController,
    ProductVariantsController,
    ProductAttributesController,
    ProductAttributeValuesController,
    CurrenciesController,
    CurrencyRatesController,
    FxController,
    FxSettingsController,
    RegionsController,
  ],
  providers: [ActivityService, FxService, FxSyncService, VariantService],
  exports: [FxService],
})
export class MasterModule {}
