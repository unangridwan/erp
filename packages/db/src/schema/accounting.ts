import { boolean, date, numeric, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
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

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountType: text("account_type", { enum: ACCOUNT_TYPES }).notNull(),
  reconcile: boolean("reconcile").notNull().default(false),
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
  priceUnit: numeric("price_unit", { precision: 20, scale: 4 }),
  discount: numeric("discount", { precision: 7, scale: 4 }).notNull().default("0"),
  taxIds: uuid("tax_ids").array().notNull().default([]),
  taxLineId: uuid("tax_line_id"),
  taxBaseAmount: numeric("tax_base_amount", { precision: 20, scale: 2 }),
  businessUnitId: uuid("business_unit_id"),
  branchId: uuid("branch_id"),
  icCompanyId: uuid("ic_company_id"),
  amountResidual: numeric("amount_residual", { precision: 20, scale: 2 }).notNull().default("0"),
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
