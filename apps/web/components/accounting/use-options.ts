"use client";

import { useEffect, useState } from "react";
import { LIST_LOAD_LIMIT } from "@erp/shared";
import { api } from "../../lib/api";

/**
 * Muat daftar pilihan dari endpoint list (sampai batas muat daftar, 5.000 baris — bukan 200, agar akun/produk/karyawan
 * berikutnya tetap bisa dipilih); mendukung respons `{ items }` maupun array.
 */
export function useOptions<T>(path: string | null): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!path) return;
    api<{ items: T[] } | T[]>(`${path}${path.includes("?") ? "&" : "?"}limit=${LIST_LOAD_LIMIT}`)
      .then((d) => setRows(Array.isArray(d) ? d : d.items))
      .catch(() => setRows([]));
  }, [path]);
  return rows;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
}
export interface TaxOption {
  id: string;
  name: string;
  typeTaxUse: "sale" | "purchase";
  amount: string;
  baseRatio: string;
}
export interface JournalOption {
  id: string;
  code: string;
  name: string;
  journalType: string;
}
export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  salePrice: string;
  cost: string;
  uomId: string;
  saleUomId: string | null;
  purchaseUomId: string | null;
  dropship: boolean;
  /** Produk induk varian: tidak dipilih langsung di dokumen. */
  isVariantTemplate: boolean;
}
export interface UomOption {
  id: string;
  name: string;
  categoryId: string;
}
export interface CurrencyOption {
  code: string;
  decimals: number;
}
