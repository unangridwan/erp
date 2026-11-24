import { allowedFor, effectivePermissions, type AccessGrants } from "@erp/shared";
import { and, eq, ilike, inArray, or, schema, sql, type Db } from "@erp/db";

/**
 * Pengguna aktif (manusia) di perusahaan yang punya hak baca tertentu, untuk saran @mention & validasi penerima.
 * Akses perusahaan: terdaftar di perusahaan itu, atau admin penuh tanpa batas perusahaan.
 */
export async function companyReaders(
  tx: Db,
  companyId: string,
  /** null = cukup terdaftar di perusahaan (tanpa syarat hak). */
  required: string | null,
  opts: { ids?: string[]; q?: string; limit?: number } = {},
): Promise<{ id: string; name: string; email: string; department: string | null }[]> {
  const U = schema.users;
  const UC = schema.userCompanies;
  const UR = schema.userRoles;
  const RP = schema.rolePermissions;
  if (opts.ids && !opts.ids.length) return [];
  const candidates = await tx
    .selectDistinct({ id: U.id, name: U.name, email: U.email })
    .from(U)
    .leftJoin(UC, and(eq(UC.userId, U.id), eq(UC.companyId, companyId)))
    .where(
      and(
        eq(U.active, true),
        eq(U.kind, "human"),
        opts.ids ? inArray(U.id, opts.ids) : undefined,
        opts.q ? or(ilike(U.name, `%${opts.q}%`), ilike(U.email, `%${opts.q}%`)) : undefined,
        or(
          sql`${UC.userId} is not null`,
          sql`exists (select 1 from ${UR} join ${RP} on ${RP.roleId} = ${UR.roleId}
            where ${UR.userId} = ${U.id} and ${UR.companyId} is null and ${RP.permission} = '*')`,
        ),
      ),
    )
    .orderBy(U.name)
    .limit(opts.ids ? opts.ids.length : 200);
  if (!candidates.length) return [];
  const ids = candidates.map((c) => c.id);
  const roles = await tx
    .select({ assignment: UR.id, userId: UR.userId, companyId: UR.companyId, permission: RP.permission })
    .from(UR)
    .leftJoin(RP, eq(RP.roleId, UR.roleId))
    .where(inArray(UR.userId, ids));
  const O = schema.userPermissionOverrides;
  const overrides = await tx
    .select({ userId: O.userId, permission: O.permission, effect: O.effect, companyId: O.companyId })
    .from(O)
    .where(inArray(O.userId, ids));
  const grants = new Map<
    string,
    AccessGrants & { byAssignment: Map<string, AccessGrants["roles"][number]> }
  >();
  const grant = (userId: string) => {
    let g = grants.get(userId);
    if (!g) grants.set(userId, (g = { roles: [], overrides: [], byAssignment: new Map() }));
    return g;
  };
  for (const r of roles) {
    const g = grant(r.userId);
    let a = g.byAssignment.get(r.assignment);
    if (!a) {
      a = { companyId: r.companyId, permissions: [] };
      g.byAssignment.set(r.assignment, a);
      g.roles.push(a);
    }
    if (r.permission) (a.permissions as string[]).push(r.permission);
  }
  for (const o of overrides) grant(o.userId).overrides.push(o);
  const readers = candidates.filter((c) => {
    const g = grants.get(c.id);
    if (!g) return required === null;
    return (
      required === null ||
      allowedFor(effectivePermissions(g, companyId), required, { path: "/", method: "GET" })
    );
  });
  if (!readers.length) return [];
  const E = schema.employees;
  const D = schema.departments;
  const deps = await tx
    .select({ userId: E.userId, department: D.name })
    .from(E)
    .leftJoin(D, eq(D.id, E.departmentId))
    .where(
      and(
        inArray(
          E.userId,
          readers.map((r) => r.id),
        ),
        eq(E.companyId, companyId),
      ),
    );
  const depOf = new Map(deps.map((d) => [d.userId, d.department]));
  return readers
    .slice(0, opts.limit ?? readers.length)
    .map((r) => ({ ...r, department: depOf.get(r.id) ?? null }));
}
