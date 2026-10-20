import { and, asc, eq, inArray, schema, sql, type Db } from "@erp/db";
import { Decimal } from "decimal.js";
import type { EmployeeService } from "../employee.service.js";
import type { PayrollService } from "../../payroll/payroll.service.js";
import { num, RowError, type Column, type Ctx, type Dataset } from "./core.js";

const E = schema.employees;
const RUN = schema.payrollRuns;
const SLIP = schema.payslips;

/** Periode payroll milik perusahaan aktif (wajib untuk dataset slip). */
async function runOf(tx: Db, ctx: Ctx) {
  if (!ctx.runId) throw new RowError("runId", "Pilih periode payroll");
  const [run] = await tx
    .select()
    .from(RUN)
    .where(and(eq(RUN.id, ctx.runId), eq(RUN.companyId, ctx.companyId)));
  if (!run) throw new RowError("runId", "Payroll tidak ditemukan");
  return run;
}

const MONEY = (key: string, header: string, group = "Slip"): Column => ({
  key,
  header,
  group,
  numeric: true,
});

function payslipsDataset(employees: EmployeeService): Dataset {
  return {
    key: "payslips",
    label: "Rekap slip gaji",
    description:
      "Satu baris per karyawan: hari kerja, setiap komponen gaji, bruto, BPJS Kesehatan, BPJS Ketenagakerjaan, PPh 21, dan gaji bersih (hanya ekspor).",
    app: "payroll",
    read: "payroll.read",
    admin: "payroll.write",
    needsRun: true,
    filters: [{ key: "departmentId", label: "Departemen", type: "ref", resource: "departments" }],
    async columns(tx, ctx) {
      const codes = ctx.runId
        ? await tx
            .selectDistinct({
              code: schema.payslipLines.code,
              // Nama komponen (nama baris bisa berisi keterangan input per karyawan).
              name: sql<string>`coalesce(${schema.salaryComponents.name}, ${schema.payslipLines.name})`,
              sequence: schema.payslipLines.sequence,
            })
            .from(schema.payslipLines)
            .innerJoin(SLIP, eq(SLIP.id, schema.payslipLines.payslipId))
            .leftJoin(
              schema.salaryComponents,
              eq(schema.salaryComponents.id, schema.payslipLines.componentId),
            )
            .where(eq(SLIP.runId, ctx.runId))
            .orderBy(asc(schema.payslipLines.sequence))
        : [];
      const seen = new Set<string>();
      const lineColumns = codes
        .filter((c) => !seen.has(c.code) && seen.add(c.code))
        .map((c) => MONEY(`l_${c.code}`, `${c.code} ${c.name}`, "Komponen gaji"));
      return [
        { key: "employeeNumber", header: "No. Karyawan", group: "Karyawan", key0: true },
        { key: "employeeName", header: "Nama Karyawan", group: "Karyawan" },
        { key: "departmentName", header: "Departemen", group: "Karyawan" },
        { key: "jobName", header: "Jabatan", group: "Karyawan" },
        { key: "ptkpStatus", header: "Status PTKP", group: "Pajak" },
        { key: "terCategory", header: "Kategori TER", group: "Pajak" },
        { key: "workingDays", header: "Hari Kerja", group: "Slip", numeric: true },
        { key: "unpaidDays", header: "Hari Tidak Dibayar", group: "Slip", numeric: true },
        ...lineColumns,
        MONEY("earnings", "Total Pendapatan"),
        MONEY("gross", "Penghasilan Bruto"),
        MONEY("bpjsKesWage", "Dasar Upah BPJS Kesehatan", "BPJS Kesehatan"),
        MONEY("kesEmployee", "BPJS Kesehatan Karyawan", "BPJS Kesehatan"),
        MONEY("kesEmployer", "BPJS Kesehatan Perusahaan", "BPJS Kesehatan"),
        MONEY("bpjsTkWage", "Dasar Upah BPJS Ketenagakerjaan", "BPJS Ketenagakerjaan"),
        MONEY("tkEmployee", "BPJS Ketenagakerjaan Karyawan", "BPJS Ketenagakerjaan"),
        MONEY("tkEmployer", "BPJS Ketenagakerjaan Perusahaan", "BPJS Ketenagakerjaan"),
        MONEY("pph21", "PPh 21", "Pajak"),
        MONEY("deductions", "Total Potongan"),
        MONEY("net", "Gaji Bersih"),
        { key: "bankName", header: "Bank", group: "Rekening" },
        { key: "bankAccount", header: "No. Rekening", group: "Rekening", sensitive: true },
        { key: "bankAccountName", header: "Nama Pemilik Rekening", group: "Rekening" },
      ];
    },
    async rows(tx, ctx, query) {
      const run = await runOf(tx, ctx);
      const slips = await tx
        .select({
          slip: SLIP,
          employee: E,
          departmentName: schema.departments.name,
          jobName: schema.jobPositions.name,
        })
        .from(SLIP)
        .innerJoin(E, eq(E.id, SLIP.employeeId))
        .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
        .where(
          and(
            eq(SLIP.runId, run.id),
            query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
          ),
        )
        .orderBy(asc(E.name));
      const lines = slips.length
        ? await tx
            .select({
              payslipId: schema.payslipLines.payslipId,
              code: schema.payslipLines.code,
              amount: schema.payslipLines.amount,
            })
            .from(schema.payslipLines)
            .where(
              inArray(
                schema.payslipLines.payslipId,
                slips.map((s) => s.slip.id),
              ),
            )
        : [];
      return slips.map((s) => {
        const byCode: Record<string, string> = {};
        for (const l of lines.filter((x) => x.payslipId === s.slip.id))
          byCode[`l_${l.code}`] = new Decimal(byCode[`l_${l.code}`] ?? 0).plus(l.amount).toFixed(2);
        const open = employees.decrypted(s.employee);
        return {
          ...s.slip,
          ...byCode,
          employeeNumber: s.employee.employeeNumber,
          employeeName: s.employee.name,
          departmentName: s.departmentName,
          jobName: s.jobName,
          bankName: s.employee.bankName,
          bankAccount: open.bankAccount,
          bankAccountName: s.employee.bankAccountName,
        };
      });
    },
  };
}

function inputsDataset(payroll: PayrollService): Dataset {
  return {
    key: "payslip-inputs",
    label: "Input variabel slip gaji",
    description:
      "Tunjangan/potongan tidak tetap per karyawan untuk periode payroll draft (bonus, insentif, potongan, dll.). Input manual karyawan yang ada di berkas diganti; THR & rapel tidak tersentuh.",
    app: "payroll",
    read: "payroll.read",
    write: "payroll.write",
    admin: "payroll.write",
    needsRun: true,
    columns: () => [
      {
        key: "employeeNumber",
        header: "No. Karyawan",
        group: "Karyawan",
        required: true,
        example: "EMP/2024/0001",
        key0: true,
      },
      {
        key: "employeeName",
        header: "Nama Karyawan",
        group: "Karyawan",
        note: "Hanya info; diabaikan saat impor",
      },
      {
        key: "componentCode",
        header: "Kode Komponen",
        group: "Input",
        required: true,
        example: "BONUS",
        note: "Kode komponen gaji",
      },
      { key: "componentName", header: "Nama Komponen", group: "Input", note: "Hanya info" },
      { key: "amount", header: "Jumlah", group: "Input", required: true, numeric: true, example: "500000" },
      { key: "description", header: "Keterangan", group: "Input" },
    ],
    async rows(tx, ctx) {
      const run = await runOf(tx, ctx);
      const rows = await tx
        .select({
          employeeNumber: E.employeeNumber,
          employeeName: E.name,
          componentCode: schema.salaryComponents.code,
          componentName: schema.salaryComponents.name,
          amount: schema.payslipInputs.amount,
          description: schema.payslipInputs.description,
        })
        .from(schema.payslipInputs)
        .innerJoin(SLIP, eq(SLIP.id, schema.payslipInputs.payslipId))
        .innerJoin(E, eq(E.id, SLIP.employeeId))
        .innerJoin(schema.salaryComponents, eq(schema.salaryComponents.id, schema.payslipInputs.componentId))
        .where(and(eq(SLIP.runId, run.id), eq(schema.payslipInputs.source, "manual")))
        .orderBy(asc(E.name), asc(schema.salaryComponents.code));
      return rows;
    },
    async importAll(tx, rows, ctx, lookups, fail) {
      const run = await runOf(tx, ctx);
      if (run.state !== "draft") throw new RowError("runId", "Payroll sudah diposting");
      const slips = new Map(
        (
          await tx
            .select({ id: SLIP.id, employeeId: SLIP.employeeId })
            .from(SLIP)
            .where(eq(SLIP.runId, run.id))
        ).map((s) => [s.employeeId, s.id]),
      );
      const bySlip = new Map<string, { componentId: string; amount: string; description: string | null }[]>();
      for (const { line, row } of rows) {
        try {
          const number = (row.employeeNumber ?? "").trim();
          if (!number) throw new RowError("employeeNumber", "No. Karyawan wajib diisi");
          const employee = await lookups.employee("employeeNumber", number);
          const slipId = slips.get(employee.id);
          if (!slipId)
            throw new RowError("employeeNumber", `${employee.name} tidak ada di periode payroll ini`);
          const componentCode = (row.componentCode ?? "").trim();
          if (!componentCode) throw new RowError("componentCode", "Kode komponen wajib diisi");
          const componentId = await lookups.ref("components", "componentCode", componentCode);
          if (!(row.amount ?? "").trim()) throw new RowError("amount", "Jumlah wajib diisi");
          const amount = num("amount", row.amount!);
          if (Number(amount) < 0) throw new RowError("amount", "Jumlah tidak boleh negatif");
          const list = bySlip.get(slipId) ?? [];
          list.push({ componentId, amount, description: (row.description ?? "").trim() || null });
          bySlip.set(slipId, list);
        } catch (e) {
          if (!(e instanceof RowError)) throw e;
          fail(line, e.column, e.message);
        }
      }
      for (const [slipId, inputs] of bySlip) await payroll.setInputs(tx, slipId, inputs);
      return {
        created: [...bySlip.values()].reduce((s, l) => s + l.length, 0),
        updated: bySlip.size,
        skipped: 0,
      };
    },
  };
}

export function payrollDatasets(payroll: PayrollService, employees: EmployeeService): Dataset[] {
  return [inputsDataset(payroll), payslipsDataset(employees)];
}
