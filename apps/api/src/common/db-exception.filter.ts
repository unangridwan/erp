import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

/** Error Postgres → HTTP: unik (23505) → 409, FK (23503) → 400, RLS/hak akses (42501) → 403. */
@Catch()
export class DbExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      res.status(error.getStatus()).json(error.getResponse());
      return;
    }
    const pg = findPgError(error);
    const mapped = pg && PG_STATUS[pg.code];
    if (mapped) {
      res
        .status(mapped.status)
        .json({ statusCode: mapped.status, message: mapped.message, detail: pg.detail });
      return;
    }
    console.error(error);
    res.status(500).json({ statusCode: 500, message: "Terjadi kesalahan pada server" });
  }
}

const PG_STATUS: Record<string, { status: number; message: string }> = {
  "23505": { status: HttpStatus.CONFLICT, message: "Data sudah ada (duplikat)" },
  "23503": { status: HttpStatus.BAD_REQUEST, message: "Data terkait tidak ditemukan atau masih dipakai" },
  "23514": { status: HttpStatus.BAD_REQUEST, message: "Data melanggar aturan validasi" },
  "42501": { status: HttpStatus.FORBIDDEN, message: "Akses ditolak" },
};

/** Drizzle membungkus error driver; cari error Postgres asli di rantai `cause`. */
function findPgError(error: unknown): { code: string; detail?: string } | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof current.code === "string"
    ) {
      const detail = "detail" in current && typeof current.detail === "string" ? current.detail : undefined;
      return { code: current.code, detail };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
