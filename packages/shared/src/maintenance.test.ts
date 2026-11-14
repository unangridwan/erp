import { describe, expect, it } from "vitest";
import { downtimeHours, periodHours, planDue, planHasInterval, reliability } from "./maintenance.js";

const base = {
  intervalDays: 30 as number | null,
  intervalMeter: null as number | null,
  leadDays: 0,
  startDate: "2026-01-01",
  lastDoneDate: null as string | null,
  lastDoneMeter: null as number | null,
};

describe("maintenance", () => {
  it("jatuh tempo berbasis hari: tanggal mulai, lalu terakhir dikerjakan + interval, dengan toleransi", () => {
    expect(planDue(base, "2025-12-31", 0).due).toBe(false);
    expect(planDue(base, "2026-01-01", 0)).toMatchObject({ due: true, dueDate: "2026-01-01" });
    const done = { ...base, lastDoneDate: "2026-01-01" };
    expect(planDue(done, "2026-01-30", 0)).toMatchObject({ due: false, dueDate: "2026-01-31" });
    expect(planDue({ ...done, leadDays: 3 }, "2026-01-28", 0).due).toBe(true);
  });

  it("jatuh tempo berbasis meter & siklus berganti setelah dikerjakan", () => {
    const p = { ...base, intervalDays: null, intervalMeter: 500, lastDoneMeter: 1000 };
    expect(planDue(p, "2026-06-01", 1499).due).toBe(false);
    const due = planDue(p, "2026-06-01", 1500);
    expect(due).toMatchObject({ due: true, byMeter: true, dueMeter: 1500 });
    expect(planDue({ ...p, lastDoneMeter: 1500 }, "2026-06-01", 1500).cycle).not.toBe(due.cycle);
  });

  it("downtime, MTBF, MTTR, ketersediaan", () => {
    expect(downtimeHours("2026-01-01T08:00:00Z", "2026-01-01T14:30:00Z")).toBe(6.5);
    expect(downtimeHours(null, new Date())).toBe(0);
    const hours = periodHours("2026-01-01", "2026-01-10");
    expect(hours).toBe(240);
    expect(reliability({ failures: 2, downtimeHours: 12, periodHours: hours })).toEqual({
      uptimeHours: 228,
      mtbf: 114,
      mttr: 6,
      availability: 95,
    });
    expect(reliability({ failures: 0, downtimeHours: 0, periodHours: hours }).mtbf).toBeNull();
  });

  it("rencana wajib punya interval hari atau meter", () => {
    expect(planHasInterval({})).toBe(false);
    expect(planHasInterval({ intervalMeter: "0" })).toBe(false);
    expect(planHasInterval({ intervalDays: 30 })).toBe(true);
    expect(planHasInterval({ intervalMeter: "250" })).toBe(true);
  });
});
