import { describe, expect, it } from "vitest";
import { addDays, resolvePrice, weightedRevenue, type PriceRule } from "./sales.js";

const rule = (r: Partial<PriceRule>): PriceRule => ({
  id: "r",
  productId: null,
  categoryId: null,
  minQuantity: 0,
  compute: "discount",
  fixedPrice: null,
  discount: 0,
  dateStart: null,
  dateEnd: null,
  ...r,
});
const ctx = {
  productId: "p1",
  categoryIds: ["kertas", "atk"],
  quantity: 10,
  date: "2026-10-17",
  basePrice: 50_000,
};

describe("resolvePrice", () => {
  it("tanpa aturan memakai harga dasar", () => {
    expect(resolvePrice([], ctx)).toEqual({ price: "50000.0000", ruleId: null });
  });

  it("produk lebih spesifik dari kategori, kategori dekat lebih spesifik dari induk, lalu semua produk", () => {
    const rules = [
      rule({ id: "all", discount: 5 }),
      rule({ id: "atk", categoryId: "atk", discount: 10 }),
      rule({ id: "kertas", categoryId: "kertas", discount: 15 }),
      rule({ id: "prod", productId: "p1", compute: "fixed", fixedPrice: 40_000 }),
    ];
    expect(resolvePrice(rules, ctx)).toEqual({ price: "40000.0000", ruleId: "prod" });
    expect(resolvePrice(rules.slice(0, 3), ctx).ruleId).toBe("kertas");
    expect(resolvePrice(rules.slice(0, 2), ctx).ruleId).toBe("atk");
    expect(resolvePrice(rules.slice(0, 1), ctx)).toEqual({ price: "47500.0000", ruleId: "all" });
  });

  it("minimum kuantitas & rentang tanggal; kuantitas besar mendapat tingkat harga lebih tinggi", () => {
    const rules = [
      rule({ id: "q5", productId: "p1", minQuantity: 5, discount: 5 }),
      rule({ id: "q10", productId: "p1", minQuantity: 10, discount: 10 }),
      rule({ id: "q100", productId: "p1", minQuantity: 100, discount: 20 }),
      rule({
        id: "promo",
        productId: "p1",
        minQuantity: 10,
        discount: 50,
        dateStart: "2026-11-01",
        dateEnd: "2026-11-30",
      }),
    ];
    expect(resolvePrice(rules, ctx).ruleId).toBe("q10");
    expect(resolvePrice(rules, { ...ctx, quantity: 6 }).ruleId).toBe("q5");
    expect(resolvePrice(rules, { ...ctx, date: "2026-11-15" })).toEqual({
      price: "25000.0000",
      ruleId: "promo",
    });
  });

  it("aturan produk lain tidak berlaku", () => {
    expect(resolvePrice([rule({ productId: "lain", discount: 90 })], ctx).ruleId).toBeNull();
  });
});

describe("helper penjualan", () => {
  it("addDays melewati akhir bulan dan tahun", () => {
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });
  it("weightedRevenue", () => {
    expect(weightedRevenue("12500000", 60)).toBe("7500000.00");
  });
});
