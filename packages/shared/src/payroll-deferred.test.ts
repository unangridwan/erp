import { describe, expect, it } from "vitest";
import {
  DEFAULT_BPJS,
  computePayslip,
  lateness,
  longServiceMonths,
  pph21Daily,
  serviceYears,
  severance,
  severanceMonths,
  severanceTax,
  type PayslipInput,
  type WorkSchedule,
} from "./payroll.js";

const schedule: WorkSchedule = {
  start: "08:00",
  toleranceMinutes: 10,
  penaltyPerMinute: 1000,
  penaltyPerOccurrence: 5000,
  workDays: [1, 2, 3, 4, 5],
};

describe("keterlambatan", () => {
  it("absen pertama per hari kerja (WIB), toleransi, hari libur & akhir pekan diabaikan", () => {
    const r = lateness(
      [
        { checkIn: "2026-03-02T01:05:00Z", schedule }, // Sen 08.05 — dalam toleransi
        { checkIn: "2026-03-03T06:00:00Z", schedule }, // Sel absen kedua, diabaikan
        { checkIn: "2026-03-03T01:30:00Z", schedule }, // Sel 08.30 — 30 menit
        { checkIn: "2026-03-04T00:50:00Z", schedule }, // Rab 07.50
        { checkIn: "2026-03-05T02:00:00Z", schedule }, // Kam libur
        { checkIn: "2026-03-06T01:11:00Z", schedule }, // Jum 08.11 — 11 menit
        { checkIn: "2026-03-07T03:00:00Z", schedule }, // Sabtu
      ],
      "Asia/Jakarta",
      ["2026-03-05"],
    );
    expect(r).toEqual({
      occurrences: 2,
      minutes: 41,
      penalty: "51000",
      days: [
        { date: "2026-03-03", minutes: 30, penalty: "35000" },
        { date: "2026-03-06", minutes: 11, penalty: "16000" },
      ],
    });
  });
});

describe("pesangon PP 35/2021", () => {
  it("tabel UP & UPMK menurut masa kerja", () => {
    expect([0, 0.5, 1, 2.9, 7.9, 8, 20].map(severanceMonths)).toEqual([1, 1, 2, 3, 8, 9, 9]);
    expect([2.9, 3, 5.9, 6, 9, 12, 15, 18, 21, 23.9, 24, 30].map(longServiceMonths)).toEqual([
      0, 2, 2, 3, 4, 5, 6, 7, 8, 8, 10, 10,
    ]);
    expect(serviceYears("2018-01-15", "2026-03-31")).toBe("8.1667");
    expect(serviceYears("2018-01-15", "2026-01-14")).toBe("7.9167");
  });

  it("PPh 21 final pesangon (PP 68/2009)", () => {
    expect(severanceTax(50_000_000)).toBe("0");
    expect(severanceTax(77_380_952)).toBe("1369047");
    expect(severanceTax(257_500_000)).toBe("26125000");
    expect(severanceTax(600_000_000)).toBe("87500000");
  });

  it("efisiensi karena merugi: 0,5 × UP + UPMK + penggantian cuti", () => {
    expect(
      severance({
        reason: "efficiency_loss",
        joinDate: "2018-01-15",
        endDate: "2026-03-31",
        monthlyWage: 10_000_000,
        unusedLeaveDays: 5,
      }),
    ).toMatchObject({
      article: "Pasal 43 ayat (1)",
      upMonths: 9,
      up: "45000000",
      upmkMonths: 3,
      upmk: "30000000",
      leaveCompensation: "2380952",
      gross: "77380952",
      tax: "1369047",
      net: "76011905",
    });
  });

  it("pensiun 25 tahun: 1,75 × UP + 10 bulan UPMK", () => {
    expect(
      severance({
        reason: "retirement",
        joinDate: "2001-01-01",
        endDate: "2026-01-01",
        monthlyWage: 10_000_000,
      }),
    ).toMatchObject({ up: "157500000", upmk: "100000000", gross: "257500000", tax: "26125000" });
  });

  it("mengundurkan diri: tanpa UP/UPMK, hanya penggantian hak & uang pisah", () => {
    expect(
      severance({
        reason: "resignation",
        joinDate: "2020-01-01",
        endDate: "2026-01-01",
        monthlyWage: 6_300_000,
        unusedLeaveDays: 3,
        separationPay: 2_000_000,
      }),
    ).toMatchObject({
      up: "0",
      upmk: "0",
      leaveCompensation: "900000",
      separationPay: "2000000",
      gross: "2900000",
    });
  });

  it("berakhirnya PKWT: kompensasi proporsional masa kerja", () => {
    expect(
      severance({
        reason: "pkwt_end",
        joinDate: "2025-07-01",
        endDate: "2026-03-31",
        monthlyWage: 10_000_000,
      }),
    ).toMatchObject({ pkwtCompensation: "6666667", up: "0", gross: "6666667" });
  });
});

describe("pekerja harian lepas & borongan", () => {
  it("PPh 21 harian (PMK 168/2023)", () => {
    expect(pph21Daily(400_000)).toBe("0");
    expect(pph21Daily(450_000)).toBe("0");
    expect(pph21Daily(1_000_000)).toBe("5000");
    expect(pph21Daily(3_000_000)).toBe("75000");
    expect(pph21Daily(1_000_000, false)).toBe("6000");
  });

  const base: PayslipInput = {
    wage: 4_000_000,
    allowances: [],
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

  it("harian, belum memenuhi masa kepesertaan penuh: hanya JKK & JKM, PPh harian 0", () => {
    const r = computePayslip({
      ...base,
      casual: { kind: "daily", days: 20, bpjsWage: 4_000_000, onlyJkkJkm: true },
    });
    expect(r).toMatchObject({
      gross: "4021600",
      pph21: "0",
      employeeBpjs: "0",
      employerBpjs: "21600",
      net: "4000000",
    });
    expect(r.terRate).toBeNull();
    expect(r.lines[0]).toMatchObject({ name: "Upah harian (20 hari)", amount: "4000000" });
  });

  it("harian dengan BPJS penuh: PPh 21 harian per hari kerja", () => {
    const r = computePayslip({
      ...base,
      wage: 6_000_000,
      casual: { kind: "daily", days: 10, bpjsWage: 6_000_000, onlyJkkJkm: false },
    });
    expect(r).toMatchObject({ gross: "6272400", pph21: "31360", employeeBpjs: "240000", net: "5728640" });
  });

  it("potongan keterlambatan mengurangi upah & bruto pegawai tetap", () => {
    const r = computePayslip({
      ...base,
      wage: 10_000_000,
      allowances: [
        { code: "TJAB", name: "Tunjangan jabatan", amount: 2_000_000, fixed: true },
        { code: "TRANS", name: "Tunjangan transport", amount: 500_000 },
      ],
      latePenalty: 51_000,
    });
    expect(r).toMatchObject({ earnings: "12449000", gross: "12993800", pph21: "649690" });
    expect(r.lines.find((l) => l.code === "LATE")).toMatchObject({ amount: "-51000", category: "unpaid" });
  });
});
