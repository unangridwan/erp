import { Decimal } from "decimal.js";
import { z } from "zod";
import { allocateAmount } from "./controlling.js";

export const LANDED_COST_SPLIT_METHODS = ["value", "quantity", "weight", "volume", "equal"] as const;
export type LandedCostSplit = (typeof LANDED_COST_SPLIT_METHODS)[number];

export const LANDED_COST_SPLIT_LABEL: Record<LandedCostSplit, [string, string]> = {
  value: ["Nilai barang", "Product value"],
  quantity: ["Kuantitas", "Quantity"],
  weight: ["Berat", "Weight"],
  volume: ["Volume", "Volume"],
  equal: ["Rata per baris", "Equal per line"],
};

const money = z
  .union([z.number(), z.string().trim()])
  .transform(String)
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Jumlah harus lebih dari 0");

export const landedCostSchema = z.object({
  date: z.string().date(),
  pickingIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu penerimaan").max(100),
  vendorBillId: z.string().uuid().nullish(),
  note: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        accountId: z.string().uuid(),
        amount: money,
        splitMethod: z.enum(LANDED_COST_SPLIT_METHODS).default("value"),
      }),
    )
    .min(1, "Minimal satu baris biaya")
    .max(50),
});

export interface LandedMove {
  id: string;
  quantity: Decimal.Value;
  value: Decimal.Value;
  /** Berat & volume per satuan (null = belum diisi di produk). */
  weight: Decimal.Value | null;
  volume: Decimal.Value | null;
}

/** Dasar pembagian satu pergerakan menurut metode. */
export function landedBasis(move: LandedMove, method: LandedCostSplit): Decimal {
  const qty = new Decimal(move.quantity);
  switch (method) {
    case "value":
      return new Decimal(move.value);
    case "quantity":
      return qty;
    case "weight":
      return qty.times(move.weight ?? 0);
    case "volume":
      return qty.times(move.volume ?? 0);
    default:
      return new Decimal(1);
  }
}

/**
 * Bagi satu baris biaya ke pergerakan stok. Melempar galat bila total dasar nol (mis. berat produk belum diisi).
 * Pembagian memakai sisa terbesar sehingga jumlah tambahan = jumlah biaya.
 */
export function splitLandedCost(amount: Decimal.Value, moves: LandedMove[], method: LandedCostSplit) {
  const basis = moves.map((m) => landedBasis(m, method));
  const total = basis.reduce((s, b) => s.plus(b), new Decimal(0));
  if (total.lte(0))
    throw new Error(`Dasar pembagian "${LANDED_COST_SPLIT_LABEL[method][0]}" nol untuk barang ini`);
  const shares = allocateAmount(amount, basis);
  return moves.map((m, i) => ({ moveId: m.id, basis: basis[i]!, addition: new Decimal(shares[i]!) }));
}

/** Porsi tambahan untuk barang yang masih ada di gudang (sisanya ke HPP karena sudah keluar). */
export function splitStockVsSold(
  addition: Decimal.Value,
  receivedQty: Decimal.Value,
  remainingQty: Decimal.Value,
) {
  const add = new Decimal(addition);
  const received = new Decimal(receivedQty);
  if (received.lte(0)) return { stock: new Decimal(0), sold: add };
  const ratio = Decimal.min(new Decimal(remainingQty), received).div(received);
  const stock = add.times(ratio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { stock, sold: add.minus(stock) };
}
