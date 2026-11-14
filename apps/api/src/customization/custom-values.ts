import { BadRequestException } from "@nestjs/common";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  or,
  schema,
  sql,
  type Db,
  type PgColumn,
  type PgTable,
} from "@erp/db";
import {
  coerceCustomValues,
  customColumnName,
  formatCustomValue,
  type CustomFieldDef,
  type CustomFieldModel,
  type CustomRefModel,
} from "@erp/shared";
import { currentContext } from "../common/request-context.js";

type Table = PgTable & { id: PgColumn; custom: PgColumn };

/** Tabel penyimpan nilai per model. */
export const CUSTOM_TABLES: Record<CustomFieldModel, Table> = {
  partner: schema.partners,
  product: schema.products,
  employee: schema.employees,
  fleet_vehicle: schema.fleetVehicles,
  crm_lead: schema.crmLeads,
  sale_order: schema.saleOrders,
  purchase_order: schema.purchaseOrders,
  account_move: schema.accountMoves,
  stock_picking: schema.stockPickings,
  production_order: schema.productionOrders,
  equipment: schema.equipment,
  maintenance_request: schema.maintenanceRequests,
};

const REF_TABLES: Record<CustomRefModel, { table: PgTable; id: PgColumn; name: PgColumn }> = {
  partner: { table: schema.partners, id: schema.partners.id, name: schema.partners.name },
  product: { table: schema.products, id: schema.products.id, name: schema.products.name },
  employee: { table: schema.employees, id: schema.employees.id, name: schema.employees.name },
  user: { table: schema.users, id: schema.users.id, name: schema.users.name },
};

const CF = schema.customFields;

/** Definisi field kustom suatu model yang berlaku di perusahaan (null = perusahaan aktif). */
export async function loadCustomDefs(
  tx: Db,
  model: CustomFieldModel,
  opts: { companyId?: string | null; activeOnly?: boolean } = {},
): Promise<(CustomFieldDef & { id: string; companyId: string | null })[]> {
  const companyId = opts.companyId === undefined ? currentContext().companyId : opts.companyId;
  const rows = await tx
    .select()
    .from(CF)
    .where(
      and(
        eq(CF.model, model),
        companyId ? or(isNull(CF.companyId), eq(CF.companyId, companyId)) : undefined,
        opts.activeOnly ? eq(CF.active, true) : undefined,
      ),
    )
    .orderBy(asc(CF.sequence), asc(CF.label));
  return rows as (CustomFieldDef & { id: string; companyId: string | null })[];
}

/**
 * Validasi nilai kiriman lalu gabungkan dengan nilai tersimpan. Galat dilempar sebagai 400 dengan path
 * `custom.<kunci>` (atau `<prefix>.custom.<kunci>`).
 */
export async function normalizeCustom(
  tx: Db,
  model: CustomFieldModel,
  input: unknown,
  existing: Record<string, unknown> | null | undefined,
  companyId?: string | null,
  prefix = "",
): Promise<Record<string, unknown>> {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input)))
    throw new BadRequestException({
      message: "Validasi gagal",
      errors: [{ path: `${prefix}custom`, message: "Format field kustom tidak valid" }],
    });
  const defs = await loadCustomDefs(tx, model, { companyId });
  // Tanpa kiriman field kustom (dokumen dibuat sistem/integrasi) → hanya nilai bawaan, wajib tidak dipaksa.
  const r = coerceCustomValues(defs, input as Record<string, unknown> | undefined, existing ?? null, {
    skipRequired: input === undefined || input === null,
  });
  const errors = Object.entries(r.errors).map(([k, message]) => ({ path: `${prefix}custom.${k}`, message }));
  for (const ref of r.refs) {
    const t = REF_TABLES[ref.model];
    const [found] = await tx.select({ id: t.id }).from(t.table).where(eq(t.id, ref.id));
    if (!found) errors.push({ path: `${prefix}custom.${ref.key}`, message: "Data rujukan tidak ditemukan" });
  }
  if (errors.length) throw new BadRequestException({ message: "Validasi gagal", errors });
  return r.values;
}

/** Nama data yang dirujuk field kustom bertipe rujukan, untuk ekspor & PDF. */
export async function customRefNames(
  tx: Db,
  defs: CustomFieldDef[],
  rows: { custom?: unknown }[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const model of Object.keys(REF_TABLES) as CustomRefModel[]) {
    const keys = defs.filter((d) => d.fieldType === "ref" && d.refModel === model).map((d) => d.key);
    if (!keys.length) continue;
    const ids = [
      ...new Set(
        rows.flatMap((r) =>
          keys
            .map((k) => (r.custom as Record<string, unknown> | undefined)?.[k])
            .filter((v): v is string => typeof v === "string"),
        ),
      ),
    ];
    if (!ids.length) continue;
    const t = REF_TABLES[model];
    for (const r of await tx.select({ id: t.id, name: t.name }).from(t.table).where(inArray(t.id, ids)))
      out[r.id as string] = r.name as string;
  }
  return out;
}

/** Tambahkan kolom `custom.<kunci>` (teks tampilan) ke baris untuk ekspor. */
export function withCustomColumns<R extends { custom?: unknown }>(
  defs: CustomFieldDef[],
  rows: R[],
  refNames: Record<string, string>,
): (R & Record<string, unknown>)[] {
  return rows.map((r) => {
    const custom = (r.custom ?? {}) as Record<string, unknown>;
    const extra = Object.fromEntries(
      defs.map((d) => [customColumnName(d.key), formatCustomValue(d, custom[d.key], { refNames })]),
    );
    return { ...r, ...extra };
  });
}

/** Ambil nilai field kustom dari baris impor (kolom `custom.<kunci>` yang ada di berkas). */
export function customFromImportRow(defs: CustomFieldDef[], raw: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const col = customColumnName(d.key);
    if (col in raw) out[d.key] = d.fieldType === "ref" ? raw[col]?.trim() || null : raw[col];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Apakah sudah ada data yang mengisi kunci ini (untuk mencegah ganti tipe). */
export async function customKeyUsed(tx: Db, model: CustomFieldModel, key: string) {
  const t = CUSTOM_TABLES[model];
  const [row] = await tx
    .select({ id: t.id })
    .from(t)
    .where(sql`${t.custom} ? ${key}`)
    .limit(1);
  return !!row;
}

/** Baris "label: nilai" field kustom bertanda tampil di PDF. */
export async function customPdfRows(
  tx: Db,
  model: CustomFieldModel,
  custom: Record<string, unknown> | null | undefined,
  companyId: string,
) {
  const defs = (await loadCustomDefs(tx, model, { companyId, activeOnly: true })).filter((d) => d.showOnPdf);
  if (!defs.length) return [];
  const refNames = await customRefNames(tx, defs, [{ custom }]);
  return defs
    .map((d) => ({ label: d.label, value: formatCustomValue(d, custom?.[d.key], { refNames }) }))
    .filter((r) => r.value);
}
