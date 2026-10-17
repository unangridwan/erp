import { Decimal } from "decimal.js";

const d = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const unit = (v: Decimal) => v.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

/**
 * Biaya rata-rata tertimbang setelah barang masuk. Bila stok lama nol/negatif, biaya baru = biaya masuk.
 */
export function averageAfterIn(
  onHandQty: Decimal.Value,
  averageCost: Decimal.Value,
  inQty: Decimal.Value,
  inUnitCost: Decimal.Value,
): string {
  const qty = d(onHandQty);
  const incoming = d(inQty);
  if (qty.lte(0) || qty.plus(incoming).lte(0)) return unit(d(inUnitCost)).toFixed(4);
  const value = qty.times(averageCost).plus(incoming.times(inUnitCost));
  return unit(value.div(qty.plus(incoming))).toFixed(4);
}

export interface FifoLayer {
  id: string;
  remainingQty: Decimal.Value;
  remainingValue: Decimal.Value;
}

/**
 * Ambil `qty` dari lapisan masuk tertua (FIFO). Nilai yang diambil sebanding sisa nilai lapisan;
 * mengambil seluruh sisa lapisan memakai sisa nilainya persis agar tidak ada selisih pembulatan tertinggal.
 */
export function fifoConsume(
  layers: FifoLayer[],
  qty: Decimal.Value,
): { takes: { id: string; qty: string; value: string }[]; value: string; shortfall: string } {
  let need = d(qty);
  let total = d(0);
  const takes: { id: string; qty: string; value: string }[] = [];
  for (const layer of layers) {
    if (need.lte(0)) break;
    const remaining = d(layer.remainingQty);
    if (remaining.lte(0)) continue;
    const take = Decimal.min(need, remaining);
    const value = take.eq(remaining)
      ? d(layer.remainingValue)
      : money(d(layer.remainingValue).times(take).div(remaining));
    takes.push({ id: layer.id, qty: take.toFixed(4), value: value.toFixed(2) });
    total = total.plus(value);
    need = need.minus(take);
  }
  return { takes, value: total.toFixed(2), shortfall: Decimal.max(need, 0).toFixed(4) };
}

/**
 * Kuantitas yang perlu dipesan menurut aturan min/max: bila perkiraan stok di bawah minimum,
 * pesan hingga maksimum (dibulatkan ke atas ke kelipatan pesanan).
 */
export function reorderQuantity(rule: {
  forecast: Decimal.Value;
  minQty: Decimal.Value;
  maxQty: Decimal.Value;
  qtyMultiple: Decimal.Value;
}): string {
  const forecast = d(rule.forecast);
  if (forecast.gte(rule.minQty)) return "0.0000";
  const target = Decimal.max(rule.maxQty, rule.minQty);
  const needed = target.minus(forecast);
  if (needed.lte(0)) return "0.0000";
  const multiple = d(rule.qtyMultiple).gt(0) ? d(rule.qtyMultiple) : d(1);
  return needed.div(multiple).ceil().times(multiple).toFixed(4);
}

export interface SupplierPrice {
  id: string;
  partnerId: string;
  minQty: Decimal.Value;
  price: Decimal.Value;
  currencyCode: string;
  sequence: number;
  delayDays: number;
}

/**
 * Harga pemasok yang berlaku untuk kuantitas tertentu: pemasok yang diminta (atau pemasok utama bila
 * tidak ditentukan), minimum kuantitas tertinggi yang terpenuhi, lalu urutan terkecil.
 */
export function pickSupplier(
  suppliers: SupplierPrice[],
  quantity: Decimal.Value,
  partnerId?: string,
): SupplierPrice | undefined {
  const qty = d(quantity);
  const candidates = suppliers
    .filter((s) => (!partnerId || s.partnerId === partnerId) && qty.gte(s.minQty))
    .sort((a, b) => a.sequence - b.sequence || d(b.minQty).comparedTo(a.minQty));
  if (partnerId)
    return candidates.sort((a, b) => d(b.minQty).comparedTo(a.minQty) || a.sequence - b.sequence)[0];
  return candidates[0];
}
