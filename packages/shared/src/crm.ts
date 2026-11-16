import { Decimal } from "decimal.js";
import { z } from "zod";

/** Logika murni CRM: nilai produk peluang, kunci duplikat, durasi tahap, corong konversi; skema zod. */

export const LEAD_STATUS_VALUES = ["new", "contacted", "qualified", "unqualified"] as const;
export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];
export const LEAD_STATUS_LABEL: Record<string, [string, string]> = {
  new: ["Baru", "New"],
  contacted: ["Dihubungi", "Contacted"],
  qualified: ["Terkualifikasi", "Qualified"],
  unqualified: ["Tidak layak", "Unqualified"],
};

export const CONTACT_ROLE_VALUES = [
  "decision_maker",
  "influencer",
  "champion",
  "evaluator",
  "buyer",
  "user",
  "other",
] as const;
export const CONTACT_ROLE_LABEL: Record<string, [string, string]> = {
  decision_maker: ["Pengambil keputusan", "Decision maker"],
  influencer: ["Pemberi pengaruh", "Influencer"],
  champion: ["Pendukung internal", "Champion"],
  evaluator: ["Penilai teknis", "Evaluator"],
  buyer: ["Pembelian / pengadaan", "Economic buyer"],
  user: ["Pengguna", "End user"],
  other: ["Lainnya", "Other"],
};

export const ACCOUNT_RATING_VALUES = ["hot", "warm", "cold"] as const;
export const ACCOUNT_RATING_LABEL: Record<string, [string, string]> = {
  hot: ["Panas", "Hot"],
  warm: ["Hangat", "Warm"],
  cold: ["Dingin", "Cold"],
};

export interface LeadProductLine {
  quantity: Decimal.Value;
  priceUnit: Decimal.Value;
  discount?: Decimal.Value | null;
}

/** Subtotal satu baris produk peluang: qty × harga × (1 − diskon%), dibulatkan 2 desimal. */
export function leadProductSubtotal(line: LeadProductLine): string {
  return new Decimal(line.quantity)
    .times(line.priceUnit)
    .times(new Decimal(100).minus(line.discount ?? 0).div(100))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export function leadProductsTotal(lines: LeadProductLine[]): string {
  return lines.reduce((sum, l) => sum.plus(leadProductSubtotal(l)), new Decimal(0)).toFixed(2);
}

/** Email dinormalkan untuk pencocokan duplikat. */
export const normalizeEmail = (email: string | null | undefined): string | null => {
  const v = (email ?? "").trim().toLowerCase();
  return v.includes("@") ? v : null;
};

/**
 * Nomor telepon dinormalkan: hanya digit, awalan 62/0 dibuang sehingga `+62 812-3456` = `0812 3456`.
 * Kurang dari 6 digit dianggap tidak cukup untuk pencocokan.
 */
export const normalizePhone = (phone: string | null | undefined): string | null => {
  let v = (phone ?? "").replace(/\D/g, "");
  if (v.startsWith("62")) v = v.slice(2);
  v = v.replace(/^0+/, "");
  return v.length >= 6 ? v : null;
};

/** Nama perusahaan dinormalkan: huruf kecil, tanpa bentuk badan usaha & tanda baca. */
export const normalizeCompanyName = (name: string | null | undefined): string | null => {
  const v = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["pt", "cv", "tbk", "persero", "ud", "pd", "ltd", "inc", "corp", "co"].includes(w))
    .join(" ");
  return v.length >= 3 ? v : null;
};

export interface DuplicateCandidate {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

/** Alasan dua rekaman dianggap duplikat (kosong = bukan duplikat). */
export function duplicateReasons(
  a: DuplicateCandidate,
  b: DuplicateCandidate,
): ("email" | "phone" | "name")[] {
  const reasons: ("email" | "phone" | "name")[] = [];
  const email = normalizeEmail(a.email);
  if (email && email === normalizeEmail(b.email)) reasons.push("email");
  const phone = normalizePhone(a.phone);
  if (phone && phone === normalizePhone(b.phone)) reasons.push("phone");
  const name = normalizeCompanyName(a.name);
  if (name && name === normalizeCompanyName(b.name)) reasons.push("name");
  return reasons;
}

export interface StageChange {
  toStageId: string | null;
  state: "open" | "won" | "lost";
  changedAt: string | Date;
}

const DAY = 86_400_000;
const time = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * Lama (hari) peluang berada di tiap tahap, dari riwayat berurutan. Tahap terakhir yang masih terbuka dihitung
 * sampai `now`; setelah menang/kalah waktu berhenti.
 */
export function stageDurations(history: StageChange[], now: string | Date = new Date()): Map<string, number> {
  const sorted = [...history].sort((a, b) => time(a.changedAt) - time(b.changedAt));
  const out = new Map<string, number>();
  sorted.forEach((h, i) => {
    if (h.state !== "open" || !h.toStageId) return;
    const end = sorted[i + 1] ? time(sorted[i + 1]!.changedAt) : time(now);
    const days = Math.max(0, end - time(h.changedAt)) / DAY;
    out.set(h.toStageId, (out.get(h.toStageId) ?? 0) + days);
  });
  return out;
}

/** Hari dari perubahan pertama sampai menang/kalah; `null` bila masih terbuka. */
export function salesCycleDays(history: StageChange[]): number | null {
  const sorted = [...history].sort((a, b) => time(a.changedAt) - time(b.changedAt));
  const last = sorted[sorted.length - 1];
  if (!last || last.state === "open") return null;
  return Math.max(0, time(last.changedAt) - time(sorted[0]!.changedAt)) / DAY;
}

export interface FunnelCounts {
  leads: number;
  contacted: number;
  qualified: number;
  opportunities: number;
  won: number;
}

/** Corong: jumlah per langkah dan rasio terhadap langkah sebelumnya (% satu desimal, `null` bila pembagi 0). */
export function funnelSteps(c: FunnelCounts) {
  const steps: [keyof FunnelCounts, number][] = [
    ["leads", c.leads],
    ["contacted", c.contacted],
    ["qualified", c.qualified],
    ["opportunities", c.opportunities],
    ["won", c.won],
  ];
  return steps.map(([key, count], i) => {
    const prev = i ? steps[i - 1]![1] : null;
    return {
      key,
      count,
      rate: prev === null ? null : prev ? Math.round((count / prev) * 1000) / 10 : null,
      overall: c.leads ? Math.round((count / c.leads) * 1000) / 10 : null,
    };
  });
}

const amount = () =>
  z
    .union([
      z.number(),
      z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,4})?$/, "Angka tidak valid (maks. 4 desimal)"),
    ])
    .transform(String);

export const leadProductsSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        name: z.string().trim().max(500).nullish(),
        quantity: amount()
          .refine((v) => Number(v) > 0, "Harus lebih dari 0")
          .default("1"),
        /** Kosong = harga jual produk. */
        priceUnit: amount().nullish(),
        discount: amount()
          .refine((v) => Number(v) <= 100, "Maksimal 100")
          .default("0"),
      }),
    )
    .max(200),
});

export const contactRolesSchema = z.object({
  roles: z
    .array(
      z.object({
        partnerId: z.string().uuid(),
        role: z.enum(CONTACT_ROLE_VALUES).default("other"),
        isPrimary: z.boolean().default(false),
        note: z.string().trim().max(500).nullish(),
      }),
    )
    .max(50)
    .refine((r) => new Set(r.map((x) => x.partnerId)).size === r.length, "Kontak tidak boleh ganda")
    .refine((r) => r.filter((x) => x.isPrimary).length <= 1, "Hanya satu kontak utama"),
});

export const mergeLeadsSchema = z.object({
  sourceIds: z.array(z.string().uuid()).min(1).max(20),
});

export const leadQuotationSchema = z.object({
  dateOrder: z.string().date().optional(),
  validityDate: z.string().date().nullish(),
});
