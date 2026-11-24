import { describe, expect, it } from "vitest";
import { KPI_BY_CODE } from "./kpi.js";
import { elapsedShare, kpiScopeValue, paceStatus, splitTarget } from "./scorecard.js";

describe("scorecard & target berjenjang", () => {
  it("porsi waktu berjalan", () => {
    expect(elapsedShare("2026-01-01", "2026-01-10", "2026-01-05")).toBe(0.5);
    expect(elapsedShare("2026-01-01", "2026-01-10", "2025-12-31")).toBe(0);
    expect(elapsedShare("2026-01-01", "2026-01-10", "2026-02-01")).toBe(1);
    expect(elapsedShare(null, null, "2026-01-05")).toBe(1);
  });

  it("status menurut laju", () => {
    // Separuh periode: semestinya 50%.
    expect(paceStatus(48, 0.5)).toEqual({ rag: "green", expected: 50 });
    expect(paceStatus(40, 0.5)).toEqual({ rag: "amber", expected: 50 });
    expect(paceStatus(20, 0.5)).toEqual({ rag: "red", expected: 50 });
    expect(paceStatus(100, 0.2).rag).toBe("green");
    expect(paceStatus(10, 0.9, true).rag).toBe("green");
    expect(paceStatus(0, 0).rag).toBe("green");
  });

  it("nilai KPI per cakupan pemilik", () => {
    const cols = [
      { key: "dateOrder", header: "Tanggal" },
      { key: "state", header: "Status" },
      { key: "amountUntaxed", header: "Total", numeric: true },
    ];
    const rows = [
      { _userId: "a", dateOrder: "2026-03-01", state: "Pesanan", amountUntaxed: 100 },
      { _userId: "b", dateOrder: "2026-03-02", state: "Pesanan", amountUntaxed: 50 },
      { _userId: "c", dateOrder: "2026-03-03", state: "Pesanan", amountUntaxed: 25 },
      { _userId: "a", dateOrder: "2026-04-01", state: "Pesanan", amountUntaxed: 999 },
    ];
    const def = KPI_BY_CODE.get("sales.revenue")!;
    const opts = { from: "2026-03-01", to: "2026-03-31" };
    expect(kpiScopeValue(def, rows, cols, { owners: null, ...opts })).toBe(175);
    expect(kpiScopeValue(def, rows, cols, { owners: new Set(["a", "b"]), ...opts })).toBe(150);
    expect(kpiScopeValue(def, rows, cols, { owners: new Set(["x"]), ...opts })).toBeNull();
  });

  it("pembagian target rata, proporsional, dan rasio", () => {
    const parts = [
      { id: "x", basis: 300 },
      { id: "y", basis: 100 },
      { id: "z", basis: null },
    ];
    expect([...splitTarget(100, parts, "equal").values()]).toEqual([33.33, 33.33, 33.34]);
    expect(Object.fromEntries(splitTarget(1000, parts, "proportional"))).toEqual({ x: 750, y: 250, z: 0 });
    // Tanpa dasar periode lalu: kembali ke rata.
    expect([
      ...splitTarget(
        90,
        [
          { id: "a", basis: 0 },
          { id: "b", basis: null },
        ],
        "proportional",
      ).values(),
    ]).toEqual([45, 45]);
    expect([...splitTarget(80, parts, "equal", true).values()]).toEqual([80, 80, 80]);
  });
});
