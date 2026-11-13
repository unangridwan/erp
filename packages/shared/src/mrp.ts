import { Decimal } from "decimal.js";
import { z } from "zod";
import { reorderQuantity } from "./inventory.js";
import { explodeBom, type BomIndex } from "./manufacturing.js";

export const mrpRunSchema = z.object({
  warehouseId: z.string().uuid().nullish(),
  /** Permintaan bertanggal sampai tanggal ini; bawaan 30 hari ke depan. */
  horizonDate: z.string().date().optional(),
});
export const mrpConfirmSchema = z.object({
  proposalIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu usulan"),
});

export interface MrpItem {
  productId: string;
  /** Stok di gudang + pasokan terbuka (penerimaan PO, RFQ, hasil order produksi). */
  onHand: Decimal.Value;
  supply: Decimal.Value;
  /** Aturan pemesanan ulang (stok minimum → isi sampai maksimum). */
  rule?: { minQty: Decimal.Value; maxQty: Decimal.Value; qtyMultiple: Decimal.Value } | null;
  /** Lead time beli (hari) & pemasok utama untuk produk tanpa BOM. */
  supplierId?: string | null;
  purchaseLeadDays?: number;
  /** Lead time produksi (hari) untuk produk ber-BOM. */
  produceLeadDays?: number;
}

export interface MrpDemand {
  productId: string;
  quantity: Decimal.Value;
  date: string;
  source: string;
}

export interface MrpProposal {
  productId: string;
  kind: "manufacture" | "purchase";
  level: number;
  demand: string;
  available: string;
  quantity: string;
  dateNeeded: string;
  dateStart: string;
  bomId: string | null;
  supplierId: string | null;
  reason: string;
}

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Rencana kebutuhan bahan: produk diproses per level BOM (produk jadi dulu, komponen setelah semua induknya), kebutuhan
 * bersih = permintaan − (stok + pasokan), ditambah pengisian stok minimum; produk ber-BOM menjadi usulan produksi yang
 * menurunkan kebutuhan komponennya (tanggal = tanggal mulai produksi), lainnya usulan pembelian.
 */
export function mrpPlan(input: {
  items: Map<string, MrpItem>;
  demands: MrpDemand[];
  boms: BomIndex;
  today: string;
}): MrpProposal[] {
  const { items, boms, today } = input;
  const demands = new Map<string, MrpDemand[]>();
  const add = (x: MrpDemand) => demands.set(x.productId, [...(demands.get(x.productId) ?? []), x]);
  input.demands.forEach(add);

  // Level terendah (low-level code): kedalaman maksimum produk di struktur BOM.
  const level = new Map<string, number>();
  const roots = new Set([
    ...input.demands.map((x) => x.productId),
    ...[...items.values()].filter((i) => i.rule).map((i) => i.productId),
  ]);
  for (const p of roots) level.set(p, 0);
  for (let round = 0; round < 50; round++) {
    let changed = false;
    for (const [p, lv] of [...level.entries()]) {
      const bom = boms.get(p);
      if (!bom || bom.bomType !== "normal") continue;
      for (const c of explodeBom(bom, bom.quantity, boms).components) {
        if ((level.get(c.productId) ?? -1) < lv + 1) {
          level.set(c.productId, lv + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const order = [...level.entries()].sort((a, b) => a[1] - b[1]);
  const out: MrpProposal[] = [];
  for (const [productId, lv] of order) {
    const item = items.get(productId) ?? { productId, onHand: 0, supply: 0 };
    const list = demands.get(productId) ?? [];
    const gross = list.reduce((s, x) => s.plus(d(x.quantity)), new Decimal(0));
    const available = d(item.onHand).plus(d(item.supply));
    const projected = available.minus(gross);
    const rule = item.rule ?? { minQty: 0, maxQty: 0, qtyMultiple: 1 };
    const qty = d(reorderQuantity({ forecast: projected, ...rule }));
    if (qty.lte(0)) continue;
    const dateNeeded = list.length ? list.map((x) => x.date).sort()[0]! : today;
    const bom = boms.get(productId);
    const manufacture = !!bom && bom.bomType === "normal";
    const lead = manufacture ? (item.produceLeadDays ?? 0) : (item.purchaseLeadDays ?? 0);
    let dateStart = shift(dateNeeded, lead);
    if (dateStart < today) dateStart = today;
    const sources = [...new Set(list.map((x) => x.source))];
    if (projected.gte(0) && item.rule) sources.push("stok minimum");
    out.push({
      productId,
      kind: manufacture ? "manufacture" : "purchase",
      level: lv,
      demand: gross.toFixed(4),
      available: available.toFixed(4),
      quantity: qty.toFixed(4),
      dateNeeded,
      dateStart,
      bomId: manufacture ? bom!.id : null,
      supplierId: manufacture ? null : (item.supplierId ?? null),
      reason: sources.join(", ").slice(0, 500),
    });
    if (manufacture)
      for (const c of explodeBom(bom!, qty, boms).components)
        add({ productId: c.productId, quantity: c.quantity, date: dateStart, source: `bahan ${productId}` });
  }
  return out;
}
