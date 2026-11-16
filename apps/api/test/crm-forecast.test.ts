import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const now = new Date();
const year = now.getUTCFullYear();
const month = `${year}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const quarter = `${year}-Q${Math.ceil((now.getUTCMonth() + 1) / 3)}`;
const inMonth = `${month}-15`;

describe.skipIf(!hasDb)("CRM forecast, kuota & wilayah", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let budi: ReturnType<typeof client>;
  let adminId = "";
  let budiId = "";
  let sitiId = "";
  const stage: Record<string, { id: string; forecastCategory: string }> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "crmfc");
    const me = (await a.get("/auth/me")).body;
    adminId = me.userId;
    for (const s of (await a.get("/crm-stages").expect(200)).body.items) stage[s.name] = s;
    const db = app.get(TenantDb);
    const [role] = await db.runAs(me.tenantId, (tx) =>
      tx.insert(schema.roles).values({ code: "sales", name: "Penjual" }).returning({ id: schema.roles.id }),
    );
    await db.runAs(me.tenantId, (tx) =>
      tx
        .insert(schema.rolePermissions)
        .values(
          ["crm.read", "crm.write", "partner.read"].map((permission) => ({ roleId: role!.id, permission })),
        ),
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
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "budi@example.com", password: "rahasia123" })
      .expect(200);
    budi = client(app, login.body.token);
  });

  afterAll(() => app?.close());

  it("tahap bawaan punya kategori forecast; bisa diubah", async () => {
    expect(
      Object.fromEntries(Object.entries(stage).map(([name, s]) => [name, s.forecastCategory])),
    ).toMatchObject({
      Baru: "pipeline",
      Kualifikasi: "pipeline",
      Proposal: "best_case",
      Negosiasi: "commit",
    });
    const patched = (
      await a.patch(`/crm-stages/${stage.Kualifikasi!.id}`, { forecastCategory: "best_case" }).expect(200)
    ).body;
    expect(patched.forecastCategory).toBe("best_case");
    await a.patch(`/crm-stages/${stage.Kualifikasi!.id}`, { forecastCategory: "pipeline" }).expect(200);
    await a.patch(`/crm-stages/${stage.Baru!.id}`, { forecastCategory: "pasti" }).expect(400);
  });

  it("kuota bulanan per salesperson & tim; hanya pengelola yang boleh mengubah", async () => {
    await budi.put("/crm/quotas", { quotas: [{ userId: budiId, month, amount: "1" }] }).expect(403);
    await a
      .put("/crm/quotas", {
        quotas: [
          { userId: budiId, month, amount: "100000000" },
          { userId: sitiId, month, amount: "50000000" },
          { userId: adminId, month, amount: "999" },
        ],
      })
      .expect(200);
    await a.put("/crm/quotas", { quotas: [{ userId: adminId, month, amount: null }] }).expect(200);
    await a
      .put("/crm/quotas", {
        quotas: [{ userId: "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10", month, amount: "1" }],
      })
      .expect(400);
    const all = (await a.get(`/crm/quotas?year=${year}`).expect(200)).body.quotas;
    expect(all).toHaveLength(2);
    const own = (await budi.get(`/crm/quotas?year=${year}`).expect(200)).body.quotas;
    expect(own).toEqual([{ userId: budiId, teamId: null, month, amount: "100000000.00" }]);
  });

  it("forecast: kategori ikut tahap, bisa ditimpa per peluang, menang masuk closed", async () => {
    const opp = async (body: object) => (await a.post("/leads", body).expect(201)).body.id as string;
    // Budi: commit 30 jt (Negosiasi), best case 20 jt (Proposal), pipeline 10 jt (Baru), menang 40 jt.
    await opp({
      name: "B-commit",
      userId: budiId,
      stageId: stage.Negosiasi!.id,
      expectedRevenue: "30000000",
      expectedClose: inMonth,
    });
    await opp({
      name: "B-best",
      userId: budiId,
      stageId: stage.Proposal!.id,
      expectedRevenue: "20000000",
      expectedClose: inMonth,
    });
    await opp({ name: "B-pipe", userId: budiId, expectedRevenue: "10000000", expectedClose: inMonth });
    const won = await opp({ name: "B-won", userId: budiId, expectedRevenue: "40000000" });
    await a.post(`/leads/${won}/won`).expect(200);
    // Di luar forecast: tanpa tanggal closing, kalah, dan yang dikeluarkan manual.
    await opp({ name: "B-tanpa-tanggal", userId: budiId, expectedRevenue: "7000000" });
    const lost = await opp({
      name: "B-kalah",
      userId: budiId,
      expectedRevenue: "9000000",
      expectedClose: inMonth,
    });
    await a.post(`/leads/${lost}/lost`, {}).expect(200);
    const omitted = await opp({
      name: "B-omit",
      userId: budiId,
      stageId: stage.Negosiasi!.id,
      expectedRevenue: "5000000",
      expectedClose: inMonth,
    });
    expect(
      (await a.patch(`/leads/${omitted}`, { forecastCategory: "omitted" }).expect(200)).body.forecastCategory,
    ).toBe("omitted");
    // Siti: peluang di tahap Baru dinaikkan manual ke commit.
    const s1 = await opp({
      name: "S-commit",
      userId: sitiId,
      expectedRevenue: "25000000",
      expectedClose: inMonth,
    });
    await a.patch(`/leads/${s1}`, { forecastCategory: "commit" }).expect(200);

    const f = (await a.get(`/crm/forecast?period=${month}`).expect(200)).body;
    expect(f.period).toMatchObject({ key: month, type: "month" });
    const row = (name: string) => f.rows.find((r: { userName: string }) => r.userName === name);
    expect(row("Budi")).toMatchObject({
      closed: "40000000.00",
      commit: "30000000.00",
      bestCase: "20000000.00",
      pipeline: "10000000.00",
      commitForecast: "70000000.00",
      bestCaseForecast: "90000000.00",
      quota: "100000000.00",
      attainment: 40,
      gap: "60000000.00",
      count: 4,
    });
    expect(row("Siti")).toMatchObject({
      commit: "25000000.00",
      pipeline: "0.00",
      quota: "50000000.00",
      attainment: 0,
    });
    expect(f.total).toMatchObject({ closed: "40000000.00", commit: "55000000.00", quota: "150000000.00" });
    expect(f.undated).toEqual({ count: 1, amount: "7000000.00" });
    expect(f.adjustable).toBe("all");

    // Kuartal memuat bulan ini.
    const q = (await a.get(`/crm/forecast?period=${quarter}`).expect(200)).body;
    expect(q.rows.find((r: { userName: string }) => r.userName === "Budi")).toMatchObject({
      closed: "40000000.00",
      quota: "100000000.00",
    });
    await a.get("/crm/forecast?period=2026-13").expect(400);
  });

  it("penjual hanya melihat barisnya; pemimpin tim boleh menyesuaikan forecast anggotanya", async () => {
    const mine = (await budi.get(`/crm/forecast?period=${month}`).expect(200)).body;
    expect(mine.rows.map((r: { userName: string }) => r.userName)).toEqual(["Budi"]);
    expect(mine.teams).toEqual([]);
    expect(mine.total.commit).toBe("30000000.00");
    expect(mine.adjustable).toEqual([]);
    await budi.put("/crm/forecast/adjustments", { userId: sitiId, month, amount: "1" }).expect(403);

    const team = (
      await a
        .post("/sales-teams", { name: "Tim Barat", leaderId: budiId, memberIds: [budiId, sitiId] })
        .expect(201)
    ).body;
    await budi
      .put("/crm/forecast/adjustments", { userId: sitiId, month, amount: "30000000", note: "Yakin tutup" })
      .expect(200);
    const f = (await a.get(`/crm/forecast?period=${month}`).expect(200)).body;
    expect(f.rows.find((r: { userName: string }) => r.userName === "Siti").adjusted).toBe("30000000.00");
    expect(f.teams).toEqual([
      expect.objectContaining({
        teamId: team.id,
        teamName: "Tim Barat",
        closed: "40000000.00",
        commit: "55000000.00",
        quota: "150000000.00",
      }),
    ]);
    // Kuota tim eksplisit menimpa jumlah kuota anggota.
    await a.put("/crm/quotas", { quotas: [{ teamId: team.id, month, amount: "200000000" }] }).expect(200);
    const withTeamQuota = (await a.get(`/crm/forecast?period=${month}`).expect(200)).body;
    expect(withTeamQuota.teams[0]).toMatchObject({ quota: "200000000.00", attainment: 20 });
    expect((await budi.get(`/crm/forecast?period=${month}`).expect(200)).body.adjustable).toEqual([
      budiId,
      sitiId,
    ]);
    await a.put("/crm/forecast/adjustments", { userId: sitiId, month, amount: null }).expect(200);
  });

  it("pencapaian vs kuota setahun", async () => {
    const att = (await a.get(`/crm/forecast/attainment?year=${year}`).expect(200)).body;
    expect(att.months).toHaveLength(12);
    const row = att.rows.find((r: { userName: string }) => r.userName === "Budi");
    expect(row).toMatchObject({ closed: "40000000.00", quota: "100000000.00", attainment: 40 });
    expect(row.months.find((m: { month: string }) => m.month === month)).toEqual({
      month,
      closed: "40000000.00",
      quota: "100000000.00",
      attainment: 40,
    });
    expect(att.total).toMatchObject({ closed: "40000000.00", quota: "150000000.00" });
    const own = (await budi.get(`/crm/forecast/attainment?year=${year}`).expect(200)).body;
    expect(own.rows.map((r: { userName: string }) => r.userName)).toEqual(["Budi"]);
  });

  it("wilayah: aturan provinsi/industri, terisi otomatis, penugasan bergiliran", async () => {
    await budi.post("/crm/territories", { name: "X" }).expect(403);
    const jabar = (
      await a
        .post("/crm/territories", {
          name: "Jawa Barat",
          sequence: 5,
          rules: { provinces: ["Jawa Barat"] },
          memberIds: [budiId, sitiId],
        })
        .expect(201)
    ).body;
    const agro = (
      await a
        .post("/crm/territories", {
          name: "Agro Jabar",
          sequence: 1,
          rules: { provinces: ["Jawa Barat"], industries: ["Perkebunan"] },
          managerId: adminId,
        })
        .expect(201)
    ).body;
    await a
      .post("/crm/territories", { name: "Salah", memberIds: ["3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10"] })
      .expect(400);

    // Lead baru langsung mendapat wilayah dari aturan.
    const lead = (
      await a
        .post("/leads", {
          leadType: "lead",
          name: "Kebun teh",
          partnerName: "PT Teh Priangan",
          contactName: "Pak Ujang",
          province: "Jawa Barat",
          industry: "Perkebunan",
        })
        .expect(201)
    ).body;
    expect(lead.territoryId).toBe(agro.id);
    const converted = (await a.post(`/leads/${lead.id}/convert`, {}).expect(200)).body;
    expect((await a.get(`/partners/${converted.partnerId}`).expect(200)).body.territoryId).toBe(agro.id);
    // Peluang baru untuk akun itu ikut wilayah akun.
    const opp = (await a.post("/leads", { name: "Lanjutan", partnerId: converted.partnerId }).expect(201))
      .body;
    expect(opp.territoryId).toBe(agro.id);

    // Data lama tanpa wilayah: terapkan aturan + giliran penugasan untuk lead tanpa penanggung jawab.
    const partner = (await a.post("/partners", { name: "CV Bandung", province: "jawa barat" }).expect(201))
      .body;
    await a.patch(`/crm/territories/${jabar.id}`, { active: false }).expect(200);
    const ids: string[] = [];
    for (const name of ["L1", "L2", "L3"])
      ids.push(
        (await a.post("/leads", { leadType: "lead", name, province: "Jawa Barat", userId: null }).expect(201))
          .body.id,
      );
    await a.patch(`/crm/territories/${jabar.id}`, { active: true }).expect(200);
    await budi.post("/crm/territory-assign").expect(403);
    const result = (await a.post("/crm/territory-assign").expect(200)).body;
    expect(result).toEqual({ accounts: 1, leads: 3, assigned: 3 });
    expect((await a.get(`/partners/${partner.id}`).expect(200)).body.territoryId).toBe(jabar.id);
    const owners = [];
    for (const id of ids) owners.push((await a.get(`/leads/${id}`).expect(200)).body.userId);
    // Budi punya lebih banyak lead terbuka daripada Siti, jadi Siti lebih dulu sampai seimbang.
    expect(owners.filter((o) => o === sitiId).length).toBeGreaterThanOrEqual(2);
    expect(owners.every((o) => o === sitiId || o === budiId)).toBe(true);
    expect((await a.post("/crm/territory-assign").expect(200)).body).toEqual({
      accounts: 0,
      leads: 0,
      assigned: 0,
    });

    const report = (await a.get("/crm/territory-report").expect(200)).body;
    expect(report.rows.find((r: { name: string }) => r.name === "Agro Jabar")).toMatchObject({
      accounts: 2,
      openCount: 2,
    });
    expect(report.rows.find((r: { name: string }) => r.name === "Jawa Barat")).toMatchObject({ accounts: 1 });
    await a
      .post("/leads", { name: "Wilayah asing", territoryId: "3f2c1b7e-6f0a-4d6b-9a55-0d6f3c2b1a10" })
      .expect(400);
  });
});
