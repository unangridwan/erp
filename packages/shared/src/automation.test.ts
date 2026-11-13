import { describe, expect, it } from "vitest";
import {
  automationRuleSchema,
  dateTriggerTarget,
  matchConditions,
  publicRecord,
  renderTemplate,
  shouldFireOnUpdate,
} from "./automation.js";

const so = { name: "SO/2026/0001", state: "sale", amount_total: "75000000.00", custom: { musim: "hujan" } };

describe("aturan otomatis", () => {
  it("syarat: angka, teks, daftar, kosong, field kustom", () => {
    expect(matchConditions(so, [{ field: "amount_total", op: "gt", value: "50000000" }])).toBe(true);
    expect(matchConditions(so, [{ field: "state", op: "in", value: "sale, done" }])).toBe(true);
    expect(matchConditions(so, [{ field: "custom.musim", op: "eq", value: "Hujan" }])).toBe(true);
    expect(matchConditions(so, [{ field: "custom.lain", op: "empty", value: "" }])).toBe(true);
    expect(matchConditions({ active: true }, [{ field: "active", op: "eq", value: "ya" }])).toBe(true);
    expect(matchConditions(so, [{ field: "amount_total", op: "lte", value: "1000" }])).toBe(false);
  });

  it("hanya saat berubah menjadi terpenuhi", () => {
    const cond = [{ field: "state", op: "eq" as const, value: "sale" }];
    expect(shouldFireOnUpdate({ ...so, state: "draft" }, so, cond, true)).toBe(true);
    expect(shouldFireOnUpdate(so, { ...so, amount_total: "1" }, cond, true)).toBe(false);
    expect(shouldFireOnUpdate(so, so, cond, false)).toBe(true);
  });

  it("template & data publik tanpa kolom rahasia", () => {
    expect(
      renderTemplate(
        "Pesanan {{name}} ({{custom.musim}}) {{link}} {{nik_enc}}",
        { ...so, nik_enc: "x" },
        { link: "/s/1" },
      ),
    ).toBe("Pesanan SO/2026/0001 (hujan) /s/1 ");
    expect(publicRecord({ a: 1, nik_enc: "x", payslip_pin_hash: "y" })).toEqual({ a: 1 });
  });

  it("tanggal target & validasi aturan", () => {
    expect(dateTriggerTarget("2026-11-10", -3)).toBe("2026-11-13");
    expect(dateTriggerTarget("2026-11-10", 2)).toBe("2026-11-08");
    const base = {
      name: "x",
      model: "sale_order",
      actions: [{ type: "webhook", url: "https://example.com/h" }],
    };
    expect(automationRuleSchema.safeParse({ ...base, trigger: "date" }).success).toBe(false);
    expect(
      automationRuleSchema.safeParse({ ...base, trigger: "scheduled", frequency: "weekly" }).success,
    ).toBe(false);
    expect(automationRuleSchema.safeParse({ ...base, trigger: "created", actions: [] }).success).toBe(false);
    expect(
      automationRuleSchema.safeParse({
        ...base,
        trigger: "created",
        actions: [{ type: "notify", title: "x" }],
      }).success,
    ).toBe(false);
    expect(automationRuleSchema.safeParse({ ...base, trigger: "created" }).success).toBe(true);
  });
});
