/**
 * Tampilan tabel di browser: pencarian semua kolom, filter per kolom, sort, dan paginasi atas baris yang sudah dimuat
 * (tanpa memanggil API lagi).
 */

export type TableColumnType = "text" | "number" | "date" | "enum";
export type TableCell = string | number | boolean | null | undefined;

export interface TableColumn<T> {
  key: string;
  /** Nilai mentah untuk sort/filter (angka untuk number, "YYYY-MM-DD…" untuk date). */
  value: (row: T) => TableCell;
  /** Teks yang dicari & tampil di chip filter (bawaan: `value`). */
  text?: (row: T) => string;
  type?: TableColumnType;
  /** Pilihan enum [nilai, label]; bila kosong diambil dari nilai yang ada. */
  options?: [string, string][];
  /** Label nilai enum (mis. kode status → nama), juga untuk nilai filter yang tidak ada di data. */
  optionLabel?: (value: string) => string;
  sortable?: boolean;
  filterable?: boolean;
  /** Ikut pencarian teks (bawaan ya). */
  searchable?: boolean;
}

export type ColumnFilter =
  | { kind: "enum"; values: string[] }
  | { kind: "text"; text: string }
  | { kind: "range"; min?: string | null; max?: string | null };

export interface TableState {
  q: string;
  filters: Record<string, ColumnFilter>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: number;
  /** 0 = semua baris. */
  pageSize: number;
}

export const TABLE_PAGE_SIZES = [25, 50, 100, 0] as const;
/** Batas baris yang dimuat sekali oleh list (di atas ini pencarian teks dilakukan di server). */
export const LIST_LOAD_LIMIT = 5000;

export const emptyTableState = (pageSize = 50): TableState => ({
  q: "",
  filters: {},
  sort: null,
  page: 1,
  pageSize,
});

/** Huruf kecil tanpa diakritik & spasi berlebih (pencarian "Jose" menemukan "José"). */
export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const collator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });

function cellText<T>(col: TableColumn<T>, row: T): string {
  if (col.text) return col.text(row);
  const v = col.value(row);
  return v === null || v === undefined ? "" : String(v);
}

function toNumber(v: TableCell): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Bandingkan dua nilai sel; kosong selalu di akhir apa pun arah sort. */
export function compareCells(a: TableCell, b: TableCell, type: TableColumnType = "text"): number {
  const empty = (v: TableCell) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (type === "number") return (toNumber(a) ?? 0) - (toNumber(b) ?? 0);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (type === "date") return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return collator.compare(String(a), String(b));
}

/** Apakah satu baris lolos filter kolom. */
export function matchesFilter<T>(row: T, col: TableColumn<T>, filter: ColumnFilter): boolean {
  const v = col.value(row);
  if (filter.kind === "enum") {
    if (!filter.values.length) return true;
    return filter.values.includes(v === null || v === undefined ? "" : String(v));
  }
  if (filter.kind === "text") {
    const needle = normalizeText(filter.text);
    return !needle || normalizeText(cellText(col, row)).includes(needle);
  }
  const { min, max } = filter;
  if (!min && !max) return true;
  if (v === null || v === undefined || v === "") return false;
  if (col.type === "number") {
    const n = toNumber(v);
    if (n === null) return false;
    if (min && n < Number(min)) return false;
    if (max && n > Number(max)) return false;
    return true;
  }
  // Tanggal (string ISO): bandingkan 10 karakter pertama (YYYY-MM-DD).
  const d = String(v).slice(0, 10);
  if (min && d < min) return false;
  if (max && d > max) return false;
  return true;
}

export interface TableViewResult<T> {
  /** Baris di halaman aktif. */
  rows: T[];
  /** Semua baris yang lolos pencarian & filter (sudah diurutkan). */
  filtered: T[];
  total: number;
  page: number;
  pageCount: number;
  /** Indeks (1-based) baris pertama & terakhir di halaman, 0 bila kosong. */
  from: number;
  to: number;
}

export function applyTableView<T>(
  rows: T[],
  columns: TableColumn<T>[],
  state: TableState,
): TableViewResult<T> {
  const needles = normalizeText(state.q).split(" ").filter(Boolean);
  const searchable = columns.filter((c) => c.searchable !== false);
  const active = Object.entries(state.filters)
    .map(([key, filter]) => [columns.find((c) => c.key === key), filter] as const)
    .filter((e): e is readonly [TableColumn<T>, ColumnFilter] => !!e[0]);
  let out = rows.filter((row) => {
    if (needles.length) {
      const hay = normalizeText(searchable.map((c) => cellText(c, row)).join(" "));
      if (!needles.every((n) => hay.includes(n))) return false;
    }
    return active.every(([col, filter]) => matchesFilter(row, col, filter));
  });
  const sortCol = state.sort ? columns.find((c) => c.key === state.sort!.key) : undefined;
  if (sortCol && state.sort) {
    const dir = state.sort.dir === "desc" ? -1 : 1;
    // Sort stabil: indeks asal sebagai pemecah seri; kosong tetap di akhir.
    out = out
      .map((row, i) => ({ row, i, v: sortCol.value(row) }))
      .sort((a, b) => {
        const emptyA = a.v === null || a.v === undefined || a.v === "";
        const emptyB = b.v === null || b.v === undefined || b.v === "";
        if (emptyA !== emptyB) return emptyA ? 1 : -1;
        return dir * compareCells(a.v, b.v, sortCol.type) || a.i - b.i;
      })
      .map((x) => x.row);
  }
  const total = out.length;
  const size = state.pageSize > 0 ? state.pageSize : Math.max(total, 1);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, state.page), pageCount);
  const start = (page - 1) * size;
  const pageRows = out.slice(start, start + size);
  return {
    rows: pageRows,
    filtered: out,
    total,
    page,
    pageCount,
    from: total ? start + 1 : 0,
    to: start + pageRows.length,
  };
}

/**
 * Pilihan filter enum: dari `options` kolom, atau nilai berbeda yang ada di data ditambah nilai filter yang sedang
 * dipilih (`include`, agar filter awal tetap terlihat walau datanya kosong), urut label.
 */
export function distinctOptions<T>(
  rows: T[],
  col: TableColumn<T>,
  include: string[] = [],
): [string, string][] {
  if (col.options) return col.options;
  const seen = new Map<string, string>();
  for (const row of rows) {
    const v = col.value(row);
    const key = v === null || v === undefined ? "" : String(v);
    if (!seen.has(key)) seen.set(key, (key && col.optionLabel?.(key)) || cellText(col, row) || key);
  }
  for (const key of include) if (!seen.has(key)) seen.set(key, (key && col.optionLabel?.(key)) || key);
  return [...seen.entries()].sort((a, b) => collator.compare(a[1], b[1]));
}

/** Jumlah filter kolom yang aktif (untuk lencana tombol Filter). */
export function activeFilterCount(filters: Record<string, ColumnFilter>): number {
  return Object.values(filters).filter((f) =>
    f.kind === "enum" ? f.values.length > 0 : f.kind === "text" ? !!f.text.trim() : !!(f.min || f.max),
  ).length;
}
