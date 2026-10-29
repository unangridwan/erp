import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, schema, sql, type Db } from "@erp/db";
import { addDays, type contractSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { EmployeeService } from "./employee.service.js";
import { HistoryService } from "./history.service.js";

const C = schema.contracts;

/** Pembuatan & mulai berlaku kontrak (dipakai controller kontrak dan impor data). */
@Injectable()
export class ContractService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Kontrak tidak ditemukan");
    return row;
  }

  async assertComponents(tx: Db, ids: string[]) {
    for (const [i, id] of ids.entries()) {
      const [row] = await tx
        .select({ kind: schema.salaryComponents.kind })
        .from(schema.salaryComponents)
        .where(
          and(
            eq(schema.salaryComponents.id, id),
            eq(schema.salaryComponents.companyId, currentContext().companyId),
          ),
        );
      if (!row) throw fieldError(`allowances.${i}.componentId`, "Komponen gaji tidak ditemukan");
    }
    if (new Set(ids).size !== ids.length) throw fieldError("allowances", "Komponen ganda");
  }

  /** Kontrak draft baru; mengembalikan id. */
  async create(tx: Db, input: z.infer<typeof contractSchema>) {
    const employee = await this.employees.find(tx, input.employeeId);
    await this.assertComponents(
      tx,
      input.allowances.map((a) => a.componentId),
    );
    const name = await this.sequences.next(
      tx,
      "hr.contract",
      employee.companyId,
      new Date(`${input.dateStart}T00:00:00Z`),
      "KTR",
    );
    const [row] = await tx
      .insert(C)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        name,
        contractType: input.contractType,
        wageType: input.wageType,
        taxMethod: input.taxMethod,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd ?? null,
        wage: input.wage,
        note: input.note ?? null,
      })
      .returning();
    if (input.allowances.length)
      await tx
        .insert(schema.contractAllowances)
        .values(input.allowances.map((a) => ({ ...a, contractId: row!.id })));
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Kontrak ${name} dibuat`,
    });
    return row!.id;
  }

  /** Mulai berlaku; hanya satu kontrak berjalan per karyawan. */
  async start(tx: Db, id: string) {
    const contract = await this.find(tx, id);
    if (contract.state !== "draft") throw new BadRequestException("Hanya kontrak draft yang bisa dimulai");
    const [running] = await tx
      .select({ name: C.name })
      .from(C)
      .where(and(eq(C.employeeId, contract.employeeId), eq(C.state, "running")));
    if (running)
      throw new BadRequestException(`Karyawan masih punya kontrak berjalan (${running.name}); akhiri dulu`);
    await tx
      .update(C)
      .set({ state: "running", updatedAt: sql`now()` })
      .where(eq(C.id, id));
    // Riwayat upah: dibanding kontrak sebelumnya.
    const [previous] = await tx
      .select({ wage: C.wage })
      .from(C)
      .where(and(eq(C.employeeId, contract.employeeId), eq(C.state, "closed")))
      .orderBy(desc(C.dateStart))
      .limit(1);
    if (!previous || !new Decimal(previous.wage).eq(contract.wage))
      await this.history.record(tx, { id: contract.employeeId, companyId: contract.companyId }, "wage", {
        date: contract.dateStart,
        oldValue: previous ? new Decimal(previous.wage).toFixed(0) : null,
        newValue: new Decimal(contract.wage).toFixed(0),
        note: contract.name,
      });
  }

  /**
   * Upah baru berlaku per tanggal efektif: akhiri kontrak berjalan sehari sebelumnya lalu mulai kontrak baru (tunjangan
   * disalin) sehingga payroll memakai upah baru sejak tanggal efektif (tanggal lampau → rapel di payroll berikutnya).
   */
  async renewWage(
    tx: Db,
    employee: { id: string; companyId: string },
    change: { effectiveDate: string; newWage: string; note?: string | null },
  ) {
    const [running] = await tx
      .select()
      .from(C)
      .where(and(eq(C.employeeId, employee.id), eq(C.state, "running")));
    if (!running) throw new BadRequestException("Karyawan belum punya kontrak berjalan untuk diubah upahnya");
    if (change.effectiveDate <= running.dateStart)
      throw fieldError("effectiveDate", "Tanggal efektif harus setelah awal kontrak berjalan");
    await tx
      .update(C)
      .set({ state: "closed", dateEnd: addDays(change.effectiveDate, -1), updatedAt: sql`now()` })
      .where(eq(C.id, running.id));
    const name = await this.sequences.next(
      tx,
      "hr.contract",
      employee.companyId,
      new Date(`${change.effectiveDate}T00:00:00Z`),
      "KTR",
    );
    const [contract] = await tx
      .insert(C)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        name,
        contractType: running.contractType,
        wageType: running.wageType,
        taxMethod: running.taxMethod,
        dateStart: change.effectiveDate,
        dateEnd: running.dateEnd && running.dateEnd > change.effectiveDate ? running.dateEnd : null,
        wage: change.newWage,
        state: "running",
        note: [change.note, `menggantikan ${running.name}`].filter(Boolean).join(", "),
      })
      .returning();
    const allowances = await tx
      .select({
        componentId: schema.contractAllowances.componentId,
        amount: schema.contractAllowances.amount,
      })
      .from(schema.contractAllowances)
      .where(eq(schema.contractAllowances.contractId, running.id));
    if (allowances.length)
      await tx
        .insert(schema.contractAllowances)
        .values(allowances.map((a) => ({ ...a, contractId: contract!.id })));
    if (!new Decimal(running.wage).eq(change.newWage))
      await this.history.record(tx, employee, "wage", {
        date: change.effectiveDate,
        oldValue: new Decimal(running.wage).toFixed(0),
        newValue: new Decimal(change.newWage).toFixed(0),
        note: contract!.name,
      });
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Kontrak ${running.name} diakhiri, ${contract!.name} berlaku ${change.effectiveDate}`,
    });
    return { id: contract!.id, oldWage: running.wage };
  }
}
