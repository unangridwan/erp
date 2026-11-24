"use client";

import type { BiFilter, BiResult, BiVisual } from "@erp/shared";
import { useMemo, useState } from "react";
import { categoryLabel } from "../../lib/bi-format";
import { useI18n } from "../../lib/i18n";

/** Filter dari pilihan slicer (null = tidak memfilter). */
export function slicerFilter(
  visual: BiVisual,
  picked: { values?: string[]; from?: string; to?: string } | null,
): BiFilter | null {
  const f = visual.axis[0];
  if (!f || !picked) return null;
  if (visual.options.slicer === "range") {
    if (!picked.from && !picked.to) return null;
    return {
      column: f.column,
      level: f.level ?? null,
      op: "between",
      value: picked.from ?? "",
      value2: picked.to ?? "",
      values: [],
      source: visual.id,
    };
  }
  if (!picked.values?.length) return null;
  return {
    column: f.column,
    level: f.level ?? null,
    op: "in",
    value: "",
    value2: "",
    values: picked.values,
    source: visual.id,
  };
}

export type SlicerPick = { values?: string[]; from?: string; to?: string } | null;

/** Slicer: daftar centang (dengan pencarian), dropdown, atau rentang. */
export function SlicerView({
  visual,
  result,
  pick,
  onPick,
}: {
  visual: BiVisual;
  result?: BiResult;
  pick: SlicerPick;
  onPick: (p: SlicerPick) => void;
}) {
  const { l, locale } = useI18n();
  const [q, setQ] = useState("");
  const options = useMemo(
    () => (result?.categories ?? []).map((c) => ({ key: c.key, label: categoryLabel(c.label, locale) })),
    [result, locale],
  );
  if (!visual.axis[0])
    return <p className="muted small">{l("Pilih kolom slicer.", "Choose a slicer field.")}</p>;
  if (!result) return <div className="skeleton-block" aria-busy="true" />;
  if (result.error) return <p className="error small">{result.error}</p>;
  const name = visual.title || result.fields[0]?.header || l("Slicer", "Slicer");
  const style = visual.options.slicer ?? "list";

  if (style === "range") {
    const keys = options.map((o) => o.key).filter(Boolean);
    const date = keys.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
    return (
      <div className="bi-slicer range">
        <label className="field">
          <span>{l("Dari", "From")}</span>
          <input
            type={date ? "date" : "text"}
            aria-label={`${name} — ${l("dari", "from")}`}
            placeholder={keys[0] ?? ""}
            value={pick?.from ?? ""}
            onChange={(e) => onPick({ ...pick, from: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{l("Sampai", "To")}</span>
          <input
            type={date ? "date" : "text"}
            aria-label={`${name} — ${l("sampai", "to")}`}
            placeholder={keys[keys.length - 1] ?? ""}
            value={pick?.to ?? ""}
            onChange={(e) => onPick({ ...pick, to: e.target.value })}
          />
        </label>
        {(pick?.from || pick?.to) && (
          <button type="button" className="link" onClick={() => onPick(null)}>
            {l("Hapus", "Clear")}
          </button>
        )}
      </div>
    );
  }

  if (style === "dropdown")
    return (
      <div className="bi-slicer">
        <select
          aria-label={name}
          value={pick?.values?.[0] ?? ""}
          onChange={(e) => onPick(e.target.value ? { values: [e.target.value] } : null)}
        >
          <option value="">{l("Semua", "All")}</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );

  const selected = new Set(pick?.values ?? []);
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onPick(next.size ? { values: [...next] } : null);
  };
  return (
    <div className="bi-slicer list">
      {options.length > 8 && (
        <input
          type="search"
          aria-label={`${l("Cari", "Search")} ${name}`}
          placeholder={l("Cari…", "Search…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <ul role="group" aria-label={name}>
        {shown.map((o) => (
          <li key={o.key}>
            <label>
              <input type="checkbox" checked={selected.has(o.key)} onChange={() => toggle(o.key)} /> {o.label}
            </label>
          </li>
        ))}
      </ul>
      {selected.size > 0 && (
        <button type="button" className="link small" onClick={() => onPick(null)}>
          {l("Hapus pilihan", "Clear selection")} ({selected.size})
        </button>
      )}
    </div>
  );
}
