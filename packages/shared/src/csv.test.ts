import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";

describe("csv", () => {
  it("mengurai field berkutip, koma, baris baru, dan BOM", () => {
    const text = '\uFEFFname,city\r\n"CV ""Maju"", Jaya",Bandung\n"Baris\ndua",\n\n';
    expect(parseCsv(text)).toEqual([
      { name: 'CV "Maju", Jaya', city: "Bandung" },
      { name: "Baris\ndua", city: "" },
    ]);
  });

  it("round-trip toCsv → parseCsv", () => {
    const rows = [
      { a: "x,y", b: 'q"', c: null },
      { a: 12.5, b: true, c: "baris\nbaru" },
    ];
    expect(parseCsv(toCsv(["a", "b", "c"], rows))).toEqual([
      { a: "x,y", b: 'q"', c: "" },
      { a: "12.5", b: "true", c: "baris\nbaru" },
    ]);
  });

  it("menetralkan formula spreadsheet tetapi tidak angka negatif", () => {
    expect(toCsv(["a"], [{ a: "=HYPERLINK(1)" }, { a: "-5" }, { a: "@x" }])).toBe(
      "a\r\n'=HYPERLINK(1)\r\n-5\r\n'@x\r\n",
    );
  });

  it("menolak kutip yang tidak ditutup", () => {
    expect(() => parseCsv('a\n"tidak ditutup')).toThrow(/kutip/);
  });
});
