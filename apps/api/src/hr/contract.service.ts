import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, schema, sql, type Db } from "@erp/db";
import type { contractSchema } from "@erp/shared";
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
}
