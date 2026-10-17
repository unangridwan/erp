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
      // Pesan dari trigger aturan bisnis (mis. entri tidak seimbang, periode dikunci) sudah ramah pengguna.
      const message = pg.code === "23514" && pg.fromTrigger && pg.message ? pg.message : mapped.message;
      res.status(mapped.status).json({ statusCode: mapped.status, message, detail: pg.detail });
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
function findPgError(
  error: unknown,
): { code: string; detail?: string; message?: string; fromTrigger: boolean } | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof current.code === "string"
    ) {
      const detail = "detail" in current && typeof current.detail === "string" ? current.detail : undefined;
      const message =
        "message" in current && typeof current.message === "string" ? current.message : undefined;
      // Error dari RAISE di fungsi plpgsql memiliki `where` berisi "PL/pgSQL function".
      const where = "where" in current && typeof current.where === "string" ? current.where : "";
      return { code: current.code, detail, message, fromTrigger: where.includes("PL/pgSQL") };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
