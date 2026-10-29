import { describe, expect, it } from "vitest";
import {
  attendanceAllowance,
  benefitContribution,
  benefitPlanSchema,
  effectiveClaimLimit,
} from "./benefits.js";
import { computePayslip, type PayslipInput } from "./payroll.js";

const base: PayslipInput = {
  wage: "10000000",
  allowances: [],
  deductions: [],
  overtime: [],
  unpaidDays: 0,
  workingDays: 21,
  status: "TK/0",
  hasNpwp: true,
  bpjs: { jkkRate: "0.24", kesWageCap: "12000000", jpWageCap: "10042300" },
  isFinal: false,
  ytd: { gross: 0, pph21: 0, employeePension: 0, months: 0 },
};

describe("tunjangan per kehadiran", () => {
  const facts = { presentDays: 20, lateCount: 2, absentDays: 1 };
  it("per hari hadir = tarif × hari hadir", () => {
    expect(attendanceAllowance("per_attendance_day", 35000, facts)).toBe("700000");
  });
  it("premi hilang bila melebihi batas terlambat/absen; batas kosong tidak diperiksa", () => {
    expect(attendanceAllowance("attendance_premium", 300000, facts, { maxLate: 3, maxAbsent: 1 })).toBe(
      "300000",
    );
    expect(attendanceAllowance("attendance_premium", 300000, facts, { maxLate: 1 })).toBe("0");
    expect(attendanceAllowance("attendance_premium", 300000, facts, { maxAbsent: 0 })).toBe("0");
    expect(attendanceAllowance("attendance_premium", 300000, { ...facts, presentDays: 0 })).toBe("0");
  });
});

describe("iuran benefit", () => {
  it("nominal tetap + tanggungan dibayar perusahaan", () => {
    const plan = {
      calc: "fixed" as const,
      employerAmount: 500000,
      employeeAmount: 100000,
      dependentAmount: 150000,
      dependentPayer: "employer" as const,
    };
    expect(benefitContribution(plan, 8000000, 2)).toEqual({ employer: "800000", employee: "100000" });
    expect(benefitContribution({ ...plan, dependentPayer: "employee" }, 8000000, 2)).toEqual({
      employer: "500000",
      employee: "400000",
    });
    expect(benefitContribution(plan, 8000000, 0, { employer: 600000 })).toEqual({
      employer: "600000",
      employee: "100000",
    });
  });
  it("persen upah dengan batas upah", () => {
    const plan = {
      calc: "percent_wage" as const,
      employerAmount: 5,
      employeeAmount: 2,
      wageCap: 10000000,
      dependentAmount: 0,
      dependentPayer: "employer" as const,
    };
    expect(benefitContribution(plan, 15000000, 0)).toEqual({ employer: "500000", employee: "200000" });
  });
  it("plafon golongan menimpa plafon kategori", () => {
    expect(effectiveClaimLimit("1000000", "2500000")).toBe("2500000.00");
    expect(effectiveClaimLimit("1000000", null)).toBe("1000000.00");
    expect(effectiveClaimLimit(null, undefined)).toBeNull();
  });
  it("skema: DPLK bawaan tidak kena pajak, persen > 100 ditolak", () => {
    expect(benefitPlanSchema.parse({ code: "dplk", name: "DPLK", kind: "pension" }).taxable).toBe(false);
    expect(benefitPlanSchema.parse({ code: "ins", name: "Asuransi", kind: "health_insurance" }).taxable).toBe(
      true,
    );
    expect(
      benefitPlanSchema.safeParse({
        code: "x",
        name: "X",
        kind: "pension",
        calc: "percent_wage",
        employerAmount: 150,
      }).success,
    ).toBe(false);
  });
});

describe("slip dengan benefit", () => {
  it("premi asuransi perusahaan (natura) menaikkan bruto & PPh 21, tidak menambah gaji bersih", () => {
    const plain = computePayslip(base);
    const withIns = computePayslip({
      ...base,
      employerBenefits: [{ code: "INS", name: "Premi asuransi", amount: "750000", taxable: true }],
    });
    expect(Number(withIns.gross) - Number(plain.gross)).toBe(750000);
    expect(Number(withIns.pph21)).toBeGreaterThan(Number(plain.pph21));
    expect(Number(withIns.net)).toBe(Number(plain.net) - (Number(withIns.pph21) - Number(plain.pph21)));
    expect(withIns.employerBenefits).toBe("750000");
    expect(withIns.lines.find((l) => l.code === "INS")?.category).toBe("benefit_employer");
  });
  it("DPLK perusahaan tidak menambah bruto; DPLK karyawan menjadi pengurang PPh 21 setahun", () => {
    const er = computePayslip({
      ...base,
      employerBenefits: [{ code: "DPLK_ER", name: "DPLK perusahaan", amount: "500000", taxable: false }],
    });
    expect(er.gross).toBe(computePayslip(base).gross);
    const finalBase = {
      ...base,
      isFinal: true,
      ytd: { gross: 110000000, pph21: 5000000, employeePension: 3300000, months: 11 },
    };
    const noDplk = computePayslip(finalBase);
    const dplk = computePayslip({ ...finalBase, extraPension: "300000" });
    expect(Number(dplk.employeePension) - Number(noDplk.employeePension)).toBe(300000);
    expect(Number(dplk.pph21)).toBeLessThan(Number(noDplk.pph21));
    // BPJS karyawan tidak berubah oleh DPLK.
    expect(dplk.employeeBpjs).toBe(noDplk.employeeBpjs);
  });
});
