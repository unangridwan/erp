import { z } from "zod";
import { contractTypeCode } from "./contract-types.js";
import { isValidPlate, normalizePlate } from "./fleet.js";
import { ALL_PERMISSION_CODES } from "./rbac.js";
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

// ---- Portal pelanggan ----

export const portalLoginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** Undang kontak pelanggan ke portal (email bawaan dari partner). */
export const portalInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  name: z.string().trim().min(2).max(200).optional(),
});

export const currencyRateSchema = z.object({
  currencyCode: z.string().trim().length(3).toUpperCase(),
  rateDate: z.string().date(),
  rate: z.coerce.number().positive().transform(String),
});
export type LoginInput = z.infer<typeof loginSchema>;

const email = z
  .string()
  .trim()
  .email()
  .nullish()
  .or(z.literal("").transform(() => null));

/** NITKU/ID TKU 22 digit. */
const nitku = z
  .string()
  .nullish()
  .transform((v) => (v ? v.replace(/[.\-\s]/g, "") : null))
  .refine((v) => v === null || /^\d{22}$/.test(v), "ID TKU harus 22 digit (NPWP 16 digit + 6 digit)");

/** Profil perusahaan untuk faktur pajak & dokumen. */
const companyProfile = {
  pkp: z.boolean().default(false),
  nitku,
  street: optionalText,
  city: optionalText,
  province: optionalText,
  postalCode: optionalText,
  phone: optionalText,
  email,
};

export const companySchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(200),
  parentId: optionalUuid,
  entityType: z.enum(ENTITY_TYPES).default("subsidiary"),
  npwp,
  currencyCode: z.string().length(3).toUpperCase().default("IDR"),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  ...companyProfile,
  icAutoDocuments: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const ownershipSchema = z.object({
  parentCompanyId: z.string().uuid(),
  childCompanyId: z.string().uuid(),
  pct: z.coerce.number().gt(0).max(100).transform(String),
  method: z.enum(CONSOLIDATION_METHODS),
  validFrom: z.string().date(),
  validTo: z.string().date().nullish(),
  consideration: money.nullish(),
  acquiredNetAssets: money.nullish(),
  /** Akuisisi bertahap: nilai wajar kepemilikan sebelumnya saat pengendalian diperoleh (baris pengendalian). */
  previousInterestFairValue: money.nullish(),
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
  taxDocumentType: z.enum(["TIN", "National ID", "Passport", "Other ID"]).default("TIN"),
  taxDocumentNumber: optionalText,
  tku: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Kode tempat usaha 6 digit (000000 = pusat)")
    .default("000000"),
  countryCode: z.string().trim().length(3).toUpperCase().default("IDN"),
  taxTrxCode: z.enum(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]).default("04"),
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
  coretaxCode: z
    .string()
    .trim()
    .regex(/^UM\.\d{4}$/, "Kode satuan Coretax, mis. UM.0021")
    .nullish()
    .or(z.literal("").transform(() => null)),
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
  taxGoodsCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Kode barang/jasa Coretax 6 digit")
    .nullish()
    .or(z.literal("").transform(() => null)),
  /** Tarif PPnBM (%) untuk barang mewah; kosong = bukan barang kena PPnBM. */
  luxuryTaxRate: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce
      .number()
      .positive()
      .max(200)
      .transform((v) => v.toFixed(2))
      .nullable(),
  ),
  /** Satuan bawaan penjualan/pembelian (kosong = satuan produk). */
  saleUomId: optionalUuid,
  purchaseUomId: optionalUuid,
  dropship: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const productAttributeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sequence: z.coerce.number().int().min(0).max(10000).default(10),
  active: z.boolean().default(true),
});

export const productAttributeValueSchema = z.object({
  attributeId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  /** Kode pendek untuk SKU varian (kosong = dari nama). */
  code: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9]*$/, "Huruf/angka saja")
    .nullish()
    .or(z.literal("").transform(() => null)),
  sequence: z.coerce.number().int().min(0).max(10000).default(10),
  priceExtra: money.default("0"),
  active: z.boolean().default(true),
});

/** Buat varian dari kombinasi nilai atribut (satu daftar nilai per atribut). */
export const generateVariantsSchema = z.object({
  values: z.array(z.array(z.string().uuid()).min(1)).min(1, "Pilih minimal satu atribut"),
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
  branchClearing: z.boolean().default(false),
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
  taxKind: z.enum(["vat", "vat_luxury", "ppnbm", "pph23", "pph4_2", "pph22", "other"]).default("other"),
  taxObjectCode: z
    .string()
    .trim()
    .regex(/^\d{2}-\d{3}-\d{2}$/, "Kode objek pajak, mis. 24-104-14")
    .nullish()
    .or(z.literal("").transform(() => null)),
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
        uomId: z.string().uuid().nullish(),
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

export const assetDisposeSchema = z
  .object({
    date: z.string().date(),
    kind: z.enum(["sale", "scrap"]),
    partnerId: z.string().uuid().optional(),
    price: nonNegative(2).optional(),
    taxIds: z.array(z.string().uuid()).default([]),
    /** Penjualan ke perusahaan grup: buat draf aset di buku pembeli. */
    transferToGroup: z.boolean().default(true),
  })
  .refine((v) => v.kind === "scrap" || (v.partnerId && v.price !== undefined), {
    message: "Penjualan memerlukan pembeli dan harga jual",
    path: ["partnerId"],
  });

export const fxRevaluationSchema = z.object({ date: z.string().date() });
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

/** Aturan komisi penjual: `rate` persen dari penjualan bersih (DPP) per faktur; `paid` = hanya faktur lunas. */
export const commissionPlanSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rate: z.coerce.number().min(0).max(100).transform(String),
  basis: z.enum(["invoiced", "paid"]).default("invoiced"),
  /** Isi salah satu (penjual atau tim), atau kosongkan keduanya untuk aturan bawaan perusahaan. */
  userId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
});

export const commissionReportSchema = z.object({
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  userId: z.string().uuid().optional(),
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
        /** Kosong = satuan jual produk (atau satuan produk). */
        uomId: z.string().uuid().nullish(),
        /** Kosong = bawaan produk; dikirim langsung dari pemasok ke pelanggan. */
        dropship: z.boolean().optional(),
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
        /** Kosong = satuan beli produk (atau satuan produk). */
        uomId: z.string().uuid().nullish(),
      }),
    )
    .min(1, "Minimal satu baris"),
});

export const billFromOrderSchema = z.object({ date: z.string().date().optional() });

// ---- SDM & payroll ----

const digits = (len: number[], label: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[.\-\s]/g, ""))
    // Nilai tersamar ("••••1234") dari API berarti tidak diubah.
    .refine(
      (v) => v.startsWith("••••") || (len.includes(v.length) && /^\d+$/.test(v)),
      `${label} harus ${len.join(" atau ")} digit`,
    );

export const departmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: optionalUuid,
  managerId: optionalUuid,
  active: z.boolean().default(true),
});

export const jobPositionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Golongan upah (struktur & skala upah). */
  gradeId: optionalUuid,
  active: z.boolean().default(true),
});

/** Golongan upah; upah maksimum ≥ minimum diperiksa API (juga saat PATCH sebagian). */
export const salaryGradeSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  minWage: nonNegative(2),
  maxWage: nonNegative(2),
  sequence: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

export const PTKP_STATUS_VALUES = ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"] as const;

export const RELIGION_VALUES = [
  "islam",
  "protestant",
  "catholic",
  "hindu",
  "buddha",
  "confucian",
  "other",
] as const;
export const MARITAL_STATUS_VALUES = ["single", "married", "divorced", "widowed"] as const;

export const employeeSchema = z.object({
  employeeNumber: z.string().trim().max(30).nullish(),
  name: z.string().trim().min(1).max(200),
  departmentId: optionalUuid,
  jobId: optionalUuid,
  managerId: optionalUuid,
  userId: optionalUuid,
  workEmail: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  workPhone: optionalText,
  branchId: optionalUuid,
  businessUnitId: optionalUuid,
  nik: digits([16], "NIK")
    .nullish()
    .or(z.literal("").transform(() => null)),
  npwp: digits([15, 16], "NPWP")
    .nullish()
    .or(z.literal("").transform(() => null)),
  birthDate: z.string().date().nullish(),
  gender: z.enum(["male", "female"]).nullish(),
  ptkpStatus: z.enum(PTKP_STATUS_VALUES).default("TK/0"),
  bpjsKesNo: optionalText,
  bpjsKesEnrolled: z.boolean().default(true),
  bpjsKesDate: z.string().date().nullish(),
  bpjsKesClass: z.coerce.number().int().min(1).max(3).nullish(),
  bpjsKesFacility: optionalText,
  bpjsTkNo: optionalText,
  bpjsTkEnrolled: z.boolean().default(true),
  bpjsTkDate: z.string().date().nullish(),
  bpjsJpEnrolled: z.boolean().default(true),
  overtimeEligible: z.boolean().default(true),
  retirementAge: z.coerce
    .number()
    .int()
    .min(40, "Usia pensiun 40–80 tahun")
    .max(80, "Usia pensiun 40–80 tahun")
    .nullish(),
  bankName: optionalText,
  bankAccount: z
    .string()
    .trim()
    .max(50)
    .nullish()
    .or(z.literal("").transform(() => null)),
  bankAccountName: optionalText,
  joinDate: z.string().date(),
  resignDate: z.string().date().nullish(),
  address: z.string().trim().max(500).nullish(),
  emergencyContact: optionalText,
  emergencyPhone: optionalText,
  kkNo: digits([16], "No. KK")
    .nullish()
    .or(z.literal("").transform(() => null)),
  birthPlace: optionalText,
  religion: z.enum(RELIGION_VALUES).nullish(),
  maritalStatus: z.enum(MARITAL_STATUS_VALUES).nullish(),
  bloodType: z.enum(["A", "B", "AB", "O"]).nullish(),
  rhesus: z.enum(["+", "-"]).nullish(),
  nationality: z.string().trim().min(1).max(50).default("WNI"),
  heightCm: z.coerce.number().int().min(30).max(250).nullish(),
  weightKg: z.coerce.number().int().min(2).max(400).nullish(),
  personalEmail: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  personalPhone: optionalText,
  domicileAddress: z.string().trim().max(500).nullish(),
  gradeId: optionalUuid,
  /** Jadwal kerja bawaan (shift). */
  scheduleId: z.string().uuid().nullish(),
  workLocationId: z.string().uuid().nullish(),
  /** Kode kartu/badge untuk kiosk & mesin absensi. */
  badgeCode: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => (v ? v : null)),
  /** Tag bebas; duplikat & spasi dibuang. */
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(10, "Maksimal 10 tag")
    .default([])
    .transform((t) => [...new Set(t)]),
  active: z.boolean().default(true),
});

/** Undang karyawan ke portal: email kerja/pribadi karyawan bila tidak diisi. */
export const employeeInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  roleIds: z.array(z.string().uuid()).default([]),
});

export const salaryComponentSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, "Huruf besar, angka, atau _"),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["allowance", "deduction"]),
  /** Tunjangan tetap: ikut dasar upah BPJS & lembur. */
  fixed: z.boolean().default(false),
  /** Termasuk penghasilan bruto PPh 21. */
  taxable: z.boolean().default(true),
  accountId: optionalUuid,
  active: z.boolean().default(true),
  /** fixed_amount = nilai tetap; per_attendance_day = tarif × hari hadir; attendance_premium = premi kehadiran. */
  calc: z.enum(["fixed_amount", "per_attendance_day", "attendance_premium"]).default("fixed_amount"),
  /** Nilai bawaan (tarif per hari / premi) bila tidak diisi di kontrak. */
  rate: nonNegative(2).nullish(),
  /** Berlaku untuk semua karyawan dengan nilai bawaan tanpa ditambahkan ke kontrak. */
  autoAssign: z.boolean().default(false),
  /** Premi hilang bila terlambat lebih dari N kali / tidak hadir lebih dari N hari dalam periode. */
  premiumMaxLate: z.number().int().min(0).max(31).nullish(),
  premiumMaxAbsent: z.number().int().min(0).max(31).nullish(),
});

export const contractSchema = z
  .object({
    employeeId: z.string().uuid(),
    contractType: contractTypeCode.default("pkwtt"),
    /** monthly = gaji bulanan; daily = upah per hari; piece = tarif per satuan (borongan). */
    wageType: z.enum(["monthly", "daily", "piece"]).default("monthly"),
    /** gross = PPh 21 dipotong dari gaji; gross_up = ditanggung perusahaan (tunjangan PPh 21). */
    taxMethod: z.enum(["gross", "gross_up"]).default("gross"),
    dateStart: z.string().date(),
    dateEnd: z.string().date().nullish(),
    wage: nonNegative(2),
    note: z.string().max(2000).nullish(),
    allowances: z.array(z.object({ componentId: z.string().uuid(), amount: nonNegative(2) })).default([]),
  })
  .refine((c) => !c.dateEnd || c.dateEnd >= c.dateStart, {
    message: "Tanggal berakhir sebelum mulai",
    path: ["dateEnd"],
  });

export const holidaySchema = z.object({
  date: z.string().date(),
  name: z.string().trim().min(1).max(100),
  /** Kosong = berlaku untuk semua perusahaan. */
  companyId: z.string().uuid().nullish(),
  kind: z.enum(["national", "collective", "company"]).default("national"),
});

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  paid: z.boolean().default(true),
  requiresAllocation: z.boolean().default(true),
  active: z.boolean().default(true),
  code: optionalText,
  allowHalfDay: z.boolean().default(true),
  /** Maksimal hari berturut-turut per pengajuan (kosong = tanpa batas). */
  maxConsecutiveDays: nonNegative(2)
    .refine((v) => Number(v) > 0, "Harus lebih dari 0")
    .nullish(),
  allowNegative: z.boolean().default(false),
  negativeLimit: nonNegative(2).default("0"),
  requiresAttachment: z.boolean().default(false),
  countCalendarDays: z.boolean().default(false),
  employeeRequestable: z.boolean().default(true),
});

export const leaveAllocationSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  days: nonNegative(2),
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  note: optionalText,
});

export const leaveRequestSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid(),
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    reason: z.string().trim().max(1000).nullish(),
    /** Setengah hari pagi/siang (hanya cuti sehari). */
    halfDay: z.enum(["am", "pm"]).nullish(),
    /** Bukti (mis. surat dokter) PDF/JPG/PNG maks. 2 MB. */
    attachment: z
      .object({
        name: z.string().trim().min(1).max(200),
        type: z.enum(["application/pdf", "image/jpeg", "image/png"], {
          message: "Berkas harus PDF, JPG, atau PNG",
        }),
        data: z.string().regex(/^[A-Za-z0-9+/=\s]+$/, "Berkas tidak valid"),
      })
      .nullish(),
    /** Rekan yang menerima delegasi tugas selama cuti. */
    delegateEmployeeId: z.string().uuid().nullish(),
    delegateNote: z.string().trim().max(500).nullish(),
  })
  .refine((r) => r.dateTo >= r.dateFrom, { message: "Tanggal selesai sebelum mulai", path: ["dateTo"] })
  .refine((r) => !r.halfDay || r.dateFrom === r.dateTo, {
    message: "Setengah hari hanya untuk cuti satu hari",
    path: ["halfDay"],
  });

export const leaveAccrualPlanSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    frequency: z.enum(["monthly", "yearly"]).default("yearly"),
    daysPerPeriod: nonNegative(2).refine((v) => Number(v) > 0, "Harus lebih dari 0"),
    startAfterMonths: z.coerce.number().int().min(0).max(600).default(0),
    maxBalance: nonNegative(2)
      .refine((v) => Number(v) > 0, "Harus lebih dari 0")
      .nullish(),
    carryOver: z.enum(["none", "all", "limited"]).default("none"),
    carryOverMax: nonNegative(2).nullish(),
    carryOverExpiryMonths: z.coerce.number().int().min(1).max(12).nullish(),
    active: z.boolean().default(true),
  })
  .refine((p) => p.carryOver !== "limited" || (p.carryOverMax !== null && p.carryOverMax !== undefined), {
    path: ["carryOverMax"],
    message: "Isi batas hari yang dibawa",
  });

export const leaveAccrualAssignSchema = z.object({
  /** Kosong = semua karyawan aktif (atau per departemen). */
  employeeIds: z.array(z.string().uuid()).max(2000).optional(),
  departmentId: z.string().uuid().nullish(),
  dateFrom: z.string().date(),
});

export const leaveBlockDateSchema = z.object({
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  departmentId: optionalUuid,
  reason: z.string().trim().min(1, "Alasan wajib diisi").max(255),
});

/** Cuti massal/cuti bersama: dibuat HR untuk banyak karyawan sekaligus dan langsung disetujui. */
export const bulkLeaveSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    reason: z.string().trim().min(1, "Alasan wajib diisi").max(500),
    departmentId: z.string().uuid().nullish(),
    employeeIds: z.array(z.string().uuid()).max(2000).optional(),
  })
  .refine((r) => r.dateTo >= r.dateFrom, { message: "Tanggal selesai sebelum mulai", path: ["dateTo"] });

export const overtimeSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().date(),
  hours: nonNegative(2).refine((v) => Number(v) > 0 && Number(v) <= 12, "1–12 jam"),
  dayType: z.enum(["workday", "rest_day"]).default("workday"),
  description: optionalText,
});

export const attendanceSchema = z
  .object({
    employeeId: z.string().uuid(),
    checkIn: z.string().datetime({ offset: true }),
    checkOut: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((a) => !a.checkOut || a.checkOut > a.checkIn, {
    message: "Jam pulang sebelum jam masuk",
    path: ["checkOut"],
  });

/** Foto absen JPG/PNG maks. 1 MB (base64). */
const attendancePhoto = z
  .object({
    type: z.enum(["image/jpeg", "image/png"], { message: "Foto harus JPG atau PNG" }),
    data: z
      .string()
      .regex(/^[A-Za-z0-9+/=\s]+$/, "Foto tidak valid")
      .refine((v) => (v.replace(/\s/g, "").length * 3) / 4 <= 1024 * 1024, "Foto maksimal 1 MB"),
  })
  .nullish();

export const checkInSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  photo: attendancePhoto,
});

export const workLocationSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  branchId: optionalUuid,
  latitude: z.coerce.number().min(-90).max(90).transform(String),
  longitude: z.coerce.number().min(-180).max(180).transform(String),
  radiusM: z.coerce.number().int().min(10, "Radius minimal 10 m").max(100000),
  enforceGeofence: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const attendanceDeviceSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  serial: optionalText,
  workLocationId: optionalUuid,
  active: z.boolean().default(true),
});

/** Koreksi absensi: jam lokal HH:MM pada tanggal tersebut (jam pulang boleh lewat tengah malam = hari berikutnya). */
export const attendanceRequestSchema = z.object({
  employeeId: z.string().uuid().optional(),
  kind: z.enum(["correction", "business_trip", "wfh"]).default("correction"),
  date: z.string().date(),
  checkIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format JJ:MM"),
  checkOut: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format JJ:MM")
    .nullish(),
  reason: z.string().trim().min(1, "Alasan wajib diisi").max(200, "Alasan maksimal 200 karakter"),
  attachment: z
    .object({
      name: z.string().trim().min(1).max(200),
      type: z.enum(
        [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "text/csv",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        { message: "Berkas harus PDF, JPG, PNG, CSV, atau XLSX" },
      ),
      data: z.string().regex(/^[A-Za-z0-9+/=\s]+$/, "Berkas tidak valid"),
    })
    .nullish(),
});

export const shiftRequestSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    scheduleId: z.string().uuid(),
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.dateTo >= v.dateFrom, { message: "Tanggal selesai sebelum mulai", path: ["dateTo"] });

export const attendanceValidateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Pilih minimal satu absensi").max(1000),
  decision: z.enum(["validated", "refused"]).default("validated"),
  note: z.string().trim().max(500).nullish(),
});

/** PIN kiosk 4–8 digit. */
export const attendancePinSchema = z.object({
  employeeId: z.string().uuid().optional(),
  pin: z.string().regex(/^\d{4,8}$/, "PIN 4–8 digit angka"),
});

export const kioskPunchSchema = z.object({
  /** Kode badge atau No. karyawan. */
  code: z.string().trim().min(1, "Kode badge wajib diisi").max(64),
  pin: z.string().regex(/^\d{4,8}$/, "PIN 4–8 digit angka"),
  photo: attendancePhoto,
});

export const devicePushSchema = z.object({
  punches: z
    .array(
      z.object({
        /** Kode badge atau No. karyawan sesuai pendaftaran di mesin. */
        code: z.string().trim().min(1).max(64),
        timestamp: z.string().datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(1000),
});

export const payrollSettingsSchema = z.object({
  jkkRate: z.enum(["0.24", "0.54", "0.89", "1.27", "1.74"]),
  kesWageCap: nonNegative(2),
  jpWageCap: nonNegative(2),
  salaryExpenseAccountId: z.string().uuid(),
  bpjsKesExpenseAccountId: z.string().uuid(),
  bpjsTkExpenseAccountId: z.string().uuid(),
  salaryPayableAccountId: z.string().uuid(),
  pph21PayableAccountId: z.string().uuid(),
  bpjsKesPayableAccountId: z.string().uuid(),
  bpjsTkPayableAccountId: z.string().uuid(),
  journalId: z.string().uuid(),
  timezone: z.string().trim().min(3).max(64).optional(),
  employeeLoanAccountId: z.string().uuid().nullish(),
  leaveApprovalLevels: z.coerce.number().int().min(1).max(3).optional(),
  overtimeApprovalLevels: z.coerce.number().int().min(0).max(3).optional(),
  expenseApprovalLevels: z.coerce.number().int().min(1).max(3).optional(),
  attendanceValidation: z.boolean().optional(),
  attendanceLockDate: z.string().date().nullish(),
  autoCheckoutHours: z.coerce.number().int().min(4).max(24).nullish(),
  attendanceApprovalLevels: z.coerce.number().int().min(1).max(3).optional(),
  overtimeFromAttendance: z.boolean().optional(),
  overtimeMinMinutes: z.coerce.number().int().min(0).max(240).optional(),
  overtimeRoundMinutes: z.coerce.number().int().min(1).max(60).optional(),
  overtimeMaxHours: z.coerce.number().int().min(1).max(12).optional(),
  overtimeCountEarly: z.boolean().optional(),
  casualFullBpjsMonths: z.coerce.number().int().min(0).max(24).optional(),
  thrComponentId: z.string().uuid().nullish(),
  retroComponentId: z.string().uuid().nullish(),
  transferSourceAccount: z
    .string()
    .trim()
    .max(30)
    .regex(/^[\d\s.-]*$/, "Nomor rekening hanya angka")
    .nullish(),
  transferCompanyCode: z.string().trim().max(30).nullish(),
});

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  accountId: z.string().uuid(),
  /** Plafon per karyawan per tahun (kosong = tanpa plafon). */
  annualLimit: nonNegative(2).nullish(),
  taxable: z.boolean().default(false),
  active: z.boolean().default(true),
});

/** Berkas unggahan base64 (PDF/JPG/PNG) dengan batas ukuran. */
const fileUpload = (maxMb: number) =>
  z.object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(["application/pdf", "image/jpeg", "image/png"], {
      message: "Berkas harus PDF, JPG, atau PNG",
    }),
    data: z
      .string()
      .regex(/^[A-Za-z0-9+/=\s]+$/, "Berkas tidak valid")
      .refine(
        (v) => (v.replace(/\s/g, "").length * 3) / 4 <= maxMb * 1024 * 1024,
        `Berkas maksimal ${maxMb} MB`,
      ),
  });

/** Bukti klaim (struk/nota): PDF/JPG/PNG maks. 2 MB, dikirim base64. */
export const claimAttachmentSchema = fileUpload(2);

export const expenseClaimSchema = z.object({
  /** Kosong = karyawan user yang login (portal). */
  employeeId: z.string().uuid().optional(),
  date: z.string().date(),
  description: z.string().trim().max(500).nullish(),
  payMethod: z.enum(["payslip", "cash"]).default("payslip"),
  lines: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        date: z.string().date(),
        amount: nonNegative(2).refine((v) => Number(v) > 0, "Harus lebih dari 0"),
        note: z.string().trim().max(500).nullish(),
        /** Baris lama (bukti lama dipertahankan bila `attachment` tidak dikirim; `null` menghapusnya). */
        id: z.string().uuid().optional(),
        attachment: claimAttachmentSchema.nullish(),
      }),
    )
    .min(1, "Minimal satu baris klaim")
    .max(50),
});

export const payClaimSchema = z.object({ journalId: z.string().uuid(), date: z.string().date() });

/** Field data pribadi yang boleh diajukan perubahannya oleh karyawan dari portal. */
export const EMPLOYEE_CHANGE_FIELDS = [
  "address",
  "workPhone",
  "emergencyContact",
  "emergencyPhone",
  "bankName",
  "bankAccount",
  "bankAccountName",
  "ptkpStatus",
  "personalEmail",
  "personalPhone",
  "domicileAddress",
  "maritalStatus",
  "religion",
  "bloodType",
  "rhesus",
] as const;

/** Teks perubahan data: tidak diisi = tidak diubah; string kosong = dikosongkan. */
const changeText = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null));

export const employeeChangeSchema = z
  .object({
    address: changeText,
    workPhone: changeText,
    emergencyContact: changeText,
    emergencyPhone: changeText,
    bankName: changeText,
    bankAccount: z
      .string()
      .trim()
      .max(50)
      .regex(/^[\d\s.-]*$/, "Nomor rekening hanya angka")
      .nullish(),
    bankAccountName: changeText,
    ptkpStatus: z.enum(PTKP_STATUS_VALUES).optional(),
    personalEmail: z
      .string()
      .trim()
      .email()
      .or(z.literal(""))
      .nullish()
      .transform((v) => (v === undefined ? undefined : v || null)),
    personalPhone: changeText,
    domicileAddress: changeText,
    maritalStatus: z.enum(MARITAL_STATUS_VALUES).optional(),
    religion: z.enum(RELIGION_VALUES).optional(),
    bloodType: z.enum(["A", "B", "AB", "O"]).optional(),
    rhesus: z.enum(["+", "-"]).optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((c) => EMPLOYEE_CHANGE_FIELDS.some((f) => c[f] !== undefined), {
    message: "Isi minimal satu data yang diubah",
  });

// ---- Rekrutmen, dokumen, checklist ----

export const HR_DOCUMENT_KIND_VALUES = [
  "ktp",
  "npwp",
  "kk",
  "bpjs_kes",
  "bpjs_tk",
  "sim",
  "passport",
  "bank_book",
  "ijazah",
  "cv",
  "contract",
  "decree",
  "certificate",
  "warning",
  "other",
] as const;

export const hrDocumentSchema = z
  .object({
    employeeId: z.string().uuid().nullish(),
    applicantId: z.string().uuid().nullish(),
    kind: z.enum(HR_DOCUMENT_KIND_VALUES),
    name: z.string().trim().min(1).max(200),
    number: optionalText,
    issuedDate: z.string().date().nullish(),
    expiryDate: z.string().date().nullish(),
    note: z.string().trim().max(500).nullish(),
    file: fileUpload(5),
  })
  .refine((d) => d.employeeId || d.applicantId, {
    message: "Pilih karyawan atau pelamar",
    path: ["employeeId"],
  })
  .refine((d) => !d.issuedDate || !d.expiryDate || d.expiryDate >= d.issuedDate, {
    message: "Tanggal kedaluwarsa sebelum tanggal terbit",
    path: ["expiryDate"],
  });

export const jobOpeningSchema = z.object({
  name: z.string().trim().min(1).max(200),
  jobId: optionalUuid,
  departmentId: optionalUuid,
  description: z.string().trim().max(5000).nullish(),
  quota: z.coerce.number().int().min(1).max(1000).default(1),
  state: z.enum(["open", "closed"]).default("open"),
  dateOpen: z.string().date().optional(),
  dateClose: z.string().date().nullish(),
  targetDate: z.string().date().nullish(),
  wageMin: nonNegative(2).nullish(),
  wageMax: nonNegative(2).nullish(),
});

export const applicantSchema = z.object({
  openingId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: optionalText,
  source: z.enum(["referral", "jobportal", "website", "walkin", "other"]).default("other"),
  expectedWage: nonNegative(2).nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

export const applicantStageSchema = z
  .object({
    stage: z.enum(["new", "screening", "interview", "offer", "refused"]),
    /** Alasan dari master alasan penolakan (wajib saat ditolak); catatan tambahan opsional. */
    refuseReasonId: optionalUuid,
    refuseReason: z.string().trim().max(500).nullish(),
  })
  .refine((s) => s.stage !== "refused" || s.refuseReasonId, {
    message: "Pilih alasan penolakan",
    path: ["refuseReasonId"],
  });

export const refuseReasonSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sequence: z.coerce.number().int().min(0).max(10000).default(10),
  active: z.boolean().default(true),
});

export const offerTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  active: z.boolean().default(true),
});

export const jobOfferSchema = z
  .object({
    templateId: optionalUuid,
    wage: nonNegative(2),
    benefits: z.string().trim().max(2000).nullish(),
    contractType: contractTypeCode.default("pkwtt"),
    contractEnd: z.string().date().nullish(),
    startDate: z.string().date(),
    validUntil: z.string().date(),
    /** Isi surat; kosong = dari template. */
    body: z.string().trim().max(20000).nullish(),
  })
  .refine((o) => !o.contractEnd || o.contractEnd > o.startDate, {
    message: "Tanggal berakhir kontrak sebelum tanggal mulai",
    path: ["contractEnd"],
  });

export const offerResponseSchema = z.object({ note: z.string().trim().max(500).nullish() });

export const offboardSchema = z.object({
  resignDate: z.string().date(),
  resignReason: z.enum(["resign", "end_contract", "termination", "retirement", "death", "other"]),
  resignNote: z.string().trim().max(1000).nullish(),
  /** Mulai checklist offboarding (template bawaan). */
  startChecklist: z.boolean().default(true),
});

/**
 * Akhiri kontrak. `exit` = karyawan keluar: tanggal berakhir menjadi tanggal keluar karyawan (satu-satunya tempat
 * tanggal keluar diinput), dengan alasan & checklist offboarding. Tanpa `exit` = kontrak selesai (mis. diganti kontrak
 * baru/perpanjangan).
 */
export const contractEndSchema = z
  .object({
    dateEnd: z.string().date(),
    exit: z.boolean().default(false),
    resignReason: z.enum(["resign", "end_contract", "termination", "retirement", "death", "other"]).nullish(),
    resignNote: z.string().trim().max(1000).nullish(),
    startChecklist: z.boolean().default(true),
  })
  .refine((v) => !v.exit || v.resignReason, { message: "Pilih alasan keluar", path: ["resignReason"] });

export const exitInterviewSchema = z.object({
  date: z.string().date(),
  interviewerId: optionalUuid,
  mainReason: z.enum([
    "compensation",
    "career",
    "manager",
    "workload",
    "environment",
    "work_life",
    "relocation",
    "study",
    "health",
    "family",
    "other",
  ]),
  scores: z.record(z.string(), z.coerce.number().int().min(1).max(5)).default({}),
  wouldRejoin: z.boolean().nullish(),
  wouldRecommend: z.boolean().nullish(),
  comment: z.string().trim().max(2000).nullish(),
});

export const interviewSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  interviewerId: optionalUuid,
  location: optionalText,
  result: z.string().trim().max(2000).nullish(),
  score: z.coerce.number().int().min(1).max(5).nullish(),
  done: z.boolean().default(false),
});

/** Terima pelamar; tanggal mulai, gaji & jenis kontrak bawaan dari penawaran yang diterima (bila ada). */
export const hireSchema = z.object({
  joinDate: z.string().date().optional(),
  wage: nonNegative(2).optional(),
  contractType: contractTypeCode.optional(),
  dateEnd: z.string().date().nullish(),
  ptkpStatus: z.enum(PTKP_STATUS_VALUES).default("TK/0"),
});

export const checklistTemplateSchema = z.object({
  kind: z.enum(["onboarding", "offboarding"]),
  name: z.string().trim().min(1).max(200),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        responsible: z.enum(["hr", "manager", "employee", "it"]).default("hr"),
        dueDays: z.coerce.number().int().min(-365).max(365).default(0),
        action: z.enum(["severance", "deactivate_user"]).nullish(),
      }),
    )
    .min(1, "Minimal satu tugas")
    .max(100),
});

export const checklistStartSchema = z.object({
  employeeId: z.string().uuid(),
  kind: z.enum(["onboarding", "offboarding"]),
  templateId: z.string().uuid().nullish(),
  /** Kosong = tanggal masuk (onboarding) / tanggal keluar (offboarding). */
  baseDate: z.string().date().nullish(),
});

// ---- Kinerja & pelatihan ----

export const appraisalTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  jobId: optionalUuid,
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).nullish(),
        weight: z.coerce.number().positive("Bobot harus lebih dari 0").max(1000),
      }),
    )
    .min(1, "Minimal satu indikator")
    .max(50),
});

export const appraisalCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    dateStart: z.string().date(),
    dateEnd: z.string().date(),
  })
  .refine((c) => c.dateEnd >= c.dateStart, { message: "Tanggal selesai sebelum mulai", path: ["dateEnd"] });

export const appraisalStartSchema = z.object({
  /** Kosong = semua karyawan aktif. */
  employeeIds: z.array(z.string().uuid()).optional(),
  /** Template untuk karyawan tanpa template jabatan. */
  templateId: z.string().uuid().nullish(),
});

const score = z.coerce.number().int().min(1, "Skor 1–5").max(5, "Skor 1–5");
export const appraisalReviewSchema = z.object({
  lines: z
    .array(z.object({ id: z.string().uuid(), score, comment: z.string().trim().max(1000).nullish() }))
    .min(1),
  comment: z.string().trim().max(2000).nullish(),
});

export const appraisalCalibrateSchema = z.object({
  finalScore: z.coerce.number().min(1).max(5).nullish(),
  rating: z.enum(["A", "B", "C", "D", "E"]).nullish(),
  raisePercent: z.coerce.number().min(0).max(100).nullish(),
  comment: z.string().trim().max(2000).nullish(),
});

export const trainingSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    provider: optionalText,
    dateStart: z.string().date(),
    dateEnd: z.string().date(),
    cost: nonNegative(2).default("0"),
    certificateValidMonths: z.coerce.number().int().min(1).max(240).nullish(),
    state: z.enum(["planned", "done", "cancel"]).default("planned"),
    description: z.string().trim().max(2000).nullish(),
  })
  .refine((t) => t.dateEnd >= t.dateStart, { message: "Tanggal selesai sebelum mulai", path: ["dateEnd"] });

export const trainingParticipantsSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1).max(500),
});

export const trainingResultSchema = z.object({
  state: z.enum(["enrolled", "completed", "absent"]),
  certificate: fileUpload(5).nullish(),
  /** Kosong = tanggal selesai pelatihan + masa berlaku sertifikat. */
  certificateExpiry: z.string().date().nullish(),
});

export const thrComputeSchema = z.object({
  /** Tanggal hari raya keagamaan (masa kerja dihitung sampai tanggal ini). */
  holidayDate: z.string().date(),
  /** Nama hari raya untuk keterangan slip, mis. "Idul Fitri 1447 H". */
  holiday: z.string().trim().max(60).nullish(),
});

export const payrollCostQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format YYYY-MM"),
    to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format YYYY-MM"),
    groupBy: z.enum(["department", "branch", "month"]).default("department"),
  })
  .refine((q) => q.to >= q.from, { message: "Periode akhir sebelum awal", path: ["to"] });

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format JJ:MM");

export const workScheduleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  startTime: clock,
  endTime: clock,
  toleranceMinutes: z.coerce.number().int().min(0).max(240).default(0),
  penaltyPerMinute: nonNegative(2).default("0"),
  penaltyPerOccurrence: nonNegative(2).default("0"),
  workDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
  active: z.boolean().default(true),
});

export const shiftAssignmentSchema = z.object({
  employeeId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
});

export const employeeLoanSchema = z.object({
  employeeId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  principal: nonNegative(2).refine((v) => Number(v) > 0, "Harus lebih dari 0"),
  installment: nonNegative(2).refine((v) => Number(v) > 0, "Harus lebih dari 0"),
  startPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format YYYY-MM"),
  note: z.string().max(2000).nullish(),
});

export const loanDisburseSchema = z.object({
  journalId: z.string().uuid(),
  date: z.string().date(),
});

export const workEntrySchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().date(),
  quantity: nonNegative(4).refine((v) => Number(v) > 0, "Harus lebih dari 0"),
  description: z.string().trim().max(500).nullish(),
});

export const approvalDecisionSchema = z.object({ note: z.string().trim().max(1000).nullish() });

export const severanceInputSchema = z.object({
  reason: z.enum([
    "merger_refused",
    "takeover",
    "takeover_changed_terms",
    "efficiency_loss",
    "efficiency_prevent_loss",
    "closure_loss",
    "closure_no_loss",
    "force_majeure_closure",
    "force_majeure_no_closure",
    "pkpu_loss",
    "pkpu_no_loss",
    "bankruptcy",
    "employer_misconduct",
    "resignation",
    "absence",
    "violation",
    "urgent_violation",
    "detention",
    "long_illness",
    "retirement",
    "death",
    "pkwt_end",
  ]),
  endDate: z.string().date(),
  /** Kosong = sisa cuti tahunan dari saldo per tanggal berakhir. */
  unusedLeaveDays: z.coerce.number().min(0).max(366).optional(),
  otherRights: nonNegative(2).default("0"),
  separationPay: nonNegative(2).default("0"),
});

export const payrollRunSchema = z.object({
  /** Bulan payroll (YYYY-MM). */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format YYYY-MM"),
  paymentDate: z.string().date(),
  name: z.string().trim().max(100).nullish(),
});

/** Payroll koreksi (off-cycle) atas payroll reguler yang sudah diposting, untuk karyawan tertentu. */
export const payrollCorrectionSchema = z.object({
  paymentDate: z.string().date(),
  name: z.string().trim().max(100).nullish(),
  employeeIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu karyawan"),
});

export const payslipHoldSchema = z.object({ reason: z.string().trim().min(1).max(200) });

export const payslipInputsSchema = z.object({
  inputs: z.array(
    z.object({
      componentId: z.string().uuid(),
      amount: nonNegative(2),
      description: z.string().trim().max(200).nullish(),
    }),
  ),
});

export const payRunSchema = z.object({ journalId: z.string().uuid(), date: z.string().date() });

// ---- Fase 5: pajak (Coretax) ----

const period = {
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
};
const idList = z.array(z.string().uuid()).min(1, "Pilih minimal satu dokumen").max(1000);

/** Buat draft faktur pajak keluaran dari faktur penjualan posted pada masa pajak. */
export const taxInvoiceGenerateSchema = z.object(period);

export const taxInvoiceUpdateSchema = z.object({
  trxCode: z.enum(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]).optional(),
  addInfo: optionalText,
  facilityStamp: optionalText,
  customDoc: optionalText,
});

export const taxDocExportSchema = z.object({ ids: idList });

/** Nomor faktur/bukti potong dari Coretax setelah dokumen disetujui. */
export const taxDocApproveSchema = z.object({
  number: z
    .string()
    .trim()
    .transform((v) => v.replace(/[.\-\s]/g, ""))
    .refine((v) => /^[0-9A-Z]{8,20}$/i.test(v), "Nomor tidak valid"),
});

export const inputTaxImportSchema = z.object({ csv: z.string().min(1).max(5_000_000) });

export const inputTaxUpdateSchema = z.object({
  moveId: z.string().uuid().nullish(),
  partnerId: z.string().uuid().nullish(),
});

export const inputTaxCreditSchema = z.object({
  ids: idList,
  /** Kreditkan pada masa ini, atau `credit: false` untuk menandai tidak dikreditkan. */
  credit: z.boolean().default(true),
  ...period,
});

export const withholdingGenerateSchema = z.object({ kind: z.enum(["bppu", "bpmp", "bpa1"]), ...period });

/** Rentang NSFP e-Faktur 3.x (13 digit, tanda baca boleh). */
export const nsfpRangeSchema = z.object({
  start: z.string().trim().min(13).max(20),
  end: z.string().trim().min(13).max(20),
  note: optionalText,
});

export const taxReturnGenerateSchema = z.object({ ...period });
export const taxReturnUpdateSchema = z.object({ inputTaxInvoiceId: z.string().uuid().nullable() });

export const withholdingUpdateSchema = z.object({
  counterpartTin: z
    .string()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, "") : null))
    .refine((v) => v === null || /^\d{16}$/.test(v), "NPWP/NIK 16 digit")
    .optional(),
  counterpartIdtku: nitku.optional(),
  taxObjectCode: z
    .string()
    .trim()
    .regex(/^\d{2}-\d{3}-\d{2}$/, "Kode objek pajak, mis. 24-104-14")
    .optional(),
  taxCertificate: z.string().trim().min(1).max(30).optional(),
  documentType: z.enum(["CommercialInvoice", "Contract", "PaymentProof", "Other"]).optional(),
});

// ---- Fase 5: onboarding & billing ----

export const onboardingCompanySchema = z.object({
  name: z.string().trim().min(2).max(200),
  npwp,
  ...companyProfile,
});

export const ONBOARDING_STEPS = [
  "company",
  "tax",
  "opening",
  "partners",
  "products",
  "users",
  "plan",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingStepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  status: z.enum(["done", "skipped"]).default("done"),
});

/** Saldo awal per akun (kode akun), opsional per partner untuk piutang/utang. */
export const openingBalanceSchema = z.object({
  date: z.string().date(),
  lines: z
    .array(
      z.object({
        accountCode: z.string().trim().min(1).max(20),
        partnerId: z.string().uuid().nullish(),
        debit: nonNegative(2).default("0"),
        credit: nonNegative(2).default("0"),
        name: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1)
    .max(5000),
});

export const subscribeSchema = z.object({
  planCode: z.string().trim().min(1).max(50),
  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
});

export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,50}$/),
  name: z.string().trim().min(1).max(100),
  description: optionalText,
  priceMonthly: nonNegative(2),
  priceYearly: nonNegative(2),
  maxUsers: z.coerce.number().int().positive().nullish(),
  maxCompanies: z.coerce.number().int().positive().nullish(),
  modules: z.array(
    z.enum(["accounting", "crm", "sales", "purchase", "inventory", "tax", "hr", "payroll", "consolidation"]),
  ),
  public: z.boolean().default(true),
  sort: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

/** Ubah langganan tenant oleh admin platform. */
export const adminSubscriptionSchema = z.object({
  planCode: z.string().trim().min(1).optional(),
  status: z.enum(["trialing", "active", "cancelled", "suspended"]).optional(),
  trialEndsAt: z.string().datetime({ offset: true }).nullish(),
  currentPeriodEnd: z.string().datetime({ offset: true }).nullish(),
  /** Beri/cabut langganan gratis; `complimentaryUntil` null = tanpa batas waktu. */
  complimentary: z.boolean().optional(),
  complimentaryUntil: z.string().datetime({ offset: true }).nullish(),
  complimentaryNote: z.string().trim().max(300).nullish(),
});

// ---- Fase 5b: konsolidasi ----

export const groupAccountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPE_VALUES),
  role: z
    .enum([
      "investment",
      "goodwill",
      "nci_equity",
      "nci_profit",
      "cta",
      "retained_earnings",
      "associate_investment",
      "associate_income",
      "ic_difference",
      "inventory",
      "cost_of_sales",
      "dividends",
      "equity_transactions",
      "disposal_gain",
    ])
    .nullish(),
  active: z.boolean().default(true),
});

export const accountMappingSchema = z.object({
  companyId: z.string().uuid(),
  items: z
    .array(z.object({ accountId: z.string().uuid(), groupAccountId: z.string().uuid().nullable() }))
    .max(2000),
});

const positiveRate = z
  .union([z.number(), z.string()])
  .transform(String)
  .pipe(z.string().regex(/^\d+(\.\d{1,10})?$/));

export const consolidationRatesSchema = z
  .array(
    z.object({
      companyId: z.string().uuid(),
      closingRate: positiveRate.optional(),
      averageRate: positiveRate.optional(),
      historicalRate: positiveRate.optional(),
      /** true: ekuitas dijabarkan dengan kurs pada tanggal transaksi (abaikan kurs historis manual). */
      historicalByDate: z.boolean().optional(),
    }),
  )
  .default([]);

export const consolidationRunSchema = z.object({
  name: z.string().trim().max(200).nullish(),
  rootCompanyId: z.string().uuid(),
  dateTo: z.string().date(),
  dateFrom: z.string().date().nullish(),
  rates: consolidationRatesSchema,
});

export const consolidationComputeSchema = z.object({ rates: consolidationRatesSchema });

export const consolidationManualEntrySchema = z.object({
  description: z.string().trim().min(1).max(500),
  lines: z
    .array(
      z.object({
        groupAccountId: z.string().uuid(),
        companyId: z.string().uuid().nullish(),
        debit: nonNegative(2).default("0"),
        credit: nonNegative(2).default("0"),
      }),
    )
    .min(2, "Minimal dua baris"),
});

// ---- Platform: SSO & kurs otomatis ----

const ssoCommon = {
  label: z.string().trim().min(1).max(60).default("SSO"),
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Domain tidak valid"),
    )
    .max(50)
    .default([]),
  autoProvision: z.boolean().default(false),
  defaultRoleId: z.string().uuid().nullish(),
  enforce: z.boolean().default(false),
  active: z.boolean().default(true),
};

/**
 * Konfigurasi SSO tenant: OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Okta, …) atau SAML 2.0
 * (ADFS, Entra ID, Okta, OneLogin, JumpCloud, …). Tanpa `protocol` dianggap OpenID Connect.
 */
export const ssoConfigSchema = z.preprocess(
  (v) => (v && typeof v === "object" && !("protocol" in v) ? { ...v, protocol: "oidc" } : v),
  z.discriminatedUnion("protocol", [
    z.object({
      protocol: z.literal("oidc"),
      issuer: z
        .string()
        .trim()
        .url("URL issuer tidak valid")
        .transform((v) => v.replace(/\/+$/, "")),
      clientId: z.string().trim().min(1).max(500),
      /** Kosong/tidak dikirim = tetap memakai secret yang tersimpan. */
      clientSecret: z.string().max(2000).nullish(),
      ...ssoCommon,
    }),
    z.object({
      protocol: z.literal("saml"),
      /** URL Single Sign-On IdP (binding HTTP-Redirect). */
      samlEntryPoint: z.string().trim().url("URL SSO IdP tidak valid"),
      /** Sertifikat penandatanganan IdP (PEM atau base64); beberapa blok PEM untuk masa rotasi. */
      samlIdpCert: z.string().trim().min(100, "Sertifikat IdP tidak valid").max(20000),
      samlIdpIssuer: z.string().trim().max(500).nullish(),
      /** Atribut berisi email; kosong = NameID atau atribut email yang umum. */
      samlEmailAttribute: z.string().trim().max(300).nullish(),
      ...ssoCommon,
    }),
  ]),
);

export const fxSettingsSchema = z.object({
  source: z.enum(["manual", "frankfurter"]),
  currencies: z
    .array(z.string().trim().toUpperCase().length(3))
    .max(30)
    .transform((v) => [...new Set(v)].filter((c) => c !== "IDR")),
  daily: z.boolean().default(false),
});

export const fxFetchSchema = z.object({ date: z.string().date().optional() });

// ---- Profil karyawan: foto, keluarga, pendidikan, pengalaman, mutasi, surat peringatan ----

/** Foto karyawan: JPG/PNG/WebP maks. 1 MB (base64). */
export const employeePhotoSchema = z.object({
  type: z.enum(["image/jpeg", "image/png", "image/webp"], { message: "Foto harus JPG, PNG, atau WebP" }),
  data: z
    .string()
    .regex(/^[A-Za-z0-9+/=\s]+$/, "Berkas tidak valid")
    .refine((v) => (v.replace(/\s/g, "").length * 3) / 4 <= 1024 * 1024, "Foto maksimal 1 MB"),
});

export const FAMILY_RELATION_VALUES = ["spouse", "child", "father", "mother", "sibling", "other"] as const;

export const employeeFamilySchema = z.object({
  relation: z.enum(FAMILY_RELATION_VALUES),
  name: z.string().trim().min(1).max(200),
  nik: digits([16], "NIK")
    .nullish()
    .or(z.literal("").transform(() => null)),
  gender: z.enum(["male", "female"]).nullish(),
  birthPlace: optionalText,
  birthDate: z.string().date().nullish(),
  education: optionalText,
  occupation: optionalText,
  phone: optionalText,
  dependent: z.boolean().default(false),
  bpjsCovered: z.boolean().default(false),
  alive: z.boolean().default(true),
  note: z.string().trim().max(500).nullish(),
});

export const EDUCATION_LEVEL_VALUES = [
  "sd",
  "smp",
  "sma",
  "d1",
  "d2",
  "d3",
  "d4",
  "s1",
  "s2",
  "s3",
  "other",
] as const;

const year = z.coerce.number().int().min(1900).max(2200).nullish();

export const employeeEducationSchema = z
  .object({
    level: z.enum(EDUCATION_LEVEL_VALUES),
    institution: z.string().trim().min(1).max(200),
    major: optionalText,
    yearStart: year,
    yearEnd: year,
    gpa: z.coerce.number().min(0).max(100).nullish(),
    documentId: optionalUuid,
    note: z.string().trim().max(500).nullish(),
  })
  .refine((e) => !e.yearStart || !e.yearEnd || e.yearEnd >= e.yearStart, {
    message: "Tahun lulus sebelum tahun masuk",
    path: ["yearEnd"],
  });

export const employeeExperienceSchema = z
  .object({
    company: z.string().trim().min(1).max(200),
    position: optionalText,
    dateStart: z.string().date().nullish(),
    dateEnd: z.string().date().nullish(),
    reasonLeaving: optionalText,
    note: z.string().trim().max(500).nullish(),
  })
  .refine((e) => !e.dateStart || !e.dateEnd || e.dateEnd >= e.dateStart, {
    message: "Tanggal keluar sebelum tanggal masuk",
    path: ["dateEnd"],
  });

export const MOVEMENT_KIND_VALUES = ["promotion", "demotion", "transfer", "rotation"] as const;

export const employeeMovementSchema = z
  .object({
    employeeId: z.string().uuid(),
    kind: z.enum(MOVEMENT_KIND_VALUES),
    decreeNo: optionalText,
    effectiveDate: z.string().date(),
    toJobId: optionalUuid,
    toDepartmentId: optionalUuid,
    toBranchId: optionalUuid,
    toManagerId: optionalUuid,
    toGradeId: optionalUuid,
    newWage: nonNegative(2).nullish(),
    reason: z.string().trim().max(1000).nullish(),
    documentId: optionalUuid,
  })
  .refine(
    (m) => m.toJobId || m.toDepartmentId || m.toBranchId || m.toManagerId || m.toGradeId || m.newWage != null,
    { message: "Isi minimal satu perubahan (jabatan, departemen, cabang, atasan, golongan, atau upah)" },
  );

export const employeeWarningSchema = z
  .object({
    employeeId: z.string().uuid(),
    level: z.enum(["sp1", "sp2", "sp3"]),
    decreeNo: optionalText,
    date: z.string().date(),
    /** Kosong = 6 bulan sejak tanggal SP. */
    validUntil: z.string().date().nullish(),
    reason: z.string().trim().min(1).max(2000),
    documentId: optionalUuid,
  })
  .refine((w) => !w.validUntil || w.validUntil >= w.date, {
    message: "Masa berlaku berakhir sebelum tanggal SP",
    path: ["validUntil"],
  });

// ---- Mesin persetujuan generik ----

const approvalFieldMode = z.enum(["required", "optional", "none"]);

export const approvalCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, "Kode 2–20 huruf besar/angka"),
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  description: z.string().trim().max(1000).nullish(),
  prefix: z.string().trim().min(1, "Prefix wajib diisi").max(20),
  fields: z
    .object({
      date: approvalFieldMode,
      period: approvalFieldMode,
      quantity: approvalFieldMode,
      amount: approvalFieldMode,
      reference: approvalFieldMode,
      location: approvalFieldMode,
      contact: approvalFieldMode,
      description: approvalFieldMode,
      attachment: approvalFieldMode,
    })
    .partial()
    .default({}),
  managerFirst: z.boolean().default(true),
  approvalMode: z.enum(["sequential", "parallel"]).default("sequential"),
  minApprovals: z.coerce.number().int().min(0).max(20).default(0),
  sequence: z.coerce.number().int().min(0).max(9999).default(10),
  active: z.boolean().default(true),
  approvers: z
    .array(
      z
        .object({
          userId: z.string().uuid().nullish(),
          roleId: z.string().uuid().nullish(),
          label: z.string().trim().max(80).nullish(),
          required: z.boolean().default(true),
          minAmount: nonNegative(2).nullish(),
        })
        .refine((a) => !!a.userId !== !!a.roleId, {
          message: "Pilih satu: user atau peran",
          path: ["userId"],
        }),
    )
    .max(20)
    .default([]),
});

export const approvalRequestSchema = z
  .object({
    categoryId: z.string().uuid(),
    subject: z.string().trim().min(1, "Subjek wajib diisi").max(200),
    date: z.string().date().nullish(),
    dateFrom: z.string().date().nullish(),
    dateTo: z.string().date().nullish(),
    quantity: nonNegative(2).nullish(),
    amount: nonNegative(2).nullish(),
    reference: optionalText,
    location: optionalText,
    contact: optionalText,
    description: z.string().trim().max(5000).nullish(),
    /** Tidak dikirim = lampiran lama dipertahankan; `null` menghapusnya. */
    attachment: fileUpload(2).nullish(),
  })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateTo >= v.dateFrom, {
    path: ["dateTo"],
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
  });

export const approvalDelegationSchema = z
  .object({
    /** Kosong = user yang login. Mendelegasikan untuk user lain butuh hr.manage. */
    userId: z.string().uuid().optional(),
    delegateUserId: z.string().uuid(),
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.dateTo >= v.dateFrom, {
    path: ["dateTo"],
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
  });

// ---- Kinerja lanjutan & layanan mandiri (PR-F) ----

export const goalSchema = z
  .object({
    parentId: optionalUuid,
    cycleId: optionalUuid,
    employeeId: optionalUuid,
    departmentId: optionalUuid,
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).nullish(),
    metric: z.enum(["percent", "number", "currency", "boolean"]).default("percent"),
    startValue: z.coerce.number().default(0),
    targetValue: z.coerce.number().default(100),
    currentValue: z.coerce.number().default(0),
    unit: z.string().trim().max(30).nullish(),
    weight: z.coerce.number().positive().max(1000).default(1),
    dueDate: z.string().date().nullish(),
    state: z.enum(["draft", "active", "done", "cancelled"]).default("active"),
  })
  .refine((g) => !(g.employeeId && g.departmentId), {
    message: "Pilih karyawan atau departemen, bukan keduanya",
    path: ["departmentId"],
  })
  .refine((g) => g.metric === "boolean" || g.targetValue !== g.startValue, {
    message: "Target harus berbeda dari nilai awal",
    path: ["targetValue"],
  });

export const goalCheckinSchema = z.object({
  value: z.coerce.number(),
  note: z.string().trim().max(1000).nullish(),
});

export const feedbackRequestSchema = z.object({
  subjectEmployeeId: z.string().uuid(),
  reviewerUserIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu penilai").max(30),
  relation: z.enum(["peer", "subordinate", "manager", "self", "other"]),
  cycleId: optionalUuid,
  dueDate: z.string().date().nullish(),
});

export const feedbackResponseSchema = z.object({
  scores: z.record(z.string(), z.coerce.number().int().min(1).max(5)),
  strengths: z.string().trim().max(2000).nullish(),
  improvements: z.string().trim().max(2000).nullish(),
});

export const employeeNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  visibility: z.enum(["private", "hr"]).default("private"),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  departmentId: optionalUuid,
  pinned: z.boolean().default(false),
  expiresAt: z.string().date().nullish(),
  publish: z.boolean().default(false),
});

// ---- Armada ----

const plate = z
  .string()
  .trim()
  .min(1, "Nomor polisi wajib diisi")
  .max(20)
  .transform(normalizePlate)
  .refine(isValidPlate, "Format nomor polisi tidak valid (mis. B 1234 XYZ)");
const optionalMoney = money.nullish();
const optionalDate = z.string().date().nullish();

export const FLEET_CATEGORIES = ["car", "motorcycle", "pickup", "truck", "bus", "other"] as const;

export const fleetManufacturerSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  active: z.boolean().default(true),
});

export const fleetModelSchema = z.object({
  manufacturerId: z.string().uuid(),
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  category: z.enum(FLEET_CATEGORIES).default("car"),
  seats: z.coerce.number().int().min(1).max(100).nullish(),
  doors: z.coerce.number().int().min(0).max(10).nullish(),
  transmission: z.enum(["manual", "automatic"]).nullish(),
  fuelType: z.enum(["gasoline", "diesel", "electric", "hybrid", "lpg", "other"]).nullish(),
  horsepower: z.coerce.number().int().min(0).max(5000).nullish(),
  active: z.boolean().default(true),
});

export const fleetServiceTypeSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  category: z.enum(["contract", "service", "both"]).default("service"),
  accountId: optionalUuid,
  active: z.boolean().default(true),
});

export const fleetVehicleSchema = z.object({
  licensePlate: plate,
  modelId: z.string().uuid(),
  state: z.enum(["new_request", "to_order", "registered", "downgraded"]).default("registered"),
  branchId: optionalUuid,
  businessUnitId: optionalUuid,
  managerUserId: optionalUuid,
  driverEmployeeId: optionalUuid,
  nextDriverEmployeeId: optionalUuid,
  vin: optionalText,
  engineNo: optionalText,
  modelYear: z.coerce.number().int().min(1950).max(2200).nullish(),
  color: optionalText,
  location: optionalText,
  odometerUnit: z.enum(["km", "mi"]).default("km"),
  orderDate: optionalDate,
  registrationDate: optionalDate,
  catalogValue: optionalMoney,
  purchaseValue: optionalMoney,
  residualValue: optionalMoney,
  replacementDate: optionalDate,
  assetId: optionalUuid,
  stnkNo: optionalText,
  stnkExpiry: optionalDate,
  taxDueDate: optionalDate,
  bpkbNo: optionalText,
  kirNo: optionalText,
  kirExpiry: optionalDate,
  note: z.string().max(2000).nullish(),
  active: z.boolean().default(true),
});

// Tanpa refine: dipakai CRUD generik (`.partial()`); urutan tanggal diperiksa di API.
export const fleetContractSchema = z.object({
  vehicleId: z.string().uuid(),
  serviceTypeId: z.string().uuid(),
  vendorId: optionalUuid,
  reference: optionalText,
  startDate: z.string().date(),
  endDate: optionalDate,
  initialCost: money.default("0"),
  recurringCost: money.default("0"),
  recurringInterval: z.enum(["none", "daily", "weekly", "monthly", "yearly"]).default("monthly"),
  includedServices: z.string().max(2000).nullish(),
  state: z.enum(["new", "running", "expired", "closed"]).default("running"),
  reminderDays: z.coerce.number().int().min(0).max(365).nullish(),
  note: z.string().max(2000).nullish(),
});

export const fleetServiceSchema = z.object({
  vehicleId: z.string().uuid(),
  serviceTypeId: z.string().uuid(),
  vendorId: optionalUuid,
  date: z.string().date(),
  odometer: z.coerce.number().min(0).max(10_000_000).nullish(),
  driverEmployeeId: optionalUuid,
  cost: money.default("0"),
  description: z.string().max(2000).nullish(),
  state: z.enum(["new", "running", "done", "cancelled"]).default("new"),
});

export const fleetOdometerSchema = z.object({
  date: z.string().date(),
  value: z.coerce.number().min(0, "Tidak boleh negatif").max(10_000_000),
  note: optionalText,
});

export const fleetSettingsSchema = z.object({
  reminderDays: z.coerce.number().int().min(1).max(365).default(30),
  expenseAccountId: optionalUuid,
});

// ---- RBAC ----

const permissionCode = z
  .string()
  .trim()
  .refine((c) => c === "*" || ALL_PERMISSION_CODES.has(c), "Kode hak akses tidak dikenal");

export const roleSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,40}$/, "Kode 2–40 huruf kecil, angka, - atau _"),
  name: z.string().trim().min(2, "Nama wajib diisi").max(120),
  description: z.string().trim().max(500).nullish(),
  permissions: z.array(permissionCode).max(2000).default([]),
});

export const userRolesSchema = z.object({
  roles: z.array(z.object({ roleId: z.string().uuid(), companyId: z.string().uuid().nullish() })).max(100),
});

export const userOverridesSchema = z.object({
  overrides: z
    .array(
      z.object({
        permission: permissionCode.refine((c) => c !== "*", "Hak admin penuh hanya lewat peran"),
        effect: z.enum(["grant", "deny"]),
        companyId: z.string().uuid().nullish(),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .max(500),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  companyIds: z.array(z.string().uuid()).min(1, "Pilih minimal satu perusahaan").optional(),
  defaultCompanyId: z.string().uuid().optional(),
});
