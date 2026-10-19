import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, lte, schema, type Db } from "@erp/db";
import { lateness, type WorkSchedule } from "@erp/shared";
import { currentContext } from "../common/request-context.js";
import { holidaysBetween } from "./leave.service.js";

type Schedule = typeof schema.workSchedules.$inferSelect;

const toRule = (s: Schedule): WorkSchedule => ({
  start: s.startTime,
  toleranceMinutes: s.toleranceMinutes,
  penaltyPerMinute: s.penaltyPerMinute,
  penaltyPerOccurrence: s.penaltyPerOccurrence,
  workDays: s.workDays,
});

/** Tanggal lokal (zona waktu perusahaan) sebuah instan. */
export const localDate = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    at,
  );

/**
 * Jadwal kerja & keterlambatan: jadwal per tanggal = penugasan shift yang mencakup tanggal itu, atau jadwal bawaan
 * karyawan. Keterlambatan dihitung dari absen masuk pertama per hari kerja jadwal (hari libur dikecualikan).
 */
@Injectable()
export class ScheduleService {
  async timezone(tx: Db, companyId: string) {
    const [s] = await tx
      .select({ tz: schema.payrollSettings.timezone })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    return s?.tz ?? "Asia/Jakarta";
  }

  /** Keterlambatan per karyawan dalam rentang tanggal (YYYY-MM-DD, inklusif). */
  async lateness(tx: Db, input: { from: string; to: string; employeeIds?: string[]; companyId?: string }) {
    const companyId = input.companyId ?? currentContext().companyId;
    const tz = await this.timezone(tx, companyId);
    const employees = await tx
      .select()
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.companyId, companyId),
          input.employeeIds ? inArray(schema.employees.id, input.employeeIds) : undefined,
        ),
      );
    if (!employees.length) return [];
    const ids = employees.map((e) => e.id);
    const schedules = await tx
      .select()
      .from(schema.workSchedules)
      .where(eq(schema.workSchedules.companyId, companyId));
    const assignments = await tx
      .select()
      .from(schema.shiftAssignments)
      .where(
        and(
          inArray(schema.shiftAssignments.employeeId, ids),
          lte(schema.shiftAssignments.dateFrom, input.to),
          gte(schema.shiftAssignments.dateTo, input.from),
        ),
      );
    // Rentang instan diperlebar sehari agar absen dini hari waktu lokal ikut terbaca, lalu disaring per tanggal lokal.
    const start = new Date(`${input.from}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(`${input.to}T23:59:59Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const attendances = await tx
      .select({ employeeId: schema.attendances.employeeId, checkIn: schema.attendances.checkIn })
      .from(schema.attendances)
      .where(
        and(
          inArray(schema.attendances.employeeId, ids),
          gte(schema.attendances.checkIn, start),
          lte(schema.attendances.checkIn, end),
        ),
      );
    const holidays = await holidaysBetween(tx, input.from, input.to);
    const byId = new Map(schedules.map((s) => [s.id, s]));
    return employees.flatMap((e) => {
      const rows = attendances
        .filter((a) => a.employeeId === e.id)
        .map((a) => {
          const date = localDate(a.checkIn, tz);
          const assignment = assignments.find(
            (s) => s.employeeId === e.id && s.dateFrom <= date && s.dateTo >= date,
          );
          const schedule = byId.get(assignment?.scheduleId ?? e.scheduleId ?? "");
          return { date, checkIn: a.checkIn, schedule };
        })
        .filter((a) => a.date >= input.from && a.date <= input.to && a.schedule?.active);
      if (!rows.length) return [];
      const result = lateness(
        rows.map((r) => ({ checkIn: r.checkIn, schedule: toRule(r.schedule!) })),
        tz,
        holidays,
      );
      return [{ employeeId: e.id, employeeName: e.name, employeeNumber: e.employeeNumber, ...result }];
    });
  }
}
