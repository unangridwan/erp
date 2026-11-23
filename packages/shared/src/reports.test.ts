import { describe, expect, it } from "vitest";
import {
  latestOccurrence,
  nextOccurrence,
  reportConfigSchema,
  reportScheduleSchema,
  drillReport,
  runReport,
} from "./reports.js";

const columns = [
  { key: "name", header: "Nama" },
  { key: "dept", header: "Departemen" },
  { key: "gender", header: "Jenis kelamin" },
  { key: "wage", header: "Upah", numeric: true },
];
const data = [
  { name: "Ani", dept: "Keuangan", gender: "P", wage: "8000000" },
  { name: "Budi", dept: "Keuangan", gender: "L", wage: "12000000" },
  { name: "Cici", dept: "IT", gender: "P", wage: "15000000" },
  { name: "Dedi", dept: "IT", gender: "L", wage: "" },
];
const cfg = (c: object) => reportConfigSchema.parse(c);

describe("pembuat laporan", () => {
  it("kolom terpilih, syarat, urutan, batas", () => {
    const r = runReport(
      data,
      columns,
      cfg({
        columns: ["name", "wage"],
        conditions: [{ column: "wage", op: "gte", value: "10000000" }],
        sort: { column: "wage", dir: "desc" },
      }),
    );
    expect(r.columns.map((c) => c.key)).toEqual(["name", "wage"]);
    expect(r.rows).toEqual([
      { name: "Cici", wage: "15000000" },
      { name: "Budi", wage: "12000000" },
    ]);
    expect(r.totals).toEqual({ wage: 27000000 });
    const limited = runReport(data, columns, cfg({ columns: ["name"], limit: 1, sort: { column: "name" } }));
    expect(limited).toMatchObject({ total: 4, rows: [{ name: "Ani" }] });
    expect(
      runReport(data, columns, cfg({ conditions: [{ column: "wage", op: "empty" }] })).rows,
    ).toHaveLength(1);
    // Syarat tanpa nilai (sedang disusun) diabaikan.
    expect(
      runReport(data, columns, cfg({ conditions: [{ column: "name", op: "eq", value: " " }] })).rows,
    ).toHaveLength(4);
    expect(
      runReport(data, columns, cfg({ conditions: [{ column: "name", op: "contains", value: "DI" }] })).rows,
    ).toHaveLength(2);
  });

  it("kelompok & agregasi sum/count/avg/min/max", () => {
    const r = runReport(
      data,
      columns,
      cfg({
        groupBy: ["dept"],
        aggregates: [
          { column: "*", fn: "count" },
          { column: "wage", fn: "sum" },
          { column: "wage", fn: "avg" },
          { column: "wage", fn: "max" },
        ],
        sort: { column: "dept" },
      }),
    );
    expect(r.columns.map((c) => c.header)).toEqual([
      "Departemen",
      "Banyaknya data",
      "Jumlah Upah",
      "Rata-rata Upah",
      "Maksimum Upah",
    ]);
    expect(r.rows).toEqual([
      { dept: "IT", "count__*": 2, sum__wage: 15000000, avg__wage: 15000000, max__wage: 15000000 },
      { dept: "Keuangan", "count__*": 2, sum__wage: 20000000, avg__wage: 10000000, max__wage: 12000000 },
    ]);
    const two = runReport(
      data,
      columns,
      cfg({ groupBy: ["dept", "gender"], aggregates: [{ column: "*", fn: "count" }] }),
    );
    expect(two.rows).toHaveLength(4);
  });

  it("kolom tak dikenal ditolak", () => {
    expect(() => runReport(data, columns, cfg({ columns: ["salary"] }))).toThrow(/tidak dikenal: salary/);
  });

  it("syarat menerima angka format Indonesia dan tanggal D/M/YYYY", () => {
    const big = runReport(
      data,
      columns,
      cfg({ columns: ["name"], conditions: [{ column: "wage", op: "gt", value: "10.000.000" }] }),
    );
    expect(big.rows.map((r) => r.name)).toEqual(["Budi", "Cici"]);
    const dec = runReport(
      data,
      columns,
      cfg({ columns: ["name"], conditions: [{ column: "wage", op: "lte", value: "8.000.000,5" }] }),
    );
    expect(dec.rows.map((r) => r.name)).toEqual(["Ani"]);
    const dated = [
      { name: "A", date: "2025-12-31" },
      { name: "B", date: "2026-01-15" },
    ];
    const cols = [
      { key: "name", header: "Nama" },
      { key: "date", header: "Tanggal" },
    ];
    const r = runReport(dated, cols, cfg({ conditions: [{ column: "date", op: "gte", value: "1/1/2026" }] }));
    expect(r.rows.map((x) => x.name)).toEqual(["B"]);
  });

  it("urutan pada kolom yang tidak ada di hasil diabaikan (laporan diubah ke ringkasan)", () => {
    const r = runReport(
      data,
      columns,
      cfg({
        groupBy: ["dept"],
        aggregates: [{ column: "*", fn: "count" }],
        sort: { column: "name", dir: "asc" },
      }),
    );
    expect(r.rows).toHaveLength(2);
  });

  it("jadwal: kejadian terakhir & berikutnya sesuai zona waktu, kunci periode", () => {
    const tz = "Asia/Jakarta";
    // Rabu 29 Okt 2026 10:00 WIB = 03:00Z.
    const now = new Date("2026-10-29T03:00:00Z");
    expect(latestOccurrence({ frequency: "daily", hour: 7 }, now, tz)).toEqual({
      at: new Date("2026-10-29T00:00:00Z"),
      period: "2026-10-29",
    });
    expect(latestOccurrence({ frequency: "daily", hour: 11 }, now, tz)?.period).toBe("2026-10-28");
    expect(latestOccurrence({ frequency: "weekly", hour: 8, weekday: 1 }, now, tz)?.period).toBe(
      "2026-10-26",
    );
    expect(latestOccurrence({ frequency: "monthly", hour: 8, monthday: 1 }, now, tz)).toEqual({
      at: new Date("2026-10-01T01:00:00Z"),
      period: "2026-10",
    });
    expect(nextOccurrence({ frequency: "daily", hour: 7 }, now, tz)).toEqual(
      new Date("2026-10-30T00:00:00Z"),
    );
    expect(nextOccurrence({ frequency: "weekly", hour: 7, weekday: 5 }, now, tz)).toEqual(
      new Date("2026-10-30T00:00:00Z"),
    );
    expect(nextOccurrence({ frequency: "monthly", hour: 7, monthday: 1 }, now, tz)).toEqual(
      new Date("2026-11-01T00:00:00Z"),
    );
  });

  it("validasi jadwal", () => {
    expect(reportScheduleSchema.safeParse({ frequency: "weekly", recipients: ["a@b.co"] }).success).toBe(
      false,
    );
    expect(reportScheduleSchema.safeParse({ frequency: "daily", recipients: [] }).success).toBe(false);
    expect(reportScheduleSchema.parse({ frequency: "daily", recipients: ["A@B.CO"] }).recipients).toEqual([
      "a@b.co",
    ]);
  });
});

describe("drilldown laporan", () => {
  const linked = data.map((r, i) => ({
    ...r,
    _model: "employee",
    _id: `e${i}`,
    _deptId: r.dept === "IT" ? "d2" : "d1",
  }));
  const grouped = cfg({
    groupBy: ["dept"],
    aggregates: [{ column: "wage", fn: "sum" }],
    conditions: [{ column: "gender", op: "eq", value: "P" }],
  });

  it("baris tanpa kelompok membawa referensi dokumen", () => {
    const r = runReport(linked, columns, cfg({ columns: ["name"] }));
    expect(r.rows[0]).toEqual({ name: "Ani", _model: "employee", _id: "e0" });
  });

  it("rincian satu kelompok: syarat tetap berlaku, kolom kelompok & agregat di depan", () => {
    const r = drillReport(linked, columns, grouped, { dept: "IT" });
    expect(r.rows).toEqual([
      { dept: "IT", wage: "15000000", name: "Cici", gender: "P", _model: "employee", _id: "e2" },
    ]);
    expect(r.columns.map((c) => c.key)).toEqual(["dept", "wage", "name", "gender"]);
    expect(r.totals).toEqual({ wage: 15000000 });
  });

  it("kunci tersembunyi & kolom tak dikenal", () => {
    expect(drillReport(linked, columns, cfg({}), { _deptId: "d1" }).total).toBe(2);
    expect(() => drillReport(linked, columns, cfg({}), { nope: "x" })).toThrow(/tidak dikenal/);
  });
});
