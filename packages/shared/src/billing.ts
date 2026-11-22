import { Decimal } from "decimal.js";

export type BillingCycle = "monthly" | "yearly";
export type EffectiveStatus =
  "trialing" | "active" | "complimentary" | "past_due" | "cancelling" | "expired" | "suspended";

export interface SubscriptionState {
  status: "trialing" | "active" | "cancelled" | "suspended";
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Diberikan gratis oleh admin platform; `complimentaryUntil` null = tanpa batas waktu. */
  complimentary?: boolean;
  complimentaryUntil?: Date | null;
}

const DAY = 86_400_000;

/**
 * Status langganan efektif saat ini (tanpa perlu penjadwal mengubah baris): uji coba/periode yang lewat
 * menjadi `past_due` selama masa toleransi lalu `expired`; langganan yang dibatalkan berakhir di akhir periode.
 */
export function effectiveStatus(sub: SubscriptionState, now: Date, graceDays: number): EffectiveStatus {
  if (sub.status === "suspended") return "suspended";
  if (sub.complimentary && (!sub.complimentaryUntil || sub.complimentaryUntil > now)) return "complimentary";
  if (sub.status === "trialing") return sub.trialEndsAt && sub.trialEndsAt > now ? "trialing" : "expired";
  const end = sub.currentPeriodEnd;
  if (!end) return "expired";
  if (sub.status === "cancelled" || sub.cancelAtPeriodEnd) return end > now ? "cancelling" : "expired";
  if (end > now) return "active";
  return end.getTime() + graceDays * DAY > now.getTime() ? "past_due" : "expired";
}

/** Tenant hanya bisa membaca (tidak menulis data) saat langganan berakhir atau ditangguhkan. */
export const isWritable = (status: EffectiveStatus) => status !== "expired" && status !== "suspended";

/** Akhir periode: tambah 1 bulan / 1 tahun (tanggal 31 → akhir bulan berikutnya). */
/**
 * Akhir periode: `start` + 1 bulan/tahun. `anchorDay` = tanggal jatuh tempo asli (mis. 31) agar periode yang dipotong
 * di bulan pendek (31 Jan → 28 Feb) kembali ke tanggal aslinya di periode berikutnya (→ 31 Mar), tidak terus bergeser.
 */
export function addPeriod(start: Date, cycle: BillingCycle, anchorDay?: number): Date {
  const months = cycle === "yearly" ? 12 : 1;
  const d = new Date(start);
  const day = anchorDay ?? d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Harga langganan + PPN 12% dengan DPP nilai lain 11/12 (efektif 11%), dibulatkan ke rupiah. */
export function billingAmounts(price: Decimal.Value) {
  const amount = new Decimal(price).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const tax = amount.times(11).div(12).times("0.12").toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { amount: amount.toFixed(2), tax: tax.toFixed(2), total: amount.plus(tax).toFixed(2) };
}
