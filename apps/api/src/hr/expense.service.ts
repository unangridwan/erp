import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, ne, schema, sql, type Db } from "@erp/db";
import { claimLimitCheck, hasPermission, type expenseClaimSchema, type payClaimSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { assertCompanyJournal, fieldError } from "../accounting/context.js";
import { MoveService } from "../accounting/move.service.js";
import { currentContext } from "../common/request-context.js";
import { SequenceService } from "../sequences/sequence.service.js";
import { ApprovalService } from "./approval.service.js";
import { EmployeeService } from "./employee.service.js";

const C = schema.expenseClaims;
const CL = schema.expenseClaimLines;
const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
type ClaimInput = z.infer<typeof expenseClaimSchema>;

/**
 * Klaim biaya (reimbursement): karyawan/HR membuat draft → diajukan (cek plafon tahunan per kategori) → persetujuan
 * berjenjang (atasan → atasan dari atasan → HR) → dibayar lewat slip gaji berikutnya atau langsung dari kas/bank.
 */
@Injectable()
export class ExpenseService {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(SequenceService) private readonly sequences: SequenceService,
    @Inject(MoveService) private readonly moves: MoveService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async list(tx: Db, query: { employeeId?: string; state?: string }) {
    const rows = await tx
      .select({ claim: C, employeeName: schema.employees.name })
      .from(C)
      .innerJoin(schema.employees, eq(schema.employees.id, C.employeeId))
      .where(
        and(
          eq(C.companyId, currentContext().companyId),
          query.employeeId ? eq(C.employeeId, query.employeeId) : undefined,
          query.state ? eq(C.state, query.state as "draft") : undefined,
        ),
      )
      .orderBy(desc(C.date), desc(C.createdAt));
    return rows.map((r) => ({ ...r.claim, employeeName: r.employeeName }));
  }

  async get(tx: Db, id: string) {
    const claim = await this.find(tx, id);
    const [employee] = await tx
      .select({ name: schema.employees.name, userId: schema.employees.userId })
      .from(schema.employees)
      .where(eq(schema.employees.id, claim.employeeId));
    const lines = await tx
      .select({
        id: CL.id,
        categoryId: CL.categoryId,
        categoryName: schema.expenseCategories.name,
        date: CL.date,
        amount: CL.amount,
        note: CL.note,
        attachmentName: CL.attachmentName,
        attachmentType: CL.attachmentType,
      })
      .from(CL)
      .innerJoin(schema.expenseCategories, eq(schema.expenseCategories.id, CL.categoryId))
      .where(eq(CL.claimId, id))
      .orderBy(asc(CL.date));
    const [move] = claim.moveId
      ? await tx
          .select({ id: schema.accountMoves.id, name: schema.accountMoves.name })
          .from(schema.accountMoves)
          .where(eq(schema.accountMoves.id, claim.moveId))
      : [];
    return {
      ...claim,
      employeeName: employee?.name ?? "",
      employeeUserId: employee?.userId ?? null,
      lines,
      move: move ?? null,
      approval: claim.state === "draft" ? null : await this.approvals.status(tx, "expense_claim", id),
    };
  }

  async create(tx: Db, input: ClaimInput) {
    const employee = await this.employeeFor(tx, input.employeeId);
    const name = await this.sequences.next(
      tx,
      "hr.expense",
      employee.companyId,
      new Date(`${input.date}T00:00:00Z`),
      "KLM",
    );
    const [row] = await tx
      .insert(C)
      .values({
        companyId: employee.companyId,
        employeeId: employee.id,
        name,
        date: input.date,
        description: input.description ?? null,
        payMethod: input.payMethod,
        createdBy: currentContext().userId,
      })
      .returning();
    await this.saveLines(tx, row!.id, input.lines);
    return this.get(tx, row!.id);
  }

  async update(tx: Db, id: string, input: ClaimInput) {
    const claim = await this.editable(tx, id);
    if (input.employeeId && input.employeeId !== claim.employeeId)
      throw fieldError("employeeId", "Karyawan klaim tidak bisa diganti");
    await tx
      .update(C)
      .set({
        date: input.date,
        description: input.description ?? null,
        payMethod: input.payMethod,
        updatedAt: sql`now()`,
      })
      .where(eq(C.id, id));
    await this.saveLines(tx, id, input.lines);
    return this.get(tx, id);
  }

  async remove(tx: Db, id: string) {
    await this.editable(tx, id);
    await tx.delete(C).where(eq(C.id, id));
  }

  /** Ajukan: cek plafon tahunan per kategori, lalu masuk antrean persetujuan. */
  async submit(tx: Db, id: string) {
    const claim = await this.editable(tx, id);
    const lines = await tx
      .select({ line: CL, category: schema.expenseCategories })
      .from(CL)
      .innerJoin(schema.expenseCategories, eq(schema.expenseCategories.id, CL.categoryId))
      .where(eq(CL.claimId, id));
    if (!lines.length) throw new BadRequestException("Klaim belum punya baris");
    const byCategory = new Map<string, { category: (typeof lines)[number]["category"]; amount: Decimal }>();
    for (const { line, category } of lines) {
      const cur = byCategory.get(category.id) ?? { category, amount: d(0) };
      cur.amount = cur.amount.plus(line.amount);
      byCategory.set(category.id, cur);
    }
    const year = claim.date.slice(0, 4);
    for (const { category, amount } of byCategory.values()) {
      if (!category.annualLimit) continue;
      const [used] = await tx
        .select({ amount: sql<string>`coalesce(sum(${CL.amount}), 0)::text` })
        .from(CL)
        .innerJoin(C, eq(C.id, CL.claimId))
        .where(
          and(
            eq(C.employeeId, claim.employeeId),
            eq(CL.categoryId, category.id),
            inArray(C.state, ["confirm", "approved", "paid"]),
            ne(C.id, id),
            gte(C.date, `${year}-01-01`),
            lte(C.date, `${year}-12-31`),
          ),
        );
      const check = claimLimitCheck({ limit: category.annualLimit, used: used?.amount ?? 0, amount });
      if (!check.ok)
        throw new BadRequestException(
          `Klaim ${category.name} melebihi plafon tahunan (sisa Rp ${check.remaining}, lebih Rp ${check.excess})`,
        );
    }
    const levels = await this.approvals.levels(tx, claim.companyId, "expense_claim");
    await tx
      .update(C)
      .set({ state: "confirm", approvalStep: 1, approvalLevels: levels, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    await this.activity.log(tx, {
      resModel: "employee",
      resId: claim.employeeId,
      action: "comment",
      message: `Klaim ${claim.name} Rp ${d(claim.total).toFixed(0)} diajukan`,
    });
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, claim.employeeId));
    await this.approvals.submitted(tx, "expense_claim", id, employee!, "Klaim", claim.name);
    return this.get(tx, id);
  }

  async decide(tx: Db, id: string, decision: "approved" | "refused", note?: string | null) {
    await this.approvals.decide(tx, "expense_claim", id, decision, note);
    return this.get(tx, id);
  }

  /** Batalkan klaim yang belum dibayar. */
  async cancel(tx: Db, id: string) {
    const claim = await this.find(tx, id, true);
    this.assertOwnerOrHr(claim.employeeId, await this.ownEmployeeId(tx));
    if (claim.state === "paid" || claim.state === "cancel")
      throw new BadRequestException("Klaim yang sudah dibayar/dibatalkan tidak bisa dibatalkan");
    await tx
      .update(C)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(C.id, id));
    return this.get(tx, id);
  }

  /** Bayar langsung: Dr akun beban per kategori / Cr kas atau bank. */
  async pay(tx: Db, id: string, input: z.infer<typeof payClaimSchema>) {
    const claim = await this.find(tx, id, true);
    if (claim.state !== "approved") throw new BadRequestException("Hanya klaim disetujui yang bisa dibayar");
    if (claim.payMethod !== "cash")
      throw new BadRequestException("Klaim ini dibayar lewat slip gaji berikutnya");
    const journal = await assertCompanyJournal(tx, claim.companyId, input.journalId, ["bank", "cash"]);
    if (!journal.defaultAccountId) throw fieldError("journalId", "Jurnal kas/bank belum punya akun");
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, claim.employeeId));
    const debits = await this.accountTotals(tx, [id]);
    const label = `${claim.name} ${employee!.name}`;
    const moveId = await this.moves.createEntry(
      tx,
      {
        journalId: journal.id,
        date: input.date,
        ref: claim.name,
        lines: [
          ...debits.map((x) => ({
            accountId: x.accountId,
            name: label,
            debit: d(x.amount).toFixed(2),
            credit: "0",
            branchId: employee!.branchId,
            businessUnitId: employee!.businessUnitId,
          })),
          {
            accountId: journal.defaultAccountId,
            name: label,
            debit: "0",
            credit: d(claim.total).toFixed(2),
          },
        ],
      },
      claim.companyId,
    );
    await this.moves.post(tx, moveId);
    await tx
      .update(C)
      .set({ state: "paid", moveId, updatedAt: sql`now()` })
      .where(eq(C.id, id));
    return this.get(tx, id);
  }

  /** Jumlah klaim per akun beban kategori (untuk jurnal pembayaran & posting payroll). */
  async accountTotals(tx: Db, claimIds: string[]) {
    if (!claimIds.length) return [];
    return tx
      .select({
        claimId: CL.claimId,
        accountId: schema.expenseCategories.accountId,
        amount: sql<string>`sum(${CL.amount})::text`,
      })
      .from(CL)
      .innerJoin(schema.expenseCategories, eq(schema.expenseCategories.id, CL.categoryId))
      .where(inArray(CL.claimId, claimIds))
      .groupBy(CL.claimId, schema.expenseCategories.accountId);
  }

  async attachment(tx: Db, id: string, lineId: string) {
    await this.find(tx, id);
    const [line] = await tx
      .select({ data: CL.attachment, name: CL.attachmentName, type: CL.attachmentType })
      .from(CL)
      .where(and(eq(CL.id, lineId), eq(CL.claimId, id)));
    if (!line?.data) throw new NotFoundException("Bukti klaim tidak ditemukan");
    return line as { data: Buffer; name: string; type: string };
  }

  /**
   * Boleh melihat: pemegang hr.read, karyawan pemilik, atau penyetuju tahap berjalan.
   */
  async assertCanSee(tx: Db, id: string) {
    const ctx = currentContext();
    if (hasPermission(ctx.permissions, "hr.read")) return;
    const claim = await this.find(tx, id);
    const [employee] = await tx
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, claim.employeeId));
    if (employee?.userId === ctx.userId) return;
    if (
      claim.state === "confirm" &&
      (await this.approvals.isApprover(
        tx,
        "expense_claim",
        claim.id,
        employee!,
        claim.approvalStep,
        ctx.userId,
      ))
    )
      return;
    throw new ForbiddenException("Butuh permission hr.read");
  }

  /** Karyawan user yang login, atau null bila belum terhubung. */
  async ownEmployeeId(tx: Db) {
    return this.employees.mine(tx).then(
      (e) => e.id,
      () => null,
    );
  }

  private assertOwnerOrHr(employeeId: string, own: string | null) {
    if (employeeId === own) return;
    if (!hasPermission(currentContext().permissions, "hr.write"))
      throw new ForbiddenException("Butuh permission hr.write");
  }

  /** Karyawan klaim: diri sendiri (portal) atau karyawan lain (butuh hr.write). */
  private async employeeFor(tx: Db, employeeId?: string) {
    const own = await this.ownEmployeeId(tx);
    if (!employeeId || employeeId === own) {
      if (!own) throw fieldError("employeeId", "Pilih karyawan");
      return this.employees.find(tx, own);
    }
    this.assertOwnerOrHr(employeeId, own);
    return this.employees.find(tx, employeeId);
  }

  private async editable(tx: Db, id: string) {
    const claim = await this.find(tx, id, true);
    this.assertOwnerOrHr(claim.employeeId, await this.ownEmployeeId(tx));
    if (claim.state !== "draft") throw new BadRequestException("Hanya klaim draft yang bisa diubah");
    return claim;
  }

  /** Ganti baris klaim; bukti lama dipertahankan untuk baris dengan id sama tanpa bukti baru. */
  private async saveLines(tx: Db, claimId: string, lines: ClaimInput["lines"]) {
    const claim = await this.find(tx, claimId);
    for (const [i, line] of lines.entries()) {
      const [category] = await tx
        .select({ id: schema.expenseCategories.id, active: schema.expenseCategories.active })
        .from(schema.expenseCategories)
        .where(
          and(
            eq(schema.expenseCategories.id, line.categoryId),
            eq(schema.expenseCategories.companyId, claim.companyId),
          ),
        );
      if (!category?.active) throw fieldError(`lines.${i}.categoryId`, "Kategori klaim tidak ditemukan");
    }
    const old = await tx.select().from(CL).where(eq(CL.claimId, claimId));
    await tx.delete(CL).where(eq(CL.claimId, claimId));
    await tx.insert(CL).values(
      lines.map((l) => {
        const kept = l.id && l.attachment === undefined ? old.find((o) => o.id === l.id) : undefined;
        return {
          claimId,
          categoryId: l.categoryId,
          date: l.date,
          amount: l.amount,
          note: l.note ?? null,
          attachment: l.attachment ? Buffer.from(l.attachment.data, "base64") : (kept?.attachment ?? null),
          attachmentName: l.attachment?.name ?? kept?.attachmentName ?? null,
          attachmentType: l.attachment?.type ?? kept?.attachmentType ?? null,
        };
      }),
    );
    const total = lines.reduce((s, l) => s.plus(l.amount), d(0));
    await tx
      .update(C)
      .set({ total: total.toFixed(2) })
      .where(eq(C.id, claimId));
  }

  private async find(tx: Db, id: string, lock = false) {
    const q = tx
      .select()
      .from(C)
      .where(and(eq(C.id, id), eq(C.companyId, currentContext().companyId)));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundException("Klaim biaya tidak ditemukan");
    return row;
  }
}
