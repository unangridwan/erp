import type { INestApplication } from "@nestjs/common";
import { eq, schema } from "@erp/db";
import { workingDays } from "@erp/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface Line {
  accountId: string;
  debit: string;
  credit: string;
}
interface SlipLine {
  code: string;
  category: string;
  amount: string;
}

describe.skipIf(!hasDb)("Fase 4: SDM & payroll", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let tenantId: string;
  let companyId: string;
  const acc: Record<string, string> = {};
  const comp: Record<string, string> = {};
  const leaveType: Record<string, string> = {};
  let rina: string; // karyawan dengan akun login
  let rinaApi: Api;
  let staffApi: Api;
  let octRun: string;
  let rinaSlip: string;

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
  const role = async (code: string, permissions: string[]) => {
    const db = app.get(TenantDb);
    const [r] = await db.runAs(tenantId, (tx) =>
      tx.insert(schema.roles).values({ code, name: code }).returning({ id: schema.roles.id }),
    );
    if (permissions.length)
      await db.runAs(tenantId, (tx) =>
        tx
          .insert(schema.rolePermissions)
          .values(permissions.map((permission) => ({ roleId: r!.id, permission }))),
      );
    return r!.id;
  };
  const user = async (name: string, email: string, roleIds: string[]) =>
    (
      await a
        .post("/users", { name, email, password: "rahasia123", roleIds, companyIds: [companyId] })
        .expect(201)
    ).body.id as string;
  const contract = async (employeeId: string, wage: string, dateStart: string, allowances: object[] = []) => {
    const c = (await a.post("/contracts", { employeeId, wage, dateStart, allowances }).expect(201)).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    return c.id as string;
  };
  const codeOf = (id: string) => Object.entries(acc).find(([, v]) => v === id)?.[0];
  const entry = async (moveId: string) =>
    ((await a.get(`/moves/${moveId}`).expect(200)).body.lines as Line[])
      .map((l) => [codeOf(l.accountId), l.debit, l.credit])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])));

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "hr");
    const me = (await a.get("/auth/me")).body;
    tenantId = me.tenantId;
    companyId = me.activeCompanyId;
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    for (const c of (await a.get("/salary-components").expect(200)).body.items) comp[c.code] = c.id;
    for (const t of (await a.get("/leave-types").expect(200)).body.items) leaveType[t.name] = t.id;
  });

  afterAll(() => app?.close());

  it("signup menyiapkan pengaturan payroll, komponen gaji, dan jenis cuti", async () => {
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    expect(settings).toMatchObject({
      jkkRate: "0.24",
      salaryExpenseAccountId: acc["6-1000"],
      bpjsExpenseAccountId: acc["6-1100"],
      salaryPayableAccountId: acc["2-1500"],
      pph21PayableAccountId: acc["2-1300"],
      bpjsPayableAccountId: acc["2-1400"],
    });
    expect(Object.keys(comp)).toEqual(expect.arrayContaining(["TJAB", "TRANS", "THR", "PINJ"]));
    expect(Object.keys(leaveType)).toEqual(expect.arrayContaining(["Cuti tahunan", "Izin tanpa upah"]));
  });

  describe("karyawan & data sensitif", () => {
    it("NIK, NPWP, dan rekening disimpan terenkripsi; tersamar tanpa hr.manage", async () => {
      const dept = (await a.post("/departments", { name: "Keuangan" }).expect(201)).body.id;
      const rinaUser = await user("Rina Karyawan", "rina@example.com", [await role("karyawan", [])]);
      const emp = (
        await a
          .post("/employees", {
            name: "Rina Wulandari",
            departmentId: dept,
            userId: rinaUser,
            nik: "3201.0123.4567.8901",
            npwp: "01.234.567.8-901.000",
            ptkpStatus: "TK/0",
            bankName: "BCA",
            bankAccount: "1234567890",
            joinDate: "2025-01-02",
            workEmail: "rina@example.com",
          })
          .expect(201)
      ).body;
      rina = emp.id;
      expect(emp).toMatchObject({
        employeeNumber: "EMP/2025/0001",
        nik: "3201012345678901",
        npwp: "012345678901000",
        bankAccount: "1234567890",
      });

      const [raw] = await app
        .get(TenantDb)
        .runAs(tenantId, (tx) => tx.select().from(schema.employees).where(eq(schema.employees.id, rina)));
      expect(raw!.nikEnc).toMatch(/^v1\./);
      expect(raw!.nikEnc).not.toContain("3201012345678901");
      const list = (await a.get("/employees").expect(200)).body.items[0];
      expect(list.nik).toBeUndefined();
      expect(list.nikEnc).toBeUndefined();

      staffApi = await login(
        (await user("Staf HR", "hrstaff@example.com", [await role("hrstaff", ["hr.read", "hr.write"])]),
        "hrstaff@example.com"),
      );
      const masked = (await staffApi.get(`/employees/${rina}`).expect(200)).body;
      expect(masked.nik).toBe("••••8901");
      await staffApi.patch(`/employees/${rina}`, { nik: masked.nik, workPhone: "0812" }).expect(200);
      await staffApi.patch(`/employees/${rina}`, { nik: "3201012345670000" }).expect(403);
      await a.post("/employees", { name: "X", nik: "123", joinDate: "2026-01-01" }).expect(400);
      rinaApi = await login("rina@example.com");
    });

    it("kontrak: PKWT wajib tanggal akhir; hanya satu kontrak berjalan", async () => {
      await a
        .post("/contracts", {
          employeeId: rina,
          contractType: "pkwt",
          wage: "10000000",
          dateStart: "2025-01-02",
        })
        .expect(400);
      await contract(rina, "10000000", "2025-01-02", [
        { componentId: comp.TJAB, amount: "2000000" },
        { componentId: comp.TRANS, amount: "500000" },
      ]);
      const second = (
        await a
          .post("/contracts", { employeeId: rina, wage: "11000000", dateStart: "2026-01-01" })
          .expect(201)
      ).body;
      await a.post(`/contracts/${second.id}/start`).expect(400);
      await a.delete(`/contracts/${second.id}`).expect(204);
      await rinaApi.get("/contracts").expect(403);
    });
  });

  describe("cuti, absensi, lembur", () => {
    it("pengajuan cuti dari portal: hari kerja, saldo, tumpang tindih, persetujuan", async () => {
      await a
        .post("/leave-allocations", {
          employeeId: rina,
          leaveTypeId: leaveType["Cuti tahunan"],
          days: "12",
          dateFrom: "2026-01-01",
          dateTo: "2026-12-31",
        })
        .expect(201);
      const req = (
        await rinaApi
          .post("/leaves", {
            leaveTypeId: leaveType["Cuti tahunan"],
            dateFrom: "2026-10-03",
            dateTo: "2026-10-09",
            reason: "Liburan",
          })
          .expect(201)
      ).body;
      expect(req).toMatchObject({ days: "5.00", state: "confirm" });
      await rinaApi
        .post("/leaves", {
          leaveTypeId: leaveType["Cuti tahunan"],
          dateFrom: "2026-10-08",
          dateTo: "2026-10-08",
        })
        .expect(400);
      const tooMuch = await rinaApi
        .post("/leaves", {
          leaveTypeId: leaveType["Cuti tahunan"],
          dateFrom: "2026-11-02",
          dateTo: "2026-11-13",
        })
        .expect(400);
      expect(tooMuch.body.errors[0].message).toContain("tidak cukup");
      await rinaApi.post(`/leaves/${req.id}/approve`).expect(403);
      await a.post(`/leaves/${req.id}/approve`).expect(200);
      const mine = (await rinaApi.get("/me/leaves").expect(200)).body;
      expect(
        mine.balances.find((b: { leaveTypeName: string }) => b.leaveTypeName === "Cuti tahunan"),
      ).toMatchObject({
        allocated: "12.00",
        taken: "5.00",
        remaining: "7.00",
      });

      const unpaid = (
        await rinaApi
          .post("/leaves", {
            leaveTypeId: leaveType["Izin tanpa upah"],
            dateFrom: "2026-10-26",
            dateTo: "2026-10-27",
          })
          .expect(201)
      ).body;
      await staffApi.post(`/leaves/${unpaid.id}/approve`).expect(200);
    });

    it("absen masuk & pulang dari portal", async () => {
      await rinaApi.post("/attendance/check-in", { latitude: -6.2, longitude: 106.8 }).expect(200);
      await rinaApi.post("/attendance/check-in", {}).expect(400);
      expect((await rinaApi.get("/me/employee").expect(200)).body.openAttendance).toBeTruthy();
      const out = (await rinaApi.post("/attendance/check-out").expect(200)).body;
      expect(out.workedHours).toBe("0.00");
      expect((await rinaApi.get("/me/attendance").expect(200)).body).toHaveLength(1);
      await a.get(`/attendance?from=2026-01-01&to=2026-12-31&employeeId=${rina}`).expect(200);
    });

    it("lembur dicatat HR", async () => {
      await staffApi
        .post("/overtimes", { employeeId: rina, date: "2026-10-15", hours: "2", dayType: "workday" })
        .expect(201);
    });
  });

  describe("payroll", () => {
    it("Oktober: TER, BPJS dengan batas upah, lembur, cuti tanpa upah", async () => {
      const run = (
        await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201)
      ).body;
      octRun = run.id;
      expect(run).toMatchObject({ name: "Gaji Oktober 2026", state: "draft", periodEnd: "2026-10-31" });
      expect(run.payslips).toHaveLength(1);
      rinaSlip = run.payslips[0].id;
      const slip = (await a.get(`/payslips/${rinaSlip}`).expect(200)).body;
      expect(slip).toMatchObject({
        workingDays: 22,
        unpaidDays: "2.00",
        earnings: "11651866.00",
        gross: "12196666.00",
        terCategory: "A",
        terRate: "4.00",
        pph21: "487866.00",
        employeeBpjs: "465474.00",
        employerBpjs: "1199748.00",
        net: "10698526.00",
      });
      const byCode = Object.fromEntries((slip.lines as SlipLine[]).map((l) => [l.code, l.amount]));
      expect(byCode).toMatchObject({
        OT: "242775.00",
        UNPAID: "-1090909.00",
        BPJS_KES_ER: "480000.00",
        JP_EE: "-105474.00",
      });
      await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(409);
    });

    it("THR sebagai input slip ikut TER bulan berjalan", async () => {
      const slip = (
        await a
          .put(`/payslips/${rinaSlip}/inputs`, { inputs: [{ componentId: comp.THR, amount: "10000000" }] })
          .expect(200)
      ).body;
      expect(slip).toMatchObject({
        earnings: "21651866.00",
        gross: "22196666.00",
        terRate: "9.00",
        pph21: "1997699.00",
        net: "19188693.00",
      });
    });

    it("posting membuat jurnal gaji; lembur terkunci; pembayaran & file transfer bank", async () => {
      await rinaApi.get(`/payslips/${rinaSlip}`).expect(403); // belum diposting
      const posted = (await a.post(`/payroll-runs/${octRun}/post`).expect(200)).body;
      expect(posted.state).toBe("done");
      expect(await entry(posted.accountMove.id)).toEqual([
        ["2-1300", "0.00", "1997699.00"],
        ["2-1400", "0.00", "1665222.00"],
        ["2-1500", "0.00", "19188693.00"],
        ["6-1000", "21651866.00", "0.00"],
        ["6-1100", "1199748.00", "0.00"],
      ]);
      await a.post(`/payroll-runs/${octRun}/compute`).expect(400);
      const ot = (await a.get("/overtimes").expect(200)).body.items[0];
      await a.patch(`/overtimes/${ot.id}`, { hours: "3" }).expect(400);

      const bank = (await a.get(`/payroll-runs/${octRun}/bank-transfer`).expect(200)).body;
      expect(bank).toEqual([
        expect.objectContaining({
          name: "Rina Wulandari",
          bankName: "BCA",
          bankAccount: "1234567890",
          amount: "19188693",
        }),
      ]);
      const csv = await a.get(`/payroll-runs/${octRun}/bank-transfer?format=csv`).expect(200);
      expect(csv.text).toContain("1234567890");
      await staffApi.get(`/payroll-runs/${octRun}/bank-transfer`).expect(403);
      const recap = (await a.get(`/payroll-runs/${octRun}/recap`).expect(200)).body[0];
      expect(recap).toMatchObject({ nik: "3201012345678901", gross: "22196666.00", pph21: "1997699.00" });
      expect(recap.bpjs).toMatchObject({
        kesEmployer: "480000",
        jhtEmployee: "240000",
        jpEmployer: "210948",
      });

      const bankJournal = (await a.get("/journals").expect(200)).body.items.find(
        (j: { code: string }) => j.code === "BNK1",
      ).id;
      const paid = (
        await a
          .post(`/payroll-runs/${octRun}/pay`, { journalId: bankJournal, date: "2026-10-28" })
          .expect(200)
      ).body;
      expect(paid.state).toBe("paid");
      expect(await entry(paid.paymentMove.id)).toEqual([
        ["1-1200", "0.00", "19188693.00"],
        ["2-1500", "19188693.00", "0.00"],
      ]);
    });

    it("portal: karyawan melihat & mengunduh slip sendiri saja", async () => {
      const mine = (await rinaApi.get("/me/payslips").expect(200)).body;
      expect(mine).toEqual([
        expect.objectContaining({ id: rinaSlip, runName: "Gaji Oktober 2026", net: "19188693.00" }),
      ]);
      await rinaApi.get(`/payslips/${rinaSlip}`).expect(200);
      const pdf = await rinaApi
        .get(`/payslips/${rinaSlip}/pdf`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
      await rinaApi.get("/payroll-runs").expect(403);
    });

    it("Desember: PPh 21 setahun; kelebihan potong dikembalikan; karyawan baru diprorata", async () => {
      const budi = (
        await a
          .post("/employees", { name: "Budi Santoso", ptkpStatus: "TK/0", joinDate: "2026-11-01" })
          .expect(201)
      ).body.id;
      await contract(budi, "10000000", "2026-11-01");
      const sari = (await a.post("/employees", { name: "Sari", joinDate: "2026-12-14" }).expect(201)).body.id;
      await contract(sari, "8000000", "2026-12-14");

      const nov = (
        await a.post("/payroll-runs", { period: "2026-11", paymentDate: "2026-11-27" }).expect(201)
      ).body;
      const budiNov = nov.payslips.find((p: { employeeId: string }) => p.employeeId === budi);
      expect(budiNov).toMatchObject({
        gross: "10454000.00",
        terRate: "2.50",
        pph21: "313620.00",
        employeePension: "300000.00",
        isFinal: false,
      });
      // Tanpa NPWP/NIK: tarif 20% lebih tinggi.
      expect(budiNov.hasNpwp).toBe(false);
      await a.patch(`/employees/${budi}`, { nik: "3201000000000001" }).expect(200);
      const nov2 = (await a.post(`/payroll-runs/${nov.id}/compute`).expect(200)).body;
      expect(nov2.payslips.find((p: { employeeId: string }) => p.employeeId === budi).pph21).toBe(
        "261350.00",
      );
      await a.post(`/payroll-runs/${nov.id}/post`).expect(200);

      const dec = (
        await a.post("/payroll-runs", { period: "2026-12", paymentDate: "2026-12-23" }).expect(201)
      ).body;
      const budiDec = (
        await a
          .get(`/payslips/${dec.payslips.find((p: { employeeId: string }) => p.employeeId === budi).id}`)
          .expect(200)
      ).body;
      expect(budiDec).toMatchObject({ isFinal: true, terRate: null, pph21: "-261350.00", net: "9861350.00" });
      expect(budiDec.annual).toMatchObject({ biayaJabatan: "1000000", pkp: "0", tax: "0" });
      const sariSlip = dec.payslips.find((p: { employeeId: string }) => p.employeeId === sari);
      expect(Number(sariSlip.unpaidDays)).toBe(workingDays("2026-12-01", "2026-12-13"));
      const posted = (await a.post(`/payroll-runs/${dec.id}/post`).expect(200)).body;
      expect(posted.state).toBe("done");
    });
  });
});
