import { businessToday } from "@erp/shared";
import type { Db } from "@erp/db";

/**
 * Tanggal hari ini untuk dokumen perusahaan: sama dengan semua default tanggal server (`businessToday`), agar jurnal
 * stok, faktur, dan laporan yang dibuat bersamaan tidak terpecah ke dua tanggal.
 */
export async function companyToday(_tx: Db, _companyId: string, at = new Date()): Promise<string> {
  return businessToday(at);
}
