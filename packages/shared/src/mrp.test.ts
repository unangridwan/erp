import { describe, expect, it } from "vitest";
import type { BomNode } from "./manufacturing.js";
import { mrpPlan, type MrpItem } from "./mrp.js";

// Pupuk (BOM normal, 1 unit = 2 kompos + 1 karung); kompos (BOM normal, 1 unit = 1 jerami); karung & jerami dibeli.
const pupuk: BomNode = {
  id: "bp",
  productId: "pupuk",
  quantity: "1",
  bomType: "normal",
  lines: [
    { productId: "kompos", quantity: "2" },
    { productId: "karung", quantity: "1" },
  ],
};
const kompos: BomNode = {
  id: "bk",
  productId: "kompos",
  quantity: "1",
  bomType: "normal",
  lines: [{ productId: "jerami", quantity: "1" }],
};
const boms = new Map([
  ["pupuk", pupuk],
  ["kompos", kompos],
]);
const item = (productId: string, x: Partial<MrpItem> = {}): [string, MrpItem] => [
  productId,
  { productId, onHand: 0, supply: 0, ...x },
];

describe("MRP", () => {
  it("kebutuhan bersih diurai per level dengan lead time", () => {
    const plan = mrpPlan({
      today: "2026-11-01",
      boms,
      items: new Map([
        item("pupuk", { onHand: 10, produceLeadDays: 2 }),
        item("kompos", { onHand: 30, supply: 10, produceLeadDays: 3 }),
        item("karung", { onHand: 0, supplierId: "v1", purchaseLeadDays: 5 }),
        item("jerami", { onHand: 0, supplierId: "v2", purchaseLeadDays: 1 }),
      ]),
      demands: [{ productId: "pupuk", quantity: "50", date: "2026-11-20", source: "SO/1" }],
    });
    const by = Object.fromEntries(plan.map((p) => [p.productId, p]));
    // Pupuk: 50 − 10 = 40, mulai 18 Nov.
    expect(by.pupuk).toMatchObject({
      kind: "manufacture",
      quantity: "40.0000",
      dateStart: "2026-11-18",
      level: 0,
    });
    // Kompos: 80 − (30 + 10) = 40 diproduksi, mulai 15 Nov; karung 40 dibeli dari v1, mulai 13 Nov.
    expect(by.kompos).toMatchObject({
      kind: "manufacture",
      quantity: "40.0000",
      dateNeeded: "2026-11-18",
      dateStart: "2026-11-15",
      level: 1,
    });
    expect(by.karung).toMatchObject({
      kind: "purchase",
      quantity: "40.0000",
      supplierId: "v1",
      dateStart: "2026-11-13",
    });
    // Jerami: dari produksi kompos (level 2).
    expect(by.jerami).toMatchObject({
      kind: "purchase",
      quantity: "40.0000",
      level: 2,
      dateNeeded: "2026-11-15",
    });
  });

  it("stok minimum diisi sampai maksimum (kelipatan) & tanggal tidak sebelum hari ini", () => {
    const plan = mrpPlan({
      today: "2026-11-01",
      boms,
      items: new Map([
        item("karung", { onHand: 3, rule: { minQty: 5, maxQty: 20, qtyMultiple: 10 }, purchaseLeadDays: 7 }),
      ]),
      demands: [],
    });
    expect(plan).toEqual([
      expect.objectContaining({
        productId: "karung",
        quantity: "20.0000",
        dateNeeded: "2026-11-01",
        dateStart: "2026-11-01",
      }),
    ]);
  });

  it("stok cukup → tanpa usulan", () => {
    const plan = mrpPlan({
      today: "2026-11-01",
      boms,
      items: new Map([item("pupuk", { onHand: 100 })]),
      demands: [{ productId: "pupuk", quantity: "50", date: "2026-11-20", source: "SO/1" }],
    });
    expect(plan).toEqual([]);
  });
});
