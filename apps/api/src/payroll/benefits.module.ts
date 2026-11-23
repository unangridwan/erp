import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, schema, sql, type Db } from "@erp/db";
import {
  benefitEnrollmentSchema,
  benefitPlanSchema,
  type BenefitEnrollmentInput,
  businessToday,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertCompanyAccounts, fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { assertRefsVisible } from "../common/crud.js";
import { toXlsxBook } from "../common/csv-import.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { EmployeeService } from "../hr/employee.service.js";
import { HrModule } from "../hr/hr.module.js";

const P = schema.benefitPlans;
const EN = schema.benefitEnrollments;
const E = schema.employees;

const month = z.string().regex(/^\d{4}-\d{2}$/, "Bulan harus format YYYY-MM");
const reportQuery = z.object({ from: month, to: month, format: z.enum(["json", "xlsx"]).default("json") });

/** Paket benefit (asuransi kesehatan swasta, DPLK, fasilitas) & kepesertaan karyawan. */
@Controller()
class BenefitsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
  ) {}

  @Get("benefit-plans")
  @RequirePermission("payroll.read")
  plans() {
    return this.tenantDb.run((tx) =>
      tx
        .select({
          plan: P,
          provider: schema.partners.name,
          members: sql<number>`(select count(*) from benefit_enrollments e where e.plan_id = ${P.id}
            and e.date_start <= current_date and (e.date_end is null or e.date_end >= current_date))::int`,
        })
        .from(P)
        .leftJoin(schema.partners, eq(schema.partners.id, P.providerId))
        .where(eq(P.companyId, currentContext().companyId))
        .orderBy(asc(P.code))
        .then((rows) => rows.map((r) => ({ ...r.plan, provider: r.provider, members: r.members }))),
    );
  }

  @Get("benefit-plans/:id")
  @RequirePermission("payroll.read")
  plan(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const plan = await this.findPlan(tx, id);
      const enrollments = await this.enrollmentRows(tx, eq(EN.planId, id));
      return { ...plan, enrollments };
    });
  }

  @Post("benefit-plans")
  @RequirePermission("payroll.manage")
  createPlan(@Body() body: unknown) {
    const input = parse(benefitPlanSchema, body);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      await this.validatePlan(tx, companyId, input);
      await this.assertCodeFree(tx, companyId, input.code);
      const [row] = await tx
        .insert(P)
        .values({ ...input, companyId })
        .returning();
      await this.activity.log(tx, { resModel: "benefit_plan", resId: row!.id, action: "create" });
      return row;
    });
  }

  @Patch("benefit-plans/:id")
  @RequirePermission("payroll.manage")
  updatePlan(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const before = await this.findPlan(tx, id);
      // Validasi ulang paket lengkap (nilai lama + perubahan) agar aturan persen/akun tetap konsisten.
      const input = parse(benefitPlanSchema, { ...before, ...(body as object) });
      await this.validatePlan(tx, before.companyId, input);
      if (input.code !== before.code) await this.assertCodeFree(tx, before.companyId, input.code, id);
      const [row] = await tx
        .update(P)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(P.id, id))
        .returning();
      await this.activity.log(tx, { resModel: "benefit_plan", resId: id, action: "update" });
      return row;
    });
  }

  @Delete("benefit-plans/:id")
  @RequirePermission("payroll.manage")
  @HttpCode(204)
  async deletePlan(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      await this.findPlan(tx, id);
      const [used] = await tx
        .select({ id: schema.payslipLines.id })
        .from(schema.payslipLines)
        .where(eq(schema.payslipLines.benefitPlanId, id))
        .limit(1);
      if (used)
        throw new BadRequestException("Paket benefit sudah dipakai di slip gaji; nonaktifkan saja paket ini");
      await tx.delete(P).where(eq(P.id, id));
    });
  }

  // ---- Kepesertaan ----

  @Get("employees/:id/benefits")
  @RequirePermission("payroll.read")
  employeeBenefits(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.employees.find(tx, id);
      return this.enrollmentRows(tx, eq(EN.employeeId, id));
    });
  }

  @Post("benefit-enrollments")
  @RequirePermission("payroll.manage")
  enroll(@Body() body: unknown) {
    const input = parse(benefitEnrollmentSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.validateEnrollment(tx, input);
      const [row] = await tx.insert(EN).values(input).returning();
      await this.log(tx, input.employeeId, `Ikut benefit ${await this.planName(tx, input.planId)}`);
      return row;
    });
  }

  @Patch("benefit-enrollments/:id")
  @RequirePermission("payroll.manage")
  updateEnrollment(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const before = await this.findEnrollment(tx, id);
      const input = parse(benefitEnrollmentSchema, { ...before, ...(body as object) });
      if (input.planId !== before.planId || input.employeeId !== before.employeeId)
        throw new BadRequestException(
          "Paket & karyawan kepesertaan tidak bisa diganti; buat kepesertaan baru",
        );
      await this.validateEnrollment(tx, input, id);
      const [row] = await tx
        .update(EN)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(EN.id, id))
        .returning();
      await this.log(tx, before.employeeId, `Kepesertaan ${await this.planName(tx, before.planId)} diubah`);
      return row;
    });
  }

  @Delete("benefit-enrollments/:id")
  @RequirePermission("payroll.manage")
  @HttpCode(204)
  async removeEnrollment(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const before = await this.findEnrollment(tx, id);
      await tx.delete(EN).where(eq(EN.id, id));
      await this.log(tx, before.employeeId, `Kepesertaan ${await this.planName(tx, before.planId)} dihapus`);
    });
  }

  // ---- Laporan ----

  /** Premi/iuran per paket & penyedia dari payroll terposting (untuk penyetoran ke penyedia), opsional Excel. */
  @Get("payroll/reports/benefits")
  @RequirePermission("payroll.read")
  async report(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(reportQuery, query);
    const data = await this.tenantDb.run(async (tx) => {
      const rows = await tx.execute<{
        plan_id: string;
        code: string;
        name: string;
        kind: string;
        provider: string | null;
        employee_id: string;
        employee_name: string;
        employee_number: string;
        month: string;
        employer: string;
        employee: string;
      }>(sql`
        select bp.id as plan_id, bp.code, bp.name, bp.kind, pr.name as provider,
          e.id as employee_id, e.name as employee_name, e.employee_number,
          to_char(r.period_start, 'YYYY-MM') as month,
          coalesce(sum(pl.amount) filter (where pl.category = 'benefit_employer'), 0)::text as employer,
          coalesce(-sum(pl.amount) filter (where pl.category = 'deduction'), 0)::text as employee
        from payslip_lines pl
        join payslips s on s.id = pl.payslip_id
        join payroll_runs r on r.id = s.run_id
        join benefit_plans bp on bp.id = pl.benefit_plan_id
        join employees e on e.id = s.employee_id
        left join partners pr on pr.id = bp.provider_id
        where s.company_id = ${currentContext().companyId} and r.state in ('done', 'paid')
          and r.period_start >= ${`${input.from}-01`}::date
          and r.period_start <= ${`${input.to}-01`}::date
        group by bp.id, bp.code, bp.name, bp.kind, pr.name, e.id, e.name, e.employee_number, to_char(r.period_start, 'YYYY-MM')
        order by bp.code, month, e.name`);
      const plans = new Map<
        string,
        {
          planId: string;
          code: string;
          name: string;
          kind: string;
          provider: string | null;
          employer: number;
          employee: number;
          members: Set<string>;
        }
      >();
      for (const r of rows) {
        const p = plans.get(r.plan_id) ?? {
          planId: r.plan_id,
          code: r.code,
          name: r.name,
          kind: r.kind,
          provider: r.provider,
          employer: 0,
          employee: 0,
          members: new Set<string>(),
        };
        p.employer += Number(r.employer);
        p.employee += Number(r.employee);
        p.members.add(r.employee_id);
        plans.set(r.plan_id, p);
      }
      return {
        summary: [...plans.values()].map(({ members, ...p }) => ({
          ...p,
          members: members.size,
          employer: p.employer.toFixed(0),
          employee: p.employee.toFixed(0),
          total: (p.employer + p.employee).toFixed(0),
        })),
        details: rows.map((r) => ({
          planCode: r.code,
          planName: r.name,
          provider: r.provider,
          month: r.month,
          employeeNumber: r.employee_number,
          employeeName: r.employee_name,
          employer: r.employer,
          employee: r.employee,
        })),
      };
    });
    if (input.format !== "xlsx") return data;
    const num = (key: string, header: string) => ({ key, header, numeric: true });
    const book = await toXlsxBook([
      {
        name: "Ringkasan",
        columns: [
          { key: "code", header: "Kode" },
          { key: "name", header: "Paket", width: 30 },
          { key: "provider", header: "Penyedia", width: 30 },
          { key: "members", header: "Peserta" },
          num("employer", "Porsi perusahaan"),
          num("employee", "Porsi karyawan"),
          num("total", "Total setor"),
        ],
        rows: data.summary,
      },
      {
        name: "Rincian",
        columns: [
          { key: "planCode", header: "Kode" },
          { key: "month", header: "Bulan" },
          { key: "employeeNumber", header: "No. karyawan" },
          { key: "employeeName", header: "Nama", width: 30 },
          num("employer", "Porsi perusahaan"),
          num("employee", "Porsi karyawan"),
        ],
        rows: data.details,
      },
    ]);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="benefit-${input.from}-${input.to}.xlsx"`);
    res.send(book);
    return undefined;
  }

  /** Portal karyawan: benefit yang sedang diikuti & iuran terakhir. */
  @Get("me/benefits")
  mine() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      const rows = await this.enrollmentRows(tx, eq(EN.employeeId, employee.id));
      return rows.filter((r) => !r.dateEnd || r.dateEnd >= businessToday());
    });
  }

  // ---- internal ----

  private async enrollmentRows(tx: Db, where: ReturnType<typeof eq>) {
    const rows = await tx
      .select({
        enrollment: EN,
        planCode: P.code,
        planName: P.name,
        kind: P.kind,
        provider: schema.partners.name,
        employeeName: E.name,
        employeeNumber: E.employeeNumber,
      })
      .from(EN)
      .innerJoin(P, eq(P.id, EN.planId))
      .innerJoin(E, eq(E.id, EN.employeeId))
      .leftJoin(schema.partners, eq(schema.partners.id, P.providerId))
      .where(and(where, eq(P.companyId, currentContext().companyId)))
      .orderBy(desc(EN.dateStart));
    const dependentIds = [...new Set(rows.flatMap((r) => r.enrollment.dependentIds))];
    const family = dependentIds.length
      ? await tx
          .select({
            id: schema.employeeFamily.id,
            name: schema.employeeFamily.name,
            relation: schema.employeeFamily.relation,
          })
          .from(schema.employeeFamily)
          .where(inArray(schema.employeeFamily.id, dependentIds))
      : [];
    // Iuran terakhir dari slip terposting per kepesertaan (paket × karyawan).
    const last = rows.length
      ? await tx.execute<{
          plan_id: string;
          employee_id: string;
          employer: string;
          employee: string;
          month: string;
        }>(sql`
          select distinct on (pl.benefit_plan_id, s.employee_id) pl.benefit_plan_id as plan_id, s.employee_id,
            to_char(r.period_start, 'YYYY-MM') as month,
            coalesce(sum(pl.amount) filter (where pl.category = 'benefit_employer')
              over (partition by s.id, pl.benefit_plan_id), 0)::text as employer,
            coalesce(-sum(pl.amount) filter (where pl.category = 'deduction')
              over (partition by s.id, pl.benefit_plan_id), 0)::text as employee
          from payslip_lines pl
          join payslips s on s.id = pl.payslip_id
          join payroll_runs r on r.id = s.run_id
          where pl.benefit_plan_id in (${sql.join(
            [...new Set(rows.map((r) => r.enrollment.planId))].map((id) => sql`${id}::uuid`),
            sql`, `,
          )}) and r.state in ('done', 'paid')
          order by pl.benefit_plan_id, s.employee_id, r.period_start desc`)
      : [];
    return rows.map((r) => {
      const l = last.find(
        (x) => x.plan_id === r.enrollment.planId && x.employee_id === r.enrollment.employeeId,
      );
      return {
        ...r.enrollment,
        planCode: r.planCode,
        planName: r.planName,
        kind: r.kind,
        provider: r.provider,
        employeeName: r.employeeName,
        employeeNumber: r.employeeNumber,
        dependents: family.filter((f) => r.enrollment.dependentIds.includes(f.id)),
        lastContribution: l ? { month: l.month, employer: l.employer, employee: l.employee } : null,
      };
    });
  }

  private async validatePlan(tx: Db, companyId: string, input: z.infer<typeof benefitPlanSchema>) {
    const refs = [
      ...(input.expenseAccountId ? [{ path: "expenseAccountId", id: input.expenseAccountId }] : []),
      ...(input.payableAccountId ? [{ path: "payableAccountId", id: input.payableAccountId }] : []),
    ];
    await assertCompanyAccounts(tx, companyId, refs);
    if (input.providerId)
      await assertRefsVisible(tx, { providerId: schema.partners }, { providerId: input.providerId });
    if (
      Number(input.employerAmount) + Number(input.employeeAmount) + Number(input.dependentAmount) > 0 &&
      !input.payableAccountId
    )
      throw fieldError("payableAccountId", "Pilih akun utang premi/iuran ke penyedia");
  }

  private async validateEnrollment(tx: Db, input: BenefitEnrollmentInput, exceptId?: string) {
    await this.findPlan(tx, input.planId);
    await this.employees.find(tx, input.employeeId);
    if (input.dependentIds.length) {
      const family = await tx
        .select({ id: schema.employeeFamily.id })
        .from(schema.employeeFamily)
        .where(
          and(
            inArray(schema.employeeFamily.id, input.dependentIds),
            eq(schema.employeeFamily.employeeId, input.employeeId),
          ),
        );
      if (family.length !== new Set(input.dependentIds).size)
        throw fieldError("dependentIds", "Tanggungan harus anggota keluarga karyawan ini");
    }
    // Satu kepesertaan per paket per karyawan pada satu waktu.
    const [overlap] = await tx
      .select({ id: EN.id })
      .from(EN)
      .where(
        and(
          eq(EN.planId, input.planId),
          eq(EN.employeeId, input.employeeId),
          exceptId ? ne(EN.id, exceptId) : undefined,
          input.dateEnd ? lte(EN.dateStart, input.dateEnd) : undefined,
          or(isNull(EN.dateEnd), gte(EN.dateEnd, input.dateStart)),
        ),
      )
      .limit(1);
    if (overlap) throw fieldError("dateStart", "Karyawan sudah terdaftar di paket ini pada periode tersebut");
  }

  private async findPlan(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, id), eq(P.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Paket benefit tidak ditemukan");
    return row;
  }

  private async findEnrollment(tx: Db, id: string) {
    const [row] = await tx
      .select({ enrollment: EN })
      .from(EN)
      .innerJoin(P, eq(P.id, EN.planId))
      .where(and(eq(EN.id, id), eq(P.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Kepesertaan benefit tidak ditemukan");
    return row.enrollment;
  }

  private async planName(tx: Db, id: string) {
    return (await this.findPlan(tx, id)).name;
  }

  private async assertCodeFree(tx: Db, companyId: string, code: string, exceptId?: string) {
    const [dup] = await tx
      .select({ id: P.id })
      .from(P)
      .where(and(eq(P.companyId, companyId), eq(P.code, code), exceptId ? ne(P.id, exceptId) : undefined));
    if (dup) throw fieldError("code", "Kode paket benefit sudah dipakai");
  }

  private log(tx: Db, employeeId: string, message: string) {
    return this.activity.log(tx, { resModel: "employee", resId: employeeId, action: "comment", message });
  }
}

@Module({
  imports: [AccountingModule, HrModule],
  controllers: [BenefitsController],
  providers: [ActivityService],
})
export class BenefitsModule {}
