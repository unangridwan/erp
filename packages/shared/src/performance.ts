/** Logika murni kinerja lanjutan: progres sasaran bertingkat & ringkasan feedback 360. */

export interface GoalNode {
  id: string;
  parentId: string | null;
  metric: "percent" | "number" | "currency" | "boolean";
  startValue: number | string;
  targetValue: number | string;
  currentValue: number | string;
  weight: number | string;
  state: "draft" | "active" | "done" | "cancelled";
  /** Sasaran KPI otomatis: nilainya dihitung dari data seluruh cakupannya, jadi progresnya dari nilai sendiri. */
  kpiCode?: string | null;
}

const clamp = (x: number) => Math.min(100, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Progres satu sasaran dari nilainya sendiri (0–100). */
export function ownProgress(
  g: Pick<GoalNode, "metric" | "startValue" | "targetValue" | "currentValue" | "state">,
) {
  if (g.state === "done") return 100;
  if (g.metric === "boolean") return Number(g.currentValue) >= 1 ? 100 : 0;
  const start = Number(g.startValue);
  const span = Number(g.targetValue) - start;
  if (!span) return 0;
  return round1(clamp(((Number(g.currentValue) - start) / span) * 100));
}

/**
 * Progres semua sasaran: sasaran yang punya anak aktif = rata-rata berbobot progres anak (rekursif); tanpa anak =
 * progres nilainya sendiri. Sasaran KPI otomatis selalu memakai nilainya sendiri (turunannya hanya rincian). Sasaran
 * dibatalkan/draft tidak ikut dihitung ke induk.
 */
export function goalProgress(goals: GoalNode[]) {
  const children = new Map<string, GoalNode[]>();
  for (const g of goals) if (g.parentId) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g]);
  const memo = new Map<string, number>();
  const visit = (g: GoalNode, seen: Set<string>): number => {
    if (memo.has(g.id)) return memo.get(g.id)!;
    if (seen.has(g.id)) return ownProgress(g); // siklus: abaikan
    seen.add(g.id);
    const kids = (children.get(g.id) ?? []).filter((c) => c.state === "active" || c.state === "done");
    let p: number;
    if (!kids.length || g.state === "done" || g.kpiCode) p = ownProgress(g);
    else {
      const total = kids.reduce((s, c) => s + Number(c.weight), 0);
      p = round1(kids.reduce((s, c) => s + visit(c, seen) * Number(c.weight), 0) / total);
    }
    memo.set(g.id, p);
    return p;
  };
  return new Map(goals.map((g) => [g.id, visit(g, new Set())]));
}

/** Kompetensi feedback 360 (skor 1–5). */
export const FEEDBACK_COMPETENCIES = [
  { key: "communication", label: ["Komunikasi", "Communication"] },
  { key: "teamwork", label: ["Kerja sama tim", "Teamwork"] },
  { key: "initiative", label: ["Inisiatif", "Initiative"] },
  { key: "quality", label: ["Kualitas kerja", "Quality of work"] },
  { key: "integrity", label: ["Integritas", "Integrity"] },
  { key: "leadership", label: ["Kepemimpinan", "Leadership"] },
] as const;

/**
 * Ringkasan feedback 360 yang anonim: rata-rata per kompetensi keseluruhan & per relasi. Relasi dengan kurang dari dua
 * respons (kecuali atasan & diri sendiri, yang memang dikenal) digabung ke "lainnya" agar penilai tidak dapat ditebak.
 * Komentar dikembalikan tanpa identitas penilai, diurutkan acak-stabil (alfabetis).
 */
export function feedbackSummary(
  rows: {
    relation: string;
    scores: Record<string, number>;
    strengths: string | null;
    improvements: string | null;
  }[],
) {
  const known = new Set(["manager", "self"]);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.relation, (counts.get(r.relation) ?? 0) + 1);
  const group = (relation: string) =>
    known.has(relation) || (counts.get(relation) ?? 0) >= 2 ? relation : "other";
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const groups = [...new Set(rows.map((r) => group(r.relation)))].sort();
  const pick = (subset: typeof rows, key: string) =>
    subset.map((r) => r.scores[key]).filter((x): x is number => typeof x === "number");
  const others = rows.filter((r) => r.relation !== "self");
  return {
    responses: rows.length,
    competencies: FEEDBACK_COMPETENCIES.map((c) => ({
      key: c.key,
      // Rata-rata keseluruhan tanpa penilaian diri; penilaian diri ditampilkan terpisah sebagai pembanding.
      average: avg(pick(others, c.key)),
      byRelation: Object.fromEntries(
        groups.map((g) => [
          g,
          avg(
            pick(
              rows.filter((r) => group(r.relation) === g),
              c.key,
            ),
          ),
        ]),
      ),
    })),
    relations: groups.map((g) => ({
      relation: g,
      count: rows.filter((r) => group(r.relation) === g).length,
    })),
    strengths: rows
      .map((r) => r.strengths?.trim())
      .filter((x): x is string => !!x)
      .sort(),
    improvements: rows
      .map((r) => r.improvements?.trim())
      .filter((x): x is string => !!x)
      .sort(),
  };
}
