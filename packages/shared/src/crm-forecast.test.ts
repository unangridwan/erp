import { describe, expect, it } from "vitest";
import {
  effectiveCategory,
  forecastRollup,
  forecastRow,
  matchTerritory,
  nextAssignee,
  parsePeriod,
  periodOf,
  quotasSchema,
  territorySchema,
} from "./crm-forecast.js";

describe("crm forecast", () => {
  it("periode bulan & kuartal", () => {
    expect(parsePeriod("2028-02")).toEqual({
      key: "2028-02",
      type: "month",
      start: "2028-02-01",
      end: "2028-02-29",
      months: ["2028-02-01"],
    });
    expect(parsePeriod("2026-Q4")).toMatchObject({
      start: "2026-10-01",
      end: "2026-12-31",
      months: ["2026-10-01", "2026-11-01", "2026-12-01"],
    });
    expect(parsePeriod("2026-13")).toBeNull();
    expect(parsePeriod("2026-Q5")).toBeNull();
    expect(periodOf("2026-11-16", "month")).toBe("2026-11");
    expect(periodOf("2026-11-16", "quarter")).toBe("2026-Q4");
    expect(periodOf("2026-03-31", "quarter")).toBe("2026-Q1");
  });

  it("kategori peluang menimpa kategori tahap", () => {
    expect(effectiveCategory({ forecastCategory: null }, { forecastCategory: "commit" })).toBe("commit");
    expect(effectiveCategory({ forecastCategory: "omitted" }, { forecastCategory: "commit" })).toBe(
      "omitted",
    );
    expect(effectiveCategory({}, null)).toBe("pipeline");
    expect(effectiveCategory({ forecastCategory: "aneh" }, null)).toBe("pipeline");
  });

  it("baris forecast: closed, commit, best case, pipeline, kuota", () => {
    const row = forecastRow(
      "u1",
      [
        { userId: "u1", state: "won", amount: "40000000", probability: "100", category: "pipeline" },
        { userId: "u1", state: "open", amount: "30000000", probability: "80", category: "commit" },
        { userId: "u1", state: "open", amount: "20000000", probability: "60", category: "best_case" },
        { userId: "u1", state: "open", amount: "10000000", probability: "10", category: "pipeline" },
        { userId: "u1", state: "open", amount: "99000000", probability: "50", category: "omitted" },
        { userId: "u1", state: "lost", amount: "77000000", probability: "0", category: "commit" },
      ],
      "100000000",
      "75000000",
    );
    expect(row).toEqual({
      userId: "u1",
      closed: "40000000.00",
      commit: "30000000.00",
      bestCase: "20000000.00",
      pipeline: "10000000.00",
      weighted: "37000000.00",
      commitForecast: "70000000.00",
      bestCaseForecast: "90000000.00",
      quota: "100000000.00",
      adjusted: "75000000.00",
      attainment: 40,
      gap: "60000000.00",
      count: 4,
    });
    expect(forecastRow(null, [], null)).toMatchObject({ quota: null, attainment: null, gap: null, count: 0 });
    expect(forecastRow("u", [], "0").attainment).toBeNull();
  });

  it("rollup per pemilik; user berkuota tanpa peluang tetap tampil", () => {
    const rows = forecastRollup(
      [
        { userId: "a", state: "won", amount: "150", probability: "100", category: "pipeline" },
        { userId: null, state: "open", amount: "50", probability: "50", category: "commit" },
      ],
      { a: "100", b: "200" },
      { b: "120" },
    );
    expect(rows.map((r) => [r.userId, r.closed, r.quota, r.attainment, r.gap, r.adjusted])).toEqual([
      ["a", "150.00", "100.00", 150, "-50.00", null],
      [null, "0.00", null, null, null, null],
      ["b", "0.00", "200.00", 0, "200.00", "120.00"],
    ]);
  });

  it("pencocokan wilayah menurut urutan; wilayah tanpa aturan tidak cocok otomatis", () => {
    const territories = [
      { id: "all", sequence: 99, rules: {} },
      { id: "agro-jabar", sequence: 1, rules: { provinces: ["Jawa Barat"], industries: ["Perkebunan"] } },
      { id: "jabar", sequence: 5, rules: { provinces: ["JAWA BARAT", "Banten"] } },
      { id: "off", sequence: 0, active: false, rules: { provinces: ["Jawa Barat"] } },
    ];
    expect(matchTerritory(territories, { province: "jawa barat", industry: "Perkebunan" })?.id).toBe(
      "agro-jabar",
    );
    expect(matchTerritory(territories, { province: " Jawa Barat ", industry: "Ritel" })?.id).toBe("jabar");
    expect(matchTerritory(territories, { province: "Bali" })).toBeNull();
    expect(matchTerritory(territories, {})).toBeNull();
  });

  it("giliran penugasan memilih beban terkecil", () => {
    expect(nextAssignee(["a", "b", "c"], { a: 2, b: 1, c: 1 })).toBe("b");
    expect(nextAssignee(["a", "b"], {})).toBe("a");
    expect(nextAssignee([], {})).toBeNull();
  });

  it("skema kuota & wilayah", () => {
    const id = "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10";
    expect(quotasSchema.safeParse({ quotas: [{ userId: id, month: "2026-11", amount: 5e7 }] }).success).toBe(
      true,
    );
    expect(
      quotasSchema.safeParse({ quotas: [{ userId: id, teamId: id, month: "2026-11", amount: 1 }] }).success,
    ).toBe(false);
    expect(quotasSchema.safeParse({ quotas: [{ userId: id, month: "2026-1", amount: 1 }] }).success).toBe(
      false,
    );
    expect(territorySchema.parse({ name: "Jabar" })).toMatchObject({
      rules: { provinces: [], cities: [], industries: [] },
      memberIds: [],
      sequence: 10,
    });
  });
});
