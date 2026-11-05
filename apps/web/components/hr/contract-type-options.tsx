"use client";

import { useI18n } from "../../lib/i18n";
import type { useContractTypes } from "../../lib/use-contract-types";

/**
 * Pilihan `<option>` jenis kontrak dari master (aktif + jenis nonaktif yang sedang dipakai). `general` menambah pilihan
 * kosong (mis. "Semua jenis" di template).
 */
export function ContractTypeOptions({
  types,
  current,
  general,
}: {
  types: ReturnType<typeof useContractTypes>;
  current?: string | null;
  general?: string;
}) {
  const { l } = useI18n();
  const options = types.options(current);
  return (
    <>
      {general !== undefined && <option value="">{general}</option>}
      {/* Sebelum daftar termuat: tampilkan nilai sekarang agar select tidak kosong. */}
      {current && !options.some((o) => o.value === current) && (
        <option value={current}>{types.label(current)}</option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
          {types.find(o.value)?.active === false ? ` (${l("nonaktif", "inactive")})` : ""}
        </option>
      ))}
    </>
  );
}
