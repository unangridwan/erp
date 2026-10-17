import { BadRequestException } from "@nestjs/common";
import { and, eq, schema, type Db } from "@erp/db";

type Usage = (typeof schema.LOCATION_USAGES)[number];

/** Lokasi virtual lawan transaksi (pemasok, pelanggan, penyesuaian) — satu per perusahaan. */
export async function virtualLocation(
  tx: Db,
  companyId: string,
  usage: "supplier" | "customer" | "inventory",
) {
  const [loc] = await tx
    .select()
    .from(schema.stockLocations)
    .where(and(eq(schema.stockLocations.companyId, companyId), eq(schema.stockLocations.usage, usage)));
  if (!loc) throw new BadRequestException("Lokasi persediaan perusahaan belum disiapkan");
  return loc;
}

async function location(
  tx: Db,
  companyId: string,
  name: string,
  usage: Usage,
  parent?: { id: string; completeName: string },
  warehouseId?: string,
) {
  const [row] = await tx
    .insert(schema.stockLocations)
    .values({
      companyId,
      parentId: parent?.id ?? null,
      name,
      completeName: parent ? `${parent.completeName}/${name}` : name,
      usage,
      warehouseId: warehouseId ?? null,
    })
    .returning();
  return row!;
}

/** Gudang baru beserta lokasi induk (view) dan lokasi stok utamanya. */
export async function createWarehouse(
  tx: Db,
  companyId: string,
  input: { code: string; name: string; branchId?: string | null },
) {
  const view = await location(tx, companyId, input.code, "view");
  const stock = await location(tx, companyId, "Stok", "internal", view);
  const [warehouse] = await tx
    .insert(schema.warehouses)
    .values({
      companyId,
      code: input.code,
      name: input.name,
      branchId: input.branchId ?? null,
      viewLocationId: view.id,
      lotStockId: stock.id,
    })
    .returning();
  await tx
    .update(schema.stockLocations)
    .set({ warehouseId: warehouse!.id })
    .where(eq(schema.stockLocations.id, view.id));
  await tx
    .update(schema.stockLocations)
    .set({ warehouseId: warehouse!.id })
    .where(eq(schema.stockLocations.id, stock.id));
  return warehouse!;
}

/** Siapkan lokasi virtual dan gudang utama untuk perusahaan baru. Idempoten. */
export async function installInventory(tx: Db, companyId: string) {
  const [existing] = await tx
    .select({ id: schema.stockLocations.id })
    .from(schema.stockLocations)
    .where(and(eq(schema.stockLocations.companyId, companyId), eq(schema.stockLocations.usage, "supplier")));
  if (existing) return;
  const partner = await location(tx, companyId, "Partner", "view");
  const virtual = await location(tx, companyId, "Virtual", "view");
  await location(tx, companyId, "Pemasok", "supplier", partner);
  await location(tx, companyId, "Pelanggan", "customer", partner);
  await location(tx, companyId, "Penyesuaian Persediaan", "inventory", virtual);
  await createWarehouse(tx, companyId, { code: "WH", name: "Gudang Utama" });
}
