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
    expect(isWritable("complimentary")).toBe(true);
    expect(isWritable("expired")).toBe(false);
  });

  it("gratis dari admin platform: berlaku tanpa periode, kedaluwarsa kembali ke aturan biasa", () => {
    const trialOver = { ...base, status: "trialing" as const, trialEndsAt: days(-30) };
    expect(effectiveStatus({ ...trialOver, complimentary: true }, now, 7)).toBe("complimentary");
    expect(effectiveStatus({ ...trialOver, complimentary: true, complimentaryUntil: days(10) }, now, 7)).toBe(
      "complimentary",
    );
    expect(effectiveStatus({ ...trialOver, complimentary: true, complimentaryUntil: days(-1) }, now, 7)).toBe(
      "expired",
    );
    expect(effectiveStatus({ ...base, status: "suspended", complimentary: true }, now, 7)).toBe("suspended");
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

  it("perpanjangan berulang kembali ke tanggal jatuh tempo asli setelah bulan pendek", () => {
    // 31 Jan → 28 Feb → 31 Mar → 30 Apr → 31 Mei (bukan terus tanggal 28).
    let start = new Date("2026-01-31T00:00:00Z");
    let end = addPeriod(start, "monthly");
    const ends = [end.toISOString().slice(0, 10)];
    for (let i = 0; i < 3; i++) {
      const anchor = Math.max(start.getUTCDate(), end.getUTCDate());
      [start, end] = [end, addPeriod(end, "monthly", anchor)];
      ends.push(end.toISOString().slice(0, 10));
    }
    expect(ends).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("PPN 11% efektif", () => {
    expect(billingAmounts("499000")).toEqual({ amount: "499000.00", tax: "54890.00", total: "553890.00" });
  });
});
