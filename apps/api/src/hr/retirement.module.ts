import { Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Put, Query } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, isNull, or, schema, sql, type Db } from "@erp/db";
import {
  addDays,
  DEFAULT_RETIREMENT_AGE,
  resolveRetirementAge,
  retirementDate,
  retirementPolicySchema,
  type RetirementDateRule,
  businessToday,
} from "@erp/shared";
import { fieldError } from "../accounting/context.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";

const P = schema.retirementPolicies;
const R = schema.retirementRules;
type Employee = typeof schema.employees.$inferSelect;

/** Kebijakan usia pensiun perusahaan (bawaan 56 tahun, akhir bulan ulang tahun) + pengecualian. */
export async function retirementPolicy(tx: Db, companyId: string) {
  const [policy] = await tx.select().from(P).where(eq(P.companyId, companyId));
  const rules = await tx.select().from(R).where(eq(R.companyId, companyId));
  return {
    retirementAge: policy?.retirementAge ?? DEFAULT_RETIREMENT_AGE,
    dateRule: (policy?.dateRule ?? "end_of_month") as RetirementDateRule,
    reminderMonths: policy?.reminderMonths ?? 6,
    rules,
  };
}

/** Usia & tanggal pensiun karyawan (tanggal null bila tanggal lahir belum diisi). */
export function retirementFor(employee: Employee, policy: Awaited<ReturnType<typeof retirementPolicy>>) {
  const { age, source } = resolveRetirementAge(employee, policy, policy.rules);
  return {
    age,
    source,
    date: employee.birthDate ? retirementDate(employee.birthDate, age, policy.dateRule) : null,
  };
}

export async function retirementOf(tx: Db, employee: Employee) {
  return retirementFor(employee, await retirementPolicy(tx, employee.companyId));
}

/** Kontrak tidak boleh mulai/berakhir setelah tanggal pensiun (perpanjang lewat usia pensiun khusus karyawan). */
export async function assertBeforeRetirement(
  tx: Db,
  employee: Employee,
  dates: { dateStart: string; dateEnd?: string | null },
  prefix = "",
) {
  const r = await retirementOf(tx, employee);
  if (!r.date) return;
  if (dates.dateStart > r.date)
    throw fieldError(
      `${prefix}dateStart`,
      `Kontrak mulai melewati tanggal pensiun ${r.date} (usia ${r.age} tahun); atur usia pensiun khusus karyawan bila masa kerja diperpanjang`,
    );
  if (dates.dateEnd && dates.dateEnd > r.date)
    throw fieldError(
      `${prefix}dateEnd`,
      `Kontrak berakhir melewati tanggal pensiun ${r.date} (usia ${r.age} tahun); atur usia pensiun khusus karyawan bila masa kerja diperpanjang`,
    );
}

/** Karyawan aktif yang pensiun sampai `until` (termasuk yang sudah lewat tanggal pensiun tetapi belum keluar). */
export async function upcomingRetirements(tx: Db, companyId: string, until: string) {
  const policy = await retirementPolicy(tx, companyId);
  const E = schema.employees;
  const rows = await tx
    .select({
      employee: E,
      department: schema.departments.name,
      job: schema.jobPositions.name,
    })
    .from(E)
    .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
    .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
    .where(
      and(
        eq(E.companyId, companyId),
        eq(E.active, true),
        isNotNull(E.birthDate),
        or(isNull(E.resignDate), sql`${E.resignDate} >= current_date`),
      ),
    )
    .orderBy(asc(E.birthDate));
  return rows
    .map((r) => {
      const ret = retirementFor(r.employee, policy);
      return {
        employeeId: r.employee.id,
        employeeNumber: r.employee.employeeNumber,
        name: r.employee.name,
        birthDate: r.employee.birthDate,
        department: r.department,
        job: r.job,
        resignDate: r.employee.resignDate,
        ...ret,
      };
    })
    .filter((r) => r.date && r.date <= until && !(r.resignDate && r.resignDate <= r.date))
    .sort((a, b) => a.date!.localeCompare(b.date!));
}

/** SDM › Konfigurasi › Usia Pensiun: kebijakan per perusahaan aktif. */
@Controller()
class RetirementController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get("retirement-policy")
  @RequirePermission("hr.read")
  get() {
    return this.tenantDb.run((tx) => this.load(tx));
  }

  @Put("retirement-policy")
  @RequirePermission("hr.manage")
  save(@Body() body: unknown) {
    const input = parse(retirementPolicySchema, body);
    const companyId = currentContext().companyId;
    return this.tenantDb.run(async (tx) => {
      const seen = new Set<string>();
      for (const [i, rule] of input.rules.entries()) {
        const key = `${rule.kind}:${rule.refId}`;
        if (seen.has(key)) throw fieldError(`rules.${i}.refId`, "Pengecualian ganda");
        seen.add(key);
      }
      await this.assertRefs(tx, companyId, input.rules);
      await tx
        .insert(P)
        .values({
          companyId,
          retirementAge: input.retirementAge,
          dateRule: input.dateRule,
          reminderMonths: input.reminderMonths,
        })
        .onConflictDoUpdate({
          target: [P.tenantId, P.companyId],
          set: {
            retirementAge: input.retirementAge,
            dateRule: input.dateRule,
            reminderMonths: input.reminderMonths,
            updatedAt: sql`now()`,
          },
        });
      await tx.delete(R).where(eq(R.companyId, companyId));
      if (input.rules.length)
        await tx.insert(R).values(input.rules.map((r) => ({ ...r, note: r.note ?? null, companyId })));
      return this.load(tx);
    });
  }

  /** Karyawan yang akan pensiun dalam `months` bulan (bawaan: pengingat kebijakan, min. 12). */
  @Get("retirement/upcoming")
  @RequirePermission("hr.read")
  upcoming(@Query("months") months?: string) {
    return this.tenantDb.run(async (tx) => {
      const n = Math.min(Math.max(Number(months) || 12, 1), 120);
      const until = addDays(businessToday(), Math.round(n * 30.44));
      return upcomingRetirements(tx, currentContext().companyId, until);
    });
  }

  @Get("employees/:id/retirement")
  @RequirePermission("hr.read")
  ofEmployee(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const [employee] = await tx
        .select()
        .from(schema.employees)
        .where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, currentContext().companyId)));
      if (!employee) throw fieldError("id", "Karyawan tidak ditemukan");
      return retirementOf(tx, employee);
    });
  }

  private async load(tx: Db) {
    const policy = await retirementPolicy(tx, currentContext().companyId);
    const names = async (
      table: typeof schema.jobPositions | typeof schema.salaryGrades | typeof schema.departments,
      ids: string[],
    ) =>
      ids.length
        ? new Map(
            (
              await tx.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, ids))
            ).map((r) => [r.id, r.name]),
          )
        : new Map<string, string>();
    const ids = (kind: string) => policy.rules.filter((r) => r.kind === kind).map((r) => r.refId);
    const label = {
      job: await names(schema.jobPositions, ids("job")),
      grade: await names(schema.salaryGrades, ids("grade")),
      department: await names(schema.departments, ids("department")),
    };
    return {
      retirementAge: policy.retirementAge,
      dateRule: policy.dateRule,
      reminderMonths: policy.reminderMonths,
      rules: policy.rules
        .map((r) => ({
          kind: r.kind,
          refId: r.refId,
          refName: label[r.kind].get(r.refId) ?? null,
          retirementAge: r.retirementAge,
          note: r.note,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || (a.refName ?? "").localeCompare(b.refName ?? "")),
    };
  }

  private async assertRefs(
    tx: Db,
    companyId: string,
    rules: { kind: "job" | "grade" | "department"; refId: string }[],
  ) {
    for (const [i, r] of rules.entries()) {
      const table =
        r.kind === "job"
          ? schema.jobPositions
          : r.kind === "grade"
            ? schema.salaryGrades
            : schema.departments;
      const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, r.refId));
      const ok =
        row &&
        (r.kind !== "department" ||
          (
            await tx
              .select({ id: schema.departments.id })
              .from(schema.departments)
              .where(and(eq(schema.departments.id, r.refId), eq(schema.departments.companyId, companyId)))
          ).length > 0);
      if (!ok) throw fieldError(`rules.${i}.refId`, "Jabatan/golongan/departemen tidak ditemukan");
    }
  }
}

@Module({ controllers: [RetirementController] })
export class RetirementModule {}
