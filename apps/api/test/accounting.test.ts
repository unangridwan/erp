import type { INestApplication } from "@nestjs/common";
import { eq, schema, sql } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  displayType: string;
  debit: string;
  credit: string;
  amountCurrency: string;
  icCompanyId: string | null;
}

describe.skipIf(!hasDb)("Fase 1: akuntansi inti", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let tenantId: string;
  let holdingId: string;
  const acc: Record<string, string> = {};
  const tax: Record<string, string> = {};
  const jr: Record<string, string> = {};
  let customer: string;
  let vendor: string;

  const accountCode = (lines: Line[], id: string) => Object.entries(acc).find(([, v]) => v === id)?.[0];
  const summary = (lines: Line[]) =>
    lines
      .map((l) => [accountCode(lines, l.accountId), l.debit, l.credit])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])));

  const invoice = (body: object) =>
    a.post("/moves", { moveType: "out_invoice", partnerId: customer, date: "2026-10-10", ...body });
  const postMove = (id: string) => a.post(`/moves/${id}/post`);

  async function loadMasters(api: Api) {
    for (const r of (await api.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const r of (await api.get("/taxes?limit=200").expect(200)).body.items) tax[r.name] = r.id;
    for (const r of (await api.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
  }

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "acc");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    holdingId = me.activeCompanyId;
    await loadMasters(a);
    customer = (await a.post("/partners", { name: "PT Pelanggan Setia", isCustomer: true }).expect(201)).body
      .id;
    vendor = (await a.post("/partners", { name: "CV Jasa Konsultan", isSupplier: true }).expect(201)).body.id;
  });

  afterAll(() => app?.close());

  describe("setup", () => {
    it("signup memasang bagan akun, jurnal, pajak, dan pengaturan", async () => {
      expect(Object.keys(acc)).toEqual(
        expect.arrayContaining(["1-1100", "1-1300", "2-1100", "2-1200", "4-1000", "6-5000"]),
      );
      expect(Object.keys(jr).sort()).toEqual(["BILL", "BNK1", "CSH1", "INV", "MISC", "SAL", "STJ"]);
      expect(Object.keys(tax)).toHaveLength(6);
      const settings = (await a.get("/accounting/settings").expect(200)).body;
      expect(settings).toMatchObject({
        receivableAccountId: acc["1-1300"],
        payableAccountId: acc["2-1100"],
        lockDate: null,
      });
      expect((await a.post("/accounting/setup").expect(200)).body).toEqual({ installed: false });
    });
  });

  describe("faktur penjualan", () => {
    let invoiceId: string;

    it("menghitung PPN 12% DPP 11/12 dan menyusun jurnal", async () => {
      const draft = (
        await invoice({
          lines: [
            {
              name: "Jasa implementasi",
              quantity: 1,
              priceUnit: 1_000_000,
              taxIds: [tax["PPN Keluaran 12% (DPP 11/12)"]],
            },
          ],
        }).expect(201)
      ).body;
      invoiceId = draft.id;
      expect(draft).toMatchObject({
        state: "draft",
        name: null,
        amountUntaxed: "1000000.00",
        amountTax: "110000.00",
        amountTotal: "1110000.00",
      });
      expect(summary(draft.lines)).toEqual([
        ["1-1300", "1110000.00", "0.00"],
        ["2-1200", "0.00", "110000.00"],
        ["4-1000", "0.00", "1000000.00"],
      ]);
      const taxLine = draft.lines.find((l: Line) => l.displayType === "tax");
      expect(taxLine.taxBaseAmount).toBe("916667.00");
    });

    it("draft bisa diubah; posting memberi nomor berurutan", async () => {
      await a
        .patch(`/moves/${invoiceId}`, {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-10-10",
          dueDate: "2026-11-09",
          lines: [
            {
              name: "Jasa implementasi",
              quantity: 2,
              priceUnit: 500_000,
              taxIds: [tax["PPN Keluaran 12% (DPP 11/12)"]],
            },
          ],
        })
        .expect(200);
      const posted = (await postMove(invoiceId).expect(200)).body;
      expect(posted).toMatchObject({
        state: "posted",
        name: "INV/2026/0001",
        amountResidual: "1110000.00",
        paymentState: "not_paid",
      });

      const second = (await invoice({ lines: [{ name: "Lisensi", priceUnit: 250_000 }] }).expect(201)).body;
      expect((await postMove(second.id).expect(200)).body.name).toBe("INV/2026/0002");
    });

    it("entri posted tidak bisa diubah/dihapus — juga di level database", async () => {
      await a
        .patch(`/moves/${invoiceId}`, {
          moveType: "out_invoice",
          partnerId: customer,
          date: "2026-10-10",
          lines: [{ name: "x", priceUnit: 1 }],
        })
        .expect(400);
      await a.delete(`/moves/${invoiceId}`).expect(400);
      await expect(
        app
          .get(TenantDb)
          .runAs(tenantId, (tx) =>
            tx
              .update(schema.accountMoveLines)
              .set({ debit: "1" })
              .where(eq(schema.accountMoveLines.moveId, invoiceId)),
          ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("pembayaran sebagian lalu pelunasan", async () => {
      const pay = (amount: number) =>
        a.post("/payments", {
          paymentType: "inbound",
          partnerId: customer,
          journalId: jr.BNK1,
          amount,
          date: "2026-10-20",
          moveIds: [invoiceId],
        });
      const first = (await pay(500_000).expect(201)).body;
      expect(first.moveName).toBe("BNK1/2026/0001");
      expect((await a.get(`/moves/${invoiceId}`)).body).toMatchObject({
        paymentState: "partial",
        amountResidual: "610000.00",
      });

      await pay(610_000).expect(201);
      expect((await a.get(`/moves/${invoiceId}`)).body).toMatchObject({
        paymentState: "paid",
        amountResidual: "0.00",
      });
      expect((await a.get("/payments").expect(200)).body).toHaveLength(2);
    });

    it("pembalikan membuat nota kredit dan menutup faktur", async () => {
      const inv = (await invoice({ lines: [{ name: "Salah input", priceUnit: 300_000 }] }).expect(201)).body;
      await postMove(inv.id).expect(200);
      const refund = (await a.post(`/moves/${inv.id}/reverse`, {}).expect(201)).body;
      expect(refund).toMatchObject({
        moveType: "out_refund",
        state: "posted",
        reversedEntryId: inv.id,
        ref: "Pembalikan INV/2026/0003",
      });
      expect(summary(refund.lines)).toEqual([
        ["1-1300", "0.00", "300000.00"],
        ["4-1000", "300000.00", "0.00"],
      ]);
      expect((await a.get(`/moves/${inv.id}`)).body.paymentState).toBe("reversed");
      await a.post(`/moves/${inv.id}/reverse`, {}).expect(409);
    });
  });

  describe("tagihan pembelian", () => {
    it("PPN masukan dan PPh 23 dipotong", async () => {
      const bill = (
        await a
          .post("/moves", {
            moveType: "in_invoice",
            partnerId: vendor,
            date: "2026-10-05",
            ref: "INV-VENDOR-77",
            lines: [
              {
                name: "Jasa konsultasi",
                priceUnit: 10_000_000,
                taxIds: [tax["PPN Masukan 12% (DPP 11/12)"], tax["PPh 23 2% (dipotong)"]],
              },
            ],
          })
          .expect(201)
      ).body;
      expect(bill).toMatchObject({ amountTax: "900000.00", amountTotal: "10900000.00" });
      expect(summary(bill.lines)).toEqual([
        ["1-1500", "1100000.00", "0.00"],
        ["2-1100", "0.00", "10900000.00"],
        ["2-1310", "0.00", "200000.00"],
        ["6-5000", "10000000.00", "0.00"],
      ]);
      expect((await postMove(bill.id).expect(200)).body.name).toBe("BILL/2026/0001");
    });

    it("menolak pajak penjualan pada tagihan pembelian", async () => {
      const res = await a
        .post("/moves", {
          moveType: "in_invoice",
          partnerId: vendor,
          date: "2026-10-05",
          lines: [{ name: "x", priceUnit: 1000, taxIds: [tax["PPN Keluaran 12% (DPP 11/12)"]] }],
        })
        .expect(400);
      expect(res.body.errors[0].path).toBe("lines.0.taxIds");
    });
  });

  describe("jurnal umum, saldo, dan lock date", () => {
    it("menolak posting entri tidak seimbang", async () => {
      const entry = (
        await a
          .post("/moves", {
            date: "2026-10-01",
            lines: [
              { accountId: acc["1-1200"], debit: 100 },
              { accountId: acc["3-1000"], credit: 90 },
            ],
          })
          .expect(201)
      ).body;
      const res = await postMove(entry.id).expect(400);
      expect(res.body.message).toMatch(/tidak seimbang/);
    });

    it("database menolak status posted untuk entri tidak seimbang meski aplikasi dilewati", async () => {
      const [move] = await app.get(TenantDb).runAs(tenantId, (tx) =>
        tx
          .select({ id: schema.accountMoves.id })
          .from(schema.accountMoves)
          .where(sql`${schema.accountMoves.state} = 'draft' and ${schema.accountMoves.moveType} = 'entry'`),
      );
      await expect(
        app
          .get(TenantDb)
          .runAs(tenantId, (tx) =>
            tx
              .update(schema.accountMoves)
              .set({ state: "posted" })
              .where(eq(schema.accountMoves.id, move!.id)),
          ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("setoran modal & lock date", async () => {
      const entry = (
        await a
          .post("/moves", {
            date: "2026-09-15",
            ref: "Setoran modal",
            lines: [
              { accountId: acc["1-1200"], debit: 50_000_000 },
              { accountId: acc["3-1000"], credit: 50_000_000 },
            ],
          })
          .expect(201)
      ).body;
      await a.patch("/accounting/settings", { lockDate: "2026-09-30" }).expect(200);
      const blocked = await postMove(entry.id).expect(400);
      expect(blocked.body.message).toMatch(/dikunci/);
      await a.patch("/accounting/settings", { lockDate: null }).expect(200);
      expect((await postMove(entry.id).expect(200)).body.name).toBe("MISC/2026/0001");
    });
  });

  describe("multi mata uang, intercompany, dimensi", () => {
    it("faktur USD dikonversi ke IDR dengan kurs tanggal faktur", async () => {
      await a
        .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-10-01", rate: 16000 })
        .expect(201);
      const inv = (
        await invoice({
          currencyCode: "USD",
          lines: [{ name: "Export service", quantity: 2, priceUnit: "50.25" }],
        }).expect(201)
      ).body;
      expect(inv).toMatchObject({
        currencyCode: "USD",
        currencyRate: "16000.0000000000",
        amountTotal: "100.50",
      });
      const term = inv.lines.find((l: Line) => l.displayType === "payment_term");
      expect(term).toMatchObject({ debit: "1608000.00", amountCurrency: "100.50", currencyCode: "USD" });
      await postMove(inv.id).expect(200);
    });

    it("faktur ke anak perusahaan memakai akun piutang antar perusahaan", async () => {
      const sub = (
        await a.post("/companies", { code: "SUB1", name: "PT Anak Satu", parentId: holdingId }).expect(201)
      ).body;
      const icPartner = (await a.get("/partners?q=Anak Satu")).body.items[0];
      const inv = (
        await a
          .post("/moves", {
            moveType: "out_invoice",
            partnerId: icPartner.id,
            date: "2026-10-12",
            lines: [{ name: "Management fee", priceUnit: 2_000_000, accountId: acc["4-1200"] }],
          })
          .expect(201)
      ).body;
      expect(summary(inv.lines)).toEqual([
        ["1-1310", "2000000.00", "0.00"],
        ["4-1200", "0.00", "2000000.00"],
      ]);
      expect(inv.lines.every((l: Line) => l.icCompanyId === sub.id)).toBe(true);
      await postMove(inv.id).expect(200);

      // Anak perusahaan otomatis punya bagan akunnya sendiri; akun induk tidak bisa dipakai di sana.
      const subApi = client(app, a.token, sub.id);
      expect((await subApi.get("/accounts?q=1-1300")).body.items).toHaveLength(1);
      const res = await subApi
        .post("/moves", {
          date: "2026-10-12",
          lines: [
            { accountId: acc["1-1200"], debit: 1 },
            { accountId: acc["3-1000"], credit: 1 },
          ],
        })
        .expect(400);
      expect(res.body.errors[0]).toMatchObject({ path: "lines.0.accountId" });
    });

    it("filter laporan per cabang", async () => {
      const branch = (
        await a.post("/branches", { companyId: holdingId, code: "BDG", name: "Cabang Bandung" }).expect(201)
      ).body;
      const inv = (
        await invoice({
          lines: [{ name: "Penjualan cabang", priceUnit: 750_000, branchId: branch.id }],
        }).expect(201)
      ).body;
      await postMove(inv.id).expect(200);
      const tb = (await a.get(`/reports/trial-balance?branchId=${branch.id}&dateTo=2026-12-31`).expect(200))
        .body;
      expect(tb.lines.map((l: { code: string; closing: string }) => [l.code, l.closing])).toEqual([
        ["4-1000", "-750000.00"],
      ]);
    });
  });

  describe("laporan", () => {
    it("neraca saldo seimbang dan neraca balance", async () => {
      const tb = (await a.get("/reports/trial-balance?dateTo=2026-12-31").expect(200)).body;
      expect(tb.totals.debit).toBe(tb.totals.credit);
      expect(tb.totals.closing).toBe("0.00");
      const bs = (await a.get("/reports/balance-sheet?dateTo=2026-12-31").expect(200)).body;
      expect(bs.balanced).toBe(true);
      expect(bs.assets.total).toBe(bs.totalLiabilitiesAndEquity);
    });

    it("laba rugi menjumlahkan pendapatan dan beban", async () => {
      const pl = (await a.get("/reports/profit-loss?dateFrom=2026-01-01&dateTo=2026-12-31").expect(200)).body;
      // 1.000.000 + 250.000 + (300.000 − 300.000) + 1.608.000 + 2.000.000 + 750.000 pendapatan; beban 10.000.000.
      expect(pl.income.total).toBe("5608000.00");
      expect(pl.expense.total).toBe("10000000.00");
      expect(pl.netProfit).toBe("-4392000.00");
      const bs = (await a.get("/reports/balance-sheet?dateTo=2026-12-31")).body;
      expect(bs.equity.accounts.at(-1)).toMatchObject({
        name: "Laba/rugi tahun berjalan",
        amount: "-4392000.00",
      });
    });

    it("buku besar dengan saldo berjalan", async () => {
      const gl = (
        await a
          .get(`/reports/general-ledger?accountId=${acc["1-1200"]}&dateFrom=2026-01-01&dateTo=2026-12-31`)
          .expect(200)
      ).body;
      expect(gl.lines.map((l: { balance: string }) => l.balance)).toEqual([
        "50000000.00",
        "50500000.00",
        "51110000.00",
      ]);
      expect(gl.closing).toBe("51110000.00");
    });

    it("umur piutang per jatuh tempo", async () => {
      const aged = (await a.get("/reports/aged?type=receivable&dateTo=2026-12-01").expect(200)).body;
      const pelanggan = aged.partners.find((p: { partner: string }) => p.partner === "PT Pelanggan Setia");
      // INV/2026/0002 (250.000) & faktur cabang (750.000) jatuh tempo 10-10 → 52 hari; faktur USD 1.608.000.
      expect(pelanggan).toMatchObject({ d31_60: "2608000.00", total: "2608000.00" });
      const anak = aged.partners.find((p: { partner: string }) => p.partner === "PT Anak Satu");
      expect(anak.total).toBe("2000000.00");
      const payable = (await a.get("/reports/aged?type=payable&dateTo=2026-10-20")).body;
      expect(payable.totals.total).toBe("10900000.00");
    });
  });

  describe("hak akses", () => {
    it("role read-only tidak bisa membuat atau memposting entri", async () => {
      const roles = (await a.get("/roles")).body as { id: string; code: string }[];
      await a
        .post("/users", {
          name: "Auditor",
          email: "auditor@example.com",
          password: "rahasia123",
          roleIds: [roles.find((r) => r.code === "user")!.id],
          companyIds: [holdingId],
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "auditor@example.com", password: "rahasia123" });
      const auditor = client(app, login.body.token);
      await auditor.get("/reports/trial-balance").expect(200);
      await auditor.post("/moves", { date: "2026-10-01", lines: [] }).expect(403);
      await auditor.post("/payments", {}).expect(403);
    });
  });
});

describe.skipIf(!hasDb)("Fase 1: master akuntansi per perusahaan", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  it("PATCH tidak memindahkan akun ke perusahaan lain; akun pajak divalidasi terhadap perusahaan baris", async () => {
    const a = await signup(app, "acc2");
    const holdingId = (await a.get("/auth/me")).body.activeCompanyId;
    const sub = (
      await a.post("/companies", { code: "S2", name: "PT Anak Dua", parentId: holdingId }).expect(201)
    ).body;
    const accounts = (await a.get("/accounts?limit=200")).body.items as { id: string; code: string }[];
    const vat = accounts.find((x) => x.code === "2-1200")!;
    const pph = accounts.find((x) => x.code === "2-1310")!;

    await a.patch(`/accounts/${vat.id}`, { companyId: sub.id, name: "PPN Keluaran (ubah)" }).expect(200);
    expect((await a.get(`/accounts/${vat.id}`).expect(200)).body).toMatchObject({
      companyId: holdingId,
      name: "PPN Keluaran (ubah)",
    });

    const taxes = (await a.get("/taxes")).body.items as { id: string; name: string }[];
    const tax = taxes.find((t) => t.name.startsWith("PPN Keluaran 12% (DPP"))!;
    await a.patch(`/taxes/${tax.id}`, { accountId: pph.id }).expect(200);

    const subAccount = (await client(app, a.token, sub.id).get("/accounts?q=2-1200")).body.items[0];
    const res = await a.patch(`/taxes/${tax.id}`, { accountId: subAccount.id }).expect(400);
    expect(res.body.errors[0].path).toBe("accountId");
  });
});
