import { describe, expect, it } from "vitest";
import { cashCategory, cashCycle, cashForecast, summarizeCash } from "./cash-insight.js";

describe("arus uang", () => {
  it("klasifikasi akun lawan kas", () => {
    expect(cashCategory("asset_receivable", "Piutang Usaha", 100)).toBe("customers");
    expect(cashCategory("asset_receivable", "Piutang Antar Perusahaan", 100)).toBe("intercompany_in");
    expect(cashCategory("liability_payable", "Utang Usaha", -100)).toBe("suppliers");
    expect(cashCategory("liability_current", "Utang Gaji", -100)).toBe("payroll");
    expect(cashCategory("liability_current", "Utang PPN", -100)).toBe("tax");
    expect(cashCategory("expense_other", "Beban Administrasi Bank", -5)).toBe("opex");
    expect(cashCategory("expense_other", "Beban Bunga Pinjaman", -5)).toBe("financing_out");
    expect(cashCategory("income_other", "Pendapatan Bunga", 7)).toBe("other_in");
    expect(cashCategory("asset_fixed", "Kendaraan", -50)).toBe("capex");
    expect(cashCategory("liability_non_current", "Pinjaman Bank", 500)).toBe("financing_in");
    expect(cashCategory("asset_cash", "Bank BCA", 10)).toBeNull();
  });

  it("ringkasan masuk/keluar seimbang dengan perubahan saldo kas", () => {
    const s = summarizeCash(
      [
        { accountType: "asset_receivable", accountName: "Piutang Usaha", month: "2026-01", amount: 1000 },
        { accountType: "liability_payable", accountName: "Utang Usaha", month: "2026-01", amount: -400 },
        { accountType: "liability_current", accountName: "Utang Gaji", month: "2026-02", amount: -300 },
        { accountType: "asset_cash", accountName: "Kas Kecil", month: "2026-02", amount: -50 },
      ],
      { opening: 500, closing: 800 },
    );
    expect(s).toMatchObject({ inflow: 1000, outflow: 700, net: 300, unexplained: 0 });
    expect(s.outflows.map((x) => x.key)).toEqual(["suppliers", "payroll"]);
    expect(s.byMonth).toEqual([
      { month: "2026-01", inflow: 1000, outflow: 400, net: 600 },
      { month: "2026-02", inflow: 0, outflow: 300, net: -300 },
    ]);
  });

  it("siklus konversi kas dengan rata-rata bergulir 3 bulan", () => {
    const c = cashCycle([
      { month: "2026-01", days: 31, revenue: 310, cogs: 155, ar: 100, ap: 50, inventory: 200 },
      { month: "2026-02", days: 28, revenue: 0, cogs: 0, ar: 100, ap: 50, inventory: 200 },
    ]);
    // Januari: DSO = 100/310×31 = 10; DIO = 200/155×31 = 40; DPO = 50/155×31 = 10; CCC = 40.
    expect(c[0]).toMatchObject({ dso: 10, dio: 40, dpo: 10, ccc: 40 });
    // Februari memakai Jan–Feb (59 hari): DSO = 100/310×59 = 19,0.
    expect(c[1]!.dso).toBe(19);
  });

  it("proyeksi kas mingguan: lewat jatuh tempo masuk minggu pertama, saldo terendah & minggu negatif", () => {
    const f = cashForecast({
      today: "2026-03-02",
      opening: 100,
      weeks: 3,
      items: [
        { source: "receivables", date: "2026-02-20", amount: 50 },
        { source: "payables", date: "2026-03-10", amount: 300 },
        { source: "sales", date: "2026-03-17", amount: 80 },
        { source: "payroll", date: "2026-04-30", amount: 999 },
      ],
    });
    expect(f.weeks.map((w) => [w.inflow, w.outflow, w.balance])).toEqual([
      [50, 0, 150],
      [0, 300, -150],
      [80, 0, -70],
    ]);
    expect(f.overdue.receivables).toBe(50);
    expect(f).toMatchObject({ lowest: { week: 2, balance: -150 }, firstNegative: 2, beyond: -999 });
  });
});
