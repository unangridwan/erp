import { Decimal } from "decimal.js";

export type DepreciationMethod = "straight_line" | "declining_balance";

export interface DepreciationInput {
  cost: Decimal.Value;
  salvageValue?: Decimal.Value;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** Tanggal mulai penyusutan (YYYY-MM-DD); penyusutan dicatat di akhir setiap bulan mulai bulan ini. */
  firstDepreciationDate: string;
  decimals?: number;
}

export interface DepreciationLine {
  sequence: number;
  date: string;
  amount: string;
  accumulated: string;
  bookValue: string;
}

/** Tanggal akhir bulan ke-`offset` setelah bulan `start`. */
function monthEnd(start: string, offset: number): string {
  const [y, m] = start.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset + 1, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Jadwal penyusutan bulanan.
 * - Garis lurus: (harga perolehan − nilai sisa) / masa manfaat; pembulatan diserap bulan terakhir.
 * - Saldo menurun (UU PPh ps. 11): tarif tahunan = 2 / masa manfaat (tahun) atas nilai buku awal tiap tahun manfaat,
 *   dibagi rata per bulan; pada tahun manfaat terakhir sisa nilai buku disusutkan sekaligus secara merata.
 */
export function depreciationSchedule(input: DepreciationInput): DepreciationLine[] {
  const decimals = input.decimals ?? 2;
  const round = (v: Decimal) => v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const cost = new Decimal(input.cost);
  const salvage = new Decimal(input.salvageValue ?? 0);
  const months = input.usefulLifeMonths;
  if (!Number.isInteger(months) || months < 1) throw new Error("Masa manfaat minimal 1 bulan");
  if (salvage.gte(cost)) throw new Error("Nilai sisa harus lebih kecil dari harga perolehan");
  const base = cost.minus(salvage);

  const amounts: Decimal[] = [];
  if (input.method === "straight_line") {
    const monthly = round(base.div(months));
    for (let i = 0; i < months - 1; i++) amounts.push(monthly);
    amounts.push(base.minus(monthly.times(months - 1)));
  } else {
    const annualRate = new Decimal(24).div(months); // 2 / (months / 12)
    let book = cost;
    for (let start = 0; start < months; start += 12) {
      const periods = Math.min(12, months - start);
      const remaining = book.minus(salvage);
      const finalYear = start + 12 >= months;
      const yearly = finalYear ? remaining : Decimal.min(round(book.times(annualRate)), remaining);
      const monthly = round(yearly.div(periods));
      for (let p = 0; p < periods; p++)
        amounts.push(p === periods - 1 ? yearly.minus(monthly.times(periods - 1)) : monthly);
      book = book.minus(yearly);
    }
  }

  let accumulated = new Decimal(0);
  return amounts.map((amount, i) => {
    accumulated = accumulated.plus(amount);
    return {
      sequence: i + 1,
      date: monthEnd(input.firstDepreciationDate, i),
      amount: amount.toFixed(decimals),
      accumulated: accumulated.toFixed(decimals),
      bookValue: cost.minus(accumulated).toFixed(decimals),
    };
  });
}

/** Kelompok harta berwujud untuk penyusutan fiskal (PMK 72/2023), masa manfaat dalam tahun. */
export const TAX_ASSET_GROUPS = [
  { key: "kelompok1", years: 4 },
  { key: "kelompok2", years: 8 },
  { key: "kelompok3", years: 16 },
  { key: "kelompok4", years: 20 },
  { key: "bangunan_permanen", years: 20 },
  { key: "bangunan_non_permanen", years: 10 },
] as const;
