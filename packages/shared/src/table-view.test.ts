import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyTableView,
  distinctOptions,
  emptyTableState,
  normalizeText,
  type TableColumn,
} from "./table-view.js";

interface Row {
  id: number;
  name: string;
  state: string;
  amount: number | null;
  date: string | null;
}
const rows: Row[] = [
  { id: 1, name: "José Pratama", state: "draft", amount: 1500, date: "2026-01-10" },
  { id: 2, name: "Budi Santoso", state: "posted", amount: 200, date: "2026-03-01" },
  { id: 3, name: "Citra Dewi", state: "posted", amount: null, date: null },
  { id: 4, name: "andi", state: "cancel", amount: 1500, date: "2025-12-31" },
  { id: 5, name: "Item 10", state: "draft", amount: 75, date: "2026-02-15" },
  { id: 6, name: "Item 9", state: "draft", amount: 75, date: "2026-02-15" },
];
const STATE_LABEL: Record<string, string> = { draft: "Draft", posted: "Terposting", cancel: "Batal" };
const columns: TableColumn<Row>[] = [
  { key: "name", value: (r) => r.name },
  { key: "state", value: (r) => r.state, text: (r) => STATE_LABEL[r.state]!, type: "enum" },
  { key: "amount", value: (r) => r.amount, type: "number" },
  { key: "date", value: (r) => r.date, type: "date" },
];
const run = (patch: Partial<ReturnType<typeof emptyTableState>>) =>
  applyTableView(rows, columns, { ...emptyTableState(50), ...patch });
const ids = (r: { rows: Row[] }) => r.rows.map((x) => x.id);

describe("table-view", () => {
  it("normalisasi teks: huruf kecil, tanpa diakritik & spasi ganda", () => {
    expect(normalizeText("  José   PRATAMA ")).toBe("jose pratama");
  });

  it("pencarian semua kolom (termasuk label enum), semua kata harus cocok", () => {
    expect(ids(run({ q: "jose" }))).toEqual([1]);
    expect(ids(run({ q: "terposting" }))).toEqual([2, 3]);
    expect(ids(run({ q: "item 10" }))).toEqual([5]);
    expect(ids(run({ q: "budi batal" }))).toEqual([]);
  });

  it("filter enum, teks, angka & tanggal", () => {
    expect(ids(run({ filters: { state: { kind: "enum", values: ["draft", "cancel"] } } }))).toEqual([
      1, 4, 5, 6,
    ]);
    expect(ids(run({ filters: { name: { kind: "text", text: "ITEM" } } }))).toEqual([5, 6]);
    expect(ids(run({ filters: { amount: { kind: "range", min: "100", max: "1500" } } }))).toEqual([1, 2, 4]);
    expect(ids(run({ filters: { date: { kind: "range", min: "2026-02-01", max: null } } }))).toEqual([
      2, 5, 6,
    ]);
    // Filter kosong tidak menyaring.
    expect(run({ filters: { state: { kind: "enum", values: [] } } }).total).toBe(6);
  });

  it("sort angka/teks/tanggal stabil, kosong selalu di akhir", () => {
    expect(ids(run({ sort: { key: "amount", dir: "asc" } }))).toEqual([5, 6, 2, 1, 4, 3]);
    expect(ids(run({ sort: { key: "amount", dir: "desc" } }))).toEqual([1, 4, 2, 5, 6, 3]);
    // Collator numerik & tanpa beda huruf besar: "andi" < "Budi", "Item 9" < "Item 10".
    expect(ids(run({ sort: { key: "name", dir: "asc" } }))).toEqual([4, 2, 3, 6, 5, 1]);
    expect(ids(run({ sort: { key: "date", dir: "desc" } }))).toEqual([2, 5, 6, 1, 4, 3]);
  });

  it("paginasi: ukuran halaman, clamp halaman, 'semua'", () => {
    const p2 = run({ pageSize: 4, page: 2 });
    expect(p2).toMatchObject({ page: 2, pageCount: 2, from: 5, to: 6, total: 6 });
    expect(ids(p2)).toEqual([5, 6]);
    expect(run({ pageSize: 4, page: 9 }).page).toBe(2);
    expect(run({ pageSize: 0 }).rows).toHaveLength(6);
    expect(run({ q: "tidak ada" })).toMatchObject({ total: 0, from: 0, to: 0, page: 1, pageCount: 1 });
  });

  it("pilihan enum dari data (urut label) & jumlah filter aktif", () => {
    expect(distinctOptions(rows, columns[1]!)).toEqual([
      ["cancel", "Batal"],
      ["draft", "Draft"],
      ["posted", "Terposting"],
    ]);
    // Nilai filter terpilih yang tidak ada di data tetap muncul, berlabel `optionLabel`.
    const labelled = { ...columns[1]!, optionLabel: (v: string) => ({ paid: "Lunas" })[v] ?? v };
    expect(distinctOptions([], labelled, ["paid", "x"])).toEqual([
      ["paid", "Lunas"],
      ["x", "x"],
    ]);
    expect(
      activeFilterCount({
        state: { kind: "enum", values: ["draft"] },
        name: { kind: "text", text: " " },
        amount: { kind: "range", min: "1" },
      }),
    ).toBe(2);
  });
});
