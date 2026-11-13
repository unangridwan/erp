import { describe, expect, it } from "vitest";
import {
  bomCostEstimate,
  bomCycle,
  bomSchema,
  explodeBom,
  operationCost,
  productionUnitCost,
  type BomNode,
} from "./manufacturing.js";

// Pupuk NPK (10 kg) = 6 kg urea + 4 kg kit mineral (phantom: per 2 kg = 1 kg kapur + 1 kg dolomit) + 1 karung.
const npk: BomNode = {
  id: "b1",
  productId: "npk",
  quantity: "10",
  bomType: "normal",
  lines: [
    { productId: "urea", quantity: "6" },
    { productId: "mineral", quantity: "4" },
    { productId: "karung", quantity: "1" },
  ],
  operations: [{ name: "Campur", workCenterId: "mixer", minutes: "30" }],
};
const mineral: BomNode = {
  id: "b2",
  productId: "mineral",
  quantity: "2",
  bomType: "phantom",
  lines: [
    { productId: "kapur", quantity: "1" },
    { productId: "dolomit", quantity: "1" },
  ],
  operations: [{ name: "Ayak", workCenterId: "ayak", minutes: "4" }],
};
const index = new Map([
  ["npk", npk],
  ["mineral", mineral],
]);

describe("manufaktur", () => {
  it("ledakan BOM multi-level dengan phantom", () => {
    const e = explodeBom(npk, "50", index);
    const byId = Object.fromEntries(e.components.map((c) => [c.productId, c.quantity]));
    expect(byId).toEqual({ urea: "30.0000", kapur: "10.0000", dolomit: "10.0000", karung: "5.0000" });
    expect(e.operations).toEqual([
      { name: "Campur", workCenterId: "mixer", minutes: "150.00" },
      { name: "Ayak", workCenterId: "ayak", minutes: "40.00" },
    ]);
  });

  it("sub-rakitan BOM normal tidak diurai; siklus terdeteksi", () => {
    const idx = new Map([
      ["npk", npk],
      ["mineral", { ...mineral, bomType: "normal" as const }],
    ]);
    expect(explodeBom(npk, "10", idx).components.map((c) => c.productId)).toContain("mineral");
    const loop = new Map([
      ...index,
      ["kapur", { ...mineral, id: "b3", productId: "kapur", lines: [{ productId: "npk", quantity: "1" }] }],
    ]);
    expect(() => explodeBom(npk, "10", loop)).not.toThrow();
    const phantomLoop = new Map([
      ["npk", npk],
      ["mineral", { ...mineral, lines: [{ productId: "mineral", quantity: "1" }] }],
    ]);
    expect(() => explodeBom(npk, "10", phantomLoop)).toThrow(/berputar/);
    const all = new Map([
      ["mineral", [mineral]],
      ["kapur", [{ ...mineral, id: "b3", productId: "kapur", lines: [{ productId: "npk", quantity: "1" }] }]],
    ]);
    expect(bomCycle("npk", ["urea", "mineral"], all)).toBe(true);
    expect(bomCycle("npk", ["urea"], all)).toBe(false);
  });

  it("biaya operasi, estimasi & biaya per unit", () => {
    expect(operationCost("90", "60000")).toBe("90000.00");
    const e = explodeBom(npk, "10", index);
    const est = bomCostEstimate(
      e,
      "10",
      new Map([
        ["urea", "5000"],
        ["kapur", "1000"],
        ["dolomit", "1500"],
        ["karung", "2000"],
      ]),
      new Map([
        ["mixer", "60000"],
        ["ayak", "30000"],
      ]),
    );
    // Bahan 30.000 + 2.000 + 3.000 + 2.000 = 37.000; konversi 30.000 + 4.000 = 34.000.
    expect(est).toEqual({
      material: "37000.00",
      conversion: "34000.00",
      total: "71000.00",
      unit: "7100.0000",
    });
    expect(productionUnitCost("37000", "34000", "10")).toBe("7100.0000");
  });

  it("skema BOM menolak komponen = produk jadi", () => {
    const r = bomSchema.safeParse({
      productId: "00000000-0000-4000-8000-000000000001",
      lines: [{ productId: "00000000-0000-4000-8000-000000000001", quantity: "1" }],
    });
    expect(r.success).toBe(false);
  });
});
