import { describe, expect, it } from "vitest";
import { addPeriod, billingAmounts, effectiveStatus, isWritable } from "./billing.js";

const now = new Date("2026-10-19T00:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
const base = { trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };

describe("status langganan", () => {
  it("uji coba, aktif, toleransi, berakhir", () => {
    expect(effectiveStatus({ ...base, status: "trialing", trialEndsAt: days(3) }, now, 7)).toBe("trialing");
    expect(effectiveStatus({ ...base, status: "trialing", trialEndsAt: days(-1) }, now, 7)).toBe("expired");
    expect(effectiveStatus({ ...base, status: "active", currentPeriodEnd: days(10) }, now, 7)).toBe("active");
    expect(effectiveStatus({ ...base, status: "active", currentPeriodEnd: days(-3) }, now, 7)).toBe(
      "past_due",
    );
    expect(effectiveStatus({ ...base, status: "active", currentPeriodEnd: days(-8) }, now, 7)).toBe(
      "expired",
    );
    expect(
      effectiveStatus(
        { ...base, status: "active", currentPeriodEnd: days(5), cancelAtPeriodEnd: true },
        now,
        7,
      ),
    ).toBe("cancelling");
    expect(
      effectiveStatus(
        { ...base, status: "active", currentPeriodEnd: days(-1), cancelAtPeriodEnd: true },
        now,
        7,
      ),
    ).toBe("expired");
    expect(effectiveStatus({ ...base, status: "suspended", currentPeriodEnd: days(30) }, now, 7)).toBe(
      "suspended",
    );
    expect(isWritable("past_due")).toBe(true);
    expect(isWritable("expired")).toBe(false);
  });

  it("periode bulanan/tahunan dan akhir bulan", () => {
    expect(addPeriod(new Date("2026-01-31T10:00:00Z"), "monthly").toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addPeriod(new Date("2026-10-19T00:00:00Z"), "monthly").toISOString()).toBe(
      "2026-11-19T00:00:00.000Z",
    );
    expect(addPeriod(new Date("2028-02-29T00:00:00Z"), "yearly").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("PPN 11% efektif", () => {
    expect(billingAmounts("499000")).toEqual({ amount: "499000.00", tax: "54890.00", total: "553890.00" });
  });
});
