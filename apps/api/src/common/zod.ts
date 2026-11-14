import { BadRequestException } from "@nestjs/common";
import type { ZodObject, ZodType, output } from "zod";

/** Validasi body dengan skema zod; kesalahan dikembalikan sebagai 400 per field. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validasi gagal",
      errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/**
 * Validasi sebagian (PATCH): hanya field yang dikirim yang dikembalikan. Sejak zod 4, `.partial()` tetap mengisi
 * nilai bawaan field yang tidak dikirim — tanpa penyaringan ini, bawaan skema akan menimpa nilai yang tersimpan.
 */
export function parsePartial<S extends ZodObject>(schema: S, input: unknown): Partial<output<S>> {
  const values = parse(schema.partial(), input) as Record<string, unknown>;
  const sent = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(values).filter(([k]) => k in sent)) as Partial<output<S>>;
}
