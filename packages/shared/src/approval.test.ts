import { describe, expect, it } from "vitest";
import {
  buildApprovalSteps,
  DEFAULT_APPROVAL_CATEGORIES,
  missingApprovalFields,
  requestOutcome,
} from "./approval.js";
import { approvalCategorySchema } from "./schemas.js";

const doa = [
  { userId: "mgr-unit", label: "Manajer", required: true, minAmount: null },
  { userId: "direktur", label: "Direktur", required: true, minAmount: "10000000" },
  { userId: "holding", label: "Direksi Holding", required: true, minAmount: 100_000_000 },
];

describe("buildApprovalSteps", () => {
  it("matriks otorisasi: jenjang mengikuti nominal", () => {
    const users = (amount: number) =>
      buildApprovalSteps({ managerFirst: false, approvers: doa, amount }).map((s) => s.approverUserId);
    expect(users(5_000_000)).toEqual(["mgr-unit"]);
    expect(users(10_000_000)).toEqual(["mgr-unit", "direktur"]);
    expect(users(250_000_000)).toEqual(["mgr-unit", "direktur", "holding"]);
  });

  it("atasan langsung jadi tahap pertama; duplikat & pemohon sendiri dibuang", () => {
    const steps = buildApprovalSteps({
      managerFirst: true,
      managerUserId: "mgr-unit",
      requesterUserId: "direktur",
      approvers: doa,
      amount: 20_000_000,
    });
    expect(steps).toEqual([
      { sequence: 1, approverUserId: "mgr-unit", label: "Atasan langsung", required: true },
    ]);
  });

  it("tanpa penyetuju → HR", () => {
    expect(buildApprovalSteps({ managerFirst: true, approvers: [] })).toEqual([
      { sequence: 1, approverUserId: null, label: "HR", required: true },
    ]);
  });
});

describe("requestOutcome", () => {
  const steps = (...states: ("pending" | "approved" | "refused" | "skipped")[]) =>
    states.map((state, i) => ({ sequence: i + 1, required: true, state }));

  it("berurutan: hanya tahap pending terendah yang terbuka", () => {
    expect(requestOutcome(steps("approved", "pending", "pending"), "sequential")).toEqual({
      state: "submitted",
      open: [2],
    });
    expect(requestOutcome(steps("approved", "approved"), "sequential").state).toBe("approved");
  });

  it("paralel: semua pending terbuka; penolakan mana pun menolak", () => {
    expect(requestOutcome(steps("pending", "approved", "pending"), "parallel").open).toEqual([1, 3]);
    expect(requestOutcome(steps("approved", "refused", "pending"), "parallel")).toEqual({
      state: "refused",
      open: [],
    });
  });

  it("minimum persetujuan dari tahap opsional; tahap wajib tetap harus setuju", () => {
    const optional = [
      { sequence: 1, required: false, state: "approved" as const },
      { sequence: 2, required: false, state: "approved" as const },
      { sequence: 3, required: false, state: "pending" as const },
    ];
    expect(requestOutcome(optional, "parallel", 2).state).toBe("approved");
    expect(requestOutcome(optional, "parallel", 3).state).toBe("submitted");
    const withRequired = [
      ...optional.slice(0, 2),
      { sequence: 3, required: true, state: "pending" as const },
    ];
    expect(requestOutcome(withRequired, "parallel", 2)).toEqual({ state: "submitted", open: [3] });
  });
});

describe("missingApprovalFields", () => {
  it("field wajib yang kosong, periode = mulai & selesai, lampiran", () => {
    const fields = {
      amount: "required",
      period: "required",
      attachment: "required",
      location: "optional",
    } as const;
    expect(missingApprovalFields(fields, { amount: "", dateFrom: "2026-01-01" })).toEqual([
      "amount",
      "period",
      "attachment",
    ]);
    expect(
      missingApprovalFields(fields, {
        amount: "0",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-02",
        hasAttachment: true,
      }),
    ).toEqual([]);
  });
});

describe("kategori bawaan", () => {
  it("lolos skema kategori", () => {
    for (const c of DEFAULT_APPROVAL_CATEGORIES) expect(() => approvalCategorySchema.parse(c)).not.toThrow();
    expect(DEFAULT_APPROVAL_CATEGORIES.map((c) => c.code)).toContain("FPK");
  });
});
