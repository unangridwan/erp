import { BadRequestException, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, schema, type Db } from "@erp/db";

export type Settings = typeof schema.accountingSettings.$inferSelect;

export interface CompanyBooks {
  companyId: string;
  currencyCode: string;
  decimals: number;
  fiscalYearStartMonth: number;
  settings: Settings;
}

/** Data pembukuan perusahaan: mata uang, desimal, awal tahun fiskal, dan pengaturan akuntansi. */
export async function loadBooks(tx: Db, companyId: string): Promise<CompanyBooks> {
  const [row] = await tx
    .select({
      currencyCode: schema.companies.currencyCode,
      fiscalYearStartMonth: schema.companies.fiscalYearStartMonth,
      decimals: schema.currencies.decimals,
      settings: schema.accountingSettings,
    })
    .from(schema.companies)
    .innerJoin(schema.currencies, eq(schema.currencies.code, schema.companies.currencyCode))
    .leftJoin(schema.accountingSettings, eq(schema.accountingSettings.companyId, schema.companies.id))
    .where(eq(schema.companies.id, companyId));
  if (!row) throw new NotFoundException("Perusahaan tidak ditemukan");
  if (!row.settings) {
    throw new BadRequestException("Akuntansi belum disiapkan untuk perusahaan ini (POST /accounting/setup)");
  }
  return {
    companyId,
    currencyCode: row.currencyCode,
    decimals: row.decimals,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    settings: row.settings,
  };
}

const fieldError = (path: string, message: string) =>
  new BadRequestException({ message: "Validasi gagal", errors: [{ path, message }] });

/** Pastikan akun-akun ada, aktif, dan milik perusahaan yang sama. */
export async function assertCompanyAccounts(tx: Db, companyId: string, refs: { path: string; id: string }[]) {
  const ids = [...new Set(refs.map((r) => r.id))];
  if (!ids.length) return new Map<string, typeof schema.accounts.$inferSelect>();
  const rows = await tx
    .select()
    .from(schema.accounts)
    .where(
      and(
        inArray(schema.accounts.id, ids),
        eq(schema.accounts.companyId, companyId),
        eq(schema.accounts.active, true),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const ref of refs) {
    if (!byId.has(ref.id)) throw fieldError(ref.path, "Akun tidak ditemukan di perusahaan ini");
  }
  return byId;
}

export async function assertCompanyJournal(
  tx: Db,
  companyId: string,
  journalId: string,
  types: string[],
  path = "journalId",
) {
  const [journal] = await tx
    .select()
    .from(schema.journals)
    .where(
      and(
        eq(schema.journals.id, journalId),
        eq(schema.journals.companyId, companyId),
        eq(schema.journals.active, true),
      ),
    );
  if (!journal) throw fieldError(path, "Jurnal tidak ditemukan di perusahaan ini");
  if (!types.includes(journal.journalType)) throw fieldError(path, `Jurnal harus bertipe ${types.join("/")}`);
  return journal;
}

/** Partner harus terlihat dan boleh dipakai perusahaan ini (milik bersama grup atau milik perusahaan ini). */
export async function assertPartner(tx: Db, companyId: string, partnerId: string, path = "partnerId") {
  const [partner] = await tx.select().from(schema.partners).where(eq(schema.partners.id, partnerId));
  if (!partner || (partner.companyId && partner.companyId !== companyId))
    throw fieldError(path, "Partner tidak ditemukan");
  return partner;
}

/** Validasi dimensi unit bisnis & cabang (cabang harus milik perusahaan ini). */
export async function assertDimensions(
  tx: Db,
  companyId: string,
  lines: {
    businessUnitId?: string | null;
    branchId?: string | null;
    costCenterId?: string | null;
    profitCenterId?: string | null;
  }[],
) {
  await assertCenters(tx, companyId, lines);
  for (const [i, line] of lines.entries()) {
    if (line.businessUnitId) {
      const [bu] = await tx
        .select({ id: schema.businessUnits.id })
        .from(schema.businessUnits)
        .where(eq(schema.businessUnits.id, line.businessUnitId));
      if (!bu) throw fieldError(`lines.${i}.businessUnitId`, "Unit bisnis tidak ditemukan");
    }
    if (line.branchId) {
      const [branch] = await tx
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(and(eq(schema.branches.id, line.branchId), eq(schema.branches.companyId, companyId)));
      if (!branch) throw fieldError(`lines.${i}.branchId`, "Cabang tidak ditemukan di perusahaan ini");
    }
  }
}

/** Cost center & profit center harus aktif dan milik perusahaan ini. */
export async function assertCenters(
  tx: Db,
  companyId: string,
  lines: { costCenterId?: string | null; profitCenterId?: string | null }[],
  prefix = "lines",
) {
  const cc = [...new Set(lines.map((l) => l.costCenterId).filter((v): v is string => !!v))];
  const pc = [...new Set(lines.map((l) => l.profitCenterId).filter((v): v is string => !!v))];
  const okCc = cc.length
    ? new Set(
        (
          await tx
            .select({ id: schema.costCenters.id })
            .from(schema.costCenters)
            .where(
              and(
                inArray(schema.costCenters.id, cc),
                eq(schema.costCenters.companyId, companyId),
                eq(schema.costCenters.active, true),
              ),
            )
        ).map((r) => r.id),
      )
    : new Set<string>();
  const okPc = pc.length
    ? new Set(
        (
          await tx
            .select({ id: schema.profitCenters.id })
            .from(schema.profitCenters)
            .where(
              and(
                inArray(schema.profitCenters.id, pc),
                eq(schema.profitCenters.companyId, companyId),
                eq(schema.profitCenters.active, true),
              ),
            )
        ).map((r) => r.id),
      )
    : new Set<string>();
  for (const [i, line] of lines.entries()) {
    const path = prefix ? `${prefix}.${i}.` : "";
    if (line.costCenterId && !okCc.has(line.costCenterId))
      throw fieldError(
        `${path}costCenterId`,
        "Cost center tidak ditemukan atau tidak aktif di perusahaan ini",
      );
    if (line.profitCenterId && !okPc.has(line.profitCenterId))
      throw fieldError(
        `${path}profitCenterId`,
        "Profit center tidak ditemukan atau tidak aktif di perusahaan ini",
      );
  }
}

export { fieldError };
