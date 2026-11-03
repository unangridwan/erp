import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/**
 * Tanggal masuk/keluar karyawan & tanggal kontrak selalu sejalan: kontrak tidak boleh di luar masa kerja; ubah
 * tanggal masuk → kontrak yang mulai di tanggal masuk lama ikut pindah; tanggal keluar → kontrak berjalan berakhir di
 * tanggal itu.
 */
describe.skipIf(!hasDb)("Tanggal karyawan & kontrak", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let emp: string;
  let contract: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "tglkontrak");
    emp = (await a.post("/employees", { name: "Nina Baru", joinDate: "2026-11-10" }).expect(201)).body.id;
  });
  afterAll(() => app?.close());

  const body = (extra: object) => ({ employeeId: emp, wage: "6000000", ...extra });

  it("kontrak tidak boleh mulai sebelum tanggal masuk", async () => {
    const res = await a.post("/contracts", body({ dateStart: "2026-11-01" })).expect(400);
    expect(res.body.errors?.[0]).toMatchObject({ path: "dateStart" });
    contract = (await a.post("/contracts", body({ dateStart: "2026-11-10" })).expect(201)).body.id;
  });

  it("tanggal masuk diubah → kontrak yang mulai di tanggal masuk lama ikut pindah", async () => {
    await a.patch(`/employees/${emp}`, { joinDate: "2026-11-17" }).expect(200);
    expect((await a.get(`/contracts/${contract}`).expect(200)).body.dateStart).toBe("2026-11-17");
    await a.post(`/contracts/${contract}/start`).expect(200);
    await a.patch(`/employees/${emp}`, { joinDate: "2026-11-20" }).expect(200);
    expect((await a.get(`/contracts/${contract}`).expect(200)).body).toMatchObject({
      dateStart: "2026-11-20",
      state: "running",
    });
  });

  it("tanggal keluar → kontrak berjalan berakhir di tanggal itu; kontrak melewati tanggal keluar ditolak", async () => {
    await a
      .post(`/employees/${emp}/offboard`, { resignDate: "2027-06-30", resignReason: "resign" })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect((await a.get(`/contracts/${contract}`).expect(200)).body.dateEnd).toBe("2027-06-30");
    const c = (await a.get(`/contracts/${contract}`).expect(200)).body;
    await a
      .put(`/contracts/${contract}`, {
        ...body({ dateStart: c.dateStart, dateEnd: "2027-12-31", contractType: "pkwt" }),
      })
      .expect(400);
    // Tanggal keluar dimajukan sebelum kontrak mulai → ditolak.
    const res = await a.patch(`/employees/${emp}`, { resignDate: "2026-11-15" }).expect(400);
    expect(res.body.errors?.[0]?.path).toBe("resignDate");
  });
});
