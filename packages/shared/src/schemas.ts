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
  paymentTermId: optionalUuid,
  pricelistId: optionalUuid,
  salespersonId: optionalUuid,
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
  tracking: z.enum(["none", "lot", "serial"]).default("none"),
  costMethod: z.enum(["average", "fifo"]).default("average"),
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
  purchaseApprovalAmount: z
    .union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/)])
    .transform(String)
    .nullish(),
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

// ---- Akuntansi lanjutan ----

export const assetSchema = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).nullish(),
  name: z.string().trim().min(1).max(200),
  method: z.enum(["straight_line", "declining_balance"]).default("straight_line"),
  acquisitionDate: z.string().date(),
  firstDepreciationDate: z.string().date(),
  cost: nonNegative(2).refine((v) => Number(v) > 0, "Harga perolehan harus lebih dari 0"),
  salvageValue: nonNegative(2).default("0"),
  usefulLifeMonths: z.coerce.number().int().min(1).max(1200),
  assetAccountId: z.string().uuid(),
  depreciationAccountId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  journalId: z.string().uuid().optional(),
  branchId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
});

export const depreciateSchema = z.object({ date: z.string().date() });
export const closeYearSchema = z.object({ fiscalYear: z.coerce.number().int().min(2000).max(2100) });

export const budgetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        amount: decimalString(2),
        businessUnitId: z.string().uuid().nullish(),
        branchId: z.string().uuid().nullish(),
      }),
    )
    .default([]),
});

export const statementImportSchema = z.object({
  journalId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(10_000_000),
  balanceStart: decimalString(2).nullish(),
  balanceEnd: decimalString(2).nullish(),
  mapping: z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.string().optional(),
    debit: z.string().optional(),
    credit: z.string().optional(),
    partner: z.string().optional(),
    dateFormat: z
      .enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD-MM-YYYY", "DD/MM/YY"])
      .default("DD/MM/YYYY"),
    decimal: z.enum([",", "."]).default(","),
    outflow: z.enum(["debit", "credit"]).default("debit"),
  }),
});

/**
 * Rekonsiliasi satu baris mutasi: lunasi baris piutang/utang terbuka (`moveLineIds`), sisanya
 * (mis. biaya bank) dibukukan ke `accountId`.
 */
export const statementReconcileSchema = z.object({
  partnerId: z.string().uuid().nullish(),
  moveLineIds: z.array(z.string().uuid()).default([]),
  accountId: z.string().uuid().nullish(),
  label: z.string().trim().max(500).nullish(),
});

// ---- CRM & penjualan ----

export const LEAD_SOURCE_VALUES = [
  "website",
  "referral",
  "event",
  "ads",
  "social",
  "cold_call",
  "other",
] as const;

export const crmStageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sequence: z.coerce.number().int().default(10),
  probability: z.coerce.number().min(0).max(100).default(10).transform(String),
  isWon: z.boolean().default(false),
  fold: z.boolean().default(false),
});

export const lostReasonSchema = z.object({
  name: z.string().trim().min(1).max(200),
  active: z.boolean().default(true),
});

export const salesTeamSchema = z.object({
  companyId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(100),
  leaderId: z.string().uuid().nullish(),
  memberIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
});

export const paymentTermSchema = z.object({
  name: z.string().trim().min(1).max(100),
  days: z.coerce.number().int().min(0).max(3650),
  active: z.boolean().default(true),
});

export const pricelistSchema = z.object({
  companyId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(100),
  currencyCode: z.string().length(3).toUpperCase().default("IDR"),
  active: z.boolean().default(true),
  items: z
    .array(
      z
        .object({
          productId: z.string().uuid().nullish(),
          categoryId: z.string().uuid().nullish(),
          minQuantity: nonNegative(4).default("0"),
          compute: z.enum(["fixed", "discount"]).default("discount"),
          fixedPrice: nonNegative(4).nullish(),
          discount: decimalString(4).default("0"),
          dateStart: z.string().date().nullish(),
          dateEnd: z.string().date().nullish(),
        })
        .refine((i) => !(i.productId && i.categoryId), "Pilih produk atau kategori, bukan keduanya")
        .refine((i) => i.compute !== "fixed" || i.fixedPrice != null, "Harga tetap wajib diisi"),
    )
    .default([]),
});

export const leadSchema = z.object({
  leadType: z.enum(["lead", "opportunity"]).default("opportunity"),
  name: z.string().trim().min(1).max(200),
  partnerId: z.string().uuid().nullish(),
  contactName: z.string().trim().max(200).nullish(),
  partnerName: z.string().trim().max(200).nullish(),
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(50).nullish(),
  source: z.enum(LEAD_SOURCE_VALUES).nullish(),
  stageId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  expectedRevenue: nonNegative(2).default("0"),
  probability: z.coerce.number().min(0).max(100).transform(String).optional(),
  expectedClose: z.string().date().nullish(),
  priority: z.coerce.number().int().min(0).max(3).default(0),
  description: z.string().max(5000).nullish(),
  branchId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
});

export const markLostSchema = z.object({
  lostReasonId: z.string().uuid().nullish(),
  lostNote: z.string().trim().max(2000).nullish(),
});

/** Konversi lead → peluang: pakai partner yang ada, buat partner baru dari data lead, atau tanpa partner. */
export const convertLeadSchema = z.object({
  partner: z.enum(["existing", "create", "none"]).default("create"),
  partnerId: z.string().uuid().nullish(),
});

export const activitySchema = z.object({
  resModel: z.enum(["crm_lead", "sale_order", "partner"]),
  resId: z.string().uuid(),
  activityType: z.enum(["call", "meeting", "email", "todo"]).default("todo"),
  summary: z.string().trim().min(1).max(200),
  note: z.string().max(2000).nullish(),
  dueDate: z.string().date(),
  userId: z.string().uuid().optional(),
});

export const saleOrderSchema = z.object({
  partnerId: z.string().uuid(),
  dateOrder: z.string().date(),
  validityDate: z.string().date().nullish(),
  paymentTermId: z.string().uuid().nullish(),
  pricelistId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  clientOrderRef: z.string().trim().max(100).nullish(),
  note: z.string().max(5000).nullish(),
  branchId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        productId: z.string().uuid().nullish(),
        name: z.string().trim().max(500).optional(),
        quantity: nonNegative(4).default("1"),
        /** Kosong = ambil dari daftar harga / harga jual produk. */
        priceUnit: decimalString(4).nullish(),
        discount: nonNegative(4).default("0"),
        taxIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1, "Minimal satu baris"),
});

/**
 * Faktur dari pesanan: `regular` = sisa kuantitas yang belum ditagih (uang muka yang sudah ditagih dipotong),
 * `percentage`/`fixed` = faktur uang muka (jumlah tetap sebelum pajak).
 */
const invoiceDate = { date: z.string().date().optional() };
export const createInvoiceFromOrderSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("regular"), ...invoiceDate }),
  z.object({ method: z.literal("percentage"), percentage: z.coerce.number().gt(0).max(100), ...invoiceDate }),
  z.object({
    method: z.literal("fixed"),
    amount: nonNegative(2).refine((v) => Number(v) > 0, "Harus lebih dari 0"),
    ...invoiceDate,
  }),
]);

// ---- Persediaan ----

export const warehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9-]+$/, "Huruf besar, angka, atau -"),
  name: z.string().trim().min(1).max(100),
  branchId: optionalUuid,
  active: z.boolean().default(true),
});

export const locationSchema = z.object({
  parentId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  usage: z.enum(["view", "internal"]).default("internal"),
  active: z.boolean().default(true),
});

const qty = nonNegative(4);
const lotInput = z
  .object({
    lotId: z.string().uuid().optional(),
    /** Nama lot/serial baru (penerimaan). */
    lotName: z.string().trim().min(1).max(100).optional(),
    expirationDate: z.string().date().nullish(),
    quantity: qty.refine((v) => Number(v) > 0, "Harus lebih dari 0"),
  })
  .refine((l) => l.lotId || l.lotName, "Pilih atau isi nomor lot/serial");

export const pickingSchema = z.object({
  pickingType: z.enum(["incoming", "outgoing", "internal"]),
  warehouseId: z.string().uuid().optional(),
  partnerId: optionalUuid,
  locationId: z.string().uuid().optional(),
  locationDestId: z.string().uuid().optional(),
  scheduledDate: z.string().date(),
  origin: z.string().trim().max(200).nullish(),
  note: z.string().max(5000).nullish(),
  moves: z
    .array(
      z.object({
        productId: z.string().uuid(),
        name: z.string().trim().max(500).optional(),
        quantity: qty.refine((v) => Number(v) > 0, "Harus lebih dari 0"),
        /** Biaya per unit untuk penerimaan manual (kosong = biaya produk saat ini). */
        priceUnit: nonNegative(4).nullish(),
      }),
    )
    .min(1, "Minimal satu produk"),
});

export const validatePickingSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantityDone: qty,
        lots: z.array(lotInput).optional(),
      }),
    )
    .optional(),
  /** Sisa kuantitas yang belum dipindahkan dibuat sebagai transfer lanjutan (backorder). */
  createBackorder: z.boolean().default(true),
});

export const returnPickingSchema = z.object({
  lines: z
    .array(
      z.object({
        moveId: z.string().uuid(),
        quantity: qty.refine((v) => Number(v) > 0, "Harus lebih dari 0"),
      }),
    )
    .min(1),
});

export const stockAdjustmentSchema = z.object({
  locationId: z.string().uuid(),
  date: z.string().date().optional(),
  reason: z.string().trim().max(200).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        lotId: z.string().uuid().optional(),
        lotName: z.string().trim().min(1).max(100).optional(),
        countedQty: qty,
        /** Biaya per unit untuk kelebihan stok (kosong = biaya rata-rata/terakhir). */
        unitCost: nonNegative(4).nullish(),
      }),
    )
    .min(1),
});

export const reorderRuleSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  minQty: qty.default("0"),
  maxQty: qty.default("0"),
  qtyMultiple: qty.refine((v) => Number(v) > 0, "Harus lebih dari 0").default("1"),
  active: z.boolean().default(true),
});

// ---- Pembelian ----

export const productSupplierSchema = z.object({
  companyId: optionalUuid,
  partnerId: z.string().uuid(),
  productId: z.string().uuid(),
  productCode: optionalText,
  price: nonNegative(4),
  currencyCode: z.string().length(3).toUpperCase().default("IDR"),
  minQty: qty.default("0"),
  delayDays: z.coerce.number().int().min(0).max(365).default(0),
  sequence: z.coerce.number().int().default(10),
});

export const purchaseOrderSchema = z.object({
  partnerId: z.string().uuid(),
  partnerRef: z.string().trim().max(100).nullish(),
  dateOrder: z.string().date(),
  datePlanned: z.string().date().nullish(),
  paymentTermId: z.string().uuid().nullish(),
  currencyCode: z.string().length(3).toUpperCase().optional(),
  userId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  note: z.string().max(5000).nullish(),
  branchId: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().nullish(),
        name: z.string().trim().max(500).optional(),
        quantity: qty.default("1"),
        /** Kosong = harga pemasok / biaya produk. */
        priceUnit: decimalString(4).nullish(),
        discount: nonNegative(4).default("0"),
        taxIds: z.array(z.string().uuid()).optional(),
        datePlanned: z.string().date().nullish(),
      }),
    )
    .min(1, "Minimal satu baris"),
});

export const billFromOrderSchema = z.object({ date: z.string().date().optional() });
