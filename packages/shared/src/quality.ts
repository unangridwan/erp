import { z } from "zod";

/** Logika murni inspeksi mutu: jumlah sampel, evaluasi hasil checklist/ukur, tingkat cacat; skema zod. */

export const QUALITY_TRIGGER_LABEL: Record<string, [string, string]> = {
  receipt: ["Penerimaan barang", "Goods receipt"],
  production: ["Hasil produksi", "Production output"],
};
export const CHECK_STATE_LABEL: Record<string, [string, string]> = {
  pending: ["Menunggu", "Pending"],
  passed: ["Lulus", "Passed"],
  failed: ["Gagal", "Failed"],
  conditional: ["Diterima bersyarat", "Conditionally accepted"],
};
export const DECISION_LABEL: Record<string, [string, string]> = {
  accept: ["Terima", "Accept"],
  conditional: ["Terima bersyarat", "Accept with conditions"],
  return: ["Retur ke pemasok", "Return to supplier"],
  scrap: ["Buang (scrap)", "Scrap"],
};
export const ALERT_STATE_LABEL: Record<string, [string, string]> = {
  open: ["Terbuka", "Open"],
  in_progress: ["Ditangani", "In progress"],
  closed: ["Ditutup", "Closed"],
};

export interface QualityItemDef {
  label: string;
  kind: "pass_fail" | "measure";
  min?: number | null;
  max?: number | null;
  unit?: string | null;
  photo?: boolean;
}
export interface QualityResultValue {
  value?: string | null;
  note?: string | null;
}

/** Jumlah sampel: semua, persen (dibulatkan ke atas), atau jumlah tetap; tidak lebih dari kuantitas & minimal 1. */
export function sampleQuantity(qty: number, sampling: "all" | "percent" | "quantity", value?: number | null) {
  if (qty <= 0) return 0;
  if (sampling === "percent" && value) return Math.min(qty, Math.max(1, Math.ceil((qty * value) / 100)));
  if (sampling === "quantity" && value) return Math.min(qty, Math.max(1, value));
  return qty;
}

/**
 * Nilai tiap butir: lulus/gagal (`pass`/`fail`) atau angka di dalam batas min–maks. Butir tanpa nilai = belum diisi
 * (`passed: null`). Butir wajib foto gagal bila fotonya belum ada. `complete` = semua butir terisi.
 */
export function evaluateResults(
  items: QualityItemDef[],
  values: (QualityResultValue | undefined)[],
  photosByItem: Set<number> = new Set(),
) {
  const results = items.map((item, i) => {
    const raw = values[i]?.value;
    const value = raw === undefined || raw === null || String(raw).trim() === "" ? null : String(raw).trim();
    let passed: boolean | null = null;
    if (value !== null) {
      if (item.kind === "pass_fail") passed = value === "pass";
      else {
        const n = Number(value.replace(",", "."));
        passed =
          Number.isFinite(n) &&
          (item.min === null || item.min === undefined || n >= item.min) &&
          (item.max === null || item.max === undefined || n <= item.max);
      }
      if (passed && item.photo && !photosByItem.has(i)) passed = false;
    }
    return { ...item, value, passed, note: values[i]?.note ?? null };
  });
  const complete = results.every((r) => r.passed !== null);
  const passed = complete && results.every((r) => r.passed);
  return { results, complete, passed };
}

/** Tingkat cacat (%) dari jumlah pemeriksaan gagal dibanding yang sudah diputuskan. */
export const defectRate = (failed: number, decided: number) =>
  decided ? Math.round((failed / decided) * 1000) / 10 : null;

// ---- Skema ----

const uuid = z.string().uuid();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const qualityItemSchema = z
  .object({
    label: z.string().trim().min(1, "Isi nama butir pemeriksaan").max(200),
    kind: z.enum(["pass_fail", "measure"]).default("pass_fail"),
    min: z.number().nullish(),
    max: z.number().nullish(),
    unit: text(20),
    photo: z.boolean().default(false),
  })
  .refine((i) => i.min == null || i.max == null || i.min <= i.max, {
    path: ["max"],
    message: "Batas maksimum lebih kecil dari minimum",
  });

export const qualityPointSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(160),
  trigger: z.enum(["receipt", "production"]),
  productId: uuid.nullish(),
  categoryId: uuid.nullish(),
  partnerId: uuid.nullish(),
  sampling: z.enum(["all", "percent", "quantity"]).default("all"),
  sampleValue: z
    .union([z.string(), z.number()])
    .transform((v) => (v === "" ? null : String(v)))
    .nullish(),
  items: z.array(qualityItemSchema).min(1, "Tambahkan minimal satu butir pemeriksaan").max(50),
  instructions: text(5000),
  quarantine: z.boolean().default(true),
  active: z.boolean().default(true),
});

export const qualityResultsSchema = z.object({
  results: z.array(z.object({ value: z.string().trim().max(60).nullish(), note: text(500) })).max(50),
  note: text(5000),
});

export const qualityDecisionSchema = z.object({
  decision: z.enum(["accept", "conditional", "return", "scrap"]),
  note: text(5000),
});

export const qualityPhotoSchema = z.object({
  itemIndex: z.number().int().min(0).max(49).nullish(),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  /** Isi berkas base64, maks. ±2 MB. */
  data: z.string().min(1).max(2_800_000),
});

export const qualityAlertSchema = z.object({
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  description: text(5000),
  rootCause: text(5000),
  correctiveAction: text(5000),
  responsibleUserId: uuid.nullish(),
  productId: uuid.nullish(),
  partnerId: uuid.nullish(),
  state: z.enum(["open", "in_progress", "closed"]).default("open"),
});
