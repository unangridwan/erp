import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db, type SQL } from "@erp/db";
import {
  GROSS_UP_CODE,
  PPH21_A1_OBJECT_CODE,
  PPH21_PERMANENT_OBJECT_CODE,
  bp21Xml,
  bpa1Xml,
  bpmpXml,
  bppuXml,
  idtku,
  tin16,
  type withholdingUpdateSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { EmployeeService } from "../hr/employee.service.js";
import { companyTaxIds, periodRange, xmlFileName } from "./company-tax.js";

const W = schema.withholdingSlips;
type Kind = "bppu" | "bpmp" | "bpa1" | "bp21";

@Injectable()
export class WithholdingService {
  constructor(@Inject(EmployeeService) private readonly employees: EmployeeService) {}

  async list(tx: Db, query: { kind?: string; year?: string; month?: string; state?: string }) {
    const filters: (SQL | undefined)[] = [eq(W.companyId, currentContext().companyId)];
    if (query.kind) filters.push(eq(W.kind, query.kind as Kind));
    if (query.year) filters.push(eq(W.periodYear, Number(query.year)));
    if (query.month) filters.push(eq(W.periodMonth, Number(query.month)));
    if (query.state) filters.push(eq(W.state, query.state as "draft"));
    const rows = await tx
      .select()
      .from(W)
      .where(and(...filters))
      .orderBy(desc(W.withholdingDate), asc(W.counterpartName));
    // NIK/NPWP lawan transaksi hanya utuh untuk tax.manage.
    return rows.map((r) => this.present(r));
  }

  async get(tx: Db, id: string) {
    return this.present(await this.find(tx, id));
  }

  /** Buat draft bukti potong dari tagihan (BPPU) atau payroll yang sudah diposting (BPMP) pada satu masa. */
  async generate(tx: Db, input: { kind: Kind; year: number; month: number }) {
    const companyId = currentContext().companyId;
    const withholder = await companyTaxIds(tx, companyId);
    if (input.kind === "bppu") return this.generateBppu(tx, companyId, withholder.idtku, input);
    if (input.kind === "bpa1") return this.generateBpa1(tx, companyId, withholder.idtku, input);
    if (input.kind === "bp21") return this.generateBp21(tx, companyId, withholder.idtku, input);
    return this.generateBpmp(tx, companyId, withholder.idtku, input);
  }

  /**
   * BPA1 untuk slip masa pajak terakhir (Desember atau bulan karyawan keluar) pada masa itu: penghasilan setahun dari
   * slip-slip yang diposting di tahun yang sama, PPh 21 terutang setahun dari perhitungan tahunan slip terakhir.
   */
  private async generateBpa1(
    tx: Db,
    companyId: string,
    withholderIdtku: string,
    input: { year: number; month: number },
  ) {
    const { from } = periodRange(input.year, input.month);
    const finals = await tx
      .select({
        slip: schema.payslips,
        run: schema.payrollRuns,
        employee: schema.employees,
        position: schema.jobPositions.name,
      })
      .from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .innerJoin(schema.employees, eq(schema.employees.id, schema.payslips.employeeId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
      .where(
        and(
          eq(schema.payslips.companyId, companyId),
          eq(schema.payslips.isFinal, true),
          // Bukti potong A1 hanya untuk pegawai tetap (kategori PPh 21 dari jenis kontrak).
          eq(schema.payslips.taxCategory, "permanent"),
          eq(schema.payrollRuns.kind, "regular"),
          eq(schema.payrollRuns.periodStart, from),
          inArray(schema.payrollRuns.state, ["done", "paid"]),
          sql`not exists (select 1 from withholding_slips w where w.payslip_id = ${schema.payslips.id}
                          and w.kind = 'bpa1' and w.state <> 'cancelled')`,
        ),
      )
      .orderBy(asc(schema.employees.name));
    const created: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const { slip, run, employee, position } of finals) {
      // Payroll koreksi terakhir di masa yang sama memuat PPh 21 setahun yang terbaru.
      const [corrected] = await tx
        .select({ annual: schema.payslips.annual })
        .from(schema.payslips)
        .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
        .where(
          and(
            eq(schema.payslips.employeeId, employee.id),
            eq(schema.payslips.isFinal, true),
            eq(schema.payrollRuns.kind, "correction"),
            eq(schema.payrollRuns.periodStart, from),
            inArray(schema.payrollRuns.state, ["done", "paid"]),
          ),
        )
        .orderBy(desc(schema.payrollRuns.createdAt))
        .limit(1);
      const annual = (corrected?.annual ?? slip.annual) as { tax?: string } | null;
      if (!annual?.tax) {
        skipped.push({ name: employee.name, reason: "Slip terakhir tanpa perhitungan PPh 21 setahun" });
        continue;
      }
      const [t] = await tx.execute<{
        month_start: number;
        salary: string;
        other: string;
        income_tax: string;
        bonus: string;
        insurance: string;
        pension: string;
      }>(sql`
        select min(extract(month from r.period_start))::int as month_start,
          coalesce(sum(pl.amount) filter (where pl.category in ('basic', 'unpaid')), 0)::text as salary,
          coalesce(sum(pl.amount) filter (where (pl.category = 'allowance' and coalesce(c.taxable, true)
            and pl.code <> ${GROSS_UP_CODE}
            and not (pl.code ~* '^(THR|BONUS|TANTIEM)' or pl.name ~* '(THR|bonus|tantiem|gratifikasi)'))
            or pl.category = 'overtime'
            -- Benefit natura (premi asuransi swasta, fasilitas) yang dibayar perusahaan.
            or (pl.category = 'benefit_employer' and coalesce(bp.taxable, false))), 0)::text as other,
          coalesce(sum(pl.amount) filter (where pl.code = ${GROSS_UP_CODE}), 0)::text as income_tax,
          coalesce(sum(pl.amount) filter (where pl.category = 'allowance' and coalesce(c.taxable, true)
            and (pl.code ~* '^(THR|BONUS|TANTIEM)' or pl.name ~* '(THR|bonus|tantiem|gratifikasi)')), 0)::text as bonus,
          coalesce(sum(pl.amount) filter (where pl.category = 'bpjs_employer' and pl.code in ('JKK', 'JKM', 'BPJS_KES_ER')), 0)::text as insurance,
          coalesce(-sum(pl.amount) filter (where (pl.category = 'bpjs_employee' and pl.code in ('JHT_EE', 'JP_EE'))
            or (pl.category = 'deduction' and bp.kind = 'pension')), 0)::text as pension
        from payslip_lines pl
        join payslips s on s.id = pl.payslip_id
        join payroll_runs r on r.id = s.run_id
        left join salary_components c on c.id = pl.component_id
        left join benefit_plans bp on bp.id = pl.benefit_plan_id
        where s.employee_id = ${employee.id} and s.company_id = ${companyId}
          and r.state in ('done', 'paid')
          and r.period_start between ${`${input.year}-01-01`} and ${from}`);
      const data = this.employees.decrypted(employee);
      const tin = tin16(data.npwp) ?? tin16(data.nik);
      const details = {
        salary: new Decimal(t!.salary).toFixed(0),
        otherBenefit: new Decimal(t!.other).toFixed(0),
        incomeTaxBenefit: new Decimal(t!.income_tax).toFixed(0),
        insurance: new Decimal(t!.insurance).toFixed(0),
        bonus: new Decimal(t!.bonus).toFixed(0),
        pensionContribution: new Decimal(t!.pension).toFixed(0),
      };
      const gross = Object.entries(details)
        .filter(([k]) => k !== "pensionContribution")
        .reduce((s, [, v]) => s.plus(v), new Decimal(0));
      const [row] = await tx
        .insert(W)
        .values({
          companyId,
          kind: "bpa1",
          periodYear: input.year,
          periodMonth: input.month,
          monthStart: t!.month_start,
          monthEnd: input.month,
          details,
          employeeId: employee.id,
          payslipId: slip.id,
          counterpartName: employee.name,
          counterpartTin: tin,
          ptkpStatus: slip.ptkpStatus,
          position: position ?? "Pegawai",
          taxObjectCode: PPH21_A1_OBJECT_CODE,
          taxBase: gross.toFixed(2),
          rate: "0",
          taxAmount: new Decimal(annual.tax).toFixed(2),
          withholderIdtku,
          withholdingDate: run.paymentDate,
        })
        .returning({ id: W.id });
      created.push(row!.id);
    }
    return { created: created.length, ids: created, skipped };
  }

  private async generateBppu(
    tx: Db,
    companyId: string,
    withholderIdtku: string,
    input: { year: number; month: number },
  ) {
    const { from, to } = periodRange(input.year, input.month);
    const rows = await tx.execute<{
      move_id: string;
      move_name: string;
      ref: string | null;
      date: string;
      currency_rate: string;
      partner_id: string;
      partner_name: string;
      npwp: string | null;
      tku: string;
      tax_id: string;
      tax_amount_rate: string;
      tax_object_code: string | null;
      base: string;
      amount: string;
    }>(sql`
      select m.id as move_id, m.name as move_name, m.ref, m.date, m.currency_rate,
             p.id as partner_id, p.name as partner_name, p.npwp, p.tku,
             t.id as tax_id, t.amount as tax_amount_rate, t.tax_object_code,
             sum(l.tax_base_amount) as base, sum(l.credit - l.debit) as amount
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join taxes t on t.id = l.tax_line_id
      join partners p on p.id = m.partner_id
      where m.company_id = ${companyId} and m.state = 'posted' and m.move_type = 'in_invoice'
        and m.payment_state <> 'reversed' and m.date between ${from} and ${to}
        and t.type_tax_use = 'purchase' and t.tax_kind in ('pph23', 'pph4_2', 'pph22')
        and not exists (select 1 from withholding_slips w
                        where w.move_id = m.id and w.tax_id = t.id and w.state <> 'cancelled')
      group by m.id, p.id, t.id
      order by m.date, m.name`);
    const created: string[] = [];
    for (const r of rows) {
      const tin = tin16(r.npwp);
      const [row] = await tx
        .insert(W)
        .values({
          companyId,
          kind: "bppu",
          periodYear: input.year,
          periodMonth: input.month,
          partnerId: r.partner_id,
          moveId: r.move_id,
          taxId: r.tax_id,
          counterpartName: r.partner_name,
          counterpartTin: tin,
          counterpartIdtku: tin ? idtku(tin, r.tku) : null,
          taxObjectCode: r.tax_object_code,
          taxBase: new Decimal(r.base).times(r.currency_rate).toFixed(2),
          rate: new Decimal(r.tax_amount_rate).abs().toFixed(4),
          taxAmount: new Decimal(r.amount).toFixed(2),
          documentType: "CommercialInvoice",
          documentNumber: r.ref || r.move_name,
          documentDate: r.date,
          withholderIdtku,
          withholdingDate: r.date,
        })
        .returning({ id: W.id });
      created.push(row!.id);
    }
    return { created: created.length, ids: created, skipped: [] as { name: string; reason: string }[] };
  }

  /**
   * BP21 per masa untuk slip terposting pegawai tidak tetap (upah harian/borongan, DPP 100% bruto) dan bukan pegawai
   * (DPP 50% bruto, tarif Pasal 17). Kode objek pajak bawaan dari Pengaturan Payroll (bisa diubah per bukti potong).
   */
  private async generateBp21(
    tx: Db,
    companyId: string,
    withholderIdtku: string,
    input: { year: number; month: number },
  ) {
    const { from } = periodRange(input.year, input.month);
    const [settings] = await tx
      .select({
        nonPermanent: schema.payrollSettings.bp21NonPermanentCode,
        nonEmployee: schema.payrollSettings.bp21NonEmployeeCode,
      })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    const slips = await tx
      .select({ slip: schema.payslips, run: schema.payrollRuns, employee: schema.employees })
      .from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .innerJoin(schema.employees, eq(schema.employees.id, schema.payslips.employeeId))
      .where(
        and(
          eq(schema.payslips.companyId, companyId),
          eq(schema.payrollRuns.periodStart, from),
          inArray(schema.payrollRuns.state, ["done", "paid"]),
          inArray(schema.payslips.taxCategory, ["non_permanent", "non_employee"]),
          sql`not exists (select 1 from withholding_slips w where w.payslip_id = ${schema.payslips.id} and w.state <> 'cancelled')`,
        ),
      )
      .orderBy(asc(schema.employees.name));
    const created: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const { slip, run, employee } of slips) {
      if (new Decimal(slip.gross).lte(0)) {
        skipped.push({ name: employee.name, reason: "Penghasilan bruto nol" });
        continue;
      }
      const nonEmployee = slip.taxCategory === "non_employee";
      const deemed = new Decimal(nonEmployee ? 50 : 100);
      const base = new Decimal(slip.gross).times(deemed).div(100);
      // Tarif efektif atas DPP (TER harian / Pasal 17), dari PPh 21 yang dipotong di slip.
      const rate = base.gt(0) ? new Decimal(slip.pph21).div(base).times(100) : new Decimal(0);
      const data = this.employees.decrypted(employee);
      const tin = tin16(data.npwp) ?? tin16(data.nik);
      const [row] = await tx
        .insert(W)
        .values({
          companyId,
          kind: "bp21",
          periodYear: input.year,
          periodMonth: input.month,
          employeeId: employee.id,
          payslipId: slip.id,
          counterpartName: employee.name,
          counterpartTin: tin,
          ptkpStatus: nonEmployee ? null : slip.ptkpStatus,
          position: nonEmployee ? "Bukan pegawai" : "Pegawai tidak tetap",
          taxObjectCode: (nonEmployee ? settings?.nonEmployee : settings?.nonPermanent) ?? null,
          gross: slip.gross,
          deemedRate: deemed.toFixed(2),
          taxBase: base.toFixed(2),
          rate: rate.toDecimalPlaces(4).toFixed(4),
          taxAmount: slip.pph21,
          documentType: "PaymentProof",
          documentNumber: run.name,
          documentDate: run.paymentDate,
          withholderIdtku,
          withholdingDate: run.paymentDate,
        })
        .returning({ id: W.id });
      created.push(row!.id);
    }
    return { created: created.length, ids: created, skipped };
  }

  private async generateBpmp(
    tx: Db,
    companyId: string,
    withholderIdtku: string,
    input: { year: number; month: number },
  ) {
    const { from } = periodRange(input.year, input.month);
    const slips = await tx
      .select({
        slip: schema.payslips,
        run: schema.payrollRuns,
        employee: schema.employees,
        position: schema.jobPositions.name,
      })
      .from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .innerJoin(schema.employees, eq(schema.employees.id, schema.payslips.employeeId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, schema.employees.jobId))
      .where(
        and(
          eq(schema.payslips.companyId, companyId),
          eq(schema.payrollRuns.periodStart, from),
          inArray(schema.payrollRuns.state, ["done", "paid"]),
          sql`not exists (select 1 from withholding_slips w where w.payslip_id = ${schema.payslips.id} and w.state <> 'cancelled')`,
        ),
      )
      .orderBy(asc(schema.employees.name));
    const created: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const { slip, run, employee, position } of slips) {
      if (slip.taxCategory !== "permanent") {
        // BPMP hanya untuk pegawai tetap; pegawai tidak tetap & bukan pegawai memakai bukti potong PPh 21 (BP21).
        skipped.push({
          name: employee.name,
          reason:
            slip.taxCategory === "none"
              ? "Tidak dipotong PPh 21 (jenis kontrak)"
              : "Bukan pegawai tetap — dibuat sebagai bukti potong BP21",
        });
        continue;
      }
      if (slip.isFinal) {
        // Masa pajak terakhir (Desember / bulan keluar) dilaporkan dengan bukti potong A1, bukan BPMP.
        skipped.push({ name: employee.name, reason: "Masa pajak terakhir — laporkan lewat bukti potong A1" });
        continue;
      }
      const data = this.employees.decrypted(employee);
      // Sejak 2024 NIK berlaku sebagai NPWP orang pribadi; NPWP 16 digit dipakai bila ada.
      const tin = tin16(data.npwp) ?? tin16(data.nik);
      const [row] = await tx
        .insert(W)
        .values({
          companyId,
          kind: "bpmp",
          periodYear: input.year,
          periodMonth: input.month,
          employeeId: employee.id,
          payslipId: slip.id,
          counterpartName: employee.name,
          counterpartTin: tin,
          ptkpStatus: slip.ptkpStatus,
          position: position ?? "Pegawai",
          taxObjectCode: PPH21_PERMANENT_OBJECT_CODE,
          taxBase: slip.gross,
          rate: new Decimal(slip.terRate ?? 0).toFixed(4),
          taxAmount: slip.pph21,
          withholderIdtku,
          withholdingDate: run.paymentDate,
        })
        .returning({ id: W.id });
      created.push(row!.id);
    }
    return { created: created.length, ids: created, skipped };
  }

  async update(tx: Db, id: string, input: z.infer<typeof withholdingUpdateSchema>) {
    const slip = await this.find(tx, id);
    if (slip.state !== "draft") throw new BadRequestException("Hanya bukti potong draft yang bisa diubah");
    const values: Partial<typeof W.$inferInsert> = {};
    if (input.counterpartTin !== undefined) {
      values.counterpartTin = input.counterpartTin;
      if (slip.kind === "bppu" && input.counterpartTin && input.counterpartIdtku === undefined)
        values.counterpartIdtku = idtku(input.counterpartTin);
    }
    if (input.counterpartIdtku !== undefined) values.counterpartIdtku = input.counterpartIdtku;
    if (input.taxObjectCode !== undefined) values.taxObjectCode = input.taxObjectCode;
    if (input.taxCertificate !== undefined) values.taxCertificate = input.taxCertificate;
    if (input.documentType !== undefined) values.documentType = input.documentType;
    await tx
      .update(W)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(W.id, id));
    return this.get(tx, id);
  }

  async export(tx: Db, ids: string[]) {
    const companyId = currentContext().companyId;
    const withholder = await companyTaxIds(tx, companyId);
    const slips = await tx
      .select()
      .from(W)
      .where(and(inArray(W.id, ids), eq(W.companyId, companyId)))
      .orderBy(asc(W.withholdingDate), asc(W.counterpartName));
    if (slips.length !== new Set(ids).size)
      throw new NotFoundException("Sebagian bukti potong tidak ditemukan");
    const kinds = new Set(slips.map((s) => s.kind));
    if (kinds.size > 1)
      throw new BadRequestException("Ekspor BPPU, BPMP, BP21, dan BPA1 dalam berkas terpisah");
    const kind = slips[0]!.kind;
    const problems: string[] = [];
    for (const s of slips) {
      if (s.state !== "draft" && s.state !== "exported")
        problems.push(`${s.counterpartName}: status ${s.state}`);
      if (!s.counterpartTin) problems.push(`${s.counterpartName}: NPWP/NIK belum diisi`);
      if (!s.taxObjectCode) problems.push(`${s.counterpartName}: kode objek pajak belum diisi`);
      if (kind === "bppu" && !s.counterpartIdtku) problems.push(`${s.counterpartName}: ID TKU belum diisi`);
    }
    if (problems.length)
      throw new BadRequestException({
        message: "Bukti potong belum lengkap",
        errors: problems.map((message) => ({ path: "", message })),
      });

    const content =
      kind === "bpa1"
        ? bpa1Xml(
            withholder.tin,
            slips.map((s) => ({
              periodYear: s.periodYear,
              monthStart: s.monthStart ?? 1,
              monthEnd: s.monthEnd ?? s.periodMonth,
              counterpartTin: s.counterpartTin!,
              ptkpStatus: s.ptkpStatus ?? "TK/0",
              position: s.position ?? "Pegawai",
              taxObjectCode: s.taxObjectCode!,
              salary: s.details?.salary ?? 0,
              otherBenefit: s.details?.otherBenefit ?? 0,
              incomeTaxBenefit: s.details?.incomeTaxBenefit ?? 0,
              insurance: s.details?.insurance ?? 0,
              bonus: s.details?.bonus ?? 0,
              pensionContribution: s.details?.pensionContribution ?? 0,
              pph21: s.taxAmount,
              taxCertificate: s.taxCertificate,
              withholderIdtku: s.withholderIdtku,
              withholdingDate: s.withholdingDate,
            })),
          )
        : kind === "bp21"
          ? bp21Xml(
              withholder.tin,
              slips.map((s) => ({
                periodMonth: s.periodMonth,
                periodYear: s.periodYear,
                counterpartTin: s.counterpartTin!,
                ptkpStatus: s.ptkpStatus,
                taxCertificate: s.taxCertificate,
                taxObjectCode: s.taxObjectCode!,
                gross: s.gross ?? s.taxBase,
                deemed: s.deemedRate ?? 100,
                rate: s.rate,
                documentNumber: s.documentNumber ?? "",
                documentDate: s.documentDate ?? s.withholdingDate,
                withholderIdtku: s.withholderIdtku,
                withholdingDate: s.withholdingDate,
              })),
            )
          : kind === "bppu"
            ? bppuXml(
                withholder.tin,
                slips.map((s) => ({
                  periodMonth: s.periodMonth,
                  periodYear: s.periodYear,
                  counterpartTin: s.counterpartTin!,
                  counterpartIdtku: s.counterpartIdtku!,
                  taxCertificate: s.taxCertificate,
                  taxObjectCode: s.taxObjectCode!,
                  taxBase: s.taxBase,
                  rate: s.rate,
                  documentType: s.documentType ?? "CommercialInvoice",
                  documentNumber: s.documentNumber ?? "",
                  documentDate: s.documentDate ?? s.withholdingDate,
                  withholderIdtku: s.withholderIdtku,
                  withholdingDate: s.withholdingDate,
                })),
              )
            : bpmpXml(
                withholder.tin,
                slips.map((s) => ({
                  periodMonth: s.periodMonth,
                  periodYear: s.periodYear,
                  counterpartTin: s.counterpartTin!,
                  ptkpStatus: s.ptkpStatus ?? "TK/0",
                  position: s.position ?? "Pegawai",
                  taxCertificate: s.taxCertificate,
                  taxObjectCode: s.taxObjectCode!,
                  gross: s.taxBase,
                  rate: s.rate,
                  withholderIdtku: s.withholderIdtku,
                  withholdingDate: s.withholdingDate,
                })),
              );
    const first = slips[0]!;
    const fileName = xmlFileName(
      kind === "bppu"
        ? "bupot-unifikasi"
        : kind === "bpa1"
          ? "bupot-a1"
          : kind === "bp21"
            ? "bupot-bp21"
            : "bupot-pph21",
      first.periodYear,
      first.periodMonth,
    );
    const [batch] = await tx
      .insert(schema.taxExportBatches)
      .values({
        companyId,
        kind,
        fileName,
        content,
        recordCount: slips.length,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.taxExportBatches.id });
    await tx
      .update(W)
      .set({ state: "exported", batchId: batch!.id, updatedAt: sql`now()` })
      .where(inArray(W.id, ids));
    return { fileName, content };
  }

  async approve(tx: Db, id: string, number: string) {
    const slip = await this.find(tx, id);
    if (slip.state === "cancelled") throw new BadRequestException("Bukti potong sudah dibatalkan");
    await tx
      .update(W)
      .set({ state: "approved", bupotNumber: number, updatedAt: sql`now()` })
      .where(eq(W.id, id));
    return this.get(tx, id);
  }

  async cancel(tx: Db, id: string) {
    await this.find(tx, id);
    await tx
      .update(W)
      .set({ state: "cancelled", updatedAt: sql`now()` })
      .where(eq(W.id, id));
  }

  private async find(tx: Db, id: string) {
    const [slip] = await tx
      .select()
      .from(W)
      .where(and(eq(W.id, id), eq(W.companyId, currentContext().companyId)));
    if (!slip) throw new NotFoundException("Bukti potong tidak ditemukan");
    return slip;
  }

  /** NIK/NPWP pegawai (BPMP) tersamar tanpa tax.manage; NPWP badan (BPPU) bukan data pribadi sensitif. */
  private present(slip: typeof W.$inferSelect) {
    const full = currentContext().permissions.some((p) => p === "*" || p === "tax.manage");
    if (full || slip.kind === "bppu" || !slip.counterpartTin) return slip;
    return { ...slip, counterpartTin: `••••${slip.counterpartTin.slice(-4)}` };
  }
}
