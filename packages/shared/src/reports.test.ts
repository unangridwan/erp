import { describe, expect, it } from "vitest";
import {
  latestOccurrence,
  nextOccurrence,
  reportConfigSchema,
  reportScheduleSchema,
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
