import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, lte, schema, type Db } from "@erp/db";
import { lateness, type WorkSchedule } from "@erp/shared";
import { currentContext } from "../common/request-context.js";
import { holidaysBetween, WorkCalendarService } from "./work-calendar.service.js";

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
  constructor(@Inject(WorkCalendarService) private readonly calendar: WorkCalendarService) {}

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
    const resolve = await this.calendar.resolver(tx, companyId, ids, input.from, input.to);
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
          // Hanya absensi tervalidasi yang dibaca payroll (validasi bisa diaktifkan di Pengaturan Payroll).
          eq(schema.attendances.state, "validated"),
          gte(schema.attendances.checkIn, start),
          lte(schema.attendances.checkIn, end),
        ),
      );
    const holidays = await holidaysBetween(tx, companyId, input.from, input.to);
    return employees.flatMap((e) => {
      const rows = attendances
        .filter((a) => a.employeeId === e.id)
        .map((a) => {
          const date = localDate(a.checkIn, tz);
          return { date, checkIn: a.checkIn, schedule: resolve(e, date) };
        })
        .filter((a) => a.date >= input.from && a.date <= input.to && a.schedule);
      if (!rows.length) return [];
      const result = lateness(
        rows.map((r) => ({ checkIn: r.checkIn, schedule: toRule(r.schedule!) })),
        tz,
        holidays,
      );
      return [{ employeeId: e.id, employeeName: e.name, employeeNumber: e.employeeNumber, ...result }];
    });
  }

  /**
   * Ketepatan kehadiran per karyawan per hari kerja yang ada absen masuknya (absensi tervalidasi, hari kerja jadwal,
   * bukan hari libur): terlambat bila masuk lewat jam masuk + toleransi — aturan yang sama dengan potongan
   * keterlambatan payroll.
   */
  async punctuality(tx: Db, input: { from: string; to: string; companyId?: string }) {
    const companyId = input.companyId ?? currentContext().companyId;
    const tz = await this.timezone(tx, companyId);
    const employees = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.companyId, companyId));
    if (!employees.length) return [];
    const ids = employees.map((e) => e.id);
    const resolve = await this.calendar.resolver(tx, companyId, ids, input.from, input.to);
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
          eq(schema.attendances.state, "validated"),
          gte(schema.attendances.checkIn, start),
          lte(schema.attendances.checkIn, end),
        ),
      );
    const holidays = await holidaysBetween(tx, companyId, input.from, input.to);
    const off = new Set(holidays);
    const byEmployee = new Map<string, typeof attendances>();
    for (const a of attendances) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);
    return employees.flatMap((e) => {
      const rows = (byEmployee.get(e.id) ?? [])
        .map((a) => {
          const date = localDate(a.checkIn, tz);
          return { date, checkIn: a.checkIn, schedule: resolve(e, date) };
        })
        .filter((a) => a.date >= input.from && a.date <= input.to && a.schedule);
      if (!rows.length) return [];
      const late = new Map(
        lateness(
          rows.map((r) => ({ checkIn: r.checkIn, schedule: toRule(r.schedule!) })),
          tz,
          holidays,
        ).days.map((d) => [d.date, d.minutes]),
      );
      const days = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!days.has(r.date)) days.set(r.date, r);
      return [...days.values()]
        .filter((r) => {
          const weekday = new Date(`${r.date}T00:00:00Z`).getUTCDay();
          return !off.has(r.date) && toRule(r.schedule!).workDays.includes(weekday);
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({
          employeeId: e.id,
          employeeName: e.name,
          employeeNumber: e.employeeNumber,
          userId: e.userId,
          departmentId: e.departmentId,
          date: r.date,
          lateMinutes: late.get(r.date) ?? 0,
          onTime: !late.has(r.date),
        }));
    });
  }
}
