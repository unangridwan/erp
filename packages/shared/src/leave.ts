/** Logika murni cuti lanjutan: durasi, buku besar saldo per jatah (FIFO + kedaluwarsa), akrual, carry-over. */
import { Decimal } from "decimal.js";
import { workingDays } from "./payroll.js";
import { addDays } from "./sales.js";
import { eachDate } from "./work-calendar.js";

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const DAY = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Tanggal + n bulan; tanggal akhir bulan dipotong (31 Jan + 1 bulan = 28/29 Feb). */
export function addMonths(date: string, n: number) {
  const [y, m, day] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Hari terakhir bulan dari tanggal (YYYY-MM-DD). */
export const endOfMonth = (date: string) => addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1);

/**
 * Durasi cuti: setengah hari = 0,5 (hanya cuti sehari pada hari kerja); hari kalender bila jenis cuti menghitung
 * kalender (mis. cuti melahirkan); selain itu hari kerja di luar hari libur — menurut `isWorkday` (jadwal kerja
 * karyawan) bila diberikan, atau Senin–Jumat.
 */
export function leaveDays(input: {
  from: string;
  to: string;
  holidays?: string[];
  halfDay?: "am" | "pm" | null;
  calendar?: boolean;
  isWorkday?: (date: string) => boolean;
}): number {
  if (input.calendar) return Math.round((parse(input.to) - parse(input.from)) / DAY) + 1;
  const work = input.isWorkday
    ? eachDate(input.from, input.to).filter(input.isWorkday).length
    : workingDays(input.from, input.to, input.holidays ?? []);
  if (input.halfDay) return input.from === input.to && work === 1 ? 0.5 : 0;
  return work;
}

export interface LedgerAllocation {
  id: string;
  days: Decimal.Value;
  dateFrom: string;
  dateTo: string;
  source?: string;
  period?: string | null;
  accrualPlanId?: string | null;
}
export interface LedgerRequest {
  id: string;
  dateFrom: string;
  dateTo?: string;
  days: Decimal.Value;
}
export interface LedgerAllocationState {
  id: string;
  dateFrom: string;
  dateTo: string;
  source: string;
  period: string | null;
  accrualPlanId: string | null;
  days: string;
  used: string;
  /** Bisa negatif bila jenis cuti mengizinkan saldo minus. */
  remaining: string;
}
export interface LedgerEntry {
  date: string;
  kind: "credit" | "debit" | "expire";
  days: string;
  ref: string;
}

/**
 * Buku besar saldo satu karyawan × satu jenis cuti. Setiap pengajuan (urut tanggal mulai) memakai jatah yang berlaku
 * pada tanggal mulainya, yang kedaluwarsa paling awal dulu (FIFO). Kekurangan dibebankan ke jatah yang berlaku paling
 * lama (sisanya menjadi negatif); bila tidak ada jatah sama sekali, ke jatah semu tahun berjalan. Sisa jatah yang lewat
 * masa berlakunya pada tanggal `on` tercatat kedaluwarsa.
 */
export function leaveLedger(allocations: LedgerAllocation[], requests: LedgerRequest[], on: string) {
  const states = allocations
    .map((a) => ({
      id: a.id,
      dateFrom: a.dateFrom,
      dateTo: a.dateTo,
      source: a.source ?? "manual",
      period: a.period ?? null,
      accrualPlanId: a.accrualPlanId ?? null,
      days: d(a.days),
      used: d(0),
    }))
    .sort((x, y) => x.dateTo.localeCompare(y.dateTo) || x.dateFrom.localeCompare(y.dateFrom));
  const entries: LedgerEntry[] = states.map((a) => ({
    date: a.dateFrom,
    kind: "credit",
    days: a.days.toFixed(2),
    ref: a.id,
  }));
  let deficit = d(0);
  for (const r of [...requests].sort((x, y) => x.dateFrom.localeCompare(y.dateFrom))) {
    let need = d(r.days);
    entries.push({ date: r.dateFrom, kind: "debit", days: need.toFixed(2), ref: r.id });
    const valid = states.filter((a) => a.dateFrom <= r.dateFrom && a.dateTo >= r.dateFrom);
    for (const a of valid) {
      if (need.lte(0)) break;
      const free = Decimal.max(a.days.minus(a.used), 0);
      const take = Decimal.min(free, need);
      a.used = a.used.plus(take);
      need = need.minus(take);
    }
    if (need.gt(0)) {
      deficit = deficit.plus(need);
      let target = valid[valid.length - 1];
      if (!target) {
        const year = r.dateFrom.slice(0, 4);
        target = {
          id: `deficit-${year}`,
          dateFrom: `${year}-01-01`,
          dateTo: `${year}-12-31`,
          source: "deficit",
          period: year,
          accrualPlanId: null,
          days: d(0),
          used: d(0),
        };
        const existing = states.find((a) => a.id === target!.id);
        if (existing) target = existing;
        else states.push(target);
      }
      target.used = target.used.plus(need);
    }
  }
  for (const a of states) {
    const rest = a.days.minus(a.used);
    if (a.dateTo < on && rest.gt(0))
      entries.push({ date: addDays(a.dateTo, 1), kind: "expire", days: rest.toFixed(2), ref: a.id });
  }
  entries.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === "credit" ? -1 : 1));
  const shaped: LedgerAllocationState[] = states.map((a) => ({
    id: a.id,
    dateFrom: a.dateFrom,
    dateTo: a.dateTo,
    source: a.source,
    period: a.period,
    accrualPlanId: a.accrualPlanId,
    days: a.days.toFixed(2),
    used: a.used.toFixed(2),
    remaining: a.days.minus(a.used).toFixed(2),
  }));
  return { allocations: shaped, entries, deficit: deficit.toFixed(2) };
}

/** Ringkasan saldo pada tanggal: jatah berlaku, terpakai, sisa, akan kedaluwarsa dalam `soonDays` hari. */
export function balanceOn(
  ledger: { allocations: LedgerAllocationState[] },
  on: string,
  soonDays = 30,
): { allocated: string; taken: string; remaining: string; expiringSoon: string; expiringOn: string | null } {
  const valid = ledger.allocations.filter((a) => a.dateFrom <= on && a.dateTo >= on);
  const allocated = valid.reduce((s, a) => s.plus(a.days), d(0));
  const taken = valid.reduce((s, a) => s.plus(a.used), d(0));
  const limit = addDays(on, soonDays);
  const soon = valid.filter((a) => a.dateTo <= limit && d(a.remaining).gt(0));
  return {
    allocated: allocated.toFixed(2),
    taken: taken.toFixed(2),
    remaining: allocated.minus(taken).toFixed(2),
    expiringSoon: soon.reduce((s, a) => s.plus(a.remaining), d(0)).toFixed(2),
    expiringOn: soon.length ? soon.map((a) => a.dateTo).sort()[0]! : null,
  };
}

/** Jatah terendah setelah simulasi: dipakai untuk memeriksa batas saldo minus. */
export const lowestRemaining = (ledger: { allocations: LedgerAllocationState[] }) =>
  ledger.allocations.reduce((m, a) => Decimal.min(m, a.remaining), d(0)).toFixed(2);

export interface AccrualPlan {
  frequency: "monthly" | "yearly";
  daysPerPeriod: Decimal.Value;
  startAfterMonths: number;
}

/**
 * Periode akrual yang sudah jatuh tempo sampai `until`. Akrual mulai pada tanggal yang lebih akhir antara penugasan
 * dan tanggal masuk + `startAfterMonths`. Tahunan: periode YYYY, berlaku sejak tanggal mulai (atau 1 Jan) s.d. 31 Des.
 * Bulanan: periode YYYY-MM, berlaku sejak awal bulan (atau tanggal mulai) s.d. 31 Des tahun itu.
 */
export function accrualPeriods(
  plan: AccrualPlan,
  input: { assignedFrom: string; joinDate: string; until: string },
): { period: string; days: string; dateFrom: string; dateTo: string }[] {
  const eligible = addMonths(input.joinDate, plan.startAfterMonths);
  const start = eligible > input.assignedFrom ? eligible : input.assignedFrom;
  if (start > input.until) return [];
  const out: { period: string; days: string; dateFrom: string; dateTo: string }[] = [];
  const days = d(plan.daysPerPeriod).toFixed(2);
  if (plan.frequency === "yearly") {
    for (let y = Number(start.slice(0, 4)); y <= Number(input.until.slice(0, 4)); y++) {
      const from = y === Number(start.slice(0, 4)) ? start : `${y}-01-01`;
      if (from <= input.until) out.push({ period: String(y), days, dateFrom: from, dateTo: `${y}-12-31` });
    }
    return out;
  }
  for (let month = `${start.slice(0, 7)}-01`; month <= input.until; month = addMonths(month, 1)) {
    const from = month < start ? start : month;
    if (from > input.until) break;
    out.push({ period: month.slice(0, 7), days, dateFrom: from, dateTo: `${month.slice(0, 4)}-12-31` });
  }
  return out;
}

/** Hari akrual setelah batas saldo rencana: tidak melebihi `maxBalance` (null = tanpa batas). */
export function cappedAccrual(
  current: Decimal.Value,
  days: Decimal.Value,
  maxBalance?: Decimal.Value | null,
) {
  if (maxBalance === null || maxBalance === undefined || maxBalance === "") return d(days).toFixed(2);
  return Decimal.max(Decimal.min(d(days), d(maxBalance).minus(current)), 0).toFixed(2);
}

/** Sisa tahun `year` yang dibawa ke tahun berikutnya beserta masa berlakunya. */
export function carryOver(
  plan: {
    carryOver: "none" | "all" | "limited";
    carryOverMax?: Decimal.Value | null;
    carryOverExpiryMonths?: number | null;
  },
  remaining: Decimal.Value,
  year: number,
): { days: string; dateFrom: string; dateTo: string } | null {
  const rest = Decimal.max(d(remaining), 0);
  if (plan.carryOver === "none" || rest.lte(0)) return null;
  const days = plan.carryOver === "limited" ? Decimal.min(rest, d(plan.carryOverMax)) : rest;
  if (days.lte(0)) return null;
  const from = `${year + 1}-01-01`;
  const to = plan.carryOverExpiryMonths
    ? endOfMonth(addMonths(from, plan.carryOverExpiryMonths - 1))
    : `${year + 1}-12-31`;
  return { days: days.toFixed(2), dateFrom: from, dateTo: to };
}

/** Cuti pengganti dari jam lembur hari libur: jam / 8, dibulatkan ke bawah per 0,5 hari. */
export const compensatoryDays = (hours: Decimal.Value) => d(hours).div(8).times(2).floor().div(2).toFixed(2);
