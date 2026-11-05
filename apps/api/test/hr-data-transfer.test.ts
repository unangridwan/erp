import type { INestApplication } from "@nestjs/common";
import { schema } from "@erp/db";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseXlsx } from "../src/common/csv-import.js";
import { TenantDb } from "../src/common/database.js";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;

const binary = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });

/** Berkas .xlsx (base64) dari judul kolom & baris. */
async function xlsx(headers: string[], rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Data");
  sheet.addRow(headers);
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
}

const csv = (lines: string[]) => lines.join("\n");

describe.skipIf(!hasDb)("HR & Payroll: impor & ekspor Excel/CSV", () => {
  let app: INestApplication;
  let a: Api & { slug: string };
  let viewer: Api;
  let companyId: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "dt");
    const me = (await a.get("/auth/me")).body;
    companyId = me.activeCompanyId;
    tenantId = me.tenantId;
    const [role] = await app.get(TenantDb).runAs(tenantId, async (tx) => {
      const roles = await tx
        .insert(schema.roles)
        .values({ code: "hrview", name: "HR viewer" })
        .returning({ id: schema.roles.id });
      await tx.insert(schema.rolePermissions).values([
        { roleId: roles[0]!.id, permission: "hr.read" },
        { roleId: roles[0]!.id, permission: "hr.write" },
      ]);
      return roles;
    });
    await a
      .post("/users", {
        name: "Vina",
        email: "vina@example.com",
        password: "rahasia123",
        roleIds: [role!.id],
        companyIds: [companyId],
      })
      .expect(201);
    const token = (
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ tenantSlug: a.slug, email: "vina@example.com", password: "rahasia123" })
        .expect(200)
    ).body.token;
    viewer = client(app, token);
    await a.post("/departments", { name: "Keuangan" }).expect(201);
    await a.post("/departments", { name: "Operasional" }).expect(201);
    await a.post("/job-positions", { name: "Staf" }).expect(201);
    await a.post("/job-positions", { name: "Supervisor" }).expect(201);
  });
  afterAll(() => app?.close());

  it("daftar dataset sesuai permission & template Excel berisi petunjuk dan daftar rujukan", async () => {
    const all = (await a.get("/data-transfer").expect(200)).body;
    expect(all.map((d: { key: string }) => d.key)).toEqual(
      expect.arrayContaining(["employees", "contracts", "attendance", "payslip-inputs", "payslips"]),
    );
    const mine = (await viewer.get("/data-transfer").expect(200)).body.map((d: { key: string }) => d.key);
    expect(mine).toContain("employees");
    expect(mine).not.toContain("contracts"); // hr.manage
    expect(mine).not.toContain("payslips");

    const res = await binary(a.get("/data-transfer/employees/template")).expect(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(["Data karyawan", "Petunjuk", "Daftar Rujukan"]);
    const rows = await parseXlsx((res.body as Buffer).toString("base64"));
    expect(rows[0]).toMatchObject({
      "No. Karyawan": "EMP/2024/0001",
      Nama: "Dewi Lestari",
      NIK: "3201010101010001",
    });
    const refs = book.getWorksheet("Daftar Rujukan")!.getSheetValues().flat().filter(Boolean);
    expect(refs).toEqual(expect.arrayContaining(["Departemen", "Keuangan", "Operasional", "Staf"]));
    // Template untuk hr.write tanpa hr.manage tidak memuat kolom data pribadi.
    const tpl = await viewer.get("/data-transfer/employees/template?format=csv").expect(200);
    expect(tpl.text).not.toContain("NIK");
  });

  it("impor karyawan CSV: rujukan per nama, atasan per No. Karyawan, NIK terenkripsi; pratinjau tidak menyimpan", async () => {
    const file = csv([
      "No. Karyawan,Nama,Departemen,Jabatan,No. Karyawan Atasan,Tanggal Masuk,NIK,Jenis Kelamin,Status Pernikahan,Golongan Darah,Aktif",
      "K-001,Budi Santoso,Keuangan,Supervisor,,2020-01-02,3201010101010001,L,Kawin,O,ya",
      "K-002,Dewi Lestari,keuangan,Staf,K-001,15/03/2024,3201010101010002,Perempuan,Belum kawin,A,ya",
    ]);
    const preview = (await a.post("/data-transfer/employees/import", { csv: file, dryRun: true }).expect(200))
      .body;
    expect(preview).toMatchObject({ dryRun: true, created: 2, updated: 0, errors: [] });
    expect((await a.get("/employees?q=Dewi").expect(200)).body.total).toBe(0);

    const done = (await a.post("/data-transfer/employees/import", { csv: file }).expect(200)).body;
    expect(done).toMatchObject({ created: 2, updated: 0 });
    const list = (await a.get("/employees?q=Dewi").expect(200)).body.items;
    const dewi = (await a.get(`/employees/${list[0].id}`).expect(200)).body;
    const budi = (await a.get("/employees?q=Budi").expect(200)).body.items[0];
    expect(dewi).toMatchObject({
      employeeNumber: "K-002",
      joinDate: "2024-03-15",
      managerId: budi.id,
      nik: "3201010101010002",
      gender: "female",
      maritalStatus: "single",
      bloodType: "A",
    });
    const history = (await a.get(`/employees/${dewi.id}/history`).expect(200)).body.history;
    expect(history.map((h: { kind: string }) => h.kind)).toContain("join");
  });

  it("baris salah membatalkan semua impor dengan nomor baris & kolom; data pribadi butuh hr.manage", async () => {
    const file = csv([
      "No. Karyawan,Nama,Departemen,Tanggal Masuk,Golongan Darah",
      "K-010,Eko,Keuangan,2024-01-01,B",
      "K-011,Fajar,Gudang,2024-01-01,O",
      "K-012,,Keuangan,31/02/2024,Z",
    ]);
    const res = (await a.post("/data-transfer/employees/import", { csv: file }).expect(400)).body;
    expect(res.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 3,
          path: "Departemen",
          message: 'Departemen "Gudang" tidak ditemukan',
        }),
        expect.objectContaining({ row: 4 }),
      ]),
    );
    expect((await a.get("/employees?q=Eko").expect(200)).body.total).toBe(0);
    const preview = (await a.post("/data-transfer/employees/import", { csv: file, dryRun: true }).expect(200))
      .body;
    expect(preview.created).toBe(1);
    expect(preview.errors).toHaveLength(2);

    const nik = csv(["No. Karyawan,Nama,Tanggal Masuk,NIK", "K-020,Gita,2024-01-01,3201010101010009"]);
    const denied = (await viewer.post("/data-transfer/employees/import", { csv: nik }).expect(400)).body;
    expect(denied.errors[0]).toMatchObject({ row: 2, path: "NIK" });
    await viewer.post("/data-transfer/contracts/import", { csv: nik }).expect(403);
  });

  it("impor .xlsx memperbarui data yang ada (sel kosong = tidak diubah); ekspor → impor ulang tanpa perubahan", async () => {
    const file = await xlsx(
      ["No. Karyawan", "Nama", "Jabatan", "Tanggal Lahir", "No. HP Pribadi"],
      [["K-002", "Dewi Lestari", "Supervisor", new Date(Date.UTC(1993, 4, 12)), "0812"]],
    );
    expect((await a.post("/data-transfer/employees/import", { xlsx: file }).expect(200)).body).toMatchObject({
      created: 0,
      updated: 1,
    });
    const dewi = (await a.get("/employees?q=Dewi").expect(200)).body.items[0];
    const full = (await a.get(`/employees/${dewi.id}`).expect(200)).body;
    expect(full).toMatchObject({ birthDate: "1993-05-12", personalPhone: "0812", nik: "3201010101010002" });
    const history = (await a.get(`/employees/${dewi.id}/history`).expect(200)).body.history;
    expect(history.find((h: { kind: string }) => h.kind === "job")).toMatchObject({
      oldValue: "Staf",
      newValue: "Supervisor",
    });

    const exported = await binary(a.get("/data-transfer/employees/export")).expect(200);
    const again = (
      await a
        .post("/data-transfer/employees/import", {
          xlsx: (exported.body as Buffer).toString("base64"),
          dryRun: true,
        })
        .expect(200)
    ).body;
    expect(again.errors).toEqual([]);
    expect(again.created).toBe(0);
  });

  it("ekspor dengan kolom pilihan (urutan sesuai, No. Karyawan selalu ikut) & filter; kolom sensitif dibatasi", async () => {
    const dept = (await a.get("/departments").expect(200)).body.items.find(
      (d: { name: string }) => d.name === "Keuangan",
    );
    const res = await a
      .get(
        `/data-transfer/employees/export?format=csv&columns=name,personalPhone,department&departmentId=${dept.id}`,
      )
      .expect(200);
    const lines = res.text
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/);
    expect(lines[0]).toBe("No. Karyawan,Nama,No. HP Pribadi,Departemen");
    expect(lines).toHaveLength(3);
    expect(lines).toContain("K-002,Dewi Lestari,0812,Keuangan");
    await a.get("/data-transfer/employees/export?columns=name,salah").expect(400);
    await viewer.get("/data-transfer/employees/export?columns=name,nik").expect(403);
    const plain = await viewer.get("/data-transfer/employees/export?format=csv").expect(200);
    expect(plain.text).not.toContain("3201010101010002");
    expect(plain.text).toContain("Dewi Lestari");
  });

  it("profil ekspor: pribadi vs bersama", async () => {
    await viewer
      .post("/data-transfer/employees/presets", {
        name: "Kontak",
        columns: ["name", "personalPhone"],
        shared: true,
      })
      .expect(403);
    const mine = (
      await viewer
        .post("/data-transfer/employees/presets", { name: "Kontak saya", columns: ["name", "personalPhone"] })
        .expect(201)
    ).body;
    await a
      .post("/data-transfer/employees/presets", {
        name: "Rekap HR",
        columns: ["name", "department"],
        filters: { active: "all" },
        shared: true,
      })
      .expect(201);
    const seen = (await viewer.get("/data-transfer/employees/presets").expect(200)).body;
    expect(seen.map((p: { name: string }) => p.name).sort()).toEqual(["Kontak saya", "Rekap HR"]);
    const admin = (await a.get("/data-transfer/employees/presets").expect(200)).body;
    expect(admin.map((p: { name: string }) => p.name)).toEqual(["Rekap HR"]);
    await a.delete(`/data-transfer/employees/presets/${mine.id}`).expect(403);
    await viewer.delete(`/data-transfer/employees/presets/${mine.id}`).expect(204);
  });

  it("kontrak dengan tunjangan per kode komponen & mulai berlaku; jatah cuti upsert; lembur", async () => {
    const file = csv([
      "No. Karyawan,Jenis,Tipe Upah,Mulai,Berakhir,Upah Pokok,Mulai Berlaku,TJAB",
      "K-001,PKWTT,Bulanan,2024-01-01,,9.000.000,ya,1.500.000",
      "K-002,PKWT,Bulanan,2024-03-15,,6000000,ya,",
    ]);
    const bad = (await a.post("/data-transfer/contracts/import", { csv: file }).expect(400)).body;
    expect(bad.errors[0]).toMatchObject({
      row: 3,
      path: "Berakhir",
      message: "PKWT (kontrak) wajib punya tanggal berakhir",
    });
    const fixed = file.replace("2024-03-15,,", "2024-03-15,2027-03-14,");
    expect((await a.post("/data-transfer/contracts/import", { csv: fixed }).expect(200)).body.created).toBe(
      2,
    );
    const budi = (await a.get("/employees?q=Budi").expect(200)).body.items[0];
    const running = (await a.get(`/contracts?employeeId=${budi.id}&state=running`).expect(200)).body.items;
    expect(running[0].wage).toBe("9000000.00");
    const detail = (await a.get(`/contracts/${running[0].id}`).expect(200)).body;
    expect(detail.allowances).toEqual([expect.objectContaining({ code: "TJAB", amount: "1500000.00" })]);
    // Kontrak kedua untuk karyawan yang masih punya kontrak berjalan → gagal di baris itu.
    const again = (await a.post("/data-transfer/contracts/import", { csv: fixed }).expect(400)).body;
    expect(again.errors[0].message).toContain("masih punya kontrak berjalan");
    const exported = await a
      .get("/data-transfer/contracts/export?format=csv&columns=wage,c_TJAB")
      .expect(200);
    expect(exported.text).toContain("No. Karyawan,Upah Pokok,TJAB Tunjangan jabatan");

    const alloc = csv([
      "No. Karyawan,Jenis Cuti,Jumlah Hari,Berlaku Dari,Berlaku Sampai",
      "K-001,cuti tahunan,12,2026-01-01,2026-12-31",
    ]);
    expect(
      (await a.post("/data-transfer/leave-allocations/import", { csv: alloc }).expect(200)).body.created,
    ).toBe(1);
    expect(
      (
        await a
          .post("/data-transfer/leave-allocations/import", { csv: alloc.replace(",12,", ",14,") })
          .expect(200)
      ).body,
    ).toMatchObject({ created: 0, updated: 1 });
    const allocs = (await a.get("/leave-allocations").expect(200)).body.items;
    expect(allocs).toHaveLength(1);
    expect(allocs[0].days).toBe("14.00");

    const ot = csv([
      "No. Karyawan,Tanggal,Jam,Jenis Hari",
      "K-002,2026-10-03,2,Hari libur",
      "K-002,2026-10-03,2,Hari libur",
    ]);
    expect((await a.post("/data-transfer/overtimes/import", { csv: ot }).expect(200)).body).toMatchObject({
      created: 1,
      skipped: 1,
    });
    const otExport = await a
      .get("/data-transfer/overtimes/export?format=csv&from=2026-10-01&to=2026-10-31")
      .expect(200);
    expect(otExport.text).toContain("K-002,Dewi Lestari,2026-10-03,2.00,Hari libur");
  });

  it("absensi dari mesin: zona waktu perusahaan, pulang lewat tengah malam, data ganda dilewati", async () => {
    const file = csv([
      "No. Karyawan,Tanggal,Jam Masuk,Jam Pulang",
      "K-002,2026-10-01,08:02,17:05",
      "K-002,,2026-10-02 22:00,06:00",
      "K-002,2026-10-01,08:02,17:05",
    ]);
    expect((await a.post("/data-transfer/attendance/import", { csv: file }).expect(200)).body).toMatchObject({
      created: 2,
      skipped: 1,
    });
    const dewi = (await a.get("/employees?q=Dewi").expect(200)).body.items[0];
    const rows = (await a.get(`/attendance?employeeId=${dewi.id}&from=2026-09-30&to=2026-10-03`).expect(200))
      .body;
    const checkIns = rows.map((r: { checkIn: string }) => new Date(r.checkIn).toISOString()).sort();
    expect(checkIns).toEqual(["2026-10-01T01:02:00.000Z", "2026-10-02T15:00:00.000Z"]);
    const night = rows.find((r: { checkIn: string }) => r.checkIn.startsWith("2026-10-02"));
    expect(new Date(night.checkOut).toISOString()).toBe("2026-10-02T23:00:00.000Z");
    const exported = await a
      .get("/data-transfer/attendance/export?format=csv&from=2026-10-01&to=2026-10-31")
      .expect(200);
    expect(exported.text).toContain("K-002,Dewi Lestari,2026-10-01,08:02,17:05,9.05,Impor");
  });

  it("payroll: impor input variabel slip (hitung ulang neto), ekspor rekap slip dengan kolom komponen & total", async () => {
    await a.post("/salary-components", { code: "INSTV", name: "Insentif", kind: "allowance" }).expect(201);
    const run = (await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201))
      .body;
    await a.get("/data-transfer/payslip-inputs/export").expect(400); // periode wajib
    const before = (await a.get(`/payroll-runs/${run.id}`).expect(200)).body.payslips;
    const dewiSlip = before.find((s: { employeeName: string }) => s.employeeName === "Dewi Lestari");
    const file = csv([
      "No. Karyawan,Kode Komponen,Jumlah,Keterangan",
      "K-002,INSTV,500000,Bonus target",
      "K-002,XX,1,",
      "K-999,INSTV,1,",
    ]);
    const bad = (
      await a.post("/data-transfer/payslip-inputs/import", { csv: file, runId: run.id }).expect(400)
    ).body;
    expect(bad.errors.map((e: { row: number; path: string }) => `${e.row} ${e.path}`)).toEqual([
      "3 Kode Komponen",
      "4 No. Karyawan",
    ]);
    const ok = file.split(/\r?\n/).slice(0, 2).join("\n");
    expect(
      (await a.post("/data-transfer/payslip-inputs/import", { csv: ok, runId: run.id }).expect(200)).body,
    ).toMatchObject({
      created: 1,
      updated: 1,
    });
    const after = (await a.get(`/payslips/${dewiSlip.id}`).expect(200)).body;
    expect(Number(after.gross) - Number(dewiSlip.gross)).toBe(500000);
    expect(after.inputs).toEqual([
      expect.objectContaining({ code: "INSTV", amount: "500000.00", description: "Bonus target" }),
    ]);

    const inputs = await a.get(`/data-transfer/payslip-inputs/export?format=csv&runId=${run.id}`).expect(200);
    expect(inputs.text).toContain("K-002,Dewi Lestari,INSTV,Insentif,500000.00,Bonus target");

    const res = await binary(a.get(`/data-transfer/payslips/export?runId=${run.id}`)).expect(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.worksheets[0]!;
    const header = (sheet.getRow(1).values as unknown[]).filter(Boolean);
    expect(header).toEqual(
      expect.arrayContaining(["No. Karyawan", "INSTV Insentif", "Gaji Bersih", "PPh 21"]),
    );
    expect(sheet.getRow(sheet.rowCount).getCell(1).value).toBe("TOTAL");

    await a.post(`/payroll-runs/${run.id}/compute`).expect(200);
    await a.post(`/payroll-runs/${run.id}/post`).expect(200);
    const posted = (
      await a.post("/data-transfer/payslip-inputs/import", { csv: ok, runId: run.id }).expect(400)
    ).body;
    expect(posted.errors[0].message).toBe("Payroll sudah diposting");
  });

  it("master generik: ekspor CRUD dengan kolom pilihan (id selalu ikut)", async () => {
    const res = await a.get("/departments/export?columns=name").expect(200);
    expect(res.text.replace(/^\uFEFF/, "").split(/\r?\n/)[0]).toBe("id,name");
    await a.get("/departments/export?columns=salah").expect(400);
  });
});
