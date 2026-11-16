import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { Mailer } from "../src/common/mailer.js";
import { SupportScheduler } from "../src/support/support.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const HOUR = 3_600_000;

describe.skipIf(!hasDb)("Layanan pelanggan: tiket, SLA, portal, email masuk", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let other: Awaited<ReturnType<typeof signup>>;
  let agent: ReturnType<typeof client>;
  let mailer: Mailer;
  let tenantId = "";
  let agentId = "";
  let siti = "";
  let teamId = "";
  let customer = "";
  let ticketId = "";
  let portalToken = "";
  const http = () => request(app.getHttpServer());
  const portal = (method: "get" | "post", url: string) =>
    http()[method](url).set("Authorization", `Bearer ${portalToken}`);

  beforeAll(async () => {
    app = await createApp();
    mailer = app.get(Mailer);
    a = await signup(app, "supp");
    other = await signup(app, "supp2");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "agent", name: "Agen" }).returning({ id: schema.roles.id }),
    );
    await db.runAs(tenantId, (tx) =>
      tx
        .insert(schema.rolePermissions)
        .values(["support.write", "partner.read"].map((permission) => ({ roleId: role!.id, permission }))),
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
    agentId = await user("Budi Agen", "budi@example.com");
    siti = await user("Siti Agen", "siti@example.com");
    const login = await http()
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "budi@example.com", password: "rahasia123" })
      .expect(200);
    agent = client(app, login.body.token);
    customer = (
      await a
        .post("/partners", { name: "PT Tani Makmur", isCustomer: true, email: "cs@tanimakmur.id" })
        .expect(201)
    ).body.id;
  });

  afterAll(() => app?.close());

  it("antrean & kebijakan SLA; hanya pengelola yang boleh mengatur", async () => {
    await agent.post("/support/teams", { name: "x" }).expect(403);
    teamId = (
      await a
        .post("/support/teams", { name: "Helpdesk", leaderId: agentId, memberIds: [agentId, siti] })
        .expect(201)
    ).body.id;
    await a
      .post("/support/sla-policies", {
        name: "Salah",
        priority: "high",
        firstResponseHours: 8,
        resolutionHours: 4,
      })
      .expect(400);
    await a
      .post("/support/sla-policies", {
        name: "Tinggi",
        priority: "high",
        firstResponseHours: 2,
        resolutionHours: 8,
      })
      .expect(201);
    await a
      .post("/support/sla-policies", {
        name: "Tinggi lagi",
        priority: "high",
        firstResponseHours: 1,
        resolutionHours: 2,
      })
      .expect(409);
    await a.put("/support/settings", { defaultTeamId: teamId, autoCloseDays: 3 }).expect(200);
    expect((await a.get("/support/settings").expect(200)).body).toEqual({
      defaultTeamId: teamId,
      autoCloseDays: 3,
      inboundConfigured: false,
    });
  });

  it("tiket internal: nomor urut, antrean bawaan, agen bergiliran, tenggat SLA", async () => {
    const before = Date.now();
    const t1 = (
      await agent
        .post("/support/tickets", {
          subject: "Pompa irigasi mati",
          partnerId: customer,
          priority: "high",
          channel: "phone",
        })
        .expect(201)
    ).body;
    ticketId = t1.id;
    expect(t1).toMatchObject({
      number: `TKT/${new Date().getFullYear()}/0001`,
      teamId,
      status: "open",
      email: "cs@tanimakmur.id",
      firstResponseState: "on_track",
    });
    expect([agentId, siti]).toContain(t1.userId);
    const due = new Date(t1.firstResponseDue).getTime() - before;
    expect(due).toBeGreaterThan(2 * HOUR - 60_000);
    expect(due).toBeLessThan(2 * HOUR + 60_000);
    // Tanpa kebijakan untuk prioritas normal → target bawaan 8 jam.
    const t2 = (await agent.post("/support/tickets", { subject: "Tanya garansi" }).expect(201)).body;
    expect(t2.userId).not.toBe(t1.userId);
    expect(new Date(t2.resolveDue).getTime() - new Date(t2.createdAt).getTime()).toBe(72 * HOUR);
    await agent
      .post("/support/tickets", { subject: "x", teamId: "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10" })
      .expect(400);

    // Prioritas naik → tenggat dihitung ulang dari waktu dibuat.
    const urgent = (await agent.patch(`/support/tickets/${t2.id}`, { priority: "urgent" }).expect(200)).body;
    expect(new Date(urgent.firstResponseDue).getTime() - new Date(urgent.createdAt).getTime()).toBe(1 * HOUR);
    const list = (await agent.get("/support/tickets?status=open").expect(200)).body;
    expect(list.total).toBe(2);
    await other.get(`/support/tickets/${ticketId}`).expect(404);
  });

  it("balasan publik dikirim email & mencatat respons pertama; catatan internal tidak", async () => {
    mailer.outbox.length = 0;
    const noted = (
      await agent
        .post(`/support/tickets/${ticketId}/messages`, { kind: "internal", body: "Cek suku cadang" })
        .expect(200)
    ).body;
    expect(noted.firstRespondedAt).toBeNull();
    expect(mailer.outbox).toHaveLength(0);
    const replied = (
      await agent
        .post(`/support/tickets/${ticketId}/messages`, {
          kind: "public",
          body: "Teknisi kami datang besok pagi.",
        })
        .expect(200)
    ).body;
    expect(replied).toMatchObject({ emailed: true, status: "pending", firstResponseState: "met" });
    expect(replied.messages.map((m: { kind: string }) => m.kind)).toEqual(["internal", "public"]);
    expect(mailer.outbox[0]).toMatchObject({ to: "cs@tanimakmur.id" });
    expect(mailer.outbox[0]!.subject).toMatch(/^\[TKT\/\d{4}\/0001\] Pompa irigasi mati$/);
  });

  it("email masuk: balasan dengan nomor tiket membuka kembali tiket; email baru membuat tiket", async () => {
    await agent.post("/support/settings/inbound-key").expect(403);
    const { key } = (await a.post("/support/settings/inbound-key").expect(200)).body;
    const number = (await a.get(`/support/tickets/${ticketId}`).expect(200)).body.number;
    await http()
      .post("/public/support/inbound/bukan-kunci")
      .send({ from: "x@y.id", subject: "a" })
      .expect(400);
    const reply = (
      await http()
        .post(`/public/support/inbound/${key}`)
        .send({
          from: "CS Tani <cs@tanimakmur.id>",
          subject: `Re: [${number}] Pompa irigasi mati`,
          text: "Baik, kami tunggu.",
        })
        .expect(200)
    ).body;
    expect(reply).toEqual({ ticketId, number, created: false });
    const reopened = (await a.get(`/support/tickets/${ticketId}`).expect(200)).body;
    expect(reopened.status).toBe("open");
    expect(reopened.messages.at(-1)).toMatchObject({
      kind: "customer",
      body: "Baik, kami tunggu.",
      authorName: "CS Tani",
    });

    // Pengirim lain dengan nomor tiket yang sama tidak bisa menyusup → tiket baru.
    const fresh = (
      await http()
        .post(`/public/support/inbound/${key}`)
        .send({ from: "orang@lain.id", subject: `Re: [${number}] Pompa`, text: "Halo" })
        .expect(200)
    ).body;
    expect(fresh.created).toBe(true);
    const newTicket = (await a.get(`/support/tickets/${fresh.ticketId}`).expect(200)).body;
    expect(newTicket).toMatchObject({
      channel: "email",
      subject: "[" + number + "] Pompa",
      email: "orang@lain.id",
      partnerId: null,
    });
    // Email dari akun yang dikenal ditautkan ke akunnya.
    const known = (
      await http()
        .post(`/public/support/inbound/${key}`)
        .send({ from: "cs@tanimakmur.id", subject: "Faktur ganda", text: "?" })
        .expect(200)
    ).body;
    expect((await a.get(`/support/tickets/${known.ticketId}`).expect(200)).body.partnerId).toBe(customer);
  });

  it("portal pelanggan: buat tiket, lihat tanpa catatan internal, balas, nilai setelah selesai", async () => {
    const invite = (await a.post(`/partners/${customer}/portal-invite`, {}).expect(200)).body;
    const token = decodeURIComponent(invite.inviteUrl.split("#token=")[1]);
    portalToken = (
      await http().post("/portal/auth/accept").send({ token, password: "rahasia123" }).expect(200)
    ).body.token;

    const mine = (await portal("get", "/portal/tickets").expect(200)).body;
    expect(mine.map((t: { id: string }) => t.id)).toContain(ticketId);
    const detail = (await portal("get", `/portal/tickets/${ticketId}`).expect(200)).body;
    expect(detail.messages.map((m: { kind: string }) => m.kind)).toEqual(["public", "customer"]);
    expect(JSON.stringify(detail)).not.toContain("Cek suku cadang");

    const created = (
      await portal("post", "/portal/tickets")
        .send({ subject: "Sensor tanah tidak terbaca", description: "Sejak kemarin sore", priority: "high" })
        .expect(201)
    ).body;
    expect(created).toMatchObject({ status: "open", priority: "high" });
    const internal = (await a.get(`/support/tickets/${created.id}`).expect(200)).body;
    expect(internal).toMatchObject({ channel: "portal", partnerId: customer, teamId });

    await portal("post", `/portal/tickets/${created.id}/rating`).send({ satisfaction: 5 }).expect(400);
    await a.patch(`/support/tickets/${created.id}`, { status: "resolved" }).expect(200);
    const rated = (
      await portal("post", `/portal/tickets/${created.id}/rating`)
        .send({ satisfaction: 4, note: "Cepat" })
        .expect(200)
    ).body;
    expect(rated).toMatchObject({ satisfaction: 4, satisfactionNote: "Cepat" });
    // Balasan pelanggan pada tiket selesai membukanya kembali.
    const reopened = (
      await portal("post", `/portal/tickets/${created.id}/messages`).send({ body: "Muncul lagi" }).expect(200)
    ).body;
    expect(reopened.status).toBe("open");
    await portal("get", "/support/tickets").expect(401);
    await http().get("/portal/tickets").set("Authorization", `Bearer ${a.token}`).expect(401);
  });

  it("basis pengetahuan: hanya artikel terbit yang tampil di portal", async () => {
    await agent.post("/support/articles", { title: "x", body: "y" }).expect(403);
    const pub = (
      await a
        .post("/support/articles", {
          title: "Reset sensor tanah",
          category: "Sensor",
          body: "Tekan tombol reset 5 detik.",
          published: true,
        })
        .expect(201)
    ).body;
    expect(pub.publishedAt).toBeTruthy();
    await a.post("/support/articles", { title: "Draf internal", body: "Belum siap" }).expect(201);
    const articles = (await portal("get", "/portal/articles").expect(200)).body;
    expect(articles.map((x: { title: string }) => x.title)).toEqual(["Reset sensor tanah"]);
    expect((await portal("get", "/portal/articles?q=pompa").expect(200)).body).toEqual([]);
    await portal("post", `/portal/articles/${pub.id}/view`).expect(204);
    expect((await a.get(`/support/articles/${pub.id}`).expect(200)).body.views).toBe(1);
  });

  it("job SLA: tandai pelanggaran & eskalasi sekali; tutup otomatis tiket selesai", async () => {
    const scheduler = app.get(SupportScheduler);
    const later = new Date(Date.now() + 100 * HOUR);
    const r1 = await scheduler.runDue(later, [tenantId]);
    expect(r1.escalated).toBeGreaterThanOrEqual(3);
    const t = (await a.get(`/support/tickets/${ticketId}`).expect(200)).body;
    expect(t).toMatchObject({ firstResponseBreached: false, resolutionBreached: true });
    expect(t.escalatedAt).toBeTruthy();
    const notes = (await agent.get("/me/notifications").expect(200)).body;
    expect(JSON.stringify(notes)).toContain("SLA terlewati");
    expect((await scheduler.runDue(later, [tenantId])).escalated).toBe(0);

    const resolved = (await agent.post("/support/tickets", { subject: "Selesai cepat" }).expect(201)).body;
    await agent.patch(`/support/tickets/${resolved.id}`, { status: "resolved" }).expect(200);
    await scheduler.runDue(new Date(Date.now() + 2 * 86_400_000), [tenantId]);
    expect((await a.get(`/support/tickets/${resolved.id}`).expect(200)).body.status).toBe("resolved");
    await scheduler.runDue(new Date(Date.now() + 4 * 86_400_000), [tenantId]);
    expect((await a.get(`/support/tickets/${resolved.id}`).expect(200)).body.status).toBe("closed");
  });

  it("laporan layanan & tiket di Akun 360°", async () => {
    const report = (await a.get("/support/reports").expect(200)).body;
    expect(report.summary).toMatchObject({
      total: 6,
      avgSatisfaction: 4,
      rated: 1,
      firstResponseCompliance: 100,
    });
    expect(report.byChannel).toMatchObject({ phone: 3, email: 2, portal: 1 });
    expect(report.byTeam[0]).toMatchObject({ label: "Helpdesk", total: 6 });
    expect(report.byAgent.map((r: { label: string }) => r.label).sort()).toEqual(["Budi Agen", "Siti Agen"]);
    await agent.get("/support/reports").expect(200);
    await a.get("/support/reports?from=kemarin").expect(400);

    const view = (await a.get(`/crm/accounts/${customer}`).expect(200)).body;
    expect(view.support).toMatchObject({ total: 3, avgSatisfaction: 4 });
    expect(view.support.tickets).toHaveLength(3);
  });
});
