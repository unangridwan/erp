import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MaintenanceScheduler } from "../src/maintenance/maintenance.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

describe.skipIf(!hasDb)("Maintenance aset", () => {
  let app: INestApplication;
  let scheduler: MaintenanceScheduler;
  let a: Awaited<ReturnType<typeof signup>>;
  let tenantId = "";
  let me = "";
  let op: ReturnType<typeof client>;
  let tech: ReturnType<typeof client>;
  let techId = "";
  let stockLocationId = "";
  let costCenter = "";
  let bearing = "";
  let vendor = "";
  let mill = "";
  let team = "";

  beforeAll(async () => {
    app = await createApp();
    scheduler = app.get(MaintenanceScheduler);
    a = await signup(app, "mnt");
    const meBody = (await a.get("/auth/me")).body;
    tenantId = meBody.tenantId;
    me = meBody.userId;
    const company = meBody.activeCompanyId;
    const login = async (email: string) =>
      client(
        app,
        (
          await request(app.getHttpServer())
            .post("/auth/login")
            .send({ tenantSlug: a.slug, email, password: "rahasia123" })
            .expect(200)
        ).body.token,
      );
    const techRole = (await a.get("/roles").expect(200)).body.find(
      (r: { code: string }) => r.code === "user",
    );
    const role = (
      await a
        .post("/roles", { code: "teknisi_x", name: "Teknisi", permissions: ["maintenance.write"] })
        .expect(201)
    ).body.id;
    techId = (
      await a
        .post("/users", {
          name: "Tono Teknisi",
          email: "tono@example.com",
          password: "rahasia123",
          roleIds: [role],
          companyIds: [company],
        })
        .expect(201)
    ).body.id;
    await a
      .post("/users", {
        name: "Ola Operator",
        email: "ola@example.com",
        password: "rahasia123",
        roleIds: [techRole.id],
        companyIds: [company],
      })
      .expect(201);
    tech = await login("tono@example.com");
    op = await login("ola@example.com");

    const wh = (await a.get("/warehouses").expect(200)).body.items[0];
    stockLocationId = wh.lotStockId;
    const pcs = (
      (await a.get("/uoms?limit=200").expect(200)).body.items as { name: string; id: string }[]
    ).find((u) => u.name === "Pcs")!.id;
    bearing = (
      await a.post("/products", { sku: "BRG", name: "Bearing 6204", uomId: pcs, cost: "50000" }).expect(201)
    ).body.id;
    await a
      .post("/stock/adjustments", {
        locationId: stockLocationId,
        reason: "Saldo awal",
        lines: [{ productId: bearing, countedQty: "10", unitCost: "50000" }],
      })
      .expect(200);
    vendor = (await a.post("/partners", { name: "CV Teknik Jaya", isSupplier: true }).expect(201)).body.id;
    costCenter = (await a.post("/cost-centers", { code: "PRD", name: "Produksi" }).expect(201)).body.id;
    team = (await a.post("/maintenance-teams", { name: "Mekanik", memberIds: [techId] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("peralatan: kode unik, meter tidak boleh mundur, hak akses", async () => {
    mill = (
      await a
        .post("/equipment", {
          code: "PM-01",
          name: "Mesin Penggiling Padi",
          category: "Mesin produksi",
          costCenterId: costCenter,
          teamId: team,
          meterUnit: "hours",
          criticality: "high",
        })
        .expect(201)
    ).body.id;
    await a.post("/equipment", { code: "pm-01", name: "Ganda" }).expect(400);
    await a.post(`/equipment/${mill}/meter`, { date: today, value: "1000" }).expect(201);
    await a.post(`/equipment/${mill}/meter`, { date: today, value: "900" }).expect(400);
    await op.post("/equipment", { code: "X", name: "X" }).expect(403);
    // Peran "user" bawaan hanya baca: boleh lihat, tidak boleh membuat permintaan langsung (pakai portal).
    await op.get("/maintenance-requests").expect(200);
    await op.post("/maintenance-requests", { equipmentId: mill, title: "x" }).expect(403);
    await a
      .post("/maintenance-plans", { equipmentId: mill, name: "Tanpa interval", startDate: today })
      .expect(400);
  });

  it("rencana preventif hari & meter → permintaan otomatis sekali per siklus", async () => {
    await a
      .post("/maintenance-plans", {
        equipmentId: mill,
        name: "Servis bulanan",
        intervalDays: 30,
        startDate: today,
        tasks: [{ label: "Cek oli" }, { label: "Kencangkan baut" }],
      })
      .expect(201);
    const meterPlan = (
      await a
        .post("/maintenance-plans", {
          equipmentId: mill,
          name: "Ganti bearing 500 jam",
          intervalMeter: "500",
          startDate: today,
          lastDoneMeter: "600",
        })
        .expect(201)
    ).body.id;
    expect(await scheduler.runDue(today, [tenantId])).toBe(1);
    expect(await scheduler.runDue(today, [tenantId])).toBe(0);
    await a.post(`/equipment/${mill}/meter`, { date: today, value: "1100" }).expect(201);
    expect(await scheduler.runDue(today, [tenantId])).toBe(1);
    const list = (await a.get(`/maintenance-requests?kind=preventive&equipmentId=${mill}`).expect(200)).body;
    expect(list).toHaveLength(2);
    const monthly = list.find((r: { title: string }) => r.title === "Servis bulanan");
    const detail = (await tech.get(`/maintenance-requests/${monthly.id}`).expect(200)).body;
    expect(detail.checklist).toEqual([
      { label: "Cek oli", done: false },
      { label: "Kencangkan baut", done: false },
    ]);
    expect(detail.teamId).toBe(team);
    const notes = (await tech.get("/me/notifications").expect(200)).body as { title: string }[];
    expect(notes.some((n) => n.title.includes("Perawatan terjadwal"))).toBe(true);

    // Selesaikan rencana meter → siklus berikutnya baru jatuh tempo pada 1600 jam.
    const bearingJob = list.find((r: { title: string }) => r.title.startsWith("Ganti bearing"));
    await tech.post(`/maintenance-requests/${bearingJob.id}/start`).expect(201);
    await tech.post(`/maintenance-requests/${bearingJob.id}/done`, { meter: "1100" }).expect(201);
    const plan = (await a.get(`/maintenance-plans/${meterPlan}`).expect(200)).body;
    expect(Number(plan.lastDoneMeter)).toBe(1100);
    expect(await scheduler.runDue(today, [tenantId])).toBe(0);
    // Rencana harian bulan depan.
    await tech
      .post(`/maintenance-requests/${monthly.id}/done`, {
        checklist: [
          { label: "Cek oli", done: true },
          { label: "Kencangkan baut", done: true },
        ],
      })
      .expect(201);
    expect(await scheduler.runDue(addDays(today, 29), [tenantId])).toBe(0);
    expect(await scheduler.runDue(addDays(today, 31), [tenantId])).toBe(1);
  });

  it("laporan kerusakan portal → dikerjakan dengan suku cadang & jasa vendor → stok, jurnal, tagihan", async () => {
    const equipmentList = (await op.get("/me/maintenance-requests/equipment").expect(200)).body;
    expect(equipmentList.map((e: { id: string }) => e.id)).toContain(mill);
    const breakdownAt = new Date(Date.now() - 5 * 3600_000).toISOString();
    const reported = (
      await op
        .post("/me/maintenance-requests", {
          equipmentId: mill,
          title: "Mesin bunyi keras & berhenti",
          priority: "urgent",
        })
        .expect(201)
    ).body;
    expect((await a.get(`/equipment/${mill}`).expect(200)).body.state).toBe("down");
    const req = reported.id;
    await tech
      .put(`/maintenance-requests/${req}`, {
        equipmentId: mill,
        kind: "corrective",
        title: "Mesin bunyi keras & berhenti",
        priority: "urgent",
        breakdownAt,
        vendorId: vendor,
        vendorCost: "750000",
        laborCost: "100000",
      })
      .expect(200);
    await tech
      .put(`/maintenance-requests/${req}/parts`, { parts: [{ productId: bearing, quantity: "20" }] })
      .expect(200);
    await tech.post(`/maintenance-requests/${req}/start`).expect(201);
    // Stok hanya 10 → gagal, lalu perbaiki jumlah.
    await tech.post(`/maintenance-requests/${req}/done`, { resolution: "Ganti bearing" }).expect(400);
    await tech
      .put(`/maintenance-requests/${req}/parts`, { parts: [{ productId: bearing, quantity: "2" }] })
      .expect(200);
    const done = (
      await tech.post(`/maintenance-requests/${req}/done`, { resolution: "Ganti bearing" }).expect(201)
    ).body;
    expect(done.state).toBe("done");
    expect(Number(done.partsCost)).toBe(100000);
    expect(Number(done.downtimeHours)).toBeGreaterThanOrEqual(4.9);
    expect(done.parts[0].cost).toBe("100000.00");
    expect((await a.get(`/equipment/${mill}`).expect(200)).body.state).toBe("operational");
    const quants = (await a.get(`/stock/quants?productId=${bearing}`).expect(200)).body;
    const onHand = (Array.isArray(quants) ? quants : quants.items)
      .filter((q: { locationId: string }) => q.locationId === stockLocationId)
      .reduce((s: number, q: { quantity: string }) => s + Number(q.quantity), 0);
    expect(onHand).toBe(8);
    const journal = (await a.get(`/moves/${done.partsMoveId}`).expect(200)).body;
    const expenseLine = journal.lines.find((l: { debit: string }) => Number(l.debit) > 0);
    expect(expenseLine.costCenterId).toBe(costCenter);
    expect(Number(expenseLine.debit)).toBe(100000);

    const notes = (await op.get("/me/notifications").expect(200)).body as { title: string }[];
    expect(notes.some((n) => n.title.includes("selesai"))).toBe(true);
    const mine = (await op.get("/me/maintenance-requests").expect(200)).body;
    expect(mine[0]).toMatchObject({ id: req, state: "done" });

    // Tagihan vendor: teknisi tanpa hak manage ditolak; admin sekali saja.
    await tech.post(`/maintenance-requests/${req}/bill`).expect(403);
    const { moveId } = (await a.post(`/maintenance-requests/${req}/bill`).expect(201)).body;
    const bill = (await a.get(`/moves/${moveId}`).expect(200)).body;
    expect(bill).toMatchObject({ moveType: "in_invoice", state: "draft", partnerId: vendor });
    expect(Number(bill.amountTotal)).toBe(750000);
    expect(bill.lines.some((l: { costCenterId: string | null }) => l.costCenterId === costCenter)).toBe(true);
    await a.post(`/maintenance-requests/${req}/bill`).expect(400);
    await a.post(`/maintenance-requests/${req}/cancel`).expect(400);
  });

  it("laporan MTBF/MTTR, ketersediaan, biaya & kepatuhan preventif", async () => {
    const from = addDays(today, -9);
    const r = (await a.get(`/maintenance/reports?from=${from}&to=${today}`).expect(200)).body;
    const row = r.rows.find((x: { equipmentId: string }) => x.equipmentId === mill);
    expect(row.failures).toBe(1);
    expect(row.downtimeHours).toBeGreaterThan(4.9);
    expect(row.mtbf).toBeGreaterThan(200);
    expect(row.mttr).toBe(row.downtimeHours);
    expect(row.availability).toBeLessThan(100);
    expect(Number(row.totalCost)).toBe(950000);
    expect(row.preventiveDue).toBe(2);
    expect(row.preventiveOnTime).toBe(2);
    expect(row.compliance).toBe(100);
    // Drilldown per peralatan dengan syarat tanggal sama dengan laporan.
    const drill = async (match: Record<string, string>, column: string) =>
      (
        await a
          .post("/reports/drill", {
            dataset: "maintenance_requests",
            config: {
              conditions: [
                { column, op: "gte", value: from },
                { column, op: "lte", value: today },
              ],
            },
            match: { _equipmentId: mill, ...match },
          })
          .expect(200)
      ).body;
    expect((await drill({ _kind: "corrective" }, "breakdown")).total).toBe(row.failures);
    const cost = await drill({ _done: "1" }, "finished");
    expect(cost.totals.totalCost).toBe(950000);
    expect(cost.rows[0]._model).toBe("maintenance_request");
    expect((await drill({ _kind: "preventive" }, "scheduled")).total).toBe(row.preventiveDue);
    const links = (await a.get(`/links/maintenance_request/${cost.rows[0]._id}`).expect(200)).body;
    expect(links.model).toBe("maintenance_request");
  });

  it("isolasi tenant & pengaturan", async () => {
    const b = await signup(app, "mnt2");
    await b
      .get(`/maintenance-requests/${(await a.get("/maintenance-requests").expect(200)).body[0].id}`)
      .expect(404);
    expect((await b.get("/equipment").expect(200)).body.items).toEqual([]);
    const s = (await a.get("/maintenance/settings").expect(200)).body;
    expect(s.defaultPartsLocationId).toBe(stockLocationId);
    await a.put("/maintenance/settings", { partsLocationId: stockLocationId }).expect(200);
    expect(me).toBeTruthy();
  });
});
