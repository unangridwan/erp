import { schema, type Db } from "@erp/db";
import { ALL_PERMISSIONS, PERMISSIONS } from "@erp/shared";
import { installChart } from "../accounting/chart-template.js";

/** Satuan bawaan per kategori: [nama, faktor terhadap satuan referensi]. Referensi = entri pertama. */
const DEFAULT_UOMS: Record<string, [string, number][]> = {
  Unit: [
    ["Pcs", 1],
    ["Lusin", 12],
    ["Kodi", 20],
    ["Gross", 144],
  ],
  Berat: [
    ["kg", 1],
    ["g", 0.001],
    ["ton", 1000],
  ],
  Volume: [
    ["L", 1],
    ["mL", 0.001],
  ],
  Panjang: [
    ["m", 1],
    ["cm", 0.01],
  ],
  Waktu: [
    ["Jam", 1],
    ["Hari", 8],
  ],
};

export interface SeedResult {
  companyId: string;
  adminRoleId: string;
  userRoleId: string;
}

/** Data awal untuk tenant baru. Dijalankan dalam transaksi yang sudah memiliki konteks tenant. */
export async function seedTenant(tx: Db, companyName: string): Promise<SeedResult> {
  const [company] = await tx
    .insert(schema.companies)
    .values({ code: "HQ", name: companyName, entityType: "holding" })
    .returning({ id: schema.companies.id });
  await tx.insert(schema.partners).values({
    name: companyName,
    kind: "company",
    isCustomer: true,
    isSupplier: true,
    icCompanyId: company!.id,
  });

  const [adminRole, userRole] = await tx
    .insert(schema.roles)
    .values([
      { code: "admin", name: "Administrator" },
      { code: "user", name: "Pengguna" },
    ])
    .returning({ id: schema.roles.id });

  await tx.insert(schema.rolePermissions).values([
    { roleId: adminRole!.id, permission: ALL_PERMISSIONS },
    ...PERMISSIONS.filter((p) => p.endsWith(".read")).map((permission) => ({
      roleId: userRole!.id,
      permission,
    })),
  ]);

  for (const [categoryName, units] of Object.entries(DEFAULT_UOMS)) {
    const [category] = await tx
      .insert(schema.uomCategories)
      .values({ name: categoryName })
      .returning({ id: schema.uomCategories.id });
    await tx.insert(schema.uoms).values(
      units.map(([name, factor], i) => ({
        categoryId: category!.id,
        name,
        factor: String(factor),
        isReference: i === 0,
      })),
    );
  }

  await installChart(tx, company!.id);

  return { companyId: company!.id, adminRoleId: adminRole!.id, userRoleId: userRole!.id };
}
