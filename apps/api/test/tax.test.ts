import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;

describe.skipIf(!hasDb)("Fase 5: pajak Coretax", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let companyId: string;
  const tax: Record<string, string> = {};
  let customer: string;
  let nikCustomer: string;
  let vendor: string;
  let product: string;
  let inv1: string;

  const posted = async (body: object) => {
    const id = (await a.post("/moves", { date: "2026-10-10", ...body }).expect(201)).body.id as string;
    return (await a.post(`/moves/${id}/post`).expect(200)).body as { id: string; name: string };
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "tax");
    companyId = (await a.get("/auth/me")).body.activeCompanyId;
    for (const r of (await a.get("/taxes?limit=200").expect(200)).body.items) tax[r.name] = r.id;
    customer = (
      await a
        .post("/partners", {
          name: "PT Pembeli Jaya",
          isCustomer: true,
          npwp: "09.876.543.2-109.000",
          street: "Jl. Sudirman 1",
          city: "Jakarta",
          email: "pajak@pembeli.co.id",
        })
        .expect(201)
    ).body.id;
    nikCustomer = (
      await a
        .post("/partners", {
          name: "Budi Konsumen",
          kind: "person",
          isCustomer: true,
          taxDocumentType: "National ID",
          taxDocumentNumber: "3173012345678901",
          street: "Jl. Kenanga 2",
          city: "Bandung",
        })
        .expect(201)
    ).body.id;
    vendor = (
      await a
        .post("/partners", {
          name: "CV Konsultan Pajak",
          isSupplier: true,
          npwp: "0011223344556000",
          street: "Jl. Gatot Subroto 9",
        })
        .expect(201)
    ).body.id;
    const uom = (await a.get("/uoms?limit=50").expect(200)).body.items.find(
      (u: { name: string }) => u.name === "kg",
    );
    product = (
      await a
        .post("/products", {
          sku: "KOPI-1",
          name: "Kopi Arabika",
          productType: "consumable",
          uomId: uom.id,
          salePrice: "500000",
          taxGoodsCode: "090100",
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => app?.close());

  describe("faktur pajak keluaran", () => {
    it("butuh NPWP & status PKP perusahaan", async () => {
      const res = await a.post("/tax-invoices/generate", { year: 2026, month: 10 }).expect(400);
      expect(res.body.message).toMatch(/NPWP perusahaan/);
      await a
        .patch(`/companies/${companyId}`, { npwp: "01.234.567.8-901.000", street: "Jl. Thamrin 10" })
        .expect(200);
      expect(
        (await a.post("/tax-invoices/generate", { year: 2026, month: 10 }).expect(400)).body.message,
      ).toMatch(/PKP/);
      await a.patch(`/companies/${companyId}`, { pkp: true }).expect(200);
    });

    it("membuat draft dari faktur ber-PPN; data pembeli & DPP nilai lain", async () => {
      const ppn = tax["PPN Keluaran 12% (DPP 11/12)"];
      inv1 = (
        await posted({
          moveType: "out_invoice",
          partnerId: customer,
          lines: [
            {
              productId: product,
              name: "Kopi Arabika",
              quantity: 2,
              priceUnit: 500000,
              discount: 10,
              taxIds: [ppn],
            },
            { name: "Ongkos kirim (tanpa PPN)", quantity: 1, priceUnit: 50000 },
          ],
        })
      ).id;
      await posted({
        moveType: "out_invoice",
        partnerId: nikCustomer,
        lines: [{ name: "Jasa servis", quantity: 1, priceUnit: 1200000, taxIds: [ppn] }],
      });
      const noAddress = (await a.post("/partners", { name: "Toko Tanpa Alamat", npwp: "0099887766554000" }))
        .body.id;
      await posted({
        moveType: "out_invoice",
        partnerId: noAddress,
        lines: [{ name: "Barang", quantity: 1, priceUnit: 100000, taxIds: [ppn] }],
      });
      // Faktur tanpa PPN dan faktur bulan lain tidak ikut.
      await posted({
        moveType: "out_invoice",
        partnerId: customer,
        lines: [{ name: "Bebas", quantity: 1, priceUnit: 1 }],
      });
      await posted({
        moveType: "out_invoice",
        partnerId: customer,
        date: "2026-11-02",
        lines: [{ name: "November", quantity: 1, priceUnit: 1000, taxIds: [ppn] }],
      });

      const result = (await a.post("/tax-invoices/generate", { year: 2026, month: 10 }).expect(200)).body;
      expect(result.created).toBe(2);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toMatch(/Alamat pelanggan Toko Tanpa Alamat/);
      // Idempoten.
      expect(
        (await a.post("/tax-invoices/generate", { year: 2026, month: 10 }).expect(200)).body.created,
      ).toBe(0);

      const list = (await a.get("/tax-invoices?year=2026&month=10").expect(200)).body;
      expect(list).toHaveLength(2);
      const doc = list.find((d: { moveId: string }) => d.moveId === inv1);
      expect(doc).toMatchObject({
        state: "draft",
        trxCode: "04",
        sellerIdtku: "0012345678901000000000",
        buyerTin: "0098765432109000",
        buyerDocument: "TIN",
        buyerIdtku: "0098765432109000000000",
        buyerAddress: "Jl. Sudirman 1, Jakarta",
        taxBase: "900000.00",
        otherTaxBase: "825000.00",
        vat: "99000.00",
      });
      const full = (await a.get(`/tax-invoices/${doc.id}`).expect(200)).body;
      expect(full.lines).toEqual([
        expect.objectContaining({
          opt: "A",
          code: "090100",
          unit: "UM.0003",
          price: "500000.00",
          totalDiscount: "100000.00",
          taxBase: "900000.00",
        }),
      ]);
      const nik = list.find((d: { buyerName: string }) => d.buyerName === "Budi Konsumen");
      expect(nik).toMatchObject({
        buyerTin: "0000000000000000",
        buyerDocument: "National ID",
        buyerDocumentNumber: "3173012345678901",
        buyerIdtku: "3173012345678901000000",
        otherTaxBase: "1100000.00",
        vat: "132000.00",
      });
    });

    it("kode 07 butuh keterangan fasilitas; ekspor XML lalu catat nomor faktur", async () => {
      const list = (await a.get("/tax-invoices?year=2026&month=10").expect(200)).body as {
        id: string;
        ref: string;
        moveId: string;
      }[];
      const doc = list.find((d) => d.moveId === inv1)!;
      await a.patch(`/tax-invoices/${doc.id}`, { trxCode: "07" }).expect(200);
      const ids = list.map((d) => d.id);
      expect((await a.post("/tax-invoices/export", { ids }).expect(400)).body.message).toMatch(
        /cap fasilitas/,
      );
      await a.patch(`/tax-invoices/${doc.id}`, { trxCode: "04" }).expect(200);

      const res = await a.post("/tax-invoices/export", { ids }).expect(201);
      expect(res.headers["content-type"]).toMatch(/application\/xml/);
      expect(res.headers["content-disposition"]).toMatch(/faktur-keluaran-202610/);
      const xml = res.text;
      expect(xml).toContain("<TIN>0012345678901000</TIN>");
      expect(xml.match(/<TaxInvoice>/g)).toHaveLength(2);
      expect(xml).toContain(`<RefDesc>${doc.ref}</RefDesc>`);
      expect(xml).toContain("<Code>090100</Code>");
      expect(xml).not.toContain("Ongkos kirim");
      expect((await a.get("/tax-invoices?state=exported").expect(200)).body).toHaveLength(2);
      await a.patch(`/tax-invoices/${doc.id}`, { trxCode: "01" }).expect(400);

      await a.post(`/tax-invoices/${doc.id}/approve`, { number: "04002600000001" }).expect(200);
      const other = list.find((d) => d.id !== doc.id)!;
      await a.post(`/tax-invoices/${other.id}/approve`, { number: "04002600000001" }).expect(409);
      const imported = (
        await a
          .post("/tax-invoices/import-numbers", {
            csv: `Nomor Faktur Pajak,Referensi,Status Faktur\n04002600000002,${other.ref},APPROVED\n04002600000009,INV/XX,APPROVED\n`,
          })
          .expect(200)
      ).body;
      expect(imported).toEqual({ approved: 1, unmatched: ["INV/XX"] });
      const approved = (await a.get("/tax-invoices?state=approved").expect(200)).body;
      expect(approved.map((d: { efakturNumber: string }) => d.efakturNumber).sort()).toEqual([
        "04002600000001",
        "04002600000002",
      ]);
      const exports = (await a.get("/tax/exports").expect(200)).body;
      expect(exports[0]).toMatchObject({ kind: "efaktur", recordCount: 2 });
      expect((await a.get(`/tax/exports/${exports[0].id}`).expect(200)).text).toContain("<TaxInvoiceBulk");
    });
  });

  describe("bukti potong & faktur masukan", () => {
    let billId: string;

    it("BPPU PPh 23 dari tagihan; kode objek pajak wajib sebelum ekspor", async () => {
      billId = (
        await posted({
          moveType: "in_invoice",
          partnerId: vendor,
          ref: "INV-KONS-77",
          date: "2026-10-12",
          lines: [
            {
              name: "Jasa konsultan",
              quantity: 1,
              priceUnit: 1000000,
              taxIds: [tax["PPN Masukan 12% (DPP 11/12)"], tax["PPh 23 2% (dipotong)"]],
            },
          ],
        })
      ).id;
      const result = (
        await a.post("/withholding-slips/generate", { kind: "bppu", year: 2026, month: 10 }).expect(200)
      ).body;
      expect(result.created).toBe(1);
      const [slip] = (await a.get("/withholding-slips?kind=bppu").expect(200)).body;
      expect(slip).toMatchObject({
        counterpartTin: "0011223344556000",
        counterpartIdtku: "0011223344556000000000",
        taxBase: "1000000.00",
        rate: "2.0000",
        taxAmount: "20000.00",
        documentNumber: "INV-KONS-77",
        withholderIdtku: "0012345678901000000000",
      });
      const missing = (await a.post("/withholding-slips/export", { ids: [slip.id] }).expect(400)).body;
      expect(missing.errors[0].message).toMatch(/kode objek pajak/);
      await a.patch(`/withholding-slips/${slip.id}`, { taxObjectCode: "24-104-14" }).expect(200);
      const xml = (await a.post("/withholding-slips/export", { ids: [slip.id] }).expect(201)).text;
      expect(xml).toContain("<BpuBulk");
      expect(xml).toContain("<TaxObjectCode>24-104-14</TaxObjectCode>");
      expect(xml).toContain("<TaxBase>1000000</TaxBase>");
      expect(xml).toContain("<DocumentNumber>INV-KONS-77</DocumentNumber>");
      expect(
        (await a.post("/withholding-slips/generate", { kind: "bppu", year: 2026, month: 10 }).expect(200))
          .body.created,
      ).toBe(0);
    });

    it("impor faktur masukan, cocok otomatis ke tagihan, kreditkan maks. 3 masa", async () => {
      const csv = [
        "NPWP Penjual,Nama Penjual,Nomor Faktur Pajak,Tanggal Faktur Pajak,Harga Jual/Penggantian/DPP,DPP Nilai Lain/DPP,PPN,PPnBM,Status Faktur",
        '0011223344556000,CV Konsultan Pajak,04002612345678,11/10/2026,"1.000.000,00","916.667,00","110.000,00",0,APPROVED',
        "0123456789012000,PT Lain,04002612345679,15/10/2026,500000,458333,55000,0,APPROVED",
      ].join("\n");
      const res = (await a.post("/input-tax-invoices/import", { csv }).expect(200)).body;
      expect(res).toEqual({ imported: 2, updated: 0, matched: 1, errors: [] });
      expect((await a.post("/input-tax-invoices/import", { csv }).expect(200)).body).toMatchObject({
        imported: 0,
        updated: 2,
      });
      const list = (await a.get("/input-tax-invoices").expect(200)).body;
      const matched = list.find((d: { efakturNumber: string }) => d.efakturNumber === "04002612345678");
      expect(matched).toMatchObject({ partnerId: vendor, moveId: billId, vat: "110000.00", state: "new" });
      const other = list.find((d: { efakturNumber: string }) => d.efakturNumber === "04002612345679");
      expect(other.moveId).toBeNull();

      await a.post("/input-tax-invoices/credit", { ids: [matched.id], year: 2027, month: 2 }).expect(400);
      await a.post("/input-tax-invoices/credit", { ids: [matched.id], year: 2026, month: 10 }).expect(200);
      await a
        .post("/input-tax-invoices/credit", { ids: [other.id], credit: false, year: 2026, month: 10 })
        .expect(200);
      expect((await a.get("/input-tax-invoices?state=credited").expect(200)).body).toHaveLength(1);
    });

    it("rekap PPN masa Oktober", async () => {
      const report = (await a.get("/tax/vat-report?year=2026&month=10").expect(200)).body;
      // Buku besar: PPN keluaran 99.000 + 132.000 + 11.000 (faktur tanpa alamat); masukan 110.000.
      expect(report.ledger).toEqual({ outputVat: "242000.00", inputVat: "110000.00" });
      expect(report.inputCredited).toMatchObject({ count: 1, vat: "110000.00" });
      expect(report.position).toEqual({ payable: "121000.00", status: "kurang_bayar" });
    });
  });

  describe("BPMP PPh 21", () => {
    it("bukti potong bulanan dari payroll yang diposting", async () => {
      const job = (await a.post("/job-positions", { name: "Analis Pajak" }).expect(201)).body.id;
      const emp = (
        await a
          .post("/employees", {
            name: "Sari Pegawai",
            jobId: job,
            nik: "3201012345678901",
            ptkpStatus: "K/1",
            joinDate: "2025-01-02",
          })
          .expect(201)
      ).body.id;
      const c = (
        await a.post("/contracts", { employeeId: emp, wage: "10000000", dateStart: "2025-01-02" }).expect(201)
      ).body.id;
      await a.post(`/contracts/${c}/start`).expect(200);
      const run = (
        await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201)
      ).body;
      // Belum diposting: belum ada bupot.
      expect(
        (await a.post("/withholding-slips/generate", { kind: "bpmp", year: 2026, month: 10 }).expect(200))
          .body.created,
      ).toBe(0);
      await a.post(`/payroll-runs/${run.id}/post`).expect(200);
      const slipData = (await a.get(`/payslips/${run.payslips[0].id}`).expect(200)).body;
      const result = (
        await a.post("/withholding-slips/generate", { kind: "bpmp", year: 2026, month: 10 }).expect(200)
      ).body;
      expect(result.created).toBe(1);
      const [slip] = (await a.get("/withholding-slips?kind=bpmp").expect(200)).body;
      expect(slip).toMatchObject({
        counterpartName: "Sari Pegawai",
        counterpartTin: "3201012345678901",
        ptkpStatus: "K/1",
        position: "Analis Pajak",
        taxObjectCode: "21-100-01",
        taxBase: slipData.gross,
        taxAmount: slipData.pph21,
        withholdingDate: "2026-10-28",
      });
      const xml = (await a.post("/withholding-slips/export", { ids: [slip.id] }).expect(201)).text;
      expect(xml).toContain("<MmPayrollBulk");
      expect(xml).toContain("<CounterpartTin>3201012345678901</CounterpartTin>");
      expect(xml).toContain(`<Gross>${slipData.gross.split(".")[0]}</Gross>`);
    });
  });
});
