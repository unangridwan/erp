import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq, schema, type Db } from "@erp/db";
import { idtku, tin16 } from "@erp/shared";

/** NPWP 16 digit & ID TKU perusahaan untuk dokumen Coretax; error jelas bila belum diisi. */
export async function companyTaxIds(tx: Db, companyId: string) {
  const [company] = await tx
    .select({
      name: schema.companies.name,
      npwp: schema.companies.npwp,
      nitku: schema.companies.nitku,
      pkp: schema.companies.pkp,
    })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  if (!company) throw new NotFoundException("Perusahaan tidak ditemukan");
  const tin = tin16(company.npwp);
  if (!tin)
    throw new BadRequestException("Lengkapi NPWP perusahaan (Pengaturan → Perusahaan) terlebih dahulu");
  return { ...company, tin, idtku: company.nitku || idtku(tin)! };
}

/** Rentang tanggal satu masa pajak. */
export function periodRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${from.slice(0, 8)}${String(last).padStart(2, "0")}` };
}

export const xmlFileName = (prefix: string, year: number, month: number) =>
  `${prefix}-${year}${String(month).padStart(2, "0")}-${Date.now().toString(36)}.xml`;
