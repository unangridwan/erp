import { describe, expect, it } from "vitest";
import { code128, code128Valid, code128Width } from "./barcode.js";
import { countSummary, lineVariance, parseCountSheetRow, stockCountScanSchema } from "./stock-count.js";

describe("stock opname", () => {
  it("selisih & nilai per baris", () => {
    expect(lineVariance({ systemQty: "10", countedQty: "8", unitCost: "1500" })).toEqual({
      qty: "-2.0000",
      value: "-3000.00",
      counted: true,
    });
    expect(lineVariance({ systemQty: "10", countedQty: null, unitCost: "1500" }).counted).toBe(false);
  });

  it("ringkasan lebih/kurang & nilai absolut", () => {
    const s = countSummary([
      { systemQty: "10", countedQty: "8", unitCost: "1500" },
      { systemQty: "5", countedQty: "6", unitCost: "1000" },
      { systemQty: "3", countedQty: "3", unitCost: "200" },
      { systemQty: "1", countedQty: null, unitCost: "200" },
    ]);
    expect(s).toMatchObject({
      lines: 4,
      counted: 3,
      uncounted: 1,
      withVariance: 2,
      gainValue: "1000.00",
      lossValue: "3000.00",
      netValue: "-2000.00",
      absValue: "4000.00",
    });
  });

  it("baris impor & skema scan", () => {
    expect(parseCountSheetRow({ SKU: "A-1", "Lot/Serial": "L1", Hitung: "2,5" })).toMatchObject({
      code: "A-1",
      lotName: "L1",
      countedQty: "2.5",
    });
    expect(parseCountSheetRow({ Baris: "x", Hitung: "" }).countedQty).toBeNull();
    expect(stockCountScanSchema.parse({ code: " 899123 " })).toEqual({ code: "899123", quantity: "1" });
  });
});

describe("barcode Code 128", () => {
  it("pola start B, checksum, stop", () => {
    const m = code128("PJJ");
    // start B = 211214, stop = 2331112; 5 simbol × 11 modul + stop 13 modul.
    expect(m.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    expect(m.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
    expect(code128Width(m)).toBe(5 * 11 + 13);
  });

  it("checksum sesuai contoh standar", () => {
    // "PJJ": start 104 + P(48)×1 + J(42)×2 + J(42)×3 = 362 → 362 mod 103 = 53 → pola nilai 53 = 213131
    const m = code128("PJJ");
    const checksum = m.slice(4 * 6, 5 * 6).join("");
    expect(checksum).toBe("213131");
    expect(code128Valid("Benih-01")).toBe(true);
    expect(code128Valid("é")).toBe(false);
    expect(() => code128("")).toThrow();
  });
});
