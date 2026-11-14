import { describe, expect, it } from "vitest";
import { defectRate, evaluateResults, qualityPointSchema, sampleQuantity } from "./quality.js";

describe("quality", () => {
  it("jumlah sampel", () => {
    expect(sampleQuantity(100, "all")).toBe(100);
    expect(sampleQuantity(100, "percent", 10)).toBe(10);
    expect(sampleQuantity(7, "percent", 10)).toBe(1);
    expect(sampleQuantity(5, "quantity", 20)).toBe(5);
    expect(sampleQuantity(50, "quantity", 3)).toBe(3);
  });

  it("evaluasi lulus/gagal, ukur min-maks, wajib foto, belum lengkap", () => {
    const items = [
      { label: "Kemasan utuh", kind: "pass_fail" as const },
      { label: "Kadar air", kind: "measure" as const, min: 10, max: 14, unit: "%" },
      { label: "Foto label", kind: "pass_fail" as const, photo: true },
    ];
    expect(evaluateResults(items, [{ value: "pass" }, { value: "12,5" }]).complete).toBe(false);
    const noPhoto = evaluateResults(items, [{ value: "pass" }, { value: "12.5" }, { value: "pass" }]);
    expect(noPhoto).toMatchObject({ complete: true, passed: false });
    expect(noPhoto.results[2]!.passed).toBe(false);
    const ok = evaluateResults(
      items,
      [{ value: "pass" }, { value: "12.5" }, { value: "pass" }],
      new Set([2]),
    );
    expect(ok.passed).toBe(true);
    const wet = evaluateResults(items, [{ value: "pass" }, { value: "15" }, { value: "pass" }], new Set([2]));
    expect(wet.passed).toBe(false);
    expect(wet.results[1]!.passed).toBe(false);
  });

  it("tingkat cacat & validasi titik kontrol", () => {
    expect(defectRate(1, 4)).toBe(25);
    expect(defectRate(0, 0)).toBeNull();
    expect(qualityPointSchema.safeParse({ name: "x", trigger: "receipt", items: [] }).success).toBe(false);
    expect(
      qualityPointSchema.safeParse({
        name: "x",
        trigger: "receipt",
        items: [{ label: "a", kind: "measure", min: 5, max: 1 }],
      }).success,
    ).toBe(false);
  });
});
