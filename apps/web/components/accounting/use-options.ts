"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

/** Muat daftar pilihan (maks. 200) dari endpoint list; mendukung respons `{ items }` maupun array. */
export function useOptions<T>(path: string | null): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!path) return;
    api<{ items: T[] } | T[]>(`${path}${path.includes("?") ? "&" : "?"}limit=200`)
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
}
export interface CurrencyOption {
  code: string;
  decimals: number;
}
