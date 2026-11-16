import { Decimal } from "decimal.js";
import { z } from "zod";
import { automationConditionSchema, matchConditions, type AutomationCondition } from "./automation.js";

/** Logika murni marketing CRM: skor lead, pilihan aturan penugasan, ROI kampanye; skema zod. */

export const CAMPAIGN_TYPE_VALUES = [
  "email",
  "event",
  "webinar",
  "ads",
  "social",
  "referral",
  "other",
] as const;
export const CAMPAIGN_TYPE_LABEL: Record<string, [string, string]> = {
  email: ["Email", "Email"],
  event: ["Acara / pameran", "Event"],
  webinar: ["Webinar", "Webinar"],
  ads: ["Iklan", "Advertising"],
  social: ["Media sosial", "Social media"],
  referral: ["Referensi", "Referral"],
  other: ["Lainnya", "Other"],
};
export const CAMPAIGN_STATUS_VALUES = ["planned", "active", "completed", "cancelled"] as const;
export const CAMPAIGN_STATUS_LABEL: Record<string, [string, string]> = {
  planned: ["Direncanakan", "Planned"],
  active: ["Berjalan", "Active"],
  completed: ["Selesai", "Completed"],
  cancelled: ["Dibatalkan", "Cancelled"],
};
export const MEMBER_STATUS_VALUES = ["targeted", "sent", "responded", "unsubscribed", "failed"] as const;
export const MEMBER_STATUS_LABEL: Record<string, [string, string]> = {
  targeted: ["Ditargetkan", "Targeted"],
  sent: ["Terkirim", "Sent"],
  responded: ["Merespons", "Responded"],
  unsubscribed: ["Berhenti langganan", "Unsubscribed"],
  failed: ["Gagal kirim", "Failed"],
};

/** Field lead yang bisa dipakai di syarat aturan skor & penugasan. */
export const LEAD_RULE_FIELDS: { key: string; label: [string, string]; type: "text" | "number" }[] = [
  { key: "source", label: ["Sumber", "Source"], type: "text" },
  { key: "leadStatus", label: ["Status lead", "Lead status"], type: "text" },
  { key: "industry", label: ["Industri", "Industry"], type: "text" },
  { key: "city", label: ["Kota", "City"], type: "text" },
  { key: "province", label: ["Provinsi", "Province"], type: "text" },
  { key: "title", label: ["Jabatan kontak", "Contact job title"], type: "text" },
  { key: "email", label: ["Email", "Email"], type: "text" },
  { key: "phone", label: ["Telepon", "Phone"], type: "text" },
  { key: "partnerName", label: ["Nama perusahaan", "Company name"], type: "text" },
  { key: "website", label: ["Situs web", "Website"], type: "text" },
  { key: "employeeCount", label: ["Jumlah karyawan", "Employees"], type: "number" },
  { key: "annualRevenue", label: ["Omzet tahunan", "Annual revenue"], type: "number" },
  { key: "expectedRevenue", label: ["Nilai harapan", "Expected revenue"], type: "number" },
];
const RULE_FIELD_KEYS = new Set(LEAD_RULE_FIELDS.map((f) => f.key));

export interface ScoringRule {
  conditions: AutomationCondition[];
  points: number;
  active?: boolean;
}

/** Skor lead 0–100: jumlah poin semua aturan aktif yang seluruh syaratnya cocok. Aturan tanpa syarat diabaikan. */
export function scoreLead(lead: Record<string, unknown>, rules: ScoringRule[]): number {
  let score = 0;
  for (const r of rules) {
    if (r.active === false || r.conditions.length === 0) continue;
    if (matchConditions(lead, r.conditions)) score += r.points;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export const scoreGrade = (score: number): "A" | "B" | "C" | "D" =>
  score >= 75 ? "A" : score >= 50 ? "B" : score >= 25 ? "C" : "D";

export interface AssignmentRule {
  id: string;
  sequence: number;
  conditions: AutomationCondition[];
  active?: boolean;
}

/** Aturan penugasan pertama (urutan terkecil) yang cocok; aturan tanpa syarat cocok untuk semua lead. */
export function pickAssignmentRule<T extends AssignmentRule>(
  rules: T[],
  lead: Record<string, unknown>,
): T | null {
  const sorted = [...rules].filter((r) => r.active !== false).sort((a, b) => a.sequence - b.sequence);
  return sorted.find((r) => matchConditions(lead, r.conditions)) ?? null;
}

/** ROI kampanye: (nilai menang − biaya) ÷ biaya × 100; `null` bila biaya 0. Biaya per lead bila ada lead. */
export function campaignRoi(input: { cost: Decimal.Value; wonAmount: Decimal.Value; leads: number }) {
  const cost = new Decimal(input.cost);
  const won = new Decimal(input.wonAmount);
  return {
    roi: cost.gt(0) ? won.minus(cost).div(cost).times(100).toDecimalPlaces(1).toNumber() : null,
    costPerLead: input.leads > 0 && cost.gt(0) ? cost.div(input.leads).toFixed(2) : null,
  };
}

/** Field yang boleh ditampilkan di formulir web. */
export const WEB_FORM_FIELDS = [
  "contactName",
  "partnerName",
  "email",
  "phone",
  "title",
  "city",
  "province",
  "industry",
  "description",
] as const;
export type WebFormField = (typeof WEB_FORM_FIELDS)[number];
export const WEB_FORM_FIELD_LABEL: Record<WebFormField, [string, string]> = {
  contactName: ["Nama", "Name"],
  partnerName: ["Perusahaan", "Company"],
  email: ["Email", "Email"],
  phone: ["Telepon / WhatsApp", "Phone"],
  title: ["Jabatan", "Job title"],
  city: ["Kota", "City"],
  province: ["Provinsi", "Province"],
  industry: ["Bidang usaha", "Industry"],
  description: ["Pesan / kebutuhan", "Message"],
};

const money = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Angka tidak valid (maks. 2 desimal, tidak negatif)"),
  ])
  .transform(String);
const conditions = z
  .array(automationConditionSchema)
  .max(10)
  .refine((list) => list.every((c) => RULE_FIELD_KEYS.has(c.field)), "Field syarat tidak dikenal")
  .default([]);

/** Objek polos (tanpa refine) agar bisa dipakai PATCH parsial; aturan lintas-field ada di `campaignError`. */
export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(150),
  campaignType: z.enum(CAMPAIGN_TYPE_VALUES).default("email"),
  status: z.enum(CAMPAIGN_STATUS_VALUES).default("planned"),
  dateStart: z.string().date().nullish(),
  dateEnd: z.string().date().nullish(),
  budget: money.default("0"),
  actualCost: money.default("0"),
  expectedRevenue: money.default("0"),
  userId: z.string().uuid().nullish(),
  description: z.string().max(5000).nullish(),
});

/** Kesalahan lintas-field kampanye: `[path, pesan]` atau `null`. */
export function campaignError(c: {
  dateStart?: string | null;
  dateEnd?: string | null;
}): [string, string] | null {
  return c.dateStart && c.dateEnd && c.dateEnd < c.dateStart
    ? ["dateEnd", "Tanggal selesai tidak boleh sebelum tanggal mulai"]
    : null;
}

/** Tambah anggota: daftar lead/kontak, atau segmen lead terbuka (sumber/status/wilayah). */
export const campaignMembersSchema = z.object({
  leadIds: z.array(z.string().uuid()).max(2000).default([]),
  partnerIds: z.array(z.string().uuid()).max(2000).default([]),
  segment: z
    .object({
      source: z.string().trim().max(30).nullish(),
      leadStatus: z.string().trim().max(30).nullish(),
      territoryId: z.string().uuid().nullish(),
      minScore: z.coerce.number().int().min(0).max(100).nullish(),
    })
    .nullish(),
});

export const campaignEmailSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  /** Kosong = semua anggota yang belum berhenti langganan. */
  onlyStatus: z.enum(MEMBER_STATUS_VALUES).nullish(),
});

export const scoringRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  conditions: conditions.refine((l) => l.length > 0, "Minimal satu syarat"),
  points: z.coerce.number().int().min(-100).max(100),
  active: z.boolean().default(true),
});

export const assignmentRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sequence: z.coerce.number().int().min(0).max(100000).default(10),
  conditions,
  userIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu penerima").max(100),
  teamId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
});

const formFields = z.array(z.enum(WEB_FORM_FIELDS)).max(WEB_FORM_FIELDS.length);
/** Objek polos (tanpa refine) agar bisa dipakai PATCH parsial; aturan lintas-field ada di `webFormError`. */
export const webFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  campaignId: z.string().uuid().nullish(),
  source: z.enum(["website", "referral", "event", "ads", "social", "cold_call", "other"]).default("website"),
  fields: formFields.min(1).default(["contactName", "partnerName", "email", "phone", "description"]),
  requiredFields: formFields.default(["contactName", "email"]),
  successMessage: z.string().trim().max(500).nullish(),
  redirectUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\//, "URL harus diawali http:// atau https://")
    .nullish()
    .or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
});

/** Kesalahan lintas-field formulir web: `[path, pesan]` atau `null`. */
export function webFormError(f: { fields: string[]; requiredFields: string[] }): [string, string] | null {
  if (!f.requiredFields.every((r) => f.fields.includes(r)))
    return ["requiredFields", "Field wajib harus termasuk field yang ditampilkan"];
  if (!f.fields.includes("email") && !f.fields.includes("phone"))
    return ["fields", "Formulir harus meminta email atau telepon"];
  return null;
}

const short = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
/** Kiriman publik; `website_url` adalah honeypot (harus kosong). */
export const webFormSubmissionSchema = z.object({
  contactName: short(200),
  partnerName: short(200),
  email: z
    .string()
    .trim()
    .max(200)
    .email("Email tidak valid")
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: short(50),
  title: short(100),
  city: short(100),
  province: short(100),
  industry: short(100),
  description: short(5000),
  website_url: z.string().max(500).nullish(),
});
