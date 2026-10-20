"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, apiRaw } from "../lib/api";
import { AuthImage } from "./auth-image";
import { useI18n } from "../lib/i18n";
import { canWrite, type Resource } from "../lib/resources";
import { useMe } from "./me-context";

type Row = Record<string, unknown> & { id: string };
const PAGE = 50;

/** Nama tampilan untuk kolom relasi (field `ref`) — dimuat sekali per resource rujukan. */
function useRefLabels(resource: Resource) {
  const [labels, setLabels] = useState<Record<string, Map<string, string>>>({});
  useEffect(() => {
    const refs = resource.fields.filter(
      (f): f is Extract<Resource["fields"][number], { type: "ref" }> =>
        f.type === "ref" && resource.columns.some((c) => c.name === f.name),
    );
    for (const f of refs) {
      api<{ items: Row[] } | Row[]>(`/${f.resource}${f.resource.includes("?") ? "&" : "?"}limit=200`)
        .then((d) => {
          const rows = Array.isArray(d) ? d : d.items;
          const map = new Map(rows.map((r) => [String(r[f.valueKey ?? "id"]), String(r[f.display] ?? "")]));
          setLabels((prev) => ({ ...prev, [f.name]: map }));
        })
        .catch(() => undefined);
    }
  }, [resource]);
  return labels;
}

const COLORS = ["#714b67", "#017e84", "#f06050", "#f0a033", "#6c5fb0", "#2e8b57", "#d4609c", "#3f7fbf"];
/** Warna avatar kartu yang konsisten per nama. */
const avatarColor = (name: string) =>
  COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]!;

/** Pilihan tampilan per resource (kanban bawaan bila tersedia), diingat di browser. */
function useViewMode(resource: Resource) {
  const key = `erp.view.${resource.path}`;
  const fallback: "kanban" | "list" = resource.kanban ? "kanban" : "list";
  const [view, setViewState] = useState<"kanban" | "list">(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "kanban" || saved === "list") setViewState(resource.kanban ? saved : "list");
    } catch {
      // localStorage tidak tersedia; pakai tampilan bawaan.
    }
  }, [key, resource.kanban]);
  const setView = (v: "kanban" | "list") => {
    setViewState(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // abaikan
    }
  };
  return [view, setView] as const;
}

export function ListView({ resource }: { resource: Resource }) {
  const me = useMe();
  const { t, tx } = useI18n();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<{ row: number; path: string; message: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const writable = canWrite(me.permissions, resource);
  const refLabels = useRefLabels(resource);
  const [view, setView] = useViewMode(resource);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q) params.set("q", q);
    const timer = setTimeout(() => {
      api<{ items: Row[]; total: number }>(`/${resource.path}?${params}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [resource.path, q, offset, reload]);

  const cell = (row: Row, name: string) => {
    const v = row[name];
    if (v === null || v === undefined) return "";
    const field = resource.fields.find((f) => f.name === name);
    if (field?.type === "select") {
      const option = field.options.find(([key]) => key === v);
      if (option) return tx(option[1]);
    }
    return refLabels[name]?.get(String(v)) ?? String(v);
  };

  async function exportFile(format: "csv" | "xlsx") {
    const params = new URLSearchParams(q ? { q } : {});
    if (format === "xlsx") params.set("format", "xlsx");
    const res = await apiRaw(`/${resource.path}/export${params.size ? `?${params}` : ""}`);
    if (!res.ok) return setError(res.statusText);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource.path}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    setError(null);
    setNotice(null);
    setImportErrors([]);
    try {
      const result = await api<{ created: number; updated: number }>(`/${resource.path}/import`, {
        method: "POST",
        // .xlsx dikirim base64; selainnya dibaca sebagai teks CSV.
        body: /\.xlsx$/i.test(file.name) ? { xlsx: await toBase64(file) } : { csv: await file.text() },
      });
      setNotice(t("list.imported", result));
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setImportErrors((e.body.errors as typeof importErrors) ?? []);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          {writable && (
            <Link className="button primary" href={`/${resource.path}/new`}>
              {t("list.new")}
            </Link>
          )}
          <h1>{tx(resource.title)}</h1>
        </div>
        <div className="cp-search">
          <input
            type="search"
            placeholder={t("list.search")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <div className="cp-right">
          {resource.csv && <button onClick={() => exportFile("csv")}>{t("list.export")}</button>}
          {resource.csv && <button onClick={() => exportFile("xlsx")}>{t("list.exportXlsx")}</button>}
          {resource.csv && writable && (
            <>
              <button onClick={() => fileInput.current?.click()}>{t("list.import")}</button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importCsv(file);
                }}
              />
            </>
          )}
          {data && (
            <span className="muted pager-text">
              {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, data.total)} / {data.total}
            </span>
          )}
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            aria-label="‹"
          >
            ‹
          </button>
          <button
            disabled={!data || offset + PAGE >= data.total}
            onClick={() => setOffset(offset + PAGE)}
            aria-label="›"
          >
            ›
          </button>
          {resource.kanban && (
            <span className="view-switch">
              <button
                className={view === "kanban" ? "active" : ""}
                title="Kanban"
                onClick={() => setView("kanban")}
              >
                ▦
              </button>
              <button
                className={view === "list" ? "active" : ""}
                title="List"
                onClick={() => setView("list")}
              >
                ☰
              </button>
            </span>
          )}
        </div>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {importErrors.length > 0 && (
        <ul className="error">
          {importErrors.slice(0, 20).map((e, i) => (
            <li key={i}>
              {t("list.row")} {e.row}
              {e.path && ` · ${e.path}`}: {e.message}
            </li>
          ))}
        </ul>
      )}
      {data && view === "kanban" && resource.kanban && (
        <div className="record-cards">
          {data.items.map((row) => {
            const title = cell(row, resource.kanban!.title) || "—";
            const tag = resource.kanban!.tag && cell(row, resource.kanban!.tag);
            return (
              <Link key={row.id} href={`/${resource.path}/${row.id}`} className="record-card">
                {(() => {
                  const initial = (
                    <span className="record-avatar" style={{ background: avatarColor(title) }}>
                      {title.slice(0, 1).toUpperCase()}
                    </span>
                  );
                  const image = resource.kanban!.image;
                  return image && row[image.flag] ? (
                    <AuthImage
                      path={`/${image.path.replace("{id}", String(row.id))}`}
                      alt={title}
                      className="record-avatar"
                      fallback={initial}
                    />
                  ) : (
                    initial
                  );
                })()}
                <span className="record-body">
                  <strong>{title}</strong>
                  {resource.kanban!.lines.map((name) => {
                    const v = cell(row, name);
                    return v ? <span key={name}>{v}</span> : null;
                  })}
                  {tag && <span className="tag">{tag}</span>}
                </span>
              </Link>
            );
          })}
          {data.items.length === 0 && <p className="muted">{t("list.empty")}</p>}
        </div>
      )}
      {data && view === "list" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {resource.columns.map((c) => (
                  <th key={c.name}>{tx(c.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  {resource.columns.map((c, i) => (
                    <td key={c.name}>
                      {i === 0 ? (
                        <Link href={`/${resource.path}/${row.id}`}>{cell(row, c.name) || "—"}</Link>
                      ) : (
                        cell(row, c.name)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={resource.columns.length} className="muted">
                    {t("list.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Isi berkas sebagai base64 (tanpa awalan data URL). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
