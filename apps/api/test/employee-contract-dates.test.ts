import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/**
 * Tanggal masuk & keluar hanya diinput di kontrak kerja: tanggal masuk = tanggal mulai kontrak pertama, tanggal keluar =
 * kontrak diakhiri dengan alasan keluar. Data karyawan tidak bisa mengubah keduanya.
 */
describe.skipIf(!hasDb)("Tanggal masuk & keluar dari kontrak", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let emp: string;
  let contract: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "tglkontrak");
    const created = (
      await a
        .post("/employees", {
          name: "Nina Baru",
          joinDate: "2020-01-01",
          contract: { dateStart: "2026-11-10", contractType: "pkwtt", wage: 6000000 },
        })
        .expect(201)
    ).body;
    emp = created.id;
    contract = created.contractId;
  });
  afterAll(() => app?.close());

  const employee = async () => (await a.get(`/employees/${emp}`).expect(200)).body;
  const contractBody = async (extra: object = {}) => {
    const c = (await a.get(`/contracts/${contract}`).expect(200)).body;
    return {
      employeeId: emp,
      contractType: c.contractType,
      dateStart: c.dateStart,
      dateEnd: c.dateEnd,
      wage: c.wage,
      ...extra,
    };
  };

  it("karyawan baru: tanggal masuk = tanggal mulai kontrak (joinDate di data karyawan diabaikan)", async () => {
    expect((await employee()).joinDate).toBe("2026-11-10");
    const c = (await a.get(`/contracts/${contract}`).expect(200)).body;
    expect(c).toMatchObject({ dateStart: "2026-11-10", state: "running", isFirst: true });
    expect(c.employee).toMatchObject({ joinDate: "2026-11-10", resignDate: null });
  });

  it("data karyawan tidak bisa mengubah tanggal masuk/keluar; nilai sama diabaikan", async () => {
    const join = await a.patch(`/employees/${emp}`, { joinDate: "2026-11-17" }).expect(400);
    expect(join.body.errors?.[0]?.path).toBe("joinDate");
    const resign = await a.patch(`/employees/${emp}`, { resignDate: "2027-01-31" }).expect(400);
    expect(resign.body.errors?.[0]?.path).toBe("resignDate");
    await a.patch(`/employees/${emp}`, { joinDate: "2026-11-10", workPhone: "0221234" }).expect(200);
  });

  it("tanggal mulai kontrak pertama diubah → tanggal masuk ikut", async () => {
    await a.put(`/contracts/${contract}`, await contractBody({ dateStart: "2026-11-17" })).expect(200);
    expect((await employee()).joinDate).toBe("2026-11-17");
    const { history } = (await a.get(`/employees/${emp}/history`).expect(200)).body as {
      history: { kind: string; newValue: string | null }[];
    };
    expect(history.some((h) => h.kind === "join" && h.newValue === "2026-11-17")).toBe(true);
  });

  it("akhiri kontrak dengan karyawan keluar → tanggal & alasan keluar terisi", async () => {
    const noReason = await a
      .post(`/contracts/${contract}/close`, { dateEnd: "2027-06-30", exit: true })
      .expect(400);
    expect(noReason.body.errors?.[0]?.path).toBe("resignReason");
    const closed = (
      await a
        .post(`/contracts/${contract}/close`, {
          dateEnd: "2027-06-30",
          exit: true,
          resignReason: "resign",
          resignNote: "pindah kota",
        })
        .expect(200)
    ).body;
    expect(closed).toMatchObject({ state: "closed", dateEnd: "2027-06-30", endReason: "resign" });
    expect(await employee()).toMatchObject({
      resignDate: "2027-06-30",
      resignReason: "resign",
      resignNote: "pindah kota",
    });
    // Kontrak baru setelah tanggal keluar ditolak.
    await a.post("/contracts", { employeeId: emp, wage: "6000000", dateStart: "2027-07-01" }).expect(400);
  });

  it("tanggal keluar diperbaiki lewat kontrak; batal keluar mengembalikan kontrak berjalan", async () => {
    await a
      .post(`/contracts/${contract}/close`, {
        dateEnd: "2027-05-31",
        exit: true,
        resignReason: "termination",
      })
      .expect(200);
    expect(await employee()).toMatchObject({ resignDate: "2027-05-31", resignReason: "termination" });
    const back = (await a.post(`/contracts/${contract}/cancel-exit`).expect(200)).body;
    expect(back).toMatchObject({ state: "running", dateEnd: null, endReason: null });
    // PKWT: tanggal berakhir semula dipulihkan saat keluar dibatalkan.
    const pkwt = (
      await a
        .post("/employees", {
          name: "Pandu PKWT",
          contract: { dateStart: "2026-11-01", contractType: "pkwt", dateEnd: "2027-10-31", wage: 5000000 },
        })
        .expect(201)
    ).body;
    await a
      .post(`/contracts/${pkwt.contractId}/close`, {
        dateEnd: "2027-02-28",
        exit: true,
        resignReason: "resign",
      })
      .expect(200);
    expect((await a.post(`/contracts/${pkwt.contractId}/cancel-exit`).expect(200)).body).toMatchObject({
      state: "running",
      dateEnd: "2027-10-31",
    });
    expect(await employee()).toMatchObject({ resignDate: null, resignReason: null });
  });

  it("offboarding memakai kontrak berjalan", async () => {
    const res = await a
      .post(`/employees/${emp}/offboard`, { resignDate: "2027-03-31", resignReason: "retirement" })
      .expect((r) => expect([200, 201]).toContain(r.status));
    expect(res.body.contractId).toBe(contract);
    expect((await a.get(`/contracts/${contract}`).expect(200)).body).toMatchObject({
      state: "closed",
      dateEnd: "2027-03-31",
      endReason: "retirement",
    });
    expect((await employee()).resignDate).toBe("2027-03-31");
  });

  it("kontrak yang mulai sebelum tanggal masuk memajukan tanggal masuk; menambah karyawan butuh hak kontrak", async () => {
    const other = (
      await a
        .post("/employees", {
          name: "Oki Lama",
          contract: { dateStart: "2025-03-01", contractType: "pkwtt", wage: 5000000 },
        })
        .expect(201)
    ).body;
    const draft = (
      await a
        .post("/contracts", { employeeId: other.id, wage: "4000000", dateStart: "2024-01-02" })
        .expect(201)
    ).body;
    expect((await a.get(`/employees/${other.id}`).expect(200)).body.joinDate).toBe("2024-01-02");
    expect((await a.get(`/contracts/${draft.id}`).expect(200)).body.isFirst).toBe(true);
    await a.delete(`/contracts/${draft.id}`).expect(204);
    expect((await a.get(`/employees/${other.id}`).expect(200)).body.joinDate).toBe("2025-03-01");

    // Pengguna tanpa hak kelola kontrak (hr.manage) tidak bisa menambah karyawan.
    const me = (await a.get("/auth/me").expect(200)).body;
    const role = (
      await a
        .post("/roles", { code: "staf_hr", name: "Staf HR", permissions: ["hr.read", "hr.write"] })
        .expect(201)
    ).body;
    await a
      .post("/users", {
        name: "Staf",
        email: "staf@example.com",
        password: "rahasia123",
        roleIds: [role.id],
        companyIds: [me.activeCompanyId],
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ tenantSlug: a.slug, email: "staf@example.com", password: "rahasia123" })
      .expect(200);
    const staff = client(app, login.body.token);
    await staff
      .post("/employees", {
        name: "X",
        contract: { dateStart: "2026-11-10", contractType: "pkwtt", wage: 1 },
      })
      .expect(403);
  });
});
