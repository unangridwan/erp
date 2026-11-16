import { z } from "zod";

/** Logika murni layanan pelanggan: tenggat & status SLA, statistik tiket; skema zod. */

export const TICKET_PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITY_VALUES)[number];
export const TICKET_PRIORITY_LABEL: Record<string, [string, string]> = {
  low: ["Rendah", "Low"],
  normal: ["Normal", "Normal"],
  high: ["Tinggi", "High"],
  urgent: ["Mendesak", "Urgent"],
};
export const TICKET_STATUS_VALUES = ["new", "open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUS_VALUES)[number];
export const TICKET_STATUS_LABEL: Record<string, [string, string]> = {
  new: ["Baru", "New"],
  open: ["Dikerjakan", "Open"],
  pending: ["Menunggu pelanggan", "Waiting on customer"],
  resolved: ["Selesai", "Resolved"],
  closed: ["Ditutup", "Closed"],
};
export const TICKET_CHANNEL_VALUES = ["email", "portal", "phone", "web", "chat", "other"] as const;
export const TICKET_CHANNEL_LABEL: Record<string, [string, string]> = {
  email: ["Email", "Email"],
  portal: ["Portal pelanggan", "Customer portal"],
  phone: ["Telepon", "Phone"],
  web: ["Situs web", "Website"],
  chat: ["Chat / WhatsApp", "Chat / WhatsApp"],
  other: ["Lainnya", "Other"],
};

/** Target bawaan saat perusahaan belum punya kebijakan SLA: [respons pertama, penyelesaian] dalam jam. */
export const DEFAULT_SLA_HOURS: Record<TicketPriority, [number, number]> = {
  urgent: [1, 8],
  high: [4, 24],
  normal: [8, 72],
  low: [24, 120],
};

const HOUR = 3_600_000;
const time = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

export interface SlaTargets {
  firstResponseHours: number | string;
  resolutionHours: number | string;
}

/** Tenggat respons pertama & penyelesaian dari waktu tiket dibuat (jam kalender). */
export function slaDueDates(createdAt: Date | string, policy: SlaTargets) {
  const base = time(createdAt);
  return {
    firstResponseDue: new Date(base + Number(policy.firstResponseHours) * HOUR),
    resolveDue: new Date(base + Number(policy.resolutionHours) * HOUR),
  };
}

export type SlaState = "met" | "breached" | "at_risk" | "on_track" | "none";

/**
 * Status satu target SLA. `at_risk` = tersisa ≤ 25% dari total waktu target. Target yang sudah tercapai dinilai dari
 * waktu tercapainya (tepat waktu = met, terlambat = breached).
 */
export function slaState(
  start: Date | string,
  due: Date | string | null | undefined,
  doneAt: Date | string | null | undefined,
  now: Date | string = new Date(),
): SlaState {
  if (!due) return "none";
  const end = time(due);
  if (doneAt) return time(doneAt) <= end ? "met" : "breached";
  const current = time(now);
  if (current > end) return "breached";
  const total = end - time(start);
  return total > 0 && (end - current) / total <= 0.25 ? "at_risk" : "on_track";
}

export interface TicketForStats {
  createdAt: Date | string;
  firstRespondedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  firstResponseDue?: Date | string | null;
  resolveDue?: Date | string | null;
  satisfaction?: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Rata-rata jam respons/penyelesaian, kepatuhan SLA (%), dan rata-rata kepuasan. */
export function ticketStats(tickets: TicketForStats[]) {
  const responded = tickets.filter((t) => t.firstRespondedAt);
  const resolved = tickets.filter((t) => t.resolvedAt);
  const hours = (from: Date | string, to: Date | string) => (time(to) - time(from)) / HOUR;
  const judged = (list: TicketForStats[], due: keyof TicketForStats, done: keyof TicketForStats) =>
    list.filter((t) => t[due] && t[done]);
  const compliance = (list: TicketForStats[], due: keyof TicketForStats, done: keyof TicketForStats) => {
    const items = judged(list, due, done);
    if (!items.length) return null;
    const met = items.filter((t) => time(t[done] as Date) <= time(t[due] as Date)).length;
    return round1((met / items.length) * 100);
  };
  const rated = tickets.map((t) => t.satisfaction).filter((s): s is number => typeof s === "number");
  return {
    total: tickets.length,
    avgFirstResponseHours: avg(responded.map((t) => hours(t.createdAt, t.firstRespondedAt!))),
    avgResolutionHours: avg(resolved.map((t) => hours(t.createdAt, t.resolvedAt!))),
    firstResponseCompliance: compliance(tickets, "firstResponseDue", "firstRespondedAt"),
    resolutionCompliance: compliance(tickets, "resolveDue", "resolvedAt"),
    avgSatisfaction: avg(rated),
    rated: rated.length,
  };
}

/** Nomor tiket dari subjek email balasan, mis. "Re: [TKT/2026/0007] Pompa rusak". */
export function ticketNumberFromSubject(subject: string): string | null {
  return /\[([A-Z]{2,10}\/\d{4}\/\d{3,})\]/.exec(subject)?.[1] ?? null;
}

/** Alamat email dari "Nama <alamat@x>" atau alamat polos. */
export function parseEmailAddress(from: string): { email: string | null; name: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  const email = (m ? m[2]! : from).trim().toLowerCase();
  return { email: /^[^\s@]+@[^\s@]+$/.test(email) ? email : null, name: m?.[1]?.trim() || null };
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const hours = z.coerce.number().gt(0).max(8760);

export const ticketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).nullish(),
  partnerId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  contactName: text(200),
  email: z
    .string()
    .trim()
    .email()
    .max(200)
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: text(50),
  channel: z.enum(TICKET_CHANNEL_VALUES).default("phone"),
  category: text(100),
  priority: z.enum(TICKET_PRIORITY_VALUES).default("normal"),
  status: z.enum(TICKET_STATUS_VALUES).default("new"),
  teamId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
});

export const ticketMessageSchema = z.object({
  kind: z.enum(["public", "internal"]).default("public"),
  body: z.string().trim().min(1).max(20000),
  /** Status tiket setelah balasan (mis. menunggu pelanggan). */
  status: z.enum(TICKET_STATUS_VALUES).nullish(),
});

export const supportTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  leaderId: z.string().uuid().nullish(),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
  autoAssign: z.boolean().default(true),
  active: z.boolean().default(true),
});

/** Objek polos (dipakai PATCH parsial); `slaPolicyError` memeriksa urutan target. */
export const slaPolicySchema = z.object({
  name: z.string().trim().min(1).max(100),
  priority: z.enum(TICKET_PRIORITY_VALUES),
  teamId: z.string().uuid().nullish(),
  firstResponseHours: hours.transform(String),
  resolutionHours: hours.transform(String),
  active: z.boolean().default(true),
});

export function slaPolicyError(p: {
  firstResponseHours?: string | number;
  resolutionHours?: string | number;
}): [string, string] | null {
  if (p.firstResponseHours === undefined || p.resolutionHours === undefined) return null;
  return Number(p.resolutionHours) < Number(p.firstResponseHours)
    ? ["resolutionHours", "Target penyelesaian tidak boleh lebih cepat dari respons pertama"]
    : null;
}

export const supportArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: text(100),
  body: z.string().trim().min(1).max(50000),
  published: z.boolean().default(false),
});

export const supportSettingsSchema = z.object({
  defaultTeamId: z.string().uuid().nullish(),
  autoCloseDays: z.coerce.number().int().min(0).max(365).default(7),
});

/** Tiket dari portal pelanggan. */
export const portalTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20000),
  priority: z.enum(TICKET_PRIORITY_VALUES).default("normal"),
  category: text(100),
});
export const portalTicketReplySchema = z.object({ body: z.string().trim().min(1).max(20000) });
export const ticketRatingSchema = z.object({
  satisfaction: z.coerce.number().int().min(1).max(5),
  note: text(2000),
});

/** Email masuk dari layanan penerus email (mis. webhook Mailgun/SendGrid/Postmark yang dipetakan). */
export const inboundEmailSchema = z.object({
  from: z.string().trim().min(3).max(300),
  subject: z.string().trim().max(500).default(""),
  text: z.string().max(50000).default(""),
});
