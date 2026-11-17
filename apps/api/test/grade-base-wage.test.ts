import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/**
 * Gaji pokok ditentukan golongan: kontrak tanpa nilai gaji pokok memakai standar golongan (karyawan, atau jabatannya),
 * nilai lain tetap boleh (ditandai disesuaikan), dan perubahan standar bisa diterapkan ke kontrak berjalan.
 */
describe.skipIf(!hasDb)("Gaji pokok standar golongan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let a1: string;
  let a2: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "golgaji");
    a1 = (
      await a
        .post("/salary-grades", {
          code: "A1",
          name: "A1",
          minWage: 4500000,
          maxWage: 7000000,
          baseWage: 5000000,
        })
        .expect(201)
    ).body.id;
    a2 = (
      await a
        .post("/salary-grades", {
          code: "A2",
          name: "A2",
          minWage: 5500000,
          maxWage: 8000000,
          baseWage: 6000000,
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app?.close());

  const hire = (name: string, extra: object, wage?: number) =>
    a.post("/employees", {
      name,
      ...extra,
      contract: { dateStart: "2026-01-05", contractType: "pkwtt", ...(wage ? { wage } : {}) },
    });

  it("gaji pokok wajib; skala upah minimum & maksimum opsional", async () => {
    const missing = await a.post("/salary-grades", { code: "C1", name: "C1" }).expect(400);
    expect(missing.body.errors?.[0]?.path).toBe("baseWage");
    const only = (
      await a.post("/salary-grades", { code: "C2", name: "C2", baseWage: 4000000, maxWage: null }).expect(201)
    ).body;
    expect(only).toMatchObject({ baseWage: "4000000.00", minWage: null, maxWage: null });
    // Hanya batas bawah: gaji pokok di bawahnya ditolak, di atasnya bebas.
    await a.patch(`/salary-grades/${only.id}`, { minWage: 4500000 }).expect(400);
    await a.patch(`/salary-grades/${only.id}`, { minWage: 3000000 }).expect(200);
  });

  it("gaji pokok golongan harus di dalam rentang skala upah", async () => {
    const res = await a
      .post("/salary-grades", { code: "B1", name: "B1", minWage: 1, maxWage: 2, baseWage: 3 })
      .expect(400);
    expect(res.body.errors?.[0]?.path).toBe("baseWage");
    const patch = await a.patch(`/salary-grades/${a1}`, { baseWage: 9000000 }).expect(400);
    expect(patch.body.errors?.[0]?.path).toBe("baseWage");
  });

  it("kontrak tanpa gaji pokok memakai standar golongan karyawan atau jabatannya", async () => {
    const budi = (await hire("Budi A1", { gradeId: a1 }).expect(201)).body;
    const c = (await a.get(`/contracts/${budi.contractId}`).expect(200)).body;
    expect(Number(c.wage)).toBe(5000000);
    expect(c.gradeId).toBe(a1);
    expect(c.grade).toMatchObject({ code: "A1", adjusted: false });

    const job = (await a.post("/job-positions", { name: "Supervisor", gradeId: a2 }).expect(201)).body.id;
    const sari = (await hire("Sari A2", { jobId: job }).expect(201)).body;
    const s = (await a.get(`/contracts/${sari.contractId}`).expect(200)).body;
    expect(Number(s.wage)).toBe(6000000);
    expect(s.grade.code).toBe("A2");
  });

  it("gaji pokok tetap bisa diubah (ditandai disesuaikan); tanpa golongan wajib diisi", async () => {
    const dewi = (await hire("Dewi A1", { gradeId: a1 }, 5200000).expect(201)).body;
    const c = (await a.get(`/contracts/${dewi.contractId}`).expect(200)).body;
    expect(Number(c.wage)).toBe(5200000);
    expect(c.grade).toMatchObject({ adjusted: true, position: "within" });

    const none = await hire("Tanpa Golongan", {}).expect(400);
    expect(none.body.errors?.[0]?.path).toBe("contract.wage");
  });

  it("perubahan standar golongan diterapkan ke kontrak yang mengikuti standar", async () => {
    await a.patch(`/salary-grades/${a1}`, { baseWage: 5500000 }).expect(200);
    const impact = (await a.get(`/salary-grades/${a1}/base-wage-impact`).expect(200)).body;
    const status = Object.fromEntries(
      impact.items.map((i: { employeeName: string; status: string }) => [i.employeeName, i.status]),
    );
    expect(status).toEqual({ "Budi A1": "standard", "Dewi A1": "adjusted" });

    await a
      .post(`/salary-grades/${a1}/apply-base-wage`, { effectiveDate: "2026-01-01" })
      .expect(201)
      .then((r) => {
        expect(r.body.updated).toHaveLength(0);
        expect(r.body.skipped).toEqual(expect.arrayContaining([{ employeeName: "Budi A1", reason: "date" }]));
      });
    const applied = (
      await a.post(`/salary-grades/${a1}/apply-base-wage`, { effectiveDate: "2026-07-01" }).expect(201)
    ).body;
    expect(applied.updated.map((u: { employeeName: string }) => u.employeeName)).toEqual(["Budi A1"]);
    expect(applied.skipped).toEqual([{ employeeName: "Dewi A1", reason: "adjusted" }]);
    const renewed = (await a.get(`/contracts/${applied.updated[0].contractId}`).expect(200)).body;
    expect(renewed).toMatchObject({ state: "running", dateStart: "2026-07-01", gradeId: a1 });
    expect(Number(renewed.wage)).toBe(5500000);
    expect(renewed.grade.adjusted).toBe(false);

    // Kontrak yang disesuaikan manual ikut bila diminta; yang sudah sesuai standar tidak disentuh lagi.
    const again = (
      await a
        .post(`/salary-grades/${a1}/apply-base-wage`, { effectiveDate: "2026-08-01", includeAdjusted: true })
        .expect(201)
    ).body;
    expect(again.updated.map((u: { employeeName: string }) => u.employeeName)).toEqual(["Dewi A1"]);

    // Satu jalur perubahan upah: setiap penerapan tercatat sebagai SK "Penyesuaian upah" yang sudah diterapkan.
    const movements = (await a.get("/employee-movements").expect(200)).body as {
      employeeName: string;
      kind: string;
      state: string;
      newWage: string;
      contractId: string;
    }[];
    const budi = movements.find((m) => m.employeeName === "Budi A1");
    expect(budi).toMatchObject({
      kind: "wage_adjustment",
      state: "done",
      contractId: applied.updated[0].contractId,
    });
    expect(Number(budi!.newWage)).toBe(5500000);
  });

  it("upah kontrak berjalan tidak bisa diubah langsung; syarat lain tetap bisa", async () => {
    const budi = (await a.get("/employees?search=Budi A1").expect(200)).body.items[0];
    const contracts = (await a.get(`/contracts?employeeId=${budi.id}`).expect(200)).body.items;
    const running = contracts.find((c: { state: string }) => c.state === "running");
    const body = {
      employeeId: budi.id,
      contractType: running.contractType,
      dateStart: running.dateStart,
      wage: running.wage,
    };
    const res = await a.put(`/contracts/${running.id}`, { ...body, wage: "5600000" }).expect(400);
    expect(res.body.errors?.[0]?.path).toBe("wage");
    await a.put(`/contracts/${running.id}`, { ...body, note: "catatan baru" }).expect(200);
  });

  it("bila SK mutasi wajib disetujui, penerapan golongan membuat SK draft (tanpa duplikat)", async () => {
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, movementApproval: true }).expect(200);
    await a.patch(`/salary-grades/${a1}`, { baseWage: 5800000 }).expect(200);
    const r = (
      await a.post(`/salary-grades/${a1}/apply-base-wage`, { effectiveDate: "2026-10-01" }).expect(201)
    ).body;
    expect(r.updated).toHaveLength(0);
    expect(r.pending.map((p: { employeeName: string }) => p.employeeName)).toEqual(["Budi A1", "Dewi A1"]);
    const draft = (await a.get("/employee-movements?state=draft").expect(200)).body;
    expect(draft).toHaveLength(2);
    expect(draft[0]).toMatchObject({ kind: "wage_adjustment", effectiveDate: "2026-10-01" });
    // Kontrak belum berubah sampai SK disetujui & diterapkan.
    const impact = (await a.get(`/salary-grades/${a1}/base-wage-impact`).expect(200)).body;
    expect(impact.items.every((i: { wage: string }) => Number(i.wage) === 5500000)).toBe(true);
    await a.post(`/employee-movements/${draft[0].id}/apply`).expect(400);

    const again = (
      await a.post(`/salary-grades/${a1}/apply-base-wage`, { effectiveDate: "2026-10-01" }).expect(201)
    ).body;
    expect(again.pending).toHaveLength(0);
    expect(again.skipped.map((s: { reason: string }) => s.reason)).toEqual(["pending", "pending"]);
  });
});
