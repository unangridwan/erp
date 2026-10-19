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

/** Slot konteks request saat ini (untuk dibaca setelah request selesai, mis. log akses). */
export function contextSlot(): { ctx?: RequestContext } | undefined {
  return storage.getStore();
}

/**
 * Jalankan `fn` dengan perusahaan aktif lain (mis. membuat dokumen pasangan di perusahaan grup). Pemanggil wajib
 * memastikan user memang punya akses ke perusahaan itu.
 */
export function withCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = currentContext();
  if (!ctx.companyIds.includes(companyId)) throw new Error("Perusahaan di luar akses user");
  return storage.run({ ctx: { ...ctx, companyId } }, fn);
}

/** Jalankan `fn` dengan konteks lain (mis. aksi portal pelanggan yang dijalankan atas nama staf pemilik dokumen). */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ctx }, fn);
}
