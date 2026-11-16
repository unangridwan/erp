import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!hasDb)("CRM Sales Cloud inti", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sales: ReturnType<typeof client>;
  let salesUserId = "";
  const stage: Record<string, { id: string }> = {};
  let laptop = "";
  let mouse = "";
  let leadId = "";
  let accountId = "";
  let contactId = "";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "crmsc");
    const me = (await a.get("/auth/me")).body;
    for (const s of (await a.get("/crm-stages").expect(200)).body.items) stage[s.name] = s;
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = async (sku: string, name: string, salePrice: string) =>
      (await a.post("/products", { sku, name, productType: "service", uomId: uom, salePrice }).expect(201))
        .body.id as string;
    laptop = await product("LPT-01", "Laptop 14", "12000000");
    mouse = await product("MS-01", "Mouse", "250000");

    // Penjual tanpa `crm.all` dan tanpa hak akuntansi.
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "sales", name: "Penjual" }).returning({ id: schema.roles.id }),
    );
    await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.rolePermissions)
        .values(
          ["crm.read", "crm.write", "sales.read", "sales.write", "partner.read", "product.read"].map(
            (permission) => ({ roleId: role!.id, permission }),
          ),
        ),
    );
    salesUserId = (
      await a
        .post("/users", {
          name: "Budi Penjual",
          email: "budi@example.com",
          password: "rahasia123",
          roleIds: [role!.id],
          companyIds: [me.activeCompanyId],
        })
        .expect(201)
    ).body.id;
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "budi@example.com", password: "rahasia123" })
      .expect(200);
    sales = client(app, login.body.token);
  });

  afterAll(() => app?.close());

  it("lead menyimpan status & profil; peluang baru langsung terkualifikasi", async () => {
    const lead = (
      await a
        .post("/leads", {
          leadType: "lead",
          name: "Pengadaan laptop kantor",
          partnerName: "PT Maju Jaya",
          contactName: "Ibu Sari",
          title: "Manajer TI",
          email: "sari@majujaya.id",
          phone: "0812-3456-789",
          industry: "Distribusi",
          city: "Bandung",
          employeeCount: 120,
          annualRevenue: "25000000000",
          source: "website",
        })
        .expect(201)
    ).body;
    leadId = lead.id;
    expect(lead).toMatchObject({
      leadStatus: "new",
      title: "Manajer TI",
      employeeCount: 120,
      city: "Bandung",
    });
    const patched = (await a.patch(`/leads/${leadId}`, { leadStatus: "contacted" }).expect(200)).body;
    expect(patched.leadStatus).toBe("contacted");
    await a.patch(`/leads/${leadId}`, { leadStatus: "hangat" }).expect(400);

    const opp = (await a.post("/leads", { name: "Peluang langsung" }).expect(201)).body;
    expect(opp).toMatchObject({ leadType: "opportunity", leadStatus: "qualified" });
    const detail = (await a.get(`/leads/${opp.id}`).expect(200)).body;
    expect(detail.stageHistory).toHaveLength(1);
    expect(detail.stageHistory[0]).toMatchObject({ toStageName: "Baru", state: "open" });
    await a.delete(`/leads/${opp.id}`).expect(204);
  });

  it("deteksi duplikat lead & partner berdasarkan email, telepon, dan nama perusahaan", async () => {
    const twin = (
      await a
        .post("/leads", {
          leadType: "lead",
          name: "Laptop Maju Jaya (pameran)",
          partnerName: "Maju Jaya, PT",
          email: "SARI@majujaya.id",
          description: "Bertemu di pameran",
          userId: null,
        })
        .expect(201)
    ).body;
    const other = (
      await a.post("/leads", { leadType: "lead", name: "Lead lain", email: "lain@contoh.id" }).expect(201)
    ).body;
    const partner = (
      await a.post("/partners", { name: "Toko Sari", kind: "person", phone: "+62 812 3456 789" }).expect(201)
    ).body;
    const dup = (await a.get(`/leads/${leadId}/duplicates`).expect(200)).body;
    expect(dup.leads.map((l: { id: string }) => l.id)).toEqual([twin.id]);
    expect(dup.leads[0]).toMatchObject({ reasons: ["email", "name"], accessible: true });
    expect(dup.partners).toEqual([expect.objectContaining({ id: partner.id, reasons: ["phone"] })]);
    expect((await a.get(`/leads/${other.id}/duplicates`).expect(200)).body).toEqual({
      leads: [],
      partners: [],
    });

    // Gabung: field kosong terisi, catatan disatukan, sumber dihapus.
    await a.post(`/leads/${leadId}/merge`, { sourceIds: [leadId] }).expect(400);
    const merged = (await a.post(`/leads/${leadId}/merge`, { sourceIds: [twin.id] }).expect(200)).body;
    expect(merged).toMatchObject({ partnerName: "PT Maju Jaya", description: "Bertemu di pameran" });
    await a.get(`/leads/${twin.id}`).expect(404);
    const log = (await a.get(`/activity/crm_lead/${leadId}`).expect(200)).body;
    expect(JSON.stringify(log)).toContain("Digabung dengan lead");
    await a.delete(`/leads/${other.id}`).expect(204);
    await a.delete(`/partners/${partner.id}`).expect(204);
  });

  it("konversi lead → akun + kontak + peluang dengan kontak utama", async () => {
    await a.put(`/leads/${leadId}/products`, { lines: [{ productId: laptop }] }).expect(400);
    const converted = (
      await a.post(`/leads/${leadId}/convert`, { opportunityName: "Laptop kantor Maju Jaya" }).expect(200)
    ).body;
    expect(converted).toMatchObject({
      leadType: "opportunity",
      leadStatus: "qualified",
      name: "Laptop kantor Maju Jaya",
      stageId: stage.Baru!.id,
    });
    expect(converted.convertedAt).toBeTruthy();
    accountId = converted.partnerId;
    contactId = converted.contactId;
    const account = (await a.get(`/partners/${accountId}`).expect(200)).body;
    expect(account).toMatchObject({
      name: "PT Maju Jaya",
      kind: "company",
      isCustomer: true,
      industry: "Distribusi",
      city: "Bandung",
      employeeCount: 120,
    });
    const contact = (await a.get(`/partners/${contactId}`).expect(200)).body;
    expect(contact).toMatchObject({
      name: "Ibu Sari",
      kind: "person",
      parentId: accountId,
      jobTitle: "Manajer TI",
      email: "sari@majujaya.id",
    });
    const detail = (await a.get(`/leads/${leadId}`).expect(200)).body;
    expect(detail.contactRoles).toEqual([
      expect.objectContaining({ partnerId: contactId, isPrimary: true, name: "Ibu Sari" }),
    ]);
    expect(detail).toMatchObject({ partnerDisplay: "PT Maju Jaya", contactDisplay: "Ibu Sari" });
    await a.post(`/leads/${leadId}/convert`, {}).expect(400);
  });

  it("produk peluang menentukan nilai harapan", async () => {
    const detail = (
      await a
        .put(`/leads/${leadId}/products`, {
          lines: [
            { productId: laptop, quantity: "10", discount: "5" },
            { productId: mouse, quantity: "10", priceUnit: "200000" },
          ],
        })
        .expect(200)
    ).body;
    expect(detail.products).toEqual([
      expect.objectContaining({
        productName: "Laptop 14",
        priceUnit: "12000000.0000",
        subtotal: "114000000.00",
      }),
      expect.objectContaining({ productName: "Mouse", priceUnit: "200000.0000", subtotal: "2000000.00" }),
    ]);
    expect(detail.expectedRevenue).toBe("116000000.00");
    // Nilai manual diabaikan selama ada baris produk.
    const patched = (
      await a.patch(`/leads/${leadId}`, { expectedRevenue: "1", nextStep: "Demo" }).expect(200)
    ).body;
    expect(patched).toMatchObject({ expectedRevenue: "116000000.00", nextStep: "Demo" });
    await a
      .put(`/leads/${leadId}/products`, { lines: [{ productId: "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10" }] })
      .expect(400);
  });

  it("peran kontak: satu kontak utama, kontak utama ikut ke peluang", async () => {
    const cfo = (
      await a
        .post("/partners", { name: "Pak Anton", kind: "person", parentId: accountId, jobTitle: "CFO" })
        .expect(201)
    ).body.id;
    await a
      .put(`/leads/${leadId}/contact-roles`, {
        roles: [
          { partnerId: contactId, role: "champion", isPrimary: true },
          { partnerId: cfo, role: "decision_maker", isPrimary: true },
        ],
      })
      .expect(400);
    const detail = (
      await a
        .put(`/leads/${leadId}/contact-roles`, {
          roles: [
            { partnerId: contactId, role: "champion" },
            { partnerId: cfo, role: "decision_maker", isPrimary: true, note: "Menyetujui anggaran" },
          ],
        })
        .expect(200)
    ).body;
    expect(detail.contactId).toBe(cfo);
    expect(detail.contactRoles.map((r: { name: string; role: string }) => [r.name, r.role])).toEqual([
      ["Pak Anton", "decision_maker"],
      ["Ibu Sari", "champion"],
    ]);
  });

  it("riwayat tahap dicatat saat pindah tahap", async () => {
    await a.patch(`/leads/${leadId}`, { stageId: stage.Proposal!.id }).expect(200);
    await a.patch(`/leads/${leadId}`, { stageId: stage.Negosiasi!.id }).expect(200);
    const detail = (await a.get(`/leads/${leadId}`).expect(200)).body;
    expect(
      detail.stageHistory.map((h: { fromStageName: string | null; toStageName: string }) => [
        h.fromStageName,
        h.toStageName,
      ]),
    ).toEqual([
      [null, "Baru"],
      ["Baru", "Proposal"],
      ["Proposal", "Negosiasi"],
    ]);
    expect(detail.stageDays.map((d: { stageName: string }) => d.stageName)).toEqual([
      "Baru",
      "Proposal",
      "Negosiasi",
    ]);
  });

  it("penawaran dari peluang berisi produk peluang; konfirmasi menandai menang", async () => {
    const empty = (await a.post("/leads", { name: "Tanpa produk", partnerId: accountId }).expect(201)).body;
    await a.post(`/sale-orders/from-lead/${empty.id}`, {}).expect(400);
    await a.delete(`/leads/${empty.id}`).expect(204);

    const order = (await a.post(`/sale-orders/from-lead/${leadId}`, { dateOrder: today }).expect(201)).body;
    expect(order).toMatchObject({
      state: "draft",
      partnerId: accountId,
      leadId,
      amountUntaxed: "116000000.00",
    });
    expect(
      order.lines.map((l: { productId: string; quantity: string; discount: string }) => [
        l.productId,
        Number(l.quantity),
        Number(l.discount),
      ]),
    ).toEqual([
      [laptop, 10, 5],
      [mouse, 10, 0],
    ]);
    await a.post(`/sale-orders/${order.id}/confirm`).expect(200);
    const won = (await a.get(`/leads/${leadId}`).expect(200)).body;
    expect(won).toMatchObject({ state: "won", probability: "100.00" });
    expect(won.stageHistory.at(-1)).toMatchObject({ state: "won", toStageName: "Menang" });
    await a.put(`/leads/${leadId}/products`, { lines: [] }).expect(400);
    await a.post(`/sale-orders/from-lead/${leadId}`, {}).expect(400);
  });

  it("corong konversi & kecepatan pipeline", async () => {
    await a
      .post("/leads", { leadType: "lead", name: "Lead dingin", source: "ads", leadStatus: "unqualified" })
      .expect(201);
    const lost = (
      await a
        .post("/leads", { name: "Peluang kalah", source: "website", expectedRevenue: "5000000" })
        .expect(201)
    ).body;
    await a.post(`/leads/${lost.id}/lost`, {}).expect(200);
    const funnel = (await a.get(`/leads/reports/funnel?from=${today}&to=${today}`).expect(200)).body;
    expect(funnel.steps.map((s: { key: string; count: number }) => [s.key, s.count])).toEqual([
      ["leads", 3],
      ["contacted", 2],
      ["qualified", 2],
      ["opportunities", 2],
      ["won", 1],
    ]);
    expect(funnel.unqualified).toBe(1);
    const website = funnel.bySource.find((s: { key: string }) => s.key === "website");
    expect(website).toMatchObject({
      leads: 2,
      opportunities: 2,
      won: 1,
      lost: 1,
      winRate: 50,
      wonAmount: "116000000.00",
    });
    expect(funnel.byUser[0]).toMatchObject({ label: "Admin", leads: 3 });

    const velocity = (await a.get("/leads/reports/velocity").expect(200)).body;
    expect(velocity).toMatchObject({
      opportunities: 2,
      won: 1,
      lost: 1,
      winRate: 50,
      avgDealSize: "116000000.00",
    });
    expect(
      velocity.stages.map((s: { stageName: string; opportunities: number }) => [
        s.stageName,
        s.opportunities,
      ]),
    ).toEqual([
      ["Baru", 2],
      ["Kualifikasi", 0],
      ["Proposal", 1],
      ["Negosiasi", 1],
    ]);
    await a.get("/leads/reports/funnel?from=kemarin").expect(400);
  });

  it("akun 360°: pipeline, kontak, pesanan; faktur hanya dengan hak akuntansi", async () => {
    const orderId = (await a.get(`/sale-orders?leadId=${leadId}`).expect(200)).body.items[0].id;
    const invoice = (await a.post(`/sale-orders/${orderId}/invoice`, { method: "regular" }).expect(201)).body;
    await a.post(`/moves/${invoice.moveId}/post`).expect(200);
    await a
      .post("/activities", {
        resModel: "partner",
        resId: accountId,
        summary: "Telepon tindak lanjut",
        dueDate: today,
      })
      .expect(201);

    const view = (await a.get(`/crm/accounts/${accountId}`).expect(200)).body;
    expect(view.partner).toMatchObject({ name: "PT Maju Jaya", industry: "Distribusi" });
    expect(view.contacts.map((c: { name: string }) => c.name)).toEqual(["Ibu Sari", "Pak Anton"]);
    expect(view.summary).toMatchObject({
      openCount: 0,
      wonCount: 1,
      wonAmount: "116000000.00",
      winRate: 100,
    });
    expect(view.leads).toEqual([expect.objectContaining({ id: leadId, state: "won" })]);
    expect(view.sales).toMatchObject({ confirmed: 1 });
    expect(view.invoicing.invoices).toHaveLength(1);
    expect(Number(view.invoicing.outstanding)).toBeGreaterThan(116000000);
    expect(view.activities).toEqual([expect.objectContaining({ summary: "Telepon tindak lanjut" })]);

    // Kontak melihat peluang tempat ia menjadi kontak utama.
    const cfo = view.contacts.find((c: { name: string }) => c.name === "Pak Anton").id;
    const contactView = (await a.get(`/crm/accounts/${cfo}`).expect(200)).body;
    expect(contactView.parent).toMatchObject({ id: accountId });
    expect(contactView.leads).toHaveLength(1);

    // Penjual: tanpa hak akuntansi faktur disembunyikan; peluang milik admin tidak terlihat.
    const limited = (await sales.get(`/crm/accounts/${accountId}`).expect(200)).body;
    expect(limited.invoicing).toBeNull();
    expect(limited.leads).toEqual([]);
    expect(limited.sales.orders).toEqual([]);
    await sales.get(`/leads/${leadId}`).expect(404);
    await sales.put(`/leads/${leadId}/products`, { lines: [] }).expect(404);

    const accounts = (await a.get("/crm/accounts").expect(200)).body.items;
    expect(accounts.find((x: { id: string }) => x.id === accountId)).toMatchObject({
      contacts: 2,
      openCount: 0,
    });
    const contacts = (await a.get("/crm/accounts?kind=person").expect(200)).body.items;
    expect(contacts.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["Ibu Sari", "Pak Anton"]),
    );
    expect(contacts.find((c: { name: string }) => c.name === "Ibu Sari")).toMatchObject({
      parentName: "PT Maju Jaya",
    });
  });

  it("duplikat milik salesperson lain tampil tetapi tidak bisa digabung", async () => {
    const mine = (
      await sales.post("/leads", { leadType: "lead", name: "Lead Budi", email: "kontak@sama.id" }).expect(201)
    ).body;
    expect(mine.userId).toBe(salesUserId);
    const admins = (
      await a.post("/leads", { leadType: "lead", name: "Lead Admin", email: "kontak@sama.id" }).expect(201)
    ).body;
    const dup = (await sales.get(`/leads/${mine.id}/duplicates`).expect(200)).body;
    expect(dup.leads).toEqual([
      expect.objectContaining({ id: admins.id, accessible: false, userName: "Admin" }),
    ]);
    await sales.post(`/leads/${mine.id}/merge`, { sourceIds: [admins.id] }).expect(400);
    await a.post(`/leads/${admins.id}/merge`, { sourceIds: [mine.id] }).expect(200);
  });
});
