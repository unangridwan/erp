"use client";

import type { ProductOption, UomOption } from "./accounting/use-options";

/** Pilihan satuan baris: hanya satuan sekategori dengan satuan produk; disembunyikan bila tidak ada alternatif. */
export function UomPick({
  product,
  uoms,
  value,
  onChange,
}: {
  product: ProductOption | undefined;
  uoms: UomOption[];
  value: string;
  onChange: (uomId: string) => void;
}) {
  const base = product ? uoms.find((u) => u.id === product.uomId) : undefined;
  const options = base ? uoms.filter((u) => u.categoryId === base.categoryId) : [];
  if (options.length < 2) return base ? <small className="muted"> {base.name}</small> : null;
  return (
    <select className="uom" value={value || base!.id} onChange={(e) => onChange(e.target.value)}>
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}
