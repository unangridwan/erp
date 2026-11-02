import { describe, expect, it } from "vitest";
import { hiringProgress, hiringRequestSchema, lineRemaining } from "./hiring.js";

describe("alur penambahan karyawan", () => {
  it("sisa kuota baris MPP tidak menghitung FPK ditolak/dibatalkan", () => {
    const reqs = [
      { id: "a", quantity: 2, state: "approved" as const },
      { id: "b", quantity: 1, state: "refused" as const },
      { id: "c", quantity: 1, state: "draft" as const },
    ];
    expect(lineRemaining(5, reqs)).toBe(2);
    expect(lineRemaining(5, reqs, "c")).toBe(3);
    expect(lineRemaining(2, reqs)).toBe(0);
  });

  it("validasi FPK: pengganti wajib karyawan, gaji maks ≥ min", () => {
    const base = {
      departmentId: "00000000-0000-4000-8000-000000000001",
      jobId: "00000000-0000-4000-8000-000000000002",
      quantity: 1,
      reason: "Ekspansi",
    };
    expect(hiringRequestSchema.safeParse(base).success).toBe(true);
    expect(hiringRequestSchema.safeParse({ ...base, kind: "replacement" }).success).toBe(false);
    expect(hiringRequestSchema.safeParse({ ...base, wageMin: 5, wageMax: 4 }).success).toBe(false);
  });

  it("status tahap", () => {
    const p = hiringProgress({
      planned: true,
      planApproved: true,
      requestState: "approved",
      quantity: 2,
      hasOpening: true,
      offersAccepted: 2,
      contracts: 2,
      active: 1,
      onboardingDone: 0,
    });
    expect(p).toMatchObject({
      plan: "done",
      request: "done",
      approval: "done",
      opening: "done",
      applicants: "done",
      offer: "done",
      contract: "done",
      active: "current",
      onboarding: "pending",
    });
    expect(
      hiringProgress({
        planned: false,
        planApproved: false,
        requestState: "refused",
        quantity: 1,
        hasOpening: false,
        offersAccepted: 0,
        contracts: 0,
        active: 0,
        onboardingDone: 0,
      }),
    ).toMatchObject({ plan: "skipped", approval: "blocked", opening: "pending" });
  });
});
