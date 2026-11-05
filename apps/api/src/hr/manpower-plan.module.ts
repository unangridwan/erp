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
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { and, asc, eq, inArray, isNull, ne, or, schema, sql, type Db } from "@erp/db";
import {
  DEFAULT_BPJS,
  hasPermission,
  lineRealization,
  manpowerPlanCreateSchema,
  manpowerPlanSchema,
  planMonthly,
  planSummary,
  type BpjsSettings,
  type ManpowerLine,
  type ManpowerPlanInput,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { Response } from "express";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { toXlsxBook } from "../common/csv-import.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ApprovalEngineService } from "./approval-engine.service.js";
import { HrModule } from "./hr.module.js";

const P = schema.manpowerPlans;
const L = schema.manpowerPlanLines;
const E = schema.employees;
const D = schema.departments;
const J = schema.jobPositions;
const G = schema.salaryGrades;
const OP = schema.jobOpenings;
const REQ = schema.approvalRequests;
const CAT = schema.approvalCategories;
const MB = schema.manpowerBudgets;

/** Kategori persetujuan Man Power Planning (dibuat otomatis bila belum ada). */
const CATEGORY = {
  code: "MPP",
  name: "Man Power Planning",
  prefix: "MPP",
  description: "Persetujuan rencana tenaga kerja departemen per tahun: posisi, headcount, dan biaya tahunan.",
  fields: { amount: "required", description: "required" } as const,
};

const yearQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
});
const can = (p: string) => hasPermission(currentContext().permissions, p);
const money = (v: number) => new Decimal(v).toFixed(0);

type Plan = typeof P.$inferSelect;
type LineInput = NonNullable<ManpowerPlanInput["lines"]>[number];

/**
 * Man Power Planning: rencana posisi per departemen per tahun (terisi, tambahan, pengganti), persetujuan lewat
 * mesin persetujuan, lalu mengisi Anggaran Tenaga Kerja (per jabatan × bulan) dan Anggaran Akuntansi (akun beban gaji &
 * BPJS); posisi tambahan/pengganti dijadikan lowongan dan realisasinya dilacak dari pelamar yang diterima.
 */
@Controller()
class ManpowerPlanController implements OnModuleInit {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ApprovalEngineService) private readonly approvals: ApprovalEngineService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    // Keputusan persetujuan langsung memperbarui status MPP & anggaran (dalam transaksi keputusan).
    this.approvals.onOutcome(async (tx, requestId) => {
      const [plan] = await tx.select().from(P).where(eq(P.approvalRequestId, requestId));
      if (plan) await this.sync(tx, plan);
    });
  }

  @Get("manpower-plans")
  list(@Query() query: unknown) {
    const { year } = parse(yearQuery, query);
    return this.tenantDb.run(async (tx) => {
      const companyId = currentContext().companyId;
      const headOf = await this.headedDepartments(tx);
      if (!can("hr.read") && !headOf.length) throw new ForbiddenException("Butuh permission hr.read");
      const scope = can("hr.read") ? undefined : inArray(D.id, headOf);
      const departments = await tx
        .select({ id: D.id, name: D.name })
        .from(D)
        .where(and(eq(D.companyId, companyId), eq(D.active, true), scope))
        .orderBy(asc(D.name));
      const plans = await tx
        .select()
        .from(P)
        .where(and(eq(P.companyId, companyId), eq(P.year, year), ne(P.state, "cancel")));
      const bpjs = await this.bpjs(tx, companyId);
      const lines = plans.length
        ? await tx
            .select()
            .from(L)
            .where(
              inArray(
                L.planId,
                plans.map((p) => p.id),
              ),
            )
        : [];
      const openings = await this.openingStats(tx, lines);
      const showCost = can("payroll.read");
      const rows = departments.map((dept) => {
        const plan = plans.find((p) => p.departmentId === dept.id);
        if (!plan)
          return {
            departmentId: dept.id,
            department: dept.name,
            plan: null,
            canEdit: this.canEditDept(headOf, dept.id),
            isHead: headOf.includes(dept.id),
          };
        const ls = lines.filter((l) => l.planId === plan.id);
        const s = planSummary(ls.map(toLine), bpjs, plan.thrMonth);
        const toFill = ls.filter((l) => l.kind !== "existing");
        return {
          departmentId: dept.id,
          department: dept.name,
          canEdit: this.canEditDept(headOf, dept.id),
          isHead: headOf.includes(dept.id),
          plan: {
            id: plan.id,
            name: plan.name,
            state: plan.state,
            startHeadcount: s.startHeadcount,
            endHeadcount: s.endHeadcount,
            additions: s.additions,
            replacements: s.replacements,
            annualCost: showCost ? s.annualCost : null,
            toFill: toFill.reduce((n, l) => n + l.quantity, 0),
            filled: toFill.reduce((n, l) => n + Math.min(l.quantity, openings.get(l.id)?.hired ?? 0), 0),
          },
        };
      });
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
      return {
        year,
        showCost,
        canManage: can("hr.manage"),
        rows,
        totals: {
          approved: rows.filter((r) => r.plan?.state === "approved").length,
          endHeadcount: sum((r) => r.plan?.endHeadcount ?? 0),
          additions: sum((r) => r.plan?.additions ?? 0),
          annualCost: showCost ? sum((r) => r.plan?.annualCost ?? 0) : null,
          toFill: sum((r) => r.plan?.toFill ?? 0),
          filled: sum((r) => r.plan?.filled ?? 0),
        },
      };
    });
  }

  /** Buat MPP departemen; baris "posisi terisi" diisi dari karyawan aktif per jabatan + rata-rata upah kontrak. */
  @Post("manpower-plans")
  create(@Body() body: unknown) {
    const input = parse(manpowerPlanCreateSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const [dept] = await tx
        .select()
        .from(D)
        .where(and(eq(D.id, input.departmentId), eq(D.companyId, ctx.companyId)));
      if (!dept) throw new NotFoundException("Departemen tidak ditemukan");
      await this.assertCanEdit(tx, dept.id);
      const [dup] = await tx
        .select({ id: P.id })
        .from(P)
        .where(
          and(
            eq(P.companyId, ctx.companyId),
            eq(P.year, input.year),
            eq(P.departmentId, dept.id),
            ne(P.state, "cancel"),
          ),
        );
      if (dup) throw new BadRequestException("MPP departemen ini untuk tahun tersebut sudah ada");
      const [plan] = await tx
        .insert(P)
        .values({
          companyId: ctx.companyId,
          year: input.year,
          departmentId: dept.id,
          name: input.name ?? `MPP ${dept.name} ${input.year}`,
          thrMonth: input.thrMonth ?? null,
          note: input.note ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (input.lines) await this.writeLines(tx, plan!.id, input.lines, []);
      else await this.writeLines(tx, plan!.id, await this.existingLines(tx, dept.id, input.year), [], true);
      await this.log(tx, plan!.id, "MPP dibuat");
      return this.detail(tx, plan!.id);
    });
  }

  @Get("manpower-plans/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanRead(tx, plan.departmentId);
      return this.detail(tx, id);
    });
  }

  /** Ubah header & ganti baris (hanya draft). */
  @Put("manpower-plans/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(manpowerPlanSchema, body);
    return this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanEdit(tx, plan.departmentId);
      if (plan.state !== "draft") throw new BadRequestException("Hanya MPP draft yang bisa diubah");
      await tx
        .update(P)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.thrMonth !== undefined ? { thrMonth: input.thrMonth ?? null } : {}),
          ...(input.note !== undefined ? { note: input.note ?? null } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(P.id, id));
      if (input.lines) {
        const old = await tx.select().from(L).where(eq(L.planId, id));
        await this.writeLines(tx, id, input.lines, old);
      }
      return this.detail(tx, id);
    });
  }

  @Delete("manpower-plans/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanEdit(tx, plan.departmentId);
      if (plan.state !== "draft") throw new BadRequestException("Hanya MPP draft yang bisa dihapus");
      await tx.delete(P).where(eq(P.id, id));
    });
  }

  /** Ajukan ke persetujuan (kategori "Man Power Planning"). */
  @Post("manpower-plans/:id/submit")
  @HttpCode(200)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanEdit(tx, plan.departmentId);
      if (plan.state !== "draft") throw new BadRequestException("MPP sudah diajukan");
      const lines = await tx.select().from(L).where(eq(L.planId, id));
      if (!lines.length) throw new BadRequestException("Belum ada posisi dalam MPP");
      const [dept] = await tx.select({ name: D.name }).from(D).where(eq(D.id, plan.departmentId));
      const s = planSummary(lines.map(toLine), await this.bpjs(tx, plan.companyId), plan.thrMonth);
      const request = await this.approvals.createRequest(tx, {
        categoryId: await this.category(tx, plan.companyId),
        subject: `${plan.name}`,
        reference: plan.name,
        location: null,
        contact: null,
        date: `${plan.year}-01-01`,
        quantity: String(s.additions),
        amount: money(s.annualCost),
        description: [
          `Departemen ${dept?.name ?? ""}, tahun ${plan.year}.`,
          `Headcount ${s.startHeadcount} → ${s.endHeadcount} (tambahan ${s.additions}, pengganti ${s.replacements}).`,
          `Biaya tahunan (gaji + tunjangan${plan.thrMonth ? " + THR" : ""} + BPJS perusahaan): Rp ${money(s.annualCost)}.`,
        ].join("\n"),
      });
      await this.approvals.submit(tx, request.id);
      await tx
        .update(P)
        .set({
          state: "in_approval",
          approvalRequestId: request.id,
          submittedBy: currentContext().userId,
          submittedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(P.id, id));
      await this.log(tx, id, `MPP diajukan untuk persetujuan (${request.number ?? ""})`);
      return this.detail(tx, id);
    });
  }

  /** Batalkan: pengajuan berjalan dibatalkan; MPP disetujui dicabut dari anggaran. */
  @Post("manpower-plans/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanEdit(tx, plan.departmentId);
      if (plan.state === "cancel") throw new BadRequestException("MPP sudah dibatalkan");
      if (plan.state === "approved" && !can("hr.manage"))
        throw new ForbiddenException("Butuh permission hr.manage untuk membatalkan MPP yang disetujui");
      if (plan.state === "in_approval" && plan.approvalRequestId) {
        const [req] = await tx
          .select({ state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, plan.approvalRequestId));
        if (req?.state === "submitted") await this.approvals.cancel(tx, plan.approvalRequestId);
      }
      await tx
        .update(P)
        .set({ state: "cancel", updatedAt: sql`now()` })
        .where(eq(P.id, id));
      // FPK draft dari MPP ini ikut batal (yang sudah diajukan/disetujui tetap, diputuskan terpisah).
      const H = schema.hiringRequests;
      await tx
        .update(H)
        .set({ state: "cancel", updatedAt: sql`now()` })
        .where(
          and(
            eq(H.state, "draft"),
            inArray(H.manpowerPlanLineId, tx.select({ id: L.id }).from(L).where(eq(L.planId, id))),
          ),
        );
      if (plan.state === "approved") {
        await tx.delete(MB).where(eq(MB.sourcePlanId, id));
        await this.rebuildAccounting(tx, plan.companyId, plan.year);
      }
      await this.log(tx, id, "MPP dibatalkan");
      return this.detail(tx, id);
    });
  }

  /** Revisi MPP yang disetujui: kembali draft; anggaran lama berlaku sampai revisi disetujui. */
  @Post("manpower-plans/:id/revise")
  @HttpCode(200)
  revise(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanEdit(tx, plan.departmentId);
      if (plan.state !== "approved")
        throw new BadRequestException("Hanya MPP yang disetujui yang bisa direvisi");
      await tx
        .update(P)
        .set({ state: "draft", approvalRequestId: null, updatedAt: sql`now()` })
        .where(eq(P.id, id));
      await this.log(tx, id, "MPP direvisi (kembali draft; anggaran lama tetap berlaku)");
      return this.detail(tx, id);
    });
  }

  /** Lowongan kini dibuka lewat FPK yang disetujui (`POST /manpower-plan-lines/:id/hiring-request`). */
  @Post("manpower-plan-lines/:id/job-opening")
  openJob() {
    throw new BadRequestException(
      "Lowongan dari MPP dibuka lewat Usulan Penambahan Karyawan (FPK): ajukan FPK dari baris ini, lalu buka lowongan setelah disetujui",
    );
  }

  @Get("manpower-plans/:id/export")
  async export(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.tenantDb.run(async (tx) => {
      const plan = await this.find(tx, id);
      await this.assertCanRead(tx, plan.departmentId);
      return this.detail(tx, id);
    });
    const showCost = d.showCost;
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment(`mpp-${d.department.replace(/\W+/g, "-").toLowerCase()}-${d.year}.xlsx`)
      .send(
        await toXlsxBook([
          {
            name: "Posisi",
            columns: [
              { key: "job", header: "Jabatan", width: 26 },
              { key: "grade", header: "Golongan", width: 14 },
              { key: "kind", header: "Jenis", width: 14 },
              { key: "quantity", header: "Jumlah", numeric: true },
              { key: "startMonth", header: "Mulai", numeric: true },
              { key: "endMonth", header: "Sampai", numeric: true },
              ...(showCost
                ? [
                    { key: "monthlyWage", header: "Upah/bulan", numeric: true, width: 16 },
                    { key: "monthlyAllowance", header: "Tunjangan/bulan", numeric: true, width: 16 },
                  ]
                : []),
              { key: "reason", header: "Alasan", width: 36 },
              { key: "realization", header: "Realisasi", width: 14 },
            ],
            rows: d.lines.map((l) => ({
              ...l,
              kind: { existing: "Posisi terisi", new: "Tambahan", replacement: "Pengganti" }[l.kind],
              realization: l.realization ? `${l.hired}/${l.quantity}` : "",
            })),
          },
          {
            name: "Per bulan",
            columns: [
              { key: "month", header: "Bulan", numeric: true },
              { key: "headcount", header: "Headcount", numeric: true },
              ...(showCost
                ? [
                    { key: "salary", header: "Gaji + tunjangan + THR", numeric: true, width: 18 },
                    { key: "bpjsKes", header: "BPJS Kesehatan", numeric: true, width: 16 },
                    { key: "bpjsTk", header: "BPJS Ketenagakerjaan", numeric: true, width: 18 },
                    { key: "cost", header: "Total biaya", numeric: true, width: 18 },
                  ]
                : []),
            ],
            rows: d.summary.months,
          },
        ]),
      );
  }

  // ---- internal ----

  /** Status MPP mengikuti permintaan persetujuan; disetujui → isi anggaran tenaga kerja & akuntansi. */
  private async sync(tx: Db, plan: Plan): Promise<Plan> {
    if (plan.state !== "in_approval" || !plan.approvalRequestId) return plan;
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, plan.approvalRequestId));
    const next =
      req?.state === "approved"
        ? "approved"
        : req?.state === "refused" || req?.state === "cancel"
          ? "draft"
          : null;
    if (!next) return plan;
    const [row] = await tx
      .update(P)
      .set({
        state: next,
        ...(next === "approved" ? { approvedAt: new Date() } : { approvalRequestId: null }),
        updatedAt: sql`now()`,
      })
      .where(eq(P.id, plan.id))
      .returning();
    if (next === "approved") {
      await this.applyBudget(tx, row!);
      await this.log(tx, plan.id, "MPP disetujui; anggaran tenaga kerja & akuntansi diperbarui");
    } else await this.log(tx, plan.id, "Persetujuan ditolak/dibatalkan; MPP kembali draft");
    return row!;
  }

  /** Ganti anggaran tenaga kerja departemen × tahun dengan rencana per jabatan × bulan, lalu bangun ulang akuntansi. */
  private async applyBudget(tx: Db, plan: Plan) {
    const lines = await tx.select().from(L).where(eq(L.planId, plan.id));
    const bpjs = await this.bpjs(tx, plan.companyId);
    await tx
      .delete(MB)
      .where(
        and(eq(MB.companyId, plan.companyId), eq(MB.year, plan.year), eq(MB.departmentId, plan.departmentId)),
      );
    const rows = [];
    for (const jobId of [...new Set(lines.map((l) => l.jobId))]) {
      const months = planMonthly(lines.filter((l) => l.jobId === jobId).map(toLine), bpjs, plan.thrMonth);
      for (const m of months)
        if (m.headcount || m.cost)
          rows.push({
            companyId: plan.companyId,
            year: plan.year,
            month: m.month,
            departmentId: plan.departmentId,
            jobId,
            headcount: m.headcount.toFixed(2),
            cost: m.cost.toFixed(2),
            note: plan.name,
            sourcePlanId: plan.id,
          });
    }
    if (rows.length) await tx.insert(MB).values(rows);
    await this.rebuildAccounting(tx, plan.companyId, plan.year);
  }

  /**
   * Anggaran akuntansi "Anggaran SDM {tahun}" (source = manpower) dari seluruh MPP disetujui tahun itu: akun beban gaji,
   * BPJS Kesehatan, BPJS Ketenagakerjaan dari pengaturan payroll. Mengembalikan alasan bila dilewati.
   */
  private async rebuildAccounting(tx: Db, companyId: string, year: number): Promise<string | null> {
    const B = schema.budgets;
    const [settings] = await tx
      .select()
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    const [existing] = await tx
      .select({ id: B.id })
      .from(B)
      .where(and(eq(B.companyId, companyId), eq(B.source, "manpower"), eq(B.sourceYear, year)));
    const plans = await tx
      .select()
      .from(P)
      .where(and(eq(P.companyId, companyId), eq(P.year, year), eq(P.state, "approved")));
    if (!plans.length) {
      if (existing) await tx.delete(B).where(eq(B.id, existing.id));
      return null;
    }
    if (!settings) return "Pengaturan payroll belum diisi; anggaran akuntansi belum dibuat";
    const bpjs = toBpjs(settings);
    const lines = await tx
      .select()
      .from(L)
      .where(
        inArray(
          L.planId,
          plans.map((p) => p.id),
        ),
      );
    let salary = new Decimal(0);
    let kes = new Decimal(0);
    let tk = new Decimal(0);
    for (const p of plans) {
      const s = planSummary(lines.filter((l) => l.planId === p.id).map(toLine), bpjs, p.thrMonth);
      salary = salary.plus(s.salary);
      kes = kes.plus(s.bpjsKes);
      tk = tk.plus(s.bpjsTk);
    }
    const values = { name: `Anggaran SDM ${year}`, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
    let budgetId = existing?.id;
    if (budgetId)
      await tx
        .update(B)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(B.id, budgetId));
    else
      budgetId = (
        await tx
          .insert(B)
          .values({ ...values, companyId, source: "manpower", sourceYear: year })
          .returning({ id: B.id })
      )[0]!.id;
    await tx.delete(schema.budgetLines).where(eq(schema.budgetLines.budgetId, budgetId));
    // Akun yang sama (mis. BPJS digabung ke akun gaji) dijumlahkan menjadi satu baris.
    const byAccount = new Map<string, Decimal>();
    for (const [account, amount] of [
      [settings.salaryExpenseAccountId, salary],
      [settings.bpjsKesExpenseAccountId, kes],
      [settings.bpjsTkExpenseAccountId, tk],
    ] as const)
      byAccount.set(account, (byAccount.get(account) ?? new Decimal(0)).plus(amount));
    const budgetLines = [...byAccount.entries()]
      .filter(([, amount]) => amount.gt(0))
      .map(([accountId, amount]) => ({ budgetId: budgetId!, accountId, amount: amount.toFixed(2) }));
    if (budgetLines.length) await tx.insert(schema.budgetLines).values(budgetLines);
    return null;
  }

  private async detail(tx: Db, id: string) {
    const plan = await this.sync(tx, await this.find(tx, id));
    const [dept] = await tx.select({ name: D.name }).from(D).where(eq(D.id, plan.departmentId));
    const rows = await tx
      .select({
        line: L,
        job: J.name,
        grade: G.name,
        replaces: E.name,
        opening: OP.name,
        openingState: OP.state,
      })
      .from(L)
      .leftJoin(J, eq(J.id, L.jobId))
      .leftJoin(G, eq(G.id, L.gradeId))
      .leftJoin(E, eq(E.id, L.replacesEmployeeId))
      .leftJoin(OP, eq(OP.id, L.jobOpeningId))
      .where(eq(L.planId, id))
      .orderBy(asc(L.sequence));
    const bpjs = await this.bpjs(tx, plan.companyId);
    const s = planSummary(
      rows.map((r) => toLine(r.line)),
      bpjs,
      plan.thrMonth,
    );
    const stats = await this.openingStats(
      tx,
      rows.map((r) => r.line),
    );
    const showCost = can("payroll.read");
    const [request] = plan.approvalRequestId
      ? await tx
          .select({ id: REQ.id, number: REQ.number, state: REQ.state })
          .from(REQ)
          .where(eq(REQ.id, plan.approvalRequestId))
      : [];
    const [accounting] = await tx
      .select({ id: schema.budgets.id, name: schema.budgets.name })
      .from(schema.budgets)
      .where(
        and(
          eq(schema.budgets.companyId, plan.companyId),
          eq(schema.budgets.source, "manpower"),
          eq(schema.budgets.sourceYear, plan.year),
        ),
      );
    const [settings] = await tx
      .select({ id: schema.payrollSettings.companyId })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, plan.companyId));
    const hidden = <T>(v: T) => (showCost ? v : null);
    // Opsi editor (kepala departemen mungkin tidak punya akses daftar jabatan/karyawan).
    const jobs = await tx
      .select({ id: J.id, name: J.name, gradeId: J.gradeId })
      .from(J)
      .where(eq(J.active, true))
      .orderBy(asc(J.name));
    const grades = await tx.select({ id: G.id, name: G.name }).from(G).orderBy(asc(G.name));
    const employees = await tx
      .select({ id: E.id, name: E.name, jobId: E.jobId })
      .from(E)
      .where(eq(E.departmentId, plan.departmentId))
      .orderBy(asc(E.name));
    const headOf = await this.headedDepartments(tx);
    return {
      ...plan,
      department: dept?.name ?? "",
      showCost,
      canEdit: this.canEditDept(headOf, plan.departmentId),
      canManage: can("hr.manage"),
      lines: rows.map((r) => {
        const st = stats.get(r.line.id);
        const fill = r.line.kind !== "existing";
        return {
          ...r.line,
          monthlyWage: hidden(r.line.monthlyWage),
          monthlyAllowance: hidden(r.line.monthlyAllowance),
          job: r.job,
          grade: r.grade,
          replaces: r.replaces,
          opening: r.opening,
          openingState: r.openingState,
          hired: st?.hired ?? 0,
          applicants: st?.applicants ?? 0,
          realization: fill ? lineRealization(r.line.quantity, !!r.line.jobOpeningId, st?.hired ?? 0) : null,
        };
      }),
      summary: {
        ...s,
        salary: hidden(s.salary),
        bpjsKes: hidden(s.bpjsKes),
        bpjsTk: hidden(s.bpjsTk),
        annualCost: hidden(s.annualCost),
        months: s.months.map((m) => ({
          month: m.month,
          headcount: m.headcount,
          ...(showCost ? { salary: m.salary, bpjsKes: m.bpjsKes, bpjsTk: m.bpjsTk, cost: m.cost } : {}),
        })),
      },
      approvalRequest: request ?? null,
      accountingBudget: accounting ?? null,
      options: { jobs, grades, employees },
      warnings:
        plan.state === "approved" && !settings
          ? ["Pengaturan payroll belum diisi; anggaran akuntansi belum dibuat"]
          : [],
    };
  }

  /** Pelamar per baris dari semua lowongan baris itu (lewat FPK); diterima = tahap hired. */
  private async openingStats(tx: Db, lines: { id: string; jobOpeningId: string | null }[]) {
    const out = new Map<string, { hired: number; applicants: number }>();
    if (!lines.length) return out;
    const A = schema.applicants;
    const rows = await tx
      .select({
        lineId: OP.manpowerPlanLineId,
        applicants: sql<number>`count(${A.id})::int`,
        hired: sql<number>`count(${A.id}) filter (where ${A.stage} = 'hired')::int`,
      })
      .from(OP)
      .leftJoin(A, eq(A.openingId, OP.id))
      .where(
        inArray(
          OP.manpowerPlanLineId,
          lines.map((l) => l.id),
        ),
      )
      .groupBy(OP.manpowerPlanLineId);
    for (const r of rows) if (r.lineId) out.set(r.lineId, { hired: r.hired, applicants: r.applicants });
    return out;
  }

  /** Baris "posisi terisi" dari karyawan aktif departemen per jabatan, upah = rata-rata kontrak berjalan. */
  private async existingLines(tx: Db, departmentId: string, year: number): Promise<LineInput[]> {
    const rows = await tx
      .select({
        jobId: E.jobId,
        gradeId: E.gradeId,
        wage: schema.contracts.wage,
      })
      .from(E)
      .leftJoin(
        schema.contracts,
        and(eq(schema.contracts.employeeId, E.id), eq(schema.contracts.state, "running")),
      )
      .where(
        and(
          eq(E.departmentId, departmentId),
          eq(E.active, true),
          or(isNull(E.resignDate), sql`${E.resignDate} >= ${`${year}-01-01`}::date`),
        ),
      );
    const byJob = new Map<string, typeof rows>();
    for (const r of rows) if (r.jobId) byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r]);
    return [...byJob.entries()].map(([jobId, rs]) => {
      const wages = rs.map((r) => Number(r.wage ?? 0)).filter((w) => w > 0);
      const grades = rs.map((r) => r.gradeId).filter(Boolean);
      return {
        jobId,
        gradeId: grades[0] ?? null,
        kind: "existing" as const,
        quantity: rs.length,
        startMonth: 1,
        endMonth: null,
        monthlyWage: (wages.length ? Math.round(wages.reduce((s, w) => s + w, 0) / wages.length) : 0).toFixed(
          2,
        ),
        monthlyAllowance: "0.00",
        reason: null,
        replacesEmployeeId: null,
      };
    });
  }

  /**
   * Simpan baris; validasi jabatan, golongan & karyawan yang diganti. Pengguna tanpa payroll.read tidak melihat upah:
   * upah lama dipertahankan (baris jabatan & jenis sama), selain itu diisi titik tengah golongan.
   */
  private async writeLines(
    tx: Db,
    planId: string,
    lines: LineInput[],
    old: (typeof L.$inferSelect)[],
    /** Baris dibuat sistem (mis. posisi terisi otomatis): upah dipakai apa adanya. */
    trusted = false,
  ) {
    if (!lines.length) return;
    const jobIds = [...new Set(lines.map((l) => l.jobId))];
    const jobs = await tx.select({ id: J.id, gradeId: J.gradeId }).from(J).where(inArray(J.id, jobIds));
    lines.forEach((l, i) => {
      if (!jobs.some((j) => j.id === l.jobId))
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [{ path: `lines.${i}.jobId`, message: "Jabatan tidak ditemukan" }],
        });
    });
    const gradeIds = [
      ...new Set(
        lines
          .flatMap((l) => [l.gradeId, jobs.find((j) => j.id === l.jobId)?.gradeId])
          .filter((g): g is string => !!g),
      ),
    ];
    const grades = gradeIds.length ? await tx.select().from(G).where(inArray(G.id, gradeIds)) : [];
    const replaced = [...new Set(lines.flatMap((l) => (l.replacesEmployeeId ? [l.replacesEmployeeId] : [])))];
    if (replaced.length) {
      const found = await tx
        .select({ id: E.id })
        .from(E)
        .where(and(inArray(E.id, replaced), eq(E.companyId, currentContext().companyId)));
      if (found.length !== replaced.length)
        throw new BadRequestException("Karyawan yang diganti tidak ditemukan");
    }
    const showCost = trusted || can("payroll.read");
    // Baris lama dipertahankan (id tetap) bila jabatan & jenisnya sama, agar FPK & lowongan tetap terhubung.
    const unused = [...old];
    const values = lines.map((l, i) => {
      const gradeId = l.gradeId ?? jobs.find((j) => j.id === l.jobId)?.gradeId ?? null;
      const k = unused.findIndex((o) => o.jobId === l.jobId && o.kind === l.kind);
      const prev = k >= 0 ? unused.splice(k, 1)[0] : undefined;
      const grade = grades.find((g) => g.id === gradeId);
      // Estimasi upah posisi baru: gaji pokok standar golongan, atau titik tengah skala upahnya.
      const mid = grade
        ? grade.baseWage
          ? new Decimal(grade.baseWage).toFixed(2)
          : new Decimal(grade.minWage).plus(grade.maxWage).div(2).toFixed(2)
        : "0.00";
      return {
        planId,
        sequence: i,
        jobId: l.jobId,
        gradeId,
        kind: l.kind,
        quantity: l.quantity,
        startMonth: l.startMonth,
        endMonth: l.endMonth ?? null,
        monthlyWage: showCost ? l.monthlyWage : (prev?.monthlyWage ?? mid),
        monthlyAllowance: showCost ? l.monthlyAllowance : (prev?.monthlyAllowance ?? "0.00"),
        reason: l.reason ?? null,
        replacesEmployeeId: l.replacesEmployeeId ?? null,
        jobOpeningId: prev?.jobOpeningId ?? null,
        prevId: prev?.id,
      };
    });
    // Baris yang dihapus/dikurangi tidak boleh di bawah jumlah yang sudah diajukan lewat FPK.
    const H = schema.hiringRequests;
    const ids = old.map((o) => o.id);
    const requested = ids.length
      ? await tx
          .select({ lineId: H.manpowerPlanLineId, n: sql<number>`sum(${H.quantity})::int` })
          .from(H)
          .where(
            and(inArray(H.manpowerPlanLineId, ids), inArray(H.state, ["draft", "in_approval", "approved"])),
          )
          .groupBy(H.manpowerPlanLineId)
      : [];
    const usedBy = (lineId: string) => requested.find((r) => r.lineId === lineId)?.n ?? 0;
    for (const o of unused)
      if (usedBy(o.id) > 0)
        throw new BadRequestException(
          "Posisi yang sudah diajukan lewat FPK tidak bisa dihapus dari MPP; batalkan FPK-nya dulu",
        );
    values.forEach((v, i) => {
      if (v.prevId && v.quantity < usedBy(v.prevId))
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [
            {
              path: `lines.${i}.quantity`,
              message: `Sudah diajukan lewat FPK ${usedBy(v.prevId)} orang; jumlah tidak boleh kurang dari itu`,
            },
          ],
        });
    });
    if (unused.length)
      await tx.delete(L).where(
        inArray(
          L.id,
          unused.map((o) => o.id),
        ),
      );
    for (const { prevId, ...v } of values) {
      if (prevId) await tx.update(L).set(v).where(eq(L.id, prevId));
      else await tx.insert(L).values(v);
    }
  }

  private async find(tx: Db, id: string) {
    const [plan] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, id), eq(P.companyId, currentContext().companyId)));
    if (!plan) throw new NotFoundException("MPP tidak ditemukan");
    return plan;
  }

  /** Departemen yang dikepalai user ini (departments.manager_id → karyawan tertaut user). */
  private async headedDepartments(tx: Db) {
    const ctx = currentContext();
    const rows = await tx
      .select({ id: D.id })
      .from(D)
      .innerJoin(E, eq(E.id, D.managerId))
      .where(and(eq(D.companyId, ctx.companyId), eq(E.userId, ctx.userId)));
    return rows.map((r) => r.id);
  }

  private canEditDept(headOf: string[], departmentId: string) {
    return can("hr.manage") || headOf.includes(departmentId);
  }

  private async assertCanRead(tx: Db, departmentId: string) {
    if (can("hr.read")) return;
    if (!(await this.headedDepartments(tx)).includes(departmentId))
      throw new ForbiddenException("Butuh permission hr.read");
  }

  private async assertCanEdit(tx: Db, departmentId: string) {
    if (!this.canEditDept(await this.headedDepartments(tx), departmentId))
      throw new ForbiddenException("Hanya HR (hr.manage) atau kepala departemen yang bisa mengubah MPP ini");
  }

  private async bpjs(tx: Db, companyId: string): Promise<BpjsSettings> {
    const [s] = await tx
      .select()
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    return s ? toBpjs(s) : DEFAULT_BPJS;
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
      .values({ ...CATEGORY, companyId, managerFirst: false, sequence: 910 })
      .returning({ id: CAT.id });
    return created!.id;
  }

  private log(tx: Db, id: string, message: string) {
    return this.activity.log(tx, { resModel: "manpower_plan", resId: id, action: "comment", message });
  }
}

const toLine = (l: typeof L.$inferSelect): ManpowerLine => ({
  jobId: l.jobId,
  kind: l.kind,
  quantity: l.quantity,
  startMonth: l.startMonth,
  endMonth: l.endMonth,
  monthlyWage: l.monthlyWage,
  monthlyAllowance: l.monthlyAllowance,
});
const toBpjs = (s: typeof schema.payrollSettings.$inferSelect): BpjsSettings => ({
  jkkRate: s.jkkRate,
  kesWageCap: s.kesWageCap,
  jpWageCap: s.jpWageCap,
});

@Module({ imports: [HrModule], controllers: [ManpowerPlanController], providers: [ActivityService] })
export class ManpowerPlanModule {}
