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

export type Rating = "A" | "B" | "C" | "D" | "E";

/** Skor tertimbang 1–5 (dua desimal); null bila ada indikator yang belum dinilai. */
export function weightedScore(lines: { weight: number | string; score: number | null | undefined }[]) {
  if (!lines.length || lines.some((l) => l.score === null || l.score === undefined)) return null;
  const total = lines.reduce((s, l) => s + Number(l.weight), 0);
  if (total <= 0) return null;
  const score = lines.reduce((s, l) => s + Number(l.weight) * Number(l.score), 0) / total;
  return Math.round(score * 100) / 100;
}

/** Predikat: A ≥ 4,5 (istimewa), B ≥ 3,5 (baik), C ≥ 2,5 (cukup), D ≥ 1,5 (kurang), E (buruk). */
export function ratingFor(score: number): Rating {
  if (score >= 4.5) return "A";
  if (score >= 3.5) return "B";
  if (score >= 2.5) return "C";
  if (score >= 1.5) return "D";
  return "E";
}

/** Usulan kenaikan upah (%) bawaan per predikat; dapat diubah saat kalibrasi. */
export const RAISE_BY_RATING: Record<Rating, number> = { A: 10, B: 7, C: 4, D: 0, E: 0 };

/** Turnover tahunan (%) = jumlah keluar / rata-rata headcount (awal + akhir) / 2. */
export function turnoverRate(leavers: number, headcountStart: number, headcountEnd: number) {
  const avg = (headcountStart + headcountEnd) / 2;
  return avg > 0 ? Math.round((leavers / avg) * 10000) / 100 : 0;
}

/** Bangun pohon struktur organisasi dari daftar karyawan (atasan → bawahan); siklus diputus di akar. */
export function orgTree<T extends { id: string; managerId: string | null }>(rows: T[]) {
  type Node = T & { reports: Node[] };
  const nodes = new Map<string, Node>(rows.map((r) => [r.id, { ...r, reports: [] }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    // Atasan tidak ada di daftar, atau rantai atasan berputar → jadikan akar.
    let cursor = node.managerId ? nodes.get(node.managerId) : undefined;
    const seen = new Set([node.id]);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = cursor.managerId ? nodes.get(cursor.managerId) : undefined;
    }
    const parent = node.managerId ? nodes.get(node.managerId) : undefined;
    if (parent && !cursor) parent.reports.push(node);
    else roots.push(node);
  }
  return roots;
}
