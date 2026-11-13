import { Decimal } from "decimal.js";
import { z } from "zod";

export const PURCHASE_CONTRACT_STATE_LABEL: Record<string, [string, string]> = {
  draft: ["Draft", "Draft"],
  in_approval: ["Menunggu persetujuan", "In approval"],
  active: ["Aktif", "Active"],
  expired: ["Berakhir", "Expired"],
  closed: ["Ditutup", "Closed"],
  cancel: ["Dibatalkan", "Cancelled"],
  refused: ["Ditolak", "Refused"],
};

const num = (scale: number, positive: boolean) =>
  z
    .union([z.number(), z.string().trim()])
    .transform(String)
    .refine(
      (v) => new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(v) && (positive ? Number(v) > 0 : Number(v) >= 0),
      positive ? "Harus lebih dari 0" : "Tidak boleh negatif",
    );

export const purchaseContractSchema = z
  .object({
    partnerId: z.string().uuid(),
    partnerRef: z.string().trim().max(100).nullish(),
    dateStart: z.string().date(),
    dateEnd: z.string().date(),
    currencyCode: z.string().length(3).toUpperCase().optional(),
    paymentTermId: z.string().uuid().nullish(),
    /** Plafon nilai (sebelum pajak); kosong = tanpa plafon. */
    valueLimit: num(2, true)
      .nullish()
      .or(z.literal("").transform(() => null)),
    note: z.string().max(2000).nullish(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          name: z.string().trim().max(500).optional(),
          quantity: num(4, true),
          uomId: z.string().uuid().nullish(),
          priceUnit: num(4, false),
          discount: num(4, false)
            .refine((v) => Number(v) <= 100, "Diskon maksimal 100%")
            .default("0"),
          taxIds: z.array(z.string().uuid()).optional(),
          minOrderQty: num(4, true)
            .nullish()
            .or(z.literal("").transform(() => null)),
        }),
      )
      .min(1, "Minimal satu produk"),
  })
  .superRefine((v, ctx) => {
    if (v.dateEnd < v.dateStart)
      ctx.addIssue({ code: "custom", path: ["dateEnd"], message: "Tanggal berakhir sebelum tanggal mulai" });
    const seen = new Set<string>();
    v.lines.forEach((l, i) => {
      if (seen.has(l.productId))
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "productId"],
          message: "Produk ganda dalam kontrak",
        });
      seen.add(l.productId);
    });
  });
export type PurchaseContractInput = z.infer<typeof purchaseContractSchema>;

export const contractOrderSchema = z.object({
  dateOrder: z.string().date().optional(),
  warehouseId: z.string().uuid().nullish(),
  lines: z
    .array(z.object({ contractLineId: z.string().uuid(), quantity: num(4, true) }))
    .min(1, "Pilih minimal satu baris"),
});

export interface ContractLineInfo {
  id: string;
  productId: string;
  name: string;
  /** Komitmen dalam satuan baris kontrak. */
  quantity: string;
  uomRatio: string;
  priceUnit: string;
  discount: string;
  minOrderQty?: string | null;
}

/** Baris PO yang merujuk baris kontrak (kuantitas dalam satuan baris PO). */
export interface ContractOrderLine {
  contractLineId: string;
  quantity: string;
  uomRatio: string;
  priceSubtotal: string;
}

export interface ContractLineUsage {
  id: string;
  /** Dalam satuan baris kontrak. */
  committed: string;
  ordered: string;
  remaining: string;
  pct: number;
}

const d = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** Realisasi per baris kontrak: kuantitas dikonversi lewat satuan produk (rasio PO ÷ rasio kontrak). */
export function contractUsage(lines: ContractLineInfo[], orderLines: ContractOrderLine[]) {
  const out: ContractLineUsage[] = lines.map((l) => {
    const ordered = orderLines
      .filter((o) => o.contractLineId === l.id)
      .reduce((s, o) => s.plus(d(o.quantity).times(d(o.uomRatio || 1))), new Decimal(0))
      .div(d(l.uomRatio || 1));
    const committed = d(l.quantity);
    return {
      id: l.id,
      committed: committed.toFixed(4),
      ordered: ordered.toDecimalPlaces(4).toFixed(4),
      remaining: committed.minus(ordered).toDecimalPlaces(4).toFixed(4),
      pct: committed.isZero() ? 0 : ordered.div(committed).times(100).toDecimalPlaces(1).toNumber(),
    };
  });
  const value = orderLines.reduce((s, o) => s.plus(d(o.priceSubtotal)), new Decimal(0));
  return { lines: out, value: value.toFixed(2) };
}

/** Nilai komitmen kontrak (Σ kuantitas × harga setelah diskon, sebelum pajak). */
export function contractCommitmentValue(
  lines: Pick<ContractLineInfo, "quantity" | "priceUnit" | "discount">[],
) {
  return lines
    .reduce(
      (s, l) =>
        s.plus(
          d(l.quantity)
            .times(l.priceUnit)
            .times(d(100).minus(d(l.discount)))
            .div(100),
        ),
      new Decimal(0),
    )
    .toFixed(2);
}

export interface ContractCheckInput {
  contract: {
    name: string;
    state: string;
    dateStart: string;
    dateEnd: string;
    valueLimit: string | null;
  };
  lines: ContractLineInfo[];
  /** Baris PO lain yang sudah terkonfirmasi/menunggu persetujuan. */
  otherOrders: ContractOrderLine[];
  /** Baris PO yang sedang diperiksa. */
  order: ContractOrderLine[];
  /** Tanggal PO. */
  date: string;
}

/** Peringatan PO terhadap kontrak; daftar kosong = sesuai kontrak. */
export function contractWarnings(input: ContractCheckInput): string[] {
  const { contract } = input;
  const out: string[] = [];
  if (contract.state !== "active" && contract.state !== "expired")
    out.push(`Kontrak ${contract.name} tidak aktif`);
  if (input.date < contract.dateStart)
    out.push(`Kontrak ${contract.name} baru berlaku ${contract.dateStart}`);
  if (input.date > contract.dateEnd) out.push(`Kontrak ${contract.name} berakhir ${contract.dateEnd}`);
  const all = [...input.otherOrders, ...input.order];
  const usage = contractUsage(input.lines, all);
  for (const u of usage.lines) {
    const line = input.lines.find((l) => l.id === u.id)!;
    const inOrder = input.order.some((o) => o.contractLineId === u.id);
    if (!inOrder) continue;
    if (d(u.remaining).lt(0)) {
      const mine = own(input, line);
      const available = Decimal.max(d(u.committed).minus(d(u.ordered).minus(mine)), 0);
      out.push(
        `${line.name}: dipesan ${mine.toDecimalPlaces(4).toString()}, sisa kontrak ${available.toDecimalPlaces(4).toString()}`,
      );
    }
    if (line.minOrderQty && own(input, line).lt(line.minOrderQty))
      out.push(`${line.name}: di bawah minimal pesan ${d(line.minOrderQty).toString()}`);
  }
  if (contract.valueLimit && d(usage.value).gt(contract.valueLimit))
    out.push(
      `Nilai pesanan kontrak ${contract.name} (${d(usage.value).toFixed(2)}) melebihi plafon ${d(contract.valueLimit).toFixed(2)}`,
    );
  return out;
}

/** Kuantitas baris kontrak di PO yang sedang diperiksa (satuan baris kontrak). */
function own(input: ContractCheckInput, line: ContractLineInfo) {
  return input.order
    .filter((o) => o.contractLineId === line.id)
    .reduce((s, o) => s.plus(d(o.quantity).times(d(o.uomRatio || 1))), new Decimal(0))
    .div(d(line.uomRatio || 1));
}

/** Kontrak aktif yang sudah lewat tanggal berakhir ditampilkan sebagai "expired". */
export function contractDisplayState(state: string, dateEnd: string, today: string) {
  return state === "active" && dateEnd < today ? "expired" : state;
}
