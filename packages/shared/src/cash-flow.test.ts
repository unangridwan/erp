import { describe, expect, it } from "vitest";
import { cashFlowStatement, defaultCashFlowCategory } from "./cash-flow.js";

describe("cashFlowStatement", () => {
  it("metode tidak langsung: rekonsiliasi kas awal → akhir tanpa selisih", () => {
    // Transaksi periode: jual kredit 1.000 (piutang), terima 600; beli aset 500 tunai;
    // penyusutan 50; pinjaman bank 300; beban tunai 200.
    const r = cashFlowStatement({
      netProfit: "750", // 1000 − 200 − 50
      depreciation: "50",
      accounts: [
        {
          id: "kas",
          code: "1-1100",
          name: "Kas",
          accountType: "asset_cash",
          opening: "1000",
          closing: "1200",
        },
        {
          id: "ar",
          code: "1-1300",
          name: "Piutang",
          accountType: "asset_receivable",
          opening: "0",
          closing: "400",
        },
        {
          id: "fa",
          code: "1-2100",
          name: "Peralatan",
          accountType: "asset_fixed",
          opening: "0",
          closing: "500",
        },
        {
          id: "ad",
          code: "1-2190",
          name: "Akum. penyusutan",
          accountType: "asset_fixed",
          opening: "0",
          closing: "-50",
        },
        {
          id: "loan",
          code: "2-2100",
          name: "Utang bank",
          accountType: "liability_non_current",
          opening: "0",
          closing: "-300",
        },
        {
          id: "eq",
          code: "3-1000",
          name: "Modal",
          accountType: "equity",
          opening: "-1000",
          closing: "-1000",
        },
        {
          id: "rev",
          code: "4-1000",
          name: "Pendapatan",
          accountType: "income",
          opening: "0",
          closing: "-1000",
        },
      ],
    });
    expect(r.operating.total).toBe("400.00"); // 750 + 50 − 400
    expect(r.investing.total).toBe("-500.00"); // −500 + 50 − 50
    expect(r.financing.total).toBe("300.00");
    expect(r.netChange).toBe("200.00");
    expect(r.cashOpening).toBe("1000.00");
    expect(r.cashClosing).toBe("1200.00");
    expect(r.difference).toBe("0.00");
  });

  it("pemetaan per akun menimpa jenis akun", () => {
    const r = cashFlowStatement({
      netProfit: "0",
      depreciation: "0",
      accounts: [
        { id: "kas", code: "1-1100", name: "Kas", accountType: "asset_cash", opening: "0", closing: "-100" },
        {
          id: "div",
          code: "2-1900",
          name: "Utang dividen",
          accountType: "liability_current",
          cashFlowCategory: "financing",
          opening: "-100",
          closing: "0",
        },
      ],
    });
    expect(r.operating.lines).toHaveLength(1);
    expect(r.financing.lines[0]).toMatchObject({ code: "2-1900", amount: "-100.00" });
    expect(r.difference).toBe("0.00");
  });

  it("kelompok bawaan", () => {
    expect(defaultCashFlowCategory("asset_cash")).toBe("cash");
    expect(defaultCashFlowCategory("liability_payable")).toBe("operating");
    expect(defaultCashFlowCategory("asset_fixed")).toBe("investing");
    expect(defaultCashFlowCategory("equity")).toBe("financing");
    expect(defaultCashFlowCategory("income")).toBeNull();
  });
});
