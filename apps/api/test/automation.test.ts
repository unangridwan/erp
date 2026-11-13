import type { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AutomationEngine } from "../src/automation/automation.engine.js";
import { Mailer } from "../src/common/mailer.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

// Tanggal lokal zona perusahaan (bawaan Asia/Jakarta) agar pemicu tanggal tidak bergeser.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

describe.skipIf(!hasDb)("Aturan otomatis", () => {
  let app: INestApplication;
  let engine: AutomationEngine;
  let a: Awaited<ReturnType<typeof signup>>;
  let tenantId = "";
  let me: { id: string; activeCompanyId: string };
  let sinta: ReturnType<typeof client>;
  let sintaId = "";
  let customer = "";
  let product = "";
  const hooks: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  let hookServer: Server;
  let hookUrl = "";

  const process = () => engine.processPending([tenantId]);
  const newOrder = async (price: string) =>
    (
      await a
        .post("/sale-orders", {
          partnerId: customer,
          dateOrder: today,
          lines: [{ productId: product, quantity: "1", priceUnit: price }],
        })
        .expect(201)
    ).body as { id: string; name: string };

  beforeAll(async () => {
    hookServer = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        hooks.push({ headers: req.headers, body });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", r));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;

    app = await createApp();
    engine = app.get(AutomationEngine);
    a = await signup(app, "auto");
    const meBody = (await a.get("/auth/me").expect(200)).body;
    tenantId = meBody.tenantId;
    me = { id: meBody.userId, activeCompanyId: meBody.activeCompanyId };
    const role = (
      await a
        .post("/roles", { code: "sales_auto", name: "Sales", permissions: ["sales.read", "sales.write"] })
        .expect(201)
    ).body.id;
    sintaId = (
      await a
        .post("/users", {
          name: "Sinta Sales",
          email: "sinta@example.com",
          password: "rahasia123",
          roleIds: [role],
          companyIds: [me.activeCompanyId],
        })
        .expect(201)
    ).body.id;
    sinta = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sinta@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    product = (await a.post("/products", { sku: "TRK", name: "Traktor", uomId: pcs, cost: "1" }).expect(201))
      .body.id;
    customer = (
      await a
        .post("/partners", { name: "Koperasi Maju", email: "koperasi@example.com", isCustomer: true })
        .expect(201)
    ).body.id;
    await a
      .post("/custom-fields", {
        model: "sale_order",
        key: "prioritas",
        label: "Prioritas",
        fieldType: "select",
        options: [
          { value: "normal", label: "Normal" },
          { value: "tinggi", label: "Tinggi" },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    hookServer?.close();
  });

  it("validasi aturan & hak akses", async () => {
    const fields = (await a.get("/automation-rules/fields?model=sale_order").expect(200)).body;
    expect(fields.fields.map((f: { key: string }) => f.key)).toEqual(
      expect.arrayContaining(["state", "amount_total", "custom.prioritas"]),
    );
    expect(fields.responsible).toBe("user_id");
    const base = {
      name: "x",
      model: "sale_order",
      trigger: "updated",
      actions: [{ type: "notify", users: [me.id], title: "Hai" }],
    };
    await a
      .post("/automation-rules", { ...base, conditions: [{ field: "tidak_ada", op: "eq", value: "1" }] })
      .expect(400);
    await a
      .post("/automation-rules", {
        ...base,
        actions: [{ type: "set_field", field: "state", value: "cancel" }],
      })
      .expect(400);
    await a.post("/automation-rules", { ...base, trigger: "date" }).expect(400);
    await a.post("/automation-rules", { ...base, actions: [] }).expect(400);
    await sinta.get("/automation-rules").expect(403);
  });

  it("SO dikonfirmasi > 50 jt → notifikasi, aktivitas, field kustom, email; hanya saat berubah", async () => {
    const rule = (
      await a
        .post("/automation-rules", {
          name: "SO besar",
          model: "sale_order",
          trigger: "updated",
          onlyWhenChanges: true,
          conditions: [
            { field: "state", op: "eq", value: "sale" },
            { field: "amount_untaxed", op: "gt", value: "50000000" },
          ],
          actions: [
            {
              type: "notify",
              users: [sintaId],
              creator: true,
              title: "SO {{name}} dikonfirmasi",
              body: "Total {{amount_total}}",
            },
            {
              type: "activity",
              summary: "Telepon pelanggan {{name}}",
              dueInDays: 2,
              assignTo: "user",
              userId: sintaId,
            },
            { type: "set_field", field: "custom.prioritas", value: "tinggi" },
            { type: "email", to: "partner", subject: "Pesanan {{name}}", body: "Terima kasih, {{rule}}" },
          ],
        })
        .expect(201)
    ).body;
    expect(rule.webhookSecret).toBeNull();

    const small = await newOrder("1000000");
    await a.post(`/sale-orders/${small.id}/confirm`).expect(200);
    const big = await newOrder("60000000");
    await a.post(`/sale-orders/${big.id}/confirm`).expect(200);
    const outboxBefore = app.get(Mailer).outbox.length;
    expect(await process()).toBe(1);

    const notes = (await sinta.get("/me/notifications").expect(200)).body as {
      title: string;
      link: string;
    }[];
    const note = notes.find((n) => n.title.includes(big.name));
    expect(note).toMatchObject({ link: `/sales/orders/${big.id}` });
    const acts = (await a.get(`/activities?resModel=sale_order&resId=${big.id}`).expect(200)).body;
    expect(JSON.stringify(acts)).toContain(`Telepon pelanggan ${big.name}`);
    expect((await a.get(`/sale-orders/${big.id}`).expect(200)).body.custom).toMatchObject({
      prioritas: "tinggi",
    });
    const mails = app.get(Mailer).outbox.slice(outboxBefore);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "koperasi@example.com", subject: `Pesanan ${big.name}` });

    // Ubah field kustom oleh aturan tidak memicu ulang; ubah lain pada SO yang sudah memenuhi juga tidak.
    await a.patch(`/custom-values/sale_order/${big.id}`, { custom: { prioritas: "normal" } }).expect(200);
    expect(await process()).toBe(0);
    const runs = (await a.get(`/automation-rules/${rule.id}/runs`).expect(200)).body;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "success", resId: big.id });

    const list = (await a.get("/automation-rules").expect(200)).body;
    expect(list.find((r: { id: string }) => r.id === rule.id).lastRun.status).toBe("success");
    await a
      .put(`/automation-rules/${rule.id}`, {
        ...rule,
        active: false,
        conditions: rule.conditions,
        actions: rule.actions,
      })
      .expect(200);
  });

  it("aturan data dibuat + persetujuan + webhook bertanda tangan", async () => {
    const cat = (
      await a
        .post("/approval-categories", { code: "VERKON", name: "Verifikasi kontak", prefix: "VK" })
        .expect(201)
    ).body;
    const rule = (
      await a
        .post("/automation-rules", {
          name: "Kontak baru",
          model: "partner",
          trigger: "created",
          conditions: [{ field: "name", op: "contains", value: "PT" }],
          actions: [
            { type: "approval", categoryId: cat.id, description: "Verifikasi kontak {{name}}" },
            { type: "webhook", url: hookUrl },
          ],
        })
        .expect(201)
    ).body;
    expect(rule.webhookSecret).toEqual(expect.any(String));
    await a.post("/partners", { name: "Toko Kecil" }).expect(201);
    const p = (await a.post("/partners", { name: "PT Sentosa", isCustomer: true }).expect(201)).body;
    expect(await process()).toBe(1);

    const reqs = (await a.get("/approval-requests").expect(200)).body;
    const items = (Array.isArray(reqs) ? reqs : reqs.items) as { subject: string; state: string }[];
    expect(items.find((r) => r.subject.includes("PT Sentosa"))).toMatchObject({ state: "submitted" });

    expect(hooks).toHaveLength(1);
    const hook = hooks[0]!;
    const sig = String(hook.headers["x-erp-signature"]);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sig)!;
    expect(createHmac("sha256", rule.webhookSecret).update(`${t}.${hook.body}`).digest("hex")).toBe(v1);
    const payload = JSON.parse(hook.body);
    expect(payload).toMatchObject({
      model: "partner",
      rule: { id: rule.id },
      record: { id: p.id, name: "PT Sentosa" },
    });
    expect(Object.keys(payload.record).some((k) => k.endsWith("_enc"))).toBe(false);
  });

  it("pemicu tanggal: H-3 jatuh tempo, sekali per data per tanggal; uji coba manual", async () => {
    const due = addDays(today, 3);
    const inv = (
      await a
        .post("/moves", {
          moveType: "out_invoice",
          partnerId: customer,
          date: today,
          dueDate: due,
          lines: [{ name: "Traktor", productId: product, quantity: 1, priceUnit: 100000 }],
        })
        .expect(201)
    ).body;
    await a.post(`/moves/${inv.id}/post`).expect(200);
    const rule = (
      await a
        .post("/automation-rules", {
          name: "Pengingat jatuh tempo",
          model: "account_move",
          trigger: "date",
          dateField: "due_date",
          offsetDays: -3,
          conditions: [{ field: "state", op: "eq", value: "posted" }],
          actions: [{ type: "notify", users: [me.id], title: "{{name}} jatuh tempo {{due_date}}" }],
        })
        .expect(201)
    ).body;
    const now = new Date();
    expect(await engine.runDue(now, [tenantId])).toBe(1);
    expect(await engine.runDue(now, [tenantId])).toBe(0);
    expect(await engine.runDue(new Date(now.getTime() + 864e5), [tenantId])).toBe(0);

    // Uji coba manual untuk satu data menjalankan aksi walau bukan tanggalnya.
    const run = (await a.post(`/automation-rules/${rule.id}/run`, { resId: inv.id }).expect(200)).body;
    expect(run.status).toBe("success");
    const recs = (await a.get(`/automation-rules/${rule.id}/records?q=`).expect(200)).body;
    expect(recs.map((r: { id: string }) => r.id)).toContain(inv.id);
  });

  it("pemicu terjadwal berjalan sekali per jadwal", async () => {
    const rule = (
      await a
        .post("/automation-rules", {
          name: "Rekap harian kontak",
          model: "partner",
          trigger: "scheduled",
          frequency: "daily",
          hour: 0,
          conditions: [{ field: "name", op: "eq", value: "Koperasi Maju" }],
          actions: [{ type: "notify", users: [me.id], title: "Cek {{name}}" }],
        })
        .expect(201)
    ).body;
    await a.post(`/automation-rules/${rule.id}/run`, {}).expect(200);
    const later = new Date(Date.now() + 2 * 864e5);
    expect(await engine.runDue(later, [tenantId])).toBe(1);
    expect(await engine.runDue(later, [tenantId])).toBe(0);
    const runs = (await a.get(`/automation-rules/${rule.id}/runs`).expect(200)).body;
    expect(runs).toHaveLength(2);
  });

  it("pengaman perulangan: aturan yang memicu dirinya berhenti", async () => {
    await a
      .post("/custom-fields", { model: "sale_order", key: "jejak", label: "Jejak", fieldType: "text" })
      .expect(201);
    await a
      .post("/automation-rules", {
        name: "Loop",
        model: "sale_order",
        trigger: "updated",
        actions: [{ type: "set_field", field: "custom.jejak", value: "{{custom.jejak}}x" }],
      })
      .expect(201);
    const so = await newOrder("1000");
    await a.patch(`/custom-values/sale_order/${so.id}`, { custom: { jejak: "a" } }).expect(200);
    let total = 0;
    for (let i = 0; i < 6; i++) total += await process();
    // Depth 0 → 1 → 2 → 3 (event depth 3 tidak dicatat): tiga eksekusi, lalu berhenti.
    expect(total).toBe(3);
    expect(await process()).toBe(0);
    expect((await a.get(`/sale-orders/${so.id}`).expect(200)).body.custom.jejak).toBe("axxx");
  });

  it("isolasi tenant", async () => {
    const b = await signup(app, "auto2");
    expect((await b.get("/automation-rules").expect(200)).body).toEqual([]);
    const rules = (await a.get("/automation-rules").expect(200)).body as { id: string }[];
    await b.get(`/automation-rules/${rules[0]!.id}`).expect(404);
  });
});
