import { describe, expect, it } from "vitest";
import {
  ageBand,
  compaRatio,
  countBy,
  genderPayGap,
  manpowerBudgetSchema,
  median,
  retentionRate,
  tenureBand,
  tenureYears,
  turnoverRate,
  variance,
  yearsBetween,
} from "./workforce.js";

describe("analitik tenaga kerja", () => {
  it("turnover, retensi, selisih anggaran", () => {
    expect(turnoverRate(3, 20, 22)).toBe(14.29);
    expect(turnoverRate(1, 0, 0)).toBe(0);
    expect(retentionRate(20, 17)).toBe(85);
    expect(variance(10, 12)).toEqual({ diff: 2, percent: 20 });
    expect(variance(0, 3)).toEqual({ diff: 3, percent: null });
  });

  it("umur, masa kerja, kelompok", () => {
    expect(yearsBetween("1990-05-12", "2026-05-11")).toBe(35);
    expect(yearsBetween("1990-05-12", "2026-05-12")).toBe(36);
    expect(tenureYears("2024-01-01", "2026-07-01")).toBe(2.5);
    expect(ageBand("2003-01-01", "2026-10-29")).toBe("< 25");
    expect(ageBand("1980-01-01", "2026-10-29")).toBe("45–54");
    expect(ageBand(null, "2026-10-29")).toBeNull();
    expect(tenureBand("2026-03-01", "2026-10-29")).toBe("< 1 thn");
    expect(tenureBand("2014-01-01", "2026-10-29")).toBe("≥ 10 thn");
  });

  it("median, compa-ratio, kesenjangan gender, hitung per kunci", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(compaRatio(10_000_000, { minWage: 6_000_000, maxWage: 14_000_000 })).toBe(1);
    expect(compaRatio(8_000_000, { minWage: 0, maxWage: 0 })).toBeNull();
    expect(genderPayGap(10_000_000, 9_000_000)).toBe(10);
    expect(genderPayGap(0, 9)).toBeNull();
    expect(countBy([{ g: "L" }, { g: "P" }, { g: "P" }, { g: null }], (r) => r.g)).toEqual([
      { label: "P", count: 2 },
      { label: "L", count: 1 },
      { label: "—", count: 1 },
    ]);
    expect(
      countBy([{ b: "25–34" }, { b: "< 25" }], (r) => r.b, ["< 25", "25–34"]).map((x) => x.label),
    ).toEqual(["< 25", "25–34"]);
  });

  it("anggaran: baris dobel ditolak", () => {
    const line = { departmentId: null, month: 1, headcount: 5, cost: 1000 };
    expect(manpowerBudgetSchema.safeParse({ lines: [line, line] }).success).toBe(false);
    expect(manpowerBudgetSchema.parse({ lines: [line] }).lines[0]).toMatchObject({
      headcount: "5.00",
      cost: "1000.00",
    });
  });
});
