import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { Mailer } from "../src/common/mailer.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

describe.skipIf(!hasDb)("CRM marketing: kampanye, skor, penugasan, formulir web", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let other: Awaited<ReturnType<typeof signup>>;
  let viewer: ReturnType<typeof client>;
  let mailer: Mailer;
  let budiId = "";
  let sitiId = "";
  let campaignId = "";
  let formKey = "";
  let formId = "";
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    mailer = app.get(Mailer);
    a = await signup(app, "crmmk");
    other = await signup(app, "crmmk2");
    const me = (await a.get("/auth/me")).body;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "viewer", name: "Pembaca" }).returning({ id: schema.roles.id }),
    );
    await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.rolePermissions).values([{ roleId: role!.id, permission: "crm.read" }]),
    );
    const user = async (name: string, email: string) =>
      (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [role!.id],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
    budiId = await user("Budi", "budi@example.com");
    sitiId = await user("Siti", "siti@example.com");
    const login = await http()
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "budi@example.com", password: "rahasia123" })
      .expect(200);
    viewer = client(app, login.body.token);
  });

  afterAll(() => app?.close());

  it("aturan skor menghitung skor saat lead dibuat & diubah; hitung ulang massal", async () => {
    const plain = (
      await a.post("/leads", { leadType: "lead", name: "Tanpa aturan", source: "referral" }).expect(201)
    ).body;
    expect(plain.score).toBe(0);
    await viewer.post("/crm/scoring-rules", { name: "x", conditions: [], points: 1 }).expect(403);
    await a.post("/crm/scoring-rules", { name: "Kosong", conditions: [], points: 5 }).expect(400);
    await a
      .post("/crm/scoring-rules", {
        name: "Field asing",
        conditions: [{ field: "password", op: "notEmpty" }],
        points: 5,
      })
      .expect(400);
    await a
      .post("/crm/scoring-rules", {
        name: "Dari referensi",
        conditions: [{ field: "source", op: "eq", value: "referral" }],
        points: 30,
      })
      .expect(201);
    await a
      .post("/crm/scoring-rules", {
        name: "Perusahaan besar",
        conditions: [{ field: "employeeCount", op: "gte", value: "100" }],
        points: 45,
      })
      .expect(201);
    const lead = (
      await a.post("/leads", { leadType: "lead", name: "Lead referensi", source: "referral" }).expect(201)
    ).body;
    expect(lead.score).toBe(30);
    const bigger = (await a.patch(`/leads/${lead.id}`, { employeeCount: 250 }).expect(200)).body;
    expect(bigger.score).toBe(75);
    expect((await a.post("/crm/scoring-recompute").expect(200)).body).toEqual({ leads: 2, changed: 1 });
    expect((await a.get(`/leads/${plain.id}`).expect(200)).body.score).toBe(30);
    await viewer.post("/crm/scoring-recompute").expect(403);
  });

  it("kampanye: anggota dari lead, kontak, dan segmen; lead berkampanye otomatis jadi anggota", async () => {
    await a
      .post("/crm/campaigns", { name: "Salah tanggal", dateStart: "2026-11-10", dateEnd: "2026-11-01" })
      .expect(400);
    const campaign = (
      await a
        .post("/crm/campaigns", {
          name: "Pameran Agro 2026",
          campaignType: "event",
          status: "active",
          budget: "20000000",
          actualCost: "10000000",
        })
        .expect(201)
    ).body;
    campaignId = campaign.id;
    await viewer.post("/crm/campaigns", { name: "x" }).expect(403);

    const l1 = (
      await a
        .post("/leads", {
          leadType: "lead",
          name: "Lead email",
          contactName: "Pak Hadi",
          email: "hadi@tani.id",
          source: "event",
        })
        .expect(201)
    ).body;
    const l2 = (
      await a
        .post("/leads", {
          leadType: "lead",
          name: "Lead diblokir",
          email: "blok@tani.id",
          source: "event",
          doNotContact: true,
        })
        .expect(201)
    ).body;
    await a.post("/leads", { leadType: "lead", name: "Lead tanpa email", source: "event" }).expect(201);
    const partner = (await a.post("/partners", { name: "PT Sawit Jaya", email: "info@sawit.id" }).expect(201))
      .body;

    expect(
      (
        await a
          .post(`/crm/campaigns/${campaignId}/members`, { leadIds: [l1.id, l2.id], partnerIds: [partner.id] })
          .expect(200)
      ).body,
    ).toEqual({ added: 3, skipped: 0 });
    // Segmen: semua lead terbuka bersumber acara (dua sudah anggota).
    expect(
      (await a.post(`/crm/campaigns/${campaignId}/members`, { segment: { source: "event" } }).expect(200))
        .body,
    ).toEqual({ added: 1, skipped: 2 });
    await viewer.post(`/crm/campaigns/${campaignId}/members`, { leadIds: [l1.id] }).expect(403);

    // Lead yang dibuat dengan kampanye langsung menjadi anggota berstatus merespons.
    const direct = (
      await a
        .post("/leads", { name: "Peluang dari pameran", campaignId, expectedRevenue: "45000000" })
        .expect(201)
    ).body;
    await a.post(`/leads/${direct.id}/won`).expect(200);
    await a
      .post("/leads", { name: "Kampanye asing", campaignId: "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10" })
      .expect(400);

    const detail = (await a.get(`/crm/campaign-stats/${campaignId}`).expect(200)).body;
    expect(detail).toMatchObject({
      members: 5,
      responded: 1,
      leads: 1,
      opportunities: 1,
      won: 1,
      wonAmount: "45000000.00",
      roi: 350,
      costPerLead: "10000000.00",
    });
    expect(detail.memberList.find((m: { kind: string }) => m.kind === "partner")).toMatchObject({
      name: "PT Sawit Jaya",
      email: "info@sawit.id",
    });
    const list = (await a.get("/crm/campaign-stats").expect(200)).body.items;
    expect(list).toEqual([expect.objectContaining({ id: campaignId, members: 5, roi: 350 })]);
    await other.get(`/crm/campaign-stats/${campaignId}`).expect(404);
  });

  it("email massal: placeholder, lewati tanpa email & jangan-dihubungi; berhenti langganan publik", async () => {
    mailer.outbox.length = 0;
    await viewer.post(`/crm/campaigns/${campaignId}/emails`, { subject: "x", body: "y" }).expect(403);
    const blast = (
      await a
        .post(`/crm/campaigns/${campaignId}/emails`, {
          subject: "Undangan {{campaign}}",
          body: "Halo {{name}}, sampai jumpa di stan kami.",
          onlyStatus: "targeted",
        })
        .expect(200)
    ).body;
    expect(blast).toMatchObject({ sentCount: 2, skippedCount: 2, failedCount: 0 });
    const toHadi = mailer.outbox.find((m) => m.to === "hadi@tani.id")!;
    expect(toHadi.subject).toBe("Undangan Pameran Agro 2026");
    expect(toHadi.text).toContain("Halo Pak Hadi,");
    expect(mailer.outbox.map((m) => m.to).sort()).toEqual(["hadi@tani.id", "info@sawit.id"]);

    const url = /https?:\/\/\S+\/public\/crm\/unsubscribe\/(\S+)/.exec(toHadi.text)!;
    const res = await http().get(`/public/crm/unsubscribe/${url[1]}`).expect(200);
    expect(res.text).toContain("Berhenti langganan berhasil");
    await http().get(`/public/crm/unsubscribe/${url[1]}x`).expect(404);
    await http().get("/public/crm/unsubscribe/bukan-token").expect(404);

    const detail = (await a.get(`/crm/campaign-stats/${campaignId}`).expect(200)).body;
    const hadi = detail.memberList.find((m: { email: string }) => m.email === "hadi@tani.id");
    expect(hadi).toMatchObject({ status: "unsubscribed", doNotContact: true });
    expect(detail.emails).toEqual([expect.objectContaining({ sentCount: 2, userName: "Admin" })]);
    // Kiriman berikutnya tidak lagi sampai ke yang berhenti langganan.
    mailer.outbox.length = 0;
    await a.post(`/crm/campaigns/${campaignId}/emails`, { subject: "Lagi", body: "Halo" }).expect(200);
    expect(mailer.outbox.map((m) => m.to)).toEqual(["info@sawit.id"]);
    expect(mailer.outbox[0]!.text).toContain("/public/crm/unsubscribe/");
  });

  it("formulir web publik: lead ber-kampanye, ber-skor, ditugaskan bergiliran; anti-spam & duplikat", async () => {
    await viewer.post("/crm/web-forms", { name: "x" }).expect(403);
    await a
      .post("/crm/web-forms", { name: "Tanpa kontak", fields: ["contactName"], requiredFields: [] })
      .expect(400);
    await a
      .post("/crm/assignment-rules", {
        name: "Semua lead web",
        conditions: [{ field: "source", op: "eq", value: "website" }],
        userIds: [budiId, sitiId],
      })
      .expect(201);
    await a.post("/crm/assignment-rules", { name: "Tanpa penerima", userIds: [] }).expect(400);
    const form = (
      await a
        .post("/crm/web-forms", {
          name: "Hubungi Kami",
          campaignId,
          fields: ["contactName", "partnerName", "email", "phone", "description"],
          requiredFields: ["contactName", "email"],
          successMessage: "Terima kasih, tim kami segera menghubungi.",
        })
        .expect(201)
    ).body;
    formKey = form.key;
    formId = form.id;
    expect(formKey.split(".")).toHaveLength(2);
    const forms = (await a.get("/crm/web-forms").expect(200)).body.items;
    expect(forms[0]).toMatchObject({
      name: "Hubungi Kami",
      campaignName: "Pameran Agro 2026",
      submissionCount: 0,
    });
    expect(JSON.stringify(forms)).not.toContain("keyHash");

    // Tanpa login.
    const config = (await http().get(`/public/web-forms/${formKey}`).expect(200)).body;
    expect(config).toMatchObject({
      name: "Hubungi Kami",
      fields: ["contactName", "partnerName", "email", "phone", "description"],
      requiredFields: ["contactName", "email"],
    });
    await http().get(`/public/web-forms/${formKey}x`).expect(404);
    await http().post("/public/web-forms/bukan-kunci").send({}).expect(404);
    const invalid = await http()
      .post(`/public/web-forms/${formKey}`)
      .send({ email: "sari@contoh.id" })
      .expect(400);
    expect(invalid.body.errors).toEqual([{ path: "contactName", message: "Wajib diisi" }]);

    const ok = await http()
      .post(`/public/web-forms/${formKey}`)
      .send({
        contactName: "Ibu Sari",
        partnerName: "CV Sari Tani",
        email: "sari@contoh.id",
        city: "Diabaikan karena tidak ada di formulir",
        description: "Butuh 3 drone",
      })
      .expect(200);
    expect(ok.body).toEqual({ ok: true, message: "Terima kasih, tim kami segera menghubungi." });
    const leads = (await a.get("/leads?q=Sari").expect(200)).body.items;
    expect(leads).toHaveLength(1);
    const lead = (await a.get(`/leads/${leads[0].id}`).expect(200)).body;
    expect(lead).toMatchObject({
      leadType: "lead",
      name: "Hubungi Kami: CV Sari Tani",
      source: "website",
      campaignId,
      city: null,
      description: "Butuh 3 drone",
    });
    expect([budiId, sitiId]).toContain(lead.userId);

    // Form HTML biasa (urlencoded) → halaman terima kasih; penerima berikutnya bergiliran.
    const html = await http()
      .post(`/public/web-forms/${formKey}`)
      .type("form")
      .send({ contactName: "Pak Joko", email: "joko@contoh.id" })
      .expect(200);
    expect(html.text).toContain("Terima kasih");
    const second = (await a.get("/leads?q=Joko").expect(200)).body.items[0];
    const secondLead = (await a.get(`/leads/${second.id}`).expect(200)).body;
    expect([budiId, sitiId]).toContain(secondLead.userId);
    expect(secondLead.userId).not.toBe(lead.userId);

    // Email yang sama tidak membuat lead baru; honeypot diabaikan diam-diam.
    await http()
      .post(`/public/web-forms/${formKey}`)
      .send({ contactName: "Sari lagi", email: "SARI@contoh.id" })
      .expect(200);
    await http()
      .post(`/public/web-forms/${formKey}`)
      .send({ contactName: "Bot", email: "bot@spam.io", website_url: "http://spam.io" })
      .expect(200);
    expect((await a.get("/leads?q=contoh.id").expect(200)).body.total).toBe(2);
    expect((await a.get("/leads?q=spam.io").expect(200)).body.total).toBe(0);
    const log = (await a.get(`/activity/crm_lead/${lead.id}`).expect(200)).body;
    expect(JSON.stringify(log)).toContain("Kiriman formulir web");

    const stats = (await a.get(`/crm/campaign-stats/${campaignId}`).expect(200)).body;
    expect(stats).toMatchObject({ leads: 3, responded: 3 });
    expect((await a.get("/crm/web-forms").expect(200)).body.items[0].submissionCount).toBe(3);
  });

  it("kunci formulir bisa diganti, formulir nonaktif ditolak; redirect untuk form HTML", async () => {
    const rotated = (await a.post(`/crm/web-forms/${formId}/rotate-key`).expect(200)).body;
    await http().get(`/public/web-forms/${formKey}`).expect(404);
    formKey = rotated.key;
    await a.patch(`/crm/web-forms/${formId}`, { redirectUrl: "https://contoh.id/terima-kasih" }).expect(200);
    const res = await http()
      .post(`/public/web-forms/${formKey}`)
      .type("form")
      .send({ contactName: "Bu Rina", email: "rina@contoh.id" })
      .expect(303);
    expect(res.headers.location).toBe("https://contoh.id/terima-kasih");
    await a.patch(`/crm/web-forms/${formId}`, { requiredFields: ["title"] }).expect(400);
    await a.patch(`/crm/web-forms/${formId}`, { active: false }).expect(200);
    await http().post(`/public/web-forms/${formKey}`).send({ contactName: "x", email: "x@y.id" }).expect(404);
    await other.patch(`/crm/web-forms/${formId}`, { active: true }).expect(404);
  });

  it("aturan penugasan diterapkan ke lead lama tanpa penanggung jawab", async () => {
    const ids: string[] = [];
    for (const name of ["Web lama 1", "Web lama 2"])
      ids.push(
        (await a.post("/leads", { leadType: "lead", name, source: "website", userId: null }).expect(201)).body
          .id,
      );
    const none = (
      await a.post("/leads", { leadType: "lead", name: "Bukan web", source: "ads", userId: null }).expect(201)
    ).body;
    await viewer.post("/crm/assignment-apply").expect(403);
    expect((await a.post("/crm/assignment-apply").expect(200)).body).toMatchObject({ assigned: 2 });
    for (const id of ids)
      expect([budiId, sitiId]).toContain((await a.get(`/leads/${id}`).expect(200)).body.userId);
    expect((await a.get(`/leads/${none.id}`).expect(200)).body.userId).toBeNull();
  });
});
