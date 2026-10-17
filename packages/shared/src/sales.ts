import { Decimal } from "decimal.js";

export interface PriceRule {
  id: string;
  productId: string | null;
  categoryId: string | null;
  minQuantity: Decimal.Value;
  compute: "fixed" | "discount";
  fixedPrice: Decimal.Value | null;
  /** Persen potongan dari harga dasar (negatif = kenaikan harga). */
  discount: Decimal.Value;
  dateStart: string | null;
  dateEnd: string | null;
}

export interface PriceContext {
  productId: string;
  /** Kategori produk beserta seluruh induknya (terdekat lebih dulu). */
  categoryIds: string[];
  quantity: Decimal.Value;
  date: string;
  /** Harga jual produk. */
  basePrice: Decimal.Value;
}

/**
 * Pilih aturan daftar harga yang paling spesifik dan berlaku: produk > kategori terdekat > semua produk;
 * di antara yang setara, minimum kuantitas tertinggi menang, lalu aturan bertanggal (promo) di atas yang tanpa tanggal.
 * Mengembalikan harga satuan & aturan yang dipakai.
 */
export function resolvePrice(
  rules: PriceRule[],
  ctx: PriceContext,
): { price: string; ruleId: string | null } {
  const qty = new Decimal(ctx.quantity);
  const specificity = (r: PriceRule) => {
    if (r.productId) return r.productId === ctx.productId ? 1000 : -1;
    if (r.categoryId) {
      const depth = ctx.categoryIds.indexOf(r.categoryId);
      return depth === -1 ? -1 : 500 - depth;
    }
    return 0;
  };
  const applicable = rules
    .map((r) => ({ r, score: specificity(r) }))
    .filter(
      ({ r, score }) =>
        score >= 0 &&
        qty.gte(r.minQuantity) &&
        (!r.dateStart || r.dateStart <= ctx.date) &&
        (!r.dateEnd || r.dateEnd >= ctx.date),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Decimal(b.r.minQuantity).comparedTo(a.r.minQuantity) ||
        Number(Boolean(b.r.dateStart || b.r.dateEnd)) - Number(Boolean(a.r.dateStart || a.r.dateEnd)),
    );
  const best = applicable[0]?.r;
  if (!best) return { price: new Decimal(ctx.basePrice).toFixed(4), ruleId: null };
  const price =
    best.compute === "fixed"
      ? new Decimal(best.fixedPrice ?? 0)
      : new Decimal(ctx.basePrice).times(new Decimal(100).minus(best.discount)).div(100);
  return { price: price.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4), ruleId: best.id };
}

/** Tanggal jatuh tempo = tanggal dokumen + hari termin (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Nilai tertimbang pipeline: pendapatan harapan × probabilitas. */
export function weightedRevenue(expected: Decimal.Value, probability: Decimal.Value): string {
  return new Decimal(expected)
    .times(probability)
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
