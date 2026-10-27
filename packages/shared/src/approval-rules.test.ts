import { describe, expect, it } from "vitest";
import {
  applicableSteps,
  approvalLimitSchema,
  approvalRulesSchema,
  limitFor,
  withinLimit,
} from "./approval-rules.js";
import { buildApprovalSteps } from "./approval.js";

describe("applicableSteps", () => {
  const rules = [
    { sequence: 30, approverType: "role" as const, roleId: "dir", minValue: "50000000" },
    { sequence: 10, approverType: "manager" as const, minValue: null },
    { sequence: 20, approverType: "department_head" as const, minValue: 10_000_000 },
  ];
  it("tahap mengikuti nilai dokumen, urut sequence", () => {
    const types = (v: number | null) => applicableSteps(rules, v).map((r) => r.approverType);
    expect(types(null)).toEqual(["manager"]);
    expect(types(5_000_000)).toEqual(["manager"]);
    expect(types(10_000_000)).toEqual(["manager", "department_head"]);
    expect(types(75_000_000)).toEqual(["manager", "department_head", "role"]);
  });
});

describe("limitFor", () => {
  const limits = [
    { maxAmount: "1000000" }, // default perusahaan
    { roleId: "buyer", maxAmount: "10000000" },
    { roleId: "manager", maxAmount: "50000000" },
    { roleId: "director", maxAmount: null },
    { userId: "budi", maxAmount: "2000000" },
    { roleId: "buyer", categoryId: "cat-it", maxAmount: "3000000" },
  ];
  it("pengguna > peran terbesar > default", () => {
    expect(limitFor(limits, { userId: "budi", roleIds: ["director"] })).toBe(2_000_000);
    expect(limitFor(limits, { userId: "x", roleIds: ["buyer", "manager"] })).toBe(50_000_000);
    expect(limitFor(limits, { userId: "x", roleIds: ["buyer", "director"] })).toBeNull();
    expect(limitFor(limits, { userId: "x", roleIds: ["staff"] })).toBe(1_000_000);
    expect(limitFor([], { userId: "x", roleIds: [] })).toBeUndefined();
  });
  it("batas khusus kategori menimpa batas umum di tingkat yang sama", () => {
    expect(limitFor(limits, { userId: "x", roleIds: ["buyer"], categoryId: "cat-it" })).toBe(3_000_000);
    expect(limitFor(limits, { userId: "x", roleIds: ["buyer"], categoryId: "lain" })).toBe(10_000_000);
  });
  it("withinLimit", () => {
    expect(withinLimit(undefined, 1e12)).toBe(true);
    expect(withinLimit(null, 1e12)).toBe(true);
    expect(withinLimit(100, "100")).toBe(true);
    expect(withinLimit(100, "100.01")).toBe(false);
  });
});

describe("skema", () => {
  it("tahap user/peran wajib memilih; id lain dibuang", () => {
    expect(approvalRulesSchema.safeParse({ steps: [{ approverType: "user" }] }).success).toBe(false);
    const ok = approvalRulesSchema.parse({
      steps: [{ approverType: "manager", userId: "8d3f1b9e-1d2c-4c3a-9a51-0c9d8d0f6a11", minValue: "" }],
    });
    expect(ok.steps[0]).toMatchObject({ approverType: "manager", userId: null, minValue: null });
  });
  it("batas: peran atau pengguna, bukan keduanya", () => {
    const id = "8d3f1b9e-1d2c-4c3a-9a51-0c9d8d0f6a11";
    expect(approvalLimitSchema.safeParse({ roleId: id, userId: id, maxAmount: 1 }).success).toBe(false);
    expect(approvalLimitSchema.parse({ roleId: id, maxAmount: "2500000" }).maxAmount).toBe("2500000.00");
  });
});

describe("buildApprovalSteps dengan peran", () => {
  it("penyetuju peran jadi tahap dengan approverRoleId; duplikat peran digabung", () => {
    const steps = buildApprovalSteps({
      managerFirst: false,
      approvers: [
        { roleId: "fin", label: "Keuangan", required: false },
        { roleId: "fin", label: "Keuangan lagi", required: true },
        { userId: "dir", label: "Direktur", required: true },
      ],
    });
    expect(steps).toEqual([
      { sequence: 1, approverUserId: null, approverRoleId: "fin", label: "Keuangan", required: true },
      { sequence: 2, approverUserId: "dir", label: "Direktur", required: true },
    ]);
  });
});
