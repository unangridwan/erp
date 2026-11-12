import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Mailer } from "../src/common/mailer.js";
import { DunningScheduler } from "../src/credit/credit.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;

describe.skipIf(!hasDb)("Batas kredit & dunning", () => {
  let app: INestApplication;
  let a: Api;
  let tenantId: string;
  let holdingId: string;
  let sub: Api;
  let customer: string;
  let noEmail: string;
  let excluded: string;
  const acc: Record<string, string> = {};
  const jr: Record<string, string> = {};

  const invoice = async (
    api: Api,
    partnerId: string,
    date: string,
    dueDate: string,
    amount: number,
    revenue = acc["4-1000"],
  ) => {
    const inv = (
      await api
        .post("/moves", {
          moveType: "out_invoice",
          partnerId,
          date,
          dueDate,
          lines: [{ name: "Benih padi", priceUnit: amount, accountId: revenue }],
        })
        .expect(201)
    ).body;
    await api.post(`/moves/${inv.id}/post`).expect(200);
    return inv.id as string;
  };

  beforeAll(async () => {
    app = await createApp();
    const s = await signup(app, "cred");
    a = s;
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    holdingId = me.activeCompanyId;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const r of (await a.get("/journals").expect(200)).body.items) jr[r.code] = r.id;
    customer = (
      await a
        .post("/partners", { name: "CV Tani Makmur", isCustomer: true, email: "bayar@tanimakmur.id" })
        .expect(201)
    ).body.id;
    noEmail = (await a.post("/partners", { name: "UD Tanpa Email", isCustomer: true }).expect(201)).body.id;
    excluded = (
      await a
        .post("/partners", { name: "PT Dikecualikan", isCustomer: true, email: "x@dikecualikan.id" })
        .expect(201)
    ).body.id;
    const company = (
      await a.post("/companies", { code: "BNH", name: "PT Benih Uji", parentId: holdingId }).expect(201)
    ).body;
    sub = client(app, s.token, company.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("batas kredit (peringatan)", () => {
    it("menyimpan batas per perusahaan dan menghitung paparan", async () => {
      expect((await a.get(`/partners/${customer}/credit`).expect(200)).body).toMatchObject({
        creditLimit: null,
        exceeded: false,
      });
      await a.put(`/partners/${customer}/credit`, { creditLimit: "-1" }).expect(400);
      const saved = (
        await a
          .put(`/partners/${customer}/credit`, { creditLimit: "10000000", overdueWarnDays: 30 })
          .expect(200)
      ).body;
      expect(saved).toMatchObject({ creditLimit: "10000000.00", exposure: "0.00", available: "10000000.00" });
      // Perusahaan lain tidak terpengaruh.
      expect((await sub.get(`/partners/${customer}/credit`).expect(200)).body.creditLimit).toBeNull();

      await invoice(a, customer, "2026-08-01", "2026-08-31", 6_000_000);
      const status = (await a.get(`/partners/${customer}/credit?date=2026-11-11`).expect(200)).body;
      expect(status.receivable).toBe("6000000.00");
      expect(status.oldestOverdueDays).toBe(72);
      expect(status.overdueWarning).toBe(true);
      expect(status.exceeded).toBe(false);
    });

    it("SO yang melebihi batas tetap bisa dikonfirmasi, dengan peringatan dan catatan di riwayat", async () => {
      const order = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder: "2026-11-10",
            lines: [{ name: "Benih jagung", priceUnit: 5_000_000, quantity: 1 }],
          })
          .expect(201)
      ).body;
      const check = (await a.get(`/sale-orders/${order.id}/credit-check`).expect(200)).body;
      expect(check.exceeded).toBe(true);
      expect(check.orderAmount).toBe(order.amountTotal);
      expect(check.warnings[0]).toMatch(/Melebihi batas kredit/);

      await a.post(`/sale-orders/${order.id}/confirm`).expect(200);
      const after = (await a.get(`/partners/${customer}/credit`).expect(200)).body;
      expect(after.uninvoicedOrders).toBe(order.amountTotal);
      const log = (await a.get(`/activity/sale_order/${order.id}`).expect(200)).body;
      expect(JSON.stringify(log)).toMatch(/peringatan kredit/);
    });
  });

  describe("dunning", () => {
    let dueInvoice: string;

    it("membuat tingkat bawaan dan menolak urutan ganda", async () => {
      const levels = (await a.get("/dunning-levels").expect(200)).body;
      expect(levels.map((l: { daysOverdue: number }) => l.daysOverdue)).toEqual([7, 30, 60]);
      const res = await a
        .post("/dunning-levels", {
          sequence: 1,
          name: "Ganda",
          daysOverdue: 3,
          emailSubject: "x",
          body: "y",
        })
        .expect(400);
      expect(res.body.errors[0].path).toBe("sequence");
    });

    it("pratinjau memilih tingkat sesuai umur tunggakan dan melewati yang dikecualikan", async () => {
      dueInvoice = await invoice(a, noEmail, "2026-10-01", "2026-10-31", 2_000_000);
      await invoice(a, excluded, "2026-08-01", "2026-08-31", 1_000_000);
      await a.put(`/partners/${excluded}/credit`, { dunningExcluded: true }).expect(200);
      const preview = (await a.get("/dunning/preview?date=2026-11-11").expect(200)).body;
      const byPartner = Object.fromEntries(
        preview.map((p: { partnerId: string; level: { sequence: number } }) => [
          p.partnerId,
          p.level.sequence,
        ]),
      );
      expect(byPartner).toEqual({ [customer]: 3, [noEmail]: 1 });
    });

    it("kirim: email ber-PDF, tingkat faktur naik, tidak dikirim ulang; tanpa email tercatat gagal", async () => {
      const mailer = app.get(Mailer);
      const before = mailer.outbox.length;
      const res = await a.post("/dunning/send", { date: "2026-11-11" });
      expect(res.body).not.toHaveProperty("errors");
      expect(res.status).toBe(200);
      const letters = res.body;
      expect(letters).toHaveLength(2);
      const sent = letters.find((l: { partnerId: string }) => l.partnerId === customer);
      const failed = letters.find((l: { partnerId: string }) => l.partnerId === noEmail);
      expect(sent).toMatchObject({ state: "sent", levelSequence: 3, totalOverdue: "6000000.00" });
      expect(failed).toMatchObject({ state: "failed", levelSequence: 1 });
      const mail = mailer.outbox.slice(before).find((m) => m.to === "bayar@tanimakmur.id")!;
      expect(mail.subject).toContain("Teguran terakhir");
      expect(mail.text).toContain("CV Tani Makmur");
      expect(mail.attachments?.[0]?.contentType).toBe("application/pdf");

      expect((await a.get("/dunning/preview?date=2026-11-11").expect(200)).body).toEqual([]);
      expect((await a.get(`/moves/${dueInvoice}`).expect(200)).body.dunningLevel).toBe(1);

      const pdf = await a.get(`/dunning-letters/${failed.id}/pdf`).expect(200);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      const list = (await a.get(`/dunning-letters?partnerId=${noEmail}`).expect(200)).body;
      expect(list[0]).toMatchObject({ state: "printed", automatic: false });

      // Kirim ulang ke alamat yang diisi manual.
      const resent = (
        await a.post(`/dunning-letters/${failed.id}/resend`, { to: "keuangan@tanpaemail.id" }).expect(200)
      ).body;
      expect(resent).toMatchObject({ state: "sent", emailTo: "keuangan@tanpaemail.id" });
    });

    it("naik ke tingkat berikut setelah umur tunggakan bertambah; faktur lunas keluar", async () => {
      const next = (await a.get("/dunning/preview?date=2026-12-01").expect(200)).body;
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ partnerId: noEmail, level: { sequence: 2 } });

      await a
        .post("/payments", {
          paymentType: "inbound",
          partnerId: noEmail,
          journalId: jr.BNK1,
          amount: 2_000_000,
          date: "2026-11-20",
          moveIds: [dueInvoice],
        })
        .expect(201);
      expect((await a.get("/dunning/preview?date=2026-12-01").expect(200)).body).toEqual([]);
    });

    it("penjadwal hanya memproses perusahaan yang mengaktifkan dunning", async () => {
      const subRevenue = (await sub.get("/accounts?limit=200").expect(200)).body.items.find(
        (r: { code: string }) => r.code === "4-1000",
      ).id;
      await invoice(sub, customer, "2026-10-01", "2026-10-15", 1_500_000, subRevenue);
      const scheduler = app.get(DunningScheduler);
      expect(await scheduler.runDue("2026-11-11", [tenantId])).toBe(0);
      await sub.put("/dunning/settings", { dunningEnabled: true, dunningMinAmount: "0" }).expect(200);
      expect(await scheduler.runDue("2026-11-11", [tenantId])).toBe(1);
      expect(await scheduler.runDue("2026-11-11", [tenantId])).toBe(0);
      const letters = (await sub.get("/dunning-letters").expect(200)).body;
      expect(letters[0]).toMatchObject({ automatic: true, levelSequence: 1, state: "sent" });
    });

    it("pengaturan bawaan perusahaan: dunning otomatis nonaktif", async () => {
      expect((await a.get("/dunning/settings").expect(200)).body).toMatchObject({ dunningEnabled: false });
    });
  });
});
