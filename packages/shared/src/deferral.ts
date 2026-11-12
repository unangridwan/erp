import { Decimal } from "decimal.js";
import { z } from "zod";
import { addMonths, endOfMonth } from "./leave.js";
import { addDays } from "./sales.js";
import { daysBetween } from "./hr.js";

export interface DeferralPeriod {
  /** Tanggal jurnal pengakuan: akhir bulan (atau tanggal akhir penangguhan bila lebih awal). */
  date: string;
  from: string;
  to: string;
  days: number;
  amount: string;
}

/**
 * Jadwal pengakuan prorata hari: nilai dibagi menurut jumlah hari tiap bulan di rentang `start`..`end` (inklusif),
 * dibulatkan ke `decimals`; selisih pembulatan masuk bulan terakhir sehingga total sama persis.
 */
export function deferralSchedule(
  start: string,
  end: string,
  amount: Decimal.Value,
  decimals = 2,
): DeferralPeriod[] {
  if (end < start) throw new Error("Tanggal akhir penangguhan sebelum tanggal mulai");
  const total = new Decimal(amount);
  const totalDays = daysBetween(start, end) + 1;
  const periods: DeferralPeriod[] = [];
  let cursor = start;
  let allocated = new Decimal(0);
  while (cursor <= end) {
    const monthEnd = endOfMonth(cursor);
    const to = monthEnd < end ? monthEnd : end;
    const days = daysBetween(cursor, to) + 1;
    const last = to === end;
    const value = last
      ? total.minus(allocated)
      : total.times(days).div(totalDays).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
    allocated = allocated.plus(value);
    periods.push({ date: to, from: cursor, to, days, amount: value.toFixed(decimals) });
    cursor = addDays(to, 1);
  }
  return periods;
}

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_FREQUENCY_LABEL: Record<RecurringFrequency, [string, string]> = {
  weekly: ["Mingguan", "Weekly"],
  monthly: ["Bulanan", "Monthly"],
  quarterly: ["Triwulanan", "Quarterly"],
  yearly: ["Tahunan", "Yearly"],
};

/**
 * Kemunculan ke-`n` (0 = tanggal mulai) jadwal berulang. Bulanan/triwulan/tahunan dihitung dari tanggal mulai
 * sehingga tanggal 31 tetap akhir bulan (31 Jan → 28 Feb → 31 Mar) dan tidak bergeser.
 */
export function recurringOccurrence(
  start: string,
  frequency: RecurringFrequency,
  interval: number,
  n: number,
): string {
  if (frequency === "weekly") return addDays(start, 7 * interval * n);
  const months = (frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12) * interval * n;
  const isMonthEnd = endOfMonth(start) === start;
  const date = addMonths(start, months);
  return isMonthEnd ? endOfMonth(date) : date;
}

/** Tanggal-tanggal jadwal mulai `start` yang jatuh ≤ `until` dan ≤ `end` (bila ada), maksimal `limit`. */
export function recurringDates(
  t: { startDate: string; frequency: RecurringFrequency; interval: number; endDate?: string | null },
  from: string,
  until: string,
  limit = 24,
): string[] {
  const out: string[] = [];
  for (let n = 0; out.length < limit && n < 5000; n++) {
    const date = recurringOccurrence(t.startDate, t.frequency, t.interval, n);
    if (date > until || (t.endDate && date > t.endDate)) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** Tanggal berikutnya setelah `after` (null bila melewati tanggal akhir). */
export function nextRecurringDate(
  t: { startDate: string; frequency: RecurringFrequency; interval: number; endDate?: string | null },
  after: string,
): string | null {
  for (let n = 0; n < 5000; n++) {
    const date = recurringOccurrence(t.startDate, t.frequency, t.interval, n);
    if (t.endDate && date > t.endDate) return null;
    if (date > after) return date;
  }
  return null;
}

const money = z
  .union([z.number(), z.string().trim()])
  .transform(String)
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Angka tidak valid (maks. 2 desimal, tidak negatif)");

export const recurringEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    journalId: z.string().uuid(),
    ref: z.string().trim().max(200).nullish(),
    narration: z.string().max(2000).nullish(),
    frequency: z.enum(RECURRING_FREQUENCIES),
    interval: z.coerce.number().int().min(1).max(12).default(1),
    startDate: z.string().date(),
    endDate: z.string().date().nullish(),
    remainingCount: z.coerce.number().int().min(1).max(1000).nullish(),
    autoPost: z.boolean().default(false),
    autoReverse: z.boolean().default(false),
    active: z.boolean().default(true),
    lines: z
      .array(
        z.object({
          accountId: z.string().uuid(),
          name: z.string().trim().max(500).nullish(),
          debit: money.default("0"),
          credit: money.default("0"),
          partnerId: z.string().uuid().nullish(),
          businessUnitId: z.string().uuid().nullish(),
          branchId: z.string().uuid().nullish(),
          costCenterId: z.string().uuid().nullish(),
          profitCenterId: z.string().uuid().nullish(),
        }),
      )
      .min(2, "Minimal dua baris"),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate)
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal berakhir sebelum tanggal mulai" });
    const debit = v.lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const credit = v.lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    if (!debit.eq(credit))
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Total debit dan kredit harus sama" });
    if (debit.isZero())
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Total jurnal tidak boleh nol" });
    v.lines.forEach((l, i) => {
      if (new Decimal(l.debit).gt(0) && new Decimal(l.credit).gt(0))
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "debit"],
          message: "Isi debit atau kredit, bukan keduanya",
        });
    });
  });
export type RecurringEntryInput = z.infer<typeof recurringEntrySchema>;
