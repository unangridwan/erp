import { Decimal } from "decimal.js";
import { z } from "zod";

export const PRODUCTION_STATE_LABEL: Record<string, [string, string]> = {
  draft: ["Draft", "Draft"],
  confirmed: ["Dikonfirmasi", "Confirmed"],
  in_progress: ["Dikerjakan", "In progress"],
  done: ["Selesai", "Done"],
  cancel: ["Dibatalkan", "Cancelled"],
};
export const BOM_TYPE_LABEL: Record<string, [string, string]> = {
  normal: ["Produksi (order produksi)", "Manufacture (production order)"],
  phantom: ["Kit / phantom (langsung diurai)", "Kit / phantom (exploded)"],
};

const num = (scale: number, positive: boolean) =>
  z
    .union([z.number(), z.string().trim()])
    .transform(String)
    .refine(
      (v) => new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(v) && (positive ? Number(v) > 0 : Number(v) >= 0),
      positive ? "Harus lebih dari 0" : "Tidak boleh negatif",
    );

export const workCenterSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  costPerHour: num(2, false).default("0"),
  capacityHoursPerDay: num(2, true).default("8"),
  active: z.boolean().default(true),
});

export const bomSchema = z
  .object({
    productId: z.string().uuid(),
    code: z.string().trim().max(60).nullish(),
    quantity: num(4, true).default("1"),
    bomType: z.enum(["normal", "phantom"]).default("normal"),
    active: z.boolean().default(true),
    note: z.string().max(2000).nullish(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: num(4, true),
          uomId: z.string().uuid().nullish(),
        }),
      )
      .min(1, "Minimal satu komponen"),
    operations: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          workCenterId: z.string().uuid(),
          minutes: num(2, false),
        }),
      )
      .default([]),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if (l.productId === v.productId)
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "productId"],
          message: "Komponen sama dengan produk jadi",
        });
    });
  });
export type BomInput = z.infer<typeof bomSchema>;

export const productionOrderSchema = z.object({
  productId: z.string().uuid(),
  /** Kosong = BOM aktif produk (normal) pertama. */
  bomId: z.string().uuid().nullish(),
  quantity: num(4, true),
  warehouseId: z.string().uuid().nullish(),
  datePlanned: z.string().date(),
  origin: z.string().trim().max(200).nullish(),
  note: z.string().max(2000).nullish(),
});

export const productionOperationSchema = z.object({
  action: z.enum(["start", "finish", "set"]),
  /** Menit aktual (untuk "finish" opsional: kosong = dihitung dari waktu mulai–selesai). */
  actualMinutes: num(2, false).nullish(),
});

export const produceSchema = z.object({
  qtyProduced: num(4, true).optional(),
  /** Nomor lot (produk ber-lot) atau daftar nomor serial (produk ber-serial, satu per unit). */
  lotName: z.string().trim().min(1).max(100).nullish(),
  serialNames: z.array(z.string().trim().min(1).max(100)).optional(),
  components: z
    .array(
      z.object({
        id: z.string().uuid(),
        qtyConsumed: num(4, false),
        lots: z.array(z.object({ lotId: z.string().uuid(), quantity: num(4, true) })).optional(),
      }),
    )
    .optional(),
  date: z.string().date().optional(),
});

export interface BomNode {
  id: string;
  productId: string;
  /** Jumlah hasil per BOM (satuan produk). */
  quantity: string;
  bomType: "normal" | "phantom";
  /** Kuantitas komponen sudah dalam satuan produk komponen (quantity × uomRatio). */
  lines: { productId: string; quantity: string }[];
  operations?: { name: string; workCenterId: string; minutes: string }[];
}

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** BOM yang dipakai untuk produk (BOM aktif pertama). */
export type BomIndex = Map<string, BomNode>;

/**
 * Ledakan BOM untuk `qty` produk: komponen langsung; komponen yang punya BOM phantom diurai terus ke komponennya.
 * Komponen dengan BOM normal (sub-rakitan) berhenti di sini (dibuat lewat order produksi sendiri).
 */
export function explodeBom(bom: BomNode, qty: Decimal.Value, index: BomIndex) {
  const components = new Map<string, Decimal>();
  const operations: { name: string; workCenterId: string; minutes: Decimal }[] = [];
  const walk = (node: BomNode, factor: Decimal, path: string[]) => {
    if (path.includes(node.productId))
      throw new Error("BOM berputar (komponen memuat produk jadinya sendiri)");
    const ratio = factor.div(node.quantity);
    for (const op of node.operations ?? [])
      operations.push({ name: op.name, workCenterId: op.workCenterId, minutes: d(op.minutes).times(ratio) });
    for (const line of node.lines) {
      const need = d(line.quantity).times(ratio);
      const sub = index.get(line.productId);
      if (sub && sub.bomType === "phantom") walk(sub, need, [...path, node.productId]);
      else components.set(line.productId, (components.get(line.productId) ?? new Decimal(0)).plus(need));
    }
  };
  walk(bom, d(qty), []);
  return {
    components: [...components.entries()].map(([productId, quantity]) => ({
      productId,
      quantity: quantity.toDecimalPlaces(4, Decimal.ROUND_UP).toFixed(4),
    })),
    operations: operations.map((o) => ({ ...o, minutes: o.minutes.toDecimalPlaces(2).toFixed(2) })),
  };
}

/** Apakah memakai `componentIds` di BOM produk `productId` membuat siklus (lewat BOM apa pun). */
export function bomCycle(productId: string, componentIds: string[], index: Map<string, BomNode[]>) {
  const seen = new Set<string>();
  const stack = [...componentIds];
  while (stack.length) {
    const p = stack.pop()!;
    if (p === productId) return true;
    if (seen.has(p)) continue;
    seen.add(p);
    for (const bom of index.get(p) ?? []) stack.push(...bom.lines.map((l) => l.productId));
  }
  return false;
}

/** Biaya operasi: menit × tarif per jam. */
export const operationCost = (minutes: Decimal.Value, ratePerHour: Decimal.Value) =>
  d(minutes).times(ratePerHour).div(60).toDecimalPlaces(2).toFixed(2);

/** Estimasi biaya per unit dari ledakan BOM (biaya rata-rata komponen + operasi). */
export function bomCostEstimate(
  explosion: ReturnType<typeof explodeBom>,
  qty: Decimal.Value,
  costs: Map<string, Decimal.Value>,
  rates: Map<string, Decimal.Value>,
) {
  const material = explosion.components.reduce(
    (s, c) => s.plus(d(c.quantity).times(d(costs.get(c.productId)))),
    new Decimal(0),
  );
  const conversion = explosion.operations.reduce(
    (s, o) => s.plus(operationCost(o.minutes, d(rates.get(o.workCenterId)))),
    new Decimal(0),
  );
  const total = material.plus(conversion);
  return {
    material: material.toDecimalPlaces(2).toFixed(2),
    conversion: conversion.toDecimalPlaces(2).toFixed(2),
    total: total.toDecimalPlaces(2).toFixed(2),
    unit: d(qty).isZero() ? "0.0000" : total.div(qty).toDecimalPlaces(4).toFixed(4),
  };
}

/** Biaya per unit barang jadi = (bahan aktual + konversi) / kuantitas hasil. */
export function productionUnitCost(material: Decimal.Value, conversion: Decimal.Value, qty: Decimal.Value) {
  return d(qty).isZero() ? "0.0000" : d(material).plus(conversion).div(qty).toDecimalPlaces(4).toFixed(4);
}
