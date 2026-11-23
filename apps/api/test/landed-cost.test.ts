import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";
import { businessToday } from "@erp/shared";

type Api = ReturnType<typeof client>;
interface Product {
  productId: string;
  sku: string;
  addition: string;
  stockPortion: string;
  soldPortion: string;
}

const today = businessToday();

describe.skipIf(!hasDb)("Landed cost: biaya angkut/bea masuk ke nilai persediaan", () => {
  let app: INestApplication;
  let a: Api;
  const acc: Record<string, string> = {};
  const prod: Record<string, string> = {};
  let receipt = "";
  let pcs = "";

  const picking = async (pickingType: string, moves: object[], partnerId?: string) => {
    const id = (
      await a.post("/pickings", { pickingType, scheduledDate: today, partnerId, moves }).expect(201)
    ).body.id as string;
    await a.post(`/pickings/${id}/validate`, {}).expect(200);
    return id;
  };
  const valuation = async (productId: string) =>
    (
      (await a.get(`/stock/valuation?date=${today}`).expect(200)).body.items as {
        productId: string;
        quantity: string;
        value: string;
      }[]
    ).find((v) => v.productId === productId);
  const balance = async (accountId: string) => {
    const tb = (await a.get(`/reports/trial-balance?dateFrom=${today}&dateTo=${today}`).expect(200)).body;
    const row = (tb.accounts ?? tb.rows ?? tb).find?.(
      (r: { id?: string; accountId?: string }) => (r.id ?? r.accountId) === accountId,
    );
    return row;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "landed");
    for (const r of (await a.get("/accounts?limit=500").expect(200)).body.items) acc[r.code] = r.id;
    pcs = ((await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]).find(
      (u) => u.name === "Pcs",
    )!.id;
    prod.A = (
      await a
        .post("/products", {
          sku: "BENIH-A",
          name: "Benih Padi",
          uomId: pcs,
          cost: "10000",
          costMethod: "fifo",
          weight: "2",
        })
        .expect(201)
    ).body.id;
    prod.B = (
      await a
        .post("/products", {
          sku: "PUPUK-B",
          name: "Pupuk",
          uomId: pcs,
          cost: "30000",
          costMethod: "average",
          weight: "10",
        })
        .expect(201)
    ).body.id;
    const vendor = (await a.post("/partners", { name: "Importir", isSupplier: true }).expect(201)).body.id;
    // Terima 10 benih @100.000 (1 jt) dan 5 pupuk @600.000 (3 jt); 4 benih langsung terjual.
    receipt = await picking(
      "incoming",
      [
        { productId: prod.A, quantity: "10", priceUnit: "100000" },
        { productId: prod.B, quantity: "5", priceUnit: "600000" },
      ],
      vendor,
    );
    const customer = (await a.post("/partners", { name: "Petani", isCustomer: true }).expect(201)).body.id;
    await picking("outgoing", [{ productId: prod.A, quantity: "4" }], customer);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pratinjau membagi per metode (nilai & berat) dan memisahkan porsi barang terjual", async () => {
    const lc = (
      await a
        .post("/landed-costs", {
          date: today,
          pickingIds: [receipt],
          lines: [
            { name: "Bea masuk", accountId: acc["2-1700"], amount: "400000", splitMethod: "value" },
            { name: "Ongkos angkut", accountId: acc["6-2000"], amount: "700000", splitMethod: "weight" },
          ],
        })
        .expect(201)
    ).body;
    expect(lc.state).toBe("draft");
    expect(lc.errors).toEqual([]);
    const a1 = lc.products.find((p: Product) => p.productId === prod.A);
    const b1 = lc.products.find((p: Product) => p.productId === prod.B);
    // Bea: 100rb / 300rb (nilai 1:3). Angkut berat: A 20kg, B 50kg → 200rb / 500rb.
    expect(a1).toMatchObject({ addition: "300000.00", stockPortion: "180000.00", soldPortion: "120000.00" });
    expect(b1).toMatchObject({ addition: "800000.00", stockPortion: "800000.00", soldPortion: "0.00" });

    // Volume belum diisi → baris dengan metode volume ditolak saat posting.
    const bad = (
      await a
        .put(`/landed-costs/${lc.id}`, {
          date: today,
          pickingIds: [receipt],
          lines: [{ name: "Asuransi", accountId: acc["6-2000"], amount: "100", splitMethod: "volume" }],
        })
        .expect(200)
    ).body;
    expect(bad.errors.join(" ")).toContain("Volume");
    await a.post(`/landed-costs/${lc.id}/post`).expect(400);
    await a.delete(`/landed-costs/${lc.id}`).expect(204);
  });

  it("posting menaikkan nilai persediaan (FIFO & rata-rata) dan membebankan porsi terjual ke HPP", async () => {
    const before = { A: await valuation(prod.A!), B: await valuation(prod.B!) };
    expect(before.A).toMatchObject({ quantity: "6.0000", value: "600000.00" });
    expect(before.B).toMatchObject({ quantity: "5.0000", value: "3000000.00" });
    const lc = (
      await a
        .post("/landed-costs", {
          date: today,
          pickingIds: [receipt],
          lines: [
            { name: "Bea masuk", accountId: acc["2-1700"], amount: "400000", splitMethod: "value" },
            { name: "Ongkos angkut", accountId: acc["6-2000"], amount: "700000", splitMethod: "weight" },
          ],
        })
        .expect(201)
    ).body;
    const posted = (await a.post(`/landed-costs/${lc.id}/post`).expect(200)).body;
    expect(posted.state).toBe("posted");
    expect(await valuation(prod.A!)).toMatchObject({ quantity: "6.0000", value: "780000.00" });
    expect(await valuation(prod.B!)).toMatchObject({ quantity: "5.0000", value: "3800000.00" });

    // Jurnal: Dr persediaan 980rb + Dr HPP 120rb / Cr bea 400rb + Cr angkut 700rb.
    const move = (await a.get(`/moves/${posted.accountMove.id}`).expect(200)).body;
    const sum = (side: "debit" | "credit") =>
      move.lines.reduce((s: number, l: { debit: string; credit: string }) => s + Number(l[side]), 0);
    expect(sum("debit")).toBe(1_100_000);
    expect(sum("credit")).toBe(1_100_000);

    // Barang FIFO yang keluar berikutnya membawa biaya baru: 180rb/6 = 30rb tambahan per unit.
    const customer = (await a.post("/partners", { name: "Kios", isCustomer: true }).expect(201)).body.id;
    const out = (
      await a
        .post("/pickings", {
          pickingType: "outgoing",
          scheduledDate: today,
          partnerId: customer,
          moves: [{ productId: prod.A, quantity: "2" }],
        })
        .expect(201)
    ).body.id;
    const res = (await a.post(`/pickings/${out}/validate`, {}).expect(200)).body;
    expect(res.moves[0]).toMatchObject({ value: "260000.00", unitCost: "130000.0000" });

    // Pembatalan ditolak karena barang sudah keluar lagi.
    await a.post(`/landed-costs/${lc.id}/cancel`).expect(400);
  });

  it("batal sebelum barang keluar mengembalikan nilai; draft dari tagihan jasa", async () => {
    const vendor = (await a.post("/partners", { name: "Ekspedisi", isSupplier: true }).expect(201)).body.id;
    const r2 = await picking("incoming", [{ productId: prod.B, quantity: "5", priceUnit: "600000" }], vendor);
    const bill = (
      await a
        .post("/moves", {
          moveType: "in_invoice",
          partnerId: vendor,
          date: today,
          lines: [{ name: "Ongkir truk", priceUnit: 250000, accountId: acc["6-2000"] }],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${bill.id}/post`).expect(200);
    const lc = (await a.post(`/landed-costs/from-bill/${bill.id}`, { pickingIds: [r2] }).expect(201)).body;
    expect(lc.lines).toHaveLength(1);
    expect(lc.lines[0]).toMatchObject({ name: "Ongkir truk", amount: "250000.00", accountId: acc["6-2000"] });
    const beforeB = await valuation(prod.B!);
    await a.post(`/landed-costs/${lc.id}/post`).expect(200);
    expect(Number((await valuation(prod.B!))!.value)).toBe(Number(beforeB!.value) + 250000);
    const cancelled = (await a.post(`/landed-costs/${lc.id}/cancel`).expect(200)).body;
    expect(cancelled.state).toBe("cancel");
    expect((await valuation(prod.B!))!.value).toBe(beforeB!.value);
    void balance;
  });
});
