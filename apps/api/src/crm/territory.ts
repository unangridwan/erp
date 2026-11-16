import { and, asc, eq, schema, type Db } from "@erp/db";
import { matchTerritory } from "@erp/shared";

/** Wilayah penjualan yang cocok dengan provinsi/kota/industri menurut aturan wilayah aktif perusahaan. */
export async function resolveTerritory(
  tx: Db,
  companyId: string,
  subject: { province?: string | null; city?: string | null; industry?: string | null },
) {
  if (!subject.province && !subject.city && !subject.industry) return null;
  const territories = await tx
    .select()
    .from(schema.crmTerritories)
    .where(and(eq(schema.crmTerritories.companyId, companyId), eq(schema.crmTerritories.active, true)))
    .orderBy(asc(schema.crmTerritories.sequence));
  return matchTerritory(territories, subject);
}
