import { BadRequestException, Controller, Get, Inject, Module } from "@nestjs/common";
import { asc, eq, schema, type Db } from "@erp/db";
import {
  branchSchema,
  businessUnitSchema,
  companySchema,
  currencyRateSchema,
  ownershipSchema,
  partnerSchema,
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
import { FxController, FxService } from "./fx.controller.js";
import { RegionsController } from "./regions.controller.js";
import { assertProductUoms } from "./uom.js";

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
    CurrenciesController,
    CurrencyRatesController,
    FxController,
    RegionsController,
  ],
  providers: [ActivityService, FxService],
  exports: [FxService],
})
export class MasterModule {}
