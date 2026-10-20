/**
 * SDM (fungsi murni): status kedaluwarsa dokumen, tanggal tenggat checklist, dan checklist onboarding/offboarding
 * bawaan.
 */

export { addDays } from "./sales.js";

/** Selisih hari kalender `to − from`. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Status dokumen/kontrak terhadap tanggal hari ini: kedaluwarsa, segera (≤ `within` hari), atau aman. */
export function expiryStatus(expiry: string | null | undefined, today: string, within = 30) {
  if (!expiry) return null;
  const days = daysBetween(today, expiry);
  return {
    days,
    status: days < 0 ? ("expired" as const) : days <= within ? ("soon" as const) : ("ok" as const),
  };
}

export type ChecklistResponsible = "hr" | "manager" | "employee" | "it";
export interface ChecklistItem {
  name: string;
  responsible: ChecklistResponsible;
  /** Hari relatif terhadap tanggal masuk (onboarding) / tanggal keluar (offboarding). */
  dueDays: number;
  action?: "severance" | "deactivate_user" | null;
}

/** Checklist bawaan bila perusahaan belum membuat template. */
export const DEFAULT_CHECKLISTS: Record<
  "onboarding" | "offboarding",
  { name: string; items: ChecklistItem[] }
> = {
  onboarding: {
    name: "Onboarding karyawan baru",
    items: [
      { name: "Tanda tangan kontrak kerja", responsible: "hr", dueDays: 0 },
      { name: "Buat akun login & email kerja", responsible: "it", dueDays: 0 },
      { name: "Orientasi & perkenalan tim", responsible: "manager", dueDays: 1 },
      { name: "Lengkapi dokumen KTP, NPWP, KK & rekening", responsible: "employee", dueDays: 3 },
      { name: "Daftarkan BPJS Kesehatan & Ketenagakerjaan", responsible: "hr", dueDays: 7 },
    ],
  },
  offboarding: {
    name: "Offboarding karyawan keluar",
    items: [
      { name: "Serah terima pekerjaan", responsible: "manager", dueDays: -3 },
      { name: "Exit interview", responsible: "hr", dueDays: -1 },
      { name: "Kembalikan aset perusahaan (laptop, kartu akses)", responsible: "employee", dueDays: 0 },
      { name: "Hitung pesangon & hak akhir", responsible: "hr", dueDays: 0, action: "severance" },
      { name: "Nonaktifkan akun login", responsible: "it", dueDays: 0, action: "deactivate_user" },
    ],
  },
};

/** Urutan tahap rekrutmen (kanban); `refused` bisa dari tahap mana pun sebelum diterima. */
export const APPLICANT_FLOW = ["new", "screening", "interview", "offer", "hired"] as const;
