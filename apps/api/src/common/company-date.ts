import { eq, schema, type Db } from "@erp/db";

const DEFAULT_TZ = "Asia/Jakarta";

/** Zona waktu perusahaan (pengaturan payroll), bawaan Asia/Jakarta. */
export async function companyTimezone(tx: Db, companyId: string): Promise<string> {
  const [s] = await tx
    .select({ tz: schema.payrollSettings.timezone })
    .from(schema.payrollSettings)
    .where(eq(schema.payrollSettings.companyId, companyId));
  return s?.tz ?? DEFAULT_TZ;
}

/** Tanggal YYYY-MM-DD sebuah instan menurut zona waktu tertentu. */
export const dateInZone = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    at,
  );

/**
 * Tanggal hari ini menurut zona waktu perusahaan. Jangan pakai `toISOString()` (UTC): transaksi pukul 00:00–07:00 WIB
 * akan tercatat di tanggal kemarin, bahkan di periode yang sudah dikunci.
 */
export async function companyToday(tx: Db, companyId: string, at = new Date()): Promise<string> {
  return dateInZone(at, await companyTimezone(tx, companyId));
}
