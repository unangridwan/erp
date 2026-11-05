import { describe, expect, it } from "vitest";
import { resolveRetirementAge, retirementDate } from "./retirement.js";

describe("usia pensiun", () => {
  it("tanggal pensiun per aturan", () => {
    expect(retirementDate("1970-05-17", 56, "birthday")).toBe("2026-05-17");
    expect(retirementDate("1970-05-17", 56, "end_of_month")).toBe("2026-05-31");
    expect(retirementDate("1970-12-17", 56, "next_month_start")).toBe("2027-01-01");
    expect(retirementDate("1968-02-29", 58, "birthday")).toBe("2026-02-28");
  });
  it("prioritas: karyawan > jabatan > golongan > departemen > perusahaan", () => {
    const rules = [
      { kind: "department" as const, refId: "d", retirementAge: 55 },
      { kind: "grade" as const, refId: "g", retirementAge: 58 },
      { kind: "job" as const, refId: "j", retirementAge: 60 },
    ];
    const policy = { retirementAge: 56 };
    expect(resolveRetirementAge({ departmentId: "x" }, policy, rules)).toEqual({
      age: 56,
      source: "company",
    });
    expect(resolveRetirementAge({ departmentId: "d" }, policy, rules)).toEqual({
      age: 55,
      source: "department",
    });
    expect(resolveRetirementAge({ departmentId: "d", gradeId: "g" }, policy, rules).age).toBe(58);
    expect(resolveRetirementAge({ departmentId: "d", gradeId: "g", jobId: "j" }, policy, rules).age).toBe(60);
    expect(resolveRetirementAge({ jobId: "j", retirementAge: 62 }, policy, rules)).toEqual({
      age: 62,
      source: "employee",
    });
    expect(resolveRetirementAge({}, null, []).age).toBe(56);
  });
});
