import { describe, expect, it } from "vitest";
import { agingBucket, isRecordModel, RECORD_MODEL_KEYS, RECORD_MODELS, recordHref } from "./record-links.js";
import { ALL_PERMISSION_CODES } from "./rbac.js";

describe("record links", () => {
  it("halaman detail memakai id, model tanpa detail ke halaman daftar", () => {
    expect(recordHref("account_move", "abc")).toBe("/accounting/moves/abc");
    expect(recordHref("sale_order", "x")).toBe("/sales/orders/x");
    expect(recordHref("payment", "x")).toBe("/accounting/payments");
    expect(recordHref("sale_order", null)).toBeNull();
    expect(recordHref("unknown", "x")).toBeNull();
  });

  it("validasi model", () => {
    expect(isRecordModel("payslip")).toBe(true);
    expect(isRecordModel("toString")).toBe(false);
    expect(isRecordModel(1)).toBe(false);
  });

  it("setiap model punya hak baca yang terdaftar dan path diawali /", () => {
    for (const key of RECORD_MODEL_KEYS) {
      const m = RECORD_MODELS[key];
      expect(ALL_PERMISSION_CODES.has(m.permission), `${key}: ${m.permission}`).toBe(true);
      expect(m.apiPath.startsWith("/")).toBe(true);
      expect(m.web.startsWith("/")).toBe(true);
    }
  });

  it("rentang umur", () => {
    expect(agingBucket(-3)).toBe("current");
    expect(agingBucket(0)).toBe("current");
    expect(agingBucket(1)).toBe("d1_30");
    expect(agingBucket(45)).toBe("d31_60");
    expect(agingBucket(90)).toBe("d61_90");
    expect(agingBucket(91)).toBe("over90");
  });
});
