import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FxSyncService } from "../src/master/fx.controller.js";
import { createApp, hasDb, signup } from "./helpers.js";

describe.skipIf(!hasDb)("Platform: impor Excel, kurs otomatis, error dua bahasa", () => {
  let app: INestApplication;
  let fxServer: Server;
  const fxCalls: string[] = [];
  let fxDown = false;

  beforeAll(async () => {
    // API Frankfurter tiruan: /latest atau /YYYY-MM-DD ?from=USD&to=IDR.
    fxServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      fxCalls.push(`${url.pathname}?${url.searchParams}`);
      if (fxDown) {
        res.writeHead(503).end();
        return;
      }
      const from = url.searchParams.get("from");
      const rates: Record<string, number> = { USD: 16250.5, EUR: 17600 };
      const date = url.pathname === "/latest" ? "2026-10-16" : url.pathname.slice(1);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ amount: 1, base: from, date, rates: { IDR: rates[from ?? ""] } }));
    });
    await new Promise<void>((r) => fxServer.listen(0, "127.0.0.1", r));
    process.env.FX_FRANKFURTER_URL = `http://127.0.0.1:${(fxServer.address() as AddressInfo).port}`;
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise((r) => fxServer.close(r));
    delete process.env.FX_FRANKFURTER_URL;
  });

  it("impor kontak dari .xlsx (judul kolom = nama field, boolean ya/tidak); ekspor .xlsx", async () => {
    const a = await signup(app, "xlsx");
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Kontak");
    sheet.addRow(["name", "isCustomer", "city", "email"]);
    sheet.addRow(["PT Excel Satu", "ya", "Surabaya", "satu@excel.co.id"]);
    sheet.addRow([]);
    sheet.addRow(["CV Excel Dua", true, { richText: [{ text: "Ma" }, { text: "lang" }] }, null]);
    const xlsx = Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
    expect((await a.post("/partners/import", { xlsx }).expect(200)).body).toMatchObject({
      created: 2,
      updated: 0,
    });
    const found = (await a.get("/partners?q=Excel").expect(200)).body.items;
    expect(
      found
        .map((p: { name: string; city: string; isCustomer: boolean }) => [p.name, p.city, p.isCustomer])
        .sort(),
    ).toEqual([
      ["CV Excel Dua", "Malang", true],
      ["PT Excel Satu", "Surabaya", true],
    ]);
    // Baris tidak valid: seluruh impor dibatalkan dengan nomor baris.
    const bad = new ExcelJS.Workbook();
    bad.addWorksheet("x").addRows([
      ["name", "email"],
      ["", "salah"],
    ]);
    const res = await a
      .post("/partners/import", { xlsx: Buffer.from(await bad.xlsx.writeBuffer()).toString("base64") })
      .expect(400);
    expect(res.body.errors[0]).toMatchObject({ row: 2 });
    await a.post("/partners/import", { xlsx: "bukan-excel" }).expect(400);
    await a.post("/partners/import", { csv: "name\nA", xlsx: "x" }).expect(400);

    const exported = await a
      .get("/partners/export?format=xlsx&q=Excel")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(exported.body as Buffer);
    const rows = back.worksheets[0]!.getSheetValues().filter(Boolean) as unknown[][];
    expect(rows[0]).toContain("name");
    expect(rows).toHaveLength(3);
  });

  it("kurs otomatis: pengaturan, ambil terbaru & per tanggal (upsert), error tercatat, penjadwal harian", async () => {
    const a = await signup(app, "fx");
    expect((await a.get("/fx/settings").expect(200)).body).toMatchObject({ source: "manual" });
    await a.post("/fx/fetch", {}).expect(400);
    await a.put("/fx/settings", { source: "frankfurter", currencies: ["usd", "XXX"] }).expect(400);
    const saved = (
      await a
        .put("/fx/settings", { source: "frankfurter", currencies: ["usd", "EUR", "IDR"], daily: true })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ source: "frankfurter", currencies: ["USD", "EUR"], daily: true });

    const latest = (await a.post("/fx/fetch", {}).expect(200)).body;
    expect(latest.rates).toEqual([
      { currencyCode: "USD", rateDate: "2026-10-16", rate: "16250.5" },
      { currencyCode: "EUR", rateDate: "2026-10-16", rate: "17600" },
    ]);
    await a.post("/fx/fetch", { date: "2026-10-01" }).expect(200);
    await a.post("/fx/fetch", {}).expect(200); // ambil ulang tanggal yang sama: diperbarui, tidak dobel
    const rates = (await a.get("/currency-rates?limit=50").expect(200)).body.items;
    expect(rates).toHaveLength(4);
    expect(fxCalls).toContain("/2026-10-01?from=USD&to=IDR");
    const conv = (await a.get("/fx/convert?from=USD&amount=100&date=2026-10-17").expect(200)).body;
    expect(conv.result).toBe("1625050"); // IDR tanpa desimal

    fxDown = true;
    const failed = await a.post("/fx/fetch", {}).set("Accept-Language", "en").expect(400);
    expect(failed.body.message).toBe("Failed to fetch rates: USD: HTTP 503");
    expect((await a.get("/fx/settings").expect(200)).body.lastError).toMatch(/HTTP 503/);
    fxDown = false;

    // Penjadwal: tenant ini sudah mengambil kurs < 20 jam lalu → dilewati.
    const before = fxCalls.length;
    await app.get(FxSyncService).runDaily();
    expect(fxCalls.length).toBe(before);
  });

  it("Accept-Language en: pesan error inti dalam bahasa Inggris", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Accept-Language", "en")
      .send({ tenantSlug: "tidak-ada", email: "a@b.co", password: "salah123" })
      .expect(401);
    expect(res.body.message).toBe("Wrong tenant, email, or password");
    const id = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: "tidak-ada", email: "a@b.co", password: "salah123" })
      .expect(401);
    expect(id.body.message).toBe("Tenant, email, atau password salah");
  });
});
