import { Decimal } from "decimal.js";
import { parseBankAmount, parseBankDate } from "./bank-import.js";

/**
 * Lokalisasi pajak Indonesia untuk Coretax DJP (berlaku 2025): faktur pajak keluaran (XML
 * TaxInvoiceBulk), bukti potong unifikasi PPh 23/4(2)/22 (BPPU) dan bukti potong bulanan PPh 21
 * pegawai tetap (BPMP), serta impor daftar faktur pajak masukan.
 */

/** Kode transaksi faktur pajak (PER-03/PJ/2022 jo. PMK 131/2024). */
export const TRX_CODES = {
  "01": "01 — Kepada pihak yang bukan pemungut PPN",
  "02": "02 — Kepada instansi pemerintah (pemungut)",
  "03": "03 — Kepada pemungut selain instansi pemerintah",
  "04": "04 — DPP nilai lain (11/12)",
  "05": "05 — Besaran tertentu",
  "06": "06 — Kepada turis asing (PPN dikembalikan)",
  "07": "07 — PPN tidak dipungut / ditanggung pemerintah",
  "08": "08 — PPN dibebaskan",
  "09": "09 — Penyerahan aktiva (Pasal 16D)",
  "10": "10 — Penyerahan lainnya",
} as const;
export type TrxCode = keyof typeof TRX_CODES;
export const TRX_CODE_LIST = Object.keys(TRX_CODES) as TrxCode[];

export const BUYER_DOCUMENTS = ["TIN", "National ID", "Passport", "Other ID"] as const;
export type BuyerDocument = (typeof BUYER_DOCUMENTS)[number];

/** Kode satuan Coretax (referensi DJP). */
export const CORETAX_UOM_CODES: Record<string, string> = {
  "UM.0001": "Metrik Ton",
  "UM.0002": "Wet Ton",
  "UM.0003": "Kilogram",
  "UM.0004": "Gram",
  "UM.0005": "Karat",
  "UM.0006": "Kiloliter",
  "UM.0007": "Liter",
  "UM.0008": "Barrel",
  "UM.0009": "MMBTU",
  "UM.0010": "Ampere",
  "UM.0011": "Sentimeter Kubik",
  "UM.0012": "Meter Persegi",
  "UM.0013": "Meter",
  "UM.0014": "Inci",
  "UM.0015": "Sentimeter",
  "UM.0016": "Yard",
  "UM.0017": "Lusin",
  "UM.0018": "Unit",
  "UM.0019": "Set",
  "UM.0020": "Lembar",
  "UM.0021": "Piece",
  "UM.0022": "Boks",
  "UM.0023": "Tahun",
  "UM.0024": "Bulan",
  "UM.0025": "Minggu",
  "UM.0026": "Hari",
  "UM.0027": "Jam",
  "UM.0028": "Menit",
  "UM.0029": "Persen",
  "UM.0030": "Kegiatan",
  "UM.0031": "Laporan",
  "UM.0032": "Bahan",
  "UM.0033": "Lainnya",
  "UM.0034": "Meter Kubik",
  "UM.0035": "Sentimeter Persegi",
  "UM.0036": "Drum",
  "UM.0037": "Karton",
  "UM.0038": "Kwh",
  "UM.0039": "Roll",
};
/** Satuan bila produk tidak dipetakan. */
export const DEFAULT_UOM_CODE = "UM.0033";
/** Kode barang/jasa 6 digit; "000000" = umum. */
export const DEFAULT_GOODS_CODE = "000000";

/** Hanya digit. */
export const digitsOnly = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * NPWP 16 digit untuk Coretax. NPWP lama 15 digit diubah dengan menambah "0" di depan
 * (ketentuan DJP sejak 2024); NIK 16 digit dipakai apa adanya.
 */
export function tin16(v: string | null | undefined): string | null {
  const d = digitsOnly(v);
  if (d.length === 15) return `0${d}`;
  return d.length === 16 ? d : null;
}

/** ID TKU 22 digit = NPWP 16 digit + 6 digit tempat kegiatan usaha (000000 = pusat). */
export function idtku(tin: string | null | undefined, tku: string | null | undefined = "000000") {
  const full = digitsOnly(tku);
  if (full.length === 22) return full;
  const base = tin16(tin);
  const suffix = full.padStart(6, "0").slice(-6);
  return base ? `${base}${suffix}` : null;
}

const D = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal.Value) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const whole = (v: Decimal.Value) => D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
const plain = (v: Decimal.Value) => D(v).toDecimalPlaces(4).toString();

export interface TaxInvoiceLineInput {
  name: string;
  isService: boolean;
  goodsCode?: string | null;
  unitCode?: string | null;
  /** Harga satuan sebelum diskon & pajak, dalam Rupiah. */
  price: Decimal.Value;
  qty: Decimal.Value;
  /** Diskon persen. */
  discount: Decimal.Value;
  /** Diskon tambahan (Rupiah), mis. bagian potongan uang muka pada faktur pelunasan. */
  extraDiscount?: Decimal.Value;
  /** DPP (subtotal setelah diskon) dalam Rupiah. */
  taxBase: Decimal.Value;
  /** Pajak PPN pada baris: tarif & rasio DPP (11/12 untuk non-mewah). */
  vat?: { rate: Decimal.Value; baseRatio: Decimal.Value } | null;
  /** Tarif PPnBM (STLG) bila ada. */
  stlgRate?: Decimal.Value | null;
}

export interface TaxInvoiceLine {
  opt: "A" | "B";
  code: string;
  name: string;
  unit: string;
  price: string;
  qty: string;
  totalDiscount: string;
  taxBase: string;
  otherTaxBase: string;
  vatRate: string;
  vat: string;
  stlgRate: string;
  stlg: string;
}

const ELEVEN_TWELFTHS = D(11).div(12);

/**
 * Hitung satu baris GoodService. DPP nilai lain = DPP × rasio pajak (11/12 untuk PPN non-mewah,
 * 1 untuk barang mewah). Untuk kode 07/08 (tidak dipungut/dibebaskan) PPN tetap dihitung 12% sebagai
 * informasi walau tidak ditagih.
 */
export function taxInvoiceLine(input: TaxInvoiceLineInput, trxCode: TrxCode): TaxInvoiceLine {
  const taxBase = D(input.taxBase);
  if (taxBase.lt(0)) throw new Error(`Baris "${input.name}" bernilai negatif`);
  const price = D(input.price);
  const qty = D(input.qty);
  const discount = price
    .times(qty)
    .times(D(input.discount))
    .div(100)
    .plus(input.extraDiscount ?? 0);
  let vatRate = D(input.vat?.rate ?? 0);
  let ratio = D(input.vat?.baseRatio ?? 1);
  if ((trxCode === "07" || trxCode === "08") && input.vat && vatRate.isZero()) {
    vatRate = D(12);
    ratio = ELEVEN_TWELFTHS;
  }
  // Rasio 0.9166666667 di database adalah pembulatan 11/12; pakai pecahan tepat agar DPP tidak meleset.
  if (ratio.minus(ELEVEN_TWELFTHS).abs().lt("0.0000001")) ratio = ELEVEN_TWELFTHS;
  const otherTaxBase = input.vat ? taxBase.times(ratio) : D(0);
  const otherRounded = D(money(otherTaxBase));
  const stlgRate = D(input.stlgRate ?? 0);
  return {
    opt: input.isService ? "B" : "A",
    code: digitsOnly(input.goodsCode) || DEFAULT_GOODS_CODE,
    name: input.name.slice(0, 500),
    unit: input.unitCode || DEFAULT_UOM_CODE,
    price: money(price),
    qty: plain(qty),
    totalDiscount: money(discount),
    taxBase: money(taxBase),
    otherTaxBase: otherRounded.toFixed(2),
    vatRate: plain(vatRate),
    vat: money(otherRounded.times(vatRate).div(100)),
    stlgRate: plain(stlgRate),
    stlg: money(otherRounded.times(stlgRate).div(100)),
  };
}

export interface TaxInvoiceDoc {
  invoiceDate: string;
  trxCode: TrxCode;
  addInfo?: string | null;
  customDoc?: string | null;
  facilityStamp?: string | null;
  ref: string;
  sellerIdtku: string;
  buyerTin: string;
  buyerDocument: BuyerDocument;
  buyerDocumentNumber?: string | null;
  buyerCountry: string;
  buyerName: string;
  buyerAddress: string;
  buyerEmail?: string | null;
  buyerIdtku: string;
  lines: TaxInvoiceLine[];
}

/** Total faktur dari baris-barisnya. */
export function taxInvoiceTotals(lines: TaxInvoiceLine[]) {
  const sum = (k: keyof TaxInvoiceLine) => lines.reduce((s, l) => s.plus(l[k]), D(0)).toFixed(2);
  return { taxBase: sum("taxBase"), otherTaxBase: sum("otherTaxBase"), vat: sum("vat"), stlg: sum("stlg") };
}

/** Escape teks untuk isi elemen XML. */
export function xmlEscape(v: string | number | null | undefined): string {
  return (
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Karakter kontrol (selain tab/baris baru) tidak sah di XML 1.0.
      .split("")
      .filter((c) => {
        const code = c.charCodeAt(0);
        return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
      })
      .join("")
  );
}

function element(name: string, value: string | number | null | undefined, indent: string) {
  const text = xmlEscape(value);
  return text === "" ? `${indent}<${name}/>` : `${indent}<${name}>${text}</${name}>`;
}

function block(name: string, fields: [string, string | number | null | undefined][], indent: string) {
  return [
    `${indent}<${name}>`,
    ...fields.map(([k, v]) => element(k, v, `${indent}  `)),
    `${indent}</${name}>`,
  ].join("\n");
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const XSI = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

/** XML impor faktur pajak keluaran Coretax (maks. 1.000 faktur per berkas). */
export function efakturXml(sellerTin: string, docs: TaxInvoiceDoc[]): string {
  if (docs.length > 1000) throw new Error("Maksimal 1.000 faktur per berkas XML");
  const invoices = docs.map((doc) =>
    [
      "    <TaxInvoice>",
      ...(
        [
          ["TaxInvoiceDate", doc.invoiceDate],
          ["TaxInvoiceOpt", "Normal"],
          ["TrxCode", doc.trxCode],
          ["AddInfo", doc.addInfo],
          ["CustomDoc", doc.customDoc],
          ["CustomDocMonthYear", ""],
          ["RefDesc", doc.ref],
          ["FacilityStamp", doc.facilityStamp],
          ["SellerIDTKU", doc.sellerIdtku],
          ["BuyerTin", doc.buyerTin],
          ["BuyerDocument", doc.buyerDocument],
          ["BuyerCountry", doc.buyerCountry],
          ["BuyerDocumentNumber", doc.buyerDocumentNumber],
          ["BuyerName", doc.buyerName],
          // Ejaan "Adress" sesuai skema resmi Coretax.
          ["BuyerAdress", doc.buyerAddress],
          ["BuyerEmail", doc.buyerEmail],
          ["BuyerIDTKU", doc.buyerIdtku],
        ] as [string, string | null | undefined][]
      ).map(([k, v]) => element(k, v, "      ")),
      "      <ListOfGoodService>",
      ...doc.lines.map((l) =>
        block(
          "GoodService",
          [
            ["Opt", l.opt],
            ["Code", l.code],
            ["Name", l.name],
            ["Unit", l.unit],
            ["Price", l.price],
            ["Qty", l.qty],
            ["TotalDiscount", l.totalDiscount],
            ["TaxBase", l.taxBase],
            ["OtherTaxBase", l.otherTaxBase],
            ["VATRate", l.vatRate],
            ["VAT", l.vat],
            ["STLGRate", l.stlgRate],
            ["STLG", l.stlg],
          ],
          "        ",
        ),
      ),
      "      </ListOfGoodService>",
      "    </TaxInvoice>",
    ].join("\n"),
  );
  return [
    XML_HEADER,
    `<TaxInvoiceBulk ${XSI} xsi:noNamespaceSchemaLocation="TaxInvoice.xsd">`,
    element("TIN", sellerTin, "  "),
    "  <ListOfTaxInvoice>",
    ...invoices,
    "  </ListOfTaxInvoice>",
    "</TaxInvoiceBulk>",
    "",
  ].join("\n");
}

export interface BppuRecord {
  periodMonth: number;
  periodYear: number;
  counterpartTin: string;
  counterpartIdtku: string;
  taxCertificate: string;
  taxObjectCode: string;
  taxBase: Decimal.Value;
  rate: Decimal.Value;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  withholderIdtku: string;
  withholdingDate: string;
}

/** Jenis dokumen dasar pemotongan BPPU. */
export const BPPU_DOCUMENT_TYPES = ["CommercialInvoice", "Contract", "PaymentProof", "Other"] as const;

/** XML impor bukti potong unifikasi (BPPU) PPh 23/4(2)/22 untuk e-Bupot Unifikasi Coretax. */
export function bppuXml(withholderTin: string, records: BppuRecord[]): string {
  return [
    XML_HEADER,
    `<BpuBulk ${XSI} xsi:noNamespaceSchemaLocation="schema.xsd">`,
    element("TIN", withholderTin, "  "),
    "  <ListOfBpu>",
    ...records.map((r) =>
      block(
        "Bpu",
        [
          ["TaxPeriodMonth", r.periodMonth],
          ["TaxPeriodYear", r.periodYear],
          ["CounterpartTin", r.counterpartTin],
          ["IDPlaceOfBusinessActivityOfIncomeRecipient", r.counterpartIdtku],
          ["TaxCertificate", r.taxCertificate],
          ["TaxObjectCode", r.taxObjectCode],
          ["TaxBase", whole(r.taxBase)],
          ["Rate", plain(r.rate)],
          ["Document", r.documentType],
          ["DocumentNumber", r.documentNumber],
          ["DocumentDate", r.documentDate],
          ["IDPlaceOfBusinessActivity", r.withholderIdtku],
          ["GovTreasurerOpt", "N/A"],
          ["SP2DNumber", ""],
          ["WithholdingDate", r.withholdingDate],
        ],
        "    ",
      ),
    ),
    "  </ListOfBpu>",
    "</BpuBulk>",
    "",
  ].join("\n");
}

export interface BpmpRecord {
  periodMonth: number;
  periodYear: number;
  /** NIK/NPWP 16 digit pegawai. */
  counterpartTin: string;
  ptkpStatus: string;
  position: string;
  taxCertificate: string;
  taxObjectCode: string;
  gross: Decimal.Value;
  /** Tarif efektif TER (persen). */
  rate: Decimal.Value;
  withholderIdtku: string;
  withholdingDate: string;
}

/** Kode objek pajak penghasilan pegawai tetap. */
export const PPH21_PERMANENT_OBJECT_CODE = "21-100-01";

/** XML impor bukti potong bulanan PPh 21 pegawai tetap (BPMP) untuk e-Bupot PPh 21/26 Coretax. */
export function bpmpXml(withholderTin: string, records: BpmpRecord[]): string {
  return [
    XML_HEADER,
    `<MmPayrollBulk ${XSI} xsi:noNamespaceSchemaLocation="schema.xsd">`,
    element("TIN", withholderTin, "  "),
    "  <ListOfMmPayroll>",
    ...records.map((r) =>
      block(
        "MmPayroll",
        [
          ["TaxPeriodMonth", r.periodMonth],
          ["TaxPeriodYear", r.periodYear],
          ["CounterpartOpt", "Resident"],
          ["CounterpartPassport", ""],
          ["CounterpartTin", r.counterpartTin],
          ["StatusTaxExemption", r.ptkpStatus],
          ["Position", r.position],
          ["TaxCertificate", r.taxCertificate],
          ["TaxObjectCode", r.taxObjectCode],
          ["Gross", whole(r.gross)],
          ["Rate", plain(r.rate)],
          ["IDPlaceOfBusinessActivity", r.withholderIdtku],
          ["WithholdingDate", r.withholdingDate],
        ],
        "    ",
      ),
    ),
    "  </ListOfMmPayroll>",
    "</MmPayrollBulk>",
    "",
  ].join("\n");
}

// ---- Impor faktur pajak masukan ----

export interface InputTaxInvoiceRow {
  efakturNumber: string;
  invoiceDate: string;
  sellerTin: string;
  sellerName: string;
  taxBase: string;
  otherTaxBase: string;
  vat: string;
  stlg: string;
  coretaxStatus: string | null;
}

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Kandidat judul kolom (sudah dinormalisasi) untuk daftar faktur masukan unduhan Coretax. */
const INPUT_COLUMNS: Record<keyof InputTaxInvoiceRow, string[]> = {
  sellerTin: ["npwppenjual", "npwppkppenjual", "npwp"],
  sellerName: ["namapenjual", "namapkppenjual", "nama"],
  efakturNumber: ["nomorfakturpajak", "nofakturpajak", "nomorfaktur"],
  invoiceDate: ["tanggalfakturpajak", "tanggalfaktur", "tanggal"],
  taxBase: ["hargajualpenggantiandpp", "hargajual", "dpp"],
  otherTaxBase: ["dppnilailaindpp", "dppnilailain"],
  vat: ["ppn"],
  stlg: ["ppnbm"],
  coretaxStatus: ["statusfaktur", "status"],
};

/**
 * Urai baris CSV daftar faktur pajak masukan (unduhan menu Pajak Masukan Coretax). Kolom dikenali
 * dari judulnya; angka format Indonesia (1.234.567,00) maupun 1234567.00 diterima.
 */
export function parseInputTaxInvoices(rows: Record<string, string>[]) {
  const headers = Object.keys(rows[0] ?? {});
  const normalized = headers.map((h) => [normalizeHeader(h), h] as const);
  const column = {} as Record<keyof InputTaxInvoiceRow, string | undefined>;
  const used = new Set<string>();
  for (const [field, candidates] of Object.entries(INPUT_COLUMNS) as [keyof InputTaxInvoiceRow, string[]][]) {
    for (const candidate of candidates) {
      const hit = normalized.find(([n, h]) => !used.has(h) && n === candidate);
      if (hit) {
        column[field] = hit[1];
        used.add(hit[1]);
        break;
      }
    }
  }
  const missing = (["sellerTin", "efakturNumber", "invoiceDate", "vat"] as const).filter((f) => !column[f]);
  if (missing.length) throw new Error(`Kolom tidak ditemukan: ${missing.join(", ")}`);

  const amount = (raw: string | undefined) => {
    const s = raw?.trim() ?? "";
    if (!s) return "0.00";
    // "1.234.567,89" (Indonesia) vs "1234567.89": koma terakhir setelah titik berarti desimal koma.
    const decimal = /,\d{1,2}$/.test(s) || (s.includes(".") && /\.\d{3}(\.|$)/.test(s)) ? "," : ".";
    return parseBankAmount(s, decimal) ?? "0.00";
  };
  const date = (raw: string | undefined) =>
    parseBankDate(raw, /^\d{4}/.test(raw?.trim() ?? "") ? "YYYY-MM-DD" : "DD/MM/YYYY");

  const items: InputTaxInvoiceRow[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const get = (f: keyof InputTaxInvoiceRow) => (column[f] ? row[column[f]!] : undefined);
    const efakturNumber = digitsOnly(get("efakturNumber"));
    if (!efakturNumber) return;
    const invoiceDate = date(get("invoiceDate"));
    const sellerTin = tin16(get("sellerTin"));
    if (!invoiceDate) return errors.push({ row: i + 2, message: "Tanggal faktur tidak valid" });
    if (!sellerTin) return errors.push({ row: i + 2, message: "NPWP penjual tidak valid" });
    const taxBase = amount(get("taxBase"));
    items.push({
      efakturNumber,
      invoiceDate,
      sellerTin,
      sellerName: get("sellerName")?.trim() || sellerTin,
      taxBase,
      otherTaxBase: column.otherTaxBase ? amount(get("otherTaxBase")) : taxBase,
      vat: amount(get("vat")),
      stlg: amount(get("stlg")),
      coretaxStatus: get("coretaxStatus")?.trim() || null,
    });
  });
  return { items, errors };
}

/** Rekap SPT Masa PPN: kurang (positif) atau lebih (negatif) bayar. */
export function vatPosition(output: Decimal.Value, input: Decimal.Value) {
  const diff = D(output).minus(input);
  return {
    payable: diff.toFixed(2),
    status: diff.gt(0) ? "kurang_bayar" : diff.lt(0) ? "lebih_bayar" : "nihil",
  };
}

/**
 * Urai daftar faktur keluaran unduhan Coretax untuk mencatat nomor faktur yang sudah terbit:
 * dicocokkan dengan referensi (RefDesc = nomor faktur penjualan di ERP).
 */
export function parseCoretaxNumbers(rows: Record<string, string>[]) {
  const headers = Object.keys(rows[0] ?? {});
  const find = (candidates: string[]) => headers.find((h) => candidates.includes(normalizeHeader(h)));
  const refCol = find(["referensi", "refdesc", "reference", "nomorreferensi"]);
  const numberCol = find(["nomorfakturpajak", "nofakturpajak", "nomorfaktur"]);
  const statusCol = find(["statusfaktur", "status"]);
  if (!refCol || !numberCol) throw new Error("Kolom Referensi dan Nomor Faktur Pajak wajib ada");
  return rows
    .map((r) => ({
      ref: r[refCol]?.trim() ?? "",
      number: digitsOnly(r[numberCol]),
      status: statusCol ? (r[statusCol]?.trim().toUpperCase() ?? "") : "",
    }))
    .filter((r) => r.ref && r.number);
}

/** Status Coretax yang berarti faktur sudah terbit. */
export const isApprovedStatus = (status: string) => !status || /APPROVED|DISETUJUI|NORMAL/.test(status);
