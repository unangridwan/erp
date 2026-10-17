import { describe, expect, it } from "vitest";
import { depreciationSchedule } from "./depreciation.js";

describe("depreciationSchedule", () => {
  it("garis lurus: pembulatan diserap bulan terakhir, total = harga − nilai sisa", () => {
    const s = depreciationSchedule({
      cost: 10_000_000,
      salvageValue: 1_000_000,
      usefulLifeMonths: 7,
      method: "straight_line",
      firstDepreciationDate: "2026-01-15",
      decimals: 0,
    });
    expect(s.map((l) => l.amount)).toEqual([
      "1285714",
      "1285714",
      "1285714",
      "1285714",
      "1285714",
      "1285714",
      "1285716",
    ]);
    expect(s.at(-1)).toMatchObject({ date: "2026-07-31", accumulated: "9000000", bookValue: "1000000" });
    expect(s[1]!.date).toBe("2026-02-28");
  });

  it("saldo menurun kelompok 1 (4 tahun, tarif 50%)", () => {
    const s = depreciationSchedule({
      cost: 48_000_000,
      usefulLifeMonths: 48,
      method: "declining_balance",
      firstDepreciationDate: "2026-01-01",
      decimals: 0,
    });
    const yearly = [0, 1, 2, 3].map((y) =>
      s.slice(y * 12, y * 12 + 12).reduce((t, l) => t + Number(l.amount), 0),
    );
    // 50% × 48 jt = 24 jt; 50% × 24 jt = 12 jt; 50% × 12 jt = 6 jt; tahun terakhir sisa 6 jt.
    expect(yearly).toEqual([24_000_000, 12_000_000, 6_000_000, 6_000_000]);
    expect(s.at(-1)).toMatchObject({ bookValue: "0", date: "2029-12-31" });
  });

  it("saldo menurun dengan masa manfaat bukan kelipatan 12 dan nilai sisa", () => {
    const s = depreciationSchedule({
      cost: "1000.00",
      salvageValue: "100.00",
      usefulLifeMonths: 18,
      method: "declining_balance",
      firstDepreciationDate: "2026-07-01",
    });
    expect(s).toHaveLength(18);
    expect(s.at(-1)!.bookValue).toBe("100.00");
    expect(s.every((l) => Number(l.amount) >= 0)).toBe(true);
  });

  it("menolak input tidak valid", () => {
    expect(() =>
      depreciationSchedule({
        cost: 100,
        salvageValue: 100,
        usefulLifeMonths: 12,
        method: "straight_line",
        firstDepreciationDate: "2026-01-01",
      }),
    ).toThrow(/Nilai sisa/);
  });
});
