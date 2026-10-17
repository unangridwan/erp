import { z } from "zod";
import { CONSOLIDATION_METHODS, ENTITY_TYPES } from "./group.js";

const optionalText = z
  .string()
  .trim()
  .max(255)
  .nullish()
  .transform((v) => (v ? v : null));
const optionalUuid = z.string().uuid().nullish();
const money = z.union([z.number(), z.string().regex(/^-?\d+(\.\d{1,2})?$/)]).transform(String);
/** NPWP 16 digit (format baru) atau 15 digit (lama), tanda baca diabaikan. */
const npwp = z
  .string()
  .nullish()
  .transform((v) => (v ? v.replace(/[.\-\s]/g, "") : null))
  .refine((v) => v === null || /^\d{15,16}$/.test(v), "NPWP harus 15 atau 16 digit");

export const signupSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Slug 3-40 karakter: huruf kecil, angka, tanda hubung"),
  companyName: z.string().trim().min(2).max(200),
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});
export type SignupInput = z.infer<typeof signupSchema>;

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Kode 2FA harus 6 digit");

export const loginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  /** Kode TOTP, wajib bila user mengaktifkan 2FA. */
  code: totpCode.optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const totpCodeSchema = z.object({ code: totpCode });

export const inviteSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  roleIds: z.array(z.string().uuid()).default([]),
  companyIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu perusahaan"),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(200),
});

export const currencyRateSchema = z.object({
  currencyCode: z.string().trim().length(3).toUpperCase(),
  rateDate: z.string().date(),
  rate: z.coerce.number().positive().transform(String),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const companySchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  parentId: optionalUuid,
  entityType: z.enum(ENTITY_TYPES).default("subsidiary"),
  npwp,
  currencyCode: z.string().length(3).toUpperCase().default("IDR"),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  active: z.boolean().default(true),
});

export const ownershipSchema = z.object({
  parentCompanyId: z.string().uuid(),
  childCompanyId: z.string().uuid(),
  pct: z.coerce.number().gt(0).max(100).transform(String),
  method: z.enum(CONSOLIDATION_METHODS),
  validFrom: z.string().date(),
  validTo: z.string().date().nullish(),
});

export const businessUnitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  active: z.boolean().default(true),
});

export const branchSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  nitku: optionalText,
  active: z.boolean().default(true),
});

export const partnerSchema = z.object({
  companyId: optionalUuid,
  parentId: optionalUuid,
  kind: z.enum(["company", "person"]).default("company"),
  name: z.string().trim().min(1).max(200),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  npwp,
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: optionalText,
  street: optionalText,
  city: optionalText,
  province: optionalText,
  postalCode: optionalText,
  active: z.boolean().default(true),
});

export const productCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: optionalUuid,
});

export const uomSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  factor: z.coerce.number().positive().transform(String),
  isReference: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  companyId: optionalUuid,
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  productType: z.enum(["storable", "consumable", "service"]).default("storable"),
  categoryId: optionalUuid,
  uomId: z.string().uuid(),
  salePrice: money.default("0"),
  cost: money.default("0"),
  barcode: optionalText,
  active: z.boolean().default(true),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  roleIds: z.array(z.string().uuid()).default([]),
  companyIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu perusahaan"),
});

// ---- Akuntansi ----

const decimalString = (scale: number) =>
  z
    .union([z.number(), z.string().trim()])
    .transform(String)
    .refine(
      (v) => new RegExp(`^-?\\d+(\\.\\d{1,${scale}})?$`).test(v),
      `Angka tidak valid (maks. ${scale} desimal)`,
    );
const nonNegative = (scale: number) =>
  decimalString(scale).refine((v) => !v.startsWith("-"), "Tidak boleh negatif");
const dimensions = {
  partnerId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
};

export const ACCOUNT_TYPE_VALUES = [
  "asset_receivable",
  "asset_cash",
  "asset_current",
  "asset_non_current",
  "asset_fixed",
  "liability_payable",
  "liability_current",
  "liability_non_current",
  "equity",
  "equity_unaffected",
  "income",
  "income_other",
  "expense",
  "expense_direct_cost",
  "expense_depreciation",
  "expense_other",
] as const;

export const accountSchema = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPE_VALUES),
  reconcile: z.boolean().default(false),
  currencyCode: z.string().length(3).toUpperCase().nullish(),
  active: z.boolean().default(true),
});

export const journalSchema = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(10).toUpperCase(),
  name: z.string().trim().min(1).max(100),
  journalType: z.enum(["sale", "purchase", "bank", "cash", "general"]),
  defaultAccountId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
});

export const taxSchema = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  typeTaxUse: z.enum(["sale", "purchase"]),
  amount: decimalString(4),
  baseRatio: decimalString(10).default("1"),
  accountId: z.string().uuid(),
  active: z.boolean().default(true),
});

export const accountingSettingsSchema = z.object({
  lockDate: z.string().date().nullish(),
});

export const journalEntrySchema = z.object({
  journalId: z.string().uuid().optional(),
  date: z.string().date(),
  ref: z.string().trim().max(200).nullish(),
  narration: z.string().max(2000).nullish(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        name: z.string().trim().max(500).nullish(),
        debit: nonNegative(2).default("0"),
        credit: nonNegative(2).default("0"),
        ...dimensions,
      }),
    )
    .min(2, "Minimal dua baris"),
});

export const INVOICE_TYPES = ["out_invoice", "out_refund", "in_invoice", "in_refund"] as const;

export const invoiceSchema = z.object({
  moveType: z.enum(INVOICE_TYPES),
  journalId: z.string().uuid().optional(),
  partnerId: z.string().uuid(),
  date: z.string().date(),
  dueDate: z.string().date().nullish(),
  ref: z.string().trim().max(200).nullish(),
  narration: z.string().max(2000).nullish(),
  currencyCode: z.string().length(3).toUpperCase().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().nullish(),
        accountId: z.string().uuid().nullish(),
        name: z.string().trim().min(1).max(500),
        quantity: decimalString(4).default("1"),
        priceUnit: decimalString(4),
        discount: nonNegative(4).default("0"),
        taxIds: z.array(z.string().uuid()).default([]),
        businessUnitId: z.string().uuid().nullish(),
        branchId: z.string().uuid().nullish(),
      }),
    )
    .min(1, "Minimal satu baris"),
});

export const paymentSchema = z.object({
  paymentType: z.enum(["inbound", "outbound"]),
  partnerId: z.string().uuid(),
  journalId: z.string().uuid(),
  amount: nonNegative(2).refine((v) => Number(v) > 0, "Jumlah harus lebih dari 0"),
  date: z.string().date(),
  currencyCode: z.string().length(3).toUpperCase().optional(),
  memo: z.string().trim().max(500).nullish(),
  /** Faktur/tagihan yang dilunasi, berurutan. */
  moveIds: z.array(z.string().uuid()).default([]),
});

export const reconcileSchema = z.object({ lineIds: z.array(z.string().uuid()).min(2) });
