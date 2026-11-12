import { describe, expect, it } from "vitest";
import {
  allocateAmount,
  allocationCycleSchema,
  allocationRunSchema,
  monthEnd,
  budgetVariance,
  costCenterSchema,
  descendantIds,
  profitCenterStatement,
  rollupTree,
  wouldCycle,
} from "./controlling.js";

const nodes = [
  { id: "a", parentId: null, code: "100" },
  { id: "b", parentId: "a", code: "110" },
  { id: "c", parentId: "b", code: "111" },
  { id: "d", parentId: null, code: "200" },
  { id: "e", parentId: "a", code: "105" },
];

describe("controlling tree", () => {
  it("descendants & cycles", () => {
    expect(descendantIds(nodes, "a").sort()).toEqual(["a", "b", "c", "e"]);
    expect(descendantIds(nodes, "d")).toEqual(["d"]);
    expect(wouldCycle(nodes, "a", "c")).toBe(true);
    expect(wouldCycle(nodes, "a", "a")).toBe(true);
    expect(wouldCycle(nodes, "c", "d")).toBe(false);
    expect(wouldCycle(nodes, "c", null)).toBe(false);
  });

  it("rolls up totals in code order", () => {
    const own = new Map([
      ["a", { actual: "10" }],
      ["b", { actual: "20" }],
      ["c", { actual: "30.5" }],
      ["d", { actual: "5" }],
    ]);
    const rows = rollupTree(nodes, own, ["actual"]);
    expect(rows.map((r) => [r.node.id, r.depth, r.own.actual, r.total.actual])).toEqual([
      ["a", 0, "10.00", "60.50"],
      ["e", 1, "0.00", "0.00"],
      ["b", 1, "20.00", "50.50"],
      ["c", 2, "30.50", "30.50"],
      ["d", 0, "5.00", "5.00"],
    ]);
    expect(rows[0]!.hasChildren).toBe(true);
    expect(rows[3]!.hasChildren).toBe(false);
  });

  it("treats orphans as roots", () => {
    const rows = rollupTree([{ id: "x", parentId: "missing", code: "1" }], new Map(), ["v"]);
    expect(rows[0]!.depth).toBe(0);
  });
});

describe("profitCenterStatement", () => {
  it("computes margins from signed balances", () => {
    const s = profitCenterStatement({
      income: "-1000",
      expense_direct_cost: "600",
      expense: "150",
      expense_depreciation: "50",
      income_other: "-20",
      expense_other: "10",
    });
    expect(s).toMatchObject({
      revenue: "1000.00",
      grossProfit: "400.00",
      opex: "200.00",
      operatingProfit: "200.00",
      netProfit: "210.00",
      margin: 21,
    });
    expect(profitCenterStatement({ expense: "5" }).margin).toBeNull();
  });
});

describe("misc", () => {
  it("budget variance", () => {
    expect(budgetVariance("120", "100")).toEqual({ variance: "20.00", percent: 120 });
    expect(budgetVariance("5", "0").percent).toBeNull();
  });
  it("validates code", () => {
    expect(costCenterSchema.safeParse({ code: "CC 1", name: "x" }).success).toBe(false);
    expect(costCenterSchema.parse({ code: "CC-1", name: "IT" }).category).toBe("admin");
  });
});

describe("alokasi", () => {
  it("allocateAmount: jumlah persis, sisa ke pecahan terbesar", () => {
    expect(allocateAmount("100", [1, 1, 1])).toEqual(["33.34", "33.33", "33.33"]);
    expect(allocateAmount("1000", ["50", "30", "20"])).toEqual(["500.00", "300.00", "200.00"]);
    expect(allocateAmount("10", [2, 1], 0)).toEqual(["7", "3"]);
    expect(allocateAmount("-100", [1, 2])).toEqual(["-33.33", "-66.67"]);
    expect(() => allocateAmount("10", [0, 0])).toThrow();
  });
  it("monthEnd", () => {
    expect(monthEnd("2026-02-01")).toBe("2026-02-28");
    expect(monthEnd("2024-02-01")).toBe("2024-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
  });
  it("validasi siklus", () => {
    const base = { code: "AL1", name: "IT", sourceCostCenterId: "00000000-0000-4000-8000-000000000001" };
    const r = (id: string, percent?: number) => ({
      costCenterId: `00000000-0000-4000-8000-00000000000${id}`,
      percent,
    });
    expect(
      allocationCycleSchema.safeParse({ ...base, method: "percent", receivers: [r("2", 60), r("3", 40)] })
        .success,
    ).toBe(true);
    expect(
      allocationCycleSchema.safeParse({ ...base, method: "percent", receivers: [r("2", 60), r("3", 30)] })
        .success,
    ).toBe(false);
    expect(
      allocationCycleSchema.safeParse({ ...base, method: "percent", receivers: [r("1", 100)] }).success,
    ).toBe(false);
    expect(allocationCycleSchema.safeParse({ ...base, method: "key", receivers: [r("2")] }).success).toBe(
      false,
    );
    expect(allocationRunSchema.parse({ period: "2026-03" }).period).toBe("2026-03-01");
  });
});
