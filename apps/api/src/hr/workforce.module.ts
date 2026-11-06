import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, eq, inArray, schema, sql, type Db } from "@erp/db";
import {
  ageBand,
  AGE_BANDS,
  compaRatio,
  countBy,
  genderPayGap,
  hasPermission,
  highestEducation,
  manpowerBudgetSchema,
  median,
  parseCsv,
  RESIGN_REASON_LABEL,
  retentionRate,
  tenureBand,
  TENURE_BANDS,
  tenureYears,
  turnoverRate,
  variance,
  VOLUNTARY_REASONS,
  type EducationLevel,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { RequirePermission } from "../auth/decorators.js";
import { importBody } from "../common/crud.js";
import { parseXlsx, toXlsxBook, type XlsxSheet } from "../common/csv-import.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { HrModule } from "./hr.module.js";
import { contractTypes } from "./contract-types.module.js";

const MB = schema.manpowerBudgets;
const E = schema.employees;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NO_DEPT = "Tanpa departemen";

const yearQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
  departmentId: z.string().uuid().optional(),
  format: z.enum(["json", "xlsx"]).default("json"),
});
const EDUCATION_LABEL: Record<string, string> = { sma: "SMA/SMK", other: "Lainnya" };
const GENDER_LABEL: Record<string, string> = { male: "Laki-laki", female: "Perempuan" };
/** Angka impor: "1500000", "1500000.5" (sel Excel) atau format Indonesia "1.500.000,50". */
const num = (v: string) =>
  !v ? 0 : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : Number(v.replace(/[.\s]/g, "").replace(",", "."));
const can = (p: string) => hasPermission(currentContext().permissions, p);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthEnd = (year: number, m: number) => iso(new Date(Date.UTC(year, m, 0)));

/** Anggaran tenaga kerja (rencana vs aktual) & analitik SDM (turnover, retensi, demografi, kesetaraan gaji). */
@Controller()
class WorkforceController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  // ---- Anggaran ----

  @Get("manpower-budgets")
  @RequirePermission("hr.read")
  budgets(@Query() query: unknown) {
    const { year } = parse(yearQuery, query);
    return this.tenantDb.run((tx) => this.list(tx, year));
  }

  /** Ganti seluruh anggaran satu tahun (baris tanpa biaya untuk pengguna tanpa payroll.read mempertahankan biaya). */
  @Put("manpower-budgets")
  @RequirePermission("hr.manage")
  save(@Query() query: unknown, @Body() body: unknown) {
    const { year } = parse(yearQuery, query);
    const input = parse(manpowerBudgetSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.replace(tx, year, input.lines);
      return this.list(tx, year);
    });
  }

  @Get("manpower-budgets/template")
  @RequirePermission("hr.read")
  async template(@Query() query: unknown, @Res() res: Response) {
    const { year } = parse(yearQuery, query);
    const departments = await this.tenantDb.run((tx) =>
      tx
        .select({ name: schema.departments.name })
        .from(schema.departments)
        .where(eq(schema.departments.companyId, currentContext().companyId))
        .orderBy(asc(schema.departments.name)),
    );
    const sheets: XlsxSheet[] = [
      {
        name: `Anggaran ${year}`,
        columns: [
          { key: "department", header: "Departemen", width: 28 },
          { key: "job", header: "Jabatan", width: 24 },
          { key: "month", header: "Bulan", width: 10 },
          { key: "headcount", header: "Headcount", numeric: true },
          { key: "cost", header: "Biaya", numeric: true, width: 16 },
          { key: "note", header: "Catatan", width: 30 },
        ],
        rows: departments.flatMap((d) =>
          Array.from({ length: 12 }, (_, i) => ({
            department: d.name,
            month: i + 1,
            headcount: "",
            cost: "",
          })),
        ),
      },
      {
        name: "Petunjuk",
        columns: [
          { key: "k", header: "Kolom", width: 16 },
          { key: "v", header: "Keterangan", width: 90 },
        ],
        rows: [
          { k: "Departemen", v: "Nama departemen persis seperti di ERP; kosong = tanpa departemen" },
          { k: "Jabatan", v: "Opsional: nama jabatan untuk rencana per posisi" },
          { k: "Bulan", v: `1–12 atau ${year}-01 … ${year}-12` },
          { k: "Headcount", v: "Rencana jumlah karyawan di akhir bulan" },
          { k: "Biaya", v: "Rencana biaya tenaga kerja bulan itu (gaji + BPJS perusahaan), rupiah" },
          { k: "Impor", v: "Mengganti seluruh anggaran tahun ini" },
        ],
      },
    ];
    res
      .type(XLSX)
      .attachment(`anggaran-tenaga-kerja-${year}.xlsx`)
      .send(await toXlsxBook(sheets));
  }

  @Post("manpower-budgets/import")
  @HttpCode(200)
  @RequirePermission("hr.manage")
  import(@Query() query: unknown, @Body() body: unknown) {
    const { year } = parse(yearQuery, query);
    const input = parse(importBody, body);
    return this.tenantDb.run(async (tx) => {
      let raw: Record<string, string>[];
      try {
        raw = input.xlsx ? await parseXlsx(input.xlsx) : parseCsv(input.csv!);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : "Berkas tidak valid");
      }
      const companyId = currentContext().companyId;
      const depts = new Map(
        (
          await tx
            .select({ id: schema.departments.id, name: schema.departments.name })
            .from(schema.departments)
            .where(eq(schema.departments.companyId, companyId))
        ).map((d) => [d.name.trim().toLowerCase(), d.id]),
      );
      const jobs = new Map(
        (
          await tx
            .select({ id: schema.jobPositions.id, name: schema.jobPositions.name })
            .from(schema.jobPositions)
        ).map((j) => [j.name.trim().toLowerCase(), j.id]),
      );
      const get = (r: Record<string, string>, ...keys: string[]) => {
        const k = Object.keys(r).find((h) => keys.includes(h.trim().toLowerCase()));
        return (k ? r[k] : "")?.trim() ?? "";
      };
      const errors: { row: number; message: string }[] = [];
      const lines = [];
      for (const [i, r] of raw.entries()) {
        const headcount = get(r, "headcount");
        const cost = get(r, "biaya", "cost");
        if (!headcount && !cost) continue;
        const dName = get(r, "departemen", "department");
        const jName = get(r, "jabatan", "job");
        const m = get(r, "bulan", "month");
        const month = /^\d{4}-\d{2}$/.test(m) ? Number(m.slice(5)) : Number(m);
        const departmentId = dName ? depts.get(dName.toLowerCase()) : null;
        const jobId = jName ? jobs.get(jName.toLowerCase()) : null;
        const row = i + 2;
        if (dName && !departmentId) errors.push({ row, message: `Departemen "${dName}" tidak ditemukan` });
        else if (jName && !jobId) errors.push({ row, message: `Jabatan "${jName}" tidak ditemukan` });
        else if (!Number.isInteger(month) || month < 1 || month > 12)
          errors.push({ row, message: "Bulan harus 1–12" });
        else
          lines.push({
            departmentId: departmentId ?? null,
            jobId: jobId ?? null,
            month,
            headcount: num(headcount),
            cost: num(cost),
            note: get(r, "catatan", "note") || null,
          });
      }
      if (errors.length)
        throw new BadRequestException({
          message: "Impor anggaran gagal",
          errors: errors.map((e) => ({ path: `baris ${e.row}`, message: e.message })),
        });
      const parsed = parse(manpowerBudgetSchema, { lines });
      await this.replace(tx, year, parsed.lines);
      return { imported: parsed.lines.length };
    });
  }

  /** Rencana vs aktual per departemen & bulan: headcount akhir bulan, biaya dari slip terposting, lowongan terbuka. */
  @Get("manpower-budgets/report")
  @RequirePermission("hr.read")
  async report(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const { year, format } = parse(yearQuery, query);
    const data = await this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const showCost = can("payroll.read");
      const today = iso(new Date());
      const departments = await tx
        .select({ id: schema.departments.id, name: schema.departments.name })
        .from(schema.departments)
        .where(eq(schema.departments.companyId, companyId))
        .orderBy(asc(schema.departments.name));
      const budgets = await tx
        .select()
        .from(MB)
        .where(and(eq(MB.companyId, companyId), eq(MB.year, year)));
      const employees = await tx
        .select({ departmentId: E.departmentId, joinDate: E.joinDate, resignDate: E.resignDate })
        .from(E)
        .where(eq(E.companyId, companyId));
      const costs = showCost
        ? await tx.execute<{ department_id: string | null; month: number; cost: string }>(sql`
            select e.department_id, extract(month from r.period_start)::int as month,
              sum(s.earnings + s.kes_employer + s.tk_employer)::text as cost
            from payslips s
            join payroll_runs r on r.id = s.run_id
            join employees e on e.id = s.employee_id
            where s.company_id = ${companyId} and r.state in ('done', 'paid')
              and r.period_start >= ${`${year}-01-01`}::date and r.period_start <= ${`${year}-12-31`}::date
            group by 1, 2`)
        : [];
      const openings = await tx.execute<{ department_id: string | null; quota: number }>(sql`
        select department_id, sum(quota)::int as quota from job_openings
        where company_id = ${companyId} and state = 'open' group by 1`);
      const groups = [
        ...departments.map((d) => ({ id: d.id as string | null, name: d.name })),
        { id: null, name: NO_DEPT },
      ];
      const rows = groups
        .map((g) => {
          const months = Array.from({ length: 12 }, (_, i) => {
            const m = i + 1;
            const end = monthEnd(year, m);
            const plan = budgets.filter((b) => b.departmentId === g.id && b.month === m);
            const future = end > today && `${year}-${String(m).padStart(2, "0")}-01` > today;
            const actualHeadcount = future
              ? null
              : employees.filter(
                  (e) =>
                    e.departmentId === g.id && e.joinDate <= end && (!e.resignDate || e.resignDate > end),
                ).length;
            const plannedHeadcount = plan.reduce((s, b) => s + Number(b.headcount), 0);
            const plannedCost = plan.reduce((s, b) => s + Number(b.cost), 0);
            const actualCost = Number(
              costs.find((c) => c.department_id === g.id && c.month === m)?.cost ?? 0,
            );
            return {
              month: m,
              plannedHeadcount,
              actualHeadcount,
              headcountVariance:
                actualHeadcount === null ? null : variance(plannedHeadcount, actualHeadcount),
              ...(showCost
                ? { plannedCost, actualCost, costVariance: variance(plannedCost, actualCost) }
                : {}),
            };
          });
          const last = [...months].reverse().find((m) => m.actualHeadcount !== null) ?? months[0]!;
          const plannedCost = months.reduce((s, m) => s + (m.plannedCost ?? 0), 0);
          const actualCost = months.reduce((s, m) => s + (m.actualCost ?? 0), 0);
          return {
            departmentId: g.id,
            department: g.name,
            months,
            current: {
              month: last.month,
              plannedHeadcount: last.plannedHeadcount,
              actualHeadcount: last.actualHeadcount ?? 0,
              variance: variance(last.plannedHeadcount, last.actualHeadcount ?? 0),
            },
            openVacancies: openings.find((o) => o.department_id === g.id)?.quota ?? 0,
            ...(showCost ? { plannedCost, actualCost, costVariance: variance(plannedCost, actualCost) } : {}),
          };
        })
        .filter(
          (r) =>
            r.months.some((m) => m.plannedHeadcount || m.actualHeadcount || m.actualCost) || r.openVacancies,
        );
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
      const months = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        plannedHeadcount: sum((r) => r.months[i]!.plannedHeadcount),
        actualHeadcount: rows.every((r) => r.months[i]!.actualHeadcount === null)
          ? null
          : sum((r) => r.months[i]!.actualHeadcount ?? 0),
        ...(showCost
          ? {
              plannedCost: sum((r) => r.months[i]!.plannedCost ?? 0),
              actualCost: sum((r) => r.months[i]!.actualCost ?? 0),
            }
          : {}),
      }));
      return { year, showCost, rows, months };
    });
    if (format !== "xlsx") return data;
    const flat = data.rows.flatMap((r) =>
      r.months.map((m) => ({
        department: r.department,
        month: m.month,
        plannedHeadcount: m.plannedHeadcount,
        actualHeadcount: m.actualHeadcount ?? "",
        headcountDiff: m.headcountVariance?.diff ?? "",
        ...(data.showCost
          ? { plannedCost: m.plannedCost, actualCost: m.actualCost, costDiff: m.costVariance?.diff }
          : {}),
      })),
    );
    res.setHeader("Content-Type", XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="anggaran-vs-aktual-${year}.xlsx"`);
    res.send(
      await toXlsxBook([
        {
          name: `Anggaran vs aktual ${year}`,
          columns: [
            { key: "department", header: "Departemen", width: 28 },
            { key: "month", header: "Bulan" },
            { key: "plannedHeadcount", header: "Rencana headcount", numeric: true },
            { key: "actualHeadcount", header: "Aktual headcount", numeric: true },
            { key: "headcountDiff", header: "Selisih headcount", numeric: true },
            ...(data.showCost
              ? [
                  { key: "plannedCost", header: "Rencana biaya", numeric: true, width: 16 },
                  { key: "actualCost", header: "Aktual biaya", numeric: true, width: 16 },
                  { key: "costDiff", header: "Selisih biaya", numeric: true, width: 16 },
                ]
              : []),
          ],
          rows: flat,
        },
      ]),
    );
    return undefined;
  }

  // ---- Analitik ----

  /** Turnover & retensi, masa kerja, demografi, dan (dengan payroll.read) kesetaraan gaji per golongan × gender. */
  @Get("hr/analytics")
  @RequirePermission("hr.read")
  async analytics(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const { year, departmentId, format } = parse(yearQuery, query);
    const data = await this.tenantDb.run((tx) => this.compute(tx, year, departmentId));
    if (format !== "xlsx") return data;
    const list = (name: string, rows: { label: string; count: number }[]) => ({
      name,
      columns: [
        { key: "label", header: name, width: 28 },
        { key: "count", header: "Jumlah", numeric: true },
      ],
      rows,
    });
    const sheets: XlsxSheet[] = [
      {
        name: "Ringkasan",
        columns: [
          { key: "k", header: "Indikator", width: 36 },
          { key: "v", header: "Nilai", numeric: true },
        ],
        rows: Object.entries(data.summary).map(([k, v]) => ({ k: SUMMARY_LABEL[k] ?? k, v })),
      },
      {
        name: "Turnover per departemen",
        columns: [
          { key: "department", header: "Departemen", width: 28 },
          { key: "start", header: "Awal", numeric: true },
          { key: "end", header: "Akhir", numeric: true },
          { key: "leavers", header: "Keluar", numeric: true },
          { key: "turnover", header: "Turnover %", numeric: true },
        ],
        rows: data.byDepartment,
      },
      list("Alasan keluar", data.leaveReasons),
      list("Masa kerja saat keluar", data.leaversByTenure),
      list("Usia", data.distribution.age),
      list("Gender", data.distribution.gender),
      list("Pendidikan", data.distribution.education),
      list("Golongan", data.distribution.grade),
      list("Masa kerja", data.distribution.tenure),
    ];
    if (data.payEquity)
      sheets.push({
        name: "Kesetaraan gaji",
        columns: [
          { key: "grade", header: "Golongan", width: 24 },
          { key: "maleCount", header: "Jml L", numeric: true },
          { key: "maleMedian", header: "Median L", numeric: true, width: 16 },
          { key: "femaleCount", header: "Jml P", numeric: true },
          { key: "femaleMedian", header: "Median P", numeric: true, width: 16 },
          { key: "gap", header: "Kesenjangan %", numeric: true },
          { key: "compaRatio", header: "Compa-ratio rata-rata", numeric: true },
        ],
        rows: data.payEquity.byGrade,
      });
    res.setHeader("Content-Type", XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="analitik-sdm-${year}.xlsx"`);
    res.send(await toXlsxBook(sheets));
    return undefined;
  }

  private async compute(tx: Db, year: number, departmentId?: string) {
    const companyId = currentContext().companyId;
    const today = iso(new Date());
    const yStart = `${year}-01-01`;
    const yEnd = `${year}-12-31`;
    const asOf = yEnd < today ? yEnd : today;
    const all = await tx
      .select({
        id: E.id,
        gender: E.gender,
        birthDate: E.birthDate,
        joinDate: E.joinDate,
        resignDate: E.resignDate,
        resignReason: E.resignReason,
        departmentId: E.departmentId,
        department: schema.departments.name,
        gradeId: E.gradeId,
        grade: schema.salaryGrades.name,
        gradeMin: schema.salaryGrades.minWage,
        gradeMax: schema.salaryGrades.maxWage,
        gradeBase: schema.salaryGrades.baseWage,
      })
      .from(E)
      .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
      .leftJoin(schema.salaryGrades, eq(schema.salaryGrades.id, E.gradeId))
      .where(and(eq(E.companyId, companyId), departmentId ? eq(E.departmentId, departmentId) : undefined));
    const activeOn = (date: string) =>
      all.filter((e) => e.joinDate <= date && (!e.resignDate || e.resignDate > date));
    const startSet = all.filter((e) => e.joinDate < yStart && (!e.resignDate || e.resignDate >= yStart));
    const active = activeOn(asOf);
    const leavers = all.filter((e) => e.resignDate && e.resignDate >= yStart && e.resignDate <= asOf);
    const hires = all.filter((e) => e.joinDate >= yStart && e.joinDate <= asOf);
    const voluntary = leavers.filter((e) => VOLUNTARY_REASONS.includes(e.resignReason as "resign"));
    const stayed = startSet.filter((e) => !e.resignDate || e.resignDate > asOf).length;

    const education = active.length
      ? await tx
          .select({
            employeeId: schema.employeeEducation.employeeId,
            level: schema.employeeEducation.level,
            yearEnd: schema.employeeEducation.yearEnd,
          })
          .from(schema.employeeEducation)
          .where(
            inArray(
              schema.employeeEducation.employeeId,
              active.map((e) => e.id),
            ),
          )
      : [];
    const contracts = active.length
      ? await tx
          .select({
            employeeId: schema.contracts.employeeId,
            contractType: schema.contracts.contractType,
            wage: schema.contracts.wage,
          })
          .from(schema.contracts)
          .where(
            and(
              inArray(
                schema.contracts.employeeId,
                active.map((e) => e.id),
              ),
              eq(schema.contracts.state, "running"),
            ),
          )
      : [];
    const contractOf = new Map(contracts.map((c) => [c.employeeId, c]));
    const eduOf = (id: string) => {
      const best = highestEducation(
        education.filter((x) => x.employeeId === id) as { level: EducationLevel; yearEnd: number | null }[],
      );
      return best ? (EDUCATION_LABEL[best.level] ?? best.level.toUpperCase()) : null;
    };

    // Per departemen (berdasarkan departemen saat ini).
    const deptNames = [...new Set(all.map((e) => e.department ?? NO_DEPT))].sort((a, b) =>
      a.localeCompare(b, "id"),
    );
    const byDepartment = deptNames
      .map((name) => {
        const inDept = (e: (typeof all)[number]) => (e.department ?? NO_DEPT) === name;
        const start = startSet.filter(inDept).length;
        const end = active.filter(inDept).length;
        const out = leavers.filter(inDept).length;
        return {
          department: name,
          start,
          end,
          leavers: out,
          hires: hires.filter(inDept).length,
          turnover: turnoverRate(out, start, end),
        };
      })
      .filter((d) => d.start || d.end || d.leavers);

    const months = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, "0");
      const from = `${year}-${mm}-01`;
      const to = monthEnd(year, i + 1);
      const future = from > today;
      return {
        month: `${year}-${mm}`,
        headcount: future ? null : activeOn(to < today ? to : today).length,
        hires: all.filter((e) => e.joinDate >= from && e.joinDate <= to).length,
        leavers: all.filter((e) => e.resignDate && e.resignDate >= from && e.resignDate <= to).length,
      };
    });

    const tenures = active.map((e) => tenureYears(e.joinDate, asOf));
    const summary = {
      headcount: active.length,
      startHeadcount: startSet.length,
      hires: hires.length,
      leavers: leavers.length,
      turnover: turnoverRate(leavers.length, startSet.length, active.length),
      voluntaryTurnover: turnoverRate(voluntary.length, startSet.length, active.length),
      involuntaryTurnover: turnoverRate(leavers.length - voluntary.length, startSet.length, active.length),
      retention: retentionRate(startSet.length, stayed),
      averageTenure: tenures.length
        ? Math.round((tenures.reduce((s, t) => s + t, 0) / tenures.length) * 10) / 10
        : 0,
      averageAge: (() => {
        const ages = active.filter((e) => e.birthDate).map((e) => tenureYears(e.birthDate!, asOf));
        return ages.length ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10 : null;
      })(),
    };

    let payEquity: null | {
      overall: { maleMedian: number; femaleMedian: number; gap: number | null };
      byGrade: {
        grade: string;
        maleCount: number;
        maleMedian: number;
        femaleCount: number;
        femaleMedian: number;
        gap: number | null;
        compaRatio: number | null;
        below: number;
        above: number;
      }[];
    } = null;
    if (can("payroll.read")) {
      const paid = active
        .map((e) => ({ ...e, wage: Number(contractOf.get(e.id)?.wage ?? NaN) }))
        .filter((e) => Number.isFinite(e.wage) && e.wage > 0);
      const med = (rows: typeof paid, g: string) =>
        median(rows.filter((r) => r.gender === g).map((r) => r.wage));
      const grades = [...new Set(paid.map((p) => p.grade ?? "Tanpa golongan"))].sort((a, b) =>
        a.localeCompare(b, "id"),
      );
      payEquity = {
        overall: {
          maleMedian: med(paid, "male"),
          femaleMedian: med(paid, "female"),
          gap: genderPayGap(med(paid, "male"), med(paid, "female")),
        },
        byGrade: grades.map((grade) => {
          const rows = paid.filter((p) => (p.grade ?? "Tanpa golongan") === grade);
          const ratios = rows
            .map((r) =>
              compaRatio(
                r.wage,
                r.gradeId
                  ? {
                      minWage: r.gradeMin === null ? null : Number(r.gradeMin),
                      maxWage: r.gradeMax === null ? null : Number(r.gradeMax),
                      baseWage: r.gradeBase === null ? null : Number(r.gradeBase),
                    }
                  : null,
              ),
            )
            .filter((r): r is number => r !== null);
          return {
            grade,
            maleCount: rows.filter((r) => r.gender === "male").length,
            maleMedian: med(rows, "male"),
            femaleCount: rows.filter((r) => r.gender === "female").length,
            femaleMedian: med(rows, "female"),
            gap: genderPayGap(med(rows, "male"), med(rows, "female")),
            compaRatio: ratios.length
              ? Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100) / 100
              : null,
            below: ratios.filter((r) => r < 0.8).length,
            above: ratios.filter((r) => r > 1.2).length,
          };
        }),
      };
    }

    const typeNames = new Map((await contractTypes(tx)).map((t) => [t.code, t.name]));
    return {
      year,
      asOf,
      summary,
      months,
      byDepartment,
      leaveReasons: countBy(leavers, (e) =>
        e.resignReason ? RESIGN_REASON_LABEL[e.resignReason]?.[0] : null,
      ),
      leaversByTenure: countBy(leavers, (e) => tenureBand(e.joinDate, e.resignDate!), TENURE_BANDS),
      distribution: {
        age: countBy(active, (e) => ageBand(e.birthDate, asOf), AGE_BANDS),
        gender: countBy(active, (e) => (e.gender ? GENDER_LABEL[e.gender] : null)),
        education: countBy(active, (e) => eduOf(e.id)),
        grade: countBy(active, (e) => e.grade),
        department: countBy(active, (e) => e.department),
        contractType: countBy(active, (e) => {
          const t = contractOf.get(e.id)?.contractType;
          return t ? (typeNames.get(t) ?? t.toUpperCase()) : null;
        }),
        tenure: countBy(active, (e) => tenureBand(e.joinDate, asOf), TENURE_BANDS),
      },
      payEquity,
    };
  }

  private async list(tx: Db, year: number) {
    const rows = await tx
      .select({
        budget: MB,
        department: schema.departments.name,
        job: schema.jobPositions.name,
      })
      .from(MB)
      .leftJoin(schema.departments, eq(schema.departments.id, MB.departmentId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, MB.jobId))
      .where(and(eq(MB.companyId, currentContext().companyId), eq(MB.year, year)))
      .orderBy(asc(schema.departments.name), asc(schema.jobPositions.name), asc(MB.month));
    const showCost = can("payroll.read");
    return rows.map((r) => ({
      ...r.budget,
      cost: showCost ? r.budget.cost : null,
      department: r.department,
      job: r.job,
    }));
  }

  private async replace(
    tx: Db,
    year: number,
    lines: {
      departmentId?: string | null;
      jobId?: string | null;
      month: number;
      headcount: string;
      cost: string;
      note?: string | null;
    }[],
  ) {
    const companyId = currentContext().companyId;
    const ids = [...new Set(lines.flatMap((l) => (l.departmentId ? [l.departmentId] : [])))];
    if (ids.length) {
      const found = await tx
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(and(eq(schema.departments.companyId, companyId), inArray(schema.departments.id, ids)));
      if (found.length !== ids.length) throw fieldError("lines", "Departemen tidak ditemukan");
    }
    const jobIds = [...new Set(lines.flatMap((l) => (l.jobId ? [l.jobId] : [])))];
    if (jobIds.length) {
      const found = await tx
        .select({ id: schema.jobPositions.id })
        .from(schema.jobPositions)
        .where(inArray(schema.jobPositions.id, jobIds));
      if (found.length !== jobIds.length) throw fieldError("lines", "Jabatan tidak ditemukan");
    }
    // Pengguna tanpa payroll.read tidak melihat biaya: biaya lama dipertahankan.
    const keepCost = !can("payroll.read");
    const old = keepCost
      ? await tx
          .select()
          .from(MB)
          .where(and(eq(MB.companyId, companyId), eq(MB.year, year)))
      : [];
    const costOf = (l: (typeof lines)[number]) =>
      keepCost
        ? (old.find(
            (o) =>
              o.departmentId === (l.departmentId ?? null) &&
              o.jobId === (l.jobId ?? null) &&
              o.month === l.month,
          )?.cost ?? "0")
        : l.cost;
    await tx.delete(MB).where(and(eq(MB.companyId, companyId), eq(MB.year, year)));
    if (lines.length)
      await tx.insert(MB).values(
        lines.map((l) => ({
          companyId,
          year,
          month: l.month,
          departmentId: l.departmentId ?? null,
          jobId: l.jobId ?? null,
          headcount: l.headcount,
          cost: costOf(l),
          note: l.note ?? null,
        })),
      );
  }
}

const SUMMARY_LABEL: Record<string, string> = {
  headcount: "Headcount aktif",
  startHeadcount: "Headcount awal tahun",
  hires: "Karyawan masuk",
  leavers: "Karyawan keluar",
  turnover: "Turnover %",
  voluntaryTurnover: "Turnover sukarela %",
  involuntaryTurnover: "Turnover tidak sukarela %",
  retention: "Retensi %",
  averageTenure: "Rata-rata masa kerja (tahun)",
  averageAge: "Rata-rata usia (tahun)",
};

@Module({ imports: [HrModule], controllers: [WorkforceController] })
export class WorkforceModule {}
