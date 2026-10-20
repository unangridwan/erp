import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

const binary = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });

/** BPJS Kesehatan dan BPJS Ketenagakerjaan selalu terpisah: kepesertaan, slip, total, jurnal, laporan, ekspor. */
describe.skipIf(!hasDb)("Payroll: BPJS Kesehatan & Ketenagakerjaan terpisah", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const acc: Record<string, string> = {};
  let runId: string;
  let full: string;
  let partial: string;

  const employee = async (name: string, extra: object) => {
    const id = (await a.post("/employees", { name, joinDate: "2025-01-02", ...extra }).expect(201)).body.id;
    const c = (
      await a.post("/contracts", { employeeId: id, wage: "15000000", dateStart: "2025-01-02" }).expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    return id as string;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "bpjs");
    for (const r of (await a.get("/accounts?limit=200").expect(200)).body.items) acc[r.code] = r.id;
    full = await employee("Penuh", { bpjsKesNo: "0001", bpjsTkNo: "KPJ01", bpjsKesClass: 1 });
    // Tidak ikut BPJS Kesehatan (asuransi swasta) & tidak ikut Jaminan Pensiun.
    partial = await employee("Sebagian", {
      bpjsKesEnrolled: false,
      bpjsJpEnrolled: false,
      bpjsTkNo: "KPJ02",
    });
    runId = (await a.post("/payroll-runs", { period: "2026-10", paymentDate: "2026-10-28" }).expect(201)).body
      .id;
  });
  afterAll(() => app?.close());

  it("data karyawan menyimpan kepesertaan per program", async () => {
    expect((await a.get(`/employees/${partial}`).expect(200)).body).toMatchObject({
      bpjsKesEnrolled: false,
      bpjsTkEnrolled: true,
      bpjsJpEnrolled: false,
    });
    expect((await a.get(`/employees/${full}`).expect(200)).body).toMatchObject({ bpjsKesClass: 1 });
  });

  it("slip & total run memisahkan BPJS Kesehatan dan Ketenagakerjaan; kepesertaan dihormati", async () => {
    const run = (await a.get(`/payroll-runs/${runId}`).expect(200)).body;
    const slip = (name: string) =>
      run.payslips.find((p: { employeeName: string }) => p.employeeName === name);
    // Upah 15 jt: Kesehatan dibatasi Rp12 jt (1% / 4%); JHT dari 15 jt; JP dibatasi batas JP.
    expect(slip("Penuh")).toMatchObject({
      kesEmployee: "120000.00",
      kesEmployer: "480000.00",
      tkEmployee: "405474.00", // JHT 300.000 + JP 105.474
      tkEmployer: "846948.00", // JHT 555.000 + JKK 36.000 + JKM 45.000 + JP 210.948
      bpjsKesWage: "12000000.00",
      bpjsTkWage: "15000000.00",
    });
    expect(slip("Sebagian")).toMatchObject({
      kesEmployee: "0.00",
      kesEmployer: "0.00",
      tkEmployee: "300000.00", // JHT saja
      tkEmployer: "636000.00", // JHT 555.000 + JKK 36.000 + JKM 45.000
      bpjsKesWage: "0.00",
    });
    expect(run.totals).toMatchObject({
      kesEmployee: "120000.00",
      kesEmployer: "480000.00",
      tkEmployee: "705474.00",
      tkEmployer: "1482948.00",
    });
    expect(run.totals).not.toHaveProperty("employeeBpjs");
    const detail = (await a.get(`/payslips/${slip("Sebagian").id}`).expect(200)).body;
    expect(detail.lines.map((l: { code: string }) => l.code)).not.toContain("BPJS_KES_EE");
    expect(detail.lines.map((l: { code: string }) => l.code)).not.toContain("JP_EE");
  });

  it("jurnal: beban & utang per program dengan baris terpisah", async () => {
    const posted = (await a.post(`/payroll-runs/${runId}/post`).expect(200)).body;
    const lines = (await a.get(`/moves/${posted.accountMove.id}`).expect(200)).body.lines as {
      accountId: string;
      name: string;
      debit: string;
      credit: string;
    }[];
    const at = (code: string) => lines.filter((l) => l.accountId === acc[code]);
    expect(at("6-1110")).toEqual([
      expect.objectContaining({ debit: "480000.00", name: expect.stringContaining("BPJS Kesehatan") }),
    ]);
    expect(at("2-1410")).toEqual([expect.objectContaining({ credit: "600000.00" })]);
    expect(at("6-1100")).toEqual([
      expect.objectContaining({ debit: "1482948.00", name: expect.stringContaining("BPJS Ketenagakerjaan") }),
    ]);
    expect(at("2-1400")).toEqual([expect.objectContaining({ credit: "2188422.00" })]);
  });

  it("rekap e-Dabu hanya peserta Kesehatan; laporan biaya & ekspor rekap slip per program", async () => {
    const edabu = await a.get(`/payroll-runs/${runId}/recap?format=edabu`).expect(200);
    expect(edabu.text).toContain("Penuh");
    expect(edabu.text).not.toContain("Sebagian");
    expect(edabu.text).toContain("12000000");
    const sipp = await a.get(`/payroll-runs/${runId}/recap?format=sipp`).expect(200);
    expect(sipp.text).toContain("Sebagian");
    expect(sipp.text).toContain("15000000");

    const cost = (await a.get("/payroll/reports/cost?from=2026-10&to=2026-10").expect(200)).body;
    expect(cost.totals).toMatchObject({ kesEmployer: "480000", tkEmployer: "1482948" });
    expect(cost.totals).not.toHaveProperty("employerBpjs");

    const res = await binary(a.get(`/data-transfer/payslips/export?runId=${runId}`)).expect(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const header = (book.worksheets[0]!.getRow(1).values as unknown[]).filter(Boolean);
    expect(header).toEqual(
      expect.arrayContaining([
        "BPJS Kesehatan Karyawan",
        "BPJS Kesehatan Perusahaan",
        "BPJS Ketenagakerjaan Karyawan",
        "BPJS Ketenagakerjaan Perusahaan",
        "Dasar Upah BPJS Kesehatan",
        "Dasar Upah BPJS Ketenagakerjaan",
      ]),
    );
    expect(header).not.toContain("BPJS Karyawan");
    const pdf = await binary(
      a.get(`/payslips/${(await a.get(`/payroll-runs/${runId}`)).body.payslips[0].id}/pdf`),
    ).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  });
});
