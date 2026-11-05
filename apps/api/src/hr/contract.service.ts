import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, ne, schema, sql, type Db } from "@erp/db";
import { addDays, RESIGN_REASON_LABEL, type contractEndSchema, type contractSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { fieldError } from "../accounting/context.js";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ChecklistService } from "./checklist.service.js";
import { EmployeeService } from "./employee.service.js";
import { HistoryService } from "./history.service.js";
import { assertContractType, contractTypeOf } from "./contract-types.module.js";
import { assertBeforeRetirement } from "./retirement.module.js";

const C = schema.contracts;

/**
 * Tanggal masuk & keluar hanya diinput di kontrak kerja (mulai kontrak pertama / Akhiri kontrak: karyawan keluar);
 * perubahan lewat data karyawan ditolak, nilai yang sama (mis. form/impor ulang) diabaikan.
 */
export function assertDatesUnchanged(
  current: { joinDate: string; resignDate: string | null },
  sent: { joinDate?: string | null; resignDate?: string | null },
) {
  if ("joinDate" in sent && sent.joinDate && sent.joinDate !== current.joinDate)
    throw fieldError("joinDate", "Tanggal masuk diubah lewat tanggal mulai kontrak kerja pertama");
  if ("resignDate" in sent && (sent.resignDate ?? null) !== current.resignDate)
    throw fieldError(
      "resignDate",
      "Tanggal keluar diisi lewat Akhiri kontrak (karyawan keluar) di kontrak kerja",
    );
}

/** Pembuatan & mulai berlaku kontrak (dipakai controller kontrak dan impor data). */
@Injectable()
export class ContractService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
  ) {}

  async find(tx: Db, id: string) {
    const [row] = await tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Kontrak tidak ditemukan");
    return row;
  }

  /** Komponen gaji kontrak harus milik perusahaan & tidak ganda; `prefix` untuk path error (mis. "contract."). */
  async assertComponents(tx: Db, ids: string[], prefix = "") {
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
      if (!row) throw fieldError(`${prefix}allowances.${i}.componentId`, "Komponen gaji tidak ditemukan");
    }
    if (new Set(ids).size !== ids.length) throw fieldError(`${prefix}allowances`, "Komponen ganda");
  }

  /**
   * Kontrak tidak boleh mulai/berakhir setelah karyawan keluar (tanggal keluar = akhir kontrak "keluar"). Mulai sebelum
   * tanggal masuk boleh: kontrak itu menjadi kontrak pertama dan tanggal masuk ikut maju (lihat `syncJoinDate`).
   */
  assertWithinEmployment(
    employee: { resignDate: string | null },
    dates: { dateStart: string; dateEnd?: string | null },
  ) {
    if (employee.resignDate && dates.dateStart > employee.resignDate)
      throw fieldError(
        "dateStart",
        `Karyawan sudah keluar per ${employee.resignDate}; batalkan keluar di kontrak terakhirnya dulu`,
      );
    if (employee.resignDate && dates.dateEnd && dates.dateEnd > employee.resignDate)
      throw fieldError(
        "dateEnd",
        `Kontrak tidak boleh berakhir setelah tanggal keluar karyawan (${employee.resignDate})`,
      );
  }

  /**
   * Tanggal masuk karyawan diinput hanya lewat kontrak: tanggal masuk = mulai kontrak pertama. Dipanggil setelah kontrak
   * dibuat/diubah/dihapus. Kontrak yang mulai lebih awal dari tanggal masuk memajukan tanggal masuk; kontrak yang
   * menentukan tanggal masuk (mulai = tanggal masuk) dipindah/dihapus → tanggal masuk mengikuti kontrak pertama yang
   * tersisa. Karyawan lama yang tanggal masuknya sebelum kontrak pertama tercatat tidak berubah.
   */
  async syncJoinDate(tx: Db, employeeId: string, change: { before: string | null; after: string | null }) {
    const E = schema.employees;
    const [employee] = await tx.select().from(E).where(eq(E.id, employeeId));
    if (!employee) return;
    const [first] = await tx
      .select({ start: sql<string | null>`min(${C.dateStart})::text` })
      .from(C)
      .where(and(eq(C.employeeId, employeeId), ne(C.state, "cancel")));
    const firstStart = first?.start ?? null;
    let joinDate = employee.joinDate;
    if (firstStart && firstStart < joinDate) joinDate = firstStart;
    else if (firstStart && change.before === employee.joinDate && change.after !== change.before)
      joinDate = firstStart;
    if (joinDate === employee.joinDate) return;
    if (employee.resignDate && joinDate > employee.resignDate)
      throw fieldError(
        "dateStart",
        "Tanggal mulai kontrak pertama (tanggal masuk) setelah tanggal keluar karyawan",
      );
    await tx
      .update(E)
      .set({ joinDate, updatedAt: sql`now()` })
      .where(eq(E.id, employeeId));
    await this.history.record(tx, employee, "join", {
      date: joinDate,
      oldValue: employee.joinDate,
      newValue: joinDate,
      note: "mengikuti tanggal mulai kontrak",
    });
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employeeId,
      action: "comment",
      message: `Tanggal masuk ${employee.joinDate} → ${joinDate} (mengikuti tanggal mulai kontrak)`,
    });
  }

  /**
   * Akhiri kontrak. Dengan `exit`: karyawan keluar per tanggal berakhir (satu-satunya tempat tanggal keluar diisi) —
   * tanggal & alasan keluar karyawan diisi, riwayat dicatat, checklist offboarding dimulai. Kontrak keluar yang sudah
   * berakhir bisa diakhiri ulang untuk mengubah tanggal/alasan keluar; kontrak terakhir yang sudah berakhir (mis. PKWT
   * habis) bisa ditandai keluar.
   */
  async end(tx: Db, id: string, input: z.infer<typeof contractEndSchema>) {
    const contract = await this.find(tx, id);
    if (contract.state === "draft" || contract.state === "cancel")
      throw new BadRequestException("Hanya kontrak berjalan yang bisa diakhiri");
    if (contract.state === "closed" && !input.exit && !contract.endReason)
      throw new BadRequestException("Kontrak sudah berakhir");
    if (input.dateEnd < contract.dateStart) throw fieldError("dateEnd", "Tanggal berakhir sebelum mulai");
    const others = await tx
      .select({ id: C.id, name: C.name, state: C.state, dateStart: C.dateStart })
      .from(C)
      .where(and(eq(C.employeeId, contract.employeeId), ne(C.state, "cancel"), ne(C.id, contract.id)));
    if (input.exit) {
      // Kontrak keluar harus kontrak terakhir: tidak ada kontrak lain yang mulai setelahnya / masih berjalan.
      const later = others.find((o) => o.dateStart > contract.dateStart || o.state === "running");
      if (later?.state === "draft")
        throw new BadRequestException(
          `Ada kontrak draft ${later.name} setelah kontrak ini; hapus draftnya dulu`,
        );
      if (later)
        throw new BadRequestException(
          `Kontrak ${later.name} masih berjalan setelah kontrak ini; akhiri dari kontrak terakhir`,
        );
    }
    await tx
      .update(C)
      .set({
        state: "closed",
        dateEnd: input.dateEnd,
        endReason: input.exit ? input.resignReason! : null,
        endNote: input.exit ? (input.resignNote ?? null) : null,
        // Pertama kali diproses keluar: ingat status & tanggal berakhir semula untuk "batalkan keluar".
        ...(input.exit && !contract.endReason
          ? { preExitState: contract.state as "running" | "closed", preExitDateEnd: contract.dateEnd }
          : {}),
        ...(!input.exit ? { preExitState: null, preExitDateEnd: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, id));
    const E = schema.employees;
    const employee = await this.employees.find(tx, contract.employeeId);
    if (!input.exit) {
      if (contract.endReason) await this.clearExit(tx, employee, contract.name);
      else
        await this.activity.log(tx, {
          resModel: "employee",
          resId: employee.id,
          action: "comment",
          message: `Kontrak ${contract.name} diakhiri per ${input.dateEnd}`,
        });
      return { checklistId: null };
    }
    await tx
      .update(E)
      .set({
        resignDate: input.dateEnd,
        resignReason: input.resignReason!,
        resignNote: input.resignNote ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(E.id, employee.id));
    const label = RESIGN_REASON_LABEL[input.resignReason!]?.[0] ?? input.resignReason!;
    if (employee.resignDate !== input.dateEnd)
      await this.history.record(tx, employee, "resign", {
        date: input.dateEnd,
        oldValue: employee.resignDate,
        newValue: input.dateEnd,
        note: label,
      });
    // Checklist offboarding hanya saat pertama kali diproses keluar (bukan saat tanggal/alasan diperbaiki).
    const checklist =
      input.startChecklist && !employee.resignDate
        ? await this.checklists.start(tx, {
            employeeId: employee.id,
            kind: "offboarding",
            baseDate: input.dateEnd,
          })
        : null;
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Kontrak ${contract.name} diakhiri: karyawan keluar ${input.dateEnd} (${label})`,
    });
    return { checklistId: checklist?.id ?? null };
  }

  /**
   * Batalkan keluar: kontrak kembali ke status & tanggal berakhir sebelum diproses keluar (data lama tanpa catatan itu:
   * berjalan, PKWTT tanpa tanggal berakhir), data keluar karyawan dihapus.
   */
  async cancelExit(tx: Db, id: string) {
    const contract = await this.find(tx, id);
    if (!contract.endReason)
      throw new BadRequestException("Kontrak ini tidak diakhiri karena karyawan keluar");
    const state = contract.preExitState ?? "running";
    const dateEnd = contract.preExitState
      ? contract.preExitDateEnd
      : (await contractTypeOf(tx, contract.contractType))?.fixedTerm === false
        ? null
        : contract.dateEnd;
    if (state === "running") {
      const [running] = await tx
        .select({ name: C.name })
        .from(C)
        .where(and(eq(C.employeeId, contract.employeeId), eq(C.state, "running"), ne(C.id, contract.id)));
      if (running)
        throw new BadRequestException(`Karyawan masih punya kontrak berjalan (${running.name}); akhiri dulu`);
    }
    await tx
      .update(C)
      .set({
        state,
        dateEnd,
        endReason: null,
        endNote: null,
        preExitState: null,
        preExitDateEnd: null,
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, id));
    await this.clearExit(tx, await this.employees.find(tx, contract.employeeId), contract.name);
  }

  private async clearExit(
    tx: Db,
    employee: { id: string; companyId: string; resignDate: string | null },
    name: string,
  ) {
    if (!employee.resignDate) return;
    await tx
      .update(schema.employees)
      .set({ resignDate: null, resignReason: null, resignNote: null, updatedAt: sql`now()` })
      .where(eq(schema.employees.id, employee.id));
    await this.history.record(tx, employee, "resign", {
      date: employee.resignDate,
      oldValue: employee.resignDate,
      newValue: null,
      note: `keluar dibatalkan (${name})`,
    });
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Keluar per ${employee.resignDate} dibatalkan (kontrak ${name})`,
    });
  }

  /** Kontrak draft baru; mengembalikan id. */
  async create(tx: Db, input: z.infer<typeof contractSchema>) {
    const employee = await this.employees.find(tx, input.employeeId);
    this.assertWithinEmployment(employee, input);
    await assertBeforeRetirement(tx, employee, input);
    await assertContractType(tx, input.contractType, input);
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
    await this.syncJoinDate(tx, employee.id, { before: null, after: input.dateStart });
    return row!.id;
  }

  /**
   * Mulai berlaku; hanya satu kontrak berjalan per karyawan. Calon karyawan dari rekrutmen menjadi karyawan aktif
   * di sini, lalu onboarding dimulai (tugas "tanda tangan kontrak" langsung selesai).
   */
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
    await this.activatePending(tx, contract);
  }

  /** Calon karyawan (dari rekrutmen) → aktif saat kontrak pertamanya dimulai, lalu onboarding. */
  private async activatePending(tx: Db, contract: typeof C.$inferSelect) {
    const E = schema.employees;
    const [employee] = await tx.select().from(E).where(eq(E.id, contract.employeeId));
    if (!employee?.pendingStart) return;
    await tx
      .update(E)
      .set({ active: true, pendingStart: false, joinDate: contract.dateStart, updatedAt: sql`now()` })
      .where(eq(E.id, employee.id));
    await this.history.record(tx, employee, "join", {
      date: contract.dateStart,
      newValue: contract.dateStart,
      note: contract.name,
    });
    const checklist = await this.checklists.start(tx, { employeeId: employee.id, kind: "onboarding" });
    const T = schema.hrChecklistTasks;
    await tx
      .update(T)
      .set({ doneAt: new Date(), doneBy: currentContext().userId })
      .where(
        and(eq(T.checklistId, checklist.id), isNull(T.doneAt), isNull(T.action), ilike(T.name, "%kontrak%")),
      );
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Kontrak ${contract.name} dimulai: karyawan aktif, onboarding dimulai`,
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
