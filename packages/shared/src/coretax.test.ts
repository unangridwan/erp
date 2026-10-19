import { describe, expect, it } from "vitest";
import {
  bpmpXml,
  bppuXml,
  efakturXml,
  idtku,
  parseInputTaxInvoices,
  taxInvoiceLine,
  taxInvoiceTotals,
  tin16,
  vatPosition,
  xmlEscape,
} from "./coretax.js";

const DPP_11_12 = "0.9166666667";

describe("NPWP & ID TKU", () => {
  it("NPWP 15 digit diberi awalan 0, tanda baca diabaikan", () => {
    expect(tin16("01.234.567.8-901.000")).toBe("0012345678901000");
    expect(tin16("3173012345678901")).toBe("3173012345678901");
    expect(tin16("12345")).toBeNull();
  });
  it("ID TKU = NPWP 16 + 6 digit tempat usaha", () => {
    expect(idtku("0012345678901000")).toBe("0012345678901000000000");
    expect(idtku("0012345678901000", "1")).toBe("0012345678901000000001");
    expect(idtku(null, "0012345678901000000002")).toBe("0012345678901000000002");
    expect(idtku(null)).toBeNull();
  });
});

describe("baris faktur", () => {
  it("PPN 12% DPP nilai lain 11/12 (sama dengan contoh referensi Odoo/Coretax)", () => {
    const line = taxInvoiceLine(
      {
        name: "Produk A",
        isService: false,
        unitCode: "UM.0018",
        price: 100000,
        qty: 1,
        discount: 0,
        taxBase: 100000,
        vat: { rate: 12, baseRatio: DPP_11_12 },
      },
      "04",
    );
    expect(line).toEqual({
      opt: "A",
      code: "000000",
      name: "Produk A",
      unit: "UM.0018",
      price: "100000.00",
      qty: "1",
      totalDiscount: "0.00",
      taxBase: "100000.00",
      otherTaxBase: "91666.67",
      vatRate: "12",
      vat: "11000.00",
      stlgRate: "0",
      stlg: "0.00",
    });
  });

  it("diskon, jasa, barang mewah dengan PPnBM", () => {
    const service = taxInvoiceLine(
      {
        name: "Jasa",
        isService: true,
        goodsCode: "000000",
        price: 250000,
        qty: 4,
        discount: 10,
        taxBase: 900000,
        vat: { rate: 12, baseRatio: DPP_11_12 },
      },
      "04",
    );
    expect(service).toMatchObject({
      opt: "B",
      unit: "UM.0033",
      totalDiscount: "100000.00",
      otherTaxBase: "825000.00",
      vat: "99000.00",
    });
    const luxury = taxInvoiceLine(
      {
        name: "Mobil",
        isService: false,
        price: 500000000,
        qty: 1,
        discount: 0,
        taxBase: 500000000,
        vat: { rate: 12, baseRatio: 1 },
        stlgRate: 20,
      },
      "01",
    );
    expect(luxury).toMatchObject({ otherTaxBase: "500000000.00", vat: "60000000.00", stlg: "100000000.00" });
  });

  it("kode 07: PPN tidak dipungut tetap ditampilkan 12% × 11/12", () => {
    const line = taxInvoiceLine(
      {
        name: "Ekspor KB",
        isService: false,
        price: 1200000,
        qty: 1,
        discount: 0,
        taxBase: 1200000,
        vat: { rate: 0, baseRatio: 1 },
      },
      "07",
    );
    expect(line).toMatchObject({ otherTaxBase: "1100000.00", vatRate: "12", vat: "132000.00" });
  });

  it("menolak baris negatif dan menjumlahkan total", () => {
    expect(() =>
      taxInvoiceLine({ name: "DP", isService: true, price: -1, qty: 1, discount: 0, taxBase: -1 }, "04"),
    ).toThrow(/negatif/);
    const a = taxInvoiceLine(
      {
        name: "a",
        isService: false,
        price: 100000,
        qty: 1,
        discount: 0,
        taxBase: 100000,
        vat: { rate: 12, baseRatio: DPP_11_12 },
      },
      "04",
    );
    expect(taxInvoiceTotals([a, a])).toEqual({
      taxBase: "200000.00",
      otherTaxBase: "183333.34",
      vat: "22000.00",
      stlg: "0.00",
    });
  });
});

describe("XML", () => {
  it("efaktur: struktur TaxInvoiceBulk dan escape karakter", () => {
    const line = taxInvoiceLine(
      {
        name: "Kopi <Arabika> & Gula",
        isService: false,
        unitCode: "UM.0003",
        price: 100000,
        qty: 2,
        discount: 0,
        taxBase: 200000,
        vat: { rate: 12, baseRatio: DPP_11_12 },
      },
      "04",
    );
    const xml = efakturXml("0012345678901000", [
      {
        invoiceDate: "2026-10-01",
        trxCode: "04",
        ref: "INV/2026/0001",
        sellerIdtku: "0012345678901000000000",
        buyerTin: "0098765432109000",
        buyerDocument: "TIN",
        buyerCountry: "IDN",
        buyerName: "PT Pembeli",
        buyerAddress: "Jl. Merdeka 1, Jakarta",
        buyerIdtku: "0098765432109000000000",
        lines: [line],
      },
    ]);
    expect(xml).toContain('<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(xml).toContain("<TIN>0012345678901000</TIN>");
    expect(xml).toContain("<TaxInvoiceOpt>Normal</TaxInvoiceOpt>");
    expect(xml).toContain("<AddInfo/>");
    expect(xml).toContain("<BuyerAdress>Jl. Merdeka 1, Jakarta</BuyerAdress>");
    expect(xml).toContain("<Name>Kopi &lt;Arabika&gt; &amp; Gula</Name>");
    expect(xml).toContain("<OtherTaxBase>183333.33</OtherTaxBase>");
    expect(xml).toContain("<VAT>22000.00</VAT>");
    // Urutan elemen sesuai skema.
    const order = [
      "TaxInvoiceDate",
      "TrxCode",
      "RefDesc",
      "SellerIDTKU",
      "BuyerTin",
      "BuyerIDTKU",
      "ListOfGoodService",
    ];
    const positions = order.map((t) => xml.indexOf(`<${t}`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("BPPU & BPMP", () => {
    const bppu = bppuXml("0012345678901000", [
      {
        periodMonth: 10,
        periodYear: 2026,
        counterpartTin: "0098765432109000",
        counterpartIdtku: "0098765432109000000000",
        taxCertificate: "N/A",
        taxObjectCode: "24-104-14",
        taxBase: "5000000.00",
        rate: "2.0000",
        documentType: "CommercialInvoice",
        documentNumber: "BILL/2026/0001",
        documentDate: "2026-10-05",
        withholderIdtku: "0012345678901000000000",
        withholdingDate: "2026-10-05",
      },
    ]);
    expect(bppu).toContain("<BpuBulk");
    expect(bppu).toContain("<TaxBase>5000000</TaxBase>");
    expect(bppu).toContain("<Rate>2</Rate>");
    expect(bppu).toContain("<SP2DNumber/>");

    const bpmp = bpmpXml("0012345678901000", [
      {
        periodMonth: 10,
        periodYear: 2026,
        counterpartTin: "3173012345678901",
        ptkpStatus: "K/1",
        position: "Staf",
        taxCertificate: "N/A",
        taxObjectCode: "21-100-01",
        gross: "12196666.00",
        rate: "4.00",
        withholderIdtku: "0012345678901000000000",
        withholdingDate: "2026-10-25",
      },
    ]);
    expect(bpmp).toContain("<MmPayrollBulk");
    expect(bpmp).toContain("<CounterpartOpt>Resident</CounterpartOpt>");
    expect(bpmp).toContain("<StatusTaxExemption>K/1</StatusTaxExemption>");
    expect(bpmp).toContain("<Gross>12196666</Gross>");
    expect(bpmp).toContain("<Rate>4</Rate>");
  });

  it("escape membuang karakter kontrol", () => {
    expect(xmlEscape("a\u0001b'\"")).toBe("ab&apos;&quot;");
  });
});

describe("impor faktur masukan", () => {
  it("mengenali kolom unduhan Coretax & format angka Indonesia", () => {
    const { items, errors } = parseInputTaxInvoices([
      {
        "NPWP Penjual": "01.234.567.8-901.000",
        "Nama Penjual": "PT Pemasok",
        "Nomor Faktur Pajak": "04002600000001",
        "Tanggal Faktur Pajak": "05/10/2026",
        "Harga Jual/Penggantian/DPP": "1.000.000,00",
        "DPP Nilai Lain/DPP": "916.667,00",
        PPN: "110.000,00",
        PPnBM: "0",
        "Status Faktur": "APPROVED",
      },
      {
        "NPWP Penjual": "0012345678901000",
        "Nama Penjual": "PT Pemasok",
        "Nomor Faktur Pajak": "04002600000002",
        "Tanggal Faktur Pajak": "2026-10-06",
        "Harga Jual/Penggantian/DPP": "2500000.50",
        "DPP Nilai Lain/DPP": "2291667",
        PPN: "275000",
        PPnBM: "",
        "Status Faktur": "APPROVED",
      },
      {
        "NPWP Penjual": "123",
        "Nama Penjual": "X",
        "Nomor Faktur Pajak": "04002600000003",
        "Tanggal Faktur Pajak": "2026-10-06",
        "Harga Jual/Penggantian/DPP": "1",
        "DPP Nilai Lain/DPP": "1",
        PPN: "1",
        PPnBM: "",
        "Status Faktur": "",
      },
    ]);
    expect(errors).toEqual([{ row: 4, message: "NPWP penjual tidak valid" }]);
    expect(items).toEqual([
      {
        efakturNumber: "04002600000001",
        invoiceDate: "2026-10-05",
        sellerTin: "0012345678901000",
        sellerName: "PT Pemasok",
        taxBase: "1000000.00",
        otherTaxBase: "916667.00",
        vat: "110000.00",
        stlg: "0.00",
        coretaxStatus: "APPROVED",
      },
      expect.objectContaining({ taxBase: "2500000.50", otherTaxBase: "2291667.00", vat: "275000.00" }),
    ]);
  });

  it("kolom wajib", () => {
    expect(() => parseInputTaxInvoices([{ foo: "1" }])).toThrow(/Kolom tidak ditemukan/);
  });

  it("posisi PPN", () => {
    expect(vatPosition("110000", "50000")).toEqual({ payable: "60000.00", status: "kurang_bayar" });
    expect(vatPosition("0", "50000").status).toBe("lebih_bayar");
  });
});
