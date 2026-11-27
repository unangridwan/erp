import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { eq, schema, sql, type Db } from "@erp/db";
import { SYSTEM_APPROVAL_CATEGORIES, systemCategoryId } from "./approval-categories.registry.js";
import { ApprovalEngineService } from "./approval-engine.service.js";

const REQ = schema.approvalRequests;

/** Jenis dokumen bergerbang → kode kategori sistem (lihat `approval-categories.registry.ts`). */
export const GATE_CATEGORIES = {
  payroll: SYSTEM_APPROVAL_CATEGORIES.PAYROLL.def,
  movement: SYSTEM_APPROVAL_CATEGORIES.MUTASI.def,
  offer: SYSTEM_APPROVAL_CATEGORIES.PENAWARAN.def,
  advance: SYSTEM_APPROVAL_CATEGORIES.KASBON.def,
  offboarding: SYSTEM_APPROVAL_CATEGORIES.OFFBOARD.def,
  settlement: SYSTEM_APPROVAL_CATEGORIES.OFFBOARD.def,
} as const;
export type GateKind = keyof typeof GATE_CATEGORIES;

export type GateState = "none" | "pending" | "approved" | "refused" | "cancel";

/**
 * Gerbang persetujuan: dokumen (payroll run, mutasi, penawaran) diajukan lewat mesin persetujuan generik — aturan,
 * batas wewenang, dan delegasi berlaku — lalu proses lanjutannya (posting, terapkan, kirim) menunggu status disetujui.
 */
@Injectable()
export class ApprovalGateService {
  constructor(@Inject(ApprovalEngineService) private readonly engine: ApprovalEngineService) {}

  async category(tx: Db, companyId: string, kind: GateKind) {
    return systemCategoryId(tx, companyId, GATE_CATEGORIES[kind].code);
  }

  /** Buat & ajukan permintaan persetujuan; mengembalikan id permintaan. */
  async submit(
    tx: Db,
    companyId: string,
    kind: GateKind,
    doc: {
      subject: string;
      reference: string;
      date: string;
      amount: string;
      quantity?: string;
      description: string;
      /** Karyawan pemohon (bila diajukan HR atas nama karyawan): atasannya menjadi penyetuju pertama. */
      employeeId?: string;
    },
  ) {
    const categoryId = await this.category(tx, companyId, kind);
    const request = await this.engine.createRequest(tx, {
      categoryId,
      subject: doc.subject.slice(0, 200),
      reference: doc.reference,
      location: null,
      contact: null,
      date: doc.date,
      quantity: doc.quantity ?? null,
      amount: doc.amount,
      description: doc.description,
    });
    if (doc.employeeId)
      await tx
        .update(REQ)
        .set({ employeeId: doc.employeeId, updatedAt: sql`now()` })
        .where(eq(REQ.id, request.id));
    await this.engine.submit(tx, request.id);
    return request.id;
  }

  async state(tx: Db, requestId: string | null): Promise<GateState> {
    if (!requestId) return "none";
    const [req] = await tx.select({ state: REQ.state }).from(REQ).where(eq(REQ.id, requestId));
    if (!req) return "none";
    if (req.state === "approved" || req.state === "refused" || req.state === "cancel") return req.state;
    return "pending";
  }

  /** Ringkasan permintaan untuk ditampilkan di dokumen. */
  async summary(tx: Db, requestId: string | null) {
    if (!requestId) return null;
    const [req] = await tx
      .select({ id: REQ.id, number: REQ.number, state: REQ.state })
      .from(REQ)
      .where(eq(REQ.id, requestId));
    return req ?? null;
  }

  /** Tolak proses lanjutan bila gerbang aktif dan dokumen belum disetujui. */
  async assertApproved(tx: Db, enabled: boolean, requestId: string | null, _action: string) {
    if (!enabled) return;
    const state = await this.state(tx, requestId);
    if (state === "approved") return;
    if (state === "pending") throw new BadRequestException("Menunggu persetujuan; belum bisa diproses");
    throw new BadRequestException("Ajukan persetujuan terlebih dulu");
  }

  /** Batalkan permintaan yang masih berjalan (mis. dokumen diubah setelah diajukan). */
  async withdraw(tx: Db, requestId: string | null) {
    if (!requestId) return;
    const state = await this.state(tx, requestId);
    if (state !== "pending" && state !== "approved") return;
    await tx
      .update(REQ)
      .set({ state: "cancel", updatedAt: sql`now()` })
      .where(eq(REQ.id, requestId));
  }

  async enabled(tx: Db, companyId: string, kind: GateKind) {
    const [s] = await tx
      .select({
        payroll: schema.payrollSettings.payrollRunApproval,
        movement: schema.payrollSettings.movementApproval,
        offer: schema.payrollSettings.jobOfferApproval,
        // Kasbon selalu lewat persetujuan; persetujuan F&F diajukan manual.
        advance: sql<boolean>`true`,
        offboarding: schema.payrollSettings.offboardingApproval,
        settlement: sql<boolean>`true`,
      })
      .from(schema.payrollSettings)
      .where(eq(schema.payrollSettings.companyId, companyId));
    return Boolean(s?.[kind]);
  }
}
