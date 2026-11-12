import { describe, expect, it } from "vitest";
import { landedCostSchema, splitLandedCost, splitStockVsSold } from "./landed-cost.js";

const moves = [
  { id: "a", quantity: 10, value: "1000000", weight: "2", volume: "0.1" },
  { id: "b", quantity: 5, value: "3000000", weight: "10", volume: null },
];

describe("landed cost", () => {
  it("membagi per metode, total tepat", () => {
    const byValue = splitLandedCost("400000", moves, "value");
    expect(byValue.map((x) => x.addition.toFixed(2))).toEqual(["100000.00", "300000.00"]);
    const byQty = splitLandedCost("300000", moves, "quantity");
    expect(byQty.map((x) => x.addition.toFixed(2))).toEqual(["200000.00", "100000.00"]);
    const byWeight = splitLandedCost("700000", moves, "weight");
    // 10×2 = 20 kg vs 5×10 = 50 kg
    expect(byWeight.map((x) => x.addition.toFixed(2))).toEqual(["200000.00", "500000.00"]);
    const equal = splitLandedCost("100", moves, "equal");
    expect(equal.map((x) => x.addition.toFixed(2))).toEqual(["50.00", "50.00"]);
  });
  it("dasar nol ditolak", () => {
    expect(() => splitLandedCost("100", [moves[1]!], "volume")).toThrow(/Volume/);
  });
  it("porsi stok vs terjual", () => {
    expect(splitStockVsSold("1000", 10, 4)).toEqual(expect.objectContaining({}));
    const r = splitStockVsSold("1000", 10, 4);
    expect([r.stock.toFixed(2), r.sold.toFixed(2)]).toEqual(["400.00", "600.00"]);
    const all = splitStockVsSold("1000", 10, 10);
    expect(all.sold.toFixed(2)).toBe("0.00");
  });
  it("validasi input", () => {
    expect(landedCostSchema.safeParse({ date: "2026-01-01", pickingIds: [], lines: [] }).success).toBe(false);
  });
});
