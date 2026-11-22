"use client";

import { useEffect, useMemo, useState } from "react";
import { api, onSessionReset } from "./api";

/** Jenis kontrak dari master (SDM › Konfigurasi › Jenis Kontrak). */
/** Aturan penggajian jenis kontrak (0054). */
export interface ContractPayroll {
  inPayroll: boolean;
  bpjsKes: boolean;
  bpjsJkk: boolean;
  bpjsJkm: boolean;
  bpjsJht: boolean;
  bpjsJp: boolean;
  pph21Category: "auto" | "permanent" | "non_permanent" | "non_employee" | "none";
  thr: boolean;
  severance: "pesangon" | "compensation" | "none";
}

export interface ContractType extends ContractPayroll {
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
onSessionReset(invalidateContractTypes);

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

/** Ringkasan aturan penggajian jenis kontrak (BPJS, PPh 21, THR, lembur) untuk ditampilkan. */
export function contractRuleText(t: ContractPayroll, l: (id: string, en: string) => string) {
  if (!t.inPayroll) return l("Tidak ikut payroll", "Not included in payroll");
  const bpjs = [
    t.bpjsKes && "Kes",
    t.bpjsJkk && "JKK",
    t.bpjsJkm && "JKM",
    t.bpjsJht && "JHT",
    t.bpjsJp && "JP",
  ].filter(Boolean);
  return [
    bpjs.length ? `BPJS ${bpjs.join(", ")}` : l("tanpa BPJS", "no BPJS"),
    !t.thr && l("tanpa THR", "no THR"),
  ]
    .filter(Boolean)
    .join(" · ");
}
