import { describe, expect, it } from "vitest";
import { otif, otifByMonth, stockAging, stockAgeBucket, supplierScore } from "./supply-insight.js";

describe("rantai pasok", () => {
  it("OTIF: tepat waktu, tepat jumlah, keduanya", () => {
    const rows = [
      { month: "2026-01", onTime: true, inFull: true },
      { month: "2026-01", onTime: true, inFull: false },
      { month: "2026-02", onTime: false, inFull: true },
      { month: "2026-02", onTime: true, inFull: true },
    ];
    expect(otif(rows)).toEqual({ count: 4, onTime: 75, inFull: 75, otif: 50 });
    expect(otifByMonth(rows).map((m) => [m.month, m.otif])).toEqual([
      ["2026-01", 50],
      ["2026-02", 50],
    ]);
    expect(otif([])).toEqual({ count: 0, onTime: null, inFull: null, otif: null });
  });

  it("skor pemasok dari komponen yang tersedia", () => {
    expect(supplierScore({ onTime: 80, inFull: 100, qcPass: null })).toBe(90);
    expect(supplierScore({ onTime: null, inFull: null, qcPass: null })).toBeNull();
  });

  it("umur persediaan per kelompok", () => {
    expect(stockAgeBucket(0)).toBe("0-30");
    expect(stockAgeBucket(400)).toBe("365+");
    const a = stockAging([
      { ageDays: 10, quantity: 5, value: 300 },
      { ageDays: 100, quantity: 1, value: 100 },
      { ageDays: 500, quantity: 2, value: 600 },
    ]);
    expect(a.map((b) => [b.key, b.value, b.share])).toEqual([
      ["0-30", 300, 30],
      ["31-90", 0, 0],
      ["91-180", 100, 10],
      ["181-365", 0, 0],
      ["365+", 600, 60],
    ]);
  });
});
