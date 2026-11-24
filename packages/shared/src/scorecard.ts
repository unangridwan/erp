import { z } from "zod";
import { KPI_BY_CODE, kpiMeasureValue, kpiRowsIn, type KpiDef, type KpiUnit } from "./kpi.js";
import type { ReportColumn } from "./reports.js";

/**
 * Target berjenjang & scorecard. Sasaran bisa terhubung ke KPI otomatis (nilai berjalan dihitung dari data untuk
 * pemilik sasaran: karyawan, anggota departemen, atau seluruh perusahaan) dan dinilai menurut **laju**: capaian
 * dibanding porsi waktu periode yang sudah berjalan.
 */
export type Rag = "green" | "amber" | "red";

/** Metrik sasaran dari satuan KPI. */
export const KPI_METRIC: Record<KpiUnit, "percent" | "number" | "currency"> = {
  money: "currency",
  percent: "percent",
  count: "number",
  days: "number",
};

/** Porsi waktu periode yang sudah berjalan (0–1); tanpa periode = 1 (dinilai dari capaian saja). */
export function elapsedShare(from: string | null, to: string | null, today: string) {
  if (!from || !to || to < from) return 1;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const total = t(to) - t(from) + 864e5;
  const gone = Math.min(Math.max(t(today) - t(from) + 864e5, 0), total);
  return Math.round((gone / total) * 1000) / 1000;
}

/**
 * Status menurut laju: hijau bila capaian ≥ 90% dari yang semestinya tercapai pada titik waktu ini, kuning ≥ 70%,
 * merah di bawahnya. Sasaran selesai/tercapai selalu hijau; periode belum mulai = hijau.
 */
export function paceStatus(progress: number, elapsed: number, done = false): { rag: Rag; expected: number } {
  const expected = Math.round(Math.min(1, Math.max(0, elapsed)) * 1000) / 10;
  if (done || progress >= 100 || expected === 0) return { rag: "green", expected };
  const ratio = progress / expected;
  return { rag: ratio >= 0.9 ? "green" : ratio >= 0.7 ? "amber" : "red", expected };
}

/**
 * Nilai KPI untuk satu cakupan: baris milik salah satu `owners` (null = semua baris perusahaan) dalam periode.
 */
export function kpiScopeValue(
  def: KpiDef,
  rows: Record<string, unknown>[],
  columns: ReportColumn[],
  opts: { owners: Set<string> | null; from: string; to: string },
) {
  const scoped = opts.owners ? rows.filter((r) => opts.owners!.has(String(r[def.owner] ?? ""))) : rows;
  return kpiMeasureValue(def, kpiRowsIn(def, scoped, opts.from, opts.to), columns);
}

/** Pembagian target ke turunan: rata, atau proporsional terhadap capaian periode sebelumnya. */
export function splitTarget(
  total: number,
  parts: { id: string; basis: number | null }[],
  mode: "equal" | "proportional",
  /** KPI persentase/rasio: target turunan sama dengan induk, bukan dibagi. */
  ratio = false,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!parts.length) return out;
  if (ratio) {
    for (const p of parts) out.set(p.id, total);
    return out;
  }
  const basisSum = parts.reduce((s, p) => s + Math.max(0, p.basis ?? 0), 0);
  const useBasis = mode === "proportional" && basisSum > 0;
  let assigned = 0;
  parts.forEach((p, i) => {
    const share = useBasis ? Math.max(0, p.basis ?? 0) / basisSum : 1 / parts.length;
    // Sisa pembulatan masuk ke bagian terakhir agar jumlahnya tepat sama dengan total.
    const v = i === parts.length - 1 ? total - assigned : Math.round(total * share * 100) / 100;
    assigned += v;
    out.set(p.id, Math.round(v * 100) / 100);
  });
  return out;
}

export const goalCascadeSchema = z.object({
  /** Turunkan ke semua departemen, atau ke karyawan satu departemen. */
  to: z.enum(["departments", "employees"]),
  departmentId: z.string().uuid().nullish(),
  split: z.enum(["equal", "proportional"]).default("equal"),
});
export type GoalCascadeInput = z.infer<typeof goalCascadeSchema>;

export const KPI_CODES = [...KPI_BY_CODE.keys()] as [string, ...string[]];
