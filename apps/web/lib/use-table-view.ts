"use client";

import {
  applyTableView,
  emptyTableState,
  type ColumnFilter,
  type TableColumn,
  type TableState,
} from "@erp/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Kolom tabel di web: kolom shared + label tampilan (sudah diterjemahkan). */
export interface ViewColumn<T> extends TableColumn<T> {
  label: string;
}

export interface TableView<T> {
  rows: T[];
  filtered: T[];
  /** Semua baris sebelum filter (untuk pilihan filter). */
  source: T[];
  total: number;
  page: number;
  pageCount: number;
  from: number;
  to: number;
  state: TableState;
  columns: ViewColumn<T>[];
  setQ: (q: string) => void;
  setFilter: (key: string, filter: ColumnFilter | null) => void;
  clearFilters: () => void;
  toggleSort: (key: string) => void;
  setSort: (sort: TableState["sort"]) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Kolom yang disembunyikan pengguna (diingat per tabel). */
  hidden: string[];
  toggleHidden: (key: string) => void;
}

const STORE = "erp.table.";

/**
 * Cari, filter per kolom, sort & paginasi di browser atas baris yang sudah dimuat (tanpa request API). Sort & ukuran
 * halaman diingat per tabel (`storageKey`); pencarian & filter tidak.
 */
export function useTableView<T>(
  rows: T[],
  columns: ViewColumn<T>[],
  opts: {
    storageKey: string;
    pageSize?: number;
    defaultSort?: TableState["sort"];
    initialFilters?: Record<string, ColumnFilter>;
  },
): TableView<T> {
  const [state, setState] = useState<TableState>(() => ({
    ...emptyTableState(opts.pageSize ?? 50),
    sort: opts.defaultSort ?? null,
    filters: opts.initialFilters ?? {},
  }));

  const [hidden, setHidden] = useState<string[]>([]);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Preferensi tersimpan dimuat setelah mount (hindari beda render server/klien).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE + opts.storageKey) ?? "null") as {
        sort?: TableState["sort"];
        pageSize?: number;
        hidden?: string[];
      } | null;
      if (saved) {
        setState((s) => ({
          ...s,
          sort: saved.sort === undefined ? s.sort : saved.sort,
          pageSize: typeof saved.pageSize === "number" ? saved.pageSize : s.pageSize,
        }));
        if (Array.isArray(saved.hidden)) setHidden(saved.hidden);
      }
    } catch {
      // localStorage tidak tersedia
    }
  }, [opts.storageKey]);
  const persist = useCallback(
    (next: TableState, nextHidden = hiddenRef.current) => {
      try {
        localStorage.setItem(
          STORE + opts.storageKey,
          JSON.stringify({ sort: next.sort, pageSize: next.pageSize, hidden: nextHidden }),
        );
      } catch {
        // abaikan
      }
    },
    [opts.storageKey],
  );

  const result = useMemo(() => applyTableView(rows, columns, state), [rows, columns, state]);

  return {
    ...result,
    source: rows,
    state,
    columns,
    setQ: (q) => setState((s) => ({ ...s, q, page: 1 })),
    setFilter: (key, filter) =>
      setState((s) => {
        const filters = { ...s.filters };
        if (filter) filters[key] = filter;
        else delete filters[key];
        return { ...s, filters, page: 1 };
      }),
    clearFilters: () => setState((s) => ({ ...s, filters: {}, q: "", page: 1 })),
    toggleSort: (key) =>
      setState((s) => {
        // asc → desc → tanpa sort
        const sort: TableState["sort"] =
          s.sort?.key !== key ? { key, dir: "asc" } : s.sort.dir === "asc" ? { key, dir: "desc" } : null;
        const next = { ...s, sort, page: 1 };
        persist(next);
        return next;
      }),
    setSort: (sort) =>
      setState((s) => {
        const next = { ...s, sort, page: 1 };
        persist(next);
        return next;
      }),
    setPage: (page) => setState((s) => ({ ...s, page })),
    setPageSize: (pageSize) =>
      setState((s) => {
        const next = { ...s, pageSize, page: 1 };
        persist(next);
        return next;
      }),
    hidden,
    toggleHidden: (key) => {
      const next = hiddenRef.current.includes(key)
        ? hiddenRef.current.filter((k) => k !== key)
        : [...hiddenRef.current, key];
      setHidden(next);
      persist(stateRef.current, next);
    },
  };
}
