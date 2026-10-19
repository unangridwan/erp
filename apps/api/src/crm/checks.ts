import { and, eq, inArray, isNull, or, schema, type Db, type PgColumn, type SQL } from "@erp/db";
import { hasPermission, type Permission } from "@erp/shared";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";

/**
 * Aturan rekaman (record rule): tanpa permission `allPermission` user hanya melihat data miliknya
 * atau yang belum ditugaskan. Selalu dibatasi perusahaan aktif.
 */
export function ownedScope(companyColumn: PgColumn, userColumn: PgColumn, allPermission: Permission): SQL {
  const ctx = currentContext();
  const company = eq(companyColumn, ctx.companyId);
  if (hasPermission(ctx.permissions, allPermission)) return company;
  return and(company, or(isNull(userColumn), eq(userColumn, ctx.userId)))!;
}

/** User yang ditugaskan harus aktif dan punya akses ke perusahaan aktif. */
export async function assertCompanyUser(tx: Db, userId: string, path = "userId") {
  // Pemanggil sendiri sudah terbukti punya akses ke perusahaan aktif (termasuk admin berakses penuh).
  if (userId === currentContext().userId) return;
  const [user] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userCompanies, eq(schema.userCompanies.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.id, userId),
        eq(schema.users.active, true),
        eq(schema.userCompanies.companyId, currentContext().companyId),
      ),
    );
  if (!user) throw fieldError(path, "User tidak ditemukan di perusahaan ini");
}

/** Tim penjualan harus milik bersama grup atau milik perusahaan aktif. */
export async function assertTeam(tx: Db, teamId: string, path = "teamId") {
  const [team] = await tx.select().from(schema.salesTeams).where(eq(schema.salesTeams.id, teamId));
  if (!team || (team.companyId && team.companyId !== currentContext().companyId))
    throw fieldError(path, "Tim penjualan tidak ditemukan");
  return team;
}

export async function assertPaymentTerm(tx: Db, id: string, path = "paymentTermId") {
  const [term] = await tx.select().from(schema.paymentTerms).where(eq(schema.paymentTerms.id, id));
  if (!term) throw fieldError(path, "Termin pembayaran tidak ditemukan");
  return term;
}

export async function assertPricelist(tx: Db, id: string, path = "pricelistId") {
  const [pricelist] = await tx.select().from(schema.pricelists).where(eq(schema.pricelists.id, id));
  if (!pricelist || (pricelist.companyId && pricelist.companyId !== currentContext().companyId))
    throw fieldError(path, "Daftar harga tidak ditemukan");
  return pricelist;
}

/** Validasi anggota tim: semua user harus ada di tenant ini. */
export async function assertUsers(tx: Db, ids: string[], path: string) {
  if (!ids.length) return;
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(ids)]));
  if (rows.length !== new Set(ids).size) throw fieldError(path, "User tidak ditemukan");
}
