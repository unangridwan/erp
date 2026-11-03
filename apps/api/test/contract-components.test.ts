import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/**
 * Kontrak kerja memuat komponen gaji selain gaji pokok: tunjangan tetap, tunjangan per hari hadir (nilai kosong = tarif
 * bawaan), potongan, dan komponen otomatis — diisi langsung saat menambah karyawan dan tampil di dokumen kontrak.
 */
describe.skipIf(!hasDb)("Komponen gaji di kontrak", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;
  const comp: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "kompkontrak");
    const make = async (code: string, body: object) =>
      (comp[code] = (await a.post("/salary-components", { code, ...body }).expect(201)).body.id);
    await make("TJ_TRANS", { name: "Tunjangan transport", kind: "allowance", fixed: true });
    await make("U_MAKAN", {
      name: "Uang makan",
      kind: "allowance",
      calc: "per_attendance_day",
      rate: "30000",
    });
    await make("TJ_KOM", {
      name: "Tunjangan komunikasi",
      kind: "allowance",
      fixed: true,
      autoAssign: true,
      rate: "100000",
    });
    await make("KOP", { name: "Iuran koperasi", kind: "deduction" });
  });
  afterAll(() => app?.close());

  const contract = (allowances: object[]) => ({
    dateStart: "2026-11-16",
    contractType: "pkwtt",
    wage: 6000000,
    allowances,
  });

  it("komponen tidak dikenal atau ganda ditolak; karyawan tidak tersimpan", async () => {
    const before = (await a.get("/employees?limit=100").expect(200)).body.total;
    const unknown = await a
      .post("/employees", {
        name: "Gagal",
        contract: contract([{ componentId: "00000000-0000-4000-8000-000000000000", amount: 1 }]),
      })
      .expect(400);
    expect(unknown.body.errors?.[0]?.path).toBe("contract.allowances.0.componentId");
    const dup = await a
      .post("/employees", {
        name: "Gagal",
        contract: contract([
          { componentId: comp.TJ_TRANS, amount: 1 },
          { componentId: comp.TJ_TRANS, amount: 2 },
        ]),
      })
      .expect(400);
    expect(dup.body.errors?.[0]?.path).toBe("contract.allowances");
    expect((await a.get("/employees?limit=100").expect(200)).body.total).toBe(before);
  });

  it("karyawan baru + kontrak dengan tunjangan, uang makan per hari & potongan", async () => {
    const created = (
      await a
        .post("/employees", {
          name: "Sari Komponen",
          contract: contract([
            { componentId: comp.TJ_TRANS, amount: 500000 },
            { componentId: comp.U_MAKAN, amount: 0 },
            { componentId: comp.KOP, amount: "50000" },
          ]),
        })
        .expect(201)
    ).body;
    const c = (await a.get(`/contracts/${created.contractId}`).expect(200)).body;
    expect(c.state).toBe("running");
    expect(
      (c.allowances as { code: string; amount: string }[]).map((x) => [x.code, Number(x.amount)]).sort(),
    ).toEqual([
      ["KOP", 50000],
      ["TJ_TRANS", 500000],
      ["U_MAKAN", 0],
    ]);

    // Ringkasan penggajian karyawan: komponen kontrak + komponen otomatis; tunjangan tetap = transport + komunikasi.
    const overview = (await a.get(`/employees/${created.id}/overview`).expect(200)).body;
    expect(Number(overview.contract.fixedAllowance)).toBe(600000);
    expect(overview.contract.components.map((x: { name: string }) => x.name)).toEqual(
      expect.arrayContaining(["Tunjangan transport", "Uang makan", "Iuran koperasi", "Tunjangan komunikasi"]),
    );

    // Dokumen kontrak mencantumkan tunjangan tidak tetap (tarif bawaan) & potongan.
    const doc = (await a.get(`/contracts/${created.contractId}/document`).expect(200)).body;
    expect(doc.body).toContain("Tunjangan transport Rp 500.000");
    expect(doc.body).toContain("Tunjangan komunikasi Rp 100.000");
    expect(doc.body).toContain("Uang makan Rp 30.000 per hari hadir");
    expect(doc.body).toContain("Iuran koperasi Rp 50.000 per bulan");
  });
});
