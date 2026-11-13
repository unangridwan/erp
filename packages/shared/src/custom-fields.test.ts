import { describe, expect, it } from "vitest";
import {
  coerceCustomValue,
  coerceCustomValues,
  customFieldSchema,
  formatCustomValue,
  type CustomFieldDef,
} from "./custom-fields.js";

const defs: CustomFieldDef[] = [
  {
    key: "region",
    label: "Wilayah",
    fieldType: "select",
    options: [
      { value: "jbr", label: "Jawa Barat" },
      { value: "jtm", label: "Jawa Timur" },
    ],
    required: true,
  },
  { key: "luas", label: "Luas lahan", fieldType: "number", defaultValue: 1 },
  { key: "organik", label: "Organik", fieldType: "boolean" },
  {
    key: "sertifikat",
    label: "Sertifikat",
    fieldType: "multiselect",
    options: [
      { value: "gap", label: "GAP" },
      { value: "halal", label: "Halal" },
    ],
  },
  { key: "pic", label: "PIC", fieldType: "ref", refModel: "employee" },
  { key: "lama", label: "Lama", fieldType: "text", active: false },
];

describe("field kustom", () => {
  it("normalisasi per tipe", () => {
    expect(coerceCustomValue(defs[1]!, "12,5")).toEqual({ value: 12.5 });
    expect(coerceCustomValue(defs[2]!, "ya")).toEqual({ value: true });
    expect(coerceCustomValue(defs[0]!, "jawa timur")).toEqual({ value: "jtm" });
    expect(coerceCustomValue(defs[3]!, "GAP; halal")).toEqual({ value: ["gap", "halal"] });
    expect(coerceCustomValue({ key: "d", label: "D", fieldType: "date" }, "2026-02-30")).toHaveProperty(
      "error",
    );
    expect(coerceCustomValue({ key: "e", label: "E", fieldType: "email" }, "X@Y.CO")).toEqual({
      value: "x@y.co",
    });
    expect(coerceCustomValue({ key: "m", label: "M", fieldType: "money" }, 10.005)).toEqual({ value: 10.01 });
    expect(coerceCustomValue(defs[0]!, "bali")).toHaveProperty("error");
  });

  it("gabung dengan nilai lama, bawaan, wajib, rujukan, field nonaktif dibiarkan", () => {
    const created = coerceCustomValues(defs, { region: "jbr", pic: "4c1a3b4e-2b4c-4d5e-8f90-1234567890ab" });
    expect(created.errors).toEqual({});
    expect(created.values).toEqual({ region: "jbr", luas: 1, pic: "4c1a3b4e-2b4c-4d5e-8f90-1234567890ab" });
    expect(created.refs).toEqual([
      { key: "pic", model: "employee", id: "4c1a3b4e-2b4c-4d5e-8f90-1234567890ab" },
    ]);
    const upd = coerceCustomValues(defs, { luas: "", organik: false }, { region: "jbr", luas: 3, lama: "x" });
    expect(upd.values).toEqual({ region: "jbr", organik: false, lama: "x" });
    expect(coerceCustomValues(defs, {}).errors).toEqual({ region: "Wajib diisi" });
    expect(coerceCustomValues(defs, { lama: "y", region: "jbr" }).errors).toHaveProperty("lama");
  });

  it("definisi: pilihan wajib, rujukan, nilai bawaan divalidasi", () => {
    const base = { model: "partner", key: "region", label: "Wilayah" };
    expect(customFieldSchema.safeParse({ ...base, fieldType: "select" }).success).toBe(false);
    expect(customFieldSchema.safeParse({ ...base, fieldType: "ref" }).success).toBe(false);
    expect(customFieldSchema.safeParse({ ...base, key: "1x", fieldType: "text" }).success).toBe(false);
    expect(customFieldSchema.safeParse({ ...base, fieldType: "number", defaultValue: "abc" }).success).toBe(
      false,
    );
    expect(customFieldSchema.safeParse({ ...base, fieldType: "number", defaultValue: 5 }).success).toBe(true);
  });

  it("format tampilan", () => {
    expect(formatCustomValue(defs[3]!, ["gap", "halal"])).toBe("GAP; Halal");
    expect(formatCustomValue(defs[2]!, false, { lang: "en" })).toBe("No");
    expect(formatCustomValue(defs[4]!, "id1", { refNames: { id1: "Budi" } })).toBe("Budi");
  });
});
