import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, hasDb, signup } from "./helpers.js";

/** Nomor dokumen dengan reset tahunan: penghitung per tahun dokumen, tidak bentrok saat tanggal bolak-balik. */
describe.skipIf(!hasDb)("Urutan nomor dokumen per tahun", () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    app = await createApp();
    a = await signup(app, "urutan");
  });
  afterAll(() => app?.close());

  it("karyawan dengan tanggal masuk bolak-balik antar tahun mendapat nomor unik per tahun", async () => {
    const numbers: string[] = [];
    for (const [name, joinDate] of [
      ["Ani", "2019-03-01"],
      ["Budi", "2015-07-01"],
      ["Cici", "2019-08-01"],
      ["Dedi", "2015-01-10"],
      ["Eka", "2021-02-01"],
      ["Fajar", "2019-12-31"],
    ])
      numbers.push((await a.post("/employees", { name, joinDate }).expect(201)).body.employeeNumber);
    expect(numbers).toEqual([
      "EMP/2019/0001",
      "EMP/2015/0001",
      "EMP/2019/0002",
      "EMP/2015/0002",
      "EMP/2021/0001",
      "EMP/2019/0003",
    ]);
    // Daftar urutan menampilkan tahun terbaru.
    const seq = (await a.get("/sequences").expect(200)).body.find(
      (s: { code: string }) => s.code === "hr.employee",
    );
    expect(seq).toMatchObject({ currentYear: 2021, nextNumber: 2 });
  });

  it("kontrak bertanggal mundur melanjutkan nomor tahun itu", async () => {
    const emp = (await a.post("/employees", { name: "Gita", joinDate: "2024-01-02" }).expect(201)).body.id;
    const names: string[] = [];
    for (const dateStart of ["2024-01-02", "2025-01-02", "2024-06-01", "2025-06-01"])
      names.push(
        (await a.post("/contracts", { employeeId: emp, wage: "5000000", dateStart }).expect(201)).body.name,
      );
    const [y24a, y25a, y24b, y25b] = names.map((n) => n.split("/"));
    expect([y24a![1], y25a![1], y24b![1], y25b![1]]).toEqual(["2024", "2025", "2024", "2025"]);
    expect(Number(y24b![2])).toBe(Number(y24a![2]) + 1);
    expect(Number(y25b![2])).toBe(Number(y25a![2]) + 1);
    expect(new Set(names).size).toBe(4);
  });
});
