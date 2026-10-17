import { describe, expect, it } from "vitest";
import { computeInvoice } from "./accounting.js";

const ppn12 = { id: "ppn", amount: 12, baseRatio: "0.9166666667" };
const ppnExact = { id: "ppn-ex", amount: 12, baseRatio: 11 / 12 };
const ppnLux = { id: "lux", amount: 12, baseRatio: 1 };
const pph23 = { id: "pph23", amount: -2, baseRatio: 1 };

describe("computeInvoice", () => {
  it("PPN 12% dengan DPP nilai lain 11/12 = efektif 11%", () => {
    const r = computeInvoice([{ quantity: 1, priceUnit: 1_000_000, taxIds: ["ppn"] }], [ppn12], 0);
    expect(r.taxes).toEqual([{ taxId: "ppn", base: "1000000", taxBase: "916667", amount: "110000" }]);
    expect(r.amountTotal).toBe("1110000");
  });

  it("DPP 11/12 tetap eksak pada nilai sangat besar", () => {
    // 12 triliun × 11/12 = 11 triliun persis; perkalian dengan 0.9166666667 akan meleset 4 rupiah.
    const r = computeInvoice([{ quantity: 1, priceUnit: "12000000000000", taxIds: ["ppn"] }], [ppn12], 0);
    expect(r.taxes[0]!.taxBase).toBe("11000000000000");
  });

  it("PPN atas barang mewah memakai DPP penuh", () => {
    const r = computeInvoice([{ quantity: 2, priceUnit: 500_000, taxIds: ["lux"] }], [ppnLux], 0);
    expect(r.amountTax).toBe("120000");
  });

  it("PPh 23 dipotong mengurangi total; diskon per baris", () => {
    const r = computeInvoice(
      [
        { quantity: 3, priceUnit: "150000", discount: 10, taxIds: ["ppn-ex", "pph23"] },
        { quantity: 1, priceUnit: "595000", taxIds: ["ppn-ex", "pph23"] },
      ],
      [ppnExact, pph23],
      0,
    );
    expect(r.lines).toEqual([{ subtotal: "405000" }, { subtotal: "595000" }]);
    expect(r.taxes.map((t) => t.amount)).toEqual(["110000", "-20000"]);
    expect(r).toMatchObject({ amountUntaxed: "1000000", amountTax: "90000", amountTotal: "1090000" });
  });

  it("dua desimal untuk mata uang asing dan baris tanpa pajak", () => {
    const r = computeInvoice(
      [
        { quantity: "1.5", priceUnit: "19.99" },
        { quantity: 1, priceUnit: 100, taxIds: ["lux"] },
      ],
      [ppnLux],
      2,
    );
    expect(r).toMatchObject({ amountUntaxed: "129.99", amountTax: "12.00", amountTotal: "141.99" });
  });

  it("menolak pajak yang tidak dikenal", () => {
    expect(() => computeInvoice([{ quantity: 1, priceUnit: 1, taxIds: ["x"] }], [], 0)).toThrow(
      /tidak dikenal/,
    );
  });
});
