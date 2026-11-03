import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, schema, sql, type Db } from "@erp/db";
import {
  autoCheckoutTime,
  dailyStatus,
  distanceMeters,
  hasPermission,
  monthlySummary,
  zonedToUtc,
  type attendanceRequestSchema,
  type DaySchedule,
  type shiftRequestSchema,
  LIST_LOAD_LIMIT,
} from "@erp/shared";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { currentContext } from "../common/request-context.js";
import { ApprovalService } from "./approval.service.js";
import { EmployeeService } from "./employee.service.js";
import { OvertimeService } from "./overtime.service.js";
import { holidaysBetween, WorkCalendarService } from "./work-calendar.service.js";
import { localDate } from "./schedule.service.js";

const AT = schema.attendances;
const E = schema.employees;
const AR = schema.attendanceRequests;
const SR = schema.shiftRequests;
const DEV = schema.attendanceDevices;
type Employee = typeof E.$inferSelect;
type Attendance = typeof AT.$inferSelect;

/** Kolom absensi tanpa isi foto (bytea). */
export const ATTENDANCE_COLUMNS = {
  id: AT.id,
  companyId: AT.companyId,
  employeeId: AT.employeeId,
  checkIn: AT.checkIn,
  checkOut: AT.checkOut,
  latitude: AT.latitude,
  longitude: AT.longitude,
  checkOutLatitude: AT.checkOutLatitude,
  checkOutLongitude: AT.checkOutLongitude,
  source: AT.source,
  state: AT.state,
  ip: AT.ip,
  userAgent: AT.userAgent,
  photoType: AT.photoType,
  workLocationId: AT.workLocationId,
  distanceM: AT.distanceM,
  autoCheckout: AT.autoCheckout,
  note: AT.note,
  validatedAt: AT.validatedAt,
  deviceId: AT.deviceId,
  createdAt: AT.createdAt,
};

export interface PunchMeta {
  source: "web" | "kiosk" | "device";
  latitude?: number | null;
  longitude?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  photo?: { type: string; data: string } | null;
  deviceId?: string | null;
  /** Lokasi kerja tetap (mesin absensi) — tanpa pemeriksaan geofence. */
  workLocationId?: string | null;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Absensi lanjutan: absen masuk/pulang (portal, kiosk, mesin) dengan geofence & foto, validasi, kunci absensi,
 * koreksi absensi & tukar shift berjenjang, auto-checkout, dan rekap status harian/bulanan.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(WorkCalendarService) private readonly calendar: WorkCalendarService,
    @Inject(OvertimeService) private readonly overtimes: OvertimeService,
  ) {}

  async settings(tx: Db, companyId: string) {
    const [s] = await tx
      .select({
        tz: schema.payrollSettings.timezone,
        validation: schema.payrollSettings.attendanceValidation,
        lockDate: schema.payrollSettings.attendanceLockDate,
        autoHours: schema.payrollSettings.autoCheckoutHours,
        levels: schema.payrollSettings.attendanceApprovalLevels,
      })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    return {
      tz: s?.tz ?? "Asia/Jakarta",
      validation: s?.validation ?? false,
      lockDate: s?.lockDate ?? null,
      autoHours: s?.autoHours ?? null,
      levels: s?.levels ?? 1,
    };
  }

  /** Tanggal (lokal) yang sudah dikunci tidak bisa diubah. */
  async assertUnlocked(tx: Db, companyId: string, date: string) {
    const { lockDate } = await this.settings(tx, companyId);
    if (lockDate && date <= lockDate)
      throw new BadRequestException(
        `Absensi s.d. ${lockDate} sudah dikunci; tanggal ${date} tidak bisa diubah`,
      );
  }

  /**
   * Absen masuk bila belum ada absensi terbuka, selain itu absen pulang. Lokasi kerja karyawan menentukan jarak;
   * di luar radius ditolak bila geofence diwajibkan.
   */
  async punch(tx: Db, employee: Employee, at: Date, meta: PunchMeta) {
    if (!employee.active || (employee.resignDate && employee.resignDate < at.toISOString().slice(0, 10)))
      throw new BadRequestException("Karyawan tidak aktif");
    const s = await this.settings(tx, employee.companyId);
    await this.assertUnlocked(tx, employee.companyId, localDate(at, s.tz));
    const [open] = await tx
      .select(ATTENDANCE_COLUMNS)
      .from(AT)
      .where(and(eq(AT.employeeId, employee.id), isNull(AT.checkOut), ne(AT.state, "refused")))
      .orderBy(desc(AT.checkIn))
      .limit(1);
    const lat = meta.latitude ?? null;
    const lng = meta.longitude ?? null;
    if (open && open.checkIn < at) {
      const [row] = await tx
        .update(AT)
        .set({
          checkOut: at,
          checkOutLatitude: lat?.toString() ?? null,
          checkOutLongitude: lng?.toString() ?? null,
        })
        .where(eq(AT.id, open.id))
        .returning(ATTENDANCE_COLUMNS);
      // Lembur dari absensi (bila diaktifkan) langsung masuk ke atasan setelah absen pulang.
      const date = localDate(open.checkIn, s.tz);
      await this.overtimes.syncAttendances(tx, employee.companyId, {
        from: date,
        to: date,
        employeeIds: [employee.id],
      });
      return { action: "out" as const, attendance: row! };
    }
    let workLocationId = meta.workLocationId ?? null;
    let distance: number | null = null;
    if (!workLocationId && employee.workLocationId) {
      const [loc] = await tx
        .select()
        .from(schema.workLocations)
        .where(
          and(eq(schema.workLocations.id, employee.workLocationId), eq(schema.workLocations.active, true)),
        );
      if (loc) {
        workLocationId = loc.id;
        if (lat !== null && lng !== null) {
          distance = distanceMeters({ latitude: lat, longitude: lng }, loc);
          if (loc.enforceGeofence && distance > loc.radiusM)
            throw new BadRequestException(
              `Di luar area ${loc.name}: ${distance} m dari lokasi (radius ${loc.radiusM} m)`,
            );
        } else if (loc.enforceGeofence && meta.source === "web")
          throw new BadRequestException(`Aktifkan lokasi (GPS) untuk absen di ${loc.name}`);
      }
    }
    const [row] = await tx
      .insert(AT)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        checkIn: at,
        latitude: lat?.toString() ?? null,
        longitude: lng?.toString() ?? null,
        source: meta.source,
        state: s.validation ? "draft" : "validated",
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ...(meta.photo ? { photo: Buffer.from(meta.photo.data, "base64"), photoType: meta.photo.type } : {}),
        workLocationId,
        distanceM: distance,
        deviceId: meta.deviceId ?? null,
      })
      .returning(ATTENDANCE_COLUMNS);
    return { action: "in" as const, attendance: row! };
  }

  /** Validasi/tolak absensi (massal). */
  async validate(tx: Db, ids: string[], decision: "validated" | "refused", note?: string | null) {
    const ctx = currentContext();
    const rows = await tx
      .select({ id: AT.id, checkIn: AT.checkIn, companyId: AT.companyId })
      .from(AT)
      .where(and(inArray(AT.id, ids), eq(AT.companyId, ctx.companyId)));
    if (rows.length !== new Set(ids).size) throw new NotFoundException("Absensi tidak ditemukan");
    const s = await this.settings(tx, ctx.companyId);
    for (const r of rows) await this.assertUnlocked(tx, r.companyId, localDate(r.checkIn, s.tz));
    await tx
      .update(AT)
      .set({ state: decision, validatedBy: ctx.userId, validatedAt: new Date(), ...(note ? { note } : {}) })
      .where(inArray(AT.id, ids));
    return { updated: rows.length };
  }

  async photo(tx: Db, id: string) {
    const ctx = currentContext();
    const [row] = await tx
      .select({ photo: AT.photo, type: AT.photoType, employeeId: AT.employeeId })
      .from(AT)
      .where(and(eq(AT.id, id), eq(AT.companyId, ctx.companyId)));
    if (!row?.photo) throw new NotFoundException("Foto tidak ditemukan");
    if (!hasPermission(ctx.permissions, "hr.read")) {
      const mine = await this.employees.mine(tx).catch(() => null);
      if (mine?.id !== row.employeeId) throw new ForbiddenException("Butuh permission hr.read");
    }
    return { data: row.photo, type: row.type ?? "image/jpeg" };
  }

  // ---- PIN & kiosk ----

  async setPin(tx: Db, employeeId: string, pin: string) {
    await tx
      .update(E)
      .set({ attendancePinHash: await hashPassword(pin), updatedAt: sql`now()` })
      .where(eq(E.id, employeeId));
  }

  /** Karyawan dari kode badge atau No. karyawan di perusahaan. */
  private async byCode(tx: Db, companyId: string, code: string) {
    const [employee] = await tx
      .select()
      .from(E)
      .where(and(eq(E.companyId, companyId), or(eq(E.badgeCode, code), eq(E.employeeNumber, code))))
      .limit(1);
    return employee ?? null;
  }

  /** Kiosk: badge/No. karyawan + PIN → absen masuk/pulang. */
  async kiosk(
    tx: Db,
    input: { code: string; pin: string; photo?: { type: string; data: string } | null },
    ip?: string,
  ) {
    const employee = await this.byCode(tx, currentContext().companyId, input.code);
    if (!employee?.attendancePinHash || !(await verifyPassword(input.pin, employee.attendancePinHash)))
      throw new BadRequestException("Kode badge atau PIN salah");
    const result = await this.punch(tx, employee, new Date(), { source: "kiosk", photo: input.photo, ip });
    return {
      action: result.action,
      employeeName: employee.name,
      at: result.attendance.checkOut ?? result.attendance.checkIn,
    };
  }

  // ---- Mesin absensi ----

  /** Kunci API mesin: `<tenant>.<device>.<rahasia>`; hanya hash rahasia yang disimpan. */
  async createDevice(
    tx: Db,
    input: { name: string; serial?: string | null; workLocationId?: string | null; active: boolean },
  ) {
    const ctx = currentContext();
    await this.assertLocation(tx, input.workLocationId);
    const secret = randomBytes(24).toString("base64url");
    const [row] = await tx
      .insert(DEV)
      .values({
        companyId: ctx.companyId,
        name: input.name,
        serial: input.serial ?? null,
        workLocationId: input.workLocationId ?? null,
        active: input.active,
        keyHash: sha256(secret),
      })
      .returning();
    const { keyHash: _h, ...device } = row!;
    return { ...device, key: `${ctx.tenantId}.${row!.id}.${secret}` };
  }

  async rotateKey(tx: Db, id: string) {
    const ctx = currentContext();
    const secret = randomBytes(24).toString("base64url");
    const [row] = await tx
      .update(DEV)
      .set({ keyHash: sha256(secret), updatedAt: sql`now()` })
      .where(and(eq(DEV.id, id), eq(DEV.companyId, ctx.companyId)))
      .returning({ id: DEV.id });
    if (!row) throw new NotFoundException("Mesin absensi tidak ditemukan");
    return { key: `${ctx.tenantId}.${row.id}.${secret}` };
  }

  async listDevices(tx: Db) {
    return tx
      .select({
        id: DEV.id,
        name: DEV.name,
        serial: DEV.serial,
        workLocationId: DEV.workLocationId,
        active: DEV.active,
        lastSeenAt: DEV.lastSeenAt,
        createdAt: DEV.createdAt,
      })
      .from(DEV)
      .where(eq(DEV.companyId, currentContext().companyId))
      .orderBy(asc(DEV.name));
  }

  async updateDevice(
    tx: Db,
    id: string,
    input: { name: string; serial?: string | null; workLocationId?: string | null; active: boolean },
  ) {
    await this.assertLocation(tx, input.workLocationId);
    const [row] = await tx
      .update(DEV)
      .set({
        ...input,
        serial: input.serial ?? null,
        workLocationId: input.workLocationId ?? null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(DEV.id, id), eq(DEV.companyId, currentContext().companyId)))
      .returning({ id: DEV.id });
    if (!row) throw new NotFoundException("Mesin absensi tidak ditemukan");
    return (await this.listDevices(tx)).find((d) => d.id === id);
  }

  async removeDevice(tx: Db, id: string) {
    await tx.delete(DEV).where(and(eq(DEV.id, id), eq(DEV.companyId, currentContext().companyId)));
  }

  /** Pisah kunci mesin menjadi tenant & device (format tidak valid → 401). */
  parseDeviceKey(key: string | undefined) {
    const [tenantId, deviceId, secret] = (key ?? "").split(".");
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!tenantId || !deviceId || !secret || !uuid.test(tenantId) || !uuid.test(deviceId))
      throw new UnauthorizedException("Kunci mesin absensi tidak valid");
    return { tenantId, deviceId, secret };
  }

  /**
   * Log dari mesin (berjalan sebagai tenant pemilik mesin): urut waktu, tiap log menjadi absen masuk/pulang; log yang
   * sama (karyawan + waktu) dilewati sehingga aman dikirim ulang.
   */
  async devicePush(tx: Db, deviceId: string, secret: string, punches: { code: string; timestamp: string }[]) {
    const [device] = await tx.select().from(DEV).where(eq(DEV.id, deviceId));
    const expected = Buffer.from(device?.keyHash ?? "0".repeat(64), "hex");
    const given = Buffer.from(sha256(secret), "hex");
    if (!device || !device.active || !timingSafeEqual(expected, given))
      throw new UnauthorizedException("Kunci mesin absensi tidak valid");
    let recorded = 0;
    const skipped: { code: string; timestamp: string; reason: string }[] = [];
    for (const p of [...punches].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
      const at = new Date(p.timestamp);
      const employee = await this.byCode(tx, device.companyId, p.code);
      if (!employee) {
        skipped.push({ ...p, reason: "Karyawan tidak dikenal" });
        continue;
      }
      const [dup] = await tx
        .select({ id: AT.id })
        .from(AT)
        .where(and(eq(AT.employeeId, employee.id), or(eq(AT.checkIn, at), eq(AT.checkOut, at))))
        .limit(1);
      if (dup) {
        skipped.push({ ...p, reason: "Sudah tercatat" });
        continue;
      }
      try {
        await tx.transaction((sp) =>
          this.punch(sp, employee, at, {
            source: "device",
            deviceId: device.id,
            workLocationId: device.workLocationId,
          }),
        );
        recorded++;
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e;
        skipped.push({ ...p, reason: e.message });
      }
    }
    await tx.update(DEV).set({ lastSeenAt: new Date() }).where(eq(DEV.id, device.id));
    return { recorded, skipped };
  }

  // ---- Jadwal ----

  /** Jadwal berlaku per karyawan × tanggal (penugasan shift, atau jadwal bawaan karyawan). */
  private scheduleResolver(tx: Db, companyId: string, employeeIds: string[], from: string, to: string) {
    return this.calendar.resolver(tx, companyId, employeeIds, from, to);
  }

  /** Tutup absensi terbuka lebih dari N jam (Pengaturan Payroll) pada jam pulang jadwal atau masuk + N jam. */
  async autoCheckout(tx: Db, companyId: string, now = new Date()) {
    const s = await this.settings(tx, companyId);
    if (!s.autoHours) return { closed: 0 };
    const cutoff = new Date(now.getTime() - s.autoHours * 3_600_000);
    const open = await tx
      .select({ attendance: ATTENDANCE_COLUMNS, employee: E })
      .from(AT)
      .innerJoin(E, eq(E.id, AT.employeeId))
      .where(and(eq(AT.companyId, companyId), isNull(AT.checkOut), lte(AT.checkIn, cutoff)));
    if (!open.length) return { closed: 0 };
    const dates = open.map((o) => localDate(o.attendance.checkIn, s.tz)).sort();
    const resolve = await this.scheduleResolver(
      tx,
      companyId,
      open.map((o) => o.employee.id),
      dates[0]!,
      dates[dates.length - 1]!,
    );
    let closed = 0;
    for (const { attendance, employee } of open) {
      const date = localDate(attendance.checkIn, s.tz);
      if (s.lockDate && date <= s.lockDate) continue;
      const schedule = resolve(employee, date);
      let end = schedule ? zonedToUtc(date, schedule.endTime, s.tz) : null;
      if (end && schedule && schedule.endTime <= schedule.startTime)
        end = new Date(end.getTime() + 86_400_000);
      await tx
        .update(AT)
        .set({ checkOut: autoCheckoutTime(attendance.checkIn, end, s.autoHours), autoCheckout: true })
        .where(eq(AT.id, attendance.id));
      closed++;
    }
    return { closed };
  }

  // ---- Rekap ----

  /** Status harian per karyawan dalam rentang tanggal + rekap. */
  async summary(tx: Db, input: { from: string; to: string; employeeIds?: string[]; departmentId?: string }) {
    const companyId = currentContext().companyId;
    const s = await this.settings(tx, companyId);
    const employees = await tx
      .select()
      .from(E)
      .where(
        and(
          eq(E.companyId, companyId),
          eq(E.active, true),
          input.employeeIds ? inArray(E.id, input.employeeIds) : undefined,
          input.departmentId ? eq(E.departmentId, input.departmentId) : undefined,
        ),
      )
      .orderBy(asc(E.name));
    if (!employees.length) return { from: input.from, to: input.to, rows: [] };
    const ids = employees.map((e) => e.id);
    const resolve = await this.scheduleResolver(tx, companyId, ids, input.from, input.to);
    const holidays = new Set(await holidaysBetween(tx, companyId, input.from, input.to));
    const start = new Date(`${input.from}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(`${input.to}T23:59:59Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const attendances = await tx
      .select({ employeeId: AT.employeeId, checkIn: AT.checkIn, checkOut: AT.checkOut })
      .from(AT)
      .where(
        and(
          inArray(AT.employeeId, ids),
          ne(AT.state, "refused"),
          gte(AT.checkIn, start),
          lte(AT.checkIn, end),
        ),
      );
    const leaves = await tx
      .select({
        employeeId: schema.leaveRequests.employeeId,
        dateFrom: schema.leaveRequests.dateFrom,
        dateTo: schema.leaveRequests.dateTo,
        halfDay: schema.leaveRequests.halfDay,
      })
      .from(schema.leaveRequests)
      .where(
        and(
          inArray(schema.leaveRequests.employeeId, ids),
          eq(schema.leaveRequests.state, "approved"),
          lte(schema.leaveRequests.dateFrom, input.to),
          gte(schema.leaveRequests.dateTo, input.from),
        ),
      );
    const today = localDate(new Date(), s.tz);
    const dates: string[] = [];
    for (
      let t = Date.parse(`${input.from}T00:00:00Z`);
      t <= Date.parse(`${input.to}T00:00:00Z`);
      t += 86_400_000
    )
      dates.push(new Date(t).toISOString().slice(0, 10));
    const rows = employees.map((e) => {
      const mine = attendances
        .filter((a) => a.employeeId === e.id)
        .map((a) => ({ ...a, date: localDate(a.checkIn, s.tz) }));
      const days = dates.map((date) => {
        const sched = resolve(e, date);
        const daySchedule: DaySchedule | null = sched
          ? {
              start: sched.startTime,
              end: sched.endTime,
              toleranceMinutes: sched.toleranceMinutes,
              workDays: sched.workDays,
            }
          : null;
        const leave = leaves.find((l) => l.employeeId === e.id && l.dateFrom <= date && l.dateTo >= date);
        const before = e.joinDate > date || (e.resignDate !== null && e.resignDate < date);
        const r = dailyStatus({
          date,
          today,
          timeZone: s.tz,
          schedule: before ? null : daySchedule,
          holiday: holidays.has(date),
          leave: leave ? (leave.halfDay ? "half" : "full") : null,
          attendances: mine.filter((a) => a.date === date),
        });
        return { date, ...r };
      });
      return {
        employeeId: e.id,
        employeeName: e.name,
        employeeNumber: e.employeeNumber,
        days,
        summary: monthlySummary(days),
      };
    });
    return { from: input.from, to: input.to, today, rows };
  }

  // ---- Koreksi absensi & tukar shift ----

  async createAttendanceRequest(tx: Db, input: z.infer<typeof attendanceRequestSchema>) {
    const ctx = currentContext();
    const employee = await this.employeeFor(tx, input.employeeId);
    await this.assertUnlocked(tx, employee.companyId, input.date);
    const s = await this.settings(tx, employee.companyId);
    const checkIn = zonedToUtc(input.date, input.checkIn, s.tz);
    let checkOut = input.checkOut ? zonedToUtc(input.date, input.checkOut, s.tz) : null;
    if (checkOut && checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + 86_400_000);
    if (input.attachment && (input.attachment.data.replace(/\s/g, "").length * 3) / 4 > 5 * 1024 * 1024)
      throw fieldError("attachment", "Berkas maksimal 5 MB");
    const [row] = await tx
      .insert(AR)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        kind: input.kind,
        date: input.date,
        checkIn,
        checkOut,
        reason: input.reason,
        ...(input.attachment
          ? {
              attachment: Buffer.from(input.attachment.data, "base64"),
              attachmentName: input.attachment.name,
              attachmentType: input.attachment.type,
            }
          : {}),
        approvalLevels: s.levels,
        createdBy: ctx.userId,
      })
      .returning({ id: AR.id });
    await this.approvals.submitted(
      tx,
      "attendance_request",
      row!.id,
      employee,
      "Koreksi absensi",
      input.date,
    );
    return this.getAttendanceRequest(tx, row!.id);
  }

  async listAttendanceRequests(tx: Db, query: { mine?: string; state?: string; employeeId?: string }) {
    const ctx = currentContext();
    let employeeId = query.employeeId;
    if (query.mine) employeeId = (await this.employees.mine(tx)).id;
    else if (!hasPermission(ctx.permissions, "hr.read"))
      throw new ForbiddenException("Butuh permission hr.read");
    const rows = await tx
      .select({
        id: AR.id,
        employeeId: AR.employeeId,
        employeeName: E.name,
        kind: AR.kind,
        date: AR.date,
        checkIn: AR.checkIn,
        checkOut: AR.checkOut,
        reason: AR.reason,
        attachmentName: AR.attachmentName,
        state: AR.state,
        approvalStep: AR.approvalStep,
        approvalLevels: AR.approvalLevels,
        createdAt: AR.createdAt,
      })
      .from(AR)
      .innerJoin(E, eq(E.id, AR.employeeId))
      .where(
        and(
          eq(AR.companyId, ctx.companyId),
          employeeId ? eq(AR.employeeId, employeeId) : undefined,
          query.state ? eq(AR.state, query.state as "confirm") : undefined,
        ),
      )
      .orderBy(desc(AR.createdAt))
      .limit(LIST_LOAD_LIMIT);
    return rows;
  }

  async getAttendanceRequest(tx: Db, id: string) {
    const rows = await tx
      .select({
        id: AR.id,
        employeeId: AR.employeeId,
        kind: AR.kind,
        date: AR.date,
        checkIn: AR.checkIn,
        checkOut: AR.checkOut,
        reason: AR.reason,
        attachmentName: AR.attachmentName,
        state: AR.state,
        approvalStep: AR.approvalStep,
        approvalLevels: AR.approvalLevels,
        attendanceId: AR.attendanceId,
      })
      .from(AR)
      .where(and(eq(AR.id, id), eq(AR.companyId, currentContext().companyId)));
    if (!rows[0]) throw new NotFoundException("Koreksi absensi tidak ditemukan");
    return rows[0];
  }

  /** Lampiran koreksi absensi (pemilik, penyetuju, atau hr.read). */
  async attendanceRequestAttachment(tx: Db, id: string) {
    const ctx = currentContext();
    const [row] = await tx
      .select()
      .from(AR)
      .where(and(eq(AR.id, id), eq(AR.companyId, ctx.companyId)));
    if (!row) throw new NotFoundException("Koreksi absensi tidak ditemukan");
    if (!hasPermission(ctx.permissions, "hr.read")) {
      const employee = await this.employees.find(tx, row.employeeId);
      const approver =
        row.state === "confirm" &&
        (await this.approvals.isApprover(
          tx,
          "attendance_request",
          row.id,
          employee,
          row.approvalStep,
          ctx.userId,
        ));
      if (employee.userId !== ctx.userId && !approver)
        throw new ForbiddenException("Butuh permission hr.read");
    }
    if (!row.attachment) throw new NotFoundException("Lampiran tidak ditemukan");
    return {
      data: row.attachment,
      name: row.attachmentName ?? "lampiran",
      type: row.attachmentType ?? "application/octet-stream",
    };
  }

  /**
   * Keputusan koreksi absensi; setelah tahap terakhir disetujui, absensi hari itu diganti/ditambah sesuai koreksi
   * (sumber `request`, langsung tervalidasi). Tanggal yang sudah dikunci tidak bisa diputuskan.
   */
  async decideAttendanceRequest(tx: Db, id: string, decision: "approved" | "refused", note?: string | null) {
    const request = await this.getAttendanceRequest(tx, id);
    const [{ companyId } = { companyId: currentContext().companyId }] = await tx
      .select({ companyId: AR.companyId })
      .from(AR)
      .where(eq(AR.id, id));
    await this.assertUnlocked(tx, companyId, request.date);
    const status = await this.approvals.decide(tx, "attendance_request", id, decision, note);
    if (status.state === "approved") {
      const s = await this.settings(tx, companyId);
      const existing = (
        await tx
          .select({ id: AT.id, checkIn: AT.checkIn })
          .from(AT)
          .where(
            and(
              eq(AT.employeeId, request.employeeId),
              ne(AT.state, "refused"),
              gte(AT.checkIn, new Date(request.checkIn.getTime() - 86_400_000)),
              lte(AT.checkIn, new Date(request.checkIn.getTime() + 86_400_000)),
            ),
          )
          .orderBy(asc(AT.checkIn))
      ).find((a) => localDate(a.checkIn, s.tz) === request.date);
      const values = {
        checkIn: request.checkIn,
        checkOut: request.checkOut,
        state: "validated" as const,
        validatedBy: currentContext().userId,
        validatedAt: new Date(),
        note: `Koreksi: ${request.reason}`,
      };
      const [att] = existing
        ? await tx.update(AT).set(values).where(eq(AT.id, existing.id)).returning({ id: AT.id })
        : await tx
            .insert(AT)
            .values({ ...values, companyId, employeeId: request.employeeId, source: "request" })
            .returning({ id: AT.id });
      await tx.update(AR).set({ attendanceId: att!.id }).where(eq(AR.id, id));
    }
    return this.getAttendanceRequest(tx, id);
  }

  async cancelAttendanceRequest(tx: Db, id: string) {
    const request = await this.getAttendanceRequest(tx, id);
    await this.assertOwnerOrHr(tx, request.employeeId);
    if (request.state !== "confirm") throw new BadRequestException("Pengajuan sudah diproses");
    await tx
      .update(AR)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(AR.id, id));
    return this.getAttendanceRequest(tx, id);
  }

  async createShiftRequest(tx: Db, input: z.infer<typeof shiftRequestSchema>) {
    const ctx = currentContext();
    const employee = await this.employeeFor(tx, input.employeeId);
    const [schedule] = await tx
      .select()
      .from(schema.workSchedules)
      .where(
        and(
          eq(schema.workSchedules.id, input.scheduleId),
          eq(schema.workSchedules.companyId, employee.companyId),
          eq(schema.workSchedules.active, true),
        ),
      );
    if (!schedule) throw fieldError("scheduleId", "Jadwal kerja tidak ditemukan di perusahaan ini");
    await this.assertUnlocked(tx, employee.companyId, input.dateFrom);
    const resolve = await this.scheduleResolver(
      tx,
      employee.companyId,
      [employee.id],
      input.dateFrom,
      input.dateTo,
    );
    const current = resolve(employee, input.dateFrom);
    if (current?.id === schedule.id)
      throw fieldError("scheduleId", "Jadwal yang diminta sama dengan jadwal saat ini");
    const s = await this.settings(tx, employee.companyId);
    const [row] = await tx
      .insert(SR)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        scheduleId: schedule.id,
        currentScheduleId: current?.id ?? null,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        reason: input.reason ?? null,
        approvalLevels: s.levels,
        createdBy: ctx.userId,
      })
      .returning({ id: SR.id });
    await this.approvals.submitted(
      tx,
      "shift_request",
      row!.id,
      employee,
      "Tukar shift",
      `${input.dateFrom} s.d. ${input.dateTo}`,
    );
    return this.getShiftRequest(tx, row!.id);
  }

  async listShiftRequests(tx: Db, query: { mine?: string; state?: string }) {
    const ctx = currentContext();
    let employeeId: string | undefined;
    if (query.mine) employeeId = (await this.employees.mine(tx)).id;
    else if (!hasPermission(ctx.permissions, "hr.read"))
      throw new ForbiddenException("Butuh permission hr.read");
    const W = schema.workSchedules;
    return tx
      .select({
        id: SR.id,
        employeeId: SR.employeeId,
        employeeName: E.name,
        scheduleId: SR.scheduleId,
        scheduleName: W.name,
        currentScheduleId: SR.currentScheduleId,
        dateFrom: SR.dateFrom,
        dateTo: SR.dateTo,
        reason: SR.reason,
        state: SR.state,
        approvalStep: SR.approvalStep,
        approvalLevels: SR.approvalLevels,
        createdAt: SR.createdAt,
      })
      .from(SR)
      .innerJoin(E, eq(E.id, SR.employeeId))
      .innerJoin(W, eq(W.id, SR.scheduleId))
      .where(
        and(
          eq(SR.companyId, ctx.companyId),
          employeeId ? eq(SR.employeeId, employeeId) : undefined,
          query.state ? eq(SR.state, query.state as "confirm") : undefined,
        ),
      )
      .orderBy(desc(SR.createdAt))
      .limit(LIST_LOAD_LIMIT);
  }

  async getShiftRequest(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(SR)
      .where(and(eq(SR.id, id), eq(SR.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Permintaan tukar shift tidak ditemukan");
    return row;
  }

  /**
   * Keputusan tukar shift. Tidak bisa disetujui bila jadwal karyawan sudah berubah sejak diajukan atau periodenya
   * terkunci; tahap terakhir yang disetujui membuat penugasan shift.
   */
  async decideShiftRequest(tx: Db, id: string, decision: "approved" | "refused", note?: string | null) {
    const request = await this.getShiftRequest(tx, id);
    if (decision === "approved") {
      await this.assertUnlocked(tx, request.companyId, request.dateFrom);
      const employee = await this.employees.find(tx, request.employeeId);
      const resolve = await this.scheduleResolver(
        tx,
        request.companyId,
        [employee.id],
        request.dateFrom,
        request.dateTo,
      );
      if ((resolve(employee, request.dateFrom)?.id ?? null) !== request.currentScheduleId)
        throw new BadRequestException(
          "Jadwal karyawan sudah berubah sejak diajukan; pengajuan tidak bisa disetujui",
        );
    }
    const status = await this.approvals.decide(tx, "shift_request", id, decision, note);
    if (status.state === "approved") {
      const [assignment] = await tx
        .insert(schema.shiftAssignments)
        .values({
          companyId: request.companyId,
          employeeId: request.employeeId,
          scheduleId: request.scheduleId,
          dateFrom: request.dateFrom,
          dateTo: request.dateTo,
        })
        .returning({ id: schema.shiftAssignments.id });
      await tx.update(SR).set({ assignmentId: assignment!.id }).where(eq(SR.id, id));
    }
    return this.getShiftRequest(tx, id);
  }

  async cancelShiftRequest(tx: Db, id: string) {
    const request = await this.getShiftRequest(tx, id);
    await this.assertOwnerOrHr(tx, request.employeeId);
    if (request.state !== "confirm") throw new BadRequestException("Pengajuan sudah diproses");
    await tx
      .update(SR)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(SR.id, id));
    return this.getShiftRequest(tx, id);
  }

  // ---- Internal ----

  private async employeeFor(tx: Db, employeeId?: string) {
    const ctx = currentContext();
    if (!employeeId) return this.employees.mine(tx);
    const employee = await this.employees.find(tx, employeeId);
    if (employee.userId !== ctx.userId && !hasPermission(ctx.permissions, "hr.write"))
      throw new ForbiddenException("Butuh permission hr.write");
    return employee;
  }

  private async assertOwnerOrHr(tx: Db, employeeId: string) {
    const ctx = currentContext();
    if (hasPermission(ctx.permissions, "hr.write")) return;
    const employee = await this.employees.find(tx, employeeId);
    if (employee.userId !== ctx.userId) throw new ForbiddenException("Butuh permission hr.write");
  }

  private async assertLocation(tx: Db, id?: string | null) {
    if (!id) return;
    const [loc] = await tx
      .select({ id: schema.workLocations.id })
      .from(schema.workLocations)
      .where(
        and(eq(schema.workLocations.id, id), eq(schema.workLocations.companyId, currentContext().companyId)),
      );
    if (!loc) throw fieldError("workLocationId", "Lokasi kerja tidak ditemukan di perusahaan ini");
  }
}

export type { Attendance };
