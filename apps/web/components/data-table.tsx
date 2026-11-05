"use client";

import {
  activeFilterCount,
  distinctOptions,
  TABLE_PAGE_SIZES,
  type ColumnFilter,
  type TableState,
} from "@erp/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "./empty-state";
import { formatDate } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useTableView, type TableView, type ViewColumn } from "../lib/use-table-view";

export type { TableView, ViewColumn } from "../lib/use-table-view";

/** Kolom `DataTable`: kolom tampilan + cara render sel (bawaan: teks nilai). */
export interface DataColumn<T> extends ViewColumn<T> {
  render?: (row: T) => ReactNode;
  className?: string;
  /** Hanya untuk cari/filter, tidak ditampilkan sebagai kolom. */
  hidden?: boolean;
}

const cellText = <T,>(col: ViewColumn<T>, row: T) => {
  if (col.text) return col.text(row);
  const v = col.value(row);
  return v === null || v === undefined ? "" : String(v);
};

/** Kotak cari, tombol & panel filter per kolom, chip filter aktif, jumlah hasil. */
export function TableTools<T>({
  view,
  placeholder,
  note,
  children,
  columnChooser,
}: {
  view: TableView<T>;
  placeholder?: string;
  /** Keterangan tambahan (mis. data dipotong 5.000 baris). */
  note?: ReactNode;
  /** Tombol/kontrol tambahan di kanan. */
  children?: ReactNode;
  /** Tampilkan menu "Kolom" (hanya untuk tabel yang menyembunyikan kolom sesuai `view.hidden`). */
  columnChooser?: boolean;
}) {
  const { l, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const filterable = view.columns.filter((c) => c.filterable !== false);
  const count = activeFilterCount(view.state.filters);
  const date = (v: string) => formatDate(v, locale);
  const summary = (col: ViewColumn<T>, f: ColumnFilter) => {
    if (f.kind === "text") return `“${f.text}”`;
    if (f.kind === "enum") {
      const labels = new Map(distinctOptions(view.source, col, f.values));
      const names = f.values.map((v) => labels.get(v) || v || l("(kosong)", "(empty)"));
      return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
    }
    const fmt = (v: string) =>
      col.type === "date" ? date(v) : Number(v).toLocaleString(locale === "en" ? "en-US" : "id-ID");
    if (f.min && f.max) return `${fmt(f.min)} – ${fmt(f.max)}`;
    return f.min ? `≥ ${fmt(f.min)}` : `≤ ${fmt(f.max!)}`;
  };
  const chips = Object.entries(view.state.filters).flatMap(([key, f]) => {
    const col = view.columns.find((c) => c.key === key);
    if (!col || activeFilterCount({ [key]: f }) === 0) return [];
    return [{ key, label: col.label, text: summary(col, f) }];
  });

  return (
    <div className="table-tools">
      <div className="table-tools-row">
        <input
          type="search"
          className="table-search"
          placeholder={placeholder ?? l("Cari…", "Search…")}
          aria-label={l("Cari di tabel", "Search the table")}
          value={view.state.q}
          onChange={(e) => view.setQ(e.target.value)}
        />
        {filterable.length > 0 && (
          <button
            type="button"
            className={open || count ? "active" : ""}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {l("Filter", "Filter")}
            {count > 0 && <span className="count-badge">{count}</span>}
          </button>
        )}
        {children}
        {columnChooser && <ColumnChooser view={view} />}
        <span className="muted table-count">
          {view.total === view.source.length
            ? l(`${view.total} data`, `${view.total} rows`)
            : l(
                `${view.total} dari ${view.source.length} data`,
                `${view.total} of ${view.source.length} rows`,
              )}
        </span>
      </div>
      {note && <p className="muted small table-note">{note}</p>}
      {chips.length > 0 && (
        <div className="filter-chips">
          {chips.map((c) => (
            <span key={c.key} className="filter-chip">
              <strong>{c.label}:</strong> {c.text}
              <button
                type="button"
                className="link"
                aria-label={l(`Hapus filter ${c.label}`, `Remove ${c.label} filter`)}
                onClick={() => view.setFilter(c.key, null)}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="link small" onClick={view.clearFilters}>
            {l("Reset semua", "Reset all")}
          </button>
        </div>
      )}
      {open && (
        <div className="filter-panel">
          {filterable.map((col) => (
            <ColumnFilterField key={col.key} view={view} col={col} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Menu "Kolom": centang kolom yang ditampilkan (diingat per tabel). */
function ColumnChooser<T>({ view }: { view: TableView<T> }) {
  const { l } = useI18n();
  const [open, setOpen] = useState(false);
  const cols = view.columns.filter((c) => !(c as DataColumn<T>).hidden);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".column-chooser"))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (cols.length < 3) return null;
  const shown = cols.filter((c) => !view.hidden.includes(c.key)).length;
  return (
    <span className="column-chooser">
      <button
        type="button"
        aria-expanded={open}
        className={view.hidden.some((k) => cols.some((c) => c.key === k)) ? "active" : ""}
        onClick={() => setOpen((o) => !o)}
      >
        {l("Kolom", "Columns")}
      </button>
      {open && (
        <span className="column-menu" role="menu">
          {cols.map((c) => {
            const on = !view.hidden.includes(c.key);
            return (
              <label key={c.key} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && shown === 1}
                  onChange={() => view.toggleHidden(c.key)}
                />
                <span>{c.label}</span>
              </label>
            );
          })}
        </span>
      )}
    </span>
  );
}

/** Baris tabel yang bisa diklik/Enter untuk membuka `href` (Ctrl/⌘-klik = tab baru); klik pada kontrol tidak. */
export function useRowLink() {
  const router = useRouter();
  return (href: string | undefined) =>
    href
      ? {
          className: "row-link",
          tabIndex: 0,
          onClick: (e: React.MouseEvent<HTMLTableRowElement>) => {
            if ((e.target as Element).closest("a, button, input, select, textarea, label")) return;
            if (window.getSelection()?.toString()) return;
            if (e.ctrlKey || e.metaKey) window.open(href, "_blank");
            else router.push(href);
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter") router.push(href);
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = (
                e.key === "ArrowDown"
                  ? e.currentTarget.nextElementSibling
                  : e.currentTarget.previousElementSibling
              ) as HTMLElement | null;
              next?.focus();
            }
          },
        }
      : {};
}

function ColumnFilterField<T>({ view, col }: { view: TableView<T>; col: ViewColumn<T> }) {
  const { l } = useI18n();
  const current = view.state.filters[col.key];
  const type = col.type ?? "text";
  if (type === "enum") {
    const values = current?.kind === "enum" ? current.values : [];
    const options = distinctOptions(view.source, col, values);
    return (
      <fieldset className="filter-field">
        <legend>{col.label}</legend>
        <div className="filter-options">
          {options.map(([value, label]) => (
            <label key={value} className="check">
              <input
                type="checkbox"
                checked={values.includes(value)}
                onChange={(e) => {
                  const next = e.target.checked ? [...values, value] : values.filter((v) => v !== value);
                  view.setFilter(col.key, next.length ? { kind: "enum", values: next } : null);
                }}
              />
              <span>{label || l("(kosong)", "(empty)")}</span>
            </label>
          ))}
          {!options.length && <span className="muted small">{l("Tidak ada data", "No data")}</span>}
        </div>
      </fieldset>
    );
  }
  if (type === "number" || type === "date") {
    const range = current?.kind === "range" ? current : { kind: "range" as const, min: "", max: "" };
    const set = (patch: { min?: string; max?: string }) => {
      const next = { ...range, ...patch };
      view.setFilter(col.key, next.min || next.max ? next : null);
    };
    const inputType = type === "date" ? "date" : "number";
    return (
      <fieldset className="filter-field">
        <legend>{col.label}</legend>
        <div className="filter-range">
          <input
            type={inputType}
            aria-label={`${col.label} ${l("dari", "from")}`}
            placeholder={l("dari", "from")}
            value={range.min ?? ""}
            onChange={(e) => set({ min: e.target.value })}
          />
          <span aria-hidden>–</span>
          <input
            type={inputType}
            aria-label={`${col.label} ${l("sampai", "to")}`}
            placeholder={l("sampai", "to")}
            value={range.max ?? ""}
            onChange={(e) => set({ max: e.target.value })}
          />
        </div>
      </fieldset>
    );
  }
  return (
    <label className="filter-field">
      <span>{col.label}</span>
      <input
        value={current?.kind === "text" ? current.text : ""}
        placeholder={l("mengandung…", "contains…")}
        onChange={(e) =>
          view.setFilter(col.key, e.target.value ? { kind: "text", text: e.target.value } : null)
        }
      />
    </label>
  );
}

/** Judul kolom yang bisa diklik untuk sort (naik → turun → tanpa sort). */
export function SortTh<T>({
  view,
  col,
  children,
  className,
}: {
  view: TableView<T>;
  col: string;
  children: ReactNode;
  className?: string;
}) {
  const sort = view.state.sort?.key === col ? view.state.sort.dir : null;
  const column = view.columns.find((c) => c.key === col);
  if (column?.sortable === false) return <th className={className}>{children}</th>;
  return (
    <th
      className={className}
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none"}
    >
      <button type="button" className="th-sort" onClick={() => view.toggleSort(col)}>
        {children}
        <span aria-hidden className={`sort-mark${sort ? " on" : ""}`}>
          {sort === "asc" ? "▲" : sort === "desc" ? "▼" : "↕"}
        </span>
      </button>
    </th>
  );
}

/** Pilihan urutan untuk tampilan tanpa judul kolom (mis. kanban). */
export function SortSelect<T>({ view }: { view: TableView<T> }) {
  const { l } = useI18n();
  const sort = view.state.sort;
  return (
    <select
      aria-label={l("Urutkan", "Sort by")}
      value={sort ? `${sort.key}:${sort.dir}` : ""}
      onChange={(e) => {
        const [key, dir] = e.target.value.split(":");
        view.setSort(key && (dir === "asc" || dir === "desc") ? { key, dir } : null);
      }}
    >
      <option value="">{l("Urutan bawaan", "Default order")}</option>
      {view.columns
        .filter((c) => c.sortable !== false)
        .flatMap((c) => [
          <option key={`${c.key}:asc`} value={`${c.key}:asc`}>
            {c.label} ▲
          </option>,
          <option key={`${c.key}:desc`} value={`${c.key}:desc`}>
            {c.label} ▼
          </option>,
        ])}
    </select>
  );
}

/** Navigasi halaman & ukuran halaman (25/50/100/semua). */
export function TablePager<T>({ view }: { view: TableView<T> }) {
  const { l } = useI18n();
  if (view.source.length <= TABLE_PAGE_SIZES[0]) return null;
  return (
    <div className="pager table-pager">
      <span className="muted pager-text">
        {view.from}–{view.to} {l("dari", "of")} {view.total}
      </span>
      <button
        type="button"
        disabled={view.page <= 1}
        onClick={() => view.setPage(1)}
        aria-label={l("Halaman pertama", "First page")}
      >
        «
      </button>
      <button
        type="button"
        disabled={view.page <= 1}
        onClick={() => view.setPage(view.page - 1)}
        aria-label={l("Halaman sebelumnya", "Previous page")}
      >
        ‹
      </button>
      <span className="pager-text">
        {view.page} / {view.pageCount}
      </span>
      <button
        type="button"
        disabled={view.page >= view.pageCount}
        onClick={() => view.setPage(view.page + 1)}
        aria-label={l("Halaman berikutnya", "Next page")}
      >
        ›
      </button>
      <button
        type="button"
        disabled={view.page >= view.pageCount}
        onClick={() => view.setPage(view.pageCount)}
        aria-label={l("Halaman terakhir", "Last page")}
      >
        »
      </button>
      <select
        aria-label={l("Baris per halaman", "Rows per page")}
        value={view.state.pageSize}
        onChange={(e) => view.setPageSize(Number(e.target.value))}
      >
        {TABLE_PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n === 0 ? l("Semua", "All") : `${n} / ${l("hal", "page")}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Tabel siap pakai dengan cari, filter per kolom, sort & paginasi di browser. Untuk tabel dengan markup khusus, pakai
 * `useTableView` + `TableTools` + `SortTh` + `TablePager` langsung.
 */
export function DataTable<T>({
  rows,
  columns,
  storageKey,
  rowKey,
  empty,
  tools,
  note,
  defaultSort,
  initialFilters,
  pageSize,
  rowClassName,
  tableClassName,
  foot,
  onSearch,
  searchPlaceholder,
  rowHref,
  createHref,
  createLabel,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  storageKey: string;
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  /** Kontrol tambahan di baris alat. */
  tools?: ReactNode;
  note?: ReactNode;
  defaultSort?: TableState["sort"];
  initialFilters?: Record<string, ColumnFilter>;
  pageSize?: number;
  rowClassName?: (row: T) => string | undefined;
  tableClassName?: string;
  /** Baris tfoot (mis. total) — diberi baris yang lolos filter. */
  foot?: (filtered: T[]) => ReactNode;
  /** Teks pencarian (mis. diteruskan ke server bila data terpotong). */
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  /** Seluruh baris bisa diklik untuk membuka tautan ini. */
  rowHref?: (row: T) => string | undefined;
  /** Tombol "buat" di keadaan kosong. */
  createHref?: string;
  createLabel?: string;
}) {
  const view = useTableView(rows, columns, { storageKey, defaultSort, initialFilters, pageSize });
  const rowLink = useRowLink();
  const shown = columns.filter((c) => !c.hidden && (foot || !view.hidden.includes(c.key)));
  useEffect(() => onSearch?.(view.state.q), [onSearch, view.state.q]);
  return (
    <>
      <TableTools view={view} note={note} placeholder={searchPlaceholder} columnChooser={!foot}>
        {tools}
      </TableTools>
      <div className="table-wrap">
        <table className={tableClassName}>
          <thead>
            <tr>
              {shown.map((c) => (
                <SortTh key={c.key} view={view} col={c.key} className={c.className}>
                  {c.label}
                </SortTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, i) => {
              const link = rowLink(rowHref?.(row));
              return (
                <tr
                  key={rowKey(row, i)}
                  {...link}
                  className={[rowClassName?.(row), link.className].filter(Boolean).join(" ") || undefined}
                >
                  {shown.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.render ? c.render(row) : cellText(c, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {view.rows.length === 0 && (
              <tr>
                <td colSpan={shown.length}>
                  <EmptyState
                    compact
                    filtered={view.source.length > 0}
                    onClear={view.clearFilters}
                    message={view.source.length ? undefined : empty}
                    createHref={createHref}
                    createLabel={createLabel}
                  />
                </td>
              </tr>
            )}
          </tbody>
          {foot && <tfoot>{foot(view.filtered)}</tfoot>}
        </table>
      </div>
      <TablePager view={view} />
    </>
  );
}
