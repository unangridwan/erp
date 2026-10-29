import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, schema, sql, type Db } from "@erp/db";
import {
  annualCostDelta,
  compensationCycleSchema,
  compensationProposalSchema,
  cycleBudget,
  gradeFlag,
  hasPermission,
  newWageFromPercent,
  percentFromWage,
  RAISE_BY_RATING,
  type CompensationCycleInput,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { Response } from "express";
import { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ApprovalEngineService } from "../hr/approval-engine.service.js";
import { ContractService } from "../hr/contract.service.js";
import { EmployeeService } from "../hr/employee.service.js";
import { HrModule } from "../hr/hr.module.js";
import { renderTotalRewardsPdf, type TotalRewardsData } from "./total-rewards-pdf.js";

const CY = schema.compensationCycles;
const PR = schema.compensationProposals;
const E = schema.employees;
const C = schema.contracts;
const REQ = schema.approvalRequests;
const CAT = schema.approvalCategories;

/** Kategori persetujuan untuk siklus kenaikan gaji (dibuat otomatis bila belum ada). */
const CATEGORY = {
  code: "KENAIKAN",
  name: "Kenaikan Gaji",
  prefix: "KNK",
  description: "Persetujuan siklus kenaikan gaji: daftar usulan, anggaran, dan tambahan biaya tahunan.",
  fields: { amount: "required", description: "required" } as const,
};

/** Label ringkas iuran BPJS perusahaan (nama baris slip memuat tarif). */
const BPJS_LABEL: Record<string, string> = {
  BPJS_KES_ER: "BPJS Kesehatan (perusahaan)",
  JHT_ER: "BPJS Jaminan Hari Tua (perusahaan)",
  JKK: "BPJS Jaminan Kecelakaan Kerja",
  JKM: "BPJS Jaminan Kematian",
  JP_ER: "BPJS Jaminan Pensiun (perusahaan)",
};

const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const editable = (state: string) => state === "draft";

type Cycle = typeof CY.$inferSelect;

/** Siklus kenaikan gaji: usulan dari rating appraisal, anggaran, persetujuan, penerapan ke kontrak. */
@Controller()
class CompensationController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get("compensation-cycles")
  @RequirePermission("payroll.read")
  list() {
    return this.tenantDb.run(async (tx) => {
      const cycles = await tx
        .select()
        .from(CY)
        .where(eq(CY.companyId, currentContext().companyId))
        .orderBy(desc(CY.effectiveDate), desc(CY.createdAt));
      const result = [];
      for (const raw of cycles) {
        const cycle = await this.sync(tx, raw);
        const proposals = await tx
          .select({ currentWage: PR.currentWage, newWage: PR.newWage })
          .from(PR)
          .where(eq(PR.cycleId, cycle.id));
        result.push({ ...cycle, count: proposals.length, budget: cycleBudget(cycle, proposals) });
      }
      return result;
    });
  }

  @Get("compensation-cycles/:id")
  @RequirePermission("payroll.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.detail(tx, id));
  }

  @Post("compensation-cycles")
  @RequirePermission("payroll.manage")
  create(@Body() body: unknown) {
    const input = parse(compensationCycleSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.assertRefs(tx, input);
      const ctx = currentContext();
      const [row] = await tx
        .insert(CY)
        .values({ ...this.values(input), companyId: ctx.companyId, createdBy: ctx.userId })
        .returning();
      return row!;
    });
  }

  @Patch("compensation-cycles/:id")
  @RequirePermission("payroll.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const cycle = await this.find(tx, id);
      if (!editable(cycle.state)) throw new BadRequestException("Hanya siklus draft yang bisa diubah");
      const input = parse(compensationCycleSchema, { ...cycle, ...(body as object) });
      await this.assertRefs(tx, input);
      await tx
        .update(CY)
        .set({ ...this.values(input), updatedAt: sql`now()` })
        .where(eq(CY.id, id));
      return this.detail(tx, id);
    });
  }

  @Delete("compensation-cycles/:id")
  @HttpCode(204)
  @RequirePermission("payroll.manage")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const cycle = await this.find(tx, id);
      if (cycle.state !== "draft" && cycle.state !== "cancel")
        throw new BadRequestException("Siklus yang sudah diajukan tidak bisa dihapus; batalkan saja");
      await tx.delete(CY).where(eq(CY.id, id));
    });
  }

  /**
   * Isi usulan untuk karyawan aktif yang punya kontrak berjalan (sesuai filter departemen/golongan). Saran kenaikan =
   * % dari kalibrasi appraisal terakhir yang selesai (atau bawaan per predikat). Karyawan yang sudah ada dilewati.
   */
  @Post("compensation-cycles/:id/generate")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  generate(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const cycle = await this.find(tx, id);
      if (!editable(cycle.state)) throw new BadRequestException("Hanya siklus draft yang bisa diubah");
      const rows = await tx
        .select({ employee: E, contract: C })
        .from(E)
        .innerJoin(C, and(eq(C.employeeId, E.id), eq(C.state, "running")))
        .where(
          and(
            eq(E.companyId, cycle.companyId),
            eq(E.active, true),
            or(isNull(E.resignDate), gte(E.resignDate, cycle.effectiveDate)),
            lte(C.dateStart, cycle.effectiveDate),
            cycle.departmentId ? eq(E.departmentId, cycle.departmentId) : undefined,
            cycle.gradeId ? eq(E.gradeId, cycle.gradeId) : undefined,
          ),
        );
      const existing = new Set(
        (await tx.select({ employeeId: PR.employeeId }).from(PR).where(eq(PR.cycleId, id))).map(
          (r) => r.employeeId,
        ),
      );
      let added = 0;
      for (const { employee, contract } of rows) {
        if (existing.has(employee.id)) continue;
        const [appraisal] = await tx
          .select()
          .from(schema.appraisals)
          .where(and(eq(schema.appraisals.employeeId, employee.id), eq(schema.appraisals.state, "done")))
          .orderBy(desc(schema.appraisals.doneAt))
          .limit(1);
        const suggested =
          appraisal?.raisePercent ?? (appraisal?.rating ? RAISE_BY_RATING[appraisal.rating] : 0);
        await tx.insert(PR).values({
          cycleId: id,
          employeeId: employee.id,
          contractId: contract.id,
          currentWage: contract.wage,
          appraisalId: appraisal?.id ?? null,
          rating: appraisal?.rating ?? null,
          suggestedPercent: String(suggested),
          proposedPercent: String(suggested),
          newWage: newWageFromPercent(contract.wage, suggested),
        });
        added++;
      }
      return { added, detail: await this.detail(tx, id) };
    });
  }

  /** Ubah usulan: HR (`payroll.manage`) atau atasan langsung karyawan, selama siklus masih draft. */
  @Put("compensation-proposals/:id")
  updateProposal(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(compensationProposalSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const [row] = await tx
        .select({ proposal: PR, cycle: CY, employee: E })
        .from(PR)
        .innerJoin(CY, eq(CY.id, PR.cycleId))
        .innerJoin(E, eq(E.id, PR.employeeId))
        .where(and(eq(PR.id, id), eq(CY.companyId, ctx.companyId)));
      if (!row) throw new NotFoundException("Usulan kenaikan tidak ditemukan");
      if (
        !hasPermission(ctx.permissions, "payroll.manage") &&
        !(await this.isManager(tx, row.employee.managerId))
      )
        throw new ForbiddenException("Hanya HR atau atasan langsung yang bisa mengubah usulan");
      if (!editable(row.cycle.state)) throw new BadRequestException("Siklus sudah diajukan; usulan terkunci");
      const newWage =
        input.newWage != null
          ? new Decimal(input.newWage).toFixed(0)
          : newWageFromPercent(row.proposal.currentWage, input.proposedPercent!);
      const [updated] = await tx
        .update(PR)
        .set({
          newWage,
          proposedPercent: percentFromWage(row.proposal.currentWage, newWage),
          reason: input.reason ?? null,
          proposedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(PR.id, id))
        .returning();
      return updated!;
    });
  }

  @Delete("compensation-proposals/:id")
  @HttpCode(204)
  @RequirePermission("payroll.manage")
  async removeProposal(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .select({ cycle: CY })
        .from(PR)
        .innerJoin(CY, eq(CY.id, PR.cycleId))
        .where(and(eq(PR.id, id), eq(CY.companyId, currentContext().companyId)));
      if (!row) throw new NotFoundException("Usulan kenaikan tidak ditemukan");
      if (!editable(row.cycle.state)) throw new BadRequestException("Siklus sudah diajukan; usulan terkunci");
      await tx.delete(PR).where(eq(PR.id, id));
    });
  }

  /** Ajukan siklus ke persetujuan (kategori "Kenaikan Gaji"); ditolak bila usulan melebihi anggaran. */
  @Post("compensation-cycles/:id/submit")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const cycle = await this.find(tx, id);
      if (!editable(cycle.state)) throw new BadRequestException("Siklus sudah diajukan");
      const detail = await this.detail(tx, id);
      if (!detail.proposals.length) throw new BadRequestException("Belum ada usulan kenaikan");
      if (detail.budget.overBudget)
        throw new BadRequestException(
          `Usulan melebihi anggaran Rp ${detail.budget.budget} (terpakai Rp ${detail.budget.used}); sesuaikan usulan atau anggaran`,
        );
      const categoryId = await this.category(tx, cycle.companyId);
      const raised = detail.proposals.filter((p) => p.newWage !== p.currentWage);
      const request = await this.approvals.createRequest(tx, {
        categoryId,
        subject: `Kenaikan gaji: ${cycle.name}`,
        reference: cycle.name,
        location: null,
        contact: null,
        date: cycle.effectiveDate,
        quantity: String(raised.length),
        amount: detail.annualCost,
        description: [
          `Berlaku ${cycle.effectiveDate}; ${raised.length} dari ${detail.proposals.length} karyawan naik.`,
          `Tambahan upah bulanan Rp ${detail.budget.used} dari anggaran Rp ${detail.budget.budget} (rata-rata ${detail.budget.averagePercent}%).`,
          `Tambahan biaya tahunan (upah 13 bulan + BPJS perusahaan): Rp ${detail.annualCost}.`,
        ].join("\n"),
      });
      await this.approvals.submit(tx, request.id);
      await tx
        .update(CY)
        .set({ state: "in_approval", approvalRequestId: request.id, updatedAt: sql`now()` })
        .where(eq(CY.id, id));
      await this.log(tx, id, `Siklus diajukan untuk persetujuan (${request.number ?? ""})`);
      return this.detail(tx, id);
    });
  }

  @Post("compensation-cycles/:id/cancel")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const cycle = await this.sync(tx, await this.find(tx, id));
      if (cycle.state === "applied" || cycle.state === "cancel")
        throw new BadRequestException("Siklus sudah diterapkan atau dibatalkan");
      if (cycle.approvalRequestId) {
        const [req] = await tx
          .select({ state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, cycle.approvalRequestId));
        if (req?.state === "submitted") await this.approvals.cancel(tx, cycle.approvalRequestId);
      }
      await tx
        .update(CY)
        .set({ state: "cancel", updatedAt: sql`now()` })
        .where(eq(CY.id, id));
      return this.detail(tx, id);
    });
  }

  /**
   * Terapkan siklus yang disetujui: kontrak baru dengan upah usulan per tanggal berlaku untuk setiap karyawan yang
   * upahnya berubah. Tanggal berlaku di masa lalu → hitung rapel di payroll berikutnya.
   */
  @Post("compensation-cycles/:id/apply")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  apply(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const cycle = await this.sync(tx, await this.find(tx, id));
      if (cycle.state !== "approved") throw new BadRequestException("Siklus belum disetujui");
      const proposals = await tx
        .select({ proposal: PR, employee: E, contractState: C.state })
        .from(PR)
        .innerJoin(E, eq(E.id, PR.employeeId))
        .innerJoin(C, eq(C.id, PR.contractId))
        .where(eq(PR.cycleId, id));
      let applied = 0;
      for (const { proposal, employee, contractState } of proposals) {
        if (new Decimal(proposal.newWage).eq(proposal.currentWage)) continue;
        if (contractState !== "running")
          throw new BadRequestException(
            `Kontrak ${employee.name} sudah berubah sejak usulan dibuat; perbarui usulan lewat siklus baru`,
          );
        const contract = await this.contracts.renewWage(tx, employee, {
          effectiveDate: cycle.effectiveDate,
          newWage: proposal.newWage,
          note: `Kenaikan gaji ${cycle.name}`,
        });
        await tx.update(PR).set({ newContractId: contract.id }).where(eq(PR.id, proposal.id));
        applied++;
      }
      const ctx = currentContext();
      await tx
        .update(CY)
        .set({ state: "applied", appliedAt: sql`now()`, appliedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(CY.id, id));
      await this.log(tx, id, `Siklus diterapkan: ${applied} kontrak baru berlaku ${cycle.effectiveDate}`);
      return { applied, detail: await this.detail(tx, id) };
    });
  }

  /** Portal atasan: usulan untuk bawahan langsung di siklus yang masih draft. */
  @Get("me/team-compensation")
  team() {
    return this.tenantDb.run(async (tx) => {
      const me = await this.employees.mine(tx);
      const rows = await tx
        .select({ proposal: PR, cycle: CY, employeeName: E.name, employeeNumber: E.employeeNumber })
        .from(PR)
        .innerJoin(CY, eq(CY.id, PR.cycleId))
        .innerJoin(E, eq(E.id, PR.employeeId))
        .where(and(eq(E.managerId, me.id), eq(CY.state, "draft"), eq(CY.companyId, me.companyId)))
        .orderBy(asc(CY.effectiveDate), asc(E.name));
      const cycles = new Map<
        string,
        { id: string; name: string; effectiveDate: string; proposals: unknown[] }
      >();
      for (const r of rows) {
        const c = cycles.get(r.cycle.id) ?? {
          id: r.cycle.id,
          name: r.cycle.name,
          effectiveDate: r.cycle.effectiveDate,
          proposals: [],
        };
        c.proposals.push({ ...r.proposal, employeeName: r.employeeName, employeeNumber: r.employeeNumber });
        cycles.set(r.cycle.id, c);
      }
      return [...cycles.values()];
    });
  }

  // ---- Total rewards ----

  @Get("employees/:id/total-rewards")
  @RequirePermission("payroll.read")
  totalRewards(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown) {
    const { year } = parse(yearQuery, query);
    return this.tenantDb.run(async (tx) => this.rewards(tx, (await this.employees.find(tx, id)).id, year));
  }

  @Get("employees/:id/total-rewards/pdf")
  @RequirePermission("payroll.read")
  async totalRewardsPdf(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    const { year } = parse(yearQuery, query);
    const data = await this.tenantDb.run(async (tx) =>
      this.rewards(tx, (await this.employees.find(tx, id)).id, year),
    );
    await this.sendPdf(res, data);
  }

  @Get("me/total-rewards")
  myRewards(@Query() query: unknown) {
    const { year } = parse(yearQuery, query);
    return this.tenantDb.run(async (tx) => this.rewards(tx, (await this.employees.mine(tx)).id, year));
  }

  @Get("me/total-rewards/pdf")
  async myRewardsPdf(@Query() query: unknown, @Res() res: Response) {
    const { year } = parse(yearQuery, query);
    const data = await this.tenantDb.run(async (tx) =>
      this.rewards(tx, (await this.employees.mine(tx)).id, year),
    );
    await this.sendPdf(res, data);
  }

  private async sendPdf(res: Response, data: TotalRewardsData) {
    const content = await renderTotalRewardsPdf(data);
    res
      .type("application/pdf")
      .attachment(`total-rewards-${data.employee.number}-${data.year}.pdf`.replace(/[^\w.-]+/g, "_"))
      .send(content);
  }

  /**
   * Total kompensasi setahun dari slip terposting: penghasilan tunai bruto (gaji, tunjangan, lembur, THR, rapel;
   * tanpa penggantian klaim biaya) dan yang dibayar perusahaan (BPJS perusahaan, porsi perusahaan benefit).
   */
  private async rewards(
    tx: Db,
    employeeId: string,
    year = new Date().getUTCFullYear(),
  ): Promise<TotalRewardsData> {
    const [employee] = await tx
      .select({
        name: E.name,
        number: E.employeeNumber,
        companyId: E.companyId,
        department: schema.departments.name,
        job: schema.jobPositions.name,
      })
      .from(E)
      .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
      .where(eq(E.id, employeeId));
    const [settings] = await tx
      .select({ thr: schema.payrollSettings.thrComponentId, retro: schema.payrollSettings.retroComponentId })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, employee!.companyId));
    const lines = await tx.execute<{
      category: string;
      code: string;
      name: string;
      component_id: string | null;
      expense_claim_id: string | null;
      benefit_plan_id: string | null;
      amount: string;
    }>(sql`
      select pl.category, pl.code, pl.name, pl.component_id, pl.expense_claim_id, pl.benefit_plan_id,
        sum(pl.amount)::text as amount
      from payslip_lines pl
      join payslips s on s.id = pl.payslip_id
      join payroll_runs r on r.id = s.run_id
      where s.employee_id = ${employeeId} and r.state in ('done', 'paid')
        and r.period_start >= ${`${year}-01-01`}::date and r.period_start <= ${`${year}-12-31`}::date
      group by pl.category, pl.code, pl.name, pl.component_id, pl.expense_claim_id, pl.benefit_plan_id`);
    const [{ months } = { months: 0 }] = await tx.execute<{ months: number }>(sql`
      select count(distinct r.period_start)::int as months
      from payslips s join payroll_runs r on r.id = s.run_id
      where s.employee_id = ${employeeId} and r.state in ('done', 'paid') and r.kind = 'regular'
        and r.period_start >= ${`${year}-01-01`}::date and r.period_start <= ${`${year}-12-31`}::date`);
    const cash = new Map<string, Decimal>();
    const employer = new Map<string, Decimal>();
    const add = (map: Map<string, Decimal>, key: string, amount: string) =>
      map.set(key, (map.get(key) ?? new Decimal(0)).plus(amount));
    for (const l of lines) {
      switch (l.category) {
        case "basic":
        case "unpaid":
          add(cash, "Gaji pokok", l.amount);
          break;
        case "overtime":
          add(cash, "Lembur", l.amount);
          break;
        case "allowance":
          if (l.expense_claim_id) break; // penggantian biaya, bukan kompensasi
          if (l.component_id && l.component_id === settings?.thr) add(cash, "THR", l.amount);
          else if (l.component_id && l.component_id === settings?.retro)
            add(cash, "Rapel kenaikan upah", l.amount);
          else add(cash, l.name, l.amount);
          break;
        case "bpjs_employer":
          add(employer, BPJS_LABEL[l.code] ?? l.name, l.amount);
          break;
        case "benefit_employer":
          add(employer, l.name, l.amount);
          break;
      }
    }
    const rows = (map: Map<string, Decimal>) =>
      [...map.entries()].filter(([, v]) => !v.isZero()).map(([name, v]) => ({ name, amount: v.toFixed(0) }));
    const sum = (r: { amount: string }[]) => r.reduce((s, x) => s.plus(x.amount), new Decimal(0));
    const cashRows = rows(cash);
    const employerRows = rows(employer);
    const [contract] = await tx
      .select({ wage: C.wage })
      .from(C)
      .where(and(eq(C.employeeId, employeeId), eq(C.state, "running")));
    const benefits = await tx
      .select({ name: schema.benefitPlans.name })
      .from(schema.benefitEnrollments)
      .innerJoin(schema.benefitPlans, eq(schema.benefitPlans.id, schema.benefitEnrollments.planId))
      .where(
        and(
          eq(schema.benefitEnrollments.employeeId, employeeId),
          or(
            isNull(schema.benefitEnrollments.dateEnd),
            gte(schema.benefitEnrollments.dateEnd, sql`current_date`),
          ),
        ),
      );
    const [company] = await tx
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, employee!.companyId));
    return {
      company: company?.name ?? "",
      year,
      employee: {
        name: employee!.name,
        number: employee!.number,
        department: employee!.department,
        job: employee!.job,
      },
      cash: cashRows,
      employer: employerRows,
      cashTotal: sum(cashRows).toFixed(0),
      employerTotal: sum(employerRows).toFixed(0),
      total: sum(cashRows).plus(sum(employerRows)).toFixed(0),
      months,
      currentWage: contract ? new Decimal(contract.wage).toFixed(0) : null,
      benefits: benefits.map((b) => b.name),
    };
  }

  // ---- internal ----

  /** Detail siklus: usulan + nama, golongan, peringatan skala, biaya tahunan, anggaran, status persetujuan. */
  private async detail(tx: Db, id: string) {
    const cycle = await this.sync(tx, await this.find(tx, id));
    const rows = await tx
      .select({
        proposal: PR,
        employeeName: E.name,
        employeeNumber: E.employeeNumber,
        managerId: E.managerId,
        department: schema.departments.name,
        grade: {
          name: schema.salaryGrades.name,
          minWage: schema.salaryGrades.minWage,
          maxWage: schema.salaryGrades.maxWage,
        },
      })
      .from(PR)
      .innerJoin(E, eq(E.id, PR.employeeId))
      .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
      .leftJoin(schema.salaryGrades, eq(schema.salaryGrades.id, E.gradeId))
      .where(eq(PR.cycleId, id))
      .orderBy(asc(schema.departments.name), asc(E.name));
    const contractIds = rows.map((r) => r.proposal.contractId);
    const fixed = contractIds.length
      ? await tx
          .select({
            contractId: schema.contractAllowances.contractId,
            amount: sql<string>`sum(${schema.contractAllowances.amount})::text`,
          })
          .from(schema.contractAllowances)
          .innerJoin(
            schema.salaryComponents,
            eq(schema.salaryComponents.id, schema.contractAllowances.componentId),
          )
          .where(
            and(
              inArray(schema.contractAllowances.contractId, contractIds),
              eq(schema.salaryComponents.fixed, true),
            ),
          )
          .groupBy(schema.contractAllowances.contractId)
      : [];
    const fixedOf = new Map(fixed.map((f) => [f.contractId, f.amount]));
    const proposals = rows.map((r) => {
      const p = r.proposal;
      return {
        ...p,
        currentWage: new Decimal(p.currentWage).toFixed(0),
        newWage: new Decimal(p.newWage).toFixed(0),
        employeeName: r.employeeName,
        employeeNumber: r.employeeNumber,
        department: r.department,
        grade: r.grade?.name ? r.grade : null,
        gradeFlag: gradeFlag(p.newWage, r.grade?.name ? r.grade : null),
        annualCost: annualCostDelta(p.currentWage, p.newWage, fixedOf.get(p.contractId) ?? 0),
      };
    });
    const [request] = cycle.approvalRequestId
      ? await tx
          .select({ id: REQ.id, number: REQ.number, state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, cycle.approvalRequestId))
      : [];
    return {
      ...cycle,
      proposals,
      budget: cycleBudget(cycle, proposals),
      annualCost: proposals.reduce((s, p) => s.plus(p.annualCost), new Decimal(0)).toFixed(0),
      approvalRequest: request ?? null,
    };
  }

  /** Status siklus mengikuti permintaan persetujuannya: disetujui → approved, ditolak/dibatalkan → kembali draft. */
  private async sync(tx: Db, cycle: Cycle): Promise<Cycle> {
    if (cycle.state !== "in_approval" || !cycle.approvalRequestId) return cycle;
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, cycle.approvalRequestId));
    const next =
      req?.state === "approved"
        ? "approved"
        : req?.state === "refused" || req?.state === "cancel"
          ? "draft"
          : null;
    if (!next) return cycle;
    const [row] = await tx
      .update(CY)
      .set({ state: next, ...(next === "draft" ? { approvalRequestId: null } : {}), updatedAt: sql`now()` })
      .where(eq(CY.id, cycle.id))
      .returning();
    await this.log(
      tx,
      cycle.id,
      next === "approved" ? "Siklus disetujui" : "Persetujuan ditolak/dibatalkan; siklus kembali draft",
    );
    return row!;
  }

  private async category(tx: Db, companyId: string) {
    const [found] = await tx
      .select({ id: CAT.id })
      .from(CAT)
      .where(and(eq(CAT.companyId, companyId), eq(CAT.code, CATEGORY.code)));
    if (found) return found.id;
    await this.approvals.ensureDefaults(tx, companyId);
    const [created] = await tx
      .insert(CAT)
      .values({ ...CATEGORY, companyId, managerFirst: false, sequence: 900 })
      .returning({ id: CAT.id });
    return created!.id;
  }

  private async isManager(tx: Db, managerId: string | null) {
    if (!managerId) return false;
    const [m] = await tx.select({ userId: E.userId }).from(E).where(eq(E.id, managerId));
    return !!m?.userId && m.userId === currentContext().userId;
  }

  private values(input: CompensationCycleInput) {
    return {
      name: input.name,
      effectiveDate: input.effectiveDate,
      budgetKind: input.budgetKind,
      budgetValue: input.budgetValue,
      departmentId: input.departmentId ?? null,
      gradeId: input.gradeId ?? null,
      note: input.note ?? null,
    };
  }

  private async assertRefs(tx: Db, input: CompensationCycleInput) {
    if (input.departmentId) {
      const [d] = await tx
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(
          and(
            eq(schema.departments.id, input.departmentId),
            eq(schema.departments.companyId, currentContext().companyId),
          ),
        );
      if (!d) throw fieldError("departmentId", "Departemen tidak ditemukan");
    }
    if (input.gradeId) {
      const [g] = await tx
        .select({ id: schema.salaryGrades.id })
        .from(schema.salaryGrades)
        .where(eq(schema.salaryGrades.id, input.gradeId));
      if (!g) throw fieldError("gradeId", "Golongan tidak ditemukan");
    }
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(CY)
      .where(and(eq(CY.id, id), eq(CY.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Siklus kenaikan gaji tidak ditemukan");
    return row;
  }

  private log(tx: Db, id: string, message: string) {
    return this.activity.log(tx, { resModel: "compensation_cycle", resId: id, action: "comment", message });
  }
}

@Module({
  imports: [HrModule],
  controllers: [CompensationController],
  providers: [ActivityService],
})
export class CompensationModule {}
