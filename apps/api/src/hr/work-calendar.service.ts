import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNull, lte, or, schema, type Db } from "@erp/db";
import { DEFAULT_WORK_DAYS, eachDate, weekdayOf, type HolidayKind } from "@erp/shared";

type Schedule = typeof schema.workSchedules.$inferSelect;
type EmployeeRef = { id: string; scheduleId: string | null };

/** Hari libur perusahaan dalam rentang: libur khusus perusahaan + libur yang berlaku untuk semua perusahaan. */
export async function holidayRows(tx: Db, companyId: string, from: string, to: string) {
  const H = schema.publicHolidays;
  return tx
    .select({ date: H.date, name: H.name, kind: H.kind, companyId: H.companyId })
    .from(H)
    .where(and(gte(H.date, from), lte(H.date, to), or(isNull(H.companyId), eq(H.companyId, companyId))))
    .orderBy(H.date);
}

/** Tanggal libur perusahaan dalam rentang (YYYY-MM-DD). */
export async function holidaysBetween(tx: Db, companyId: string, from: string, to: string) {
  return [...new Set((await holidayRows(tx, companyId, from, to)).map((r) => r.date))];
}

export interface WorkCalendar {
  /** Tanggal libur perusahaan dalam rentang yang dimuat. */
  holidays: ReadonlyMap<string, { name: string; kind: HolidayKind }>;
  /** Hari kerja jadwal yang berlaku bagi karyawan pada tanggal itu (bawaan Senin–Jumat). */
  workDaysOf(employee: EmployeeRef, date: string): readonly number[];
  isWorkday(employee: EmployeeRef, date: string): boolean;
  workingDays(employee: EmployeeRef, from: string, to: string): number;
}

/**
 * Satu sumber kebenaran hari kerja: jadwal per karyawan × tanggal (penugasan shift terbaru yang mencakup tanggal,
 * lalu jadwal bawaan karyawan) dan hari libur per perusahaan. Dipakai cuti, payroll, absensi, keterlambatan.
 */
@Injectable()
export class WorkCalendarService {
  /** Jadwal aktif per karyawan × tanggal, atau null bila tidak ada. */
  async resolver(tx: Db, companyId: string, employeeIds: string[], from: string, to: string) {
    const schedules = await tx
      .select()
      .from(schema.workSchedules)
      .where(eq(schema.workSchedules.companyId, companyId));
    const assignments = employeeIds.length
      ? await tx
          .select()
          .from(schema.shiftAssignments)
          .where(
            and(
              inArray(schema.shiftAssignments.employeeId, employeeIds),
              lte(schema.shiftAssignments.dateFrom, to),
              gte(schema.shiftAssignments.dateTo, from),
            ),
          )
      : [];
    const byId = new Map(schedules.map((s) => [s.id, s]));
    return (employee: EmployeeRef, date: string): Schedule | null => {
      const assignment = assignments
        .filter((a) => a.employeeId === employee.id && a.dateFrom <= date && a.dateTo >= date)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const schedule = byId.get(assignment?.scheduleId ?? employee.scheduleId ?? "");
      return schedule?.active ? schedule : null;
    };
  }

  async load(
    tx: Db,
    companyId: string,
    employees: EmployeeRef[],
    from: string,
    to: string,
  ): Promise<WorkCalendar> {
    const resolve = await this.resolver(
      tx,
      companyId,
      employees.map((e) => e.id),
      from,
      to,
    );
    const holidays = new Map<string, { name: string; kind: HolidayKind }>();
    // Libur khusus perusahaan didahulukan (namanya yang ditampilkan) daripada libur bersama.
    for (const r of (await holidayRows(tx, companyId, from, to)).sort(
      (a, b) => Number(!!b.companyId) - Number(!!a.companyId),
    ))
      if (!holidays.has(r.date)) holidays.set(r.date, { name: r.name, kind: r.kind });
    const workDaysOf = (employee: EmployeeRef, date: string) =>
      (resolve(employee, date)?.workDays ?? DEFAULT_WORK_DAYS) as readonly number[];
    const isWorkday = (employee: EmployeeRef, date: string) =>
      !holidays.has(date) && workDaysOf(employee, date).includes(weekdayOf(date));
    return {
      holidays,
      workDaysOf,
      isWorkday,
      workingDays: (employee, a, b) =>
        a > b ? 0 : eachDate(a, b).filter((d) => isWorkday(employee, d)).length,
    };
  }
}
