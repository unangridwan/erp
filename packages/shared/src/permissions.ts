/** Seluruh kode permission. Role menyimpan subset dari daftar ini, atau '*' untuk semua. */
export const PERMISSIONS = [
  "company.read",
  "company.write",
  "partner.read",
  "partner.write",
  "product.read",
  "product.write",
  "uom.read",
  "uom.write",
  "accounting.read",
  "accounting.write",
  "accounting.post",
  "accounting.manage",
  "crm.read",
  "crm.write",
  "crm.manage",
  /** Melihat lead & penawaran milik semua salesperson (tanpa ini hanya milik sendiri / belum ditugaskan). */
  "crm.all",
  "sales.read",
  "sales.write",
  "sales.manage",
  "sales.all",
  "currency.read",
  "currency.write",
  "user.read",
  "user.write",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const ALL_PERMISSIONS = "*";

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(ALL_PERMISSIONS) || granted.includes(required);
}
