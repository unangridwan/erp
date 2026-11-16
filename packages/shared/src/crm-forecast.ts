import { Decimal } from "decimal.js";
import { z } from "zod";

/** Logika murni forecast CRM: periode, kategori forecast, rollup vs kuota, pencocokan wilayah, giliran penugasan. */

export const FORECAST_CATEGORY_VALUES = ["pipeline", "best_case", "commit", "omitted"] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORY_VALUES)[number];
export const FORECAST_CATEGORY_LABEL: Record<string, [string, string]> = {
  pipeline: ["Pipeline", "Pipeline"],
  best_case: ["Best case", "Best case"],
  commit: ["Commit", "Commit"],
  omitted: ["Tidak dihitung", "Omitted"],
  closed: ["Closed (menang)", "Closed (won)"],
};

export interface ForecastPeriod {
  /** `2026-11` (bulan) atau `2026-Q4` (kuartal). */
  key: string;
  type: "month" | "quarter";
  /** Tanggal pertama (YYYY-MM-DD). */
  start: string;
  /** Tanggal terakhir, inklusif. */
  end: string;
  /** Awal tiap bulan dalam periode. */
  months: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Urai kunci periode `YYYY-MM` atau `YYYY-Qn`; `null` bila tidak valid. */
export function parsePeriod(key: string): ForecastPeriod | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const start = `${year}-${pad(month)}-01`;
    return {
      key,
      type: "month",
      start,
      end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
      months: [start],
    };
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!q) return null;
  const year = Number(q[1]);
  const first = (Number(q[2]) - 1) * 3 + 1;
  const months = [0, 1, 2].map((i) => `${year}-${pad(first + i)}-01`);
  return {
    key,
    type: "quarter",
    start: months[0]!,
    end: `${year}-${pad(first + 2)}-${pad(lastDay(year, first + 2))}`,
    months,
  };
}

/** Kunci periode yang memuat tanggal. */
export function periodOf(date: string, type: "month" | "quarter"): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  return type === "month" ? `${year}-${pad(month)}` : `${year}-Q${Math.ceil(month / 3)}`;
}

/** Kategori forecast peluang: pilihan pada peluang menimpa kategori tahapnya. */
export function effectiveCategory(
  lead: { forecastCategory?: string | null },
  stage: { forecastCategory?: string | null } | null | undefined,
): ForecastCategory {
  const v = lead.forecastCategory ?? stage?.forecastCategory ?? "pipeline";
  return (FORECAST_CATEGORY_VALUES as readonly string[]).includes(v) ? (v as ForecastCategory) : "pipeline";
}

export interface ForecastLead {
  userId: string | null;
  state: "open" | "won" | "lost";
  amount: Decimal.Value;
  probability: Decimal.Value;
  /** Kategori efektif (lihat `effectiveCategory`); diabaikan untuk peluang menang. */
  category: ForecastCategory;
}

export interface ForecastRow {
  userId: string | null;
  closed: string;
  commit: string;
  bestCase: string;
  pipeline: string;
  weighted: string;
  /** Closed + commit: angka yang dijanjikan. */
  commitForecast: string;
  /** Closed + commit + best case. */
  bestCaseForecast: string;
  quota: string | null;
  /** Forecast yang ditetapkan manajer (bila ada). */
  adjusted: string | null;
  /** Closed ÷ kuota (%); `null` tanpa kuota. */
  attainment: number | null;
  /** Kuota − closed (bisa negatif bila terlampaui); `null` tanpa kuota. */
  gap: string | null;
  count: number;
}

const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/** Satu baris forecast dari sekumpulan peluang milik satu pemilik (atau gabungan). */
export function forecastRow(
  userId: string | null,
  leads: ForecastLead[],
  quota: Decimal.Value | null,
  adjusted: Decimal.Value | null = null,
): ForecastRow {
  const sum = {
    closed: new Decimal(0),
    commit: new Decimal(0),
    best_case: new Decimal(0),
    pipeline: new Decimal(0),
  };
  let weighted = new Decimal(0);
  let count = 0;
  for (const l of leads) {
    if (l.state === "lost") continue;
    if (l.state === "won") {
      sum.closed = sum.closed.plus(l.amount);
      count++;
      continue;
    }
    if (l.category === "omitted") continue;
    sum[l.category] = sum[l.category].plus(l.amount);
    weighted = weighted.plus(new Decimal(l.amount).times(l.probability).div(100));
    count++;
  }
  const q = quota === null ? null : new Decimal(quota);
  return {
    userId,
    closed: money(sum.closed),
    commit: money(sum.commit),
    bestCase: money(sum.best_case),
    pipeline: money(sum.pipeline),
    weighted: money(weighted),
    commitForecast: money(sum.closed.plus(sum.commit)),
    bestCaseForecast: money(sum.closed.plus(sum.commit).plus(sum.best_case)),
    quota: q ? money(q) : null,
    adjusted: adjusted === null ? null : money(new Decimal(adjusted)),
    attainment: q && q.gt(0) ? sum.closed.div(q).times(100).toDecimalPlaces(1).toNumber() : null,
    gap: q ? money(q.minus(sum.closed)) : null,
    count,
  };
}

/**
 * Rollup forecast per pemilik. `quotas`/`adjustments` = jumlah per user untuk periode yang sama (sudah dijumlahkan
 * bila periodenya kuartal). User yang hanya punya kuota tetap mendapat baris.
 */
export function forecastRollup(
  leads: ForecastLead[],
  quotas: Record<string, Decimal.Value> = {},
  adjustments: Record<string, Decimal.Value> = {},
): ForecastRow[] {
  const groups = new Map<string | null, ForecastLead[]>();
  for (const l of leads) {
    if (!groups.has(l.userId)) groups.set(l.userId, []);
    groups.get(l.userId)!.push(l);
  }
  for (const id of [...Object.keys(quotas), ...Object.keys(adjustments)])
    if (!groups.has(id)) groups.set(id, []);
  return [...groups.entries()].map(([userId, list]) =>
    forecastRow(
      userId,
      list,
      userId !== null && quotas[userId] !== undefined ? quotas[userId]! : null,
      userId !== null && adjustments[userId] !== undefined ? adjustments[userId]! : null,
    ),
  );
}

export interface TerritoryRuleSet {
  provinces?: string[];
  cities?: string[];
  industries?: string[];
}
export interface TerritoryLike {
  id: string;
  sequence: number;
  active?: boolean;
  rules: TerritoryRuleSet;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const listMatch = (list: string[] | undefined, value: string | null | undefined) => {
  if (!list || list.length === 0) return true;
  const v = norm(value);
  return v !== "" && list.some((x) => norm(x) === v);
};

/**
 * Wilayah pertama (urut `sequence`) yang semua aturannya cocok. Daftar kosong tidak membatasi, tetapi wilayah tanpa
 * aturan sama sekali tidak pernah cocok otomatis (hanya bisa dipilih manual).
 */
export function matchTerritory<T extends TerritoryLike>(
  territories: T[],
  subject: { province?: string | null; city?: string | null; industry?: string | null },
): T | null {
  const sorted = [...territories].filter((t) => t.active !== false).sort((a, b) => a.sequence - b.sequence);
  for (const t of sorted) {
    const r = t.rules ?? {};
    const hasRule = [r.provinces, r.cities, r.industries].some((l) => l && l.length > 0);
    if (!hasRule) continue;
    if (
      listMatch(r.provinces, subject.province) &&
      listMatch(r.cities, subject.city) &&
      listMatch(r.industries, subject.industry)
    )
      return t;
  }
  return null;
}

/** Giliran penugasan: anggota dengan beban (jumlah lead terbuka) paling sedikit; seri → urutan anggota. */
export function nextAssignee(memberIds: string[], load: Record<string, number> = {}): string | null {
  let best: string | null = null;
  for (const id of memberIds) if (best === null || (load[id] ?? 0) < (load[best] ?? 0)) best = id;
  return best;
}

const amount = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Angka tidak valid (maks. 2 desimal, tidak negatif)"),
  ])
  .transform(String);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Bulan harus berformat YYYY-MM");
const names = z.array(z.string().trim().min(1).max(100)).max(100).default([]);

/** Kuota bulanan: `amount` kosong/null menghapus kuota bulan itu. */
export const quotasSchema = z.object({
  quotas: z
    .array(
      z
        .object({
          userId: z.string().uuid().nullish(),
          teamId: z.string().uuid().nullish(),
          month,
          amount: amount.nullable(),
        })
        .refine((q) => Boolean(q.userId) !== Boolean(q.teamId), "Isi salesperson atau tim, salah satu"),
    )
    .max(2000),
});

export const forecastAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  month,
  /** null = hapus penyesuaian. */
  amount: amount.nullable(),
  note: z.string().trim().max(500).nullish(),
});

export const territorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sequence: z.coerce.number().int().min(0).max(100000).default(10),
  rules: z.object({ provinces: names, cities: names, industries: names }).prefault({}),
  managerId: z.string().uuid().nullish(),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
  active: z.boolean().default(true),
});
