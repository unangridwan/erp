"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { RefSelect } from "./ref-select";
import { ask } from "./feedback";

export interface ExportColumn {
  key: string;
  header: string;
  group: string;
  /** Kolom kunci: selalu ikut (tidak bisa dihapus). */
  key0?: boolean;
}

export interface ExportFilter {
  key: string;
  label: string;
  type: "date" | "select" | "ref";
  options?: [string, string][];
  resource?: string;
}

export interface ExportChoice {
  columns: string[];
  filters: Record<string, string>;
  format: "xlsx" | "csv";
}

interface Preset {
  id: string;
  name: string;
  columns: string[];
  filters: Record<string, string>;
  shared: boolean;
  mine: boolean;
}

const read = (key: string): Partial<ExportChoice> => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<ExportChoice>;
  } catch {
    return {};
  }
};

/**
 * Dialog ekspor: user memilih kolom (per grup, urutan bisa digeser), filter, dan format; pilihan terakhir diingat
 * per dataset di browser. Bila `presetsPath` diisi, kolom & filter bisa disimpan sebagai profil ekspor.
 */
export function ExportDialog({
  open,
  onClose,
  title,
  columns,
  filters = [],
  storageKey,
  presetsPath,
  canShare = false,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: ExportColumn[];
  filters?: ExportFilter[];
  storageKey: string;
  presetsPath?: string;
  canShare?: boolean;
  onExport: (choice: ExportChoice) => Promise<void>;
}) {
  const { l } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const keys = useMemo(() => columns.map((c) => c.key), [columns]);
  const fixed = useMemo(() => columns.filter((c) => c.key0).map((c) => c.key), [columns]);
  const [selected, setSelected] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPresets = useCallback(() => {
    if (presetsPath) api<Preset[]>(presetsPath).then(setPresets, () => setPresets([]));
  }, [presetsPath]);

  // Saat dibuka: pulihkan pilihan terakhir (hanya kolom yang masih ada), bawaan = semua kolom.
  useEffect(() => {
    if (!open) return dialog.current?.close();
    if (!dialog.current?.open) dialog.current?.showModal();
    const saved = read(storageKey);
    const cols = (saved.columns ?? []).filter((k) => keys.includes(k));
    setSelected(cols.length ? [...fixed.filter((k) => !cols.includes(k)), ...cols] : keys);
    setValues(saved.filters ?? {});
    setFormat(saved.format ?? "xlsx");
    setError(null);
    loadPresets();
  }, [open, storageKey, keys, fixed, loadPresets]);

  const groups = useMemo(() => {
    const out = new Map<string, ExportColumn[]>();
    for (const c of columns) out.set(c.group, [...(out.get(c.group) ?? []), c]);
    return [...out.entries()];
  }, [columns]);
  const header = (k: string) => columns.find((c) => c.key === k)?.header ?? k;
  const toggle = (k: string, on: boolean) =>
    setSelected((s) =>
      on ? (s.includes(k) ? s : [...s, k]) : s.filter((x) => x !== k || fixed.includes(x)),
    );
  const move = (i: number, d: -1 | 1) =>
    setSelected((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function submit() {
    setBusy(true);
    setError(null);
    const choice = {
      columns: selected,
      filters: Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
      format,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(choice));
    } catch {
      // Penyimpanan browser tidak tersedia: abaikan.
    }
    try {
      await onExport(choice);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePreset() {
    if (!presetsPath || !presetName.trim()) return;
    setError(null);
    try {
      await api(presetsPath, {
        method: "POST",
        body: { name: presetName.trim(), columns: selected, filters: values, shared },
      });
      setPresetName("");
      setShared(false);
      loadPresets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const cols = p.columns.filter((k) => keys.includes(k));
    setSelected([...fixed.filter((k) => !cols.includes(k)), ...cols]);
    setValues(p.filters ?? {});
  };

  return (
    <dialog ref={dialog} className="export-dialog" onClose={onClose} aria-label={title}>
      <header className="toolbar">
        <h2>{title}</h2>
        <button type="button" className="link" onClick={onClose} aria-label={l("Tutup", "Close")}>
          ✕
        </button>
      </header>
      {presetsPath && presets.length > 0 && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Profil ekspor", "Export profile")}</span>
            <select value="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="">{l("— pilih profil —", "— choose a profile —")}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.shared ? ` (${l("bersama", "shared")})` : ""}
                </option>
              ))}
            </select>
          </label>
          {presets.some((p) => p.mine || (p.shared && canShare)) && (
            <label className="field">
              <span>{l("Hapus profil", "Delete profile")}</span>
              <select
                value=""
                onChange={async (e) => {
                  const id = e.target.value;
                  if (id && (await ask(l("Hapus profil ekspor ini?", "Delete this export profile?"))))
                    api(`${presetsPath}/${id}`, { method: "DELETE" }).then(loadPresets, (err: Error) =>
                      setError(err.message),
                    );
                }}
              >
                <option value="">—</option>
                {presets
                  .filter((p) => p.mine || (p.shared && canShare))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}
      {filters.length > 0 && (
        <div className="inline-panel">
          {filters.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              {f.type === "date" ? (
                <input
                  type="date"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : f.type === "select" ? (
                <select
                  value={values[f.key] ?? f.options?.[0]?.[0] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  {f.options!.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              ) : (
                <RefSelect
                  name={f.key}
                  resource={f.resource!}
                  display="name"
                  value={values[f.key] ?? ""}
                  onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="export-columns">
        <div>
          <h3>{l("Kolom", "Columns")}</h3>
          {groups.map(([group, cols]) => (
            <fieldset key={group} className="export-group">
              <legend>
                {group}{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => cols.forEach((c) => toggle(c.key, true))}
                >
                  {l("semua", "all")}
                </button>{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => cols.forEach((c) => toggle(c.key, false))}
                >
                  {l("kosongkan", "none")}
                </button>
              </legend>
              {cols.map((c) => (
                <label key={c.key} className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.key)}
                    disabled={c.key0}
                    onChange={(e) => toggle(c.key, e.target.checked)}
                  />
                  {c.header}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div>
          <h3>
            {l("Urutan kolom", "Column order")} <small className="muted">({selected.length})</small>
          </h3>
          <ol className="export-order">
            {selected.map((k, i) => (
              <li key={k}>
                <span>{header(k)}</span>
                <span>
                  <button
                    type="button"
                    className="link"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={l("Naik", "Up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="link"
                    disabled={i === selected.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={l("Turun", "Down")}
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {presetsPath && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Simpan pilihan sebagai profil", "Save selection as profile")}</span>
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={l("Nama profil", "Profile name")}
            />
          </label>
          {canShare && (
            <label className="field check">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              {l("Bagikan ke semua pengguna", "Share with all users")}
            </label>
          )}
          <button type="button" disabled={!presetName.trim()} onClick={savePreset}>
            {l("Simpan profil", "Save profile")}
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="form-actions">
        <label className="check">
          <input
            type="radio"
            name="export-format"
            checked={format === "xlsx"}
            onChange={() => setFormat("xlsx")}
          />
          Excel (.xlsx)
        </label>
        <label className="check">
          <input
            type="radio"
            name="export-format"
            checked={format === "csv"}
            onChange={() => setFormat("csv")}
          />
          CSV
        </label>
        <button type="button" className="primary" disabled={busy || !selected.length} onClick={submit}>
          {busy ? l("Mengekspor…", "Exporting…") : l("Ekspor", "Export")}
        </button>
        <button type="button" className="link" onClick={onClose}>
          {l("Batal", "Cancel")}
        </button>
      </footer>
    </dialog>
  );
}
