import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, schema, type Db } from "@erp/db";
import { ALL_PERMISSIONS, type generateVariantsSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";

type Value = {
  id: string;
  attributeId: string;
  attributeName: string;
  attributeSequence: number;
  name: string;
  code: string | null;
  sequence: number;
  priceExtra: string;
};

/** Kode SKU nilai atribut: kode yang diisi, atau huruf/angka dari namanya. */
const codeOf = (v: Value) =>
  (v.code || v.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || v.id.slice(0, 4)).toUpperCase();

/**
 * Varian produk: produk induk (template) memegang data bersama; setiap kombinasi nilai atribut menjadi produk
 * biasa (punya stok, harga, SKU sendiri) yang menunjuk ke induknya. Induk tidak dipakai langsung di dokumen.
 */
@Injectable()
export class VariantService {
  async list(tx: Db, templateId: string) {
    const template = await this.template(tx, templateId);
    const variants = await tx
      .select()
      .from(schema.products)
      .where(eq(schema.products.variantOfId, template.id))
      .orderBy(asc(schema.products.sku));
    const values = await this.values(
      tx,
      variants.flatMap((v) => v.attributeValueIds),
    );
    return {
      template,
      variants: variants.map((v) => ({
        ...v,
        attributes: v.attributeValueIds
          .map((id) => values.find((x) => x.id === id))
          .filter((x): x is Value => Boolean(x))
          .sort(
            (a, b) =>
              a.attributeSequence - b.attributeSequence || a.attributeName.localeCompare(b.attributeName),
          )
          .map((x) => ({ attribute: x.attributeName, value: x.name })),
      })),
    };
  }

  /** Buat varian untuk setiap kombinasi (satu daftar nilai per atribut); kombinasi yang sudah ada dilewati. */
  async generate(tx: Db, templateId: string, input: z.infer<typeof generateVariantsSchema>) {
    const template = await this.template(tx, templateId);
    if (template.variantOfId) throw new BadRequestException("Varian tidak bisa punya varian lagi");
    const values = await this.values(tx, input.values.flat());
    const groups = input.values.map((ids, i) => {
      const group = ids.map((id) => {
        const v = values.find((x) => x.id === id);
        if (!v) throw new BadRequestException(`Nilai atribut pada kelompok ${i + 1} tidak ditemukan`);
        return v;
      });
      if (new Set(group.map((v) => v.attributeId)).size !== 1)
        throw new BadRequestException("Setiap kelompok harus berisi nilai dari satu atribut");
      return group;
    });
    if (new Set(groups.map((g) => g[0]!.attributeId)).size !== groups.length)
      throw new BadRequestException("Atribut yang sama dipilih lebih dari sekali");
    // Urutan atribut stabil (urutan atribut, lalu nama) agar SKU & nama varian konsisten.
    groups.sort(
      (a, b) =>
        a[0]!.attributeSequence - b[0]!.attributeSequence ||
        a[0]!.attributeName.localeCompare(b[0]!.attributeName),
    );
    let combos: Value[][] = [[]];
    for (const group of groups) combos = combos.flatMap((c) => group.map((v) => [...c, v]));
    if (combos.length > 500) throw new BadRequestException("Maksimal 500 varian sekali buat");

    const existing = await tx
      .select({ ids: schema.products.attributeValueIds })
      .from(schema.products)
      .where(eq(schema.products.variantOfId, template.id));
    const key = (ids: string[]) => [...ids].sort().join(",");
    const taken = new Set(existing.map((e) => key(e.ids)));
    const created: string[] = [];
    for (const combo of combos) {
      const ids = combo.map((v) => v.id).sort();
      if (taken.has(key(ids))) continue;
      const extra = combo.reduce((s, v) => s.plus(v.priceExtra), new Decimal(0));
      const [row] = await tx
        .insert(schema.products)
        .values({
          companyId: template.companyId,
          sku: `${template.sku}-${combo.map(codeOf).join("-")}`,
          name: `${template.name} (${combo.map((v) => v.name).join(", ")})`,
          productType: template.productType,
          categoryId: template.categoryId,
          uomId: template.uomId,
          saleUomId: template.saleUomId,
          purchaseUomId: template.purchaseUomId,
          dropship: template.dropship,
          salePrice: new Decimal(template.salePrice).plus(extra).toFixed(2),
          cost: template.cost,
          tracking: template.tracking,
          costMethod: template.costMethod,
          taxGoodsCode: template.taxGoodsCode,
          variantOfId: template.id,
          attributeValueIds: ids,
        })
        .returning({ id: schema.products.id });
      created.push(row!.id);
    }
    await tx
      .update(schema.products)
      .set({ isVariantTemplate: true })
      .where(eq(schema.products.id, template.id));
    return { created: created.length, ...(await this.list(tx, template.id)) };
  }

  private async template(tx: Db, id: string) {
    const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id));
    const ctx = currentContext();
    if (
      !product ||
      (product.companyId &&
        !ctx.companyIds.includes(product.companyId) &&
        !ctx.permissions.includes(ALL_PERMISSIONS))
    )
      throw new NotFoundException("Produk tidak ditemukan");
    return product;
  }

  private async values(tx: Db, ids: string[]): Promise<Value[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    return tx
      .select({
        id: schema.productAttributeValues.id,
        attributeId: schema.productAttributeValues.attributeId,
        attributeName: schema.productAttributes.name,
        attributeSequence: schema.productAttributes.sequence,
        name: schema.productAttributeValues.name,
        code: schema.productAttributeValues.code,
        sequence: schema.productAttributeValues.sequence,
        priceExtra: schema.productAttributeValues.priceExtra,
      })
      .from(schema.productAttributeValues)
      .innerJoin(
        schema.productAttributes,
        eq(schema.productAttributes.id, schema.productAttributeValues.attributeId),
      )
      .where(and(inArray(schema.productAttributeValues.id, unique)));
  }
}

/** Produk induk varian tidak boleh dipakai langsung di dokumen. */
export function assertNotTemplate(product: { isVariantTemplate: boolean; name: string }, path: string) {
  if (product.isVariantTemplate)
    throw new BadRequestException({
      message: "Validasi gagal",
      errors: [{ path, message: `${product.name} punya varian; pilih variannya` }],
    });
}
