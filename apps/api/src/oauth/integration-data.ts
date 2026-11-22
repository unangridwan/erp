import { BadRequestException } from "@nestjs/common";
import { and, asc, eq, gte, inArray, schema, sql, type Db, type PgColumn, type SQL } from "@erp/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const E = schema.employees;
const D = schema.departments;

/** Data karyawan untuk aplikasi terhubung (webhook & sinkron): tanpa data sensitif (NIK, rekening, gaji). */
const employeeColumns = {
  id: E.id,
  employeeNumber: E.employeeNumber,
  name: E.name,
  companyId: E.companyId,
  companyName: schema.companies.name,
  departmentId: E.departmentId,
  department: D.name,
  jobId: E.jobId,
  jobTitle: schema.jobPositions.name,
  managerId: E.managerId,
  userId: E.userId,
  workEmail: E.workEmail,
  workPhone: E.workPhone,
  personalPhone: E.personalPhone,
  tags: E.tags,
  joinDate: E.joinDate,
  resignDate: E.resignDate,
  active: E.active,
  updatedAt: E.updatedAt,
};

const departmentColumns = {
  id: D.id,
  companyId: D.companyId,
  name: D.name,
  parentId: D.parentId,
  managerId: D.managerId,
  active: D.active,
  updatedAt: D.updatedAt,
};

function employeeQuery(tx: Db, where: SQL | undefined) {
  return tx
    .select(employeeColumns)
    .from(E)
    .innerJoin(schema.companies, eq(schema.companies.id, E.companyId))
    .leftJoin(D, eq(D.id, E.departmentId))
    .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
    .where(where);
}

export async function employeeRecord(tx: Db, id: string) {
  const [row] = await employeeQuery(tx, eq(E.id, id));
  return row;
}

export async function departmentRecord(tx: Db, id: string) {
  const [row] = await tx.select(departmentColumns).from(D).where(eq(D.id, id));
  return row;
}

export interface PageQuery {
  updatedSince?: string;
  cursor?: string;
  limit?: string;
  companyIds: string[];
}

/** Keyset (updated_at, id): urutan stabil walau data berubah selama sinkron. */
function page(q: PageQuery) {
  const limit = Math.min(Math.max(Number(q.limit ?? 200) || 200, 1), 1000);
  let since: Date | undefined;
  if (q.updatedSince) {
    since = new Date(q.updatedSince);
    if (Number.isNaN(since.getTime())) throw new BadRequestException("updatedSince harus tanggal ISO 8601");
  }
  let after: { at: Date; id: string } | undefined;
  if (q.cursor) {
    const [at, id] = Buffer.from(q.cursor, "base64url").toString("utf8").split("|");
    const date = new Date(at ?? "");
    if (!id || !UUID.test(id) || Number.isNaN(date.getTime()))
      throw new BadRequestException("cursor tidak valid");
    after = { at: date, id };
  }
  return { limit, since, after };
}

/** Dibulatkan ke milidetik agar sama persis dengan nilai Date di kursor. */
const ms = (col: PgColumn) => sql`date_trunc('milliseconds', ${col})`;
const afterCursor = (updatedAt: PgColumn, id: PgColumn, after: { at: Date; id: string }) =>
  sql`(${ms(updatedAt)}, ${id}) > (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`;

const cursorOf = (row: { updatedAt: Date; id: string }) =>
  Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString("base64url");

export async function employeePage(tx: Db, q: PageQuery) {
  const { limit, since, after } = page(q);
  const rows = await employeeQuery(
    tx,
    and(
      inArray(E.companyId, q.companyIds),
      since ? gte(E.updatedAt, since) : undefined,
      after ? afterCursor(E.updatedAt, E.id, after) : undefined,
    ),
  )
    .orderBy(asc(ms(E.updatedAt)), asc(E.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? cursorOf(items.at(-1)!) : null };
}

export async function departmentPage(tx: Db, q: PageQuery) {
  const { limit, since, after } = page(q);
  const rows = await tx
    .select(departmentColumns)
    .from(D)
    .where(
      and(
        inArray(D.companyId, q.companyIds),
        since ? gte(D.updatedAt, since) : undefined,
        after ? afterCursor(D.updatedAt, D.id, after) : undefined,
      ),
    )
    .orderBy(asc(ms(D.updatedAt)), asc(D.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? cursorOf(items.at(-1)!) : null };
}
