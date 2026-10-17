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
import { eq, schema } from "@erp/db";
import {
  hasPermission,
  payRunSchema,
  payrollRunSchema,
  payrollSettingsSchema,
  payslipInputsSchema,
  salaryComponentSchema,
  toCsv,
} from "@erp/shared";
import type { Response } from "express";
import { AccountingModule } from "../accounting/accounting.module.js";
import { assertCompanyAccounts } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { createCrudController } from "../common/crud.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { HrModule } from "../hr/hr.module.js";
import { PayrollService } from "./payroll.service.js";
import { renderPayslipPdf } from "./payslip-pdf.js";

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

  /** File transfer gaji (CSV) — berisi nomor rekening, khusus payroll.manage. */
  @Get("payroll-runs/:id/bank-transfer")
  @RequirePermission("payroll.manage")
  async bank(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("format") format: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.tenantDb.run((tx) => this.payroll.bankTransfer(tx, id));
    if (format !== "csv") return res.json(rows);
    csv(
      res,
      "transfer-gaji.csv",
      [
        { key: "employeeNumber", header: "NIK Karyawan" },
        { key: "name", header: "Nama" },
        { key: "bankName", header: "Bank" },
        { key: "bankAccount", header: "No Rekening" },
        { key: "bankAccountName", header: "Atas Nama" },
        { key: "amount", header: "Jumlah" },
      ],
      rows,
    );
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
      const [company] = await tx
        .select({ name: schema.companies.name })
        .from(schema.companies)
        .where(eq(schema.companies.id, slip.companyId));
      const pick = (cats: string[]) =>
        slip.lines
          .filter((l) => cats.includes(l.category))
          .map((l) => ({ name: l.name, amount: String(Math.abs(Number(l.amount))) }));
      const earnings = slip.lines
        .filter((l) => ["basic", "allowance", "overtime", "unpaid"].includes(l.category))
        .map((l) => ({ name: l.name, amount: l.amount }));
      const content = await renderPayslipPdf({
        company: company?.name ?? "",
        title: "Slip Gaji",
        period: slip.run.name,
        employee: {
          name: slip.employee.name,
          number: slip.employee.employeeNumber,
          department: slip.employee.departmentName,
          job: slip.employee.jobName,
          ptkp: slip.ptkpStatus,
        },
        earnings,
        // Potongan tampil positif; PPh 21 lebih potong (baris positif) tampil sebagai pengembalian (negatif).
        deductions: slip.lines
          .filter((l) => ["bpjs_employee", "tax", "deduction"].includes(l.category))
          .map((l) => ({ name: l.name, amount: String(-Number(l.amount)) })),
        employer: pick(["bpjs_employer"]),
        net: slip.net,
        pph21Info: slip.isFinal
          ? `PPh 21 masa pajak terakhir dihitung setahun (tarif Pasal 17) dikurangi PPh 21 yang telah dipotong. Penghasilan bruto bulan ini Rp ${slip.gross}.`
          : `PPh 21 metode TER kategori ${slip.terCategory} tarif ${slip.terRate ?? 0}% × penghasilan bruto Rp ${slip.gross} (termasuk premi JKK, JKM, BPJS Kesehatan yang dibayar perusahaan).`,
      });
      return {
        filename: `slip-${slip.employee.employeeNumber}-${slip.run.periodStart.slice(0, 7)}.pdf`.replace(
          /[^\w.-]+/g,
          "_",
        ),
        content,
      };
    });
    res.type("application/pdf").attachment(file.filename).send(file.content);
  }

  @Get("me/payslips")
  mine() {
    return this.tenantDb.run((tx) => this.payroll.mySlips(tx));
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

@Module({
  imports: [AccountingModule, HrModule],
  controllers: [SalaryComponentsController, PayrollController],
  providers: [ActivityService, PayrollService],
})
export class PayrollModule {}
