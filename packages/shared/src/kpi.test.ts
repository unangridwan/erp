import { describe, expect, it } from "vitest";
import { computeKpi, KPI_BY_CODE, KPI_CATALOG, kpiLoadRange, previousPeriod } from "./kpi.js";

const columns = [
  { key: "dateOrder", header: "Tanggal" },
  { key: "state", header: "Status" },
  { key: "amountUntaxed", header: "Total", numeric: true },
];
const so = (owner: string, dateOrder: string, state: string, amountUntaxed: number) => ({
  _userId: owner,
  dateOrder,
  state,
  amountUntaxed,
});
const rows = [
  // Sari: Maret 2 pesanan (300), 1 penawaran, 1 batal; Februari 1 pesanan (100).
  so("sari", "2026-03-02", "Pesanan", 100),
  so("sari", "2026-03-20", "Pesanan", 200),
  so("sari", "2026-03-21", "Penawaran", 999),
  so("sari", "2026-03-22", "Batal", 999),
  so("sari", "2026-02-10", "Pesanan", 100),
  // Budi: Maret 1 pesanan (500).
  so("budi", "2026-03-05", "Pesanan", 500),
  // Dewi: Maret hanya penawaran.
  so("dewi", "2026-03-06", "Penawaran", 50),
];

describe("KPI pribadi", () => {
  it("katalog: kode unik, ukuran utama terlihat lebih dulu", () => {
    expect(new Set(KPI_CATALOG.map((k) => k.code)).size).toBe(KPI_CATALOG.length);
    for (const k of KPI_CATALOG) expect(k.measures.find((x) => !x.hidden)?.id).toBe("v");
  });

  it("periode sebelumnya & rentang muat", () => {
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-03-10", "2026-03-19")).toEqual({ from: "2026-02-28", to: "2026-03-09" });
    expect(kpiLoadRange("2026-03-01", "2026-03-31")).toEqual({ from: "2025-10-01", to: "2026-03-31" });
  });

  it("omzet: nilai, periode lalu, perubahan, tren, dan peringkat di antara rekan", () => {
    const k = computeKpi(KPI_BY_CODE.get("sales.revenue")!, rows, columns, {
      userId: "sari",
      from: "2026-03-01",
      to: "2026-03-31",
      months: 3,
    });
    expect(k).toMatchObject({ value: 300, previous: 100, change: 200, trendTone: "good", rows: 4 });
    expect(k.trend).toEqual([
      { month: "2026-01", value: null },
      { month: "2026-02", value: 100 },
      { month: "2026-03", value: 300 },
    ]);
    // Rekan dengan data Maret: Sari 300, Budi 500, Dewi 0 → Sari peringkat 2.
    expect(k.team).toEqual({ size: 3, average: 266.67, rank: 2 });
  });

  it("konversi penawaran memakai rumus & filter dasar (batal tidak dihitung)", () => {
    const k = computeKpi(KPI_BY_CODE.get("sales.conversion")!, rows, columns, {
      userId: "sari",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    // 2 pesanan dari 3 (pesanan + penawaran) → 66,67%.
    expect(k.value).toBe(66.67);
    expect(k.previous).toBe(100);
    expect(k.trendTone).toBe("bad");
  });

  it("tanpa data: nilai kosong, tanpa peringkat", () => {
    const k = computeKpi(KPI_BY_CODE.get("sales.revenue")!, rows, columns, {
      userId: "anon",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(k).toMatchObject({ value: null, change: null, trendTone: "neutral", team: { rank: null } });
  });
});
