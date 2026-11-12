import { describe, expect, it } from "vitest";
import { bankTransferFile } from "./payroll-advanced.js";
import { groupRunLines, lineAmountError, partnerBankAccountSchema } from "./payment-run.js";

describe("payment run", () => {
  it("mengelompokkan per pemasok & rekening, hanya baris yang diikutkan", () => {
    const g = groupRunLines([
      { id: "1", partnerId: "A", bankAccountId: "x", moveId: "m1", amount: "100", included: true },
      { id: "2", partnerId: "A", bankAccountId: "x", moveId: "m2", amount: "50.5", included: true },
      { id: "3", partnerId: "B", bankAccountId: null, moveId: "m3", amount: "10", included: true },
      { id: "4", partnerId: "A", bankAccountId: "x", moveId: "m4", amount: "999", included: false },
    ]);
    expect(g.map((x) => [x.partnerId, x.lines.length, x.total.toFixed(2)])).toEqual([
      ["A", 2, "150.50"],
      ["B", 1, "10.00"],
    ]);
  });
  it("jumlah tidak boleh melebihi sisa", () => {
    expect(lineAmountError("100", "100")).toBeNull();
    expect(lineAmountError("101", "100")).toContain("melebihi");
    expect(lineAmountError("0", "100")).toContain("lebih dari 0");
  });
  it("nomor rekening dinormalisasi", () => {
    expect(
      partnerBankAccountSchema.parse({
        bankName: "BCA",
        accountNumber: "123-456 7890",
        accountHolder: "PT X",
      }).accountNumber,
    ).toBe("1234567890");
    expect(
      partnerBankAccountSchema.safeParse({ bankName: "BCA", accountNumber: "12ab", accountHolder: "PT X" })
        .success,
    ).toBe(false);
  });
  it("file bank memakai awalan & label pemasok", () => {
    const f = bankTransferFile(
      "csv",
      { sourceAccount: "111", date: "2026-03-10", remark: "BAYAR" },
      [
        {
          employeeNumber: "BILL/2026/0001",
          name: "PT Pupuk",
          bankName: "BRI",
          bankAccount: "999",
          bankAccountName: "PT PUPUK",
          amount: "1500000",
        },
      ],
      { filePrefix: "pembayaran-pemasok", referenceLabel: "Referensi" },
    );
    expect(f.filename).toBe("pembayaran-pemasok-csv-2026-03.csv");
    expect(f.content.split("\r\n")[0]).toContain("Referensi");
  });
});
