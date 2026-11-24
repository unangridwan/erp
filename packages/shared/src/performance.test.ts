import { describe, expect, it } from "vitest";
import { feedbackSummary, goalProgress, ownProgress, type GoalNode } from "./performance.js";

const g = (over: Partial<GoalNode> & { id: string }): GoalNode => ({
  parentId: null,
  metric: "number",
  startValue: 0,
  targetValue: 100,
  currentValue: 0,
  weight: 1,
  state: "active",
  ...over,
});

describe("goalProgress sasaran KPI", () => {
  it("sasaran KPI memakai nilainya sendiri meski punya turunan", () => {
    const base = { metric: "number" as const, startValue: 0, weight: 1, state: "active" as const };
    const p = goalProgress([
      { ...base, id: "k", parentId: null, targetValue: 100, currentValue: 80, kpiCode: "sales.revenue" },
      { ...base, id: "c1", parentId: "k", targetValue: 50, currentValue: 0, kpiCode: "sales.revenue" },
      { ...base, id: "m", parentId: null, targetValue: 100, currentValue: 90 },
      { ...base, id: "c2", parentId: "m", targetValue: 10, currentValue: 5 },
    ]);
    expect(p.get("k")).toBe(80);
    expect(p.get("c1")).toBe(0);
    // Sasaran manual tetap rata-rata turunannya.
    expect(p.get("m")).toBe(50);
  });
});

describe("goalProgress", () => {
  it("progres sendiri: dari nilai awal ke target, dibatasi 0–100; boolean; selesai = 100", () => {
    expect(ownProgress(g({ id: "a", startValue: 10, targetValue: 30, currentValue: 15 }))).toBe(25);
    expect(ownProgress(g({ id: "a", currentValue: 150 }))).toBe(100);
    // Target turun (mis. menurunkan biaya 100 → 60): 80 = 50%.
    expect(ownProgress(g({ id: "a", startValue: 100, targetValue: 60, currentValue: 80 }))).toBe(50);
    expect(ownProgress(g({ id: "a", metric: "boolean", targetValue: 1, currentValue: 1 }))).toBe(100);
    expect(ownProgress(g({ id: "a", state: "done", currentValue: 0 }))).toBe(100);
  });

  it("induk = rata-rata berbobot anak (rekursif); anak dibatalkan diabaikan", () => {
    const p = goalProgress([
      g({ id: "co" }),
      g({ id: "d1", parentId: "co", weight: 3 }),
      g({ id: "d2", parentId: "co", weight: 1, currentValue: 100 }),
      g({ id: "e1", parentId: "d1", currentValue: 50 }),
      g({ id: "e2", parentId: "d1", currentValue: 10, state: "cancelled" }),
    ]);
    expect(p.get("e1")).toBe(50);
    expect(p.get("d1")).toBe(50); // e2 dibatalkan
    expect(p.get("co")).toBe(62.5); // (50×3 + 100×1) / 4
  });
});

describe("feedbackSummary", () => {
  it("rata-rata tanpa penilaian diri; relasi < 2 respons digabung 'other'; komentar anonim", () => {
    const s = feedbackSummary([
      { relation: "self", scores: { communication: 5 }, strengths: "Saya teliti", improvements: null },
      {
        relation: "manager",
        scores: { communication: 3, teamwork: 4 },
        strengths: null,
        improvements: "Delegasi",
      },
      { relation: "peer", scores: { communication: 4 }, strengths: "Membantu tim", improvements: null },
      {
        relation: "peer",
        scores: { communication: 2 },
        strengths: null,
        improvements: " Lebih tepat waktu ",
      },
      { relation: "subordinate", scores: { communication: 5 }, strengths: null, improvements: null },
    ]);
    const comm = s.competencies.find((c) => c.key === "communication")!;
    expect(comm.average).toBe(3.5); // (3 + 4 + 2 + 5) / 4
    expect(comm.byRelation).toEqual({ manager: 3, other: 5, peer: 3, self: 5 });
    expect(s.relations.map((r) => r.relation)).not.toContain("subordinate");
    expect(s.improvements).toEqual(["Delegasi", "Lebih tepat waktu"]);
    expect(s.responses).toBe(5);
  });
});
