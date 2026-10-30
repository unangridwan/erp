import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNull, lte, or, schema } from "@erp/db";
import {
  ALL_PERMISSIONS,
  holidayImportSchema,
  ID_NATIONAL_HOLIDAYS,
  leaveDaysPreviewSchema,
} from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { EmployeeService } from "./employee.service.js";
import { LeaveService } from "./leave.service.js";

const H = schema.publicHolidays;

/** Kalender kerja: daftar libur per tahun & perusahaan, impor libur nasional, pratinjau durasi cuti. */
@Controller()
export class WorkCalendarController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(LeaveService) private readonly leaves: LeaveService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Libur satu tahun: yang berlaku untuk semua perusahaan + libur khusus perusahaan (semua yang boleh diakses). */
  @Get("work-calendar/holidays")
  @RequirePermission("hr.read")
  holidays(@Query("year") yearParam?: string, @Query("companyId") companyId?: string) {
    const year = Number(yearParam) || new Date().getFullYear();
    const ctx = currentContext();
    if (companyId && !ctx.companyIds.includes(companyId))
      throw new BadRequestException("Perusahaan tidak ditemukan");
    return this.tenantDb.run(async (tx) => {
      const rows = await tx
        .select({
          id: H.id,
          date: H.date,
          name: H.name,
          kind: H.kind,
          source: H.source,
          companyId: H.companyId,
          companyName: schema.companies.name,
        })
        .from(H)
        .leftJoin(schema.companies, eq(schema.companies.id, H.companyId))
        .where(
          and(
            gte(H.date, `${year}-01-01`),
            lte(H.date, `${year}-12-31`),
            companyId
              ? or(isNull(H.companyId), eq(H.companyId, companyId))
              : ctx.permissions.includes(ALL_PERMISSIONS)
                ? undefined
                : or(isNull(H.companyId), inArray(H.companyId, ctx.companyIds)),
          ),
        )
        .orderBy(asc(H.date), asc(H.name));
      return { year, available: Object.keys(ID_NATIONAL_HOLIDAYS).map(Number), items: rows };
    });
  }

  /** Impor libur nasional (& cuti bersama) bawaan untuk satu tahun; tanggal yang sudah ada dilewati. */
  @Post("work-calendar/holidays/import-national")
  @RequirePermission("hr.manage")
  importNational(@Body() body: unknown) {
    const input = parse(holidayImportSchema, body);
    const list = ID_NATIONAL_HOLIDAYS[input.year];
    if (!list)
      throw new BadRequestException(
        `Data libur nasional ${input.year} belum tersedia — impor dari berkas atau tambahkan manual`,
      );
    if (input.companyId && !currentContext().companyIds.includes(input.companyId))
      throw new BadRequestException("Perusahaan tidak ditemukan");
    return this.tenantDb.run(async (tx) => {
      const rows = list.filter((h) => input.collective || h.kind === "national");
      const created = rows.length
        ? await tx
            .insert(H)
            .values(
              rows.map((h) => ({
                date: h.date,
                name: h.name,
                kind: h.kind,
                companyId: input.companyId ?? null,
                source: "import" as const,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: H.id })
        : [];
      if (created.length)
        await this.activity.log(tx, {
          resModel: "public_holiday",
          resId: created[0]!.id,
          action: "create",
          message: `Impor libur nasional ${input.year}: ${created.length} tanggal`,
        });
      return { created: created.length, skipped: rows.length - created.length };
    });
  }

  /** Pratinjau durasi cuti karyawan (HR). */
  @Post("work-calendar/leave-days")
  @RequirePermission("hr.read")
  leaveDays(@Body() body: unknown) {
    const input = parse(leaveDaysPreviewSchema, body);
    return this.tenantDb.run(async (tx) =>
      this.leaves.previewDays(tx, await this.employees.find(tx, input.employeeId), input),
    );
  }

  /** Pratinjau durasi cuti milik sendiri (portal). */
  @Post("me/leave-days")
  myLeaveDays(@Body() body: unknown) {
    const input = parse(leaveDaysPreviewSchema.omit({ employeeId: true }), body);
    return this.tenantDb.run(async (tx) => this.leaves.previewDays(tx, await this.employees.mine(tx), input));
  }
}
