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

describe("SDM: kinerja & organisasi", () => {
  it("skor tertimbang & predikat", async () => {
    const { weightedScore, ratingFor, turnoverRate, orgTree } = await import("./hr.js");
    expect(
      weightedScore([
        { weight: 60, score: 4 },
        { weight: 40, score: 5 },
      ]),
    ).toBe(4.4);
    expect(
      weightedScore([
        { weight: 1, score: 3 },
        { weight: 1, score: null },
      ]),
    ).toBeNull();
    expect(weightedScore([])).toBeNull();
    expect([4.5, 4.49, 3.5, 2.5, 1.5, 1.49].map(ratingFor)).toEqual(["A", "B", "B", "C", "D", "E"]);
    expect(turnoverRate(3, 20, 40)).toBe(10);
    expect(turnoverRate(1, 0, 0)).toBe(0);
    const tree = orgTree([
      { id: "ceo", managerId: null },
      { id: "cfo", managerId: "ceo" },
      { id: "acc", managerId: "cfo" },
      { id: "x", managerId: "y" },
      { id: "y", managerId: "x" },
      { id: "orphan", managerId: "gone" },
    ]);
    expect(tree.map((n) => n.id).sort()).toEqual(["ceo", "orphan", "x", "y"]);
    expect(tree.find((n) => n.id === "ceo")!.reports[0]!.reports[0]!.id).toBe("acc");
  });
});
