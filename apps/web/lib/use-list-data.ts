"use client";

import { LIST_LOAD_LIMIT } from "@erp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Keterangan bila data lebih banyak dari yang dimuat. */
export function truncatedNote(
  list: { truncated: boolean; rows: unknown[]; total: number },
  l: (id: string, en: string) => string,
) {
  if (!list.truncated) return undefined;
  return l(
    `Menampilkan ${list.rows.length.toLocaleString("id-ID")} dari ${list.total.toLocaleString("id-ID")} data; pencarian teks dicari di server.`,
    `Showing ${list.rows.length.toLocaleString("en-US")} of ${list.total.toLocaleString("en-US")} rows; text search runs on the server.`,
  );
}

export interface ListData<T> {
  rows: T[];
  /** Jumlah data di server (bisa lebih besar dari baris yang dimuat). */
  total: number;
  /** Data lebih dari batas muat: pencarian teks dikirim ke server. */
  truncated: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Teks pencarian yang dikirim ke server (hanya dipakai saat `truncated`). */
  serverQ: string;
}

/**
 * Muat daftar sekali (s.d. `LIST_LOAD_LIMIT` baris) untuk difilter/sort/paginasi di browser. Bila datanya lebih banyak,
 * `search` (debounce) diteruskan ke server sebagai `q` agar data di luar 5.000 baris pertama tetap bisa ditemukan.
 */
export function useListData<T>(
  /** Satu path, atau beberapa path yang hasilnya digabung (mis. faktur + nota kredit). */
  path: string | string[] | null,
  params: Record<string, string | null | undefined> = {},
  search = "",
): ListData<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [serverQ, setServerQ] = useState("");
  const truncatedRef = useRef(false);
  const key = JSON.stringify(params);
  const paths = path === null ? null : JSON.stringify(Array.isArray(path) ? path : [path]);

  // Pencarian ke server hanya bila data terpotong (atau sedang dipakai dan perlu dikosongkan).
  useEffect(() => {
    if (!truncatedRef.current && !serverQ) return;
    const t = setTimeout(() => setServerQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search, serverQ]);

  useEffect(() => {
    if (!paths) return;
    let live = true;
    const q = new URLSearchParams({ limit: String(LIST_LOAD_LIMIT) });
    for (const [k, v] of Object.entries(JSON.parse(key) as Record<string, string | null>))
      if (v !== null && v !== undefined && v !== "") q.set(k, v);
    if (serverQ) q.set("q", serverQ);
    setLoading(true);
    Promise.all(
      (JSON.parse(paths) as string[]).map((p) =>
        api<{ items: T[]; total?: number } | T[]>(`${p}${p.includes("?") ? "&" : "?"}${q}`),
      ),
    )
      .then((results) => {
        if (!live) return;
        const items = results.flatMap((d) => (Array.isArray(d) ? d : d.items));
        const count = results.reduce(
          (sum, d) => sum + (Array.isArray(d) ? d.length : (d.total ?? d.items.length)),
          0,
        );
        setRows(items);
        setTotal(count);
        if (!serverQ) truncatedRef.current = count > items.length;
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [paths, key, serverQ, version]);

  return {
    rows,
    total,
    truncated: truncatedRef.current,
    loading,
    error,
    reload: useCallback(() => setVersion((v) => v + 1), []),
    serverQ,
  };
}
