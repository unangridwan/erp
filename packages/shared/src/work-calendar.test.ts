import { describe, expect, it } from "vitest";
import { leaveDays } from "./leave.js";
import { workingDays } from "./payroll.js";
import {
  dayBreakdown,
  eachDate,
  ID_NATIONAL_HOLIDAYS,
  isWorkday,
  workDaysPerMonth,
} from "./work-calendar.js";

describe("kalender kerja", () => {
  it("workingDays mengikuti hari kerja jadwal", () => {
    // 2026-11-02 Senin s.d. 2026-11-08 Minggu.
    expect(workingDays("2026-11-02", "2026-11-08")).toBe(5);
    expect(workingDays("2026-11-02", "2026-11-08", [], [1, 2, 3, 4, 5, 6])).toBe(6);
    // Shift libur Selasa & Rabu.
    expect(workingDays("2026-11-02", "2026-11-08", ["2026-11-07"], [0, 1, 4, 5, 6])).toBe(4);
  });

  it("leaveDays memakai isWorkday bila diberikan", () => {
    const off = new Set(["2026-11-04"]);
    const sixDays = (date: string) => isWorkday(date, [1, 2, 3, 4, 5, 6], off);
    expect(leaveDays({ from: "2026-11-02", to: "2026-11-08", isWorkday: sixDays })).toBe(5);
    expect(leaveDays({ from: "2026-11-07", to: "2026-11-07", halfDay: "am", isWorkday: sixDays })).toBe(0.5);
    expect(leaveDays({ from: "2026-11-08", to: "2026-11-08", halfDay: "am", isWorkday: sixDays })).toBe(0);
  });

  it("pembagi upah harian", () => {
    expect(workDaysPerMonth()).toBe(21);
    expect(workDaysPerMonth([1, 2, 3, 4, 5, 6])).toBe(25);
    expect(workDaysPerMonth([1, 2, 3, 4])).toBe(17);
  });

  it("rincian hari dihitung & dilewati", () => {
    const r = dayBreakdown(
      "2026-11-06",
      "2026-11-09",
      () => [1, 2, 3, 4, 5],
      new Map([["2026-11-09", { name: "Libur kantor", kind: "company" as const }]]),
    );
    expect(r.counted).toEqual(["2026-11-06"]);
    expect(r.skipped).toEqual([
      { date: "2026-11-07", reason: "day_off" },
      { date: "2026-11-08", reason: "day_off" },
      { date: "2026-11-09", reason: "company", name: "Libur kantor" },
    ]);
  });

  it("data libur nasional valid", () => {
    expect(eachDate("2026-12-30", "2027-01-02")).toHaveLength(4);
    for (const [year, rows] of Object.entries(ID_NATIONAL_HOLIDAYS)) {
      const dates = rows.map((r) => r.date);
      expect(new Set(dates).size).toBe(dates.length);
      for (const d of dates) {
        expect(d.startsWith(`${year}-`)).toBe(true);
        expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d);
      }
      expect([...dates].sort()).toEqual(dates);
    }
  });
});
