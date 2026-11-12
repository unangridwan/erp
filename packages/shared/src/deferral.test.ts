import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { deferralSchedule, nextRecurringDate, recurringDates, recurringOccurrence } from "./deferral.js";

describe("deferralSchedule", () => {
  it("prorata hari per bulan; total tepat sama", () => {
    const s = deferralSchedule("2026-01-15", "2027-01-14", "12000000");
    expect(s).toHaveLength(13);
    expect(s[0]).toMatchObject({ date: "2026-01-31", days: 17 });
    expect(s.at(-1)).toMatchObject({ date: "2027-01-14", days: 14 });
    const sum = s.reduce((a, p) => a.plus(p.amount), new Decimal(0));
    expect(sum.toFixed(2)).toBe("12000000.00");
    // Februari 28 hari dari 365 hari.
    expect(s[1]!.amount).toBe(new Decimal(12000000).times(28).div(365).toFixed(2));
  });
  it("satu bulan penuh menjadi satu periode", () => {
    expect(deferralSchedule("2026-03-01", "2026-03-31", "100")).toEqual([
      { date: "2026-03-31", from: "2026-03-01", to: "2026-03-31", days: 31, amount: "100.00" },
    ]);
  });
  it("menolak akhir sebelum mulai", () => {
    expect(() => deferralSchedule("2026-03-02", "2026-03-01", "1")).toThrow();
  });
});

describe("jadwal berulang", () => {
  it("akhir bulan tetap akhir bulan", () => {
    expect([0, 1, 2].map((n) => recurringOccurrence("2026-01-31", "monthly", 1, n))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(recurringOccurrence("2026-01-15", "quarterly", 1, 2)).toBe("2026-07-15");
    expect(recurringOccurrence("2026-01-05", "weekly", 2, 1)).toBe("2026-01-19");
  });
  it("tanggal jatuh tempo dibatasi tanggal akhir & batas jumlah", () => {
    const t = { startDate: "2026-01-31", frequency: "monthly" as const, interval: 1, endDate: "2026-04-15" };
    expect(recurringDates(t, "2026-01-01", "2026-12-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(recurringDates({ ...t, endDate: null }, "2026-02-01", "2026-12-31", 2)).toEqual([
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(nextRecurringDate(t, "2026-03-31")).toBeNull();
    expect(nextRecurringDate({ ...t, endDate: null }, "2026-02-28")).toBe("2026-03-31");
  });
});
