import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Doc {
  id: string;
  moveId: string;
  ref: string;
  state: string;
  downPayment: number;
  taxBase: string;
  vat: string;
  stlg: string;
  nsfp: string | null;
  replacesId: string | null;
  replacedNumber: string | null;
  downPaymentTaxBase: string;
  downPaymentVat: string;
  lines: {
    name: string;
    totalDiscount: string;
    taxBase: string;
    otherTaxBase: string;
    vat: string;
    stlgRate: string;
    stlg: string;
  }[];
}

describe.skipIf(!hasDb)("Item tunda Fase 5: pajak", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  const tax: Record<string, string> = {};
  let customer: string;
  let vendor: string;
  let luxuryDoc: Doc;
  let finalDoc: Doc;

  const posted = async (body: object) => {
    const id = (await a.post("/moves", { date: "2026-10-10", ...body }).expect(201)).body.id as string;
    return (await a.post(`/moves/${id}/post`).expect(200)).body as { id: string; name: string };
  };
  const docs = async () => (await a.get("/tax-invoices?year=2026&month=10").expect(200)).body as Doc[];
  const doc = async (id: string) => (await a.get(`/tax-invoices/${id}`).expect(200)).body as Doc;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "taxd");
    const companyId = (await a.get("/auth/me")).body.activeCompanyId;
    await a
      .patch(`/companies/${companyId}`, { npwp: "01.234.567.8-901.000", street: "Jl. Thamrin 10", pkp: true })
      .expect(200);
    for (const r of (await a.get("/taxes?limit=200").expect(200)).body.items) tax[r.name] = r.id;
    customer = (
      await a
        .post("/partners", {
          name: "PT Pembeli Mewah",
          isCustomer: true,
          npwp: "09.876.543.2-109.000",
          street: "Jl. Sudirman 1",
          city: "Jakarta",
        })
        .expect(201)
    ).body.id;
    vendor = (
      await a
        .post("/partners", {
          name: "CV Pemasok Lama",
          isSupplier: true,
          npwp: "01.122.334.4-556.000",
          street: "Jl. A",
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app?.close());

  it("PPnBM per produk: baris penjualan memakai PPN barang mewah + PPnBM; faktur pajak memuat STLG", async () => {
    expect(tax["PPnBM 20%"]).toBeTruthy();
    const uom = (await a.get("/uoms?limit=50").expect(200)).body.items.find(
      (u: { name: string }) => u.name === "Pcs",
    );
    const car = (
      await a
        .post("/products", {
          sku: "MBL-1",
          name: "Mobil Sport",
          productType: "consumable",
          uomId: uom.id,
          salePrice: "1000000000",
          luxuryTaxRate: "20",
        })
        .expect(201)
    ).body;
    expect(car.luxuryTaxRate).toBe("20.00");
    const so = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: "2026-10-05",
          lines: [{ productId: car.id, quantity: 1 }],
        })
        .expect(201)
    ).body;
    expect([...so.lines[0].taxIds].sort()).toEqual(
      [tax["PPN Keluaran 12% (barang mewah)"], tax["PPnBM 20%"]].sort(),
    );
    expect(so).toMatchObject({ amountUntaxed: "1000000000.00", amountTax: "320000000.00" });
    const yacht = (
      await a
        .post("/products", { sku: "KPL-1", name: "Kapal Pesiar", uomId: uom.id, luxuryTaxRate: 75 })
        .expect(201)
    ).body.id;
    const missing = await a
      .post("/sale-orders", { partnerId: customer, dateOrder: "2026-10-05", lines: [{ productId: yacht }] })
      .expect(400);
    expect(JSON.stringify(missing.body)).toMatch(/PPnBM 75% belum ada/);

    await posted({
      moveType: "out_invoice",
      partnerId: customer,
      lines: [
        {
          productId: car.id,
          name: "Mobil Sport",
          quantity: 1,
          priceUnit: 1000000000,
          taxIds: so.lines[0].taxIds,
        },
      ],
    });
    expect((await a.post("/tax-invoices/generate", { year: 2026, month: 10 }).expect(200)).body.created).toBe(
      1,
    );
    luxuryDoc = await doc((await docs())[0]!.id);
    expect(luxuryDoc).toMatchObject({
      taxBase: "1000000000.00",
      vat: "120000000.00",
      stlg: "200000000.00",
      downPayment: 0,
    });
    expect(luxuryDoc.lines[0]).toMatchObject({
      otherTaxBase: "1000000000.00",
      stlgRate: "20.00",
      stlg: "200000000.00",
    });
    expect((await a.post("/tax-invoices/check", { ids: [luxuryDoc.id] }).expect(200)).body).toEqual({
      checked: 1,
      errors: [],
    });
  });

  it("faktur uang muka & pelunasan: potongan uang muka mengurangi DPP faktur pelunasan", async () => {
    const order = (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: "2026-10-06",
          lines: [{ name: "Jasa konsultasi", quantity: 1, priceUnit: 10000000 }],
        })
        .expect(201)
    ).body;
    await a.post(`/sale-orders/${order.id}/confirm`).expect(200);
    const dp = (
      await a
        .post(`/sale-orders/${order.id}/invoice`, {
          method: "percentage",
          percentage: 30,
          date: "2026-10-07",
        })
        .expect(201)
    ).body.moveId;
    await a.post(`/moves/${dp}/post`).expect(200);
    const fin = (
      await a.post(`/sale-orders/${order.id}/invoice`, { method: "regular", date: "2026-10-20" }).expect(201)
    ).body.moveId;
    await a.post(`/moves/${fin}/post`).expect(200);

    expect(
      (await a.post("/tax-invoices/generate", { year: 2026, month: 10 }).expect(200)).body,
    ).toMatchObject({
      created: 2,
      skipped: [],
    });
    const all = await docs();
    const dpDoc = await doc(all.find((d) => d.moveId === dp)!.id);
    expect(dpDoc).toMatchObject({ downPayment: 1, taxBase: "3000000.00", vat: "330000.00" });
    finalDoc = await doc(all.find((d) => d.moveId === fin)!.id);
    expect(finalDoc).toMatchObject({
      downPayment: 2,
      taxBase: "7000000.00",
      vat: "770000.00",
      downPaymentTaxBase: "3000000.00",
      downPaymentVat: "330000.00",
    });
    expect(finalDoc.lines).toHaveLength(1);
    expect(finalDoc.lines[0]).toMatchObject({
      totalDiscount: "3000000.00",
      taxBase: "7000000.00",
      otherTaxBase: "6416666.67",
    });
    const xml = (await a.post("/tax-invoices/export", { ids: [dpDoc.id, finalDoc.id] }).expect(201)).text;
    expect(xml).toContain("<TotalDiscount>3000000.00</TotalDiscount>");
  });

  it("faktur pengganti: draft baru menunjuk faktur lama; dibuat di Coretax; faktur lama berstatus diganti", async () => {
    await a.post(`/tax-invoices/${finalDoc.id}/replace`).expect(400); // belum terbit
    await a.post(`/tax-invoices/${finalDoc.id}/approve`, { number: "04002600000000123" }).expect(200);
    const repl = (await a.post(`/tax-invoices/${finalDoc.id}/replace`).expect(200)).body as Doc;
    expect(repl).toMatchObject({
      state: "draft",
      replacesId: finalDoc.id,
      replacedNumber: "04002600000000123",
      taxBase: "7000000.00",
    });
    await a.post(`/tax-invoices/${finalDoc.id}/replace`).expect(409);
    const blocked = await a.post("/tax-invoices/export", { ids: [repl.id] }).expect(400);
    expect(blocked.body.message).toMatch(/pengganti.*Ganti/);
    await a.post(`/tax-invoices/${repl.id}/approve`, { number: "04012600000000124" }).expect(200);
    expect((await doc(finalDoc.id)).state).toBe("replaced");
    const report = (await a.get("/tax/vat-report?year=2026&month=10").expect(200)).body;
    const states = Object.fromEntries(
      report.outputInvoices.map((r: { state: string; count: number }) => [r.state, r.count]),
    );
    expect(states).toMatchObject({ replaced: 1, approved: 1, exported: 1, draft: 1 });
  });

  it("e-Faktur 3.x: rentang NSFP, nomor berurutan, CSV FK/OF; validasi menolak data tidak lengkap", async () => {
    await a.post("/tax/nsfp-ranges", { start: "010.26.00000001", end: "010.27.00000005" }).expect(400);
    const ranges = (
      await a.post("/tax/nsfp-ranges", { start: "010-26.00000001", end: "010-26.00000003" }).expect(201)
    ).body;
    expect(ranges[0]).toMatchObject({ start: "0102600000001", end: "0102600000003", used: 0, remaining: 3 });
    await a.post("/tax/nsfp-ranges", { start: "0102600000003", end: "0102600000009" }).expect(409);
    const csv = (await a.post("/tax-invoices/export-legacy", { ids: [luxuryDoc.id] }).expect(201)).text.split(
      "\r\n",
    );
    expect(csv[3]).toMatch(/^FK,04,0,0102600000001,10,2026,10\/10\/2026,098765432109000,PT Pembeli Mewah,/);
    expect(csv[3]).toContain(",1000000000,120000000,200000000,,0,0,0,0,");
    expect(csv[4]).toBe(
      "OF,000000,Mobil Sport,1000000000.00,1,1000000000.00,0.00,1000000000.00,120000000.00,20,200000000.00",
    );
    expect((await doc(luxuryDoc.id)).nsfp).toBe("0102600000001");
    const after = (await a.get("/tax/nsfp-ranges").expect(200)).body[0];
    expect(after).toMatchObject({ used: 1, remaining: 2 });
    await a.delete(`/tax/nsfp-ranges/${after.id}`).expect(400);
    // Ekspor ulang memakai NSFP yang sama.
    expect((await a.post("/tax-invoices/export-legacy", { ids: [luxuryDoc.id] }).expect(201)).text).toContain(
      "0102600000001",
    );

    const noTin = (
      await a
        .post("/partners", {
          name: "Pembeli NIK",
          taxDocumentType: "National ID",
          taxDocumentNumber: "3173",
          street: "Jl. B",
        })
        .expect(201)
    ).body.id;
    await posted({
      moveType: "out_invoice",
      partnerId: noTin,
      date: "2026-11-03",
      lines: [
        { name: "Barang", quantity: 1, priceUnit: 100000, taxIds: [tax["PPN Keluaran 12% (DPP 11/12)"]] },
      ],
    });
    const gen = (await a.post("/tax-invoices/generate", { year: 2026, month: 11 }).expect(200)).body;
    // NIK yang salah ditolak saat membuat draft.
    expect(gen.skipped[0].reason).toMatch(/NIK pelanggan Pembeli NIK harus 16 digit/);
  });

  it("nota retur pajak masukan dari nota debit; CSV RM untuk faktur lama; rekap PPN dikurangi retur", async () => {
    const ppnIn = tax["PPN Masukan 12% (DPP 11/12)"];
    const bill = await posted({
      moveType: "in_invoice",
      partnerId: vendor,
      date: "2026-10-08",
      lines: [{ name: "Bahan baku", quantity: 1, priceUnit: 1000000, taxIds: [ppnIn] }],
    });
    const csv = [
      "NPWP Penjual,Nama Penjual,Nomor Faktur Pajak,Tanggal Faktur Pajak,Harga Jual/Penggantian/DPP,DPP Nilai Lain/DPP,PPN,PPnBM,Status Faktur",
      "0011223344556000,CV Pemasok Lama,0100262600000077,08/10/2026,1000000,916667,110000,0,APPROVED",
    ].join("\n");
    expect((await a.post("/input-tax-invoices/import", { csv }).expect(200)).body).toMatchObject({
      imported: 1,
      matched: 1,
    });
    const input = (await a.get("/input-tax-invoices").expect(200)).body[0];
    await a.post("/input-tax-invoices/credit", { ids: [input.id], year: 2026, month: 10 }).expect(200);

    const refund = (await a.post(`/moves/${bill.id}/reverse`, { date: "2026-10-25" }).expect(201)).body;
    const gen = (await a.post("/tax-returns/generate", { year: 2026, month: 10 }).expect(200)).body;
    expect(gen.created).toBe(1);
    const [ret] = (await a.get("/tax-returns").expect(200)).body;
    expect(ret).toMatchObject({
      moveId: refund.id,
      inputTaxInvoiceId: input.id,
      efakturNumber: "0100262600000077",
      legacy: true,
      taxBase: "1000000.00",
      vat: "110000.00",
      state: "draft",
    });
    expect((await a.post("/tax-returns/generate", { year: 2026, month: 10 }).expect(200)).body.created).toBe(
      0,
    );
    const rm = (await a.post("/tax-returns/export-legacy", { ids: [ret.id] }).expect(201)).text.split("\r\n");
    expect(rm[1]).toBe(
      `RM,011223344556000,CV Pemasok Lama,01,0,0262600000077,08/10/2026,1,${ret.returnNumber},25/10/2026,10,2026,1000000,110000,0`,
    );
    await a
      .post(`/tax-returns/${ret.id}/approve`, { number: ret.returnNumber.replace(/\D/g, "").padEnd(10, "0") })
      .expect(200);
    const report = (await a.get("/tax/vat-report?year=2026&month=10").expect(200)).body;
    expect(report.inputCredited).toMatchObject({ count: 1, vat: "110000.00" });
    expect(report.inputReturns).toMatchObject({ count: 1, vat: "110000.00" });
    // Keluaran sah: mewah 120.000.000 (diekspor) + uang muka 330.000 (diekspor) + pengganti 770.000 (terbit).
    expect(report.position).toEqual({ payable: "121100000.00", status: "kurang_bayar" });
  });

  it("bukti potong A1: penghasilan setahun dari slip yang diposting, untuk karyawan keluar di tengah tahun", async () => {
    const emp = (
      await a
        .post("/employees", {
          name: "Andi Keluar",
          ptkpStatus: "TK/0",
          joinDate: "2025-06-01",
          nik: "3173012345678901",
          resignDate: "2026-03-31",
        })
        .expect(201)
    ).body.id;
    const contract = (
      await a.post("/contracts", { employeeId: emp, dateStart: "2025-06-01", wage: "30000000" }).expect(201)
    ).body;
    await a.post(`/contracts/${contract.id}/start`).expect(200);
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const run = (await a.post("/payroll-runs", { period, paymentDate: `${period}-25` }).expect(201)).body;
      await a.post(`/payroll-runs/${run.id}/post`).expect(200);
    }
    expect(
      (await a.post("/withholding-slips/generate", { kind: "bpmp", year: 2026, month: 3 }).expect(200)).body
        .skipped,
    ).toHaveLength(1);
    const gen = (
      await a.post("/withholding-slips/generate", { kind: "bpa1", year: 2026, month: 3 }).expect(200)
    ).body;
    expect(gen.created).toBe(1);
    const [slip] = (await a.get("/withholding-slips?kind=bpa1").expect(200)).body;
    // 3 bulan: gaji 90 jt; premi JKK 0,24% + JKM 0,3% + Kes 4% (batas 12 jt); iuran JHT 2% + JP 1% (batas JP).
    expect(slip).toMatchObject({
      monthStart: 1,
      monthEnd: 3,
      taxObjectCode: "21-100-01",
      counterpartTin: "3173012345678901",
      details: {
        salary: "90000000",
        otherBenefit: "0",
        insurance: "1926000",
        bonus: "0",
        pensionContribution: "2116422",
      },
      taxBase: "91926000.00",
      taxAmount: "1715450.00",
    });
    const xml = (await a.post("/withholding-slips/export", { ids: [slip.id] }).expect(201)).text;
    expect(xml).toContain("<A1Bulk");
    expect(xml).toContain("<TaxPeriodMonthEnd>3</TaxPeriodMonthEnd>");
    expect(xml).toContain("<Article21IncomeTax>1715450</Article21IncomeTax>");
    expect(
      (await a.post("/withholding-slips/generate", { kind: "bpa1", year: 2026, month: 3 }).expect(200)).body
        .created,
    ).toBe(0);
  });
});
