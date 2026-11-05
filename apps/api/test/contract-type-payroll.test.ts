import type { INestApplication } from "@nestjs/common";
import { progressiveTax } from "@erp/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

interface Line {
  code: string;
  amount: string;
}

/**
 * Aturan penggajian per jenis kontrak (SDM › Konfigurasi › Jenis Kontrak): ikut payroll, BPJS per program, kategori
 * PPh 21, THR, pesangon/kompensasi (lembur diatur per karyawan). Kepesertaan BPJS = jenis kontrak ∧ centang di data karyawan.
 */
describe.skipIf(!hasDb)("Jenis kontrak: aturan payroll", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const ids: Record<string, string> = {};
  let runId: string;

  const employee = async (key: string, contract: object, extra: object = {}) => {
    const body = (
      await a
        .post("/employees", {
          name: key,
          bpjsKesNo: "1",
          bpjsTkNo: "1",
          ...extra,
          contract: { dateStart: "2026-01-05", wage: 6000000, ...contract },
        })
        .expect(201)
    ).body as { id: string };
    ids[key] = body.id;
  };
  const slipOf = async (employeeId: string) => {
    const run = (await a.get(`/payroll-runs/${runId}`).expect(200)).body;
    const slip = run.payslips.find((p: { employeeId: string }) => p.employeeId === employeeId);
    return (
      slip &&
      ((await a.get(`/payslips/${slip.id}`).expect(200)).body as { lines: Line[] } & Record<string, string>)
    );
  };
  const amount = (slip: { lines: Line[] }, code: string) =>
    Math.abs(Number(slip.lines.find((l) => l.code === code)?.amount ?? 0));

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "jkpayroll");
    const types = (await a.get("/contract-types").expect(200)).body as { id: string; code: string }[];
    // Jenis baru yang tidak ikut payroll (mis. dibayar lewat tagihan vendor).
    await a
      .post("/contract-types", {
        code: "outsourcing",
        name: "Outsourcing",
        inPayroll: false,
        severance: "none",
      })
      .expect(201);
    expect(types.map((t) => t.code)).toContain("magang");
    await employee("Tetap", { contractType: "pkwtt" });
    await employee("Tetap Tanpa Kes", { contractType: "pkwtt" }, { bpjsKesEnrolled: false });
    await employee(
      "Magang",
      { contractType: "magang", dateEnd: "2026-12-31", wage: 3000000 },
      { overtimeEligible: false },
    );
    await employee("Mitra", { contractType: "mitra", wage: 10000000 }, { nik: "3201010101010009" });
    await employee("Outsourcing", { contractType: "outsourcing" });
    runId = (await a.post("/payroll-runs", { period: "2026-03", paymentDate: "2026-03-28" }).expect(201)).body
      .id;
  });
  afterAll(() => app?.close());

  it("jenis tidak ikut payroll tidak mendapat slip", async () => {
    expect(await slipOf(ids.Outsourcing!)).toBeUndefined();
    expect(await slipOf(ids.Tetap!)).toBeDefined();
  });

  it("BPJS per program mengikuti jenis kontrak ∧ data karyawan", async () => {
    const tetap = (await slipOf(ids.Tetap!))!;
    for (const code of ["BPJS_KES_ER", "JHT_ER", "JKK", "JKM", "JP_ER"])
      expect(amount(tetap, code)).toBeGreaterThan(0);
    const noKes = (await slipOf(ids["Tetap Tanpa Kes"]!))!;
    expect(amount(noKes, "BPJS_KES_ER")).toBe(0);
    expect(amount(noKes, "JHT_ER")).toBeGreaterThan(0);
    // Magang: hanya JKK & JKM.
    const magang = (await slipOf(ids.Magang!))!;
    expect(amount(magang, "JKK")).toBeGreaterThan(0);
    expect(amount(magang, "JKM")).toBeGreaterThan(0);
    for (const code of ["BPJS_KES_ER", "JHT_ER", "JP_ER"]) expect(amount(magang, code)).toBe(0);
    expect(Number(magang.employeeBpjs)).toBe(0);
    // Mitra: tanpa BPJS sama sekali; PPh 21 bukan pegawai = Pasal 17 atas 50% bruto.
    const mitra = (await slipOf(ids.Mitra!))!;
    expect(Number(mitra.employerBpjs)).toBe(0);
    expect(Number(mitra.pph21)).toBe(Number(progressiveTax(5_000_000)));
    expect(mitra.taxCategory).toBe("non_employee");
  });

  it("aturan jenis kontrak bisa diubah tenant (mis. magang ikut BPJS Kesehatan)", async () => {
    const magangType = (
      (await a.get("/contract-types").expect(200)).body as { id: string; code: string }[]
    ).find((t) => t.code === "magang")!;
    const current = (await a.get(`/contract-types/${magangType.id}`).expect(200)).body;
    await a.put(`/contract-types/${magangType.id}`, { ...current, bpjsKes: true }).expect(200);
    await a.post(`/payroll-runs/${runId}/compute`).expect(200);
    expect(amount((await slipOf(ids.Magang!))!, "BPJS_KES_ER")).toBeGreaterThan(0);
  });

  it("lembur: karyawan tanpa hak lembur ditolak (diatur per karyawan)", async () => {
    const res = await a
      .post("/overtimes", { employeeId: ids.Magang, date: "2026-03-10", hours: "2" })
      .expect(400);
    expect(res.body.errors?.[0]?.message).toMatch(/tidak berhak upah lembur/);
    await a.post("/overtimes", { employeeId: ids.Tetap, date: "2026-03-10", hours: "2" }).expect(201);
  });

  it("pesangon mengikuti jenis kontrak", async () => {
    const preview = (id: string, reason: string) =>
      a.post(`/employees/${id}/severance/preview`, { reason, endDate: "2026-03-31" });
    expect((await preview(ids.Tetap!, "pkwt_end").expect(400)).body.errors[0].path).toBe("reason");
    await preview(ids.Tetap!, "efficiency_loss").expect(200);
    expect((await preview(ids.Mitra!, "efficiency_loss").expect(400)).body.errors[0].message).toMatch(
      /tidak mendapat pesangon/,
    );
  });
});
