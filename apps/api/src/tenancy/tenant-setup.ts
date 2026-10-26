import { schema, type Db } from "@erp/db";
import { ALL_PERMISSIONS, PERMISSIONS } from "@erp/shared";
import { installChart } from "../accounting/chart-template.js";
import { installInventory } from "../inventory/setup.js";
import { DEFAULT_LEAVE_TYPES, installPayroll } from "../payroll/setup.js";

/** Satuan bawaan per kategori: [nama, faktor terhadap satuan referensi, kode satuan Coretax]. Referensi = entri pertama. */
const DEFAULT_UOMS: Record<string, [string, number, string | null][]> = {
  Unit: [
    ["Pcs", 1, "UM.0021"],
    ["Lusin", 12, "UM.0017"],
    ["Kodi", 20, null],
    ["Gross", 144, null],
  ],
  Berat: [
    ["kg", 1, "UM.0003"],
    ["g", 0.001, "UM.0004"],
    ["ton", 1000, "UM.0001"],
  ],
  Volume: [
    ["L", 1, "UM.0007"],
    ["mL", 0.001, null],
  ],
  Panjang: [
    ["m", 1, "UM.0013"],
    ["cm", 0.01, "UM.0015"],
  ],
  Waktu: [
    ["Jam", 1, "UM.0027"],
    ["Hari", 8, "UM.0026"],
  ],
};

/** Tahapan pipeline CRM bawaan: [nama, probabilitas %, menang]. */
const DEFAULT_STAGES: [string, number, boolean][] = [
  ["Baru", 10, false],
  ["Kualifikasi", 30, false],
  ["Proposal", 60, false],
  ["Negosiasi", 80, false],
  ["Menang", 100, true],
];
const DEFAULT_LOST_REASONS = [
  "Harga terlalu tinggi",
  "Memilih pesaing",
  "Tidak ada anggaran",
  "Tidak ada respons",
];
const DEFAULT_PAYMENT_TERMS: [string, number][] = [
  ["Tunai", 0],
  ["Net 14 hari", 14],
  ["Net 30 hari", 30],
  ["Net 60 hari", 60],
];

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
      units.map(([name, factor, coretaxCode], i) => ({
        categoryId: category!.id,
        name,
        factor: String(factor),
        isReference: i === 0,
        coretaxCode,
      })),
    );
  }

  await installChart(tx, company!.id);
  await installInventory(tx, company!.id);
  await installPayroll(tx, company!.id);
  await tx.insert(schema.leaveTypes).values(
    DEFAULT_LEAVE_TYPES.map(([name, paid, requiresAllocation, rules]) => ({
      name,
      paid,
      requiresAllocation,
      ...rules,
    })),
  );

  await tx.insert(schema.crmStages).values(
    DEFAULT_STAGES.map(([name, probability, isWon], i) => ({
      name,
      sequence: (i + 1) * 10,
      probability: String(probability),
      isWon,
    })),
  );
  await tx.insert(schema.crmLostReasons).values(DEFAULT_LOST_REASONS.map((name) => ({ name })));
  await tx.insert(schema.paymentTerms).values(DEFAULT_PAYMENT_TERMS.map(([name, days]) => ({ name, days })));

  return { companyId: company!.id, adminRoleId: adminRole!.id, userRoleId: userRole!.id };
}
