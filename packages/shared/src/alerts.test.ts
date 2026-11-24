import { describe, expect, it } from "vitest";
import { ALERT_BY_KEY, ALERT_DEFS, alertParams, alertRuleSchema, digestFor } from "./alerts.js";

describe("peringatan dini", () => {
  it("katalog: kunci unik, penerima bawaan termasuk yang tersedia", () => {
    expect(new Set(ALERT_DEFS.map((d) => d.key)).size).toBe(ALERT_DEFS.length);
    for (const d of ALERT_DEFS) for (const r of d.defaultRecipients) expect(d.recipients).toContain(r);
  });

  it("parameter tersimpan dipakai bila dalam batas, selain itu bawaan", () => {
    const def = ALERT_BY_KEY.get("ar_overdue")!;
    expect(alertParams(def, { overdueDays: 45 })).toEqual({ overdueDays: 45 });
    expect(alertParams(def, { overdueDays: -1 })).toEqual({ overdueDays: 30 });
    expect(alertParams(def, null)).toEqual({ overdueDays: 30 });
    expect(alertRuleSchema.safeParse({ active: true, recipients: ["boss"] }).success).toBe(false);
  });

  it("ringkasan per penerima: jumlah & contoh teratas", () => {
    const d = digestFor(
      [
        { userId: "a", item: "1" },
        { userId: "a", item: "2" },
        { userId: "a", item: "3" },
        { userId: "b", item: "x" },
      ],
      2,
    );
    expect(d.get("a")).toEqual({ count: 3, items: ["1", "2"] });
    expect(d.get("b")).toEqual({ count: 1, items: ["x"] });
  });
});
