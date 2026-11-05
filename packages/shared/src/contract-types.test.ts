import { describe, expect, it } from "vitest";
import {
  contractLimitDate,
  contractPeriodErrors,
  contractTypeSchema,
  DEFAULT_CONTRACT_TYPES,
} from "./contract-types.js";

const pkwt = { code: "pkwt", name: "PKWT", fixedTerm: true, maxMonths: 60 };

describe("jenis kontrak", () => {
  it("batas masa kontrak inklusif", () => {
    expect(contractLimitDate("2026-01-01", 12)).toBe("2026-12-31");
    expect(contractLimitDate("2026-01-31", 1)).toBe("2026-02-27");
    expect(contractLimitDate("2026-03-15", 60)).toBe("2031-03-14");
  });

  it("waktu tertentu wajib tanggal berakhir & tidak melebihi batas", () => {
    expect(contractPeriodErrors(pkwt, "2026-01-01", null)).toMatch(/wajib punya tanggal berakhir/);
    expect(contractPeriodErrors(pkwt, "2026-01-01", "2030-12-31")).toBeNull();
    expect(contractPeriodErrors(pkwt, "2026-01-01", "2031-01-01")).toMatch(/paling lama 60 bulan/);
    expect(
      contractPeriodErrors({ ...pkwt, fixedTerm: false, maxMonths: null }, "2026-01-01", null),
    ).toBeNull();
  });

  it("kode dinormalisasi & divalidasi; bawaan lengkap", () => {
    expect(contractTypeSchema.parse({ code: " Harian ", name: "Harian" }).code).toBe("harian");
    expect(contractTypeSchema.safeParse({ code: "a b", name: "x" }).success).toBe(false);
    expect(DEFAULT_CONTRACT_TYPES.map((t) => t.code)).toEqual(["pkwt", "pkwtt", "harian", "magang", "mitra"]);
  });
});
