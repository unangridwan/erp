import { describe, expect, it } from "vitest";
import {
  biDocumentSchema,
  biVisualSchema,
  builtinDocument,
  dateLevelValue,
  documentErrors,
  layoutFlow,
  reportResultToVisual,
  runVisual,
  shiftTimeKey,
  type BiVisualInput,
} from "./bi.js";
import { evaluateFormula, FormulaError, parseFormula } from "./bi-formula.js";
import { BUILTIN_DASHBOARDS } from "./dashboard.js";

const cols = [
  { key: "date", header: "Tanggal" },
  { key: "partner", header: "Pelanggan" },
  { key: "region", header: "Wilayah" },
  { key: "product", header: "Produk" },
  { key: "amount", header: "Omzet", numeric: true },
  { key: "cost", header: "HPP", numeric: true },
];
const rows = [
  { date: "2025-03-10", partner: "A", region: "Jawa", product: "P1", amount: 100, cost: 60 },
  { date: "2026-01-05", partner: "A", region: "Jawa", product: "P1", amount: 200, cost: 120 },
  { date: "2026-01-20", partner: "B", region: "Sumatra", product: "P2", amount: 300, cost: 150 },
  { date: "2026-02-14", partner: "A", region: "Jawa", product: "P2", amount: 50, cost: 20 },
  { date: "2026-03-03", partner: "C", region: "Sumatra", product: "P1", amount: 400, cost: 300 },
  { date: "2026-03-28", partner: "B", region: "Sumatra", product: "P1", amount: 150, cost: 90 },
];
const v = (p: Partial<BiVisualInput>) =>
  biVisualSchema.parse({ id: "v1", type: "column", dataset: "s", layout: { x: 0, y: 0, w: 6, h: 6 }, ...p });
const sum = (column: string, id = "m1", extra = {}) => ({ id, column, fn: "sum" as const, ...extra });

describe("rumus ukuran", () => {
  it("menghitung aritmetika, fungsi, dan pembagian dengan nol", () => {
    const vals: Record<string, number | null> = { omzet: 1000, hpp: 600, nol: 0, kosong: null };
    const ev = (src: string) => evaluateFormula(parseFormula(src), (n) => vals[n.toLowerCase()] ?? null);
    expect(ev("[Omzet] - [HPP]")).toBe(400);
    expect(ev("([Omzet] - [HPP]) / [Omzet] * 100")).toBe(40);
    expect(ev("DIVIDE([Omzet], [Nol])")).toBeNull();
    expect(ev("DIVIDE([Omzet], [Nol], 0)")).toBe(0);
    expect(ev("[Omzet] / [Nol]")).toBeNull();
    expect(ev("ROUND(10 / 3, 2)")).toBe(3.33);
    expect(ev("MAX([HPP], 700, -1)")).toBe(700);
    expect(ev("IF([Omzet] > 500, 1, 2)")).toBe(1);
    expect(ev("-[HPP] + 1e3")).toBe(400);
    // Kosong dianggap 0 pada penjumlahan, tetapi kosong pada perkalian.
    expect(ev("[Omzet] - [Kosong]")).toBe(1000);
    expect(ev("[Omzet] * [Kosong]")).toBeNull();
  });

  it("menolak rumus rusak dengan pesan jelas", () => {
    for (const bad of ["", "[Omzet", "1 +", "FOO(1)", "DIVIDE(1)", "(1 + 2", "1 $ 2", "[]"])
      expect(() => parseFormula(bad), bad).toThrow(FormulaError);
  });
});

describe("hierarki tanggal", () => {
  it("menurunkan level tahun/kuartal/bulan/minggu/hari", () => {
    expect(dateLevelValue("2026-03-28", "year")).toBe("2026");
    expect(dateLevelValue("2026-03-28", "quarter")).toBe("2026-Q1");
    expect(dateLevelValue("2026-11-02", "quarter")).toBe("2026-Q4");
    expect(dateLevelValue("2026-03-28", "month")).toBe("2026-03");
    expect(dateLevelValue("2026-01-01", "week")).toBe("2026-W01");
    expect(dateLevelValue("2027-01-01", "week")).toBe("2026-W53");
    expect(dateLevelValue("2026-03-28", "day")).toBe("2026-03-28");
    expect(dateLevelValue("2026-03", "month")).toBe("2026-03");
    expect(dateLevelValue("2026-03", "day")).toBe("");
    expect(dateLevelValue("bukan tanggal", "year")).toBe("");
    expect(shiftTimeKey("2026-03", -1)).toBe("2025-03");
    expect(shiftTimeKey("2024-02-29", 1)).toBe("2025-02-28");
    expect(shiftTimeKey("2026-Q2", 1)).toBe("2027-Q2");
    expect(shiftTimeKey("Jawa", 1)).toBe("Jawa");
  });

  it("grafik per bulan urut waktu; drill tahun → bulan", () => {
    const r = runVisual(
      rows,
      cols,
      v({ axis: [{ column: "date", level: "month" }], values: [sum("amount")] }),
    );
    expect(r.categories.map((c) => c.key)).toEqual(["2025-03", "2026-01", "2026-02", "2026-03"]);
    expect(r.series[0]!.values).toEqual([100, 500, 50, 550]);
    expect(r.fields[0]).toMatchObject({ key: "date@month", header: "Tanggal (Bulan)" });

    const h = v({
      axis: [
        { column: "date", level: "year" },
        { column: "date", level: "month" },
      ],
      values: [sum("amount")],
    });
    expect(runVisual(rows, cols, h).categories.map((c) => c.key)).toEqual(["2025", "2026"]);
    const down = runVisual(rows, cols, h, { drill: { depth: 1, path: ["2026"] } });
    expect(down.categories.map((c) => c.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(down.drill).toEqual({ depth: 1, maxDepth: 1, path: ["2026"] });
    const all = runVisual(rows, cols, h, { drill: { depth: 1, expandAll: true } });
    expect(all.categories.map((c) => c.label)).toContain("2026 · 2026-03");
  });
});

describe("mesin visual", () => {
  it("kategori non-waktu diurutkan menurut nilai menurun; Top N", () => {
    const r = runVisual(rows, cols, v({ axis: [{ column: "partner" }], values: [sum("amount")], topN: 2 }));
    expect(r.categories.map((c) => c.key)).toEqual(["B", "C"]);
    expect(r.truncated).toBe(true);
    const asc = runVisual(
      rows,
      cols,
      v({ axis: [{ column: "partner" }], values: [sum("amount")], sort: { by: "partner", dir: "asc" } }),
    );
    expect(asc.categories.map((c) => c.key)).toEqual(["A", "B", "C"]);
  });

  it("legenda menghasilkan satu seri per nilai", () => {
    const r = runVisual(
      rows,
      cols,
      v({ axis: [{ column: "region" }], legend: { column: "product" }, values: [sum("amount")] }),
    );
    expect(r.categories.map((c) => c.key)).toEqual(["Sumatra", "Jawa"]);
    const p1 = r.series.find((s) => s.label === "P1")!;
    const p2 = r.series.find((s) => s.label === "P2")!;
    expect(p1.values).toEqual([550, 300]);
    expect(p2.values).toEqual([300, 50]);
  });

  it("ukuran terhitung (laba, margin) dengan ukuran tersembunyi", () => {
    const r = runVisual(
      rows,
      cols,
      v({
        type: "table",
        axis: [{ column: "partner" }],
        values: [
          sum("amount", "m1", { label: "Omzet" }),
          sum("cost", "m2", { label: "HPP", hidden: true }),
          { id: "m3", label: "Laba", formula: "[Omzet] - [HPP]" },
          { id: "m4", label: "Margin", formula: "DIVIDE([Laba], [Omzet]) * 100", format: "percent" },
        ],
        sort: { by: "partner", dir: "asc" },
      }),
    );
    expect(r.fields.map((f) => f.key)).toEqual(["partner", "m1", "m3", "m4"]);
    expect(r.rows[0]).toEqual({ partner: "A", m1: 350, m3: 150, m4: 42.8571 });
    expect(r.totals).toMatchObject({ m1: 1200, m3: 460 });
  });

  it("rumus merujuk ukuran tak dikenal atau melingkar → galat", () => {
    expect(() =>
      runVisual(rows, cols, v({ axis: [{ column: "partner" }], values: [{ id: "m1", formula: "[X] + 1" }] })),
    ).toThrow(/tidak ditemukan/);
    expect(() =>
      runVisual(
        rows,
        cols,
        v({
          axis: [{ column: "partner" }],
          values: [
            { id: "a", formula: "[b] + 1" },
            { id: "b", formula: "[a] * 2" },
          ],
        }),
      ),
    ).toThrow(/melingkar/);
    expect(() => runVisual(rows, cols, v({ axis: [{ column: "nope" }], values: [sum("amount")] }))).toThrow(
      /tidak dikenal: nope/,
    );
  });

  it("tampilkan sebagai: % total, total berjalan, selisih, YoY", () => {
    const month = { column: "date", level: "month" as const };
    const run = (showAs: string) =>
      runVisual(rows, cols, v({ axis: [month], values: [sum("amount", "m1", { showAs })] })).series[0]!
        .values;
    expect(run("pct_total")).toEqual([8.33, 41.67, 4.17, 45.83]);
    expect(run("running_total")).toEqual([100, 600, 650, 1200]);
    expect(run("diff_prev")).toEqual([null, 400, -450, 500]);
    expect(run("pct_prev")).toEqual([null, 400, -90, 1000]);
    // Tanpa periode: tahun lalu dicari di data yang sama (2026-03 vs 2025-03).
    expect(run("last_year")).toEqual([null, null, null, 100]);
    expect(run("yoy")).toEqual([null, null, null, 450]);
    // Dengan baris tahun lalu dari server (periode dashboard).
    const r = runVisual(
      rows.slice(1),
      cols,
      v({ axis: [month], values: [sum("amount", "m1", { showAs: "yoy" })] }),
      { lastYear: [{ date: "2025-01-15", amount: 250 }] },
    );
    expect(r.series[0]!.values).toEqual([100, null, null]);
    expect(r.fields[1]!.format).toBe("percent");
  });

  it("filter konteks: kolom tak dikenal diabaikan, filter dari visual sendiri hanya menyorot", () => {
    const vis = v({ axis: [{ column: "partner" }], values: [sum("amount")] });
    const r = runVisual(rows, cols, vis, {
      filters: [
        { column: "region", op: "in", values: ["Sumatra"], value: "", value2: "" },
        { column: "warehouse", op: "in", values: ["G1"], value: "", value2: "" },
      ],
    });
    expect(r.categories.map((c) => c.key)).toEqual(["B", "C"]);
    expect(r.rowCount).toBe(3);
    const own = runVisual(rows, cols, vis, {
      filters: [{ column: "partner", op: "in", values: ["A"], value: "", value2: "", source: "v1" }],
    });
    expect(own.categories).toHaveLength(3);
    expect(own.highlight).toEqual(["A"]);
    // Filter level tanggal & rentang.
    const q1 = runVisual(rows, cols, vis, {
      filters: [{ column: "date", level: "year", op: "in", values: ["2026"], value: "", value2: "" }],
    });
    expect(q1.rowCount).toBe(5);
    const between = runVisual(rows, cols, vis, {
      filters: [{ column: "amount", op: "between", value: "100", value2: "300", values: [] }],
    });
    expect(between.rowCount).toBe(4);
  });

  it("matriks dengan subtotal hierarki dan kolom legenda", () => {
    const r = runVisual(
      rows,
      cols,
      v({
        type: "matrix",
        axis: [{ column: "region" }, { column: "partner" }],
        legend: { column: "product" },
        values: [sum("amount")],
      }),
    );
    const m = r.matrix!;
    expect(m.columns.map((c) => c.key)).toEqual(["P1", "P2"]);
    expect(m.rows.map((x) => x.path.join("/"))).toEqual([
      "Sumatra",
      "Sumatra/B",
      "Sumatra/C",
      "Jawa",
      "Jawa/A",
    ]);
    expect(m.rows[0]).toMatchObject({
      depth: 0,
      total: { m1: 850 },
      cells: { P1: { m1: 550 }, P2: { m1: 300 } },
    });
    expect(m.rows[4]).toMatchObject({ depth: 1, total: { m1: 350 } });
    expect(m.columnTotals.P1).toEqual({ m1: 850 });
    expect(r.totals).toEqual({ m1: 1200 });
  });

  it("kartu dengan pembanding periode lalu; tabel rincian", () => {
    const card = runVisual(
      rows,
      cols,
      v({ type: "kpi", values: [sum("amount")], options: { compare: "prev_period" } }),
      { previousPeriod: [{ amount: 1000 }] },
    );
    expect(card.card).toEqual({ value: 1200, previous: 1000, change: 20, target: null });
    const detail = runVisual(
      rows,
      cols,
      v({ type: "table", columns: ["partner", "amount"], sort: { by: "amount", dir: "desc" }, topN: 2 }),
    );
    expect(detail.rows).toEqual([
      { partner: "C", amount: 400 },
      { partner: "B", amount: 300 },
    ]);
    expect(detail.truncated).toBe(true);
    expect(detail.totals).toEqual({ amount: 1200 });
    const distinct = runVisual(
      rows,
      cols,
      v({ type: "card", values: [{ id: "d", column: "partner", fn: "distinct" }] }),
    );
    expect(distinct.card!.value).toBe(3);
  });

  it("hasil laporan tersimpan menjadi visual", () => {
    const r = reportResultToVisual(
      { id: "x", type: "column" },
      {
        columns: [
          { key: "region", header: "Wilayah" },
          { key: "sum__amount", header: "Jumlah Omzet", numeric: true },
        ],
        rows: [{ region: "Jawa", sum__amount: 350 }],
        total: 1,
        totals: { sum__amount: 350 },
      },
      { x: "region", y: "sum__amount" },
    );
    expect(r.categories).toEqual([{ key: "Jawa", label: "Jawa" }]);
    expect(r.series[0]).toMatchObject({ label: "Jumlah Omzet", values: [350] });
  });
});

describe("dokumen & konversi dashboard lama", () => {
  it("dashboard bawaan terkonversi ke dokumen v2 yang valid", () => {
    for (const d of BUILTIN_DASHBOARDS) {
      const doc = builtinDocument(d.key)!;
      expect(biDocumentSchema.safeParse(doc).success, d.key).toBe(true);
      expect(documentErrors(doc), d.key).toEqual([]);
      const visuals = doc.pages[0]!.visuals;
      // Visual bawaan lama tetap ada (urutan & id sama), ditambah visual v2.
      expect(visuals.slice(0, d.widgets.length).map((x) => x.id)).toEqual(d.widgets.map((w) => w.id));
      const ids = visuals.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const a of visuals)
        for (const b of visuals)
          if (a !== b)
            expect(
              a.layout.x < b.layout.x + b.layout.w &&
                b.layout.x < a.layout.x + a.layout.w &&
                a.layout.y < b.layout.y + b.layout.h &&
                b.layout.y < a.layout.y + a.layout.h,
              `${a.id} vs ${b.id}`,
            ).toBe(false);
      for (const vis of visuals) {
        expect(vis.layout.x + vis.layout.w).toBeLessThanOrEqual(12);
        if (vis.type === "kpi") expect(vis.layout).toMatchObject({ w: 3, h: 3 });
      }
    }
  });

  it("tata letak berurutan membungkus ke baris berikutnya", () => {
    expect(
      layoutFlow([
        { w: 6, h: 3 },
        { w: 6, h: 5 },
        { w: 4, h: 2 },
      ]),
    ).toEqual([
      { x: 0, y: 0, w: 6, h: 3 },
      { x: 6, y: 0, w: 6, h: 5 },
      { x: 0, y: 5, w: 4, h: 2 },
    ]);
  });

  it("validasi dokumen menangkap id ganda dan rumus rusak", () => {
    const doc = biDocumentSchema.parse({
      pages: [
        {
          id: "p1",
          name: "A",
          visuals: [
            v({ id: "x", values: [{ id: "m", formula: "[m] + 1" }] }),
            v({ id: "x", values: [sum("amount")] }),
          ],
        },
      ],
    });
    const errs = documentErrors(doc).map((e) => e.message);
    expect(errs).toContain("Id visual ganda");
    expect(errs.some((e) => /melingkar/.test(e))).toBe(true);
  });
});

describe("rincian visual", () => {
  it("baris penyusun titik grafik (level tanggal & filter visual)", async () => {
    const { drillVisual } = await import("./bi.js");
    const vis = v({
      axis: [{ column: "date", level: "month" }],
      values: [sum("amount")],
      filters: [{ column: "region", op: "in", values: ["Sumatra"] }],
    });
    const r = drillVisual(rows, cols, vis, {}, [{ column: "date", level: "month", value: "2026-03" }]);
    expect(r.total).toBe(2);
    expect(r.columns.slice(0, 2).map((c) => c.key)).toEqual(["date", "amount"]);
    expect(r.totals.amount).toBe(550);
    expect(() => drillVisual(rows, cols, vis, {}, [{ column: "nope", value: "x" }])).toThrow(/nope/);
  });
});

describe("validasi rumus saat simpan", () => {
  it("rujukan ke nama otomatis ukuran tidak menggagalkan simpan; melingkar tetap ditolak", () => {
    const doc = biDocumentSchema.parse({
      pages: [
        {
          id: "p1",
          name: "A",
          visuals: [v({ values: [sum("amount"), { id: "f", formula: "[Jumlah Omzet] / 1000" }] })],
        },
      ],
    });
    expect(documentErrors(doc)).toEqual([]);
    // Saat dijalankan, nama otomatis "Jumlah Omzet" dikenali.
    const r = runVisual(rows, cols, doc.pages[0]!.visuals[0]!);
    expect(r.series.map((s) => s.values[0])).toEqual([1200, 1.2]);
  });
});

describe("ukuran dengan filter (mirip CALCULATE)", () => {
  it("menghitung margin dari dua ukuran berfilter berbeda", () => {
    const r = runVisual(
      rows,
      cols,
      v({
        type: "table",
        axis: [{ column: "region" }],
        values: [
          {
            id: "p1",
            label: "P1",
            column: "amount",
            fn: "sum",
            filters: [{ column: "product", op: "in", values: ["P1"] }],
          },
          { id: "all", label: "Semua", column: "amount", fn: "sum" },
          { id: "share", label: "Porsi P1", formula: "DIVIDE([P1], [Semua]) * 100", format: "percent" },
        ],
        sort: { by: "region", dir: "asc" },
      }),
    );
    expect(r.rows).toEqual([
      { region: "Jawa", p1: 300, all: 350, share: 85.7143 },
      { region: "Sumatra", p1: 550, all: 850, share: 64.7059 },
    ]);
    expect(() =>
      runVisual(
        rows,
        cols,
        v({
          values: [{ id: "x", column: "amount", fn: "sum", filters: [{ column: "nope", values: ["a"] }] }],
        }),
      ),
    ).toThrow(/nope/);
  });
});
