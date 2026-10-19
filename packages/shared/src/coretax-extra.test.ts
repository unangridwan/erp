import { describe, expect, it } from "vitest";
import { efakturXml, taxInvoiceLine, type TaxInvoiceDoc } from "./coretax.js";
import {
  allocateDeductions,
  bpa1Summary,
  bpa1Xml,
  formatNsfp,
  legacyEfakturCsv,
  legacyReturnCsv,
  npwp15,
  nsfpAt,
  nsfpRange,
  validateTaxInvoiceDoc,
} from "./coretax-extra.js";

const DPP_11_12 = "0.9166666667";

const doc = (over: Partial<TaxInvoiceDoc> = {}): TaxInvoiceDoc => ({
  invoiceDate: "2026-03-10",
  trxCode: "04",
  ref: "INV/2026/0001",
  sellerIdtku: "0012345678901000000000",
  buyerTin: "0098765432109000",
  buyerDocument: "TIN",
  buyerCountry: "IDN",
  buyerName: "PT Pembeli",
  buyerAddress: "Jl. Merdeka 1, Jakarta",
  buyerIdtku: "0098765432109000000000",
  lines: [
    taxInvoiceLine(
      {
        name: "Barang",
        isService: false,
        unitCode: "UM.0018",
        price: 1_000_000,
        qty: 2,
        discount: 10,
        taxBase: 1_800_000,
        vat: { rate: 12, baseRatio: DPP_11_12 },
      },
      "04",
    ),
  ],
  ...over,
});

describe("faktur pelunasan: potongan uang muka", () => {
  it("dibagi sebanding DPP per kelompok PPN; sisa pembulatan ke baris terakhir", () => {
    const out = allocateDeductions(
      [
        { group: "ppn", taxBase: "6000000" },
        { group: "ppn", taxBase: "3000000" },
        { group: "bebas", taxBase: "1000000" },
      ],
      [{ group: "ppn", amount: "-1000000" }],
    );
    expect(out.map((o) => o.deduction)).toEqual(["666666.67", "333333.33", "0.00"]);
  });
  it("potongan melebihi DPP kelompoknya ditolak", () => {
    expect(() => allocateDeductions([{ group: "a", taxBase: 100 }], [{ group: "a", amount: -101 }])).toThrow(
      /melebihi/,
    );
  });
  it("diskon tambahan masuk TotalDiscount, DPP tetap harga × kuantitas − diskon", () => {
    const l = taxInvoiceLine(
      {
        name: "Jasa",
        isService: true,
        price: 6_000_000,
        qty: 1,
        discount: 0,
        extraDiscount: "666666.67",
        taxBase: "5333333.33",
        vat: { rate: 12, baseRatio: DPP_11_12 },
      },
      "04",
    );
    expect(l).toMatchObject({
      totalDiscount: "666666.67",
      taxBase: "5333333.33",
      otherTaxBase: "4888888.89",
      vat: "586666.67",
    });
    expect(validateTaxInvoiceDoc(doc({ lines: [l] }))).toEqual([]);
  });
});

describe("pemeriksaan faktur sebelum ekspor", () => {
  it("faktur benar lolos", () => {
    expect(validateTaxInvoiceDoc(doc())).toEqual([]);
  });
  it("identitas & kode yang salah dilaporkan per faktur/baris", () => {
    const bad = doc({
      buyerTin: "123",
      buyerDocument: "National ID",
      buyerDocumentNumber: "317301",
      buyerCountry: "ID",
      trxCode: "07",
      lines: [{ ...doc().lines[0]!, code: "12", unit: "UM.9999", vat: "1.00" }],
    });
    const errors = validateTaxInvoiceDoc(bad);
    expect(errors).toEqual([
      "INV/2026/0001: NPWP pembeli harus 16 digit (0000000000000000 bila tanpa NPWP)",
      "INV/2026/0001: NIK pembeli harus 16 digit",
      "INV/2026/0001: kode negara pembeli harus 3 huruf (mis. IDN)",
      "INV/2026/0001: kode 07 wajib mengisi keterangan tambahan & cap fasilitas",
      "INV/2026/0001: baris 1 (Barang): kode barang/jasa harus 6 digit",
      "INV/2026/0001: baris 1 (Barang): kode satuan UM.9999 tidak dikenal",
      "INV/2026/0001: baris 1 (Barang): PPN ≠ tarif × DPP nilai lain",
    ]);
  });
  it("DPP yang tidak sesuai rumus ditolak", () => {
    const l = { ...doc().lines[0]!, taxBase: "1900000.00" };
    expect(validateTaxInvoiceDoc(doc({ lines: [l] }))[0]).toMatch(
      /DPP 1900000.00 ≠ harga × kuantitas − diskon \(1800000.00\)/,
    );
  });
  it("PPnBM: tarif × DPP (barang mewah, rasio 1)", () => {
    const l = taxInvoiceLine(
      {
        name: "Mobil",
        isService: false,
        unitCode: "UM.0018",
        price: 500_000_000,
        qty: 1,
        discount: 0,
        taxBase: 500_000_000,
        vat: { rate: 12, baseRatio: 1 },
        stlgRate: 15,
      },
      "01",
    );
    expect(l).toMatchObject({
      otherTaxBase: "500000000.00",
      vat: "60000000.00",
      stlgRate: "15",
      stlg: "75000000.00",
    });
    expect(validateTaxInvoiceDoc(doc({ trxCode: "01", lines: [l] }))).toEqual([]);
    expect(efakturXml("0012345678901000", [doc({ trxCode: "01", lines: [l] })])).toContain(
      "<STLG>75000000.00</STLG>",
    );
  });
});

describe("bukti potong A1", () => {
  const record = {
    periodYear: 2026,
    monthStart: 1,
    monthEnd: 12,
    counterpartTin: "3173012345678901",
    ptkpStatus: "K/1",
    position: "Staf Keuangan",
    taxObjectCode: "21-100-01",
    salary: 120_000_000,
    otherBenefit: 6_000_000,
    insurance: 7_428_000,
    bonus: 10_000_000,
    pensionContribution: 3_600_000,
    pph21: 4_317_000,
    taxCertificate: "N/A",
    withholderIdtku: "0012345678901000000000",
    withholdingDate: "2026-12-31",
  };
  it("rincian 1721-A1: biaya jabatan maks. Rp500.000 × bulan", () => {
    expect(bpa1Summary(record)).toEqual({
      gross: "143428000",
      months: 12,
      positionCost: "6000000",
      neto: "133828000",
    });
    expect(
      bpa1Summary({ ...record, monthStart: 7, salary: 30_000_000, otherBenefit: 0, insurance: 0, bonus: 0 }),
    ).toMatchObject({
      months: 6,
      positionCost: "1500000",
    });
  });
  it("XML BPA1 memuat masa, identitas, penghasilan & PPh setahun", () => {
    const xml = bpa1Xml("0012345678901000", [record]);
    expect(xml).toContain("<A1Bulk ");
    expect(xml).toContain("<TaxPeriodMonthStart>1</TaxPeriodMonthStart>");
    expect(xml).toContain("<NumberOfMonths>12</NumberOfMonths>");
    expect(xml).toContain("<SalaryPensionJhtTht>120000000</SalaryPensionJhtTht>");
    expect(xml).toContain("<InsurancePaidByEmployer>7428000</InsurancePaidByEmployer>");
    expect(xml).toContain("<TantiemBonusThr>10000000</TantiemBonusThr>");
    expect(xml).toContain("<Article21IncomeTax>4317000</Article21IncomeTax>");
    expect(xml).toContain("<Position>Staf Keuangan</Position>");
  });
});

describe("e-Faktur 3.x (pra-Coretax)", () => {
  it("rentang NSFP & nomor lengkap", () => {
    expect(nsfpRange("010.25.00000001", "010-25.00000100")).toEqual({
      prefix: "01025",
      from: 1,
      to: 100,
      count: 100,
    });
    expect(() => nsfpRange("0102500000001", "0102600000002")).toThrow(/sama/);
    expect(nsfpAt("01025", 42)).toBe("0102500000042");
    expect(formatNsfp("0102500000042", "04", true)).toBe("041.010-25.00000042");
    expect(npwp15("0012345678901000")).toBe("012345678901000");
  });
  it("CSV FK/OF: pengganti, pembeli NIK, pelunasan uang muka", () => {
    const csv = legacyEfakturCsv([
      {
        trxCode: "04",
        replacement: true,
        nsfp: "0102500000042",
        periodMonth: 3,
        periodYear: 2025,
        invoiceDate: "2025-03-10",
        buyerNpwp15: null,
        buyerNik: "3173012345678901",
        buyerName: "Budi, S.E.",
        buyerAddress: "Jl. Mawar 2",
        downPayment: 2,
        downPaymentAmounts: { dpp: "916667", ppn: "110000", ppnbm: 0 },
        ref: "INV/2025/0007",
        lines: [
          {
            code: "000000",
            name: "Jasa",
            price: 6_000_000,
            qty: 1,
            discount: "1000000",
            dpp: "4583333.33",
            ppn: "550000.00",
            stlgRate: 0,
            stlg: 0,
          },
        ],
      },
    ]).split("\r\n");
    expect(csv[3]).toBe(
      'FK,04,1,0102500000042,3,2025,10/03/2025,000000000000000,"3173012345678901#NIK#NAMA#Budi, S.E.",Jl. Mawar 2,4583333,550000,0,,2,916667,110000,0,INV/2025/0007,',
    );
    expect(csv[4]).toBe("OF,000000,Jasa,6000000.00,1,6000000.00,1000000.00,4583333.33,550000.00,0,0.00");
  });
  it("CSV retur masukan RM dari nomor faktur lama 16 digit", () => {
    const csv = legacyReturnCsv([
      {
        sellerNpwp15: "012345678901000",
        sellerName: "PT Pemasok",
        efakturNumber: "010.025-25.00001234",
        invoiceDate: "2025-01-15",
        creditable: true,
        returnNumber: "RTR/2025/0001",
        returnDate: "2025-02-03",
        periodMonth: 2,
        periodYear: 2025,
        dpp: "1000000",
        ppn: "110000",
        ppnbm: 0,
      },
    ]).split("\r\n");
    expect(csv[1]).toBe(
      "RM,012345678901000,PT Pemasok,01,0,0252500001234,15/01/2025,1,RTR/2025/0001,03/02/2025,2,2025,1000000,110000,0",
    );
    expect(() => legacyReturnCsv([{ ...({} as never), efakturNumber: "04002500000001234" }])).toThrow(
      /16 digit/,
    );
  });
});
