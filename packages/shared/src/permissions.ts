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
  "tax.read",
  "tax.write",
  /** Ekspor XML Coretax (memuat NIK/NPWP), pengaturan pajak perusahaan. */
  "tax.manage",
  "fleet.read",
  "fleet.write",
  /** Master & pengaturan armada, membuat tagihan vendor dari servis. */
  "fleet.manage",
  "consolidation.read",
  /** Bagan akun grup, pemetaan akun, proses & finalisasi konsolidasi. */
  "consolidation.manage",
  /** Paket langganan & tagihan SaaS tenant. */
  "billing.manage",
  "currency.read",
  "currency.write",
  "user.read",
  "user.write",
  /** Membuat/mengubah peran & matriks haknya. */
  "role.manage",
  /** Mengatur alur persetujuan & batas wewenang (Pengaturan › Aturan Persetujuan). */
  "approval.manage",
  /** Aplikasi terhubung: klien login (OIDC), akun layanan API, webhook. */
  "integration.manage",
  /** Mengirim proyek, task, & timesheet dari aplikasi terhubung (untuk akun layanan). */
  "project.write",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const ALL_PERMISSIONS = "*";

export function hasPermission(granted: readonly string[], required: Permission | (string & {})): boolean {
  return granted.includes(ALL_PERMISSIONS) || granted.includes(required);
}

/** Modul yang dapat diaktifkan per paket langganan; permission berawalan nama modul ikut terkunci. */
export const PLAN_MODULES = [
  "accounting",
  "crm",
  "sales",
  "purchase",
  "inventory",
  "tax",
  "hr",
  "payroll",
] as const;
export type PlanModule = (typeof PLAN_MODULES)[number];

/** Modul yang dibutuhkan sebuah permission, atau null bila termasuk fitur inti. */
export function permissionModule(permission: string): PlanModule | null {
  const prefix = permission.split(".")[0] as PlanModule;
  return (PLAN_MODULES as readonly string[]).includes(prefix) ? prefix : null;
}
