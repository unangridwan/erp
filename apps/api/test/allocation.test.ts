import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createApp, hasDb, signup } from "./helpers.js";

type Api = ReturnType<typeof client>;
interface MoveLine {
  accountId: string;
  debit: string;
  credit: string;
  costCenterId: string | null;
}

describe.skipIf(!hasDb)("Controlling: alokasi biaya periodik", () => {
  let app: INestApplication;
  let a: Api;
  const acc: Record<string, string> = {};
  const cc: Record<string, string> = {};
  const cycles: Record<string, string> = {};
  let floorKey = "";
  let headKey = "";

  const entry = async (date: string, lines: object[]) => {
    const m = (await a.post("/moves", { date, lines }).expect(201)).body;
    await a.post(`/moves/${m.id}/post`).expect(200);
  };
  const costOf = async (from: string, to: string) => {
    const r = (await a.get(`/controlling/cost-centers?dateFrom=${from}&dateTo=${to}`).expect(200)).body;
    return Object.fromEntries(r.rows.map((x: { code: string; ownActual: string }) => [x.code, x.ownActual]));
  };

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "alloc");
    for (const r of (await a.get("/accounts?limit=500").expect(200)).body.items) acc[r.code] = r.id;
    for (const [code, name] of [
      ["IT", "Teknologi Informasi"],
      ["UMUM", "Umum"],
      ["PROD", "Produksi"],
      ["SLS", "Penjualan"],
      ["GDG", "Gudang"],
    ])
      cc[code!] = (await a.post("/cost-centers", { code, name }).expect(201)).body.id;
    // Maret: biaya IT 10 jt (sewa 6 jt + gaji 4 jt), biaya Umum 9 jt.
    await entry("2026-03-10", [
      { accountId: acc["6-2000"], debit: 6_000_000, costCenterId: cc.IT },
      { accountId: acc["6-1000"], debit: 4_000_000, costCenterId: cc.IT },
      { accountId: acc["6-2000"], debit: 9_000_000, costCenterId: cc.UMUM },
      { accountId: acc["1-1200"], credit: 19_000_000 },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("validasi siklus: total persen 100, penerima ≠ sumber, kunci wajib untuk metode kunci", async () => {
    await a
      .post("/allocation-cycles", {
        code: "X",
        name: "X",
        sourceCostCenterId: cc.IT,
        method: "percent",
        receivers: [{ costCenterId: cc.PROD, percent: 50 }],
      })
      .expect(400);
    await a
      .post("/allocation-cycles", {
        code: "X",
        name: "X",
        sourceCostCenterId: cc.IT,
        method: "percent",
        receivers: [{ costCenterId: cc.IT, percent: 100 }],
      })
      .expect(400);
    await a
      .post("/allocation-cycles", {
        code: "X",
        name: "X",
        sourceCostCenterId: cc.IT,
        method: "key",
        receivers: [{ costCenterId: cc.PROD }],
      })
      .expect(400);
  });

  it("kunci statistik manual (berlaku mulai bulan) & jumlah karyawan otomatis", async () => {
    floorKey = (
      await a.post("/statistical-keys", { code: "M2", name: "Luas lantai", unit: "m²" }).expect(201)
    ).body.id;
    await a
      .put(`/statistical-keys/${floorKey}/values`, {
        period: "2026-01",
        values: [
          { costCenterId: cc.PROD, value: 300 },
          { costCenterId: cc.SLS, value: 100 },
          { costCenterId: cc.GDG, value: 600 },
        ],
      })
      .expect(200);
    await a
      .put(`/statistical-keys/${floorKey}/values`, {
        period: "2026-03",
        values: [{ costCenterId: cc.GDG, value: 100 }],
      })
      .expect(200);
    const feb = (await a.get(`/statistical-keys/${floorKey}/values?period=2026-02`).expect(200)).body;
    const mar = (await a.get(`/statistical-keys/${floorKey}/values?period=2026-03`).expect(200)).body;
    const v = (r: { rows: { code: string; value: string | null }[] }, code: string) =>
      r.rows.find((x) => x.code === code)?.value;
    expect(Number(v(feb, "GDG"))).toBe(600);
    expect(Number(v(mar, "GDG"))).toBe(100);
    expect(Number(v(mar, "PROD"))).toBe(300);

    headKey = (
      await a
        .post("/statistical-keys", { code: "HC", name: "Jumlah karyawan", kind: "headcount" })
        .expect(201)
    ).body.id;
    const dept = (await a.post("/departments", { name: "Pabrik", costCenterId: cc.PROD }).expect(201)).body
      .id;
    for (const n of ["A", "B", "C"])
      await a.post("/employees", { name: `Op ${n}`, departmentId: dept, joinDate: "2025-01-01" }).expect(201);
    await a.post("/employees", { name: "Sales", costCenterId: cc.SLS, joinDate: "2025-01-01" }).expect(201);
    await a.post("/employees", { name: "Baru", costCenterId: cc.SLS, joinDate: "2026-06-01" }).expect(201);
    const hc = (await a.get(`/statistical-keys/${headKey}/values?period=2026-03`).expect(200)).body;
    expect(Number(v(hc, "PROD"))).toBe(3);
    expect(Number(v(hc, "SLS"))).toBe(1);
    await a
      .put(`/statistical-keys/${headKey}/values`, {
        period: "2026-03",
        values: [{ costCenterId: cc.SLS, value: 5 }],
      })
      .expect(400);
  });

  it("pratinjau & jalankan bertingkat: IT → Umum/Produksi (persen), lalu Umum → Produksi/Penjualan/Gudang (luas lantai)", async () => {
    cycles.IT = (
      await a
        .post("/allocation-cycles", {
          code: "A-IT",
          name: "Biaya IT",
          sequence: 10,
          sourceCostCenterId: cc.IT,
          method: "percent",
          receivers: [
            { costCenterId: cc.UMUM, percent: 30 },
            { costCenterId: cc.PROD, percent: 70 },
          ],
        })
        .expect(201)
    ).body.id;
    cycles.UMUM = (
      await a
        .post("/allocation-cycles", {
          code: "A-UMUM",
          name: "Biaya umum",
          sequence: 20,
          sourceCostCenterId: cc.UMUM,
          method: "key",
          keyId: floorKey,
          receivers: [{ costCenterId: cc.PROD }, { costCenterId: cc.SLS }, { costCenterId: cc.GDG }],
        })
        .expect(201)
    ).body.id;

    const preview = (await a.post("/allocation-runs/preview", { period: "2026-03" }).expect(200)).body;
    expect(preview.cycles[0]).toMatchObject({ code: "A-IT", status: "ready", amount: "10000000.00" });
    expect(preview.cycles[0].receivers.map((r: { amount: string }) => r.amount)).toEqual([
      "3000000.00",
      "7000000.00",
    ]);

    const run = (await a.post("/allocation-runs", { period: "2026-03" }).expect(201)).body;
    expect(run.cycles.map((c: { status: string }) => c.status)).toEqual(["done", "done"]);
    // Umum menerima 3 jt dari IT, total 12 jt dibagi 300:100:100 (m² Maret).
    expect(run.cycles[1].amount).toBe("12000000.00");
    expect(run.cycles[1].receivers.map((r: { amount: string }) => r.amount)).toEqual([
      "7200000.00",
      "2400000.00",
      "2400000.00",
    ]);

    const cost = await costOf("2026-03-01", "2026-03-31");
    expect(cost).toMatchObject({
      IT: "0.00",
      UMUM: "0.00",
      PROD: "14200000.00",
      SLS: "2400000.00",
      GDG: "2400000.00",
    });

    // Jurnal alokasi IT: per akun asal, kredit sumber & debit penerima, bertanggal akhir bulan.
    const runs = (await a.get("/allocation-runs?period=2026-03").expect(200)).body;
    const itRun = runs.find((r: { code: string }) => r.code === "A-IT");
    const move = (await a.get(`/moves/${itRun.moveId}`).expect(200)).body;
    expect(move.date).toBe("2026-03-31");
    const lines = move.lines as MoveLine[];
    expect(lines.filter((l) => l.accountId === acc["6-2000"] && l.costCenterId === cc.IT)[0]?.credit).toBe(
      "6000000.00",
    );
    expect(lines.filter((l) => l.accountId === acc["6-1000"] && l.costCenterId === cc.PROD)[0]?.debit).toBe(
      "2800000.00",
    );

    // Tidak dijalankan dua kali untuk bulan yang sama.
    const again = (await a.post("/allocation-runs", { period: "2026-03" }).expect(201)).body;
    expect(again.cycles.map((c: { status: string }) => c.status)).toEqual(["done", "done"]);
    expect((await a.get("/allocation-runs?period=2026-03").expect(200)).body).toHaveLength(2);
  });

  it("balik: urutan dari siklus lanjutan; jalankan ulang memberi hasil sama; siklus terpakai tidak bisa dihapus", async () => {
    const runs = (await a.get("/allocation-runs?period=2026-03").expect(200)).body;
    const itRun = runs.find((r: { code: string }) => r.code === "A-IT");
    const umumRun = runs.find((r: { code: string }) => r.code === "A-UMUM");
    const blocked = await a.post(`/allocation-runs/${itRun.id}/reverse`).expect(400);
    expect(blocked.body.message).toContain("A-UMUM");
    await a.post(`/allocation-runs/${umumRun.id}/reverse`).expect(200);
    await a.post(`/allocation-runs/${itRun.id}/reverse`).expect(200);
    expect(await costOf("2026-03-01", "2026-03-31")).toMatchObject({ IT: "10000000.00", UMUM: "9000000.00" });

    const rerun = (await a.post("/allocation-runs", { period: "2026-03" }).expect(201)).body;
    expect(rerun.cycles.map((c: { amount: string }) => c.amount)).toEqual(["10000000.00", "12000000.00"]);
    expect(await costOf("2026-03-01", "2026-03-31")).toMatchObject({
      IT: "0.00",
      UMUM: "0.00",
      PROD: "14200000.00",
    });

    await a.delete(`/allocation-cycles/${cycles.IT}`).expect(400);
    await a.delete(`/statistical-keys/${floorKey}`).expect(400);
  });

  it("bulan tanpa biaya dilewati; kunci nol memberi status error", async () => {
    const apr = (await a.post("/allocation-runs/preview", { period: "2026-04" }).expect(200)).body;
    expect(apr.cycles.map((c: { status: string }) => c.status)).toEqual(["empty", "empty"]);
    await entry("2026-04-05", [
      { accountId: acc["6-2000"], debit: 1_000_000, costCenterId: cc.GDG },
      { accountId: acc["1-1200"], credit: 1_000_000 },
    ]);
    await a
      .post("/allocation-cycles", {
        code: "A-GDG",
        name: "Gudang per karyawan",
        sequence: 30,
        sourceCostCenterId: cc.GDG,
        method: "key",
        keyId: headKey,
        receivers: [{ costCenterId: cc.UMUM }],
      })
      .expect(201);
    const p = (await a.post("/allocation-runs/preview", { period: "2026-04" }).expect(200)).body;
    expect(p.cycles.find((c: { code: string }) => c.code === "A-GDG")).toMatchObject({ status: "error" });
  });
});
