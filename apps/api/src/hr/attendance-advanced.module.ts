import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { eq, schema, type Db } from "@erp/db";
import {
  addDays,
  approvalDecisionSchema,
  attendanceDeviceSchema,
  attendancePinSchema,
  attendanceRequestSchema,
  attendanceValidateSchema,
  devicePushSchema,
  kioskPunchSchema,
  shiftRequestSchema,
  workLocationSchema,
} from "@erp/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { Public, RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { RateLimiter } from "../common/rate-limiter.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { AttendanceService } from "./attendance.service.js";
import { EmployeeService } from "./employee.service.js";
import { HrModule } from "./hr.module.js";
import { OvertimeService } from "./overtime.service.js";
import { localDate } from "./schedule.service.js";

const WorkLocationsController = createCrudController({
  path: "work-locations",
  model: "work_location",
  table: schema.workLocations,
  schema: workLocationSchema,
  read: "hr.read",
  write: "hr.manage",
  searchColumns: [schema.workLocations.name],
  orderBy: schema.workLocations.name,
  companyColumn: schema.workLocations.companyId,
  perCompany: true,
  refs: { branchId: schema.branches },
});

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format bulan YYYY-MM");
const monthRange = (m: string) => {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
};

/** Validasi, kiosk, rekap bulanan & hari ini, foto, auto-checkout. */
@Controller("attendance")
class AttendanceExtrasController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  @Post("validate")
  @HttpCode(200)
  @RequirePermission("hr.write")
  validate(@Body() body: unknown) {
    const input = parse(attendanceValidateSchema, body);
    return this.tenantDb.run((tx) => this.attendance.validate(tx, input.ids, input.decision, input.note));
  }

  /** Tablet kiosk (akun ber-hr.write): badge/No. karyawan + PIN → absen masuk/pulang. */
  @Post("kiosk")
  @HttpCode(200)
  @RequirePermission("hr.write")
  kiosk(@Body() body: unknown, @Req() req: Request) {
    const input = parse(kioskPunchSchema, body);
    return this.tenantDb.run((tx) => this.attendance.kiosk(tx, input, req.ip));
  }

  @Get("summary")
  @RequirePermission("hr.read")
  summary(@Query() query: unknown) {
    const q = parse(
      z.object({
        month,
        employeeId: z.string().uuid().optional(),
        departmentId: z.string().uuid().optional(),
      }),
      query,
    );
    return this.tenantDb.run((tx) =>
      this.attendance.summary(tx, {
        ...monthRange(q.month),
        employeeIds: q.employeeId ? [q.employeeId] : undefined,
        departmentId: q.departmentId,
      }),
    );
  }

  /** Kehadiran hari ini: hadir, terlambat, belum pulang, belum hadir, cuti. */
  @Get("today")
  @RequirePermission("hr.read")
  today() {
    return this.tenantDb.run(async (tx) => {
      const { tz } = await this.attendance.settings(tx, currentContext().companyId);
      const date = localDate(new Date(), tz);
      const report = await this.attendance.summary(tx, { from: date, to: date });
      const groups: Record<
        string,
        { employeeId: string; employeeName: string; lateMinutes: number; firstIn: Date | null }[]
      > = {};
      for (const r of report.rows) {
        const day = r.days[0]!;
        (groups[day.status] ??= []).push({
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          lateMinutes: day.lateMinutes,
          firstIn: day.firstIn,
        });
      }
      return { date, groups };
    });
  }

  @Post("auto-checkout")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  autoCheckout() {
    return this.tenantDb.run((tx) => this.attendance.autoCheckout(tx, currentContext().companyId));
  }

  @Get(":id/photo")
  async photo(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.attendance.photo(tx, id));
    res.type(file.type).send(file.data);
  }
}

/** PIN kiosk: HR untuk karyawan, atau karyawan untuk dirinya sendiri. */
@Controller()
class AttendancePinController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Put("employees/:id/attendance-pin")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async setForEmployee(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(attendancePinSchema, body);
    await this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, id);
      await this.attendance.setPin(tx, id, input.pin);
    });
  }

  @Put("me/attendance-pin")
  @HttpCode(204)
  async setMine(@Body() body: unknown) {
    const input = parse(attendancePinSchema, body);
    await this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      await this.attendance.setPin(tx, employee.id, input.pin);
    });
  }

  /** Rekap kehadiran bulanan milik sendiri. */
  @Get("me/attendance-summary")
  mySummary(@Query("month") m?: string) {
    const value = parse(month, m ?? new Date().toISOString().slice(0, 7));
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const report = await this.attendance.summary(tx, { ...monthRange(value), employeeIds: [employee.id] });
      return { ...report, row: report.rows[0] ?? null };
    });
  }
}

@Controller("attendance-devices")
class AttendanceDevicesController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run((tx) => this.attendance.listDevices(tx));
  }

  /** Kunci API ditampilkan sekali saat dibuat. */
  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(attendanceDeviceSchema, body);
    return this.tenantDb.run((tx) => this.attendance.createDevice(tx, input));
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(attendanceDeviceSchema, body);
    return this.tenantDb.run((tx) => this.attendance.updateDevice(tx, id, input));
  }

  @Post(":id/rotate-key")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  rotate(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.attendance.rotateKey(tx, id));
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.attendance.removeDevice(tx, id));
  }
}

/** Endpoint mesin absensi (tanpa login user): header `X-Device-Key`. */
@Controller("attendance-devices")
class DevicePushController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Post("push")
  @Public()
  @HttpCode(200)
  async push(@Headers("x-device-key") key: string | undefined, @Body() body: unknown, @Req() req: Request) {
    await this.limiter.consume(`device-push:${req.ip ?? "unknown"}`, 600, 15 * 60_000);
    const { tenantId, deviceId, secret } = this.attendance.parseDeviceKey(key);
    const input = parse(devicePushSchema, body);
    return this.tenantDb.runAs(tenantId, (tx) =>
      this.attendance.devicePush(tx, deviceId, secret, input.punches),
    );
  }
}

@Controller("attendance-requests")
class AttendanceRequestsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  @Get()
  list(@Query() query: { mine?: string; state?: string; employeeId?: string }) {
    return this.tenantDb.run((tx) => this.attendance.listAttendanceRequests(tx, query));
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(attendanceRequestSchema, body);
    return this.tenantDb.run((tx) => this.attendance.createAttendanceRequest(tx, input));
  }

  @Get(":id/attachment")
  async attachment(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run((tx) => this.attendance.attendanceRequestAttachment(tx, id));
    res.type(file.type).attachment(file.name).send(file.data);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.attendance.cancelAttendanceRequest(tx, id));
  }

  /** Atasan pada tahapnya (atau HR). */
  @Post(":id/:decision")
  @HttpCode(200)
  decide(@Param("id", ParseUUIDPipe) id: string, @Param("decision") decision: string, @Body() body: unknown) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) =>
      this.attendance.decideAttendanceRequest(
        tx,
        id,
        decision === "approve" ? "approved" : "refused",
        input.note,
      ),
    );
  }
}

@Controller("shift-requests")
class ShiftRequestsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  @Get()
  list(@Query() query: { mine?: string; state?: string }) {
    return this.tenantDb.run((tx) => this.attendance.listShiftRequests(tx, query));
  }

  @Post()
  create(@Body() body: unknown) {
    const input = parse(shiftRequestSchema, body);
    return this.tenantDb.run((tx) => this.attendance.createShiftRequest(tx, input));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.attendance.cancelShiftRequest(tx, id));
  }

  @Post(":id/:decision")
  @HttpCode(200)
  decide(@Param("id", ParseUUIDPipe) id: string, @Param("decision") decision: string, @Body() body: unknown) {
    if (decision !== "approve" && decision !== "refuse") throw new NotFoundException();
    const input = parse(approvalDecisionSchema, body ?? {});
    return this.tenantDb.run((tx) =>
      this.attendance.decideShiftRequest(tx, id, decision === "approve" ? "approved" : "refused", input.note),
    );
  }
}

/** Jadwal kerja aktif untuk pengajuan tukar shift dari portal. */
@Controller("me")
class PortalSchedulesController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get("work-schedules")
  schedules() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: schema.workSchedules.id,
          name: schema.workSchedules.name,
          startTime: schema.workSchedules.startTime,
          endTime: schema.workSchedules.endTime,
        })
        .from(schema.workSchedules)
        .where(eq(schema.workSchedules.companyId, currentContext().companyId)),
    );
  }
}

/** Auto-checkout tiap jam untuk semua tenant & perusahaan (memakai flag scheduler pengingat HR). */
@Injectable()
export class AutoCheckoutScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("AutoCheckout");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(OvertimeService) private readonly overtimes: OvertimeService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.hrReminder.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runAll().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "auto-checkout" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async runAll(now = new Date()) {
    const tenants = await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants);
    let closed = 0;
    for (const t of tenants)
      closed += await this.tenantDb.runAs(t.id, async (tx) => {
        let n = 0;
        const today = now.toISOString().slice(0, 10);
        for (const c of await tx.select({ id: schema.companies.id }).from(schema.companies)) {
          n += (await this.attendance.autoCheckout(tx, c.id, now)).closed;
          // Lembur dari absensi 7 hari terakhir (absen pulang dari mesin, kiosk, koreksi, auto-checkout).
          await this.overtimes.syncAttendances(tx, c.id, { from: addDays(today, -7), to: today });
        }
        return n;
      });
    return { closed };
  }
}

/** Absensi lanjutan: lokasi kerja, mesin absensi, kiosk, koreksi absensi, tukar shift, rekap. */
@Module({
  imports: [HrModule],
  controllers: [
    WorkLocationsController,
    AttendanceExtrasController,
    AttendancePinController,
    AttendanceDevicesController,
    DevicePushController,
    AttendanceRequestsController,
    ShiftRequestsController,
    PortalSchedulesController,
  ],
  providers: [ActivityService, AutoCheckoutScheduler, RateLimiter],
  exports: [AutoCheckoutScheduler],
})
export class AttendanceAdvancedModule {}
