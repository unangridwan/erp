import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;

const accountsOf = async (api: Api) =>
  Object.fromEntries(
    ((await api.get("/accounts?limit=200").expect(200)).body.items as { code: string; id: string }[]).map(
      (a) => [a.code, a.id],
    ),
  );
const balances = async (api: Api, from: string, to: string) =>
  Object.fromEntries(
    (
      (await api.get(`/reports/trial-balance?dateFrom=${from}&dateTo=${to}`).expect(200)).body.lines as {
        code: string;
        closing: string;
      }[]
    ).map((l) => [l.code, l.closing]),
  );
const asset = async (api: Api, acc: Record<string, string>, body: object) => {
  const a = (
    await api
      .post("/assets", {
        assetAccountId: acc["1-2100"],
        depreciationAccountId: acc["1-2190"],
        expenseAccountId: acc["6-4000"],
        acquisitionDate: "2026-01-01",
        firstDepreciationDate: "2026-01-01",
        usefulLifeMonths: 12,
        ...body,
      })
      .expect(201)
  ).body;
  await api.post(`/assets/${a.id}/confirm`).expect(200);
  return a.id as string;
};

describe.skipIf(!hasDb)("Item tunda Fase 1: pelepasan aset & revaluasi kurs", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app?.close());

  it("jual aset: penyusutan s.d. bulan sebelumnya, faktur penjualan, laba pelepasan; hapus buku: rugi", async () => {
    const api = await signup(app, "dispose");
    const acc = await accountsOf(api);
    const buyer = (await api.post("/partners", { name: "PT Pembeli Mesin", isCustomer: true }).expect(201))
      .body.id;
    const purchase = (
      await api
        .post("/moves", {
          date: "2026-01-01",
          lines: [
            { accountId: acc["1-2100"], debit: 13_200_000, credit: 0 },
            { accountId: acc["1-1200"], debit: 0, credit: 13_200_000 },
          ],
        })
        .expect(201)
    ).body;
    await api.post(`/moves/${purchase.id}/post`).expect(200);
    const machine = await asset(api, acc, { code: "MSN-1", name: "Mesin", cost: 12_000_000 });
    const sold = (
      await api
        .post(`/assets/${machine}/dispose`, {
          date: "2026-04-15",
          kind: "sale",
          partnerId: buyer,
          price: 10_000_000,
        })
        .expect(200)
    ).body;
    expect(sold).toMatchObject({ state: "disposed", disposalGain: "1000000.00", bookValue: "9000000.00" });
    expect(sold.schedule).toHaveLength(3); // Jan–Mar diposting, sisa jadwal dihapus
    const invoice = (await api.get(`/moves/${sold.disposalInvoiceId}`).expect(200)).body;
    expect(invoice).toMatchObject({ state: "posted", moveType: "out_invoice", amountTotal: "10000000.00" });

    const scrap = await asset(api, acc, { code: "PRT-1", name: "Printer", cost: 1_200_000 });
    const scrapped = (
      await api.post(`/assets/${scrap}/dispose`, { date: "2026-02-10", kind: "scrap" }).expect(200)
    ).body;
    expect(scrapped).toMatchObject({
      state: "disposed",
      disposalGain: "-1100000.00",
      disposalInvoiceId: null,
    });

    const tb = await balances(api, "2026-01-01", "2026-12-31");
    expect(tb["1-2100"]).toBe("0.00");
    expect(tb["1-2190"]).toBe("0.00");
    expect(tb["4-9500"]).toBe("100000.00"); // laba 1.000.000 − rugi 1.100.000
    expect(tb["6-4000"]).toBe("3100000.00");
    await api.post(`/assets/${machine}/dispose`, { date: "2026-05-01", kind: "scrap" }).expect(400);
    await api.post(`/assets/${scrap}/dispose`, { date: "2026-05-01", kind: "sale" }).expect(400);
  });

  it("revaluasi kurs akhir bulan atas piutang & utang valas, dibalik keesokan harinya", async () => {
    const api = await signup(app, "reval");
    const customer = (await api.post("/partners", { name: "Buyer Abroad", isCustomer: true }).expect(201))
      .body.id;
    const vendor = (await api.post("/partners", { name: "Supplier Abroad", isSupplier: true }).expect(201))
      .body.id;
    await api
      .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-01-01", rate: 15000 })
      .expect(201);
    await api
      .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-01-31", rate: 16000 })
      .expect(201);
    const doc = async (moveType: string, partnerId: string, date: string, priceUnit: number) => {
      const draft = (
        await api
          .post("/moves", {
            moveType,
            partnerId,
            date,
            currencyCode: "USD",
            lines: [{ name: "Jasa", priceUnit }],
          })
          .expect(201)
      ).body;
      return (await api.post(`/moves/${draft.id}/post`).expect(200)).body;
    };
    await doc("out_invoice", customer, "2026-01-10", 100);
    await doc("in_invoice", vendor, "2026-01-15", 50);

    const preview = (await api.get("/accounting/fx-revaluations/preview?date=2026-01-31").expect(200)).body;
    expect(preview).toMatchObject({ gain: "100000.00", loss: "50000.00" });
    expect(
      preview.lines.map((l: { amountCurrency: string; difference: string }) => [
        l.amountCurrency,
        l.difference,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["100.00", "100000.00"],
        ["-50.00", "-50000.00"],
      ]),
    );
    const posted = (await api.post("/accounting/fx-revaluations", { date: "2026-01-31" }).expect(201)).body;
    expect(posted.reversalMoveId).toBeTruthy();
    await api.post("/accounting/fx-revaluations", { date: "2026-01-31" }).expect(409);
    expect((await api.get("/accounting/fx-revaluations").expect(200)).body).toHaveLength(1);

    const jan = await balances(api, "2026-01-01", "2026-01-31");
    expect(jan["1-1300"]).toBe("1600000.00");
    expect(jan["4-9110"]).toBe("-100000.00");
    expect(jan["7-1110"]).toBe("50000.00");
    const feb = await balances(api, "2026-01-01", "2026-02-28");
    expect(feb["1-1300"]).toBe("1500000.00");
    expect(feb["4-9110"] ?? "0.00").toBe("0.00");
    // Baris revaluasi tidak muncul sebagai piutang terbuka.
    const aged = (await api.get("/reports/aged?type=receivable&dateTo=2026-02-28").expect(200)).body;
    expect(aged.totals.total).toBe("1500000.00");
  });

  it("aset dijual ke perusahaan grup: draf aset di pembeli & eliminasi laba belum terealisasi", async () => {
    const hq = await signup(app, "icasset");
    const hqId = (await hq.get("/auth/me")).body.activeCompanyId;
    const aId = (
      await hq
        .post("/companies", {
          code: "A",
          name: "PT Anak Aset",
          entityType: "subsidiary",
          currencyCode: "IDR",
          parentId: hqId,
        })
        .expect(201)
    ).body.id;
    const a = client(app, hq.token, aId);
    await hq
      .post("/ownerships", {
        parentCompanyId: hqId,
        childCompanyId: aId,
        pct: 100,
        method: "full",
        validFrom: "2026-01-01",
        consideration: "2000000",
        acquiredNetAssets: "2000000",
      })
      .expect(201);
    const accHq = await accountsOf(hq);
    const accA = await accountsOf(a);
    const post = async (
      api: Api,
      acc: Record<string, string>,
      date: string,
      lines: [string, number, number][],
    ) => {
      const m = (
        await api
          .post("/moves", {
            date,
            lines: lines.map(([c, debit, credit]) => ({ accountId: acc[c], debit, credit })),
          })
          .expect(201)
      ).body;
      await api.post(`/moves/${m.id}/post`).expect(200);
    };
    await post(hq, accHq, "2026-01-01", [
      ["1-1200", 5_000_000, 0],
      ["3-1000", 0, 5_000_000],
    ]);
    await post(hq, accHq, "2026-01-01", [
      ["1-3100", 2_000_000, 0],
      ["1-1200", 0, 2_000_000],
    ]);
    await post(a, accA, "2026-01-01", [
      ["1-1200", 2_000_000, 0],
      ["3-1000", 0, 2_000_000],
    ]);
    const tool = await asset(a, accA, { code: "ALT-1", name: "Alat Berat", cost: 1_200_000 });
    await post(a, accA, "2026-01-01", [
      ["1-2100", 1_200_000, 0],
      ["1-1200", 0, 1_200_000],
    ]);
    const partners = (await hq.get("/partners?limit=200&active=all").expect(200)).body.items as {
      id: string;
      icCompanyId: string | null;
    }[];
    const icHq = partners.find((p) => p.icCompanyId === hqId)!.id;
    const icA = partners.find((p) => p.icCompanyId === aId)!.id;

    const sold = (
      await a
        .post(`/assets/${tool}/dispose`, {
          date: "2026-03-31",
          kind: "sale",
          partnerId: icHq,
          price: 1_000_000,
        })
        .expect(200)
    ).body;
    expect(sold).toMatchObject({ disposalGain: "100000.00" });
    expect(sold.transfer.assetId).toBeTruthy();
    const transferred = (await hq.get(`/assets/${sold.transfer.assetId}`).expect(200)).body;
    expect(transferred).toMatchObject({
      state: "draft",
      cost: "1000000.00",
      usefulLifeMonths: 9,
      firstDepreciationDate: "2026-04-01",
      sourceAssetId: tool,
    });
    await hq.post(`/assets/${transferred.id}/confirm`).expect(200);
    const bill = (
      await hq
        .post("/moves", {
          moveType: "in_invoice",
          partnerId: icA,
          date: "2026-03-31",
          lines: [{ name: "Alat Berat", priceUnit: 1_000_000, accountId: accHq["1-2100"] }],
        })
        .expect(201)
    ).body;
    await hq.post(`/moves/${bill.id}/post`).expect(200);
    await hq.post("/assets/depreciate", { date: "2026-06-30" }).expect(200);

    await hq.post("/consolidation/bootstrap").expect(200);
    const run = (
      await hq
        .post("/consolidation/runs", { rootCompanyId: hqId, dateFrom: "2026-01-01", dateTo: "2026-06-30" })
        .expect(201)
    ).body;
    expect(run.warnings).toEqual([]);
    const up = run.entries.find((e: { kind: string }) => e.kind === "unrealized_profit");
    expect(
      up.lines.map((l: { code: string; amount: string }) => [l.code, l.amount]),
      JSON.stringify(up.lines),
    ).toEqual([
      ["4-9500", "100000.00"],
      ["1-2100", "-66667.00"], // sisa laba: 100.000 − kelebihan penyusutan 3 × (111.111 − 100.000)
      ["6-4000", "-33333.00"],
    ]);
    const rows = (await hq.get(`/consolidation/runs/${run.id}/worksheet`).expect(200)).body.rows as {
      code: string;
      consolidated: string;
    }[];
    const c = (code: string) => rows.find((r) => r.code === code)?.consolidated ?? "0.00";
    expect(c("4-9500")).toBe("0.00");
    // Nilai buku grup = 1.200.000 − 6 bulan × 100.000.
    expect((Number(c("1-2100")) + Number(c("1-2190"))).toFixed(2)).toBe("600000.00");
    expect(c("6-4000")).toBe("600000.00");
    const report = (await hq.get(`/consolidation/runs/${run.id}/report`).expect(200)).body;
    expect(report.balanceSheet.difference).toBe("0.00");
  });
});
