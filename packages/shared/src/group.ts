import { Decimal } from "decimal.js";

/** Jenis entitas dalam struktur grup (lihat docs/PLAN.md §3.10). */
export const ENTITY_TYPES = ["holding", "subsidiary", "associate", "joint_venture", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Metode konsolidasi per entitas (PSAK 65/66/15). */
export const CONSOLIDATION_METHODS = ["full", "proportional", "equity", "none"] as const;
export type ConsolidationMethod = (typeof CONSOLIDATION_METHODS)[number];

/** Satu relasi kepemilikan langsung: `parentId` memiliki `pct` (0–100) saham `childId`. */
export interface OwnershipLink {
  parentId: string;
  childId: string;
  pct: Decimal.Value;
}

/**
 * Kepemilikan efektif `holderId` atas `targetId`, menjumlahkan semua jalur langsung & tidak langsung.
 * Contoh: holding 80% A, A 60% B → holding efektif 48% atas B.
 * Hasil dalam persen (0–100). Siklus kepemilikan silang ditolak.
 */
export function effectiveOwnership(links: OwnershipLink[], holderId: string, targetId: string): Decimal {
  const byParent = new Map<string, OwnershipLink[]>();
  for (const link of links) {
    const list = byParent.get(link.parentId) ?? [];
    list.push(link);
    byParent.set(link.parentId, list);
  }

  const walk = (nodeId: string, visiting: Set<string>): Decimal => {
    if (nodeId === targetId) return new Decimal(100);
    if (visiting.has(nodeId)) throw new Error(`Siklus kepemilikan terdeteksi pada ${nodeId}`);
    visiting.add(nodeId);
    let total = new Decimal(0);
    for (const link of byParent.get(nodeId) ?? []) {
      total = total.plus(new Decimal(link.pct).div(100).times(walk(link.childId, visiting)));
    }
    visiting.delete(nodeId);
    return total;
  };

  return walk(holderId, new Set());
}

/** Metode konsolidasi default berdasarkan persentase kepemilikan efektif. */
export function defaultConsolidationMethod(pct: Decimal.Value): ConsolidationMethod {
  const p = new Decimal(pct);
  if (p.greaterThan(50)) return "full";
  if (p.greaterThanOrEqualTo(20)) return "equity";
  return "none";
}
