/** Alur penambahan karyawan: MPP → FPK → persetujuan → lowongan → pelamar → penawaran → kontrak → aktif → onboarding. */
import { z } from "zod";

export const HIRING_REQUEST_STATES = ["draft", "in_approval", "approved", "refused", "cancel"] as const;
export type HiringRequestState = (typeof HIRING_REQUEST_STATES)[number];
export const HIRING_REQUEST_STATE_LABEL: Record<HiringRequestState, [string, string]> = {
  draft: ["Draft", "Draft"],
  in_approval: ["Menunggu persetujuan", "Awaiting approval"],
  approved: ["Disetujui", "Approved"],
  refused: ["Ditolak", "Refused"],
  cancel: ["Dibatalkan", "Cancelled"],
};

/** FPK yang masih memakai kuota baris MPP (draft s.d. disetujui). */
export const ACTIVE_HIRING_STATES: readonly HiringRequestState[] = ["draft", "in_approval", "approved"];

/** Sisa kuota baris MPP yang belum diajukan lewat FPK. */
export function lineRemaining(
  quantity: number,
  requests: { quantity: number; state: HiringRequestState; id?: string }[],
  exceptId?: string,
) {
  const used = requests
    .filter((r) => ACTIVE_HIRING_STATES.includes(r.state) && r.id !== exceptId)
    .reduce((s, r) => s + r.quantity, 0);
  return Math.max(0, quantity - used);
}

const amount = z.coerce
  .number()
  .min(0, "Tidak boleh negatif")
  .transform((v) => v.toFixed(2));

export const hiringRequestSchema = z
  .object({
    departmentId: z.string().uuid(),
    jobId: z.string().uuid(),
    gradeId: z.string().uuid().nullish(),
    kind: z.enum(["new", "replacement"]).default("new"),
    quantity: z.coerce.number().int().min(1, "Minimal 1 orang").max(1000),
    contractType: z.enum(["pkwt", "pkwtt"]).default("pkwt"),
    wageMin: amount.nullish(),
    wageMax: amount.nullish(),
    targetDate: z.string().date().nullish(),
    reason: z.string().trim().min(1, "Isi alasan kebutuhan").max(1000),
    replacesEmployeeId: z.string().uuid().nullish(),
    manpowerPlanLineId: z.string().uuid().nullish(),
  })
  .refine((r) => !r.wageMin || !r.wageMax || Number(r.wageMax) >= Number(r.wageMin), {
    path: ["wageMax"],
    message: "Gaji maksimal di bawah gaji minimal",
  })
  .refine((r) => r.kind !== "replacement" || !!r.replacesEmployeeId, {
    path: ["replacesEmployeeId"],
    message: "Pilih karyawan yang digantikan",
  });
export type HiringRequestInput = z.infer<typeof hiringRequestSchema>;

/** Dari baris MPP: hanya jumlah, target, dan alasan yang bisa disesuaikan. */
export const hiringFromLineSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(1000).nullish(),
  targetDate: z.string().date().nullish(),
  reason: z.string().trim().max(1000).nullish(),
  contractType: z.enum(["pkwt", "pkwtt"]).nullish(),
});

export const HIRING_STEPS = [
  "plan",
  "request",
  "approval",
  "opening",
  "applicants",
  "offer",
  "contract",
  "active",
  "onboarding",
] as const;
export type HiringStep = (typeof HIRING_STEPS)[number];
export const HIRING_STEP_LABEL: Record<HiringStep, [string, string]> = {
  plan: ["Man Power Planning", "Manpower plan"],
  request: ["Usulan penambahan (FPK)", "Hiring request"],
  approval: ["Persetujuan", "Approval"],
  opening: ["Lowongan", "Job opening"],
  applicants: ["Rekrutmen", "Recruitment"],
  offer: ["Penawaran kerja", "Job offer"],
  contract: ["Kontrak", "Contract"],
  active: ["Karyawan aktif", "Active employee"],
  onboarding: ["Onboarding", "Onboarding"],
};

export type HiringStepStatus = "done" | "current" | "pending" | "skipped" | "blocked";

/**
 * Status tiap tahap alur dari hitungan dokumen. Tahap "selesai" bila seluruh kuota sudah melewatinya; "berjalan"
 * bila sebagian; tahap MPP "dilewati" untuk FPK di luar rencana; FPK ditolak/dibatalkan menghentikan alur.
 */
export function hiringProgress(input: {
  planned: boolean;
  planApproved: boolean;
  requestState: HiringRequestState;
  quantity: number;
  hasOpening: boolean;
  offersAccepted: number;
  contracts: number;
  active: number;
  onboardingDone: number;
}): Record<HiringStep, HiringStepStatus> {
  const q = Math.max(1, input.quantity);
  const by = (n: number): HiringStepStatus => (n >= q ? "done" : n > 0 ? "current" : "pending");
  const stopped = input.requestState === "refused" || input.requestState === "cancel";
  const approved = input.requestState === "approved";
  const s: Record<HiringStep, HiringStepStatus> = {
    plan: input.planned ? (input.planApproved ? "done" : "current") : "skipped",
    request: input.requestState === "draft" ? "current" : "done",
    approval: stopped
      ? "blocked"
      : approved
        ? "done"
        : input.requestState === "in_approval"
          ? "current"
          : "pending",
    opening: input.hasOpening ? "done" : approved ? "current" : "pending",
    applicants: !input.hasOpening ? "pending" : input.offersAccepted >= q ? "done" : "current",
    offer: by(input.offersAccepted),
    contract: by(input.contracts),
    active: by(input.active),
    onboarding: by(input.onboardingDone),
  };
  return s;
}
