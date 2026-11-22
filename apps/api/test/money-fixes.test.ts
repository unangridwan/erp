import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

type Api = Awaited<ReturnType<typeof signup>>;

/** Perbaikan hasil audit: pembalikan pembayaran, pelunasan valas campuran, pembayaran nota kredit. */
describe.skipIf(!hasDb)("Pelunasan: pembalikan, valas campuran, nota kredit", () => {
  let app: INestApplication;
  let api: Api;
  const jr: Record<string, string> = {};
  let customer: string;
  let vendor: string;

  const posted = async (body: object) => {
    const draft = (await api.post("/moves", body).expect(201)).body;
    return (await api.post(`/moves/${draft.id}/post`).expect(200)).body as { id: string; name: string };
  };
  const move = async (id: string) => (await api.get(`/moves/${id}`).expect(200)).body;

  beforeAll(async () => {
    app = await createApp();
    api = await signup(app, "uang");
    for (const r of (await api.get("/journals")).body.items) jr[r.code] = r.id;
    customer = (await api.post("/partners", { name: "PT Pelanggan", isCustomer: true }).expect(201)).body.id;
    vendor = (await api.post("/partners", { name: "CV Pemasok", isSupplier: true }).expect(201)).body.id;
  });
  afterAll(() => app?.close());

  it("membalik jurnal pembayaran membuka kembali faktur yang dilunasinya", async () => {
    const inv = await posted({
      moveType: "out_invoice",
      partnerId: customer,
      date: "2026-10-10",
      lines: [{ name: "Jasa", priceUnit: 1_000_000 }],
    });
    const pay = (
      await api
        .post("/payments", {
          paymentType: "inbound",
          partnerId: customer,
          journalId: jr.BNK1,
          amount: 1_000_000,
          date: "2026-10-15",
          moveIds: [inv.id],
        })
        .expect(201)
    ).body;
    expect((await move(inv.id)).paymentState).toBe("paid");

    await api.post(`/moves/${pay.moveId}/reverse`, {}).expect(201);
    expect(await move(inv.id)).toMatchObject({ paymentState: "not_paid", amountResidual: "1000000.00" });
  });

  it("bayar sebagian dalam rupiah atas faktur valas mengurangi sisa valas secara proporsional", async () => {
    await api
      .post("/currency-rates", { currencyCode: "USD", rateDate: "2026-09-01", rate: 16000 })
      .expect(201);
    const inv = await posted({
      moveType: "out_invoice",
      partnerId: customer,
      date: "2026-09-10",
      currencyCode: "USD",
      lines: [{ name: "Ekspor", priceUnit: 1000 }],
    });
    // Setengahnya dibayar dalam rupiah (kurs sama), sisanya dalam USD.
    await api
      .post("/payments", {
        paymentType: "inbound",
        partnerId: customer,
        journalId: jr.BNK1,
        amount: 8_000_000,
        date: "2026-09-15",
        moveIds: [inv.id],
      })
      .expect(201);
    expect((await move(inv.id)).amountResidual).toBe("8000000.00");
    await api
      .post("/payments", {
        paymentType: "inbound",
        partnerId: customer,
        journalId: jr.BNK1,
        amount: 500,
        currencyCode: "USD",
        date: "2026-09-20",
        moveIds: [inv.id],
      })
      .expect(201);
    // Lunas penuh; tanpa ini sisa USD masih 1.000 sehingga USD 500 hanya melunasi Rp4 juta.
    expect(await move(inv.id)).toMatchObject({ paymentState: "paid", amountResidual: "0.00" });
  });

  it("nota kredit pelanggan bisa dibayar (uang keluar) dan nota kredit pemasok bisa diterima (uang masuk)", async () => {
    const credit = await posted({
      moveType: "out_refund",
      partnerId: customer,
      date: "2026-10-10",
      lines: [{ name: "Retur", priceUnit: 200_000 }],
    });
    await api
      .post("/payments", {
        paymentType: "outbound",
        partnerId: customer,
        journalId: jr.BNK1,
        amount: 200_000,
        date: "2026-10-12",
        moveIds: [credit.id],
      })
      .expect(201);
    expect((await move(credit.id)).paymentState).toBe("paid");

    const debit = await posted({
      moveType: "in_refund",
      partnerId: vendor,
      date: "2026-10-10",
      lines: [{ name: "Retur pembelian", priceUnit: 150_000 }],
    });
    await api
      .post("/payments", {
        paymentType: "inbound",
        partnerId: vendor,
        journalId: jr.BNK1,
        amount: 150_000,
        date: "2026-10-12",
        moveIds: [debit.id],
      })
      .expect(201);
    expect((await move(debit.id)).paymentState).toBe("paid");
  });
});
