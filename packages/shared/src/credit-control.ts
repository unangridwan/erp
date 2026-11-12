import { Decimal } from "decimal.js";
import { z } from "zod";
import { daysBetween } from "./hr.js";

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export interface CreditInput {
  /** Batas kredit; null/undefined = tanpa batas. */
  limit?: Decimal.Value | null;
  /** Piutang terbuka (faktur terposting belum lunas). */
  receivable: Decimal.Value;
  /** Nilai pesanan penjualan terkonfirmasi yang belum ditagih. */
  uninvoicedOrders: Decimal.Value;
  /** Faktur penjualan draft. */
  draftInvoices: Decimal.Value;
  /** Nilai pesanan yang sedang diperiksa (belum termasuk di atas). */
  orderAmount?: Decimal.Value;
  /** Umur faktur lewat jatuh tempo tertua (hari); 0 = tidak ada tunggakan. */
  oldestOverdueDays: number;
  /** Peringatan bila tunggakan tertua melebihi N hari; null = tidak diperiksa. */
  warnDays?: number | null;
}

export interface CreditStatus {
  limit: string | null;
  exposure: string;
  available: string | null;
  /** Persen batas terpakai (0–∞), null bila tanpa batas. */
  usedPercent: number | null;
  exceeded: boolean;
  overdueWarning: boolean;
  oldestOverdueDays: number;
}

/** Paparan kredit pelanggan = piutang terbuka + SO belum ditagih + faktur draft (+ pesanan yang diperiksa). */
export function creditStatus(input: CreditInput): CreditStatus {
  const exposure = d(input.receivable)
    .plus(input.uninvoicedOrders)
    .plus(input.draftInvoices)
    .plus(input.orderAmount ?? 0);
  const hasLimit = input.limit !== null && input.limit !== undefined && input.limit !== "";
  const limit = hasLimit ? d(input.limit) : null;
  return {
    limit: limit ? money(limit) : null,
    exposure: money(exposure),
    available: limit ? money(limit.minus(exposure)) : null,
    usedPercent: limit
      ? limit.isZero()
        ? exposure.gt(0)
          ? 100
          : 0
        : exposure.div(limit).times(100).toDecimalPlaces(1).toNumber()
      : null,
    exceeded: limit ? exposure.gt(limit) : false,
    overdueWarning:
      input.warnDays !== null && input.warnDays !== undefined && input.oldestOverdueDays > input.warnDays,
    oldestOverdueDays: Math.max(0, input.oldestOverdueDays),
  };
}

// ---------- Dunning ----------

export interface DunningLevelDef {
  id?: string;
  sequence: number;
  name: string;
  daysOverdue: number;
  active?: boolean;
}

export interface DunningInvoice {
  moveId: string;
  partnerId: string;
  name: string;
  date: string;
  dueDate: string;
  amountTotal: Decimal.Value;
  residual: Decimal.Value;
  /** Tingkat terakhir yang sudah dikirim untuk faktur ini. */
  dunningLevel: number;
}

export interface DunningDueInvoice extends Omit<DunningInvoice, "amountTotal" | "residual"> {
  amountTotal: string;
  residual: string;
  daysOverdue: number;
  /** Tingkat yang sudah dicapai faktur ini pada tanggal penagihan (0 = belum mencapai tingkat apa pun). */
  targetLevel: number;
}

export interface DunningDue {
  partnerId: string;
  level: DunningLevelDef;
  /** Semua faktur lewat jatuh tempo pelanggan (dicantumkan di surat). */
  invoices: DunningDueInvoice[];
  totalOverdue: string;
}

/**
 * Pelanggan yang perlu ditagih pada `today`: faktur lewat jatuh tempo naik tingkat bila umurnya mencapai
 * `daysOverdue` tingkat yang lebih tinggi dari tingkat terakhir yang dikirim. Surat memakai tingkat tertinggi yang
 * dicapai dan mencantumkan semua faktur lewat jatuh tempo pelanggan itu. Total di bawah `minAmount` dilewati.
 */
export function dunningDue(
  invoices: DunningInvoice[],
  levels: DunningLevelDef[],
  today: string,
  minAmount: Decimal.Value = 0,
): DunningDue[] {
  const active = levels.filter((l) => l.active !== false).sort((a, b) => a.sequence - b.sequence);
  if (!active.length) return [];
  const byPartner = new Map<string, DunningDueInvoice[]>();
  for (const inv of invoices) {
    if (d(inv.residual).lte(0)) continue;
    const days = daysBetween(inv.dueDate, today);
    if (days <= 0) continue;
    const reached = active.filter((l) => days >= l.daysOverdue).at(-1);
    const row: DunningDueInvoice = {
      ...inv,
      amountTotal: money(d(inv.amountTotal)),
      residual: money(d(inv.residual)),
      daysOverdue: days,
      targetLevel: reached?.sequence ?? 0,
    };
    byPartner.set(inv.partnerId, [...(byPartner.get(inv.partnerId) ?? []), row]);
  }
  const out: DunningDue[] = [];
  for (const [partnerId, rows] of byPartner) {
    const rising = rows.filter((r) => r.targetLevel > r.dunningLevel);
    if (!rising.length) continue;
    const top = Math.max(...rising.map((r) => r.targetLevel));
    const total = rows.reduce((s, r) => s.plus(r.residual), d(0));
    if (total.lt(minAmount)) continue;
    out.push({
      partnerId,
      level: active.find((l) => l.sequence === top)!,
      invoices: rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name)),
      totalOverdue: money(total),
    });
  }
  return out;
}

export const DUNNING_PLACEHOLDERS = [
  "pelanggan",
  "perusahaan",
  "total",
  "daftar_faktur",
  "tanggal",
  "tingkat",
] as const;

/** Isi placeholder `{kunci}`; yang tidak dikenal dibiarkan apa adanya. */
export function renderDunningText(template: string, vars: Partial<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (all, key: string) => vars[key] ?? all);
}

export const DEFAULT_DUNNING_LEVELS = [
  {
    sequence: 1,
    name: "Pengingat",
    daysOverdue: 7,
    emailSubject: "Pengingat pembayaran dari {perusahaan}",
    body:
      "Yth. {pelanggan},\n\nKami ingin mengingatkan bahwa faktur berikut telah melewati tanggal jatuh tempo:\n\n" +
      "{daftar_faktur}\n\nTotal tertunggak: {total}.\n\nMohon abaikan pesan ini bila pembayaran sudah dilakukan. " +
      "Terima kasih atas kerja samanya.\n\nHormat kami,\n{perusahaan}",
    attachPdf: false,
  },
  {
    sequence: 2,
    name: "Surat teguran 1",
    daysOverdue: 30,
    emailSubject: "Surat teguran pembayaran — {perusahaan}",
    body:
      "Yth. {pelanggan},\n\nSampai tanggal {tanggal} kami belum menerima pembayaran atas faktur berikut:\n\n" +
      "{daftar_faktur}\n\nTotal tertunggak: {total}.\n\nKami mohon pembayaran segera dilakukan dalam 7 hari. " +
      "Bila ada perbedaan catatan, silakan hubungi kami.\n\nHormat kami,\n{perusahaan}",
    attachPdf: true,
  },
  {
    sequence: 3,
    name: "Teguran terakhir",
    daysOverdue: 60,
    emailSubject: "Teguran terakhir pembayaran — {perusahaan}",
    body:
      "Yth. {pelanggan},\n\nIni adalah teguran terakhir atas faktur yang belum dibayar berikut:\n\n{daftar_faktur}\n\n" +
      "Total tertunggak: {total}.\n\nBila pembayaran belum kami terima dalam 7 hari sejak tanggal surat ini, kami " +
      "akan menahan pengiriman berikutnya dan menempuh langkah penagihan lebih lanjut.\n\nHormat kami,\n{perusahaan}",
    attachPdf: true,
  },
] as const;

// ---------- Validasi ----------

const money2 = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,18}(\.\d{1,2})?$/.test(v), "Nominal tidak valid");

export const partnerCreditSchema = z.object({
  creditLimit: money2.nullish().transform((v) => (v === undefined || v === "" ? null : v)),
  overdueWarnDays: z.coerce.number().int().min(0).max(3650).nullish(),
  dunningExcluded: z.boolean().default(false),
  note: z.string().trim().max(300).nullish(),
});
export type PartnerCreditInput = z.infer<typeof partnerCreditSchema>;

export const dunningLevelSchema = z.object({
  sequence: z.coerce.number().int().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  daysOverdue: z.coerce.number().int().min(0).max(3650),
  emailSubject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  attachPdf: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type DunningLevelInput = z.infer<typeof dunningLevelSchema>;

export const dunningSendSchema = z.object({
  date: z.string().date().optional(),
  /** Kosong = semua pelanggan yang jatuh tempo. */
  partnerIds: z.array(z.string().uuid()).max(1000).optional(),
});

export const dunningSettingsSchema = z.object({
  dunningEnabled: z.boolean(),
  dunningMinAmount: money2.default("0"),
});
