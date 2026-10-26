import { describe, expect, it } from "vitest";
import {
  accrualPeriods,
  addMonths,
  balanceOn,
  cappedAccrual,
  carryOver,
  compensatoryDays,
  leaveDays,
  leaveLedger,
  lowestRemaining,
} from "./leave.js";

describe("leaveDays", () => {
  it("hari kerja, setengah hari, hari kalender", () => {
    // 2026-05-04 Senin s.d. 2026-05-10 Minggu, 2026-05-05 libur.
    expect(leaveDays({ from: "2026-05-04", to: "2026-05-10", holidays: ["2026-05-05"] })).toBe(4);
    expect(leaveDays({ from: "2026-05-04", to: "2026-05-04", halfDay: "am" })).toBe(0.5);
    expect(leaveDays({ from: "2026-05-09", to: "2026-05-09", halfDay: "pm" })).toBe(0);
    expect(leaveDays({ from: "2026-05-04", to: "2026-07-26", calendar: true })).toBe(84);
  });

  it("addMonths memotong akhir bulan", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-11-15", 14)).toBe("2027-01-15");
  });
});

describe("leaveLedger", () => {
  const carry = { id: "carry", days: 4, dateFrom: "2026-01-01", dateTo: "2026-03-31", source: "carry_over" };
  const annual = { id: "annual", days: 12, dateFrom: "2026-01-01", dateTo: "2026-12-31", source: "accrual" };

  it("FIFO: carry-over yang kedaluwarsa duluan dipakai lebih dulu; sisa carry-over kedaluwarsa", () => {
    const ledger = leaveLedger(
      [annual, carry],
      [{ id: "r1", dateFrom: "2026-02-10", days: 3 }],
      "2026-04-15",
    );
    expect(ledger.allocations.find((a) => a.id === "carry")).toMatchObject({
      used: "3.00",
      remaining: "1.00",
    });
    expect(ledger.allocations.find((a) => a.id === "annual")).toMatchObject({ used: "0.00" });
    expect(balanceOn(ledger, "2026-02-15")).toMatchObject({ allocated: "16.00", remaining: "13.00" });
    // Setelah 31 Maret sisa carry-over hangus.
    expect(balanceOn(ledger, "2026-04-15")).toMatchObject({ allocated: "12.00", remaining: "12.00" });
    expect(ledger.entries.filter((e) => e.kind === "expire")).toEqual([
      { date: "2026-04-01", kind: "expire", days: "1.00", ref: "carry" },
    ]);
    expect(balanceOn(ledger, "2026-03-10")).toMatchObject({ expiringSoon: "1.00", expiringOn: "2026-03-31" });
  });

  it("cuti setelah carry-over kedaluwarsa memakai jatah tahun berjalan; kekurangan jadi minus", () => {
    const ledger = leaveLedger(
      [annual, carry],
      [
        { id: "r1", dateFrom: "2026-05-04", days: 10 },
        { id: "r2", dateFrom: "2026-08-03", days: 5 },
      ],
      "2026-09-01",
    );
    expect(ledger.allocations.find((a) => a.id === "annual")).toMatchObject({
      used: "15.00",
      remaining: "-3.00",
    });
    expect(ledger.deficit).toBe("3.00");
    expect(lowestRemaining(ledger)).toBe("-3.00");
    expect(balanceOn(ledger, "2026-09-01").remaining).toBe("-3.00");
  });

  it("tanpa jatah sama sekali: defisit di tahun pengajuan", () => {
    const ledger = leaveLedger([], [{ id: "r", dateFrom: "2026-02-02", days: 2 }], "2026-02-02");
    expect(balanceOn(ledger, "2026-02-02").remaining).toBe("-2.00");
  });
});

describe("akrual & carry-over", () => {
  it("tahunan setelah 12 bulan masa kerja (UU 13/2003)", () => {
    const yearly = { frequency: "yearly" as const, daysPerPeriod: 12, startAfterMonths: 12 };
    expect(
      accrualPeriods(yearly, { assignedFrom: "2024-01-01", joinDate: "2024-03-15", until: "2026-06-01" }),
    ).toEqual([
      { period: "2025", days: "12.00", dateFrom: "2025-03-15", dateTo: "2025-12-31" },
      { period: "2026", days: "12.00", dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    ]);
    expect(
      accrualPeriods(yearly, { assignedFrom: "2026-01-01", joinDate: "2026-02-01", until: "2026-12-31" }),
    ).toEqual([]);
  });

  it("bulanan sampai bulan berjalan, dengan batas saldo", () => {
    const monthly = { frequency: "monthly" as const, daysPerPeriod: 1, startAfterMonths: 0 };
    const p = accrualPeriods(monthly, {
      assignedFrom: "2026-01-10",
      joinDate: "2020-01-01",
      until: "2026-03-05",
    });
    expect(p.map((x) => [x.period, x.dateFrom, x.dateTo])).toEqual([
      ["2026-01", "2026-01-10", "2026-12-31"],
      ["2026-02", "2026-02-01", "2026-12-31"],
      ["2026-03", "2026-03-01", "2026-12-31"],
    ]);
    expect(cappedAccrual("11.5", 1, 12)).toBe("0.50");
    expect(cappedAccrual("12", 1, 12)).toBe("0.00");
    expect(cappedAccrual("3", 1, null)).toBe("1.00");
  });

  it("carry-over: semua / berbatas / kedaluwarsa N bulan", () => {
    expect(carryOver({ carryOver: "none" }, 5, 2026)).toBeNull();
    expect(carryOver({ carryOver: "all" }, 5, 2026)).toEqual({
      days: "5.00",
      dateFrom: "2027-01-01",
      dateTo: "2027-12-31",
    });
    expect(carryOver({ carryOver: "limited", carryOverMax: 3, carryOverExpiryMonths: 3 }, 5, 2026)).toEqual({
      days: "3.00",
      dateFrom: "2027-01-01",
      dateTo: "2027-03-31",
    });
    expect(carryOver({ carryOver: "all" }, -1, 2026)).toBeNull();
  });

  it("cuti pengganti: jam / 8 dibulatkan ke bawah per setengah hari", () => {
    expect(compensatoryDays(8)).toBe("1.00");
    expect(compensatoryDays(6)).toBe("0.50");
    expect(compensatoryDays(3)).toBe("0.00");
    expect(compensatoryDays(12)).toBe("1.50");
  });
});
