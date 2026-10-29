import { describe, expect, it } from "vitest";
import { lineRealization, manpowerPlanLineSchema, planMonthly, planSummary } from "./manpower-plan.js";

const job = "00000000-0000-4000-8000-000000000001";

describe("man power planning", () => {
  it("headcount & biaya per bulan: posisi terisi, tambahan mulai Juli, pengganti tidak menambah", () => {
    const lines = [
      { jobId: job, kind: "existing" as const, quantity: 2, startMonth: 1, monthlyWage: 5_000_000 },
      {
        jobId: job,
        kind: "new" as const,
        quantity: 1,
        startMonth: 7,
        monthlyWage: 6_000_000,
        monthlyAllowance: 0,
      },
      { jobId: job, kind: "replacement" as const, quantity: 1, startMonth: 3, monthlyWage: 5_000_000 },
    ];
    const m = planMonthly(lines);
    expect(m[0]).toMatchObject({ headcount: 2, salary: 10_000_000 });
    expect(m[6]).toMatchObject({ headcount: 3, salary: 16_000_000 });
    // BPJS perusahaan 5 jt: Kes 4% = 200.000; TK = JHT 3,7% + JKK 0,24% + JKM 0,3% + JP 2% = 312.000.
    expect(m[0]!.bpjsKes).toBe(400_000);
    expect(m[0]!.bpjsTk).toBe(624_000);
    expect(m[0]!.cost).toBe(10_000_000 + 400_000 + 624_000);
  });

  it("bulan akhir, THR prorata, ringkasan", () => {
    const lines = [
      {
        jobId: job,
        kind: "existing" as const,
        quantity: 1,
        startMonth: 1,
        endMonth: 6,
        monthlyWage: 4_000_000,
      },
      { jobId: job, kind: "new" as const, quantity: 2, startMonth: 7, monthlyWage: 3_000_000 },
    ];
    const m = planMonthly(lines, undefined, 3);
    expect(m[6]!.headcount).toBe(2);
    expect(m[5]!.headcount).toBe(1);
    // THR Maret: 4 jt × 6/12 + 2 × 3 jt × 6/12 = 2 jt + 3 jt.
    expect(m[2]!.salary).toBe(4_000_000 + 5_000_000);
    const s = planSummary(lines, undefined, null);
    expect(s).toMatchObject({
      startHeadcount: 1,
      endHeadcount: 2,
      additions: 2,
      existing: 1,
      salary: 24_000_000 + 36_000_000,
    });
  });

  it("realisasi & validasi baris", () => {
    expect(lineRealization(2, false, 0)).toBe("not_started");
    expect(lineRealization(2, true, 0)).toBe("recruiting");
    expect(lineRealization(2, true, 1)).toBe("partial");
    expect(lineRealization(2, true, 2)).toBe("fulfilled");
    expect(manpowerPlanLineSchema.safeParse({ jobId: job, kind: "new", quantity: 0 }).success).toBe(false);
    expect(
      manpowerPlanLineSchema.safeParse({ jobId: job, kind: "new", quantity: 1, startMonth: 6, endMonth: 3 })
        .success,
    ).toBe(false);
    expect(manpowerPlanLineSchema.parse({ jobId: job, kind: "existing", quantity: 0 })).toMatchObject({
      startMonth: 1,
      monthlyWage: "0.00",
    });
  });
});
