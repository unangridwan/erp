import { inArray, schema, type Db } from "@erp/db";

/**
 * Cost center karyawan: isian di karyawan, atau cost center departemennya (naik ke departemen induk bila
 * departemen itu belum punya). Dipakai jurnal payroll, klaim biaya, dan pesangon.
 */
export async function employeeCostCenters(
  tx: Db,
  employeeIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(employeeIds)];
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  const employees = await tx
    .select({
      id: schema.employees.id,
      companyId: schema.employees.companyId,
      costCenterId: schema.employees.costCenterId,
      departmentId: schema.employees.departmentId,
    })
    .from(schema.employees)
    .where(inArray(schema.employees.id, ids));
  const companies = [...new Set(employees.map((e) => e.companyId))];
  const departments = companies.length
    ? await tx
        .select({
          id: schema.departments.id,
          parentId: schema.departments.parentId,
          costCenterId: schema.departments.costCenterId,
        })
        .from(schema.departments)
        .where(inArray(schema.departments.companyId, companies))
    : [];
  const byId = new Map(departments.map((d) => [d.id, d]));
  const fromDepartment = (id: string | null) => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const dep = byId.get(id);
      if (!dep) return null;
      if (dep.costCenterId) return dep.costCenterId;
      id = dep.parentId;
    }
    return null;
  };
  for (const e of employees) out.set(e.id, e.costCenterId ?? fromDepartment(e.departmentId));
  return out;
}
