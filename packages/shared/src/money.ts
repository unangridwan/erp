import { Decimal } from "decimal.js";

/** Kurs: nilai 1 unit mata uang dalam mata uang dasar (IDR). Mata uang dasar sendiri bernilai 1. */
export const BASE_CURRENCY = "IDR";

/**
 * Konversi `amount` dari `fromRate` ke `toRate` (keduanya relatif terhadap IDR), dibulatkan ke
 * `decimals` digit dengan pembulatan half-up. Hasil berupa string agar tidak kehilangan presisi.
 */
export function convertAmount(
  amount: Decimal.Value,
  fromRate: Decimal.Value,
  toRate: Decimal.Value,
  decimals: number,
) {
  return new Decimal(amount)
    .times(fromRate)
    .div(toRate)
    .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
    .toFixed(decimals);
}
