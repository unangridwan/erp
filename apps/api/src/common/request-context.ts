import { AsyncLocalStorage } from "node:async_hooks";

/** Identitas pemanggil untuk satu request; diisi oleh AuthGuard. */
export interface RequestContext {
  tenantId: string;
  userId: string;
  /** Perusahaan yang boleh diakses user. */
  companyIds: string[];
  /** Perusahaan aktif (header X-Company-Id, atau default user). */
  companyId: string;
  permissions: string[];
}

const storage = new AsyncLocalStorage<{ ctx?: RequestContext }>();

/** Middleware: buka slot konteks untuk request ini. */
export function contextMiddleware(_req: unknown, _res: unknown, next: () => void) {
  storage.run({}, next);
}

export function setContext(ctx: RequestContext) {
  const slot = storage.getStore();
  if (!slot) throw new Error("contextMiddleware belum terpasang");
  slot.ctx = ctx;
}

export function currentContext(): RequestContext {
  const ctx = storage.getStore()?.ctx;
  if (!ctx) throw new Error("Tidak ada konteks request yang terautentikasi");
  return ctx;
}
