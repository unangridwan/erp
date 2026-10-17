import { describe, expect, it } from "vitest";
import { mapStatementRows, parseBankAmount, parseBankDate } from "./bank-import.js";

describe("parseBankAmount", () => {
  it.each([
    ["1.234.567,89", ",", "1234567.89"],
    ["-1.000", ",", "-1000.00"],
    ["(250.000,50)", ",", "-250000.50"],
    ["500.000,00 DB", ",", "-500000.00"],
    ["1.500.000,00 CR", ",", "1500000.00"],
    ["Rp 75.000", ",", "75000.00"],
    ["1,234.50", ".", "1234.50"],
    ["-12.5", ".", "-12.50"],
    ["", ",", null],
    ["abc", ",", null],
  ])("%s → %s", (raw, decimal, expected) => {
    expect(parseBankAmount(raw, decimal as "," | ".")).toBe(expected);
  });
});

describe("parseBankDate", () => {
  it("berbagai format & menolak tanggal mustahil", () => {
    expect(parseBankDate("17/10/2026", "DD/MM/YYYY")).toBe("2026-10-17");
    expect(parseBankDate("2026-10-17", "YYYY-MM-DD")).toBe("2026-10-17");
    expect(parseBankDate("10/17/2026", "MM/DD/YYYY")).toBe("2026-10-17");
    expect(parseBankDate("17/10/26", "DD/MM/YY")).toBe("2026-10-17");
    expect(parseBankDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
  });
});

describe("mapStatementRows", () => {
  it("dua kolom debit/kredit, melewati baris nol, melaporkan error", () => {
    const rows = [
      {
        Tanggal: "01/10/2026",
        Keterangan: "TRSF DARI PT PELANGGAN INV/2026/0001",
        Debet: "",
        Kredit: "1.110.000,00",
      },
      { Tanggal: "02/10/2026", Keterangan: "BIAYA ADM", Debet: "15.000,00", Kredit: "" },
      { Tanggal: "02/10/2026", Keterangan: "SALDO", Debet: "", Kredit: "" },
      { Tanggal: "xx", Keterangan: "rusak", Debet: "", Kredit: "1" },
    ];
    const r = mapStatementRows(rows, {
      date: "Tanggal",
      description: "Keterangan",
      debit: "Debet",
      credit: "Kredit",
      dateFormat: "DD/MM/YYYY",
      decimal: ",",
    });
    expect(r.lines).toEqual([
      {
        date: "2026-10-01",
        paymentRef: "TRSF DARI PT PELANGGAN INV/2026/0001",
        partnerName: null,
        amount: "1110000.00",
      },
      { date: "2026-10-02", paymentRef: "BIAYA ADM", partnerName: null, amount: "-15000.00" },
    ]);
    expect(r.errors).toEqual([{ row: 5, message: 'Tanggal tidak valid: "xx"' }]);
  });
});
