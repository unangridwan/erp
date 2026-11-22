import { AsyncLocalStorage } from "node:async_hooks";
import { allowedFor } from "@erp/shared";

/** Identitas pemanggil untuk satu request; diisi oleh AuthGuard. */
export interface RequestContext {
  tenantId: string;
  userId: string;
  /** Perusahaan yang boleh diakses user. */
  companyIds: string[];
  /** Perusahaan aktif (header X-Company-Id, atau default user). */
  companyId: string;
  permissions: string[];
  /**
   * Hak efektif di tiap perusahaan yang boleh diakses. Peran bisa berlaku hanya di sebagian perusahaan, jadi data
   * lintas perusahaan disaring per perusahaan — bukan dengan hak perusahaan aktif saja. Tidak diisi untuk konteks
   * sistem (job terjadwal, portal): di sana hak perusahaan aktif dipakai untuk semua `companyIds`.
   */
  permissionsByCompany?: Record<string, string[]>;
  /** Admin ('*') tanpa batas perusahaan: boleh melihat semua perusahaan grup, termasuk yang nonaktif. */
  allCompanies?: boolean;
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
 * Perusahaan tempat pemanggil punya `permission` (dinilai seperti guard: hak modul atau hak fitur pemilik `path`).
 * Dipakai untuk menyaring data lintas perusahaan: akses ke perusahaan saja tidak cukup, harus ada hak baca di sana.
 */
/**
 * Pemanggil berhak atas semua perusahaan: admin global, atau konteks sistem dengan hak '*'. Hak '*' yang hanya berlaku
 * di perusahaan aktif TIDAK termasuk — batas perusahaan tetap dihitung per perusahaan lewat `companiesWith`.
 */
export function hasAllCompanies(): boolean {
  const ctx = currentContext();
  return !!ctx.allCompanies || (!ctx.permissionsByCompany && ctx.permissions.includes("*"));
}

export function companiesWith(permission: string, path: string, method = "GET"): string[] {
  const ctx = currentContext();
  return ctx.companyIds.filter((id) =>
    allowedFor(ctx.permissionsByCompany?.[id] ?? ctx.permissions, permission, { path, method }),
  );
}

/**
 * Jalankan `fn` dengan perusahaan aktif lain (mis. membuat dokumen pasangan di perusahaan grup). Pemanggil wajib
 * memastikan user memang punya akses ke perusahaan itu.
 */
export function withCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = currentContext();
  if (!ctx.companyIds.includes(companyId)) throw new Error("Perusahaan di luar akses user");
  // Dokumen pasangan dibuat atas nama pemanggil: haknya di perusahaan asal berlaku selama `fn`.
  const permissionsByCompany = ctx.permissionsByCompany && {
    ...ctx.permissionsByCompany,
    [companyId]: ctx.permissions,
  };
  return storage.run({ ctx: { ...ctx, companyId, permissionsByCompany } }, fn);
}

/** Jalankan `fn` dengan konteks lain (mis. aksi portal pelanggan yang dijalankan atas nama staf pemilik dokumen). */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ctx }, fn);
}
