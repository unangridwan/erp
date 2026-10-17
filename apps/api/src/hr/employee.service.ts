import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, eq, ilike, or, schema, sql, type Db, type SQL } from "@erp/db";
import { hasPermission, type employeeSchema } from "@erp/shared";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertDimensions, fieldError } from "../accounting/context.js";
import { decrypt, encrypt } from "../common/crypto.js";
import { currentContext } from "../common/request-context.js";
import { CONFIG, type AppConfig } from "../config.js";
import { assertCompanyUser } from "../crm/checks.js";
import { SequenceService } from "../sequences/sequence.service.js";

export type EmployeeInput = z.infer<typeof employeeSchema>;
type Employee = typeof schema.employees.$inferSelect;

const E = schema.employees;
/** Nilai sensitif yang ditampilkan tersamar; dikirim balik apa adanya berarti "tidak diubah". */
const MASK = "••••";
const SENSITIVE = { nik: "nikEnc", npwp: "npwpEnc", bankAccount: "bankAccountEnc" } as const;

@Injectable()
export class EmployeeService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Buka data sensitif hanya untuk pemegang hr.manage (atau karyawan itu sendiri); lainnya tersamar. */
  reveal(employee: Employee, full = hasPermission(currentContext().permissions, "hr.manage")) {
    const { nikEnc, npwpEnc, bankAccountEnc, ...rest } = employee;
    const open = (v: string | null) => {
      if (!v) return null;
      const plain = decrypt(v, this.config.encryptionKey);
      return full ? plain : `${MASK}${plain.slice(-4)}`;
    };
    return { ...rest, nik: open(nikEnc), npwp: open(npwpEnc), bankAccount: open(bankAccountEnc) };
  }

  /** NPWP atau NIK (berlaku sebagai NPWP sejak 2024) menentukan tarif PPh 21 normal. */
  hasTaxId(employee: Employee) {
    return Boolean(employee.npwpEnc || employee.nikEnc);
  }

  decrypted(employee: Employee) {
    return this.reveal(employee, true);
  }

  async list(
    tx: Db,
    query: { q?: string; departmentId?: string; active?: string; limit?: string; offset?: string },
  ) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters: (SQL | undefined)[] = [eq(E.companyId, currentContext().companyId)];
    if (query.q) {
      const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(ilike(E.name, term), ilike(E.employeeNumber, term), ilike(E.workEmail, term)));
    }
    if (query.departmentId) filters.push(eq(E.departmentId, query.departmentId));
    if (query.active !== "all") filters.push(eq(E.active, query.active !== "false"));
    const where = and(...filters);
    const rows = await tx
      .select({
        employee: E,
        departmentName: schema.departments.name,
        jobName: schema.jobPositions.name,
      })
      .from(E)
      .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
      .leftJoin(schema.jobPositions, eq(schema.jobPositions.id, E.jobId))
      .where(where)
      .orderBy(asc(E.name))
      .limit(limit)
      .offset(offset);
    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(E).where(where);
    return {
      items: rows.map((r) => {
        // Daftar tidak memuat data sensitif sama sekali.
        const { nikEnc: _n, npwpEnc: _p, bankAccountEnc: _b, ...rest } = r.employee;
        return { ...rest, departmentName: r.departmentName, jobName: r.jobName };
      }),
      total,
      limit,
      offset,
    };
  }

  async find(tx: Db, id: string): Promise<Employee> {
    const [row] = await tx
      .select()
      .from(E)
      .where(and(eq(E.id, id), eq(E.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Karyawan tidak ditemukan");
    return row;
  }

  /** Karyawan yang terhubung dengan user saat ini di perusahaan aktif. */
  async mine(tx: Db) {
    const ctx = currentContext();
    const [row] = await tx
      .select()
      .from(E)
      .where(and(eq(E.userId, ctx.userId), eq(E.companyId, ctx.companyId)));
    if (!row) throw new NotFoundException("Akun Anda belum terhubung dengan data karyawan di perusahaan ini");
    return row;
  }

  async create(tx: Db, input: EmployeeInput) {
    const companyId = currentContext().companyId;
    const values = await this.prepare(tx, input, companyId);
    const employeeNumber =
      input.employeeNumber ||
      (await this.sequences.next(
        tx,
        "hr.employee",
        companyId,
        new Date(`${input.joinDate}T00:00:00Z`),
        "EMP",
      ));
    const [row] = await tx
      .insert(E)
      .values({ ...(values as typeof E.$inferInsert), companyId, employeeNumber })
      .returning();
    await this.activity.log(tx, { resModel: "employee", resId: row!.id, action: "create" });
    return this.reveal(row!);
  }

  async update(tx: Db, id: string, sent: Partial<EmployeeInput>) {
    const before = await this.find(tx, id);
    const values = await this.prepare(tx, sent, before.companyId, id);
    if (Object.keys(values).length === 0) return this.reveal(before);
    const [row] = await tx
      .update(E)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(E.id, id))
      .returning();
    // Riwayat tidak memuat nilai data sensitif.
    const changes = Object.fromEntries(
      Object.entries(values)
        .filter(([k]) => !k.endsWith("Enc"))
        .filter(([k, v]) => String(before[k as keyof Employee] ?? "") !== String(v ?? ""))
        .map(([k, v]) => [k, { from: before[k as keyof Employee], to: v }]),
    );
    const sensitive = Object.keys(values).filter((k) => k.endsWith("Enc"));
    await this.activity.log(tx, {
      resModel: "employee",
      resId: id,
      action: "update",
      changes,
      message: sensitive.length ? "Data pribadi diperbarui" : undefined,
    });
    return this.reveal(row!);
  }

  async remove(tx: Db, id: string) {
    await this.find(tx, id);
    const [slip] = await tx
      .select({ id: schema.payslips.id })
      .from(schema.payslips)
      .where(eq(schema.payslips.employeeId, id))
      .limit(1);
    if (slip) throw new BadRequestException("Karyawan sudah punya slip gaji; nonaktifkan saja");
    await tx.delete(E).where(eq(E.id, id));
    await this.activity.log(tx, { resModel: "employee", resId: id, action: "delete" });
  }

  /** Validasi rujukan & enkripsi data sensitif. Mengembalikan kolom yang akan disimpan. */
  private async prepare(tx: Db, input: Partial<EmployeeInput>, companyId: string, id?: string) {
    const { nik, npwp, bankAccount, employeeNumber, ...rest } = input;
    const values: Record<string, unknown> = { ...rest };
    if (employeeNumber && id) values.employeeNumber = employeeNumber;
    const canManage = hasPermission(currentContext().permissions, "hr.manage");
    for (const [field, column] of Object.entries(SENSITIVE)) {
      const value = { nik, npwp, bankAccount }[field as keyof typeof SENSITIVE];
      if (value === undefined || (typeof value === "string" && value.startsWith(MASK))) continue;
      if (!canManage) throw new ForbiddenException("Butuh permission hr.manage untuk mengubah data pribadi");
      values[column] = value ? encrypt(value, this.config.encryptionKey) : null;
    }
    if (input.departmentId) {
      const [dept] = await tx
        .select({ id: schema.departments.id })
        .from(schema.departments)
        .where(
          and(eq(schema.departments.id, input.departmentId), eq(schema.departments.companyId, companyId)),
        );
      if (!dept) throw fieldError("departmentId", "Departemen tidak ditemukan di perusahaan ini");
    }
    if (input.jobId) {
      const [job] = await tx
        .select({ id: schema.jobPositions.id })
        .from(schema.jobPositions)
        .where(eq(schema.jobPositions.id, input.jobId));
      if (!job) throw fieldError("jobId", "Jabatan tidak ditemukan");
    }
    if (input.managerId) {
      if (input.managerId === id) throw fieldError("managerId", "Atasan tidak boleh diri sendiri");
      const [manager] = await tx
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.id, input.managerId), eq(E.companyId, companyId)));
      if (!manager) throw fieldError("managerId", "Atasan tidak ditemukan di perusahaan ini");
    }
    if (input.userId) await assertCompanyUser(tx, input.userId);
    await assertDimensions(tx, companyId, [
      { branchId: input.branchId, businessUnitId: input.businessUnitId },
    ]).catch((e: unknown) => {
      if (e instanceof BadRequestException) {
        const res = e.getResponse() as { errors?: { path: string; message: string }[] };
        throw fieldError(
          res.errors?.[0]?.path.replace(/^lines\.0\./, "") ?? "",
          res.errors?.[0]?.message ?? "",
        );
      }
      throw e;
    });
    if (input.resignDate && input.joinDate && input.resignDate < input.joinDate)
      throw fieldError("resignDate", "Tanggal keluar sebelum tanggal masuk");
    return values;
  }
}
