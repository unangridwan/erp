import type { INestApplication } from "@nestjs/common";
import { pph21Monthly } from "@erp/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

interface Line {
  code: string;
  category: string;
  amount: string;
}

/** Gross-up PPh 21, peringatan payroll, penahanan gaji, saldo cuti di slip, payroll koreksi. */
describe.skipIf(!hasDb)("Payroll: gross-up, koreksi, penahanan gaji, peringatan", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const comp: Record<string, string> = {};
  let bankJournal: string;
  let grossUp: string;
  let plain: string;
  let runId: string;

  const employee = async (name: string, extra: object, contract: object) => {
    const id = (await a.post("/employees", { name, joinDate: "2025-01-02", ...extra }).expect(201)).body.id;
    const c = (
      await a
        .post("/contracts", { employeeId: id, wage: "10000000", dateStart: "2025-01-02", ...contract })
        .expect(201)
    ).body;
    await a.post(`/contracts/${c.id}/start`).expect(200);
    return id as string;
  };
  const slipOf = async (run: string, employeeId: string) => {
    const body = (await a.get(`/payroll-runs/${run}`).expect(200)).body;
    const slip = body.payslips.find((p: { employeeId: string }) => p.employeeId === employeeId);
    return (await a.get(`/payslips/${slip.id}`).expect(200)).body;
  };
  const line = (slip: { lines: Line[] }, code: string) => slip.lines.find((l) => l.code === code);

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "pyd");
    for (const c of (await a.get("/salary-components").expect(200)).body.items) comp[c.code] = c.id;
    bankJournal = (await a.get("/journals").expect(200)).body.items.find(
      (j: { code: string }) => j.code === "BNK1",
    ).id;
    grossUp = await employee(
      "Gross Up",
      { nik: "3201010101010001", bankName: "BCA", bankAccount: "1234567890", bpjsKesNo: "1", bpjsTkNo: "1" },
      { taxMethod: "gross_up" },
    );
    // Tanpa rekening & NIK/NPWP → peringatan.
    plain = await employee("Tanpa Rekening", { bpjsKesNo: "2", bpjsTkNo: "2" }, { wage: "8000000" });
    const leaveTypes = (await a.get("/leave-types").expect(200)).body.items as { id: string; name: string }[];
    await a
      .post("/leave-allocations", {
        employeeId: grossUp,
        leaveTypeId: leaveTypes.find((t) => t.name === "Cuti tahunan")!.id,
        days: "12",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
      })
      .expect(201);
    runId = (await a.post("/payroll-runs", { period: "2026-09", paymentDate: "2026-09-28" }).expect(201)).body
      .id;
  });
  afterAll(() => app?.close());

  it("gross-up: tunjangan PPh 21 = PPh 21, gaji bersih utuh; kontrak biasa tetap dipotong", async () => {
    const slip = await slipOf(runId, grossUp);
    const allowance = line(slip, "TUNJ_PPH21")!;
    expect(allowance.category).toBe("allowance");
    expect(Number(allowance.amount)).toBe(Number(slip.pph21));
    expect(Number(slip.pph21)).toBeGreaterThan(0);
    expect(Number(slip.net)).toBe(10_000_000 - Number(slip.employeeBpjs));
    const other = await slipOf(runId, plain);
    expect(line(other, "TUNJ_PPH21")).toBeUndefined();
    expect(Number(other.net)).toBe(8_000_000 - Number(other.employeeBpjs) - Number(other.pph21));
    // Saldo cuti per akhir periode ikut di slip.
    expect(slip.leaveBalances).toEqual([
      expect.objectContaining({ leaveTypeName: "Cuti tahunan", remaining: "12.00" }),
    ]);
  });

  it("peringatan payroll: rekening & NIK/NPWP kosong, slip pertama", async () => {
    const warnings = (await a.get(`/payroll-runs/${runId}/warnings`).expect(200)).body as {
      code: string;
      severity: string;
      employeeId: string;
    }[];
    const of = (id: string) => warnings.filter((w) => w.employeeId === id).map((w) => w.code);
    expect(of(plain)).toEqual(expect.arrayContaining(["no_bank_account", "no_tax_id", "first_payslip"]));
    expect(warnings.find((w) => w.code === "no_bank_account")?.severity).toBe("error");
    expect(of(grossUp)).not.toContain("no_bank_account");
    expect(of(grossUp)).not.toContain("no_tax_id");
  });

  it("penahanan gaji: tidak ikut transfer & pembayaran; dilepas dengan pembayaran terpisah", async () => {
    const held = await slipOf(runId, plain);
    await a.post(`/payslips/${held.id}/hold`, { reason: "" }).expect(400);
    await a.post(`/payslips/${held.id}/hold`, { reason: "Dokumen serah terima belum lengkap" }).expect(200);
    const warnings = (await a.get(`/payroll-runs/${runId}/warnings`).expect(200)).body as { code: string }[];
    expect(warnings.map((w) => w.code)).toContain("held");
    // Gaji ditahan tidak butuh rekening untuk saat ini.
    expect(warnings.map((w) => w.code)).not.toContain("no_bank_account");
    await a.post(`/payslips/${held.id}/release`, { journalId: bankJournal, date: "2026-09-28" }).expect(400);

    await a.post(`/payroll-runs/${runId}/post`).expect(200);
    const transfer = (await a.get(`/payroll-runs/${runId}/bank-transfer`).expect(200)).body as {
      name: string;
    }[];
    expect(transfer.map((t) => t.name)).toEqual(["Gross Up"]);
    const paid = (
      await a.post(`/payroll-runs/${runId}/pay`, { journalId: bankJournal, date: "2026-09-28" }).expect(200)
    ).body;
    const gu = await slipOf(runId, grossUp);
    const total = (await a.get(`/moves/${paid.paymentMove.id}`).expect(200)).body.lines.reduce(
      (s: number, l: { debit: string }) => s + Number(l.debit),
      0,
    );
    expect(total).toBe(Number(gu.net));
    await a.post(`/payslips/${held.id}/unhold`).expect(400);

    const released = (
      await a.post(`/payslips/${held.id}/release`, { journalId: bankJournal, date: "2026-10-05" }).expect(200)
    ).body;
    expect(released.releasedAt).toBeTruthy();
    const move = (await a.get(`/moves/${released.releaseMoveId}`).expect(200)).body;
    expect(
      move.lines.map((l: { debit: string }) => Number(l.debit)).sort((x: number, y: number) => y - x)[0],
    ).toBe(Number(held.net));
    await a.post(`/payslips/${held.id}/release`, { journalId: bankJournal, date: "2026-10-05" }).expect(400);
  });

  it("payroll koreksi: hanya selisih, PPh 21 atas bruto gabungan masa yang sama, dijurnal terpisah", async () => {
    // Payroll reguler kedua untuk bulan yang sama tetap ditolak.
    await a.post("/payroll-runs", { period: "2026-09", paymentDate: "2026-09-30" }).expect(409);
    await a
      .post(`/payroll-runs/${runId}/corrections`, { paymentDate: "2026-10-10", employeeIds: [] })
      .expect(400);
    const outsider = await employee("Bukan Peserta", {}, { dateStart: "2026-10-01" });
    await a
      .post(`/payroll-runs/${runId}/corrections`, { paymentDate: "2026-10-10", employeeIds: [outsider] })
      .expect(400);

    const correction = (
      await a
        .post(`/payroll-runs/${runId}/corrections`, { paymentDate: "2026-10-10", employeeIds: [plain] })
        .expect(201)
    ).body;
    expect(correction).toMatchObject({ kind: "correction", correctsRunId: runId, periodStart: "2026-09-01" });
    expect(correction.name).toContain("Koreksi");
    await a.post(`/payroll-runs/${correction.id}/thr`, { mode: "auto" }).expect(400);
    const empty = await slipOf(correction.id, plain);
    expect(line(empty, "BASIC")).toBeUndefined();
    expect(empty.net).toBe("0.00");

    const original = await slipOf(runId, plain);
    const corrected = (
      await a
        .put(`/payslips/${empty.id}/inputs`, {
          inputs: [{ componentId: comp.BONUS, amount: "1000000", description: "Bonus kurang bayar" }],
        })
        .expect(200)
    ).body;
    // Tanpa BPJS; PPh 21 = PPh 21 masa (bruto asli + 1 jt) − PPh 21 slip asli.
    expect(corrected).toMatchObject({ gross: "1000000.00", employeeBpjs: "0.00" });
    const masa = pph21Monthly(Number(original.gross) + 1_000_000, "TK/0", false);
    expect(Number(corrected.pph21)).toBe(Number(masa.tax) - Number(original.pph21));
    expect(Number(corrected.net)).toBe(1_000_000 - Number(corrected.pph21));

    // Gross-up di koreksi: tunjangan PPh 21 menutup tambahan pajak.
    const second = (
      await a
        .post(`/payroll-runs/${runId}/corrections`, { paymentDate: "2026-10-10", employeeIds: [grossUp] })
        .expect(201)
    ).body;
    const guSlip = await slipOf(second.id, grossUp);
    const gu = (
      await a
        .put(`/payslips/${guSlip.id}/inputs`, { inputs: [{ componentId: comp.BONUS, amount: "2000000" }] })
        .expect(200)
    ).body;
    expect(Number(line(gu, "TUNJ_PPH21")!.amount)).toBe(Number(gu.pph21));
    expect(gu.net).toBe("2000000.00");

    // Koreksi kosong tidak bisa diposting.
    const blank = (
      await a
        .post(`/payroll-runs/${runId}/corrections`, { paymentDate: "2026-10-10", employeeIds: [plain] })
        .expect(201)
    ).body;
    await a.post(`/payroll-runs/${blank.id}/post`).expect(400);
    await a.post(`/payroll-runs/${blank.id}/cancel`).expect(200);
    const posted = (await a.post(`/payroll-runs/${correction.id}/post`).expect(200)).body;
    expect(posted.state).toBe("done");
    expect(posted.accountMove).toBeTruthy();
    const runs = (await a.get("/payroll-runs").expect(200)).body as { kind: string }[];
    expect(runs.filter((r) => r.kind === "correction")).toHaveLength(3);
  });
});
