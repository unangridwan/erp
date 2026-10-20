import { describe, expect, it } from "vitest";
import {
  DEFAULT_BPJS,
  bpjsContributions,
  bpjsProgram,
  computePayslip,
  overtimePay,
  pph21Annual,
  pph21Monthly,
  progressiveTax,
  ptkpAmount,
  terCategory,
  terRate,
  workingDays,
  type PayslipInput,
} from "./payroll.js";

describe("PTKP & kategori TER", () => {
  it("PTKP per status", () => {
    expect(ptkpAmount("TK/0")).toBe("54000000");
    expect(ptkpAmount("TK/2")).toBe("63000000");
    expect(ptkpAmount("K/0")).toBe("58500000");
    expect(ptkpAmount("K/3")).toBe("72000000");
  });
  it("kategori A/B/C", () => {
    expect(["TK/0", "TK/1", "K/0"].map((s) => terCategory(s as "TK/0"))).toEqual(["A", "A", "A"]);
    expect(["TK/2", "TK/3", "K/1", "K/2"].map((s) => terCategory(s as "TK/0"))).toEqual(["B", "B", "B", "B"]);
    expect(terCategory("K/3")).toBe("C");
  });
});

describe("TER bulanan (PP 58/2023)", () => {
  it("tarif menurut lapisan", () => {
    expect(terRate("A", 5_400_000)).toBe("0");
    expect(terRate("A", 5_400_001)).toBe("0.25");
    expect(terRate("A", 10_000_000)).toBe("2");
    expect(terRate("B", 10_000_000)).toBe("1.5");
    expect(terRate("C", 10_000_000)).toBe("1.5");
    expect(terRate("A", 2_000_000_000)).toBe("34");
  });
  it("PPh 21 bulanan; tanpa NPWP 20% lebih tinggi", () => {
    expect(pph21Monthly(10_000_000, "TK/0")).toEqual({ category: "A", rate: "2", tax: "200000" });
    expect(pph21Monthly(10_000_000, "TK/0", false).tax).toBe("240000");
  });
});

describe("tarif progresif Pasal 17", () => {
  it("menghitung per lapisan", () => {
    expect(progressiveTax(60_000_000)).toBe("3000000");
    expect(progressiveTax(100_000_000)).toBe("9000000");
    expect(progressiveTax(300_000_000)).toBe("44000000");
    expect(progressiveTax(0)).toBe("0");
  });
  it("PPh 21 setahun: biaya jabatan maks. 500 rb/bulan, PKP dibulatkan ribuan", () => {
    const r = pph21Annual({
      annualGross: 156_537_600,
      months: 12,
      employeePension: 4_145_688,
      status: "TK/0",
    });
    expect(r).toEqual({
      biayaJabatan: "6000000",
      neto: "146391912",
      ptkp: "54000000",
      pkp: "92391000",
      tax: "7858650",
    });
    // Bekerja 6 bulan: biaya jabatan dibatasi 3 jt.
    expect(
      pph21Annual({ annualGross: 100_000_000, months: 6, employeePension: 0, status: "TK/0" }).biayaJabatan,
    ).toBe("3000000");
  });
});

describe("BPJS", () => {
  it("iuran dari upah di bawah batas", () => {
    expect(bpjsContributions(10_000_000)).toEqual({
      employer: { kes: "400000", jht: "370000", jkk: "24000", jkm: "30000", jp: "200000" },
      employee: { kes: "100000", jht: "200000", jp: "100000" },
      kesWage: "10000000",
      tkWage: "10000000",
    });
  });
  it("kepesertaan per program: tanpa BPJS Kesehatan / Ketenagakerjaan / JP", () => {
    const noKes = bpjsContributions(10_000_000, DEFAULT_BPJS, false, { kes: false, tk: true, jp: true });
    expect(noKes.employer.kes).toBe("0");
    expect(noKes.employee.kes).toBe("0");
    expect(noKes.kesWage).toBe("0");
    expect(noKes.employer.jht).toBe("370000");
    const noTk = bpjsContributions(10_000_000, DEFAULT_BPJS, false, { kes: true, tk: false, jp: true });
    expect([
      noTk.employer.jht,
      noTk.employer.jkk,
      noTk.employer.jkm,
      noTk.employer.jp,
      noTk.employee.jht,
    ]).toEqual(["0", "0", "0", "0", "0"]);
    expect(noTk.employer.kes).toBe("400000");
    const noJp = bpjsContributions(10_000_000, DEFAULT_BPJS, false, { kes: true, tk: true, jp: false });
    expect([noJp.employer.jp, noJp.employee.jp, noJp.employer.jht]).toEqual(["0", "0", "370000"]);
    expect(bpjsProgram("BPJS_KES_ER")).toBe("kes");
    expect(bpjsProgram("JKK")).toBe("tk");
  });
  it("batas upah BPJS Kesehatan & JP", () => {
    const r = bpjsContributions(15_000_000, DEFAULT_BPJS);
    expect(r.employer.kes).toBe("480000");
    expect(r.employee.kes).toBe("120000");
    expect(r.employer.jp).toBe("210948");
    expect(r.employee.jp).toBe("105474");
    expect(r.employer.jht).toBe("555000");
    expect(r.kesWage).toBe("12000000");
    expect(r.tkWage).toBe("15000000");
  });
});

describe("lembur & hari kerja", () => {
  it("upah lembur PP 35/2021", () => {
    expect(overtimePay(3_460_000, 3, "workday")).toBe("110000");
    expect(overtimePay(3_460_000, 10, "rest_day")).toBe("460000");
  });
  it("hari kerja Senin–Jumat dikurangi libur", () => {
    expect(workingDays("2026-10-01", "2026-10-31")).toBe(22);
    expect(workingDays("2026-10-01", "2026-10-31", ["2026-10-02", "2026-10-03"])).toBe(21);
  });
});

describe("slip gaji", () => {
  const base: PayslipInput = {
    wage: 10_000_000,
    allowances: [
      { code: "TJAB", name: "Tunjangan jabatan", amount: 2_000_000, fixed: true },
      { code: "TRANS", name: "Tunjangan transport", amount: 500_000 },
    ],
    deductions: [],
    overtime: [],
    unpaidDays: 0,
    workingDays: 22,
    status: "TK/0",
    hasNpwp: true,
    bpjs: DEFAULT_BPJS,
    isFinal: false,
    ytd: { gross: 0, pph21: 0, employeePension: 0, months: 0 },
  };

  it("Januari–November: TER dari bruto termasuk premi JKK, JKM, BPJS Kesehatan perusahaan", () => {
    const r = computePayslip(base);
    expect(r).toMatchObject({
      earnings: "12500000",
      gross: "13044800",
      terCategory: "A",
      terRate: "5",
      pph21: "652240",
      employeeBpjs: "465474",
      employerBpjs: "1199748",
      // Terpisah per program: Kesehatan (batas upah Rp12 jt) & Ketenagakerjaan.
      kesEmployee: "120000",
      kesEmployer: "480000",
      tkEmployee: "345474",
      tkEmployer: "719748",
      kesWage: "12000000",
      net: "11382286",
    });
    expect(r.lines.find((l) => l.code === "PPH21")?.amount).toBe("-652240");
  });

  it("Desember: PPh 21 setahun dikurangi yang sudah dipotong", () => {
    const r = computePayslip({
      ...base,
      isFinal: true,
      ytd: { gross: 11 * 13_044_800, pph21: 11 * 652_240, employeePension: 11 * 345_474, months: 11 },
    });
    expect(r.annual).toMatchObject({ pkp: "92391000", tax: "7858650" });
    expect(r.pph21).toBe("684010");
    expect(r.terRate).toBeNull();
  });

  it("lembur, cuti tidak berbayar, dan potongan", () => {
    const r = computePayslip({
      ...base,
      overtime: [{ hours: 2, day: "workday" }],
      unpaidDays: 2,
      deductions: [{ code: "LOAN", name: "Cicilan pinjaman", amount: 300_000 }],
    });
    // Upah sejam = 12.000.000 / 173; lembur 2 jam = 3,5 × upah sejam.
    expect(r.lines.find((l) => l.code === "OT")?.amount).toBe("242775");
    expect(r.lines.find((l) => l.code === "UNPAID")?.amount).toBe("-1090909");
    expect(r.deductions).toBe("300000");
  });
});
