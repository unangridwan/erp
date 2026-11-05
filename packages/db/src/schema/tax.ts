import { date, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

export const TAX_DOC_STATES = ["draft", "exported", "approved", "cancelled"] as const;
export const TAX_INVOICE_STATES = ["draft", "exported", "approved", "replaced", "cancelled"] as const;

/** Faktur pajak keluaran: salinan data faktur saat dibuat, siap diekspor ke XML Coretax. */
export const taxInvoices = pgTable("tax_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  moveId: uuid("move_id").notNull(),
  state: text("state", { enum: TAX_INVOICE_STATES }).notNull().default("draft"),
  trxCode: text("trx_code").notNull(),
  addInfo: text("add_info"),
  facilityStamp: text("facility_stamp"),
  customDoc: text("custom_doc"),
  invoiceDate: date("invoice_date").notNull(),
  periodMonth: smallint("period_month").notNull(),
  periodYear: smallint("period_year").notNull(),
  ref: text("ref").notNull(),
  sellerIdtku: text("seller_idtku").notNull(),
  buyerTin: text("buyer_tin").notNull(),
  buyerDocument: text("buyer_document").notNull(),
  buyerDocumentNumber: text("buyer_document_number"),
  buyerCountry: text("buyer_country").notNull(),
  buyerName: text("buyer_name").notNull(),
  buyerAddress: text("buyer_address").notNull(),
  buyerEmail: text("buyer_email"),
  buyerIdtku: text("buyer_idtku").notNull(),
  taxBase: numeric("tax_base", { precision: 20, scale: 2 }).notNull().default("0"),
  otherTaxBase: numeric("other_tax_base", { precision: 20, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 20, scale: 2 }).notNull().default("0"),
  stlg: numeric("stlg", { precision: 20, scale: 2 }).notNull().default("0"),
  efakturNumber: text("efaktur_number"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  batchId: uuid("batch_id"),
  /** 0 = normal, 1 = uang muka, 2 = pelunasan. */
  downPayment: smallint("down_payment").notNull().default(0),
  downPaymentTaxBase: numeric("down_payment_tax_base", { precision: 20, scale: 2 }).notNull().default("0"),
  downPaymentVat: numeric("down_payment_vat", { precision: 20, scale: 2 }).notNull().default("0"),
  downPaymentStlg: numeric("down_payment_stlg", { precision: 20, scale: 2 }).notNull().default("0"),
  replacesId: uuid("replaces_id"),
  replacedNumber: text("replaced_number"),
  /** NSFP 13 digit e-Faktur 3.x (pra-Coretax). */
  nsfp: text("nsfp"),
  ...audit,
});

export const taxInvoiceLines = pgTable("tax_invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  taxInvoiceId: uuid("tax_invoice_id").notNull(),
  sequence: smallint("sequence").notNull().default(0),
  opt: text("opt", { enum: ["A", "B"] }).notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  price: numeric("price", { precision: 20, scale: 2 }).notNull(),
  qty: numeric("qty", { precision: 18, scale: 4 }).notNull(),
  totalDiscount: numeric("total_discount", { precision: 20, scale: 2 }).notNull().default("0"),
  taxBase: numeric("tax_base", { precision: 20, scale: 2 }).notNull(),
  otherTaxBase: numeric("other_tax_base", { precision: 20, scale: 2 }).notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
  vat: numeric("vat", { precision: 20, scale: 2 }).notNull(),
  stlgRate: numeric("stlg_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  stlg: numeric("stlg", { precision: 20, scale: 2 }).notNull().default("0"),
});

export const taxExportBatches = pgTable("tax_export_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind", {
    enum: ["efaktur", "bppu", "bpmp", "bpa1", "bp21", "efaktur_legacy", "retur_legacy"],
  }).notNull(),
  fileName: text("file_name").notNull(),
  content: text("content").notNull(),
  recordCount: integer("record_count").notNull(),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const inputTaxInvoices = pgTable("input_tax_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  efakturNumber: text("efaktur_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  sellerTin: text("seller_tin").notNull(),
  sellerName: text("seller_name").notNull(),
  taxBase: numeric("tax_base", { precision: 20, scale: 2 }).notNull().default("0"),
  otherTaxBase: numeric("other_tax_base", { precision: 20, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 20, scale: 2 }).notNull().default("0"),
  stlg: numeric("stlg", { precision: 20, scale: 2 }).notNull().default("0"),
  coretaxStatus: text("coretax_status"),
  partnerId: uuid("partner_id"),
  moveId: uuid("move_id"),
  state: text("state", { enum: ["new", "credited", "not_credited"] })
    .notNull()
    .default("new"),
  creditMonth: smallint("credit_month"),
  creditYear: smallint("credit_year"),
  ...audit,
});

export const withholdingSlips = pgTable("withholding_slips", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind", { enum: ["bppu", "bpmp", "bpa1", "bp21"] }).notNull(),
  state: text("state", { enum: TAX_DOC_STATES }).notNull().default("draft"),
  periodMonth: smallint("period_month").notNull(),
  periodYear: smallint("period_year").notNull(),
  partnerId: uuid("partner_id"),
  employeeId: uuid("employee_id"),
  moveId: uuid("move_id"),
  taxId: uuid("tax_id"),
  payslipId: uuid("payslip_id"),
  counterpartName: text("counterpart_name").notNull(),
  counterpartTin: text("counterpart_tin"),
  counterpartIdtku: text("counterpart_idtku"),
  ptkpStatus: text("ptkp_status"),
  position: text("position"),
  taxObjectCode: text("tax_object_code"),
  taxCertificate: text("tax_certificate").notNull().default("N/A"),
  taxBase: numeric("tax_base", { precision: 20, scale: 2 }).notNull(),
  rate: numeric("rate", { precision: 7, scale: 4 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 20, scale: 2 }).notNull(),
  /** BP21: penghasilan bruto & persentase DPP (100% pegawai tidak tetap, 50% bukan pegawai). */
  gross: numeric("gross", { precision: 20, scale: 2 }),
  deemedRate: numeric("deemed_rate", { precision: 5, scale: 2 }),
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  documentDate: date("document_date"),
  withholderIdtku: text("withholder_idtku").notNull(),
  withholdingDate: date("withholding_date").notNull(),
  bupotNumber: text("bupot_number"),
  batchId: uuid("batch_id"),
  /** BPA1: masa awal–akhir dan rincian penghasilan setahun. */
  monthStart: smallint("month_start"),
  monthEnd: smallint("month_end"),
  details: jsonb("details").$type<{
    salary: string;
    otherBenefit: string;
    incomeTaxBenefit?: string;
    insurance: string;
    bonus: string;
    pensionContribution: string;
  }>(),
  ...audit,
});

/** Rentang NSFP e-Faktur 3.x yang diberikan DJP. */
export const nsfpRanges = pgTable("nsfp_ranges", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  prefix: text("prefix").notNull(),
  serialFrom: integer("serial_from").notNull(),
  serialTo: integer("serial_to").notNull(),
  nextSerial: integer("next_serial").notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
  updatedAt: audit.updatedAt,
});

/** Nota retur pajak masukan (dari nota debit atas tagihan ber-faktur pajak). */
export const taxReturns = pgTable("tax_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  moveId: uuid("move_id").notNull(),
  inputTaxInvoiceId: uuid("input_tax_invoice_id"),
  state: text("state", { enum: TAX_DOC_STATES }).notNull().default("draft"),
  returnNumber: text("return_number").notNull(),
  returnDate: date("return_date").notNull(),
  periodMonth: smallint("period_month").notNull(),
  periodYear: smallint("period_year").notNull(),
  taxBase: numeric("tax_base", { precision: 20, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 20, scale: 2 }).notNull().default("0"),
  stlg: numeric("stlg", { precision: 20, scale: 2 }).notNull().default("0"),
  coretaxNumber: text("coretax_number"),
  batchId: uuid("batch_id"),
  createdBy: uuid("created_by"),
  ...audit,
});
