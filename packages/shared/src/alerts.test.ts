import { describe, expect, it } from "vitest";
import {
  ALERT_BY_KEY,
  ALERT_DEFS,
  alertParams,
  alertRuleSchema,
  digestFor,
  reminderIgnored,
} from "./alerts.js";

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

  it("saklar pemeriksaan seketika: bawaan aktif, nilai apa pun jadi 0/1", () => {
    const def = ALERT_BY_KEY.get("approval_waiting")!;
    expect(def.instantModels).toEqual(["purchase_order"]);
    expect(alertParams(def, null)).toEqual({ waitDays: 2, instant: 1 });
    expect(alertParams(def, { instant: 0 })).toMatchObject({ instant: 0 });
    expect(alertParams(def, { instant: 7 })).toMatchObject({ instant: 1 });
  });

  it("eskalasi pengingat: hanya bila tetap di tahap yang sama, belum dieskalasi, dan cukup lama", () => {
    const r = { at: "2026-11-20T09:00:00.000Z", stage: "ordered" };
    expect(reminderIgnored(r, "ordered", null, "2026-11-23", 2)).toBe(3);
    expect(reminderIgnored(r, "ordered", null, "2026-11-21", 2)).toBeNull();
    // Sudah pindah tahap sejak diingatkan.
    expect(reminderIgnored(r, "delivered", null, "2026-11-23", 2)).toBeNull();
    // Pengingat ini sudah dieskalasi; eskalasi lama (sebelum pengingat) tidak dihitung.
    expect(reminderIgnored(r, "ordered", "2026-11-22T10:00:00.000Z", "2026-11-23", 2)).toBeNull();
    expect(reminderIgnored(r, "ordered", "2026-11-19T10:00:00.000Z", "2026-11-23", 2)).toBe(3);
    expect(reminderIgnored(null, "ordered", null, "2026-11-23", 2)).toBeNull();
  });
});
