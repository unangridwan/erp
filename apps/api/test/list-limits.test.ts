import type { INestApplication } from "@nestjs/common";
import { LIST_LOAD_LIMIT } from "@erp/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/**
 * Daftar di web memuat s.d. `LIST_LOAD_LIMIT` baris sekali lalu dicari/difilter/diurutkan di browser, jadi endpoint
 * daftar harus menerima limit itu (dulu 200: CRUD dipotong diam-diam, `/moves` menolak dengan 400).
 */
describe.skipIf(!hasDb)("Batas muat daftar", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "batasdaftar");
    for (let i = 0; i < 3; i++)
      await a.post("/partners", { name: `Mitra ${i}`, isCustomer: true }).expect(201);
  });
  afterAll(() => app?.close());

  it("CRUD: bawaan 50, limit dinaikkan s.d. batas muat (lebih besar dipotong)", async () => {
    expect((await a.get("/partners").expect(200)).body.limit).toBe(50);
    expect((await a.get(`/partners?limit=${LIST_LOAD_LIMIT}`).expect(200)).body.limit).toBe(LIST_LOAD_LIMIT);
    const clamped = (await a.get(`/partners?limit=${LIST_LOAD_LIMIT * 2}`).expect(200)).body;
    expect(clamped.limit).toBe(LIST_LOAD_LIMIT);
    expect(clamped.total).toBeGreaterThanOrEqual(3);
  });

  it("jurnal, SO, PO, transfer, lead menerima limit batas muat", async () => {
    await a.get(`/moves?type=out_invoice&limit=${LIST_LOAD_LIMIT}`).expect(200);
    await a.get(`/moves?type=out_invoice&limit=${LIST_LOAD_LIMIT + 1}`).expect(400);
    for (const path of [
      "/sale-orders",
      "/purchase-orders",
      "/pickings?pickingType=outgoing",
      "/leads",
      "/employees",
    ]) {
      const res = await a.get(`${path}${path.includes("?") ? "&" : "?"}limit=${LIST_LOAD_LIMIT}`).expect(200);
      expect(Array.isArray(res.body.items ?? res.body)).toBe(true);
    }
  });
});
