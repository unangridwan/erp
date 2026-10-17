import { BadRequestException } from "@nestjs/common";
import type { ZodType, ZodTypeDef } from "zod";

/** Validasi body dengan skema zod; kesalahan dikembalikan sebagai 400 per field. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validasi gagal",
      errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
