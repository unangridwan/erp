import { Decimal } from "decimal.js";
import {
  CORETAX_UOM_CODES,
  TRX_CODE_LIST,
  digitsOnly,
  xmlEscape,
  type TaxInvoiceDoc,
  type TrxCode,
} from "./coretax.js";

/**
 * Pelengkap Coretax: bukti potong A1 (BPA1), pemeriksaan isi XML faktur sebelum diunggah (DJP tidak menerbitkan XSD
 * untuk berkas impor — aturan diambil dari lembar Keterangan template impor), alokasi potongan uang muka pada faktur
 * pelunasan, PPnBM, dan format e-Faktur 3.x (pra-Coretax): NSFP dan CSV impor FK/LT/OF serta retur masukan RM.
 */

const D = (v: Decimal.Value) => new Decimal(v);
const money2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const whole = (v: Decimal.Value) => D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);

// ---- Faktur pelunasan: potongan uang muka ----

/**
 * Bagi potongan uang muka (baris negatif faktur pelunasan) ke baris positif dengan kelompok PPN yang sama, sebanding
 * DPP-nya. Hasilnya ditambahkan sebagai diskon baris sehingga DPP faktur pajak pelunasan = nilai penyerahan − uang
 * muka yang sudah dibuatkan faktur pajak. Sisa pembulatan masuk ke baris terakhir kelompok.
 */
export function allocateDeductions<T extends { group: string; taxBase: Decimal.Value }>(
  lines: T[],
  deductions: { group: string; amount: Decimal.Value }[],
): { line: T; deduction: string }[] {
  const out = lines.map((line) => ({ line, deduction: D(0) }));
  const byGroup = new Map<string, Decimal>();
  for (const x of deductions) byGroup.set(x.group, (byGroup.get(x.group) ?? D(0)).plus(D(x.amount).abs()));
  for (const [group, amount] of byGroup) {
    const members = out.filter((o) => o.line.group === group && D(o.line.taxBase).gt(0));
    const base = members.reduce((s, o) => s.plus(o.line.taxBase), D(0));
    if (amount.gt(base))
      throw new Error("Potongan uang muka melebihi DPP baris dengan pajak yang sama pada faktur pelunasan");
    if (!members.length) continue;
    let allocated = D(0);
    members.forEach((o, i) => {
      const share =
        i === members.length - 1 ? amount.minus(allocated) : money2(amount.times(o.line.taxBase).div(base));
      o.deduction = share;
      allocated = allocated.plus(share);
    });
  }
  return out.map((o) => ({ line: o.line, deduction: o.deduction.toFixed(2) }));
}

// ---- Pemeriksaan faktur sebelum ekspor ----

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Periksa satu faktur sesuai ketentuan template impor faktur keluaran Coretax: identitas penjual/pembeli, kode
 * transaksi & fasilitas, kode barang/satuan, serta rumus DPP = harga × kuantitas − diskon, DPP nilai lain, dan
 * PPN = tarif × DPP nilai lain (pembulatan komersial 2 desimal; toleransi Rp1 untuk konversi valas).
 */
export function validateTaxInvoiceDoc(doc: TaxInvoiceDoc): string[] {
  const errors: string[] = [];
  const at = (msg: string) => errors.push(`${doc.ref}: ${msg}`);
  if (!isDate(doc.invoiceDate)) at("tanggal faktur tidak valid");
  if (!TRX_CODE_LIST.includes(doc.trxCode)) at(`kode transaksi ${doc.trxCode} tidak dikenal`);
  if (digitsOnly(doc.sellerIdtku).length !== 22) at("ID TKU penjual harus 22 digit");
  if (!/^\d{16}$/.test(doc.buyerTin)) at("NPWP pembeli harus 16 digit (0000000000000000 bila tanpa NPWP)");
  if (!/^\d{22}$/.test(doc.buyerIdtku)) at("ID TKU pembeli harus 22 digit");
  if (doc.buyerDocument === "TIN") {
    if (/^0+$/.test(doc.buyerTin)) at("jenis dokumen NPWP tetapi NPWP pembeli kosong");
  } else {
    if (!doc.buyerDocumentNumber) at(`nomor ${doc.buyerDocument} pembeli wajib diisi`);
    if (doc.buyerDocument === "National ID" && !/^\d{16}$/.test(doc.buyerDocumentNumber ?? ""))
      at("NIK pembeli harus 16 digit");
  }
  if (!/^[A-Z]{3}$/.test(doc.buyerCountry)) at("kode negara pembeli harus 3 huruf (mis. IDN)");
  if (!doc.buyerName.trim()) at("nama pembeli wajib diisi");
  if (!doc.buyerAddress.trim()) at("alamat pembeli wajib diisi");
  if (doc.buyerEmail && !EMAIL.test(doc.buyerEmail)) at("email pembeli tidak valid");
  if ((doc.trxCode === "07" || doc.trxCode === "08") && (!doc.addInfo || !doc.facilityStamp))
    at(`kode ${doc.trxCode} wajib mengisi keterangan tambahan & cap fasilitas`);
  if (!doc.ref.trim()) errors.push("referensi faktur wajib diisi");
  if (!doc.lines.length) at("faktur tanpa baris barang/jasa");
  doc.lines.forEach((l, i) => {
    const row = (msg: string) => at(`baris ${i + 1} (${l.name}): ${msg}`);
    if (l.opt !== "A" && l.opt !== "B") row("jenis harus A (barang) atau B (jasa)");
    if (!/^\d{6}$/.test(l.code)) row("kode barang/jasa harus 6 digit");
    if (!CORETAX_UOM_CODES[l.unit]) row(`kode satuan ${l.unit} tidak dikenal`);
    if (!l.name.trim()) row("nama barang/jasa wajib diisi");
    const price = D(l.price);
    const qty = D(l.qty);
    const discount = D(l.totalDiscount);
    const base = D(l.taxBase);
    if (price.lt(0) || qty.lte(0) || discount.lt(0) || base.lt(0))
      row("harga, kuantitas, diskon & DPP tidak boleh negatif");
    if (money2(price.times(qty).minus(discount)).minus(base).abs().gt(1))
      row(
        `DPP ${base.toFixed(2)} ≠ harga × kuantitas − diskon (${money2(price.times(qty).minus(discount)).toFixed(2)})`,
      );
    if (D(l.otherTaxBase).lt(0) || D(l.otherTaxBase).gt(base.plus(0.01)))
      row("DPP nilai lain harus 0 s.d. DPP");
    if (money2(D(l.otherTaxBase).times(l.vatRate).div(100)).minus(l.vat).abs().gt(0.01))
      row("PPN ≠ tarif × DPP nilai lain");
    if (money2(D(l.otherTaxBase).times(l.stlgRate).div(100)).minus(l.stlg).abs().gt(0.01))
      row("PPnBM ≠ tarif × DPP");
  });
  return errors;
}

// ---- Bukti potong A1 (pegawai tetap, tahunan) ----

export interface Bpa1Record {
  periodYear: number;
  monthStart: number;
  monthEnd: number;
  /** NIK/NPWP 16 digit pegawai. */
  counterpartTin: string;
  ptkpStatus: string;
  position: string;
  taxObjectCode: string;
  /** Gaji/pensiun atau THT/JHT (setahun). */
  salary: Decimal.Value;
  /** Tunjangan lainnya, uang lembur, dsb. */
  otherBenefit: Decimal.Value;
  /** Premi asuransi yang dibayar pemberi kerja (JKK, JKM, BPJS Kesehatan). */
  insurance: Decimal.Value;
  /** Tantiem, bonus, gratifikasi, jasa produksi & THR. */
  bonus: Decimal.Value;
  /** Iuran pensiun/JHT/JP yang dibayar pegawai. */
  pensionContribution: Decimal.Value;
  /** PPh 21 terutang setahun. */
  pph21: Decimal.Value;
  taxCertificate: string;
  withholderIdtku: string;
  withholdingDate: string;
}

/** Kode objek pajak A1: pegawai tetap. */
export const PPH21_A1_OBJECT_CODE = "21-100-01";

/** Rincian formulir 1721-A1: bruto, biaya jabatan, neto, PTKP, PKP. */
export function bpa1Summary(
  r: Pick<
    Bpa1Record,
    "salary" | "otherBenefit" | "insurance" | "bonus" | "pensionContribution" | "monthStart" | "monthEnd"
  >,
) {
  const gross = D(r.salary).plus(r.otherBenefit).plus(r.insurance).plus(r.bonus);
  const months = r.monthEnd - r.monthStart + 1;
  const position = Decimal.min(gross.times(0.05), D(500_000).times(months));
  return {
    gross: whole(gross),
    months,
    positionCost: whole(position),
    neto: whole(gross.minus(position).minus(r.pensionContribution)),
  };
}

/**
 * XML impor BPA1 untuk e-Bupot PPh 21/26 Coretax, mengikuti susunan kolom template konverter DJP (bukan XSD resmi —
 * DJP tidak menerbitkannya). Nilai dalam Rupiah bulat.
 */
export function bpa1Xml(withholderTin: string, records: Bpa1Record[]): string {
  const el = (name: string, v: string | number | null | undefined, indent: string) => {
    const t = xmlEscape(v);
    return t === "" ? `${indent}<${name}/>` : `${indent}<${name}>${t}</${name}>`;
  };
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<A1Bulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="schema.xsd">',
    el("TIN", withholderTin, "  "),
    "  <ListOfA1>",
    ...records.map((r) =>
      [
        "    <A1>",
        ...(
          [
            ["WorkForSecondEmployer", "No"],
            ["TaxPeriodMonthStart", r.monthStart],
            ["TaxPeriodMonthEnd", r.monthEnd],
            ["TaxPeriodYear", r.periodYear],
            ["CounterpartOpt", "Resident"],
            ["CounterpartPassport", ""],
            ["CounterpartTin", r.counterpartTin],
            ["StatusTaxExemption", r.ptkpStatus],
            ["Position", r.position],
            ["TaxObjectCode", r.taxObjectCode],
            ["NumberOfMonths", r.monthEnd - r.monthStart + 1],
            ["SalaryPensionJhtTht", whole(r.salary)],
            ["GrossUpOpt", "No"],
            ["IncomeTaxBenefit", "0"],
            ["OtherBenefit", whole(r.otherBenefit)],
            ["Honorarium", "0"],
            ["InsurancePaidByEmployer", whole(r.insurance)],
            ["Natura", "0"],
            ["TantiemBonusThr", whole(r.bonus)],
            ["PensionContributionJhtThtFee", whole(r.pensionContribution)],
            ["Zakat", "0"],
            ["PrevWhTaxSlip", ""],
            ["TaxCertificate", r.taxCertificate],
            ["Article21IncomeTax", whole(r.pph21)],
            ["IDPlaceOfBusinessActivity", r.withholderIdtku],
            ["WithholdingDate", r.withholdingDate],
          ] as [string, string | number][]
        ).map(([k, v]) => el(k, v, "      ")),
        "    </A1>",
      ].join("\n"),
    ),
    "  </ListOfA1>",
    "</A1Bulk>",
    "",
  ].join("\n");
}

// ---- e-Faktur 3.x (pra-Coretax) ----

/** NSFP 13 digit: 3 digit kode + 2 digit tahun + 8 digit nomor urut. */
export function parseNsfp(v: string): string | null {
  const d = digitsOnly(v);
  return d.length === 13 ? d : null;
}

/** Tampilan NSFP "xxx-yy.zzzzzzzz"; dengan kode transaksi & status menjadi nomor faktur lengkap "010.xxx-yy.zzzzzzzz". */
export function formatNsfp(nsfp: string, trxCode?: string, replacement = false) {
  const s = `${nsfp.slice(0, 3)}-${nsfp.slice(3, 5)}.${nsfp.slice(5)}`;
  return trxCode ? `${trxCode}${replacement ? 1 : 0}.${s}` : s;
}

/** Rentang NSFP dari DJP: awal & akhir harus sama 5 digit pertama. */
export function nsfpRange(start: string, end: string) {
  const a = parseNsfp(start);
  const b = parseNsfp(end);
  if (!a || !b) throw new Error("NSFP harus 13 digit");
  if (a.slice(0, 5) !== b.slice(0, 5))
    throw new Error("Awal & akhir rentang NSFP harus berkode & bertahun sama");
  const from = Number(a.slice(5));
  const to = Number(b.slice(5));
  if (to < from) throw new Error("Akhir rentang NSFP lebih kecil dari awal");
  return { prefix: a.slice(0, 5), from, to, count: to - from + 1 };
}

export const nsfpAt = (prefix: string, serial: number) => `${prefix}${String(serial).padStart(8, "0")}`;

export interface LegacyInvoice {
  trxCode: string;
  replacement: boolean;
  nsfp: string;
  periodMonth: number;
  periodYear: number;
  invoiceDate: string;
  /** NPWP 15 digit; kosong = pembeli tanpa NPWP. */
  buyerNpwp15: string | null;
  buyerNik: string | null;
  buyerName: string;
  buyerAddress: string;
  /** 0 normal, 1 uang muka, 2 pelunasan. */
  downPayment: 0 | 1 | 2;
  downPaymentAmounts?: { dpp: Decimal.Value; ppn: Decimal.Value; ppnbm: Decimal.Value };
  ref: string;
  lines: {
    code: string;
    name: string;
    price: Decimal.Value;
    qty: Decimal.Value;
    discount: Decimal.Value;
    dpp: Decimal.Value;
    ppn: Decimal.Value;
    stlgRate: Decimal.Value;
    stlg: Decimal.Value;
  }[];
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(",");
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");

/** NPWP 15 digit dari NPWP 16 digit berawalan 0 (format lama). */
export function npwp15(v: string | null | undefined): string | null {
  const d = digitsOnly(v);
  if (d.length === 15) return d;
  if (d.length === 16 && d.startsWith("0")) return d.slice(1);
  return null;
}

/**
 * CSV impor e-Faktur 3.x (FK/LT/OF). Pembeli tanpa NPWP: NPWP 000000000000000 dan nama "NIK#NIK#NAMA#nama".
 * Faktur pengganti: FG_PENGGANTI 1 dengan NSFP faktur yang diganti. Pelunasan (FG_UANG_MUKA 2) mencantumkan
 * DPP/PPN/PPnBM uang muka yang sudah difakturkan.
 */
export function legacyEfakturCsv(invoices: LegacyInvoice[]): string {
  const rows: string[] = [
    "FK,KD_JENIS_TRANSAKSI,FG_PENGGANTI,NOMOR_FAKTUR,MASA_PAJAK,TAHUN_PAJAK,TANGGAL_FAKTUR,NPWP,NAMA,ALAMAT_LENGKAP,JUMLAH_DPP,JUMLAH_PPN,JUMLAH_PPNBM,ID_KETERANGAN_TAMBAHAN,FG_UANG_MUKA,UANG_MUKA_DPP,UANG_MUKA_PPN,UANG_MUKA_PPNBM,REFERENSI,KODE_DOKUMEN_PENDUKUNG",
    "LT,NPWP,NAMA,JALAN,BLOK,NOMOR,RT,RW,KECAMATAN,KELURAHAN,KABUPATEN,PROPINSI,KODE_POS,NOMOR_TELEPON",
    "OF,KODE_OBJEK,NAMA,HARGA_SATUAN,JUMLAH_BARANG,HARGA_TOTAL,DISKON,DPP,PPN,TARIF_PPNBM,PPNBM",
  ];
  for (const inv of invoices) {
    const sum = (k: "dpp" | "ppn" | "stlg") =>
      inv.lines.reduce((s, l) => s.plus(D(l[k]).floor()), D(0)).toFixed(0);
    const npwp = inv.buyerNpwp15 ?? "000000000000000";
    const name =
      inv.buyerNpwp15 || !inv.buyerNik ? inv.buyerName : `${inv.buyerNik}#NIK#NAMA#${inv.buyerName}`;
    const dp = inv.downPaymentAmounts;
    rows.push(
      csvRow([
        "FK",
        inv.trxCode,
        inv.replacement ? 1 : 0,
        inv.nsfp,
        inv.periodMonth,
        inv.periodYear,
        ddmmyyyy(inv.invoiceDate),
        npwp,
        name,
        inv.buyerAddress,
        sum("dpp"),
        sum("ppn"),
        sum("stlg"),
        "",
        inv.downPayment,
        dp ? whole(dp.dpp) : 0,
        dp ? whole(dp.ppn) : 0,
        dp ? whole(dp.ppnbm) : 0,
        inv.ref,
        "",
      ]),
    );
    for (const l of inv.lines)
      rows.push(
        csvRow([
          "OF",
          l.code,
          l.name,
          D(l.price).toFixed(2),
          D(l.qty).toString(),
          D(l.price).times(l.qty).toFixed(2),
          D(l.discount).toFixed(2),
          D(l.dpp).toFixed(2),
          D(l.ppn).toFixed(2),
          D(l.stlgRate).toString(),
          D(l.stlg).toFixed(2),
        ]),
      );
  }
  return `${rows.join("\r\n")}\r\n`;
}

export interface LegacyReturn {
  sellerNpwp15: string;
  sellerName: string;
  /** Nomor faktur lama 16 digit: kode transaksi (2) + status (1) + NSFP (13). */
  efakturNumber: string;
  invoiceDate: string;
  creditable: boolean;
  returnNumber: string;
  returnDate: string;
  periodMonth: number;
  periodYear: number;
  dpp: Decimal.Value;
  ppn: Decimal.Value;
  ppnbm: Decimal.Value;
}

/** CSV impor retur pajak masukan e-Faktur 3.x (RM). */
export function legacyReturnCsv(rows: LegacyReturn[]): string {
  const out = [
    "RM,NPWP,NAMA,KD_JENIS_TRANSAKSI,FG_PENGGANTI,NOMOR_FAKTUR,TANGGAL_FAKTUR,IS_CREDITABLE,NOMOR_DOKUMEN_RETUR,TANGGAL_RETUR,MASA_PAJAK_RETUR,TAHUN_PAJAK_RETUR,NILAI_RETUR,NILAI_RETUR_PPN,NILAI_RETUR_PPNBM",
  ];
  for (const r of rows) {
    const n = digitsOnly(r.efakturNumber);
    if (n.length !== 16)
      throw new Error(`Nomor faktur ${r.efakturNumber} bukan format e-Faktur lama (16 digit)`);
    out.push(
      csvRow([
        "RM",
        r.sellerNpwp15,
        r.sellerName,
        n.slice(0, 2),
        n.slice(2, 3),
        n.slice(3),
        ddmmyyyy(r.invoiceDate),
        r.creditable ? 1 : 0,
        r.returnNumber,
        ddmmyyyy(r.returnDate),
        r.periodMonth,
        r.periodYear,
        whole(r.dpp),
        whole(r.ppn),
        whole(r.ppnbm),
      ]),
    );
  }
  return `${out.join("\r\n")}\r\n`;
}

/** Kode transaksi e-Faktur lama: DPP nilai lain 11/12 dilaporkan dengan kode 04. */
export function legacyTrxCode(trxCode: TrxCode, otherBaseDiffers: boolean): string {
  return trxCode === "01" && otherBaseDiffers ? "04" : trxCode;
}
