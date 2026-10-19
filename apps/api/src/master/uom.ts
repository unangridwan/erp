import { eq, inArray, schema, type Db } from "@erp/db";
import { Decimal } from "decimal.js";
import { fieldError } from "../accounting/context.js";

/**
 * Rasio satuan baris terhadap satuan produk (faktor baris ÷ faktor produk): kuantitas produk = kuantitas baris ×
 * rasio, harga per satuan produk = harga baris ÷ rasio. Satuan harus satu kategori dengan satuan produk.
 */
export async function uomRatio(
  tx: Db,
  productUomId: string,
  uomId: string | null | undefined,
  path = "uomId",
) {
  if (!uomId || uomId === productUomId) return new Decimal(1);
  const rows = await tx
    .select({ id: schema.uoms.id, categoryId: schema.uoms.categoryId, factor: schema.uoms.factor })
    .from(schema.uoms)
    .where(inArray(schema.uoms.id, [productUomId, uomId]));
  const product = rows.find((r) => r.id === productUomId);
  const line = rows.find((r) => r.id === uomId);
  if (!line) throw fieldError(path, "Satuan tidak ditemukan");
  if (!product || product.categoryId !== line.categoryId)
    throw fieldError(path, "Satuan harus sekategori dengan satuan produk");
  return new Decimal(line.factor).div(product.factor);
}

/** Satuan bawaan jual/beli produk harus sekategori dengan satuan produknya. */
export async function assertProductUoms(tx: Db, values: Record<string, unknown>, id?: string) {
  let uomId = values.uomId as string | undefined;
  if (!uomId && id) {
    const [product] = await tx
      .select({ uomId: schema.products.uomId })
      .from(schema.products)
      .where(eq(schema.products.id, id));
    uomId = product?.uomId;
  }
  if (!uomId) return;
  for (const field of ["saleUomId", "purchaseUomId"] as const) {
    const value = values[field];
    if (typeof value === "string") await uomRatio(tx, uomId, value, field);
  }
}
