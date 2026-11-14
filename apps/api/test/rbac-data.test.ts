import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

/** RBAC tingkat data: melihat data karyawan & kontrak tanpa nominal gaji dan tanpa data pribadi sensitif. */
describe.skipIf(!hasDb)("RBAC: gaji & data pribadi sebagai hak tersendiri", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let companyId: string;
  let employeeId: string;
  let contractId: string;
  let n = 0;

  const userWith = async (permissions: string[]) => {
    n++;
    const role = (
      await a.post("/roles", { code: `data_${n}`, name: `Peran data ${n}`, permissions }).expect(201)
    ).body;
    const email = `data${n}@example.com`;
    await a
      .post("/users", {
        name: `Pengguna ${n}`,
        email,
        password: "rahasia123",
        roleIds: [role.id],
        companyIds: [companyId],
      })
      .expect(201);
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email, password: "rahasia123" })
        .expect(200)
    ).body.token as string;
    return client(app, token);
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "rbac-data");
    companyId = (await a.get("/auth/me")).body.activeCompanyId;
    employeeId = (
      await a
        .post("/employees", { name: "Sinta Dewi", joinDate: "2025-01-02", nik: "3273015506950002" })
        .expect(201)
    ).body.id;
    contractId = (
      await a.post("/contracts", { employeeId, wage: "8500000", dateStart: "2025-01-02" }).expect(201)
    ).body.id;
    await a.post(`/contracts/${contractId}/start`).expect(200);
    await a
      .put(`/contracts/${contractId}`, { employeeId, wage: "9000000", dateStart: "2025-01-02" })
      .expect(200);
  });
  afterAll(() => app?.close());

  it("staf SDM melihat karyawan & kontrak, tetapi nominal gaji dan NIK tersembunyi", async () => {
    const staff = await userWith(["hr.write", "company.read"]);

    const employee = (await staff.get(`/employees/${employeeId}`).expect(200)).body;
    expect(employee.name).toBe("Sinta Dewi");
    expect(employee.nik).toMatch(/0002$/);
    expect(employee.nik).not.toBe("3273015506950002");

    const overview = (await staff.get(`/employees/${employeeId}/overview`).expect(200)).body;
    expect(overview.contract).toMatchObject({ id: contractId, dateStart: "2025-01-02", salaryHidden: true });
    expect(overview.contract.wage).toBeNull();
    expect(overview.contract.fixedAllowance).toBeNull();
    expect(overview.contract.components).toEqual([]);

    const list = (await staff.get(`/contracts?employeeId=${employeeId}`).expect(200)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: contractId, wage: null, salaryHidden: true });
    const contract = (await staff.get(`/contracts/${contractId}`).expect(200)).body;
    expect(contract).toMatchObject({ state: "running", wage: null, body: null, salaryHidden: true });
    expect(contract.allowances).toEqual([]);

    // Mengubah kontrak & dokumen bergaji tetap butuh hak kelola.
    await staff
      .put(`/contracts/${contractId}`, { employeeId, wage: "1", dateStart: "2025-01-02" })
      .expect(403);
    await staff.get(`/contracts/${contractId}/pdf`).expect(403);
    await staff.get("/hr/wage-scale").expect(403);

    // Riwayat karyawan tidak menyebut nominal.
    const log = JSON.stringify((await staff.get(`/activity/employee/${employeeId}`).expect(200)).body);
    expect(log).not.toContain("9000000");
    expect(log).not.toContain("8500000");
  });

  it("hak gaji dan hak data pribadi bisa diberikan terpisah", async () => {
    const withSalary = await userWith(["hr.read", "hr.salary.read", "company.read"]);
    const overview = (await withSalary.get(`/employees/${employeeId}/overview`).expect(200)).body;
    expect(Number(overview.contract.wage)).toBe(9000000);
    expect(overview.contract.salaryHidden).toBeUndefined();
    expect(Number((await withSalary.get(`/contracts/${contractId}`).expect(200)).body.wage)).toBe(9000000);
    expect((await withSalary.get(`/employees/${employeeId}`).expect(200)).body.nik).not.toBe(
      "3273015506950002",
    );

    const withPersonal = await userWith(["hr.read", "hr.personal.read", "company.read"]);
    expect((await withPersonal.get(`/employees/${employeeId}`).expect(200)).body.nik).toBe(
      "3273015506950002",
    );
    expect((await withPersonal.get(`/contracts/${contractId}`).expect(200)).body.wage).toBeNull();
  });

  it("Payroll dan pengelola SDM tetap melihat gaji; admin melihat semuanya", async () => {
    const payroll = await userWith(["payroll.read", "hr.read", "company.read"]);
    expect(Number((await payroll.get(`/contracts/${contractId}`).expect(200)).body.wage)).toBe(9000000);

    const manager = await userWith(["hr.manage", "company.read"]);
    const contract = (await manager.get(`/contracts/${contractId}`).expect(200)).body;
    expect(Number(contract.wage)).toBe(9000000);
    expect((await manager.get(`/employees/${employeeId}`).expect(200)).body.nik).toBe("3273015506950002");

    expect(Number((await a.get(`/contracts/${contractId}`).expect(200)).body.wage)).toBe(9000000);
    const me = (await manager.get("/auth/me").expect(200)).body.permissions as string[];
    expect(me).toEqual(expect.arrayContaining(["hr.salary.read", "hr.personal.read"]));
  });
});
