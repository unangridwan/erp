/** Label & warna status Usulan Penambahan Karyawan (FPK). */
export type HiringState = "draft" | "in_approval" | "approved" | "refused" | "cancel";
export const HIRING_STATE_LABEL: Record<HiringState, [string, string]> = {
  draft: ["Draft", "Draft"],
  in_approval: ["Menunggu persetujuan", "Awaiting approval"],
  approved: ["Disetujui", "Approved"],
  refused: ["Ditolak", "Refused"],
  cancel: ["Dibatalkan", "Cancelled"],
};
export const hiringStatePill = (s: HiringState) =>
  s === "approved" ? "ok" : s === "refused" || s === "cancel" ? "bad" : s === "in_approval" ? "warn" : "";
