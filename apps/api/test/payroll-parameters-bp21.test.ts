import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

interface Line {
  code: string;
  amount: string;
}

/**
 * Parameter payroll per tanggal berlaku (batas upah BPJS & tarif JKK): run dihitung dengan nilai pada awal periodenya,
 * sehingga hitung ulang periode lama tidak berubah. BP21 untuk pegawai tidak tetap & bukan pegawai.
 */
describe.skipIf(!hasDb)("Parameter payroll per tanggal & BP21", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const ids: Record<string, string> = {};
  const runs: Record<string, string> = {};

  const jpEmployer = async (runId: string) => {
    const run = (await a.get(`/payroll-runs/${runId}`).expect(200)).body;
    const slip = run.payslips.find((p: { employeeId: string }) => p.employeeId === ids.Tetap);
    const detail = (await a.get(`/payslips/${slip.id}`).expect(200)).body as { lines: Line[] };
    return Math.abs(Number(detail.lines.find((l) => l.code === "JP_ER")?.amount ?? 0));
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "paramsbp21");
    const me = (await a.get("/auth/me").expect(200)).body;
    await a
      .patch(`/companies/${me.companyId}`, { npwp: "01.234.567.8-901.000", street: "Jl. Thamrin 10" })
      .expect(200);
    await a
      .post("/contract-types", {
        code: "ptt",
        name: "Pegawai tidak tetap bulanan",
        pph21Category: "non_permanent",
      })
      .expect(201);
    const hire = async (name: string, contract: object, extra: object = {}) =>
      (ids[name] = (
        await a
          .post("/employees", {
            name,
            bpjsKesNo: "1",
            bpjsTkNo: "1",
            ...extra,
            contract: { dateStart: "2025-12-01", ...contract },
          })
          .expect(201)
      ).body.id);
    await hire("Tetap", { contractType: "pkwtt", wage: 15000000 }, { nik: "3201010101010001" });
    await hire("Mitra", { contractType: "mitra", wage: 10000000 }, { nik: "3201010101010002" });
    await hire("PTT", { contractType: "ptt", wage: 4000000 }, { nik: "3201010101010003" });
    for (const [key, period] of [
      ["jan", "2026-01"],
      ["mar", "2026-03"],
    ] as const)
      runs[key] = (
        await a.post("/payroll-runs", { period, paymentDate: `${period}-25` }).expect(201)
      ).body.id;
  });
  afterAll(() => app?.close());

  it("parameter awal berasal dari Pengaturan Payroll", async () => {
    const rows = (await a.get("/payroll-parameters").expect(200)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effectiveFrom: "2000-01-01" });
    expect(await jpEmployer(runs.jan!)).toBe(Math.round(Number(rows[0].jpWageCap) * 0.02));
  });

  it("batas JP baru berlaku mulai Maret; hitung ulang Januari tetap memakai batas lama", async () => {
    const before = await jpEmployer(runs.jan!);
    const dup = await a
      .post("/payroll-parameters", {
        effectiveFrom: "2000-01-01",
        kesWageCap: 12000000,
        jpWageCap: 11000000,
        jkkRate: "0.24",
      })
      .expect(400);
    expect(dup.body.errors?.[0]?.path).toBe("effectiveFrom");
    await a
      .post("/payroll-parameters", {
        effectiveFrom: "2026-03-01",
        kesWageCap: 12000000,
        jpWageCap: 11000000,
        jkkRate: "0.24",
        note: "Batas JP 2026",
      })
      .expect(201);
    await a.post(`/payroll-runs/${runs.mar}/compute`).expect(200);
    await a.post(`/payroll-runs/${runs.jan}/compute`).expect(200);
    expect(await jpEmployer(runs.mar!)).toBe(220000);
    expect(await jpEmployer(runs.jan!)).toBe(before);
  });

  it("BP21 untuk pegawai tidak tetap & bukan pegawai; BPMP hanya pegawai tetap", async () => {
    const settings = (await a.get("/payroll/settings").expect(200)).body;
    await a.put("/payroll/settings", { ...settings, bp21NonPermanentCode: "21-100-03" }).expect(200);
    await a.post(`/payroll-runs/${runs.mar}/post`).expect(200);
    const bp21 = (
      await a.post("/withholding-slips/generate", { kind: "bp21", year: 2026, month: 3 }).expect(200)
    ).body;
    expect(bp21.created).toBe(2);
    const bpmp = (
      await a.post("/withholding-slips/generate", { kind: "bpmp", year: 2026, month: 3 }).expect(200)
    ).body;
    expect(bpmp.created).toBe(1);

    const slips = (await a.get("/withholding-slips?kind=bp21").expect(200)).body as Record<string, string>[];
    const mitra = slips.find((s) => s.employeeId === ids.Mitra)!;
    const ptt = slips.find((s) => s.employeeId === ids.PTT)!;
    expect(Number(mitra.deemedRate)).toBe(50);
    expect(Number(mitra.taxBase)).toBe(5000000);
    expect(mitra.taxObjectCode).toBeNull();
    expect(Number(ptt.deemedRate)).toBe(100);
    expect(ptt.taxObjectCode).toBe("21-100-03");

    // Bukan pegawai tanpa kode objek pajak belum bisa diekspor.
    await a.post("/withholding-slips/export", { ids: [mitra.id, ptt.id] }).expect(400);
    await a.patch(`/withholding-slips/${mitra.id}`, { taxObjectCode: "21-100-35" }).expect(200);
    const xml = (await a.post("/withholding-slips/export", { ids: [mitra.id, ptt.id] }).expect(201)).text;
    expect(xml).toContain("<Bp21Bulk");
    expect(xml).toContain("<Deemed>50</Deemed>");
    expect(xml).toContain("<Gross>10000000</Gross>");
  });

  it("parameter terakhir tidak bisa dihapus", async () => {
    const rows = (await a.get("/payroll-parameters").expect(200)).body as {
      id: string;
      effectiveFrom: string;
    }[];
    const march = rows.find((r) => r.effectiveFrom === "2026-03-01")!;
    await a.delete(`/payroll-parameters/${march.id}`).expect(200);
    const [only] = (await a.get("/payroll-parameters").expect(200)).body;
    await a.delete(`/payroll-parameters/${only.id}`).expect(400);
  });
});
