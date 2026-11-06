/** PRNG ber-seed (mulberry32): data simulasi selalu sama setiap kali dibangkitkan. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  /** Pilih menurut bobot. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of items) if ((r -= w) <= 0) return v;
    return items[items.length - 1]![0];
  }
  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, n);
  }
  digits(n: number) {
    let s = "";
    for (let i = 0; i < n; i++) s += String(this.int(0, 9));
    return s;
  }
}

/** Pembulatan ke kelipatan (mis. harga ke 500 terdekat). */
export const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export const pad = (n: number, len: number) => String(n).padStart(len, "0");

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Minggu … 6 = Sabtu. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const monthEnd = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
