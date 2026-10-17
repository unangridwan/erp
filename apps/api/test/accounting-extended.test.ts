import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

type Api = Awaited<ReturnType<typeof signup>>;
interface Line {
  id: string;
  accountId: string;
  displayType: string;
  debit: string;
  credit: string;
}

async function setup(app: INestApplication, prefix: string) {
  const api = await signup(app, prefix);
  const acc: Record<string, string> = {};
  const jr: Record<string, string> = {};
  for (const r of (await api.get("/accounts?limit=200")).body.items) acc[r.code] = r.id;
  for (const r of (await api.get("/journals")).body.items) jr[r.code] = r.id;
  const customer = (
    await api.post("/partners", { name: "PT Pelanggan Ekspor", isCustomer: true }).expect(201)
  ).body.id as string;
  return { api, acc, jr, customer };
}

async function postedInvoice(api: Api, body: object) {
  const draft = (await api.post("/moves", { moveType: "out_invoice", ...body }).expect(201)).body;
  return (await api.post(`/moves/${draft.id}/post`).expect(200)).body as {
    id: string;
    name: string;
    lines: Line[];
  };
}

const pl = async (api: Api, from: string, to: string) =>
  (await api.get(`/reports/profit-loss?dateFrom=${from}&dateTo=${to}`).expect(200)).body;

describe.skipIf(!hasDb)("Fase 1 lanjutan", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  describe("selisih kurs saat pelunasan valas", () => {
    it("laba selisih kurs saat kurs naik, rugi saat kurs turun", async () => {
      const { api, acc, jr, customer } = await setup(app, "fx");
      await api
        .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-09-01", rate: 16000 })
        .expect(201);
      await api
        .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-09-20", rate: 16300 })
        .expect(201);
      await api
        .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-09-25", rate: 16100 })
        .expect(201);

      const inv = await postedInvoice(api, {
        partnerId: customer,
        date: "2026-09-10",
        currencyCode: "USD",
        lines: [{ name: "Ekspor", priceUnit: 100 }],
      });
      const pay = (date: string, amount: number, moveId: string) =>
        api
          .post("/payments", {
            paymentType: "inbound",
            partnerId: customer,
            journalId: jr.BNK1,
            amount,
            currencyCode: "USD",
            date,
            moveIds: [moveId],
          })
          .expect(201);

      // Bayar sebagian dulu (40 USD), lalu sisanya (60 USD) pada kurs yang sama.
      await pay("2026-09-20", 40, inv.id);
      expect((await api.get(`/moves/${inv.id}`)).body.paymentState).toBe("partial");
      await pay("2026-09-20", 60, inv.id);
      expect((await api.get(`/moves/${inv.id}`)).body).toMatchObject({
        paymentState: "paid",
        amountResidual: "0.00",
      });

      const inv2 = await postedInvoice(api, {
        partnerId: customer,
        date: "2026-09-20",
        currencyCode: "USD",
        lines: [{ name: "Ekspor 2", priceUnit: 10 }],
      });
      await pay("2026-09-25", 10, inv2.id);
      expect((await api.get(`/moves/${inv2.id}`)).body.paymentState).toBe("paid");

      const report = await pl(api, "2026-01-01", "2026-12-31");
      expect(report.otherIncome.accounts).toEqual([
        expect.objectContaining({ code: "4-9100", amount: "30000.00" }),
      ]);
      expect(report.otherExpense.accounts).toEqual([
        expect.objectContaining({ code: "7-1100", amount: "2000.00" }),
      ]);

      // Piutang bersih nol; seluruh baris piutang lunas.
      const tb = (await api.get("/reports/trial-balance?dateFrom=2026-01-01&dateTo=2026-12-31")).body;
      expect(tb.lines.find((l: { code: string }) => l.code === "1-1300").closing).toBe("0.00");
      const aged = (await api.get("/reports/aged?type=receivable&dateTo=2026-12-31")).body;
      expect(aged.totals.total).toBe("0.00");
      expect(acc["4-9100"]).toBeDefined();
    });
  });

  describe("rekonsiliasi bank", () => {
    it("impor mutasi, saran pasangan, rekonsiliasi, biaya bank, dan pembatalan", async () => {
      const { api, acc, jr, customer } = await setup(app, "bank");
      const inv = await postedInvoice(api, {
        partnerId: customer,
        date: "2026-10-01",
        lines: [{ name: "Jasa", priceUnit: 1_110_000 }],
      });
      const csv = [
        "Tanggal,Keterangan,Debet,Kredit",
        `05/10/2026,TRSF DARI PT PELANGGAN EKSPOR ${inv.name},,"1.110.000,00"`,
        `06/10/2026,BIAYA ADMINISTRASI,"15.000,00",`,
      ].join("\n");
      const mapping = {
        date: "Tanggal",
        description: "Keterangan",
        debit: "Debet",
        credit: "Kredit",
        dateFormat: "DD/MM/YYYY",
        decimal: ",",
      };
      const statement = (
        await api
          .post("/bank-statements/import", { journalId: jr.BNK1, name: "Rekening Oktober", csv, mapping })
          .expect(201)
      ).body;
      expect(statement.lines.map((l: { amount: string }) => l.amount)).toEqual(["1110000.00", "-15000.00"]);

      const [incoming, fee] = statement.lines;
      const suggestions = (await api.get(`/bank-statement-lines/${incoming.id}/suggestions`).expect(200))
        .body;
      expect(suggestions[0]).toMatchObject({ moveId: inv.id, moveName: inv.name });
      expect(suggestions[0].score).toBeGreaterThanOrEqual(7);

      await api.post(`/bank-statement-lines/${fee.id}/reconcile`, {}).expect(400); // sisa belum dialokasikan
      await api
        .post(`/bank-statement-lines/${incoming.id}/reconcile`, { moveLineIds: [suggestions[0].id] })
        .expect(200);
      expect((await api.get(`/moves/${inv.id}`)).body.paymentState).toBe("paid");
      const after = (
        await api
          .post(`/bank-statement-lines/${fee.id}/reconcile`, {
            accountId: acc["7-1000"],
            label: "Biaya bank",
          })
          .expect(200)
      ).body;
      expect(after.lines.every((l: { moveId: string | null }) => l.moveId)).toBe(true);
      expect(after.lines[0].matchedPartnerName).toBe("PT Pelanggan Ekspor");

      const list = (await api.get("/bank-statements").expect(200)).body;
      expect(list[0]).toMatchObject({ lineCount: 2, openCount: 0, total: "1095000.00" });
      const gl = (
        await api.get(
          `/reports/general-ledger?accountId=${acc["1-1200"]}&dateFrom=2026-01-01&dateTo=2026-12-31`,
        )
      ).body;
      expect(gl.closing).toBe("1095000.00");

      await api.delete(`/bank-statements/${statement.id}`).expect(400);
      await api.post(`/bank-statement-lines/${incoming.id}/undo`).expect(200);
      expect((await api.get(`/moves/${inv.id}`)).body).toMatchObject({
        paymentState: "not_paid",
        amountResidual: "1110000.00",
      });
      const glAfterUndo = (
        await api.get(
          `/reports/general-ledger?accountId=${acc["1-1200"]}&dateFrom=2026-01-01&dateTo=2026-12-31`,
        )
      ).body;
      expect(glAfterUndo.closing).toBe("-15000.00");
      // Bisa direkonsiliasi ulang.
      await api
        .post(`/bank-statement-lines/${incoming.id}/reconcile`, { moveLineIds: [suggestions[0].id] })
        .expect(200);
      expect((await api.get(`/moves/${inv.id}`)).body.paymentState).toBe("paid");
    });

    it("menolak file dengan baris tidak valid", async () => {
      const { api, jr } = await setup(app, "bank2");
      const res = await api
        .post("/bank-statements/import", {
          journalId: jr.BNK1,
          name: "Rusak",
          csv: "Tanggal,Keterangan,Jumlah\n32/13/2026,X,100\n",
          mapping: { date: "Tanggal", description: "Keterangan", amount: "Jumlah" },
        })
        .expect(400);
      expect(res.body.errors[0]).toMatchObject({ row: 2 });
    });
  });

  describe("aset tetap", () => {
    it("jadwal penyusutan, posting bulanan, dan perlindungan aset berjalan", async () => {
      const { api, acc } = await setup(app, "asset");
      const asset = (
        await api
          .post("/assets", {
            code: "LPT-01",
            name: "Laptop kantor",
            acquisitionDate: "2026-01-05",
            firstDepreciationDate: "2026-01-05",
            cost: 24_000_000,
            usefulLifeMonths: 24,
            assetAccountId: acc["1-2100"],
            depreciationAccountId: acc["1-2190"],
            expenseAccountId: acc["6-4000"],
          })
          .expect(201)
      ).body;
      const confirmed = (await api.post(`/assets/${asset.id}/confirm`).expect(200)).body;
      expect(confirmed.state).toBe("running");
      expect(confirmed.schedule).toHaveLength(24);
      expect(confirmed.schedule[0]).toMatchObject({
        date: "2026-01-31",
        amount: "1000000.00",
        bookValue: "23000000.00",
      });

      expect((await api.post("/assets/depreciate", { date: "2026-06-30" }).expect(200)).body).toEqual({
        posted: 6,
        assets: 1,
      });
      expect((await api.post("/assets/depreciate", { date: "2026-06-30" }).expect(200)).body).toEqual({
        posted: 0,
        assets: 0,
      });
      const report = await pl(api, "2026-01-01", "2026-12-31");
      expect(report.expense.accounts).toEqual([
        expect.objectContaining({ code: "6-4000", amount: "6000000.00" }),
      ]);
      const schedule = (await api.get(`/assets/${asset.id}/schedule`)).body.schedule;
      expect(schedule.filter((l: { moveName: string | null }) => l.moveName).length).toBe(6);

      await api.patch(`/assets/${asset.id}`, { name: "Ubah" }).expect(400);
      await api.delete(`/assets/${asset.id}`).expect(400);

      // Habis disusutkan → selesai.
      expect((await api.post("/assets/depreciate", { date: "2027-12-31" }).expect(200)).body.posted).toBe(18);
      expect((await api.get(`/assets/${asset.id}`)).body.state).toBe("closed");
    });

    it("menolak akun dari perusahaan lain dan tanggal tidak logis", async () => {
      const { api, acc } = await setup(app, "asset2");
      const base = {
        name: "Mobil",
        acquisitionDate: "2026-03-01",
        firstDepreciationDate: "2026-02-01",
        cost: 1000,
        usefulLifeMonths: 12,
        assetAccountId: acc["1-2200"],
        depreciationAccountId: acc["1-2290"],
        expenseAccountId: acc["6-4000"],
      };
      await api.post("/assets", base).expect(400);
      const other = await setup(app, "asset3");
      const res = await api
        .post("/assets", {
          ...base,
          firstDepreciationDate: "2026-03-01",
          expenseAccountId: other.acc["6-4000"],
        })
        .expect(400);
      expect(res.body.errors[0].path).toBe("expenseAccountId");
    });
  });

  describe("tutup buku akhir tahun", () => {
    it("memindahkan laba ke saldo laba, mengunci periode, dan tidak bisa diulang", async () => {
      const { api, acc, customer } = await setup(app, "close");
      await postedInvoice(api, {
        partnerId: customer,
        date: "2025-06-01",
        lines: [{ name: "Penjualan 2025", priceUnit: 1_000_000 }],
      });
      const expense = (
        await api
          .post("/moves", {
            date: "2025-07-01",
            lines: [
              { accountId: acc["6-5000"], debit: 400_000 },
              { accountId: acc["1-1200"], credit: 400_000 },
            ],
          })
          .expect(201)
      ).body;
      await api.post(`/moves/${expense.id}/post`).expect(200);

      const draft = (
        await api
          .post("/moves", {
            date: "2025-08-01",
            lines: [
              { accountId: acc["6-5000"], debit: 1 },
              { accountId: acc["1-1200"], credit: 1 },
            ],
          })
          .expect(201)
      ).body;
      expect(
        (await api.post("/accounting/close-year", { fiscalYear: 2025 }).expect(400)).body.message,
      ).toMatch(/draft/);
      await api.delete(`/moves/${draft.id}`).expect(204);

      const closed = (await api.post("/accounting/close-year", { fiscalYear: 2025 }).expect(200)).body;
      expect(closed).toMatchObject({
        start: "2025-01-01",
        end: "2025-12-31",
        netProfit: "600000.00",
        name: "MISC/2025/0002",
      });
      expect((await api.get("/accounting/settings")).body.lockDate).toBe("2025-12-31");
      await api.post("/accounting/close-year", { fiscalYear: 2025 }).expect(400);

      // Laba rugi 2025 tetap menampilkan hasil usaha; neraca 2026 memuat saldo laba.
      expect((await pl(api, "2025-01-01", "2025-12-31")).netProfit).toBe("600000.00");
      const bs = (await api.get("/reports/balance-sheet?dateTo=2026-01-31")).body;
      expect(bs.balanced).toBe(true);
      expect(bs.equity.accounts).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "3-2000", amount: "600000.00" })]),
      );
      expect(
        bs.equity.accounts.find((a: { name: string }) => a.name.includes("belum dialokasi")),
      ).toBeUndefined();
    });
  });

  describe("anggaran & ekspor", () => {
    it("anggaran vs realisasi dan ekspor Excel", async () => {
      const { api, acc, customer } = await setup(app, "budget");
      await postedInvoice(api, {
        partnerId: customer,
        date: "2026-03-01",
        lines: [{ name: "Penjualan", priceUnit: 1_500_000 }],
      });
      await api
        .post("/budgets", {
          name: "x",
          dateFrom: "2026-01-01",
          dateTo: "2026-12-31",
          lines: [{ accountId: acc["1-1200"], amount: 1 }],
        })
        .expect(400);
      const budget = (
        await api
          .post("/budgets", {
            name: "Anggaran 2026",
            dateFrom: "2026-01-01",
            dateTo: "2026-12-31",
            lines: [
              { accountId: acc["4-1000"], amount: 2_000_000 },
              { accountId: acc["6-5000"], amount: 500_000 },
            ],
          })
          .expect(201)
      ).body;
      const report = (await api.get(`/reports/budget?budgetId=${budget.id}`).expect(200)).body;
      expect(
        report.lines.map((l: { code: string; actual: string; achievement: number }) => [
          l.code,
          l.actual,
          l.achievement,
        ]),
      ).toEqual([
        ["4-1000", "1500000.00", 75],
        ["6-5000", "0.00", 0],
      ]);
      expect(report.totals.income).toEqual({
        budget: "2000000.00",
        actual: "1500000.00",
        variance: "-500000.00",
      });

      const res = await api
        .get("/reports/profit-loss/export?dateFrom=2026-01-01&dateTo=2026-12-31")
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as Buffer);
      const values = wb.worksheets[0]!.getSheetValues().flat().filter(Boolean);
      expect(values).toEqual(expect.arrayContaining(["Laporan Laba Rugi", "Laba bersih", 1_500_000]));
      await api.get(`/reports/budget/export?budgetId=${budget.id}`).expect(200);
    });
  });
});
