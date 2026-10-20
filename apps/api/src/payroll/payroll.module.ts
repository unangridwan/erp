import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { eq, schema, type Db } from "@erp/db";
import {
  BANK_FORMATS,
  BANK_LABELS,
  bankOf,
  payrollCostQuerySchema,
  thrComputeSchema,
  employeeLoanSchema,
  hasPermission,
  loanDisburseSchema,
  payRunSchema,
  payrollRunSchema,
  payrollSettingsSchema,
  payslipInputsSchema,
  salaryComponentSchema,
  severanceInputSchema,
  toCsv,
} from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertCompanyAccounts } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { Mailer } from "../common/mailer.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ExpenseModule } from "../hr/expense.module.js";
import { HrModule } from "../hr/hr.module.js";
import { EmployeeService } from "../hr/employee.service.js";
import { LoanService } from "./loan.service.js";
import { PayrollService } from "./payroll.service.js";
import { SeveranceService } from "./severance.service.js";
import { payslipFilename, payslipPassword, payslipPdfData, renderPayslipPdf } from "./payslip-pdf.js";

const SalaryComponentsController = createCrudController({
  path: "salary-components",
  model: "salary_component",
  table: schema.salaryComponents,
  schema: salaryComponentSchema,
  read: "payroll.read",
  write: "payroll.manage",
  searchColumns: [schema.salaryComponents.code, schema.salaryComponents.name],
  orderBy: schema.salaryComponents.code,
  companyColumn: schema.salaryComponents.companyId,
  perCompany: true,
  beforeSave: async (tx, values) => {
    if (typeof values.accountId === "string")
      await assertCompanyAccounts(tx, String(values.companyId), [
        { path: "accountId", id: values.accountId },
      ]);
  },
});

const csv = (
  res: Response,
  filename: string,
  columns: { key: string; header: string }[],
  rows: Record<string, unknown>[],
) =>
  res
    .type("text/csv; charset=utf-8")
    .attachment(filename)
    .send(
      "\uFEFF" +
        toCsv(
          columns.map((c) => c.header),
          rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, r[c.key]]))),
        ),
    );

@Controller()
class PayrollController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(PayrollService) private readonly payroll: PayrollService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(LoanService) private readonly loans: LoanService,
  ) {}

  @Get("payroll/settings")
  @RequirePermission("payroll.read")
  settings() {
    return this.tenantDb.run((tx) => this.payroll.settings(tx));
  }

  @Put("payroll/settings")
  @RequirePermission("payroll.manage")
  updateSettings(@Body() body: unknown) {
    const input = parse(payrollSettingsSchema, body);
    return this.tenantDb.run((tx) => this.payroll.updateSettings(tx, input));
  }

  @Get("payroll-runs")
  @RequirePermission("payroll.read")
  list() {
    return this.tenantDb.run((tx) => this.payroll.list(tx));
  }

  @Post("payroll-runs")
  @RequirePermission("payroll.write")
  create(@Body() body: unknown) {
    const input = parse(payrollRunSchema, body);
    return this.tenantDb.run(async (tx) => this.payroll.get(tx, (await this.payroll.create(tx, input)).id));
  }

  @Get("payroll-runs/:id")
  @RequirePermission("payroll.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.payroll.get(tx, id));
  }

  @Post("payroll-runs/:id/compute")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  compute(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.payroll.compute(tx, id));
  }

  @Post("payroll-runs/:id/post")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  post(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.payroll.post(tx, id));
  }

  @Post("payroll-runs/:id/pay")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  pay(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(payRunSchema, body);
    return this.tenantDb.run((tx) => this.payroll.pay(tx, id, input));
  }

  @Post("payroll-runs/:id/cancel")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  async cancel(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run((tx) => this.payroll.cancel(tx, id));
    return { ok: true };
  }

  /**
   * Transfer gaji — berisi nomor rekening, khusus payroll.manage. Tanpa format: JSON per karyawan; `csv` = CSV
   * umum; `bca|mandiri|bri|bni` = file unggah massal bank (hanya rekening bank itu).
   */
  @Get("payroll-runs/:id/bank-transfer")
  @RequirePermission("payroll.manage")
  async bank(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("format") format: string | undefined,
    @Res() res: Response,
  ) {
    if (!format || format === "json") {
      const rows = await this.tenantDb.run((tx) => this.payroll.bankTransfer(tx, id));
      return res.json(rows.map((r) => ({ ...r, bank: bankOf(r.bankName) })));
    }
    const kind = parse(z.enum(BANK_FORMATS), format);
    const file = await this.tenantDb.run((tx) => this.payroll.bankFile(tx, id, kind));
    res
      .type(file.contentType)
      .attachment(file.filename)
      .setHeader("X-Transfer-Count", String(file.count))
      .setHeader("X-Transfer-Total", file.total)
      .setHeader("X-Transfer-Skipped", String(file.skipped.length))
      .send(kind === "csv" ? "\uFEFF" + file.content : file.content);
  }

  /** Ringkasan file transfer per bank (jumlah, total, karyawan yang tidak termasuk). */
  @Get("payroll-runs/:id/bank-transfer/summary")
  @RequirePermission("payroll.manage")
  bankSummary(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const rows = await this.payroll.bankTransfer(tx, id);
      const banks = (["bca", "mandiri", "bri", "bni"] as const).map((bank) => {
        const mine = rows.filter((r) => bankOf(r.bankName) === bank);
        return {
          bank,
          label: BANK_LABELS[bank],
          count: mine.length,
          total: mine.reduce((sum, r) => sum + Number(r.amount), 0).toFixed(0),
        };
      });
      const other = rows.filter((r) => !bankOf(r.bankName));
      return {
        banks,
        other: {
          count: other.length,
          total: other.reduce((sum, r) => sum + Number(r.amount), 0).toFixed(0),
          employees: other.map((r) => ({
            employeeNumber: r.employeeNumber,
            name: r.name,
            bankName: r.bankName,
          })),
        },
      };
    });
  }

  @Post("payroll-runs/:id/thr")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  thr(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(thrComputeSchema, body);
    return this.tenantDb.run((tx) => this.payroll.computeThr(tx, id, input));
  }

  @Post("payroll-runs/:id/retro")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  retro(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.payroll.computeRetro(tx, id));
  }

  /**
   * Kirim slip gaji (PDF berkata sandi tanggal lahir DDMMYYYY bila diisi) ke email kerja karyawan. Email dikirim di
   * luar transaksi database; status kirim per slip disimpan.
   */
  @Post("payroll-runs/:id/email-payslips")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  async emailPayslips(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { onlyPending } = parse(z.object({ onlyPending: z.boolean().default(false) }), body ?? {});
    const targets = await this.tenantDb.run((tx) => this.payroll.emailTargets(tx, id, onlyPending));
    const result = { sent: 0, failed: 0, skipped: [] as { name: string; reason: string }[] };
    for (const t of targets) {
      if (!t.email) {
        result.skipped.push({ name: t.name, reason: "Email kerja kosong" });
        continue;
      }
      const file = await this.tenantDb.run(async (tx) => {
        const slip = await this.payroll.payslip(tx, t.slipId);
        return {
          period: slip.run.name,
          company: await this.companyName(tx, slip.companyId),
          filename: payslipFilename(slip),
          content: await renderPayslipPdf(payslipPdfData(slip, await this.companyName(tx, slip.companyId)), {
            password: payslipPassword(t.birthDate),
          }),
        };
      });
      let error: string | null = null;
      try {
        await this.mailer.send({
          to: t.email,
          subject: `Slip gaji ${file.period} — ${file.company}`,
          text:
            `Yth. ${t.name},\n\nTerlampir slip gaji ${file.period}.` +
            (t.birthDate
              ? " Berkas PDF dilindungi kata sandi berupa tanggal lahir Anda (format DDMMYYYY)."
              : "") +
            `\n\nSalam,\n${file.company}`,
          attachments: [{ filename: file.filename, content: file.content, contentType: "application/pdf" }],
        });
        result.sent += 1;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 500) : String(e);
        result.failed += 1;
      }
      await this.tenantDb.run((tx) => this.payroll.markEmailed(tx, t.slipId, error));
    }
    return result;
  }

  /** Biaya tenaga kerja (gaji + BPJS perusahaan) per departemen/cabang/bulan dari payroll terposting. */
  @Get("payroll/reports/cost")
  @RequirePermission("payroll.read")
  cost(@Query() query: unknown) {
    const input = parse(payrollCostQuerySchema, query);
    return this.tenantDb.run((tx) => this.payroll.costReport(tx, input));
  }

  /** Rekap PPh 21 & BPJS per karyawan (memuat NIK/NPWP), khusus payroll.manage. */
  @Get("payroll-runs/:id/recap")
  @RequirePermission("payroll.manage")
  async recap(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("format") format: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.tenantDb.run((tx) => this.payroll.recap(tx, id));
    if (format === "edabu")
      // BPJS Kesehatan e-Dabu: dasar upah & iuran per peserta.
      return csv(
        res,
        "bpjs-kesehatan-edabu.csv",
        [
          { key: "nik", header: "NIK" },
          { key: "bpjsKesNo", header: "No Kartu" },
          { key: "name", header: "Nama" },
          { key: "birthDate", header: "Tgl Lahir" },
          { key: "joinDate", header: "TMT Kerja" },
          { key: "bpjsWage", header: "Gaji Pokok + Tunjangan Tetap" },
          { key: "kesEmployer", header: "Iuran Pemberi Kerja" },
          { key: "kesEmployee", header: "Iuran Pekerja" },
          { key: "kesTotal", header: "Total Iuran" },
        ],
        rows.map(({ bpjs, ...r }) => ({
          ...r,
          ...bpjs,
          kesTotal: String(Number(bpjs.kesEmployer) + Number(bpjs.kesEmployee)),
        })),
      );
    if (format === "sipp")
      // BPJS Ketenagakerjaan SIPP: upah & iuran per program.
      return csv(
        res,
        "bpjs-ketenagakerjaan-sipp.csv",
        [
          { key: "nik", header: "NIK" },
          { key: "bpjsTkNo", header: "No KPJ" },
          { key: "name", header: "Nama" },
          { key: "birthDate", header: "Tgl Lahir" },
          { key: "bpjsWage", header: "Upah" },
          { key: "jhtEmployer", header: "JHT Pemberi Kerja" },
          { key: "jhtEmployee", header: "JHT Pekerja" },
          { key: "jkk", header: "JKK" },
          { key: "jkm", header: "JKM" },
          { key: "jpEmployer", header: "JP Pemberi Kerja" },
          { key: "jpEmployee", header: "JP Pekerja" },
          { key: "tkTotal", header: "Total Iuran" },
        ],
        rows.map(({ bpjs, ...r }) => ({
          ...r,
          ...bpjs,
          tkTotal: String(
            [bpjs.jhtEmployer, bpjs.jhtEmployee, bpjs.jkk, bpjs.jkm, bpjs.jpEmployer, bpjs.jpEmployee].reduce(
              (sum, x) => sum + Number(x),
              0,
            ),
          ),
        })),
      );
    if (format !== "csv") return res.json(rows);
    csv(
      res,
      "rekap-pph21-bpjs.csv",
      [
        { key: "employeeNumber", header: "NIK Karyawan" },
        { key: "name", header: "Nama" },
        { key: "nik", header: "NIK" },
        { key: "npwp", header: "NPWP" },
        { key: "ptkpStatus", header: "PTKP" },
        { key: "terCategory", header: "Kategori TER" },
        { key: "terRate", header: "Tarif TER %" },
        { key: "gross", header: "Penghasilan Bruto" },
        { key: "pph21", header: "PPh 21" },
        { key: "bpjsKesNo", header: "No BPJS Kesehatan" },
        { key: "bpjsTkNo", header: "No BPJS Ketenagakerjaan" },
        { key: "kesEmployer", header: "BPJS Kes Perusahaan" },
        { key: "kesEmployee", header: "BPJS Kes Karyawan" },
        { key: "jhtEmployer", header: "JHT Perusahaan" },
        { key: "jhtEmployee", header: "JHT Karyawan" },
        { key: "jkk", header: "JKK" },
        { key: "jkm", header: "JKM" },
        { key: "jpEmployer", header: "JP Perusahaan" },
        { key: "jpEmployee", header: "JP Karyawan" },
      ],
      rows.map(({ bpjs, ...r }) => ({ ...r, ...bpjs })),
    );
  }

  @Get("payslips/:id")
  slip(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const slip = await this.payroll.payslip(tx, id);
      this.assertCanSee(slip);
      return slip;
    });
  }

  @Put("payslips/:id/inputs")
  @RequirePermission("payroll.write")
  inputs(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(payslipInputsSchema, body);
    return this.tenantDb.run((tx) => this.payroll.setInputs(tx, id, input.inputs));
  }

  @Get("payslips/:id/pdf")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.tenantDb.run(async (tx) => {
      const slip = await this.payroll.payslip(tx, id);
      this.assertCanSee(slip);
      return {
        filename: payslipFilename(slip),
        content: await renderPayslipPdf(payslipPdfData(slip, await this.companyName(tx, slip.companyId))),
      };
    });
    res.type("application/pdf").attachment(file.filename).send(file.content);
  }

  /** Pinjaman milik sendiri beserta sisa & cicilan. */
  @Get("me/loans")
  myLoans() {
    return this.tenantDb.run(async (tx) => {
      const employee = await this.employees.mine(tx);
      return this.loans.list(tx, { employeeId: employee.id });
    });
  }

  @Get("me/payslips")
  mine() {
    return this.tenantDb.run((tx) => this.payroll.mySlips(tx));
  }

  private async companyName(tx: Db, companyId: string) {
    const [company] = await tx
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId));
    return company?.name ?? "";
  }

  /** Slip sendiri (payroll yang sudah diposting) atau butuh payroll.read. */
  private assertCanSee(slip: { employee: { userId: string | null }; run: { state: string } }) {
    const ctx = currentContext();
    if (hasPermission(ctx.permissions, "payroll.read")) return;
    if (slip.employee.userId === ctx.userId && (slip.run.state === "done" || slip.run.state === "paid"))
      return;
    throw new ForbiddenException("Butuh permission payroll.read");
  }
}

/** Pinjaman karyawan (dicicil lewat payroll). */
@Controller("employee-loans")
class LoansController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(LoanService) private readonly loans: LoanService,
  ) {}

  @Get()
  @RequirePermission("payroll.read")
  list(@Query() query: { employeeId?: string; state?: string }) {
    return this.tenantDb.run((tx) => this.loans.list(tx, query));
  }

  @Get(":id")
  @RequirePermission("payroll.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.loans.get(tx, id));
  }

  @Post()
  @RequirePermission("payroll.write")
  create(@Body() body: unknown) {
    const input = parse(employeeLoanSchema, body);
    return this.tenantDb.run((tx) => this.loans.create(tx, input));
  }

  @Post(":id/disburse")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  disburse(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(loanDisburseSchema, body);
    return this.tenantDb.run((tx) => this.loans.disburse(tx, id, input));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("payroll.manage")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.loans.cancel(tx, id));
  }
}

/** Hak akhir hubungan kerja (pesangon PP 35/2021). */
@Controller("employees")
class SeveranceController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(SeveranceService) private readonly severances: SeveranceService,
  ) {}

  @Get(":id/severances")
  @RequirePermission("payroll.read")
  list(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.severances.list(tx, id));
  }

  @Post(":id/severance/preview")
  @HttpCode(200)
  @RequirePermission("payroll.read")
  preview(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(severanceInputSchema, body);
    return this.tenantDb.run((tx) => this.severances.preview(tx, id, input));
  }

  @Post(":id/severances")
  @RequirePermission("payroll.manage")
  create(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(severanceInputSchema, body);
    return this.tenantDb.run((tx) => this.severances.create(tx, id, input));
  }
}

@Module({
  imports: [AccountingModule, HrModule, ExpenseModule],
  controllers: [SalaryComponentsController, PayrollController, LoansController, SeveranceController],
  providers: [ActivityService, PayrollService, LoanService, SeveranceService],
})
export class PayrollModule {}
