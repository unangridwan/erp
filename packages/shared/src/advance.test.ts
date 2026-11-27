import { describe, expect, it } from "vitest";
import { advanceSchema, advanceSettlement } from "./advance.js";

describe("kasbon", () => {
  it("penyelesaian: klaim menutup kasbon, selisih dibayar atau sisa dikembalikan", () => {
    expect(advanceSettlement(1_000_000, 750_000)).toEqual({
      used: "750000.00",
      payOut: "0.00",
      remainder: "250000.00",
    });
    expect(advanceSettlement(1_000_000, 1_200_000)).toEqual({
      used: "1000000.00",
      payOut: "200000.00",
      remainder: "0.00",
    });
    expect(advanceSettlement(500_000, 0).remainder).toBe("500000.00");
  });

  it("validasi pengajuan", () => {
    const ok = { date: "2026-11-01", purpose: "Dinas ke Medan", amount: "1500000", settleBy: "2026-11-15" };
    expect(advanceSchema.safeParse(ok).success).toBe(true);
    expect(advanceSchema.safeParse({ ...ok, amount: "0" }).success).toBe(false);
    expect(advanceSchema.safeParse({ ...ok, settleBy: "2026-10-31" }).success).toBe(false);
  });
});
