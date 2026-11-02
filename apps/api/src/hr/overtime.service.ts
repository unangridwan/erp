import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, schema, sql, type Db } from "@erp/db";
import { addDays, localTime, overtimeFromAttendance, type OvertimeRules } from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { beginApproval } from "./approval.service.js";
import { localDate } from "./schedule.service.js";
import { WorkCalendarService } from "./work-calendar.service.js";

const O = schema.overtimes;
const AT = schema.attendances;

/**
 * Lembur otomatis dari absensi: jam lembur dihitung dari absen pulang (dan masuk lebih awal bila diatur) terhadap
 * jadwal kerja hari itu, hari istirahat/libur dihitung seluruhnya. Lembur hasil hitung selalu menunggu keputusan
 * atasan (minimal satu tahap), yang boleh mengurangi jamnya sebelum menyetujui.
 */
@Injectable()
export class OvertimeService {
  constructor(
    @Inject(WorkCalendarService) private readonly calendar: WorkCalendarService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  private async settings(tx: Db, companyId: string) {
    const S = schema.payrollSettings;
    const [s] = await tx
      .select({
        enabled: S.overtimeFromAttendance,
        tz: S.timezone,
        lockDate: S.attendanceLockDate,
        levels: S.overtimeApprovalLevels,
        minMinutes: S.overtimeMinMinutes,
        roundMinutes: S.overtimeRoundMinutes,
        maxHours: S.overtimeMaxHours,
        countEarly: S.overtimeCountEarly,
      })
      .from(S)
      .where(eq(S.companyId, companyId));
    const rules: OvertimeRules = {
      minMinutes: s?.minMinutes ?? 30,
      roundMinutes: s?.roundMinutes ?? 30,
      maxWorkdayHours: s?.maxHours ?? 4,
      countEarly: s?.countEarly ?? false,
    };
    return {
      enabled: s?.enabled ?? false,
      tz: s?.tz ?? "Asia/Jakarta",
      lockDate: s?.lockDate ?? null,
      levels: s?.levels ?? 0,
      rules,
    };
  }

  /**
   * Buat/perbarui lembur dari absensi yang sudah absen pulang dalam rentang tanggal lokal. Lembur yang belum
   * diputuskan siapa pun ikut diperbarui bila absensinya berubah (dihapus bila tidak lagi lembur); yang sudah
   * diputuskan, dibayar, atau tanggalnya dikunci tidak disentuh. Tanggal yang sudah punya lembur manual dilewati.
   * `force` = jalankan walau otomatisasi dimatikan (tombol HR).
   */
  async syncAttendances(
    tx: Db,
    companyId: string,
    input: { from: string; to: string; employeeIds?: string[]; force?: boolean },
  ) {
    const result = { created: 0, updated: 0, removed: 0 };
    const s = await this.settings(tx, companyId);
    if (!s.enabled && !input.force) return result;
    if (input.to < input.from) throw new BadRequestException("Tanggal selesai sebelum mulai");
    const start = new Date(`${addDays(input.from, -1)}T00:00:00Z`);
    const end = new Date(`${addDays(input.to, 1)}T23:59:59Z`);
    const rows = await tx
      .select({ attendance: AT, employee: schema.employees })
      .from(AT)
      .innerJoin(schema.employees, eq(schema.employees.id, AT.employeeId))
      .where(
        and(
          eq(AT.companyId, companyId),
          isNotNull(AT.checkOut),
          ne(AT.state, "refused"),
          gte(AT.checkIn, start),
          lte(AT.checkIn, end),
          input.employeeIds ? inArray(AT.employeeId, input.employeeIds) : undefined,
        ),
      );
    const items = rows
      .map((r) => ({ ...r, date: localDate(r.attendance.checkIn, s.tz) }))
      .filter((r) => r.date >= input.from && r.date <= input.to && (!s.lockDate || r.date > s.lockDate));
    const employees = [...new Map(items.map((r) => [r.employee.id, r.employee])).values()];
    const resolve = await this.calendar.resolver(
      tx,
      companyId,
      employees.map((e) => e.id),
      input.from,
      input.to,
    );
    const cal = await this.calendar.load(tx, companyId, employees, input.from, input.to);
    const existing = await tx
      .select()
      .from(O)
      .where(
        and(
          eq(O.companyId, companyId),
          input.employeeIds ? inArray(O.employeeId, input.employeeIds) : undefined,
          gte(O.date, input.from),
          lte(O.date, input.to),
        ),
      );
    const decided = new Set(
      (
        await tx
          .select({ id: schema.approvals.resId })
          .from(schema.approvals)
          .where(
            and(
              eq(schema.approvals.resModel, "overtime"),
              inArray(
                schema.approvals.resId,
                existing.map((o) => o.id).concat(["00000000-0000-0000-0000-000000000000"]),
              ),
            ),
          )
      ).map((r) => r.id),
    );

    // Absensi yang dihapus meninggalkan lembur tanpa absensi: hapus selama belum diputuskan/dibayar.
    for (const o of [...existing]) {
      if (
        o.source !== "attendance" ||
        o.attendanceId ||
        o.state !== "confirm" ||
        o.payslipId ||
        decided.has(o.id)
      )
        continue;
      await tx.delete(O).where(eq(O.id, o.id));
      existing.splice(existing.indexOf(o), 1);
      result.removed++;
    }

    for (const { attendance, employee, date } of items) {
      const schedule = resolve(employee, date);
      const calc = overtimeFromAttendance({
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut!,
        date,
        timeZone: s.tz,
        schedule,
        workday: cal.isWorkday(employee, date),
        rules: s.rules,
      });
      const hours = calc.hours.toFixed(2);
      const description = `Dari absensi ${localTime(attendance.checkIn, s.tz)}–${localTime(attendance.checkOut!, s.tz)}${
        calc.scheduleEnd ? ` (jadwal s.d. ${localTime(calc.scheduleEnd, s.tz)})` : ""
      }`;
      const mine = existing.find((o) => o.attendanceId === attendance.id);
      if (mine) {
        const untouched = mine.state === "confirm" && !mine.payslipId && !decided.has(mine.id);
        if (!untouched) continue;
        if (calc.hours <= 0) {
          await tx.delete(O).where(eq(O.id, mine.id));
          result.removed++;
        } else if (mine.computedHours !== hours || mine.dayType !== calc.dayType) {
          await tx
            .update(O)
            .set({ hours, computedHours: hours, dayType: calc.dayType, description, updatedAt: sql`now()` })
            .where(eq(O.id, mine.id));
          result.updated++;
        }
        continue;
      }
      if (calc.hours <= 0) continue;
      // Tanggal yang sudah diisi lembur lain (manual / absensi lain) tidak digandakan.
      if (existing.some((o) => o.employeeId === employee.id && o.date === date)) continue;
      const [row] = await tx
        .insert(O)
        .values({
          companyId,
          employeeId: employee.id,
          date,
          hours,
          computedHours: hours,
          dayType: calc.dayType,
          description,
          source: "attendance",
          attendanceId: attendance.id,
          state: "confirm",
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      existing.push(row);
      // Selalu lewat persetujuan atasan: aturan persetujuan bila ada, selain itu tahap Pengaturan Payroll (min. 1).
      if (!(await beginApproval(tx, "overtime", row.id)))
        await tx
          .update(O)
          .set({ state: "confirm", approvalStep: 1, approvalLevels: Math.max(1, s.levels) })
          .where(eq(O.id, row.id));
      result.created++;
    }
    if (result.created || result.updated || result.removed)
      await this.activity.log(tx, {
        resModel: "overtime",
        resId: existing[0]?.id ?? companyId,
        action: "update",
        message: `Lembur dari absensi ${input.from} s.d. ${input.to}: ${result.created} baru, ${result.updated} diperbarui, ${result.removed} dihapus`,
      });
    return result;
  }

  /** Jam yang disetujui atasan: tidak boleh melebihi hasil hitung absensi (atau jam yang diajukan). */
  async setApprovedHours(tx: Db, id: string, hours: number) {
    const [row] = await tx.select().from(O).where(eq(O.id, id));
    if (!row) return;
    const limit = Number(row.computedHours ?? row.hours);
    if (hours > limit)
      throw new BadRequestException(`Jam lembur maksimal ${limit} jam sesuai pengajuan/hasil absensi`);
    if (Number(row.hours) === hours) return;
    await tx
      .update(O)
      .set({ hours: hours.toFixed(2), updatedAt: sql`now()` })
      .where(and(eq(O.id, id), isNull(O.payslipId)));
  }
}
