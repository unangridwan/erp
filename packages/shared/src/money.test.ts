import { describe, expect, it } from "vitest";
import { convertAmount } from "./money.js";

describe("convertAmount", () => {
  it("USD → IDR dibulatkan ke rupiah", () => {
    expect(convertAmount("100.50", "16234.5678", 1, 0)).toBe("1631574");
  });
  it("IDR → USD dua desimal", () => {
    expect(convertAmount(1_000_000, 1, "16250", 2)).toBe("61.54");
  });
  it("silang USD → SGD lewat IDR", () => {
    expect(convertAmount(10, "16250", "12500", 2)).toBe("13.00");
  });
});
