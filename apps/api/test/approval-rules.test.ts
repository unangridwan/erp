import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

const today = () => new Date().toISOString().slice(0, 10);
/** Senin ≥ 5 minggu dari sekarang (+ offset hari). */
const monday = (weeks: number, offset = 0) => {
  const d = new Date(Date.now() + weeks * 7 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7) + offset);
  return d.toISOString().slice(0, 10);
};

/** Aturan persetujuan & batas wewenang: PO, cuti bertingkat, penyetuju peran, batas per kategori. */
describe.skipIf(!hasDb)("Aturan persetujuan & batas wewenang", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  let companyId: string;
  type Api = ReturnType<typeof client>;
  const roles: Record<string, string> = {};
  const users: Record<string, { id: string; api: Api }> = {};
  let vendor: string;
  let product: string;

  const login = async (email: string) => {
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email, password: "rahasia123" })
        .expect(200)
    ).body.token as string;
    return client(app, token);
  };
  const po = async (api: Api, amount: number) => {
    const order = (
      await api
        .post("/purchase-orders", {
          partnerId: vendor,
          dateOrder: today(),
          lines: [{ productId: product, quantity: "1", priceUnit: String(amount), taxIds: [] }],
        })
        .expect(201)
    ).body;
    return (await api.post(`/purchase-orders/${order.id}/confirm`).expect(200)).body;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "apr");
    companyId = (await a.get("/auth/me")).body.activeCompanyId;
    const role = async (code: string, name: string, permissions: string[]) =>
      (roles[code] = (await a.post("/roles", { code, name, permissions }).expect(201)).body.id);
    const base = ["purchase.write", "partner.read", "product.read", "company.read"];
    await role("buyer", "Pembeli", base);
    await role("purch_mgr", "Manajer Pembelian", [...base, "purchase.approve"]);
    await role("director", "Direktur", ["purchase.read", "company.read"]);
    await role("staff", "Karyawan", []);
    for (const [key, name, roleCode] of [
      ["budi", "Budi Pembeli", "buyer"],
      ["maya", "Maya Manajer", "purch_mgr"],
      ["dodi", "Dodi Direktur", "director"],
      ["dimas", "Dimas Direktur 2", "director"],
      ["sari", "Sari Staf", "staff"],
      ["mira", "Mira Atasan", "staff"],
      ["hadi", "Hadi Kepala", "staff"],
    ] as const) {
      const id = (
        await a
          .post("/users", {
            name,
            email: `${key}@example.com`,
            password: "rahasia123",
            roleIds: [roles[roleCode]],
            companyIds: [companyId],
          })
          .expect(201)
      ).body.id as string;
      users[key] = { id, api: await login(`${key}@example.com`) };
    }
    vendor = (await a.post("/partners", { name: "PT Pemasok", isSupplier: true }).expect(201)).body.id;
    const uom = (await a.get("/uoms?q=Pcs").expect(200)).body.items[0].id;
    product = (
      await a
        .post("/products", { sku: "KRT", name: "Kertas", uomId: uom, productType: "consumable" })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app?.close());

  it("batas wewenang PO: pengguna > peran > default; penyetuju dengan batas kurang ditolak", async () => {
    await users.budi!.api.put("/approval-limits/purchase_order", { limits: [] }).expect(403);
    await a
      .put("/approval-limits/purchase_order", {
        limits: [
          { maxAmount: "1000000", note: "Default" },
          { roleId: roles.buyer, maxAmount: "5000000" },
          { roleId: roles.purch_mgr, maxAmount: "50000000" },
          { userId: users.maya!.id, maxAmount: "20000000" },
        ],
      })
      .expect(200);
    await a
      .put("/approval-limits/purchase_order", {
        limits: [
          { roleId: roles.buyer, maxAmount: 1 },
          { roleId: roles.buyer, maxAmount: 2 },
        ],
      })
      .expect(400);
    const limits = (await a.get("/approval-limits?docType=purchase_order").expect(200)).body;
    expect(limits).toHaveLength(4);
    expect(limits.find((l: { userId: string }) => l.userId === users.maya!.id).userName).toBe("Maya Manajer");

    expect((await po(users.budi!.api, 3_000_000)).state).toBe("purchase");
    const mid = await po(users.budi!.api, 8_000_000);
    expect(mid).toMatchObject({ state: "to_approve", approvalLevels: 0 });
    await users.budi!.api.post(`/purchase-orders/${mid.id}/approve`).expect(403);
    expect((await users.maya!.api.post(`/purchase-orders/${mid.id}/approve`).expect(200)).body.state).toBe(
      "purchase",
    );
    const big = await po(users.budi!.api, 30_000_000);
    const res = await users.maya!.api.post(`/purchase-orders/${big.id}/approve`).expect(403);
    expect(res.body.message).toContain("batas wewenang");
    expect((await a.post(`/purchase-orders/${big.id}/approve`).expect(200)).body.state).toBe("purchase");
    // Batas pengguna menimpa peran: Maya (peran 50 jt) tetap 20 jt, tanpa persetujuan sampai 20 jt.
    expect((await po(users.maya!.api, 15_000_000)).state).toBe("purchase");
    expect((await po(users.maya!.api, 25_000_000)).state).toBe("to_approve");

    const summary = (await a.get(`/users/${users.maya!.id}/approvals`).expect(200)).body;
    expect(summary.limits).toEqual([
      expect.objectContaining({ docType: "purchase_order", effective: 20_000_000, source: "user" }),
    ]);
  });

  it("aturan PO bertingkat menurut nominal dengan penyetuju peran; simulasi", async () => {
    await a
      .put("/approval-rules/purchase_order", {
        steps: [
          { approverType: "role", roleId: roles.purch_mgr, label: "Manajer Pembelian" },
          { approverType: "role", roleId: roles.director, minValue: "50000000", label: "Direktur" },
        ],
      })
      .expect(200);
    await a.put("/approval-rules/purchase_order", { steps: [{ approverType: "role" }] }).expect(400);

    const sim = (
      await a
        .post("/approval-rules/simulate", {
          docType: "purchase_order",
          value: 75_000_000,
          userId: users.budi!.id,
        })
        .expect(200)
    ).body;
    expect(sim.rules).toBe(true);
    expect(sim.steps.map((s: { label: string }) => s.label)).toEqual(["Manajer Pembelian", "Direktur"]);
    expect(sim.steps[1].holders.sort()).toEqual(["Dimas Direktur 2", "Dodi Direktur"]);
    expect(sim.requesterLimit).toBe(5_000_000);

    const small = await po(users.budi!.api, 10_000_000);
    expect(small).toMatchObject({ state: "to_approve", approvalLevels: 1 });
    expect(small.approval.steps).toEqual([
      expect.objectContaining({ step: 1, label: "Manajer Pembelian", approver: "Peran Manajer Pembelian" }),
    ]);
    await users.dodi!.api.post(`/purchase-orders/${small.id}/approve`).expect(403);
    const notes = (await users.maya!.api.get("/me/notifications").expect(200)).body as { title: string }[];
    expect(notes.some((n) => n.title.includes(small.name))).toBe(true);
    expect((await users.maya!.api.post(`/purchase-orders/${small.id}/approve`).expect(200)).body.state).toBe(
      "purchase",
    );

    const large = await po(users.budi!.api, 60_000_000);
    expect(large).toMatchObject({ state: "to_approve", approvalLevels: 2 });
    // Tahap 1 bukan tahap akhir: batas Maya (20 jt) tidak menghalangi.
    const step2 = (await users.maya!.api.post(`/purchase-orders/${large.id}/approve`).expect(200)).body;
    expect(step2).toMatchObject({ state: "to_approve", approvalStep: 2 });
    expect(step2.approval.canApprove).toBe(false);
    await users.maya!.api.post(`/purchase-orders/${large.id}/approve`).expect(403);
    expect(
      (await users.dimas!.api.get(`/purchase-orders/${large.id}`).expect(200)).body.approval.canApprove,
    ).toBe(true);
    expect((await users.dimas!.api.post(`/purchase-orders/${large.id}/approve`).expect(200)).body.state).toBe(
      "purchase",
    );

    const role = (await a.get(`/roles/${roles.director}/approvals`).expect(200)).body;
    expect(role.rules).toEqual([expect.objectContaining({ docType: "purchase_order", label: "Direktur" })]);
    await a.put("/approval-rules/purchase_order", { steps: [] }).expect(200);
    expect(
      (await a.post("/approval-rules/simulate", { docType: "purchase_order", value: 1 })).body.rules,
    ).toBe(false);
  });

  it("cuti: atasan selalu, kepala departemen bila ≥ 3 hari; tanpa aturan = perilaku lama", async () => {
    const hadiEmp = (
      await a.post("/employees", { name: "Hadi", userId: users.hadi!.id, joinDate: "2020-01-01" }).expect(201)
    ).body.id;
    const dept = (await a.post("/departments", { name: "Keuangan", managerId: hadiEmp }).expect(201)).body.id;
    const miraEmp = (
      await a
        .post("/employees", {
          name: "Mira",
          userId: users.mira!.id,
          departmentId: dept,
          joinDate: "2021-01-01",
        })
        .expect(201)
    ).body.id;
    const sariEmp = (
      await a
        .post("/employees", {
          name: "Sari",
          userId: users.sari!.id,
          departmentId: dept,
          managerId: miraEmp,
          joinDate: "2024-01-01",
        })
        .expect(201)
    ).body.id;
    const annual = (await a.get("/leave-types").expect(200)).body.items.find(
      (t: { name: string }) => t.name === "Cuti tahunan",
    ).id;
    await a
      .post("/leave-allocations", {
        employeeId: sariEmp,
        leaveTypeId: annual,
        days: "20",
        dateFrom: `${today().slice(0, 4)}-01-01`,
        dateTo: `${Number(today().slice(0, 4)) + 1}-12-31`,
      })
      .expect(201);
    const leave = async (from: string, to: string) =>
      (await users.sari!.api.post("/leaves", { leaveTypeId: annual, dateFrom: from, dateTo: to }).expect(201))
        .body;

    // Tanpa aturan: 1 tahap (pengaturan payroll), atasan langsung.
    const before = await leave(monday(5), monday(5));
    expect(before.approvalLevels).toBe(1);
    await users.mira!.api.post(`/leaves/${before.id}/approve`).expect(200);

    await a
      .put("/approval-rules/leave_request", {
        steps: [
          { approverType: "manager" },
          { approverType: "department_head", minValue: "3", label: "Kepala departemen" },
        ],
      })
      .expect(200);
    const short = await leave(monday(6), monday(6));
    expect(short).toMatchObject({ state: "confirm", approvalLevels: 1 });
    await users.hadi!.api.post(`/leaves/${short.id}/approve`).expect(403);
    expect((await users.mira!.api.post(`/leaves/${short.id}/approve`).expect(200)).body.state).toBe(
      "approved",
    );

    const long = await leave(monday(7), monday(7, 2));
    expect(long).toMatchObject({ state: "confirm", approvalLevels: 2 });
    expect((await users.mira!.api.post(`/leaves/${long.id}/approve`).expect(200)).body.state).toBe("confirm");
    const pending = (await users.hadi!.api.get("/approvals/pending").expect(200)).body;
    expect(pending).toEqual(
      expect.arrayContaining([expect.objectContaining({ model: "leave_request", id: long.id, mine: true })]),
    );
    expect((await a.get(`/approvals/leave_request/${long.id}`).expect(200)).body.waitingFor).toBe(
      "Kepala departemen (Hadi Kepala)",
    );
    expect((await users.hadi!.api.post(`/leaves/${long.id}/approve`).expect(200)).body.state).toBe(
      "approved",
    );
    await a.put("/approval-rules/leave_request", { steps: [] }).expect(200);
  });

  it("permintaan generik: penyetuju peran + batas wewenang per kategori", async () => {
    const umum = (await a.get("/approval-categories?active=1").expect(200)).body.find(
      (c: { code: string }) => c.code === "UMUM",
    );
    await a
      .put(`/approval-categories/${umum.id}`, {
        ...umum,
        managerFirst: false,
        approvers: [{ roleId: roles.director, label: "Direksi" }],
      })
      .expect(200);
    await a
      .put(`/approval-categories/${umum.id}`, {
        ...umum,
        approvers: [{ roleId: roles.director, userId: users.dodi!.id }],
      })
      .expect(400);
    await a
      .put("/approval-limits/approval_request", {
        limits: [{ roleId: roles.director, categoryId: umum.id, maxAmount: "1000000" }],
      })
      .expect(200);
    const r = (
      await users
        .sari!.api.post("/approval-requests", {
          categoryId: umum.id,
          subject: "Beli kursi",
          amount: "2000000",
          description: "Rusak",
        })
        .expect(201)
    ).body;
    const submitted = (await users.sari!.api.post(`/approval-requests/${r.id}/submit`).expect(200)).body;
    expect(submitted.steps).toEqual([
      expect.objectContaining({ approverRoleId: roles.director, approverName: "Direktur", label: "Direksi" }),
    ]);
    expect((await users.dimas!.api.get("/approval-requests?review=1").expect(200)).body).toHaveLength(1);
    await users.mira!.api.post(`/approval-requests/${r.id}/approve`).expect(403);
    const over = await users.dodi!.api.post(`/approval-requests/${r.id}/approve`).expect(403);
    expect(over.body.message).toContain("batas wewenang");
    await a
      .put("/approval-limits/approval_request", {
        limits: [{ roleId: roles.director, categoryId: umum.id, maxAmount: "5000000" }],
      })
      .expect(200);
    expect((await users.dodi!.api.post(`/approval-requests/${r.id}/approve`).expect(200)).body.state).toBe(
      "approved",
    );
    const role = (await a.get(`/roles/${roles.director}/approvals`).expect(200)).body;
    expect(role.categories).toEqual([expect.objectContaining({ categoryName: umum.name, label: "Direksi" })]);
  });
});
