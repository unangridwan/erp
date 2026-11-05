"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

/** Jenis kontrak dari master (SDM › Konfigurasi › Jenis Kontrak). */
export interface ContractType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  legalBasis: string | null;
  fixedTerm: boolean;
  maxMonths: number | null;
  documentTitle: string | null;
  sequence: number;
  isSystem: boolean;
  active: boolean;
  usage?: number;
}

let cache: Promise<ContractType[]> | null = null;

/** Muat ulang daftar jenis kontrak (setelah diubah di halaman master). */
export function invalidateContractTypes() {
  cache = null;
}

/**
 * Daftar jenis kontrak (dimuat sekali per halaman) + bantuan label & aturan. `options(current)` = jenis aktif, ditambah
 * jenis nonaktif yang sedang dipakai dokumen agar tetap tampil.
 */
export function useContractTypes() {
  const [types, setTypes] = useState<ContractType[]>([]);
  useEffect(() => {
    let alive = true;
    cache ??= api<ContractType[]>("/contract-types").catch(() => {
      cache = null;
      return [];
    });
    void cache.then((rows) => alive && setTypes(rows));
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    const find = (code: string | null | undefined) => types.find((t) => t.code === code);
    return {
      types,
      find,
      label: (code: string | null | undefined) => (code ? (find(code)?.name ?? code.toUpperCase()) : ""),
      fixedTerm: (code: string | null | undefined) => find(code)?.fixedTerm ?? code === "pkwt",
      options: (current?: string | null) =>
        types.filter((t) => t.active || t.code === current).map((t) => ({ value: t.code, label: t.name })),
    };
  }, [types]);
}
