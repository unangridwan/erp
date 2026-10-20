/**
 * Titik tunggal pelaporan error tak tertangani (HTTP 5xx, job latar). Pelapor dipasang oleh `instrument.ts` saat
 * SENTRY_DSN diisi; tanpa pelapor fungsi ini tidak melakukan apa pun. Body/query request tidak pernah dikirim.
 */
export interface ErrorContext {
  reqId?: string;
  method?: string;
  route?: string;
  tenantId?: string;
  userId?: string;
  [key: string]: string | undefined;
}
export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

let reporter: ErrorReporter | null = null;

export function setErrorReporter(fn: ErrorReporter | null) {
  reporter = fn;
}

export function reportError(error: unknown, context: ErrorContext = {}) {
  if (!reporter) return;
  try {
    reporter(error, context);
  } catch {
    // Pelaporan tidak boleh menggagalkan respons.
  }
}
