import { Injectable } from "@nestjs/common";
import { asc, desc, eq, schema, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";
import { businessToday } from "@erp/shared";

type Employee = typeof schema.employees.$inferSelect;
type Kind = (typeof schema.EMPLOYEE_HISTORY_KINDS)[number];
type Table = "departments" | "jobPositions" | "branches" | "employees" | "salaryGrades";

const today = () => businessToday();

/** Riwayat karir karyawan: masuk, mutasi departemen/cabang, ganti jabatan/atasan, perubahan upah, keluar. */
@Injectable()
export class HistoryService {
  async record(
    tx: Db,
    employee: Pick<Employee, "id" | "companyId">,
    kind: Kind,
    values: { date?: string; oldValue?: string | null; newValue?: string | null; note?: string | null },
  ) {
    await tx.insert(schema.employeeHistory).values({
      companyId: employee.companyId,
      employeeId: employee.id,
      date: values.date ?? today(),
      kind,
      oldValue: values.oldValue ?? null,
      newValue: values.newValue ?? null,
      note: values.note ?? null,
      createdBy: currentContext().userId,
    });
  }

  /** Catat perubahan struktur (departemen, jabatan, cabang, atasan, golongan) & tanggal keluar antara dua versi data. */
  async diff(tx: Db, before: Employee, after: Employee) {
    const name = async (table: Table, id: string | null) => {
      if (!id) return null;
      const t = schema[table];
      const [row] = await tx.select({ name: t.name }).from(t).where(eq(t.id, id));
      return row?.name ?? null;
    };
    const fields: [keyof Employee, Kind, Table][] = [
      ["departmentId", "department", "departments"],
      ["jobId", "job", "jobPositions"],
      ["branchId", "branch", "branches"],
      ["managerId", "manager", "employees"],
      ["gradeId", "grade", "salaryGrades"],
    ];
    for (const [field, kind, table] of fields) {
      if (before[field] === after[field]) continue;
      await this.record(tx, after, kind, {
        oldValue: await name(table, before[field] as string | null),
        newValue: await name(table, after[field] as string | null),
      });
    }
    if (after.resignDate && after.resignDate !== before.resignDate)
      await this.record(tx, after, "resign", { date: after.resignDate, newValue: after.resignDate });
  }

  list(tx: Db, employeeId: string) {
    return tx
      .select({ history: schema.employeeHistory, userName: schema.users.name })
      .from(schema.employeeHistory)
      .leftJoin(schema.users, eq(schema.users.id, schema.employeeHistory.createdBy))
      .where(eq(schema.employeeHistory.employeeId, employeeId))
      .orderBy(desc(schema.employeeHistory.date), asc(schema.employeeHistory.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.history, userName: r.userName })));
  }
}
