"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Row = Record<string, unknown>;

/** Dropdown untuk field relasi (many2one). Memuat hingga 200 opsi dari resource rujukan. */
export function RefSelect(props: {
  name: string;
  resource: string;
  display: string;
  valueKey?: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const [options, setOptions] = useState<Row[]>([]);
  const key = props.valueKey ?? "id";

  useEffect(() => {
    api<{ items: Row[] } | Row[]>(`/${props.resource}?limit=200`)
      .then((data) => setOptions(Array.isArray(data) ? data : data.items))
      .catch(() => setOptions([]));
  }, [props.resource]);

  return (
    <select
      name={props.name}
      value={props.value}
      required={props.required}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={String(o[key])} value={String(o[key])}>
          {String(o[props.display])}
        </option>
      ))}
    </select>
  );
}
