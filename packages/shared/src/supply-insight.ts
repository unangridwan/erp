/**
 * Rantai pasok: ketepatan pengiriman (OTIF), kinerja pemasok, dan umur persediaan, diturunkan dari pengiriman,
 * penerimaan, pemeriksaan mutu, dan lapisan valuasi stok.
 */

export interface DeliveryRow {
  month: string;
  onTime: boolean;
  inFull: boolean;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Ringkasan tepat waktu, tepat jumlah, dan keduanya (OTIF). */
export function otif(rows: Pick<DeliveryRow, "onTime" | "inFull">[]) {
  return {
    count: rows.length,
    onTime: pct(rows.filter((r) => r.onTime).length, rows.length),
    inFull: pct(rows.filter((r) => r.inFull).length, rows.length),
    otif: pct(rows.filter((r) => r.onTime && r.inFull).length, rows.length),
  };
}

export function otifByMonth(rows: DeliveryRow[]) {
  const by = new Map<string, DeliveryRow[]>();
  for (const r of rows) by.set(r.month, [...(by.get(r.month) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({ month, ...otif(list) }));
}

/** Skor pemasok 0–100: rata-rata tepat waktu, tepat jumlah, dan lolos mutu (yang tersedia). */
export function supplierScore(s: { onTime: number | null; inFull: number | null; qcPass: number | null }) {
  const parts = [s.onTime, s.inFull, s.qcPass].filter((x): x is number => x !== null);
  return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10 : null;
}

export const STOCK_AGE_BUCKETS = [
  { key: "0-30", max: 30, label: ["0–30 hari", "0–30 days"] },
  { key: "31-90", max: 90, label: ["31–90 hari", "31–90 days"] },
  { key: "91-180", max: 180, label: ["91–180 hari", "91–180 days"] },
  { key: "181-365", max: 365, label: ["181–365 hari", "181–365 days"] },
  { key: "365+", max: Infinity, label: ["> 1 tahun", "> 1 year"] },
] as const satisfies readonly { key: string; max: number; label: [string, string] }[];

export function stockAgeBucket(days: number) {
  return STOCK_AGE_BUCKETS.find((b) => days <= b.max)!.key;
}

/** Umur persediaan per kelompok dari lapisan valuasi yang masih bersisa (tanggal masuk → hari ini). */
export function stockAging(layers: { ageDays: number; quantity: number; value: number }[]) {
  const totals = new Map<string, { quantity: number; value: number; layers: number }>();
  for (const l of layers) {
    const k = stockAgeBucket(Math.max(0, l.ageDays));
    const t = totals.get(k) ?? { quantity: 0, value: 0, layers: 0 };
    t.quantity += l.quantity;
    t.value += l.value;
    t.layers++;
    totals.set(k, t);
  }
  const total = [...totals.values()].reduce((s, t) => s + t.value, 0);
  return STOCK_AGE_BUCKETS.map((b) => {
    const t = totals.get(b.key) ?? { quantity: 0, value: 0, layers: 0 };
    return {
      key: b.key,
      label: b.label,
      quantity: Math.round(t.quantity * 10000) / 10000,
      value: Math.round(t.value * 100) / 100,
      share: pct(t.value, total),
    };
  });
}
