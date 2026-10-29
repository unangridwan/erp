import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";
import { currencies } from "./master.js";

// FK di database berbentuk komposit (tenant_id, id); di sini cukup dideklarasikan kolomnya.

export const ACCOUNT_TYPES = [
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
export const JOURNAL_TYPES = ["sale", "purchase", "bank", "cash", "general"] as const;
export const MOVE_TYPES = ["entry", "out_invoice", "out_refund", "in_invoice", "in_refund"] as const;

/** Jenis pajak untuk pelaporan Coretax. */
export const TAX_KINDS = ["vat", "vat_luxury", "ppnbm", "pph23", "pph4_2", "pph22", "other"] as const;

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountType: text("account_type", { enum: ACCOUNT_TYPES }).notNull(),
  reconcile: boolean("reconcile").notNull().default(false),
  /** Rekening antar kantor (RK pusat–cabang): saldo semua cabang harus saling hapus. */
  branchClearing: boolean("branch_clearing").notNull().default(false),
  currencyCode: text("currency_code").references(() => currencies.code),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const taxes = pgTable("taxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  typeTaxUse: text("type_tax_use", { enum: ["sale", "purchase"] }).notNull(),
  amount: numeric("amount", { precision: 9, scale: 4 }).notNull(),
  baseRatio: numeric("base_ratio", { precision: 12, scale: 10 }).notNull().default("1"),
  accountId: uuid("account_id").notNull(),
  taxKind: text("tax_kind", { enum: TAX_KINDS }).notNull().default("other"),
  taxObjectCode: text("tax_object_code"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const journals = pgTable("journals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  journalType: text("journal_type", { enum: JOURNAL_TYPES }).notNull(),
  defaultAccountId: uuid("default_account_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const accountingSettings = pgTable("accounting_settings", {
  companyId: uuid("company_id").primaryKey(),
  tenantId: tenantId(),
  lockDate: date("lock_date"),
  receivableAccountId: uuid("receivable_account_id").notNull(),
  payableAccountId: uuid("payable_account_id").notNull(),
  icReceivableAccountId: uuid("ic_receivable_account_id").notNull(),
  icPayableAccountId: uuid("ic_payable_account_id").notNull(),
  retainedEarningsAccountId: uuid("retained_earnings_account_id").notNull(),
  saleJournalId: uuid("sale_journal_id").notNull(),
  purchaseJournalId: uuid("purchase_journal_id").notNull(),
  generalJournalId: uuid("general_journal_id").notNull(),
  fxGainAccountId: uuid("fx_gain_account_id"),
  fxLossAccountId: uuid("fx_loss_account_id"),
  defaultSaleTaxId: uuid("default_sale_tax_id"),
  defaultPurchaseTaxId: uuid("default_purchase_tax_id"),
  downPaymentAccountId: uuid("down_payment_account_id"),
  stockValuationAccountId: uuid("stock_valuation_account_id"),
  stockInputAccountId: uuid("stock_input_account_id"),
  cogsAccountId: uuid("cogs_account_id"),
  stockAdjustmentAccountId: uuid("stock_adjustment_account_id"),
  stockJournalId: uuid("stock_journal_id"),
  purchaseApprovalAmount: numeric("purchase_approval_amount", { precision: 20, scale: 2 }),
  assetDisposalAccountId: uuid("asset_disposal_account_id"),
  unrealizedFxGainAccountId: uuid("unrealized_fx_gain_account_id"),
  unrealizedFxLossAccountId: uuid("unrealized_fx_loss_account_id"),
  priceDifferenceAccountId: uuid("price_difference_account_id"),
  updatedAt: audit.updatedAt,
});

export const accountMoves = pgTable("account_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  name: text("name"),
  moveType: text("move_type", { enum: MOVE_TYPES }).notNull().default("entry"),
  state: text("state", { enum: ["draft", "posted"] })
    .notNull()
    .default("draft"),
  date: date("date").notNull(),
  dueDate: date("due_date"),
  partnerId: uuid("partner_id"),
  ref: text("ref"),
  narration: text("narration"),
  currencyCode: text("currency_code").notNull(),
  currencyRate: numeric("currency_rate", { precision: 20, scale: 10 }).notNull().default("1"),
  amountUntaxed: numeric("amount_untaxed", { precision: 20, scale: 2 }).notNull().default("0"),
  amountTax: numeric("amount_tax", { precision: 20, scale: 2 }).notNull().default("0"),
  amountTotal: numeric("amount_total", { precision: 20, scale: 2 }).notNull().default("0"),
  amountResidual: numeric("amount_residual", { precision: 20, scale: 2 }).notNull().default("0"),
  paymentState: text("payment_state", { enum: ["not_paid", "partial", "paid", "reversed"] })
    .notNull()
    .default("not_paid"),
  reversedEntryId: uuid("reversed_entry_id"),
  closingYear: smallint("closing_year"),
  invoiceOrigin: text("invoice_origin"),
  /** Faktur perusahaan grup yang menjadi sumber tagihan/nota otomatis ini. */
  icSourceMoveId: uuid("ic_source_move_id"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedBy: uuid("posted_by"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const accountMoveLines = pgTable("account_move_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  moveId: uuid("move_id").notNull(),
  companyId: uuid("company_id").notNull(),
  sequence: smallint("sequence").notNull().default(0),
  displayType: text("display_type", { enum: ["product", "tax", "payment_term", "line"] })
    .notNull()
    .default("line"),
  accountId: uuid("account_id").notNull(),
  partnerId: uuid("partner_id"),
  name: text("name"),
  debit: numeric("debit", { precision: 20, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 20, scale: 2 }).notNull().default("0"),
  balance: numeric("balance", { precision: 20, scale: 2 }).generatedAlwaysAs("debit - credit"),
  currencyCode: text("currency_code").notNull(),
  amountCurrency: numeric("amount_currency", { precision: 20, scale: 2 }).notNull().default("0"),
  productId: uuid("product_id"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }),
  /** Satuan kuantitas baris (kosong = satuan produk). */
  uomId: uuid("uom_id"),
  priceUnit: numeric("price_unit", { precision: 20, scale: 4 }),
  discount: numeric("discount", { precision: 7, scale: 4 }).notNull().default("0"),
  taxIds: uuid("tax_ids").array().notNull().default([]),
  taxLineId: uuid("tax_line_id"),
  taxBaseAmount: numeric("tax_base_amount", { precision: 20, scale: 2 }),
  businessUnitId: uuid("business_unit_id"),
  branchId: uuid("branch_id"),
  icCompanyId: uuid("ic_company_id"),
  saleLineId: uuid("sale_line_id"),
  purchaseLineId: uuid("purchase_line_id"),
  amountResidual: numeric("amount_residual", { precision: 20, scale: 2 }).notNull().default("0"),
  amountResidualCurrency: numeric("amount_residual_currency", { precision: 20, scale: 2 })
    .notNull()
    .default("0"),
  reconciled: boolean("reconciled").notNull().default(false),
  createdAt: audit.createdAt,
});

export const partialReconciles = pgTable("partial_reconciles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  debitLineId: uuid("debit_line_id").notNull(),
  creditLineId: uuid("credit_line_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  createdAt: audit.createdAt,
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  partnerId: uuid("partner_id").notNull(),
  paymentType: text("payment_type", { enum: ["inbound", "outbound"] }).notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull(),
  date: date("date").notNull(),
  memo: text("memo"),
  moveId: uuid("move_id").notNull(),
  createdAt: audit.createdAt,
});

export const bankStatements = pgTable("bank_statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  name: text("name").notNull(),
  date: date("date").notNull(),
  balanceStart: numeric("balance_start", { precision: 20, scale: 2 }),
  balanceEnd: numeric("balance_end", { precision: 20, scale: 2 }),
  createdAt: audit.createdAt,
});

export const bankStatementLines = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  statementId: uuid("statement_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  date: date("date").notNull(),
  paymentRef: text("payment_ref").notNull(),
  partnerName: text("partner_name"),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  partnerId: uuid("partner_id"),
  moveId: uuid("move_id"),
  createdAt: audit.createdAt,
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code"),
  name: text("name").notNull(),
  state: text("state", { enum: ["draft", "running", "closed", "disposed"] })
    .notNull()
    .default("draft"),
  method: text("method", { enum: ["straight_line", "declining_balance"] })
    .notNull()
    .default("straight_line"),
  acquisitionDate: date("acquisition_date").notNull(),
  firstDepreciationDate: date("first_depreciation_date").notNull(),
  cost: numeric("cost", { precision: 20, scale: 2 }).notNull(),
  salvageValue: numeric("salvage_value", { precision: 20, scale: 2 }).notNull().default("0"),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  assetAccountId: uuid("asset_account_id").notNull(),
  depreciationAccountId: uuid("depreciation_account_id").notNull(),
  expenseAccountId: uuid("expense_account_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  disposalDate: date("disposal_date"),
  disposalKind: text("disposal_kind", { enum: ["sale", "scrap"] }),
  disposalPrice: numeric("disposal_price", { precision: 20, scale: 2 }),
  disposalPartnerId: uuid("disposal_partner_id"),
  disposalMoveId: uuid("disposal_move_id"),
  disposalInvoiceId: uuid("disposal_invoice_id"),
  /** Laba (positif) / rugi pelepasan = harga jual − nilai buku. */
  disposalGain: numeric("disposal_gain", { precision: 20, scale: 2 }),
  /** Aset perusahaan grup lain yang dijual ke perusahaan ini. */
  sourceAssetId: uuid("source_asset_id"),
  ...audit,
});

export const assetDepreciationLines = pgTable("asset_depreciation_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  assetId: uuid("asset_id").notNull(),
  sequence: integer("sequence").notNull(),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  accumulated: numeric("accumulated", { precision: 20, scale: 2 }).notNull(),
  bookValue: numeric("book_value", { precision: 20, scale: 2 }).notNull(),
  moveId: uuid("move_id"),
});

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  /** `manpower` = dibangun otomatis dari Man Power Planning yang disetujui (baca saja). */
  source: text("source", { enum: ["manual", "manpower"] })
    .notNull()
    .default("manual"),
  sourceYear: smallint("source_year"),
  ...audit,
});

export const budgetLines = pgTable("budget_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  budgetId: uuid("budget_id").notNull(),
  accountId: uuid("account_id").notNull(),
  businessUnitId: uuid("business_unit_id"),
  branchId: uuid("branch_id"),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
});

/** Revaluasi selisih kurs akhir bulan per perusahaan per tanggal (jurnal dibalik sehari kemudian). */
export const fxRevaluations = pgTable("fx_revaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  date: date("date").notNull(),
  moveId: uuid("move_id"),
  reversalMoveId: uuid("reversal_move_id"),
  lines: jsonb("lines").$type<FxRevaluationLine[]>().notNull().default([]),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export interface FxRevaluationLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  partnerName: string | null;
  currencyCode: string;
  amountCurrency: string;
  bookValue: string;
  rate: string;
  revalued: string;
  difference: string;
}
