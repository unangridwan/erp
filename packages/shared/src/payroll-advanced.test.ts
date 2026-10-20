import { describe, expect, it } from "vitest";
import {
  bankOf,
  claimLimitCheck,
  bankTransferFile,
  fullMonths,
  gradePosition,
  retroPay,
  thrAmount,
  type TransferRow,
} from "./payroll-advanced.js";
import {
  employeeChangeSchema,
  expenseClaimSchema,
  payrollCostQuerySchema,
  salaryGradeSchema,
} from "./schemas.js";

describe("THR (Permenaker 6/2016)", () => {
  const base = { wageType: "monthly" as const, monthlyWage: "6000000", holidayDate: "2026-03-20" };

  it("masa kerja ≥ 12 bulan: satu bulan upah (pokok + tunjangan tetap)", () => {
    expect(thrAmount({ ...base, joinDate: "2025-03-20" })).toMatchObject({
      eligible: true,
      serviceMonths: 12,
      basis: "full",
      amount: "6000000",
    });
  });

  it("masa kerja 1–12 bulan: prorata masa kerja/12", () => {
    expect(thrAmount({ ...base, joinDate: "2025-11-01" })).toMatchObject({
      serviceMonths: 4,
      basis: "prorata",
      amount: "2000000",
    });
    expect(thrAmount({ ...base, monthlyWage: "5000000", joinDate: "2025-08-21" })).toMatchObject({
      serviceMonths: 6,
      amount: "2500000",
    });
  });

  it("kurang dari sebulan atau masuk setelah hari raya: tidak berhak", () => {
    expect(thrAmount({ ...base, joinDate: "2026-03-01" })).toMatchObject({ eligible: false, amount: "0" });
    expect(thrAmount({ ...base, joinDate: "2026-04-01" })).toMatchObject({ eligible: false, amount: "0" });
  });

  it("harian lepas/borongan: rata-rata upah maks. 12 bulan terakhir", () => {
    expect(
      thrAmount({
        ...base,
        wageType: "daily",
        joinDate: "2025-10-01",
        history: ["3000000", "2500000", "3500000"],
      }),
    ).toMatchObject({ basis: "average", amount: "3000000" });
    const year = Array.from({ length: 14 }, (_, i) => (i < 12 ? "2000000" : "9000000"));
    expect(thrAmount({ ...base, wageType: "piece", joinDate: "2024-01-01", history: year }).amount).toBe(
      "2000000",
    );
  });

  it("bulan penuh", () => {
    expect(fullMonths("2025-01-31", "2025-02-28")).toBe(0);
    expect(fullMonths("2025-01-15", "2026-01-15")).toBe(12);
  });
});

describe("rapel kenaikan upah", () => {
  it("selisih per bulan sejak tanggal berlaku; bulan pertama prorata hari kalender", () => {
    const r = retroPay({
      effectiveDate: "2026-01-16",
      monthlyDue: "7100000",
      months: [
        { period: "2025-12", paid: "6000000" },
        { period: "2026-02", paid: "6000000" },
        { period: "2026-01", paid: "6000000" },
      ],
    });
    // Januari: 1.100.000 × 16/31 = 567.742
    expect(r.lines).toEqual([
      { period: "2026-01", paid: "6000000", due: "7100000", fraction: "0.5161", diff: "567742" },
      { period: "2026-02", paid: "6000000", due: "7100000", fraction: "1", diff: "1100000" },
    ]);
    expect(r.total).toBe("1667742");
  });

  it("rapel yang sudah dibayar dikurangkan; selisih negatif diabaikan", () => {
    const r = retroPay({
      effectiveDate: "2026-01-01",
      monthlyDue: "7000000",
      months: [
        { period: "2026-01", paid: "6000000", alreadyPaid: "1000000" },
        { period: "2026-02", paid: "6000000", alreadyPaid: "400000" },
        { period: "2026-03", paid: "7500000" },
      ],
    });
    expect(r.lines.map((l) => [l.period, l.diff])).toEqual([["2026-02", "600000"]]);
    expect(r.total).toBe("600000");
  });
});

describe("struktur & skala upah", () => {
  it("posisi upah terhadap rentang golongan", () => {
    const g = { minWage: "5000000", maxWage: "8000000" };
    expect(gradePosition("4999999", g)).toBe("below");
    expect(gradePosition("5000000", g)).toBe("within");
    expect(gradePosition("8000001", g)).toBe("above");
  });

  it("validasi golongan & query laporan biaya", () => {
    expect(salaryGradeSchema.parse({ code: "g1", name: "I", minWage: "5", maxWage: "5" }).code).toBe("G1");
    expect(payrollCostQuerySchema.safeParse({ from: "2026-03", to: "2026-01" }).success).toBe(false);
  });
});

describe("file transfer gaji", () => {
  const rows: TransferRow[] = [
    {
      employeeNumber: "EMP1",
      name: "Rina",
      bankName: "BCA",
      bankAccount: "123-456-7890",
      bankAccountName: "Rina Wulandari, S.E.",
      amount: "5500000",
    },
    {
      employeeNumber: "EMP2",
      name: "Budi",
      bankName: "Bank Mandiri",
      bankAccount: "1300011112222",
      bankAccountName: "",
      amount: "4000000",
    },
    {
      employeeNumber: "EMP3",
      name: "Sari",
      bankName: "BRI",
      bankAccount: "0021-01-000123-30-1",
      bankAccountName: "Sari",
      amount: "3000000",
    },
    {
      employeeNumber: "EMP4",
      name: "Dodi",
      bankName: "BNI",
      bankAccount: "",
      bankAccountName: "Dodi",
      amount: "3000000",
    },
  ];
  const header = {
    sourceAccount: "888-000-1111",
    companyCode: "PTMAJU",
    date: "2026-03-25",
    remark: "Gaji 2026-03",
  };

  it("kenali bank dari nama bebas", () => {
    expect(bankOf("Bank Central Asia")).toBe("bca");
    expect(bankOf("PT Bank Rakyat Indonesia (Persero)")).toBe("bri");
    expect(bankOf("bni 46")).toBe("bni");
    expect(bankOf("Bank Syariah Indonesia")).toBeNull();
    expect(bankOf("Mandiri Syariah")).toBeNull();
    expect(bankOf("BTN")).toBeNull();
  });

  it("BCA: header + detail hanya rekening BCA, nama dibersihkan", () => {
    const f = bankTransferFile("bca", header, rows);
    expect(f.filename).toBe("transfer-gaji-bca-2026-03.txt");
    expect(f.content).toBe(
      "H,PTMAJU,8880001111,20260325,1,5500000,GAJI 2026 03\r\nD,1,1234567890,5500000,RINA WULANDARI S E,EMP1\r\n",
    );
    expect(f.skipped.map((s) => [s.employeeNumber, s.reason])).toEqual([
      ["EMP2", "Bank berbeda"],
      ["EMP3", "Bank berbeda"],
      ["EMP4", "Rekening kosong"],
    ]);
  });

  it("Mandiri, BRI, BNI, dan CSV umum", () => {
    expect(bankTransferFile("mandiri", header, rows).content).toBe(
      "P,20260325,8880001111,1,4000000\r\n1300011112222,BUDI,IDR,4000000,GAJI 2026 03,EMP2,IBU\r\n",
    );
    const bri = bankTransferFile("bri", header, rows).content.split("\r\n");
    expect(bri[1]).toBe("1;002101000123301;SARI;3000000;GAJI 2026 03;8880001111;25/03/2026");
    expect(bankTransferFile("bni", header, rows)).toMatchObject({ count: 0, total: "0" });
    const all = bankTransferFile("csv", header, rows);
    expect(all).toMatchObject({ count: 3, total: "12500000" });
    expect(all.content).toContain("NIK Karyawan");
  });
});

describe("klaim biaya", () => {
  it("plafon tahunan per kategori", () => {
    expect(claimLimitCheck({ limit: null, used: "9000000", amount: "1" })).toMatchObject({
      ok: true,
      remaining: null,
    });
    expect(claimLimitCheck({ limit: "5000000", used: "3000000", amount: "2000000" })).toEqual({
      ok: true,
      remaining: "2000000",
      excess: "0",
    });
    expect(claimLimitCheck({ limit: "5000000", used: "4500000", amount: "1000000" })).toEqual({
      ok: false,
      remaining: "500000",
      excess: "500000",
    });
    expect(claimLimitCheck({ limit: "1000000", used: "1500000", amount: "1" })).toMatchObject({
      remaining: "0",
      ok: false,
    });
  });

  it("validasi klaim & perubahan data", () => {
    const line = { categoryId: "00000000-0000-4000-8000-000000000001", date: "2026-03-01", amount: "150000" };
    expect(expenseClaimSchema.safeParse({ date: "2026-03-02", lines: [] }).success).toBe(false);
    expect(expenseClaimSchema.parse({ date: "2026-03-02", lines: [line] }).payMethod).toBe("payslip");
    const big = { name: "a.pdf", type: "application/pdf", data: "A".repeat(3 * 1024 * 1024) };
    expect(
      expenseClaimSchema.safeParse({ date: "2026-03-02", lines: [{ ...line, attachment: big }] }).success,
    ).toBe(false);
    const gif = { name: "a.gif", type: "image/gif", data: "AAAA" };
    expect(
      expenseClaimSchema.safeParse({ date: "2026-03-02", lines: [{ ...line, attachment: gif }] }).success,
    ).toBe(false);
    expect(employeeChangeSchema.safeParse({ note: "x" }).success).toBe(false);
    expect(employeeChangeSchema.parse({ bankAccount: "123-456" }).bankAccount).toBe("123-456");
  });
});
