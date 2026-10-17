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
  "inventory.read",
  "inventory.write",
  /** Gudang, lokasi, aturan pemesanan ulang, penyesuaian stok. */
  "inventory.manage",
  "purchase.read",
  "purchase.write",
  "purchase.manage",
  /** Menyetujui PO di atas batas persetujuan. */
  "purchase.approve",
  "hr.read",
  "hr.write",
  /** Data sensitif karyawan (NIK, NPWP, rekening), kontrak, dan pengaturan SDM. */
  "hr.manage",
  "payroll.read",
  "payroll.write",
  /** Posting & pembayaran payroll, pengaturan payroll. */
  "payroll.manage",
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
