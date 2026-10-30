import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, schema, sql, type Db, type SQL } from "@erp/db";
import {
  addDays,
  addMonths,
  balanceOn,
  type bulkLeaveSchema,
  compensatoryDays,
  hasPermission,
  leaveDays,
  leaveLedger,
  lowestRemaining,
  eachDate,
  dayBreakdown,
  type leaveRequestSchema,
} from "@erp/shared";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { fieldError } from "../accounting/context.js";
import { currentContext } from "../common/request-context.js";
import { ApprovalService } from "./approval.service.js";
import { EmployeeService } from "./employee.service.js";
import { WorkCalendarService, type WorkCalendar } from "./work-calendar.service.js";

type LeaveInput = z.infer<typeof leaveRequestSchema>;
type BulkInput = z.infer<typeof bulkLeaveSchema>;
type LeaveType = typeof schema.leaveTypes.$inferSelect;
type Employee = typeof schema.employees.$inferSelect;
const R = schema.leaveRequests;
const A = schema.leaveAllocations;
const T = schema.leaveTypes;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const today = () => new Date().toISOString().slice(0, 10);

/** Kolom pengajuan cuti tanpa isi lampiran (bytea). */
const REQUEST_COLUMNS = {
  id: R.id,
  companyId: R.companyId,
  employeeId: R.employeeId,
  leaveTypeId: R.leaveTypeId,
  dateFrom: R.dateFrom,
  dateTo: R.dateTo,
  days: R.days,
  reason: R.reason,
  state: R.state,
  approvedBy: R.approvedBy,
  approvedAt: R.approvedAt,
  approvalStep: R.approvalStep,
  approvalLevels: R.approvalLevels,
  halfDay: R.halfDay,
  attachmentName: R.attachmentName,
  delegateEmployeeId: R.delegateEmployeeId,
  delegateNote: R.delegateNote,
  bulkId: R.bulkId,
  createdBy: R.createdBy,
  createdAt: R.createdAt,
  updatedAt: R.updatedAt,
};

/** Kesalahan validasi yang dilewati (bukan dilempar) pada cuti massal. */
const reasonOf = (e: unknown) =>
  e instanceof HttpException
    ? (() => {
        const body = e.getResponse() as { message?: string; errors?: { message: string }[] };
        return body.errors?.[0]?.message ?? body.message ?? e.message;
      })()
    : String(e);

@Injectable()
export class LeaveService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(WorkCalendarService) private readonly calendar: WorkCalendarService,
  ) {}

  async list(tx: Db, query: { employeeId?: string; state?: string }) {
    const filters: (SQL | undefined)[] = [eq(R.companyId, currentContext().companyId)];
    if (query.employeeId) filters.push(eq(R.employeeId, query.employeeId));
    const states = (query.state ?? "")
      .split(",")
      .filter((s): s is "confirm" => ["confirm", "approved", "refused", "cancel"].includes(s));
    if (states.length) filters.push(inArray(R.state, states));
    const D = schema.employees;
    const rows = await tx
      .select({ request: REQUEST_COLUMNS, employeeName: D.name, leaveTypeName: T.name })
      .from(R)
      .innerJoin(D, eq(D.id, R.employeeId))
      .innerJoin(T, eq(T.id, R.leaveTypeId))
      .where(and(...filters))
      .orderBy(desc(R.dateFrom))
      .limit(500);
    const delegateIds = [
      ...new Set(rows.map((r) => r.request.delegateEmployeeId).filter(Boolean)),
    ] as string[];
    const delegates = new Map(
      delegateIds.length
        ? (await tx.select({ id: D.id, name: D.name }).from(D).where(inArray(D.id, delegateIds))).map((x) => [
            x.id,
            x.name,
          ])
        : [],
    );
    return rows.map((r) => ({
      ...r.request,
      hasAttachment: r.request.attachmentName !== null,
      employeeName: r.employeeName,
      leaveTypeName: r.leaveTypeName,
      delegateName: r.request.delegateEmployeeId
        ? (delegates.get(r.request.delegateEmployeeId) ?? null)
        : null,
    }));
  }

  /** Buku besar satu karyawan × jenis cuti (jatah dikonsumsi FIFO menurut masa berlaku). */
  async ledger(
    tx: Db,
    employeeId: string,
    leaveTypeId: string,
    on = today(),
    extra?: LeaveInput & { days: number },
  ) {
    const allocations = await tx
      .select()
      .from(A)
      .where(and(eq(A.employeeId, employeeId), eq(A.leaveTypeId, leaveTypeId)));
    const requests = await tx
      .select({ id: R.id, dateFrom: R.dateFrom, dateTo: R.dateTo, days: R.days })
      .from(R)
      .where(
        and(
          eq(R.employeeId, employeeId),
          eq(R.leaveTypeId, leaveTypeId),
          inArray(R.state, ["confirm", "approved"]),
        ),
      );
    const all = extra
      ? [...requests, { id: "new", dateFrom: extra.dateFrom, dateTo: extra.dateTo, days: String(extra.days) }]
      : requests;
    return { ledger: leaveLedger(allocations, all, on), allocations, requests };
  }

  /** Saldo per jenis cuti yang memakai jatah, pada tanggal tertentu (termasuk sisa yang akan kedaluwarsa). */
  async balances(tx: Db, employeeId: string, on = today()) {
    const types = await tx
      .select()
      .from(T)
      .where(and(eq(T.requiresAllocation, true), eq(T.active, true)))
      .orderBy(asc(T.name));
    const result = [];
    for (const type of types) {
      const { ledger } = await this.ledger(tx, employeeId, type.id, on);
      result.push({ leaveTypeId: type.id, leaveTypeName: type.name, ...balanceOn(ledger, on) });
    }
    return result;
  }

  /** Ajukan cuti. Tanpa hr.write hanya untuk diri sendiri. */
  async request(tx: Db, input: LeaveInput) {
    const ctx = currentContext();
    const employee = input.employeeId
      ? await this.employees.find(tx, input.employeeId)
      : await this.employees.mine(tx);
    const hr = hasPermission(ctx.permissions, "hr.write");
    if (employee.userId !== ctx.userId && !hr)
      throw new ForbiddenException("Hanya bisa mengajukan cuti untuk diri sendiri");
    const type = await this.type(tx, input.leaveTypeId);
    if (!type.employeeRequestable && !hr)
      throw fieldError("leaveTypeId", `${type.name} hanya bisa diajukan oleh HR`);
    if (input.attachment === undefined || input.attachment === null) {
      if (type.requiresAttachment) throw fieldError("attachment", `${type.name} wajib melampirkan bukti`);
    } else if ((input.attachment.data.replace(/\s/g, "").length * 3) / 4 > 2 * 1024 * 1024)
      throw fieldError("attachment", "Berkas maksimal 2 MB");
    if (input.delegateEmployeeId) {
      if (input.delegateEmployeeId === employee.id)
        throw fieldError("delegateEmployeeId", "Delegasi tugas tidak bisa ke diri sendiri");
      const delegate = await this.employees.find(tx, input.delegateEmployeeId);
      if (delegate.companyId !== employee.companyId)
        throw fieldError("delegateEmployeeId", "Karyawan delegasi harus di perusahaan yang sama");
    }
    const days = await this.validate(tx, employee, type, input, {
      bypassBlock: hasPermission(ctx.permissions, "hr.manage"),
    });
    const [row] = await tx
      .insert(R)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        days: String(days),
        reason: input.reason ?? null,
        halfDay: input.halfDay ?? null,
        ...(input.attachment
          ? {
              attachment: Buffer.from(input.attachment.data, "base64"),
              attachmentName: input.attachment.name,
              attachmentType: input.attachment.type,
            }
          : {}),
        delegateEmployeeId: input.delegateEmployeeId ?? null,
        delegateNote: input.delegateNote ?? null,
        approvalLevels: await this.approvals.levels(tx, employee.companyId, "leave_request"),
        createdBy: ctx.userId,
      })
      .returning(REQUEST_COLUMNS);
    await this.activity.log(tx, {
      resModel: "employee",
      resId: employee.id,
      action: "comment",
      message: `Pengajuan ${type.name} ${input.dateFrom} s.d. ${input.dateTo} (${days} hari)`,
    });
    await this.approvals.submitted(
      tx,
      "leave_request",
      row!.id,
      employee,
      type.name,
      `${input.dateFrom} s.d. ${input.dateTo}`,
    );
    const [fresh] = await tx.select(REQUEST_COLUMNS).from(R).where(eq(R.id, row!.id));
    return fresh!;
  }

  /**
   * Aturan jenis cuti & saldo; mengembalikan durasi. Saldo diperiksa lewat simulasi buku besar: tanpa izin minus,
   * pengajuan tidak boleh menambah kekurangan; dengan izin minus, sisa jatah terendah tidak boleh di bawah batas.
   */
  private async validate(
    tx: Db,
    employee: Employee,
    type: LeaveType,
    input: Pick<LeaveInput, "dateFrom" | "dateTo" | "halfDay"> & Partial<LeaveInput>,
    opts: { bypassBlock: boolean },
  ) {
    if (input.halfDay && !type.allowHalfDay)
      throw fieldError("halfDay", `${type.name} tidak bisa diambil setengah hari`);
    // Hari kerja menurut jadwal karyawan (penugasan shift/jadwal bawaan) dan hari libur perusahaannya.
    const cal = await this.calendar.load(tx, employee.companyId, [employee], input.dateFrom, input.dateTo);
    const days = leaveDays({
      from: input.dateFrom,
      to: input.dateTo,
      isWorkday: (date) => cal.isWorkday(employee, date),
      halfDay: input.halfDay ?? null,
      calendar: type.countCalendarDays,
    });
    if (days === 0) throw fieldError("dateTo", "Rentang cuti tidak mencakup hari kerja");
    if (type.maxConsecutiveDays && d(days).gt(type.maxConsecutiveDays))
      throw fieldError(
        "dateTo",
        `${type.name} maksimal ${d(type.maxConsecutiveDays).toFixed()} hari per pengajuan (diminta ${days})`,
      );
    if (!opts.bypassBlock) {
      const BL = schema.leaveBlockDates;
      const [block] = await tx
        .select()
        .from(BL)
        .where(
          and(
            eq(BL.companyId, employee.companyId),
            lte(BL.dateFrom, input.dateTo),
            gte(BL.dateTo, input.dateFrom),
            employee.departmentId
              ? or(isNull(BL.departmentId), eq(BL.departmentId, employee.departmentId))
              : isNull(BL.departmentId),
          ),
        )
        .limit(1);
      if (block)
        throw fieldError(
          "dateFrom",
          `Cuti tidak bisa diambil ${block.dateFrom} s.d. ${block.dateTo}: ${block.reason}`,
        );
    }
    const overlaps = await tx
      .select({ id: R.id, halfDay: R.halfDay, dateFrom: R.dateFrom, dateTo: R.dateTo })
      .from(R)
      .where(
        and(
          eq(R.employeeId, employee.id),
          inArray(R.state, ["confirm", "approved"]),
          lte(R.dateFrom, input.dateTo),
          gte(R.dateTo, input.dateFrom),
        ),
      );
    // Dua setengah hari (pagi & siang) pada tanggal yang sama boleh.
    const clash = overlaps.find((o) => !(input.halfDay && o.halfDay && o.halfDay !== input.halfDay));
    if (clash) throw fieldError("dateFrom", "Sudah ada pengajuan cuti pada tanggal tersebut");
    if (type.requiresAllocation) {
      const { ledger: before } = await this.ledger(tx, employee.id, type.id, input.dateFrom);
      const { ledger: after } = await this.ledger(tx, employee.id, type.id, input.dateFrom, {
        ...(input as LeaveInput),
        days,
      });
      if (!type.allowNegative) {
        if (d(after.deficit).gt(before.deficit))
          throw fieldError(
            "dateTo",
            `Saldo ${type.name} tidak cukup (sisa ${d(balanceOn(before, input.dateFrom).remaining).toFixed()} hari, diminta ${days})`,
          );
      } else if (d(lowestRemaining(after)).lt(d(type.negativeLimit).neg()))
        throw fieldError(
          "dateTo",
          `Saldo ${type.name} melebihi batas minus ${d(type.negativeLimit).toFixed()} hari (sisa ${d(balanceOn(before, input.dateFrom).remaining).toFixed()}, diminta ${days})`,
        );
    }
    return days;
  }

  /** Keputusan tahap persetujuan berjalan (berjenjang; lihat ApprovalService). */
  async decide(tx: Db, id: string, state: "approved" | "refused", note?: string | null) {
    await this.find(tx, id);
    await this.approvals.decide(tx, "leave_request", id, state, note);
    return this.find(tx, id);
  }

  /** Batalkan pengajuan sendiri (atau oleh HR). */
  async cancel(tx: Db, id: string) {
    const ctx = currentContext();
    const request = await this.find(tx, id);
    const employee = await this.employees.find(tx, request.employeeId);
    if (employee.userId !== ctx.userId && !hasPermission(ctx.permissions, "hr.write"))
      throw new ForbiddenException("Tidak bisa membatalkan cuti orang lain");
    if (request.state === "refused" || request.state === "cancel")
      throw new BadRequestException("Pengajuan sudah ditutup");
    const [row] = await tx
      .update(R)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(R.id, id))
      .returning(REQUEST_COLUMNS);
    return row!;
  }

  /** Lampiran pengajuan cuti (pemilik, penyetuju, atau hr.read). */
  async attachment(tx: Db, id: string) {
    const ctx = currentContext();
    const [row] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, id), eq(R.companyId, ctx.companyId)));
    if (!row) throw new NotFoundException("Pengajuan cuti tidak ditemukan");
    if (!hasPermission(ctx.permissions, "hr.read")) {
      const employee = await this.employees.find(tx, row.employeeId);
      const approver =
        row.state === "confirm" &&
        (await this.approvals.isApprover(
          tx,
          "leave_request",
          row.id,
          employee,
          row.approvalStep,
          ctx.userId,
        ));
      if (employee.userId !== ctx.userId && !approver)
        throw new ForbiddenException("Butuh permission hr.read");
    }
    if (!row.attachment) throw new NotFoundException("Lampiran tidak ditemukan");
    return {
      data: row.attachment,
      name: row.attachmentName ?? "lampiran",
      type: row.attachmentType ?? "application/octet-stream",
    };
  }

  /**
   * Cuti massal (mis. cuti bersama): dibuat HR untuk karyawan aktif (semua / per departemen / terpilih) dan langsung
   * disetujui. Karyawan yang bentrok atau saldonya kurang dilewati dan dilaporkan.
   */
  async bulk(tx: Db, input: BulkInput) {
    const ctx = currentContext();
    const type = await this.type(tx, input.leaveTypeId);
    const E = schema.employees;
    const employees = await tx
      .select()
      .from(E)
      .where(
        and(
          eq(E.companyId, ctx.companyId),
          eq(E.active, true),
          lte(E.joinDate, input.dateFrom),
          input.departmentId ? eq(E.departmentId, input.departmentId) : undefined,
          input.employeeIds?.length ? inArray(E.id, input.employeeIds) : undefined,
        ),
      )
      .orderBy(asc(E.name));
    const bulkId = randomUUID();
    const created: { employeeId: string; employeeName: string; days: number }[] = [];
    const skipped: { employeeId: string; employeeName: string; reason: string }[] = [];
    for (const employee of employees) {
      if (employee.resignDate && employee.resignDate < input.dateFrom) continue;
      // Savepoint: kegagalan satu karyawan tidak membatalkan yang lain.
      try {
        const days = await tx.transaction(async (sp) => {
          const n = await this.validate(
            sp,
            employee,
            type,
            { ...input, halfDay: null },
            { bypassBlock: true },
          );
          await sp.insert(R).values({
            companyId: employee.companyId,
            employeeId: employee.id,
            leaveTypeId: type.id,
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            days: String(n),
            reason: input.reason,
            state: "approved",
            approvedBy: ctx.userId,
            approvedAt: new Date(),
            approvalLevels: 1,
            bulkId,
            createdBy: ctx.userId,
          });
          return n;
        });
        created.push({ employeeId: employee.id, employeeName: employee.name, days });
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        skipped.push({ employeeId: employee.id, employeeName: employee.name, reason: reasonOf(e) });
      }
    }
    await this.activity.log(tx, {
      resModel: "leave_bulk",
      resId: bulkId,
      action: "comment",
      message: `Cuti massal ${type.name} ${input.dateFrom} s.d. ${input.dateTo}: ${created.length} karyawan, ${skipped.length} dilewati`,
    });
    return { bulkId, created, skipped };
  }

  /** Batalkan seluruh cuti massal. */
  async cancelBulk(tx: Db, bulkId: string) {
    const rows = await tx
      .update(R)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(
        and(
          eq(R.bulkId, bulkId),
          eq(R.companyId, currentContext().companyId),
          inArray(R.state, ["confirm", "approved"]),
        ),
      )
      .returning({ id: R.id });
    if (!rows.length) throw new NotFoundException("Cuti massal tidak ditemukan atau sudah dibatalkan");
    return { cancelled: rows.length };
  }

  /** Daftar cuti massal yang pernah dibuat (ringkasan per bulk). */
  async bulkList(tx: Db) {
    return tx
      .select({
        bulkId: R.bulkId,
        leaveTypeName: T.name,
        dateFrom: R.dateFrom,
        dateTo: R.dateTo,
        reason: sql<string>`min(${R.reason})`,
        employees: sql<number>`count(*) filter (where ${R.state} <> 'cancel')::int`,
        createdAt: sql<string>`min(${R.createdAt})`,
      })
      .from(R)
      .innerJoin(T, eq(T.id, R.leaveTypeId))
      .where(and(eq(R.companyId, currentContext().companyId), sql`${R.bulkId} is not null`))
      .groupBy(R.bulkId, T.name, R.dateFrom, R.dateTo)
      .orderBy(desc(R.dateFrom))
      .limit(100);
  }

  /** Laporan saldo semua karyawan aktif × jenis cuti berjatah pada tanggal. */
  async balanceReport(tx: Db, query: { date?: string; departmentId?: string }) {
    const on = query.date || today();
    const companyId = currentContext().companyId;
    const E = schema.employees;
    const employees = await tx
      .select({
        id: E.id,
        name: E.name,
        employeeNumber: E.employeeNumber,
        departmentName: schema.departments.name,
      })
      .from(E)
      .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
      .where(
        and(
          eq(E.companyId, companyId),
          eq(E.active, true),
          query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(E.name));
    const types = await tx
      .select({ id: T.id, name: T.name })
      .from(T)
      .where(and(eq(T.requiresAllocation, true), eq(T.active, true)))
      .orderBy(asc(T.name));
    const ids = employees.map((e) => e.id);
    const allocations = ids.length ? await tx.select().from(A).where(inArray(A.employeeId, ids)) : [];
    const requests = ids.length
      ? await tx
          .select({
            id: R.id,
            employeeId: R.employeeId,
            leaveTypeId: R.leaveTypeId,
            dateFrom: R.dateFrom,
            days: R.days,
          })
          .from(R)
          .where(and(inArray(R.employeeId, ids), inArray(R.state, ["confirm", "approved"])))
      : [];
    return {
      date: on,
      types,
      rows: employees.map((e) => ({
        ...e,
        balances: types.map((t) => {
          const ledger = leaveLedger(
            allocations.filter((a) => a.employeeId === e.id && a.leaveTypeId === t.id),
            requests.filter((r) => r.employeeId === e.id && r.leaveTypeId === t.id),
            on,
          );
          return { leaveTypeId: t.id, ...balanceOn(ledger, on) };
        }),
      })),
    };
  }

  /** Riwayat buku besar (jatah, pemakaian, kedaluwarsa) untuk satu karyawan × jenis cuti. */
  async ledgerReport(tx: Db, employeeId: string, leaveTypeId: string) {
    const employee = await this.employees.find(tx, employeeId);
    const type = await this.type(tx, leaveTypeId, false);
    const { ledger, allocations, requests } = await this.ledger(tx, employeeId, leaveTypeId);
    const allocationLabel = new Map(
      allocations.map((a) => [
        a.id,
        a.note ??
          (a.source === "carry_over"
            ? `Sisa dibawa ${a.period ?? ""}`
            : a.source === "compensatory"
              ? "Cuti pengganti lembur"
              : a.source === "accrual"
                ? `Akrual ${a.period ?? ""}`
                : "Jatah manual"),
      ]),
    );
    const requestLabel = new Map(requests.map((r) => [r.id, `Cuti ${r.dateFrom} s.d. ${r.dateTo}`]));
    let running = d(0);
    const entries = ledger.entries.map((e) => {
      running = e.kind === "credit" ? running.plus(e.days) : running.minus(e.days);
      return {
        ...e,
        label:
          e.kind === "debit" ? (requestLabel.get(e.ref) ?? e.ref) : (allocationLabel.get(e.ref) ?? "Jatah"),
        balance: running.toFixed(2),
      };
    });
    return {
      employee: { id: employee.id, name: employee.name },
      leaveType: { id: type.id, name: type.name },
      allocations: ledger.allocations.filter((a) => a.source !== "deficit"),
      entries,
      balance: balanceOn(ledger, today()),
    };
  }

  /** Lembur hari istirahat/libur yang disetujui dan belum dibayar/dijadikan cuti pengganti. */
  async compensableOvertimes(tx: Db) {
    const O = schema.overtimes;
    return tx
      .select({
        id: O.id,
        employeeId: O.employeeId,
        employeeName: schema.employees.name,
        date: O.date,
        hours: O.hours,
        description: O.description,
      })
      .from(O)
      .innerJoin(schema.employees, eq(schema.employees.id, O.employeeId))
      .where(
        and(
          eq(O.companyId, currentContext().companyId),
          eq(O.state, "approved"),
          eq(O.dayType, "rest_day"),
          eq(O.compensated, false),
          isNull(O.payslipId),
          gte(O.hours, "4"),
        ),
      )
      .orderBy(desc(O.date))
      .limit(200);
  }

  /**
   * Lembur di hari istirahat/libur yang sudah disetujui → jatah "Cuti pengganti" (jam ÷ 8, per setengah hari),
   * berlaku 3 bulan. Lembur itu tidak dibayar lagi di payroll.
   */
  async compensate(tx: Db, overtimeId: string) {
    const O = schema.overtimes;
    const [ot] = await tx
      .select()
      .from(O)
      .where(and(eq(O.id, overtimeId), eq(O.companyId, currentContext().companyId)))
      .for("update");
    if (!ot) throw new NotFoundException("Lembur tidak ditemukan");
    if (ot.state !== "approved") throw new BadRequestException("Hanya lembur yang sudah disetujui");
    if (ot.dayType !== "rest_day")
      throw new BadRequestException("Cuti pengganti hanya untuk lembur di hari istirahat/libur");
    if (ot.compensated) throw new BadRequestException("Lembur ini sudah dijadikan cuti pengganti");
    if (ot.payslipId) throw new BadRequestException("Lembur sudah dibayar di slip gaji");
    const days = compensatoryDays(ot.hours);
    if (d(days).lte(0))
      throw new BadRequestException("Lembur kurang dari 4 jam tidak menjadi cuti pengganti");
    const [type] = await tx
      .select()
      .from(T)
      .where(and(eq(T.name, "Cuti pengganti"), eq(T.active, true)));
    if (!type) throw new BadRequestException('Jenis cuti "Cuti pengganti" tidak ditemukan atau nonaktif');
    const [allocation] = await tx
      .insert(A)
      .values({
        companyId: ot.companyId,
        employeeId: ot.employeeId,
        leaveTypeId: type.id,
        days,
        dateFrom: ot.date,
        dateTo: addDays(addMonths(ot.date, 3), -1),
        source: "compensatory",
        overtimeId: ot.id,
        note: `Cuti pengganti lembur ${ot.date} (${d(ot.hours).toFixed()} jam)`,
      })
      .returning();
    await tx
      .update(O)
      .set({ compensated: true, updatedAt: sql`now()` })
      .where(eq(O.id, ot.id));
    return allocation!;
  }

  /**
   * Hari cuti disetujui (berbayar maupun tidak) dalam rentang, menurut kalender kerja karyawan; setengah hari = 0,5,
   * jenis cuti hari kalender dihitung per hari kalender.
   */
  async leaveDays(tx: Db, employee: Employee, from: string, to: string, calendar?: WorkCalendar) {
    return this.daysOf(tx, employee, from, to, calendar, false);
  }

  /** Hari cuti tanpa upah (disetujui) dalam periode payroll. */
  async unpaidDays(tx: Db, employee: Employee, from: string, to: string, calendar?: WorkCalendar) {
    return this.daysOf(tx, employee, from, to, calendar, true);
  }

  private async daysOf(
    tx: Db,
    employee: Employee,
    from: string,
    to: string,
    calendar: WorkCalendar | undefined,
    unpaidOnly: boolean,
  ) {
    const rows = await tx
      .select({ dateFrom: R.dateFrom, dateTo: R.dateTo, halfDay: R.halfDay, calendar: T.countCalendarDays })
      .from(R)
      .innerJoin(T, eq(T.id, R.leaveTypeId))
      .where(
        and(
          eq(R.employeeId, employee.id),
          eq(R.state, "approved"),
          unpaidOnly ? eq(T.paid, false) : undefined,
          lte(R.dateFrom, to),
          gte(R.dateTo, from),
        ),
      );
    if (!rows.length) return 0;
    const cal = calendar ?? (await this.calendar.load(tx, employee.companyId, [employee], from, to));
    return rows.reduce((sum, r) => {
      const a = r.dateFrom > from ? r.dateFrom : from;
      const b = r.dateTo < to ? r.dateTo : to;
      const days = r.calendar ? eachDate(a, b).length : cal.workingDays(employee, a, b);
      return sum + (r.halfDay ? days * 0.5 : days);
    }, 0);
  }

  /** Pratinjau durasi cuti sebelum diajukan: tanggal yang dihitung & dilewati (libur jadwal / hari libur). */
  async previewDays(
    tx: Db,
    employee: Employee,
    input: { dateFrom: string; dateTo: string; leaveTypeId?: string | null; halfDay?: "am" | "pm" | null },
  ) {
    if (input.dateTo < input.dateFrom) throw fieldError("dateTo", "Tanggal selesai sebelum mulai");
    if (eachDate(input.dateFrom, input.dateTo).length > 366)
      throw fieldError("dateTo", "Rentang cuti maksimal satu tahun");
    const type = input.leaveTypeId ? await this.type(tx, input.leaveTypeId) : null;
    const cal = await this.calendar.load(tx, employee.companyId, [employee], input.dateFrom, input.dateTo);
    const { counted, skipped } = dayBreakdown(
      input.dateFrom,
      input.dateTo,
      (date) => cal.workDaysOf(employee, date),
      cal.holidays,
    );
    const days = leaveDays({
      from: input.dateFrom,
      to: input.dateTo,
      isWorkday: (date) => cal.isWorkday(employee, date),
      halfDay: input.halfDay ?? null,
      calendar: type?.countCalendarDays ?? false,
    });
    return { days, calendarDays: type?.countCalendarDays ?? false, counted, skipped };
  }

  private async type(tx: Db, id: string, activeOnly = true) {
    const [type] = await tx
      .select()
      .from(T)
      .where(and(eq(T.id, id), activeOnly ? eq(T.active, true) : undefined));
    if (!type) throw fieldError("leaveTypeId", "Jenis cuti tidak ditemukan");
    return type;
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx
      .select(REQUEST_COLUMNS)
      .from(R)
      .where(and(eq(R.id, id), eq(R.companyId, currentContext().companyId)));
    if (!row) throw new NotFoundException("Pengajuan cuti tidak ditemukan");
    return row;
  }
}
