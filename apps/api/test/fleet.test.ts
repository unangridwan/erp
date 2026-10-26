import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { FleetReminderService } from "../src/fleet/fleet.module.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Armada: kendaraan, pengemudi, odometer, kontrak, servis → tagihan vendor, laporan biaya, pengingat. */
describe.skipIf(!hasDb)("Armada", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let tenantId: string;
  let dewi: ReturnType<typeof client>;
  let dewiEmp: string;
  let ekoEmp: string;
  let model: string;
  let vehicle: string;
  let vendor: string;
  let branch: string;
  let serviceType: (name: string) => Promise<string>;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "flt");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    const [role] = await app
      .get(TenantDb)
      .runAs(tenantId, (tx) =>
        tx
          .insert(schema.roles)
          .values({ code: "karyawan", name: "Karyawan" })
          .returning({ id: schema.roles.id }),
      );
    await a
      .post("/users", {
        name: "Dewi Sopir",
        email: "dewi@example.com",
        password: "rahasia123",
        roleIds: [role!.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "dewi@example.com", password: "rahasia123" })
        .expect(200)
    ).body.token;
    dewi = client(app, token);
    const dewiUser = (await dewi.get("/auth/me")).body.userId;
    dewiEmp = (
      await a.post("/employees", { name: "Dewi Sopir", userId: dewiUser, joinDate: "2024-01-01" }).expect(201)
    ).body.id;
    ekoEmp = (await a.post("/employees", { name: "Eko Sopir", joinDate: "2024-01-01" }).expect(201)).body.id;
    vendor = (await a.post("/partners", { name: "Bengkel Maju" }).expect(201)).body.id;
    branch = (
      await a.post("/branches", { code: "BDG", name: "Bandung", companyId: me.activeCompanyId }).expect(201)
    ).body.id;
    const maker = (await a.post("/fleet-manufacturers", { name: "Toyota" }).expect(201)).body.id;
    await a.post("/fleet-manufacturers", { name: "toyota" }).expect(400);
    model = (
      await a
        .post("/fleet-models", {
          manufacturerId: maker,
          name: "Avanza",
          category: "car",
          seats: 7,
          transmission: "manual",
          fuelType: "gasoline",
        })
        .expect(201)
    ).body.id;
    serviceType = async (name: string) => {
      const items = (await a.get("/fleet-service-types?limit=100").expect(200)).body.items as {
        id: string;
        name: string;
      }[];
      return items.find((t) => t.name === name)!.id;
    };
  });
  afterAll(() => app?.close());

  it("kendaraan: nopol dirapikan & unik, pengemudi tercatat riwayatnya", async () => {
    const v = (
      await a
        .post("/fleet-vehicles", {
          licensePlate: "d1234abc",
          modelId: model,
          branchId: branch,
          driverEmployeeId: dewiEmp,
          stnkExpiry: addDays(10),
          kirExpiry: addDays(-3),
          taxDueDate: addDays(200),
        })
        .expect(201)
    ).body;
    vehicle = v.id;
    expect(v.licensePlate).toBe("D 1234 ABC");
    await a.post("/fleet-vehicles", { licensePlate: "D 1234 ABC", modelId: model }).expect(400);
    await a.post("/fleet-vehicles", { licensePlate: "12345", modelId: model }).expect(400);

    // Jenis layanan bawaan dibuat saat kendaraan pertama.
    expect(await serviceType("Ganti oli")).toBeTruthy();

    await a.patch(`/fleet-vehicles/${vehicle}`, { driverEmployeeId: ekoEmp }).expect(200);
    let o = (await a.get(`/fleet/vehicles/${vehicle}/overview`).expect(200)).body;
    expect(o.drivers.map((d: { name: string; endDate: string | null }) => [d.name, !!d.endDate])).toEqual(
      expect.arrayContaining([
        ["Eko Sopir", false],
        ["Dewi Sopir", true],
      ]),
    );
    o = (await a.post(`/fleet/vehicles/${vehicle}/driver`, { employeeId: dewiEmp }).expect(201)).body;
    expect(o.vehicle.driverEmployeeId).toBe(dewiEmp);
    expect(o.drivers.filter((d: { endDate: string | null }) => !d.endDate)).toHaveLength(1);
    const emp = (await a.get(`/fleet/employees/${dewiEmp}/vehicles`).expect(200)).body;
    expect(emp[0].licensePlate).toBe("D 1234 ABC");
  });

  it("odometer: tidak boleh mundur; pengemudi mencatat dari portal", async () => {
    await a.post(`/fleet/vehicles/${vehicle}/odometers`, { date: addDays(-20), value: 10000 }).expect(201);
    await a.post(`/fleet/vehicles/${vehicle}/odometers`, { date: addDays(-10), value: 9000 }).expect(400);
    // Pembacaan di antara dua tanggal tidak boleh melebihi pembacaan sesudahnya.
    await a.post(`/fleet/vehicles/${vehicle}/odometers`, { date: addDays(-5), value: 12000 }).expect(201);
    await a.post(`/fleet/vehicles/${vehicle}/odometers`, { date: addDays(-8), value: 12500 }).expect(400);

    const mine = (await dewi.get("/me/vehicles").expect(200)).body;
    expect(mine.map((v: { licensePlate: string }) => v.licensePlate)).toEqual(["D 1234 ABC"]);
    await dewi.post(`/me/vehicles/${vehicle}/odometers`, { date: addDays(0), value: 12800 }).expect(201);
    const v = (await a.get(`/fleet-vehicles/${vehicle}`).expect(200)).body;
    expect(Number(v.odometer)).toBe(12800);

    // Tanpa hak armada: data armada tertutup.
    await dewi.get("/fleet-vehicles").expect(403);
    await dewi.get("/fleet/reports/costs?from=2026-01-01&to=2026-12-31").expect(403);
  });

  it("kontrak: biaya berulang, kedaluwarsa otomatis, perpanjangan", async () => {
    const sewa = await serviceType("Sewa / leasing");
    await a
      .post("/fleet-contracts", {
        vehicleId: vehicle,
        serviceTypeId: sewa,
        startDate: "2026-02-01",
        endDate: "2026-01-01",
      })
      .expect(400);
    const old = (
      await a
        .post("/fleet-contracts", {
          vehicleId: vehicle,
          serviceTypeId: sewa,
          vendorId: vendor,
          reference: "SEWA-01",
          startDate: addDays(-40),
          endDate: addDays(-1),
          initialCost: "500000",
          recurringCost: "3000000",
          recurringInterval: "monthly",
        })
        .expect(201)
    ).body;
    const asuransi = (
      await a
        .post("/fleet-contracts", {
          vehicleId: vehicle,
          serviceTypeId: await serviceType("Asuransi"),
          startDate: addDays(-300),
          endDate: addDays(20),
          recurringCost: "0",
          initialCost: "4000000",
          recurringInterval: "none",
        })
        .expect(201)
    ).body;
    const o = (await a.get(`/fleet/vehicles/${vehicle}/overview`).expect(200)).body;
    const state = (id: string) => o.contracts.find((c: { id: string }) => c.id === id).state;
    expect(state(old.id)).toBe("expired");
    expect(state(asuransi.id)).toBe("running");

    const renewed = (await a.post(`/fleet/contracts/${old.id}/renew`).expect(201)).body;
    expect(renewed.startDate).toBe(addDays(0));
    expect(renewed.renewedFromId).toBe(old.id);
    expect((await a.get(`/fleet-contracts/${old.id}`).expect(200)).body.state).toBe("closed");
    await a.post(`/fleet/contracts/${old.id}/renew`).expect(400);
  });

  it("servis: odometer ikut tercatat, tagihan vendor draft dengan cabang kendaraan (sekali)", async () => {
    const oli = await serviceType("Ganti oli");
    await a
      .post("/fleet-services", { vehicleId: vehicle, serviceTypeId: oli, date: addDays(0), odometer: 100 })
      .expect(400); // odometer mundur
    const noVendor = (
      await a
        .post("/fleet-services", { vehicleId: vehicle, serviceTypeId: oli, date: addDays(0), cost: "250000" })
        .expect(201)
    ).body;
    await a.post(`/fleet/services/${noVendor.id}/bill`).expect(400);
    const svc = (
      await a
        .post("/fleet-services", {
          vehicleId: vehicle,
          serviceTypeId: oli,
          vendorId: vendor,
          date: addDays(0),
          odometer: 13000,
          cost: "450000",
          state: "done",
        })
        .expect(201)
    ).body;
    expect(Number((await a.get(`/fleet-vehicles/${vehicle}`).expect(200)).body.odometer)).toBe(13000);

    const { moveId } = (await a.post(`/fleet/services/${svc.id}/bill`).expect(201)).body;
    const move = (await a.get(`/moves/${moveId}`).expect(200)).body;
    expect(move.moveType).toBe("in_invoice");
    expect(move.state).toBe("draft");
    expect(move.partnerId).toBe(vendor);
    expect(Number(move.amountTotal)).toBe(450000);
    expect(move.lines.some((l: { branchId: string | null }) => l.branchId === branch)).toBe(true);
    await a.post(`/fleet/services/${svc.id}/bill`).expect(400);
    await a.patch(`/fleet-services/${svc.id}`, { cost: "1" }).expect(400);
    await a.delete(`/fleet-services/${svc.id}`).expect(400);
  });

  it("laporan biaya per kendaraan & bulan, pengingat dokumen + notifikasi harian", async () => {
    const from = addDays(-60);
    const to = addDays(0);
    const r = (await a.get(`/fleet/reports/costs?from=${from}&to=${to}&groupBy=vehicle`).expect(200)).body;
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].service).toBe(700000);
    expect(r.groups[0].contract).toBeGreaterThanOrEqual(500000 + 3000000);
    const months = (await a.get(`/fleet/reports/costs?from=${from}&to=${to}&groupBy=month`).expect(200)).body;
    expect(months.total).toBe(r.total);
    const odo = (await a.get(`/fleet/reports/odometer?from=${from}&to=${to}`).expect(200)).body;
    expect(odo.at(-1).value).toBe(13000);

    await a.put("/fleet/settings", { reminderDays: 30 }).expect(200);
    const rem = (await a.get("/fleet/reminders").expect(200)).body as { kind: string; daysLeft: number }[];
    expect(rem.map((x) => x.kind)).toEqual(["kir", "stnk", "contract"]);
    expect(rem[0]!.daysLeft).toBe(-3);

    const job = app.get(FleetReminderService);
    expect(await job.runDaily([tenantId])).toBe(3);
    expect(await job.runDaily([tenantId])).toBe(0); // sekali per hari
    const notes = (await a.get("/me/notifications").expect(200)).body as { kind: string; link: string }[];
    expect(notes.filter((n) => n.kind === "fleet_reminder")).toHaveLength(3);
    expect(notes[0]!.link).toBe(`/fleet-vehicles/${vehicle}`);
  });
});
