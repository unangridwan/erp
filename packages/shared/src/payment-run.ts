import { Decimal } from "decimal.js";
import { z } from "zod";

export const PARTNER_BANK_CODES = ["bca", "mandiri", "bri", "bni", "other"] as const;
export type PartnerBankCode = (typeof PARTNER_BANK_CODES)[number];

export const PARTNER_BANK_LABEL: Record<PartnerBankCode, string> = {
  bca: "BCA",
  mandiri: "Bank Mandiri",
  bri: "BRI",
  bni: "BNI",
  other: "Bank lain",
};

export const partnerBankAccountSchema = z.object({
  bankCode: z.enum(PARTNER_BANK_CODES).default("other"),
  bankName: z.string().trim().min(1).max(100),
  bankIdentifier: z.string().trim().max(20).nullish(),
  accountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s.-]/g, ""))
    .refine((v) => /^\d{5,34}$/.test(v), "Nomor rekening 5–34 digit angka"),
  accountHolder: z.string().trim().min(1).max(100),
  currencyCode: z.string().length(3).toUpperCase().default("IDR"),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const paymentRunCreateSchema = z.object({
  paymentDate: z.string().date(),
  dueUntil: z.string().date(),
  journalId: z.string().uuid(),
  partnerIds: z.array(z.string().uuid()).max(500).optional(),
  note: z.string().trim().max(500).nullish(),
});

export const paymentRunUpdateSchema = z.object({
  paymentDate: z.string().date().optional(),
  journalId: z.string().uuid().optional(),
  note: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        included: z.boolean().optional(),
        amount: z
          .union([z.number(), z.string().trim()])
          .transform(String)
          .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Jumlah harus lebih dari 0")
          .optional(),
        bankAccountId: z.string().uuid().nullish(),
      }),
    )
    .max(2000)
    .default([]),
});

export interface RunLine {
  id: string;
  partnerId: string;
  bankAccountId: string | null;
  moveId: string;
  amount: Decimal.Value;
  included: boolean;
}

/** Kelompokkan baris yang diikutkan per pemasok (satu pembayaran per pemasok per rekening). */
export function groupRunLines<T extends RunLine>(lines: T[]) {
  const groups = new Map<
    string,
    { partnerId: string; bankAccountId: string | null; lines: T[]; total: Decimal }
  >();
  for (const l of lines) {
    if (!l.included) continue;
    const key = `${l.partnerId}|${l.bankAccountId ?? ""}`;
    const g = groups.get(key) ?? {
      partnerId: l.partnerId,
      bankAccountId: l.bankAccountId,
      lines: [],
      total: new Decimal(0),
    };
    g.lines.push(l);
    g.total = g.total.plus(l.amount);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Jumlah usulan: sisa tagihan, tidak boleh melebihinya. */
export function lineAmountError(amount: Decimal.Value, residual: Decimal.Value): string | null {
  const a = new Decimal(amount);
  if (a.lte(0)) return "Jumlah harus lebih dari 0";
  if (a.gt(residual)) return `Jumlah melebihi sisa tagihan (${new Decimal(residual).toFixed(2)})`;
  return null;
}
