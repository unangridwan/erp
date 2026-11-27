import { Decimal } from "decimal.js";
import { z } from "zod";

/**
 * Kasbon (uang muka karyawan): diajukan & disetujui lewat mesin persetujuan, dicairkan ke akun Uang Muka Karyawan,
 * lalu dipertanggungjawabkan dengan klaim biaya. Selisih klaim melebihi kasbon dibayar ke karyawan; sisa kasbon
 * dikembalikan tunai atau dipotong di slip gaji berikutnya.
 */
export const ADVANCE_STATES = [
  "draft",
  "confirm",
  "approved",
  "refused",
  "paid",
  "settled",
  "cancel",
] as const;
export type AdvanceState = (typeof ADVANCE_STATES)[number];
export const ADVANCE_REMAINDER_METHODS = ["return", "payslip"] as const;

const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Jumlah tidak valid")
  .refine((v) => Number(v) > 0, "Harus lebih dari 0");

export const advanceSchema = z
  .object({
    /** Kosong = karyawan user yang login (portal). */
    employeeId: z.string().uuid().optional(),
    date: z.string().date(),
    purpose: z.string().trim().min(3).max(500),
    amount,
    /** Batas penyelesaian (pertanggungjawaban). */
    settleBy: z.string().date(),
  })
  .refine((v) => v.settleBy >= v.date, {
    path: ["settleBy"],
    message: "Batas penyelesaian tidak boleh sebelum tanggal kasbon",
  });
export type AdvanceInput = z.infer<typeof advanceSchema>;

export const advanceDisburseSchema = z.object({ journalId: z.string().uuid(), date: z.string().date() });

export const advanceSettleSchema = z.object({
  date: z.string().date(),
  /** Kas/bank untuk selisih (dibayar ke karyawan atau sisa dikembalikan tunai). */
  journalId: z.string().uuid().nullish(),
  remainderMethod: z.enum(ADVANCE_REMAINDER_METHODS).default("return"),
});

/**
 * Hitungan penyelesaian kasbon: bagian klaim yang menutup kasbon, selisih yang dibayar ke karyawan (klaim > kasbon),
 * dan sisa kasbon yang harus dikembalikan / dipotong gaji (klaim < kasbon).
 */
export function advanceSettlement(advance: Decimal.Value, claims: Decimal.Value) {
  const a = new Decimal(advance);
  const c = new Decimal(claims);
  return {
    used: Decimal.min(a, c).toFixed(2),
    payOut: Decimal.max(c.minus(a), 0).toFixed(2),
    remainder: Decimal.max(a.minus(c), 0).toFixed(2),
  };
}
