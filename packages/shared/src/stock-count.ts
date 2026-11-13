import { Decimal } from "decimal.js";
import { z } from "zod";

export const STOCK_COUNT_STATE_LABEL: Record<string, [string, string]> = {
  draft: ["Draft", "Draft"],
  counting: ["Sedang dihitung", "Counting"],
  in_approval: ["Menunggu persetujuan", "In approval"],
  approved: ["Disetujui", "Approved"],
  done: ["Selesai", "Done"],
  cancel: ["Dibatalkan", "Cancelled"],
};

const qty = z
  .union([z.number(), z.string().trim()])
  .transform(String)
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), "Kuantitas tidak valid (maks. 4 desimal, tidak negatif)");

export const stockCountSchema = z.object({
  warehouseId: z.string().uuid(),
  /** Kosong = lokasi stok gudang. */
  locationId: z.string().uuid().nullish(),
  /** Kosong = opname penuh; diisi = cycle count kategori itu (beserta subkategori). */
  categoryId: z.string().uuid().nullish(),
  date: z.string().date(),
  note: z.string().max(1000).nullish(),
});

export const stockCountLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        /** null = belum dihitung. */
        countedQty: qty.nullable(),
        note: z.string().max(300).nullish(),
      }),
    )
    .max(5000),
});

export const stockCountAddLineSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid().nullish(),
  lotName: z.string().trim().min(1).max(100).nullish(),
  countedQty: qty,
});

export const stockCountScanSchema = z.object({
  code: z.string().trim().min(1).max(100),
  locationId: z.string().uuid().nullish(),
  /** Ditambahkan ke hitungan (bawaan 1). */
  quantity: qty.default("1"),
});

export const stockCountSubmitSchema = z.object({
  /** Baris yang belum dihitung dianggap 0 (bawaan: ditolak bila masih ada yang belum dihitung). */
  uncountedAsZero: z.boolean().default(false),
});

export interface CountLine {
  systemQty: string;
  countedQty: string | null;
  unitCost: string;
}

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** Selisih per baris (hitung − sistem) dan nilainya; baris belum dihitung tidak berselisih. */
export function lineVariance(line: CountLine) {
  if (line.countedQty == null) return { qty: "0.0000", value: "0.00", counted: false };
  const diff = d(line.countedQty).minus(line.systemQty);
  return {
    qty: diff.toFixed(4),
    value: diff.times(line.unitCost).toDecimalPlaces(2).toFixed(2),
    counted: true,
  };
}

/** Ringkasan sesi: jumlah baris, sudah dihitung, berselisih, nilai lebih/kurang, dan nilai absolut (dasar persetujuan). */
export function countSummary(lines: CountLine[]) {
  let counted = 0;
  let withVariance = 0;
  let gain = new Decimal(0);
  let loss = new Decimal(0);
  for (const l of lines) {
    const v = lineVariance(l);
    if (!v.counted) continue;
    counted++;
    if (!d(v.qty).isZero()) withVariance++;
    const value = d(v.value);
    if (value.gt(0)) gain = gain.plus(value);
    else loss = loss.plus(value.abs());
  }
  return {
    lines: lines.length,
    counted,
    uncounted: lines.length - counted,
    withVariance,
    gainValue: gain.toFixed(2),
    lossValue: loss.toFixed(2),
    netValue: gain.minus(loss).toFixed(2),
    absValue: gain.plus(loss).toFixed(2),
  };
}

/** Kolom berkas impor lembar hitung (Excel/CSV). */
export const COUNT_SHEET_COLUMNS = [
  "Baris",
  "SKU",
  "Barcode",
  "Produk",
  "Lokasi",
  "Lot/Serial",
  "Sistem",
  "Hitung",
];

/** Kunci baris impor: id baris (kolom "Baris") atau kombinasi SKU/barcode + lot. */
export function parseCountSheetRow(row: Record<string, string>) {
  const get = (k: string) => (row[k] ?? row[k.toLowerCase()] ?? "").trim();
  const counted = get("Hitung").replace(",", ".");
  return {
    lineId: get("Baris") || null,
    code: get("SKU") || get("Barcode") || null,
    lotName: get("Lot/Serial") || null,
    location: get("Lokasi") || null,
    countedQty: counted === "" ? null : counted,
  };
}
