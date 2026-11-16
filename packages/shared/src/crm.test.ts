import { describe, expect, it } from "vitest";
import {
  contactRolesSchema,
  duplicateReasons,
  funnelSteps,
  leadProductSubtotal,
  leadProductsSchema,
  leadProductsTotal,
  normalizeCompanyName,
  normalizePhone,
  salesCycleDays,
  stageDurations,
} from "./crm.js";

describe("crm", () => {
  it("subtotal & total produk peluang", () => {
    expect(leadProductSubtotal({ quantity: "3", priceUnit: "1500000", discount: "10" })).toBe("4050000.00");
    expect(leadProductSubtotal({ quantity: "0.5", priceUnit: "333.335" })).toBe("166.67");
    expect(
      leadProductsTotal([
        { quantity: "3", priceUnit: "1500000", discount: "10" },
        { quantity: "2", priceUnit: "250000" },
      ]),
    ).toBe("4550000.00");
    expect(leadProductsTotal([])).toBe("0.00");
  });

  it("normalisasi telepon & nama perusahaan", () => {
    expect(normalizePhone("+62 812-3456-789")).toBe("8123456789");
    expect(normalizePhone("0812 3456 789")).toBe("8123456789");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizeCompanyName("PT. Maju Jaya, Tbk")).toBe("maju jaya");
    expect(normalizeCompanyName("CV")).toBeNull();
  });

  it("alasan duplikat", () => {
    expect(
      duplicateReasons(
        { email: " Budi@Contoh.co.id ", phone: "0812-3456-789", name: "PT Maju Jaya" },
        { email: "budi@contoh.co.id", phone: "+628123456789", name: "Maju Jaya, CV" },
      ),
    ).toEqual(["email", "phone", "name"]);
    expect(duplicateReasons({ email: "a@b.c" }, { email: "x@b.c", phone: null })).toEqual([]);
    expect(duplicateReasons({ email: null, phone: "" }, { email: null, phone: "" })).toEqual([]);
  });

  it("durasi per tahap & siklus penjualan", () => {
    const history = [
      { toStageId: "a", state: "open" as const, changedAt: "2026-10-01T00:00:00Z" },
      { toStageId: "b", state: "open" as const, changedAt: "2026-10-04T00:00:00Z" },
      { toStageId: "a", state: "open" as const, changedAt: "2026-10-06T00:00:00Z" },
      { toStageId: "c", state: "won" as const, changedAt: "2026-10-11T00:00:00Z" },
    ];
    const d = stageDurations(history, "2026-12-01T00:00:00Z");
    expect(d.get("a")).toBe(8);
    expect(d.get("b")).toBe(2);
    expect(d.has("c")).toBe(false);
    expect(salesCycleDays(history)).toBe(10);
    expect(salesCycleDays(history.slice(0, 2))).toBeNull();
    // Tahap terakhir yang masih terbuka dihitung sampai sekarang.
    expect(stageDurations(history.slice(0, 2), "2026-10-10T00:00:00Z").get("b")).toBe(6);
  });

  it("corong konversi", () => {
    const steps = funnelSteps({ leads: 40, contacted: 30, qualified: 20, opportunities: 10, won: 4 });
    expect(steps.map((s) => s.rate)).toEqual([null, 75, 66.7, 50, 40]);
    expect(steps[4]!.overall).toBe(10);
    expect(
      funnelSteps({ leads: 0, contacted: 0, qualified: 0, opportunities: 0, won: 0 })[1]!.rate,
    ).toBeNull();
  });

  it("skema produk & peran kontak", () => {
    const id = "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10";
    expect(leadProductsSchema.parse({ lines: [{ productId: id }] }).lines[0]).toMatchObject({
      quantity: "1",
      discount: "0",
    });
    expect(leadProductsSchema.safeParse({ lines: [{ productId: id, quantity: "0" }] }).success).toBe(false);
    expect(leadProductsSchema.safeParse({ lines: [{ productId: id, discount: "101" }] }).success).toBe(false);
    expect(
      contactRolesSchema.safeParse({ roles: [{ partnerId: id }, { partnerId: id, role: "buyer" }] }).success,
    ).toBe(false);
  });
});
