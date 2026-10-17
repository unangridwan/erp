import { z, type AnyZodObject, type ZodTypeAny } from "zod";

/** Ambil tipe dasar dari skema zod (melewati optional/nullable/default/transform). */
function baseType(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current.unwrap();
    else if (current instanceof z.ZodDefault) current = current._def.innerType;
    else if (current instanceof z.ZodEffects) current = current.innerType();
    else return current;
  }
}

const TRUE = new Set(["true", "1", "ya", "y", "yes"]);
const FALSE = new Set(["false", "0", "tidak", "t", "no", "n"]);

/**
 * Ubah satu baris CSV (semua string) ke bentuk yang diharapkan skema: sel kosong diabaikan
 * (agar default berlaku), boolean dari ya/tidak/true/false/1/0. Kolom di luar skema diabaikan.
 */
export function coerceCsvRow(schema: AnyZodObject, row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, ZodTypeAny>)) {
    const raw = row[key]?.trim();
    if (raw === undefined || raw === "") continue;
    const type = baseType(field);
    if (type instanceof z.ZodBoolean) {
      const lower = raw.toLowerCase();
      out[key] = TRUE.has(lower) ? true : FALSE.has(lower) ? false : raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export const exportColumns = (schema: AnyZodObject) => ["id", ...Object.keys(schema.shape)];
