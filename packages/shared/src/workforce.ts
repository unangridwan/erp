import { z } from "zod";

/** Alasan keluar karyawan (selaras `employees.resign_reason`). */
export const RESIGN_REASON_LABEL: Record<string, [string, string]> = {
  resign: ["Mengundurkan diri", "Resignation"],
  end_contract: ["Kontrak berakhir", "End of contract"],
  termination: ["PHK", "Termination"],
  retirement: ["Pensiun", "Retirement"],
  death: ["Meninggal dunia", "Death"],
  other: ["Lainnya", "Other"],
};
/** Keluar atas keinginan karyawan (turnover sukarela). */
export const VOLUNTARY_REASONS = ["resign"] as const;

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Turnover (%) = keluar ÷ rata-rata headcount (awal + akhir periode) / 2. */
export function turnoverRate(leavers: number, startHeadcount: number, endHeadcount: number) {
  const avg = (startHeadcount + endHeadcount) / 2;
  return avg > 0 ? round((leavers / avg) * 100) : 0;
}

/** Retensi (%) = karyawan awal periode yang masih aktif di akhir ÷ karyawan awal periode. */
export function retentionRate(startHeadcount: number, stayed: number) {
  return startHeadcount > 0 ? round((stayed / startHeadcount) * 100) : 0;
}

/** Selisih aktual − rencana beserta persentase terhadap rencana (null bila rencana 0). */
export function variance(planned: number, actual: number) {
  const diff = round(actual - planned);
  return { diff, percent: planned ? round((diff / planned) * 100) : null };
}

/** Selisih tahun penuh antara dua tanggal ISO (umur / masa kerja). */
export function yearsBetween(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years--;
  return Math.max(0, years);
}

/** Masa kerja dalam tahun (desimal, 1 angka). */
export function tenureYears(joinDate: string, asOf: string) {
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${joinDate}T00:00:00Z`);
  return Math.max(0, round(ms / (365.25 * 86_400_000), 1));
}

export const AGE_BANDS = ["< 25", "25–34", "35–44", "45–54", "≥ 55"] as const;
export const TENURE_BANDS = ["< 1 thn", "1–3 thn", "3–5 thn", "5–10 thn", "≥ 10 thn"] as const;

export function ageBand(birthDate: string | null | undefined, asOf: string) {
  if (!birthDate) return null;
  const age = yearsBetween(birthDate, asOf);
  return age < 25
    ? AGE_BANDS[0]
    : age < 35
      ? AGE_BANDS[1]
      : age < 45
        ? AGE_BANDS[2]
        : age < 55
          ? AGE_BANDS[3]
          : AGE_BANDS[4];
}

export function tenureBand(joinDate: string, asOf: string) {
  const t = tenureYears(joinDate, asOf);
  return t < 1
    ? TENURE_BANDS[0]
    : t < 3
      ? TENURE_BANDS[1]
      : t < 5
        ? TENURE_BANDS[2]
        : t < 10
          ? TENURE_BANDS[3]
          : TENURE_BANDS[4];
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : round((s[mid - 1]! + s[mid]!) / 2);
}

/**
 * Compa-ratio = upah ÷ titik tengah skala golongan; tanpa skala lengkap dibandingkan gaji pokok standar
 * (null bila keduanya tidak ada).
 */
export function compaRatio(
  wage: number,
  grade: { minWage?: number | null; maxWage?: number | null; baseWage?: number | null } | null | undefined,
) {
  if (!grade) return null;
  const mid =
    grade.minWage != null && grade.maxWage != null && grade.maxWage > 0
      ? (grade.minWage + grade.maxWage) / 2
      : (grade.baseWage ?? 0);
  return mid > 0 ? round(wage / mid) : null;
}

/** Kesenjangan gaji gender (%) = (median laki-laki − median perempuan) ÷ median laki-laki. */
export function genderPayGap(maleMedian: number, femaleMedian: number) {
  return maleMedian > 0 && femaleMedian > 0 ? round(((maleMedian - femaleMedian) / maleMedian) * 100) : null;
}

/** Hitung kemunculan per kunci (kunci kosong = "—"), urut menurun. */
export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined, order?: readonly string[]) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || "—";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const out = [...m.entries()].map(([label, count]) => ({ label, count }));
  return order
    ? out.sort((a, b) => (order.indexOf(a.label) + 1 || 99) - (order.indexOf(b.label) + 1 || 99))
    : out.sort(
        (a, b) =>
          Number(a.label === "—") - Number(b.label === "—") ||
          b.count - a.count ||
          a.label.localeCompare(b.label),
      );
}

const amount = z.coerce
  .number()
  .min(0, "Tidak boleh negatif")
  .transform((v) => v.toFixed(2));

export const manpowerBudgetLineSchema = z.object({
  departmentId: z.string().uuid().nullish(),
  jobId: z.string().uuid().nullish(),
  month: z.number().int().min(1).max(12),
  headcount: amount.default(0),
  cost: amount.default(0),
  note: z.string().trim().max(300).nullish(),
});
export const manpowerBudgetSchema = z.object({
  lines: z
    .array(manpowerBudgetLineSchema)
    .max(5000)
    .refine(
      (lines) =>
        new Set(lines.map((l) => `${l.departmentId ?? ""}|${l.jobId ?? ""}|${l.month}`)).size ===
        lines.length,
      "Baris anggaran dobel (departemen, jabatan, bulan sama)",
    ),
});
export type ManpowerBudgetInput = z.infer<typeof manpowerBudgetSchema>;
