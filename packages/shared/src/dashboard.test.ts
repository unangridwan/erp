import { describe, expect, it } from "vitest";
import {
  BUILTIN_DASHBOARDS,
  changePercent,
  dashboardSchema,
  dashboardWidgetSchema,
  kpiValue,
  periodRange,
  previousRange,
} from "./dashboard.js";

describe("dashboard", () => {
  it("rentang periode & pembanding", () => {
    expect(periodRange("this_month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("last_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("this_quarter", "2026-05-20")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(periodRange("last_12_months", "2026-11-13")).toEqual({ from: "2025-12-01", to: "2026-11-30" });
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousRange("2026-01-01", "2026-12-31")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(previousRange("2026-03-10", "2026-03-19")).toEqual({ from: "2026-02-28", to: "2026-03-09" });
  });

  it("nilai KPI & perubahan", () => {
    expect(
      kpiValue({
        columns: [{ key: "sum__x", header: "x", numeric: true }],
        rows: [{ sum__x: 1500 }],
        total: 1,
      }),
    ).toBe(1500);
    expect(kpiValue({ columns: [{ key: "a", header: "a" }], rows: [{}, {}, {}], total: 3 })).toBe(3);
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(5, 0)).toBeNull();
  });

  it("validasi widget & dashboard bawaan lolos skema dengan id unik", () => {
    expect(
      dashboardWidgetSchema.safeParse({ id: "a", title: "", type: "kpi", source: { reportId: "x" } }).success,
    ).toBe(false);
    for (const d of BUILTIN_DASHBOARDS) {
      expect(dashboardSchema.safeParse({ name: d.name[0], widgets: d.widgets }).success, d.key).toBe(true);
      for (const wg of d.widgets.filter((x) => x.type !== "kpi" && x.type !== "table"))
        expect("config" in wg.source && wg.source.config.chart, wg.title).toBeTruthy();
    }
    const ids = BUILTIN_DASHBOARDS.flatMap((d) => d.widgets.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
