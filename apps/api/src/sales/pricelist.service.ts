import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or, schema, sql, type Db } from "@erp/db";
import { resolvePrice, type pricelistSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { FxService } from "../master/fx.controller.js";

export type PricelistInput = z.infer<typeof pricelistSchema>;
type Pricelist = typeof schema.pricelists.$inferSelect;
type Product = typeof schema.products.$inferSelect;

const P = schema.pricelists;
const visible = () => or(isNull(P.companyId), eq(P.companyId, currentContext().companyId));

@Injectable()
export class PricelistService {
  constructor(
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  list(tx: Db, includeInactive = false) {
    return tx
      .select({
        pricelist: P,
        itemCount: sql<number>`(select count(*)::int from ${schema.pricelistItems} i where i.pricelist_id = pricelists.id)`,
      })
      .from(P)
      .where(and(visible(), includeInactive ? undefined : eq(P.active, true)))
      .orderBy(asc(P.name))
      .then((rows) => rows.map((r) => ({ ...r.pricelist, itemCount: r.itemCount })));
  }

  async get(tx: Db, id: string) {
    const [pricelist] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, id), visible()));
    if (!pricelist) throw new NotFoundException("Daftar harga tidak ditemukan");
    const items = await tx
      .select({
        item: schema.pricelistItems,
        productName: schema.products.name,
        categoryName: schema.productCategories.name,
      })
      .from(schema.pricelistItems)
      .leftJoin(schema.products, eq(schema.products.id, schema.pricelistItems.productId))
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.pricelistItems.categoryId))
      .where(eq(schema.pricelistItems.pricelistId, id))
      .orderBy(asc(schema.pricelistItems.createdAt));
    return {
      ...pricelist,
      items: items.map((r) => ({ ...r.item, productName: r.productName, categoryName: r.categoryName })),
    };
  }

  async create(tx: Db, input: PricelistInput) {
    const { items, ...header } = input;
    await this.validate(tx, input);
    const [row] = await tx.insert(P).values(header).returning();
    await this.saveItems(tx, row!.id, items);
    await this.activity.log(tx, { resModel: "pricelist", resId: row!.id, action: "create" });
    return this.get(tx, row!.id);
  }

  async update(tx: Db, id: string, input: Partial<PricelistInput>) {
    await this.get(tx, id);
    const { items, ...header } = input;
    await this.validate(tx, input);
    if (Object.keys(header).length) {
      await tx
        .update(P)
        .set({ ...header, updatedAt: sql`now()` })
        .where(eq(P.id, id));
    }
    // Daftar aturan dikirim utuh: ganti semua.
    if (items) {
      await tx.delete(schema.pricelistItems).where(eq(schema.pricelistItems.pricelistId, id));
      await this.saveItems(tx, id, items);
    }
    await this.activity.log(tx, { resModel: "pricelist", resId: id, action: "update" });
    return this.get(tx, id);
  }

  async remove(tx: Db, id: string) {
    await this.get(tx, id);
    await tx.delete(P).where(eq(P.id, id));
    await this.activity.log(tx, { resModel: "pricelist", resId: id, action: "delete" });
  }

  /**
   * Harga satuan produk menurut daftar harga (dalam mata uang daftar harga), atau harga jual produk
   * bila tanpa daftar harga. Harga jual produk dikonversi bila mata uang daftar harga berbeda.
   */
  async priceFor(
    tx: Db,
    pricelist: Pricelist | null,
    product: Product,
    quantity: string,
    date: string,
    companyCurrency: string,
  ): Promise<string> {
    let base = new Decimal(product.salePrice);
    if (pricelist && pricelist.currencyCode !== companyCurrency) {
      const from = await this.fx.rateOn(tx, companyCurrency, date);
      const to = await this.fx.rateOn(tx, pricelist.currencyCode, date);
      base = base.times(from.rate).div(to.rate);
    }
    if (!pricelist) return base.toFixed(4);
    const rules = await tx
      .select()
      .from(schema.pricelistItems)
      .where(eq(schema.pricelistItems.pricelistId, pricelist.id));
    const categoryIds = await this.categoryChain(tx, product.categoryId);
    return resolvePrice(rules, {
      productId: product.id,
      categoryIds,
      quantity,
      date,
      basePrice: base,
    }).price;
  }

  /** Kategori produk dan seluruh induknya, terdekat lebih dulu. */
  private async categoryChain(tx: Db, categoryId: string | null) {
    const chain: string[] = [];
    let current = categoryId;
    while (current && !chain.includes(current) && chain.length < 20) {
      chain.push(current);
      const [row] = await tx
        .select({ parentId: schema.productCategories.parentId })
        .from(schema.productCategories)
        .where(eq(schema.productCategories.id, current));
      current = row?.parentId ?? null;
    }
    return chain;
  }

  private async saveItems(tx: Db, pricelistId: string, items: PricelistInput["items"]) {
    if (!items.length) return;
    await tx.insert(schema.pricelistItems).values(items.map((i) => ({ ...i, pricelistId })));
  }

  private async validate(tx: Db, input: Partial<PricelistInput>) {
    const ctx = currentContext();
    if (input.companyId && input.companyId !== ctx.companyId && !ctx.companyIds.includes(input.companyId))
      throw fieldError("companyId", "Perusahaan tidak ditemukan");
    if (input.currencyCode) {
      const [currency] = await tx
        .select({ code: schema.currencies.code })
        .from(schema.currencies)
        .where(eq(schema.currencies.code, input.currencyCode));
      if (!currency) throw fieldError("currencyCode", "Mata uang tidak dikenal");
    }
    const items = input.items ?? [];
    const productIds = [...new Set(items.flatMap((i) => (i.productId ? [i.productId] : [])))];
    const categoryIds = [...new Set(items.flatMap((i) => (i.categoryId ? [i.categoryId] : [])))];
    const products = productIds.length
      ? await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(inArray(schema.products.id, productIds))
      : [];
    const categories = categoryIds.length
      ? await tx
          .select({ id: schema.productCategories.id })
          .from(schema.productCategories)
          .where(inArray(schema.productCategories.id, categoryIds))
      : [];
    items.forEach((item, i) => {
      if (item.productId && !products.some((p) => p.id === item.productId))
        throw fieldError(`items.${i}.productId`, "Produk tidak ditemukan");
      if (item.categoryId && !categories.some((c) => c.id === item.categoryId))
        throw fieldError(`items.${i}.categoryId`, "Kategori tidak ditemukan");
      if (item.dateStart && item.dateEnd && item.dateStart > item.dateEnd)
        throw fieldError(`items.${i}.dateEnd`, "Tanggal akhir sebelum tanggal mulai");
    });
  }
}
