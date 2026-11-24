import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday, elapsedShare, paceStatus } from "@erp/shared";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = businessToday();
const year = Number(today.slice(0, 4));
const periodFrom = `${year}-01-01`;
const periodTo = `${year}-12-31`;

interface Goal {
  id: string;
  parentId: string | null;
  title: string;
  employeeId: string | null;
  departmentId: string | null;
  targetValue: number;
  currentValue: number;
  progress: number;
  expected: number;
  rag: string;
  kpi: { code: string } | null;
  owner: { kind: string; name: string };
}

describe.skipIf(!hasDb)("Target berjenjang & scorecard", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let sari: ReturnType<typeof client>;
  const dept: Record<string, string> = {};
  const emp: Record<string, string> = {};
  let companyGoal = "";

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "score");
    const me = (await a.get("/auth/me")).body;
    const role = (
      await a
        .post("/roles", { code: "penjual", name: "Penjual", permissions: ["sales.read", "sales.write"] })
        .expect(201)
    ).body.id;
    const user = async (name: string, email: string) =>
      (
        await a
          .post("/users", {
            name,
            email,
            password: "rahasia123",
            roleIds: [role],
            companyIds: [me.activeCompanyId],
          })
          .expect(201)
      ).body.id as string;
    const sariUser = await user("Sari Penjual", "sari@example.com");
    const budiUser = await user("Budi Penjual", "budi@example.com");
    sari = client(
      app,
      (
        await request(app.getHttpServer())
          .post("/auth/login")
          .send({ tenantSlug: a.slug, email: "sari@example.com", password: "rahasia123" })
          .expect(200)
      ).body.token,
    );
    dept.sales = (await a.post("/departments", { name: "Penjualan" }).expect(201)).body.id;
    dept.wh = (await a.post("/departments", { name: "Gudang" }).expect(201)).body.id;
    for (const [key, name, userId] of [
      ["sari", "Sari Penjual", sariUser],
      ["budi", "Budi Penjual", budiUser],
    ] as const)
      emp[key] = (
        await a
          .post("/employees", { name, userId, departmentId: dept.sales, joinDate: "2024-01-01" })
          .expect(201)
      ).body.id;

    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    const product = (
      await a
        .post("/products", { sku: "JS", productType: "service", name: "Jasa", uomId: uom, salePrice: "1" })
        .expect(201)
    ).body.id;
    const customer = (await a.post("/partners", { name: "PT Pelanggan", isCustomer: true }).expect(201)).body
      .id;
    const so = async (userId: string, dateOrder: string, price: number) => {
      const id = (
        await a
          .post("/sale-orders", {
            partnerId: customer,
            dateOrder,
            userId,
            lines: [{ productId: product, quantity: 1, priceUnit: price }],
          })
          .expect(201)
      ).body.id as string;
      await a.post(`/sale-orders/${id}/confirm`).expect(200);
    };
    // Tahun ini: Sari 1 jt, Budi 3 jt. Tahun lalu (dasar proporsional): Sari 100 rb, Budi 300 rb.
    await so(sariUser, periodFrom, 1_000_000);
    await so(budiUser, periodFrom, 3_000_000);
    await so(sariUser, `${year - 1}-06-01`, 100_000);
    await so(budiUser, `${year - 1}-06-01`, 300_000);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("sasaran KPI otomatis: validasi, nilai berjalan dari data, dan status laju", async () => {
    await a.post("/goals", { title: "Tanpa periode", kpiCode: "sales.revenue", targetValue: 10 }).expect(400);
    await a
      .post("/goals", { title: "KPI salah", kpiCode: "nope", periodFrom, periodTo, targetValue: 10 })
      .expect(400);
    const created = (
      await a
        .post("/goals", {
          title: "Omzet tahunan",
          kpiCode: "sales.revenue",
          periodFrom,
          periodTo,
          targetValue: 8_000_000,
        })
        .expect(201)
    ).body;
    companyGoal = created.id;
    expect(created).toMatchObject({ metric: "currency", kpiCode: "sales.revenue" });

    const kpis = (await a.get("/goals/kpis").expect(200)).body;
    expect(kpis.find((k: { code: string }) => k.code === "sales.revenue")).toMatchObject({ readable: true });

    const sc = (await a.get("/scorecard").expect(200)).body;
    const g = (sc.goals as Goal[]).find((x) => x.id === companyGoal)!;
    const pace = paceStatus(50, elapsedShare(periodFrom, periodTo, today));
    expect(g).toMatchObject({
      currentValue: 4_000_000,
      progress: 50,
      rag: pace.rag,
      expected: pace.expected,
    });
    expect(sc.achievement).toBe(50);
    expect(sc.kpis.find((k: { code: string }) => k.code === "sales.revenue")).toMatchObject({
      value: 4_000_000,
      previous: 400_000,
    });
    expect(sc.flow.processes.map((p: { process: string }) => p.process)).toContain("o2c");

    // Daftar sasaran (halaman Sasaran) ikut menampilkan status laju & label KPI.
    const list = (await a.get("/goals").expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === companyGoal)).toMatchObject({
      rag: pace.rag,
      kpi: ["Omzet pesanan", "Order revenue"],
    });
  });

  it("turunkan target: ke departemen (rata) lalu ke karyawan (proporsional tahun lalu)", async () => {
    await sari.post(`/goals/${companyGoal}/cascade`, { to: "departments" }).expect(403);
    expect((await a.post(`/goals/${companyGoal}/cascade`, { to: "departments" }).expect(201)).body).toEqual({
      created: 2,
      skipped: 0,
    });
    // Mengulang: turunan yang sudah ada dilewati.
    expect((await a.post(`/goals/${companyGoal}/cascade`, { to: "departments" }).expect(201)).body).toEqual({
      created: 0,
      skipped: 2,
    });
    await a.post(`/goals/${companyGoal}/cascade`, { to: "employees" }).expect(400);

    const sc = (await a.get("/scorecard").expect(200)).body;
    const kids = (sc.goals as Goal[]).filter((g) => g.parentId === companyGoal);
    const sales = kids.find((g) => g.departmentId === dept.sales)!;
    const wh = kids.find((g) => g.departmentId === dept.wh)!;
    expect(sales).toMatchObject({ targetValue: 4_000_000, currentValue: 4_000_000, progress: 100 });
    expect(wh).toMatchObject({ targetValue: 4_000_000, currentValue: 0, progress: 0 });

    expect(
      (
        await a
          .post(`/goals/${sales.id}/cascade`, {
            to: "employees",
            departmentId: dept.sales,
            split: "proportional",
          })
          .expect(201)
      ).body,
    ).toEqual({ created: 2, skipped: 0 });
    const dep = (await a.get(`/scorecard?scope=department&id=${dept.sales}`).expect(200)).body;
    expect(dep.title).toBe("Penjualan");
    const people = (dep.goals as Goal[]).filter((g) => g.employeeId);
    expect(
      Object.fromEntries(people.map((g) => [g.employeeId, [g.targetValue, g.currentValue, g.progress]])),
    ).toEqual({
      [emp.sari!]: [1_000_000, 1_000_000, 100],
      [emp.budi!]: [3_000_000, 3_000_000, 100],
    });
    expect(dep.kpis.find((k: { code: string }) => k.code === "sales.revenue")).toMatchObject({
      value: 4_000_000,
    });
    expect(dep.flow).toHaveProperty("waiting");
  });

  it("scorecard departemen berdampingan, scorecard saya, dan visibilitas sasaran karyawan", async () => {
    const rows = (await a.get("/scorecard/departments").expect(200)).body.items as {
      id: string;
      members: number;
      goals: number;
      achievement: number | null;
    }[];
    expect(rows.find((r) => r.id === dept.sales)).toMatchObject({ members: 2, goals: 1, achievement: 100 });
    expect(rows.find((r) => r.id === dept.wh)).toMatchObject({ members: 0, goals: 1, achievement: 0 });

    const mine = (await sari.get("/scorecard?scope=me").expect(200)).body;
    expect(mine.title).toBe("Sari Penjual");
    expect((mine.goals as Goal[]).map((g) => [g.employeeId, g.currentValue])).toEqual([
      [emp.sari, 1_000_000],
    ]);
    expect(mine.flow).toHaveProperty("held");

    // Tanpa hak SDM: sasaran perusahaan & departemen terlihat, sasaran karyawan lain tidak.
    const company = (await sari.get("/scorecard").expect(200)).body.goals as Goal[];
    expect(company.some((g) => g.id === companyGoal)).toBe(true);
    expect(company.some((g) => g.employeeId)).toBe(false);
    const department = (await sari.get(`/scorecard?scope=department&id=${dept.sales}`).expect(200)).body
      .goals as Goal[];
    expect(department.filter((g) => g.employeeId).map((g) => g.employeeId)).toEqual([emp.sari]);

    // Sasaran manual yang tenggatnya sudah lewat sebelum periode tidak ikut.
    const old = (
      await a
        .post("/goals", { title: "Sasaran lama", targetValue: 10, dueDate: `${year - 1}-12-31` })
        .expect(201)
    ).body.id;
    expect(((await a.get("/scorecard").expect(200)).body.goals as Goal[]).some((g) => g.id === old)).toBe(
      false,
    );
    // Admin tanpa data karyawan: cakupan "saya" kosong, bukan galat.
    expect((await a.get("/scorecard?scope=me").expect(200)).body).toMatchObject({ linked: false, goals: [] });

    await a.get("/scorecard?scope=department").expect(400);
    await a.get("/scorecard?scope=department&id=00000000-0000-4000-8000-000000000000").expect(404);
    await a.get(`/scorecard?from=${year}-12-31&to=${year}-01-01`).expect(400);
  });
});
