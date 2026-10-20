import { describe, expect, it } from "vitest";
import { addDays, daysBetween, DEFAULT_CHECKLISTS, expiryStatus } from "./hr.js";
import { applicantStageSchema, hireSchema, hrDocumentSchema } from "./schemas.js";

describe("SDM: kedaluwarsa & checklist", () => {
  it("status kedaluwarsa dokumen/kontrak", () => {
    expect(expiryStatus(null, "2026-10-20")).toBeNull();
    expect(expiryStatus("2026-10-19", "2026-10-20")).toEqual({ days: -1, status: "expired" });
    expect(expiryStatus("2026-11-19", "2026-10-20")).toEqual({ days: 30, status: "soon" });
    expect(expiryStatus("2026-11-20", "2026-10-20")).toEqual({ days: 31, status: "ok" });
    expect(expiryStatus("2026-10-27", "2026-10-20", 7)?.status).toBe("soon");
  });

  it("tanggal relatif", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });

  it("checklist bawaan offboarding memuat pesangon & penonaktifan akun", () => {
    expect(DEFAULT_CHECKLISTS.offboarding.items.map((i) => i.action).filter(Boolean)).toEqual([
      "severance",
      "deactivate_user",
    ]);
  });

  it("validasi dokumen, tahap pelamar, penerimaan", () => {
    const file = { name: "ktp.pdf", type: "application/pdf", data: "JVBERi0=" };
    expect(hrDocumentSchema.safeParse({ kind: "ktp", name: "KTP", file }).success).toBe(false); // tanpa pemilik
    const big = { ...file, data: "A".repeat(7 * 1024 * 1024) };
    expect(
      hrDocumentSchema.safeParse({
        employeeId: "00000000-0000-4000-8000-000000000001",
        kind: "ktp",
        name: "KTP",
        file: big,
      }).success,
    ).toBe(false);
    expect(applicantStageSchema.safeParse({ stage: "refused" }).success).toBe(false);
    expect(
      hireSchema.safeParse({ joinDate: "2026-11-01", wage: "5000000", contractType: "pkwt" }).success,
    ).toBe(false);
  });
});
