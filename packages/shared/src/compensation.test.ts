import { describe, expect, it } from "vitest";
import {
  annualCostDelta,
  compensationProposalSchema,
  cycleBudget,
  gradeFlag,
  newWageFromPercent,
  percentFromWage,
} from "./compensation.js";

describe("kompensasi: siklus kenaikan gaji", () => {
  it("upah baru dari persen & sebaliknya", () => {
    expect(newWageFromPercent("8000000", 7)).toBe("8560000");
    expect(newWageFromPercent("7333333", 10)).toBe("8066666");
    expect(newWageFromPercent("5000000", -100)).toBe("0");
    expect(percentFromWage("8000000", "8560000")).toBe("7.00");
    expect(percentFromWage("0", "1")).toBe("0.00");
  });

  it("anggaran persen dari total upah peserta; melebihi anggaran terdeteksi", () => {
    const proposals = [
      { currentWage: "10000000", newWage: "10700000" },
      { currentWage: "10000000", newWage: "10400000" },
    ];
    expect(cycleBudget({ budgetKind: "percent", budgetValue: 5 }, proposals)).toEqual({
      baseline: "20000000",
      budget: "1000000",
      used: "1100000",
      remaining: "-100000",
      averagePercent: "5.50",
      overBudget: true,
    });
    expect(cycleBudget({ budgetKind: "amount", budgetValue: "1500000" }, proposals).overBudget).toBe(false);
    expect(cycleBudget({ budgetKind: "percent", budgetValue: 5 }, []).averagePercent).toBe("0.00");
  });

  it("biaya tahunan: 13 bulan upah + selisih BPJS perusahaan (Kesehatan & JP dibatasi)", () => {
    // Upah 5 jt → 5,5 jt: Δ 500rb × 13 = 6,5 jt; BPJS perusahaan (4 + 3,7 + 0,24 + 0,3 + 2)% = 10,24% × 500rb × 12.
    expect(annualCostDelta("5000000", "5500000")).toBe(String(6_500_000 + 51_200 * 12));
    // Di atas batas upah Kesehatan & JP: hanya JHT, JKK, JKM yang naik (4,24%).
    expect(annualCostDelta("20000000", "21000000")).toBe(String(13_000_000 + 42_400 * 12));
    expect(annualCostDelta("8000000", "8000000")).toBe("0");
  });

  it("posisi terhadap skala golongan", () => {
    const grade = { minWage: "5000000", maxWage: "9000000" };
    expect(gradeFlag("4000000", grade)).toBe("below");
    expect(gradeFlag("9500000", grade)).toBe("above");
    expect(gradeFlag("7000000", grade)).toBeNull();
    expect(gradeFlag("7000000", null)).toBeNull();
    expect(gradeFlag("99000000", { minWage: "1", maxWage: "0" })).toBeNull();
  });

  it("usulan wajib berisi persen atau upah baru", () => {
    expect(compensationProposalSchema.safeParse({ reason: "x" }).success).toBe(false);
    expect(compensationProposalSchema.parse({ newWage: 9000000 }).newWage).toBe("9000000.00");
  });
});
