"use client";

import { LIST_LOAD_LIMIT, type TableColumnType } from "@erp/shared";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, apiRaw } from "../lib/api";
import { truncatedNote, useListData } from "../lib/use-list-data";
import { useTableView, type ViewColumn } from "../lib/use-table-view";
import { AuthImage } from "./auth-image";
import { SortSelect, SortTh, TablePager, TableTools } from "./data-table";
import { ExportDialog, type ExportChoice } from "./export-dialog";
import { useI18n } from "../lib/i18n";
import { canCreate, canExport, canWrite, type Resource } from "../lib/resources";
import { useMe } from "./me-context";

type Row = Record<string, unknown> & { id: string };

/** Tipe kolom tanpa definisi field: dari isi data (angka, tanggal, atau sedikit nilai berbeda = pilihan). */
function inferType(rows: Row[], name: string): TableColumnType {
  const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== "");
  if (!values.length) return "text";
  if (values.every((v) => typeof v === "boolean")) return "enum";
  if (values.every((v) => typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v)))) return "number";
  if (values.every((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v)))) return "date";
  const distinct = new Set(values.map(String));
  return distinct.size <= 12 && distinct.size < values.length ? "enum" : "text";
}

/** Nama tampilan untuk kolom relasi (field `ref`) — dimuat sekali per resource rujukan. */
function useRefLabels(resource: Resource) {
  const [labels, setLabels] = useState<Record<string, Map<string, string>>>({});
  useEffect(() => {
    const refs = resource.fields.filter(
      (f): f is Extract<Resource["fields"][number], { type: "ref" }> =>
        f.type === "ref" && resource.columns.some((c) => c.name === f.name),
    );
    for (const f of refs) {
      api<{ items: Row[] } | Row[]>(
        `/${f.resource}${f.resource.includes("?") ? "&" : "?"}limit=${LIST_LOAD_LIMIT}`,
      )
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

// Semua cukup gelap untuk huruf putih (kontras ≥ 4,5:1).
const COLORS = ["#714b67", "#016b70", "#b8432f", "#94590a", "#5b4fa3", "#22704a", "#a83d78", "#2f66a3"];
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
  const { t, tx, l } = useI18n();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<{ row: number; path: string; message: string }[]>([]);
  const [exportColumns, setExportColumns] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const writable = canWrite(me.permissions, resource);
  const refLabels = useRefLabels(resource);
  const [view, setView] = useViewMode(resource);

  // Data dimuat sekali (s.d. 5.000 baris); cari/filter/sort/paginasi di browser.
  const list = useListData<Row>(`/${resource.path}`, {}, search);

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

  const columns = useMemo<ViewColumn<Row>[]>(
    () =>
      resource.columns.map((c) => {
        const field = resource.fields.find((f) => f.name === c.name);
        const type: TableColumnType =
          field?.type === "select" || field?.type === "ref" || field?.type === "boolean"
            ? "enum"
            : field?.type === "number"
              ? "number"
              : field?.type === "date"
                ? "date"
                : field
                  ? "text"
                  : inferType(list.rows, c.name);
        return {
          key: c.name,
          label: tx(c.label),
          type,
          value: (row: Row) => {
            const v = row[c.name];
            return typeof v === "boolean" ? String(v) : (v as string | number | null | undefined);
          },
          text: (row: Row) => {
            const v = row[c.name];
            if (typeof v === "boolean") return v ? l("Ya", "Yes") : l("Tidak", "No");
            return cell(row, c.name);
          },
        };
      }),
    [resource, list.rows, refLabels, tx, l],
  );
  const table = useTableView(list.rows, columns, { storageKey: `list.${resource.path}` });
  useEffect(() => setSearch(table.state.q), [table.state.q]);
  const data = list.loading && !list.rows.length ? null : list;

  async function openExport() {
    setError(null);
    try {
      setExportColumns(await api<string[]>(`/${resource.path}/export-columns`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportFile({ columns, format }: ExportChoice) {
    const params = new URLSearchParams(table.state.q ? { q: table.state.q } : {});
    params.set("columns", columns.join(","));
    if (format === "xlsx") params.set("format", "xlsx");
    const res = await apiRaw(`/${resource.path}/export?${params}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
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
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setImportErrors((e.body.errors as typeof importErrors) ?? []);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          {canCreate(me.permissions, resource) && (
            <Link className="button primary" href={`/${resource.path}/new`}>
              {t("list.new")}
            </Link>
          )}
          <h1>{tx(resource.title)}</h1>
        </div>
        <div className="cp-right">
          {resource.csv && canExport(me.permissions, resource) && (
            <button onClick={openExport}>{t("list.export")}…</button>
          )}
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
      {(error ?? list.error) && <p className="error">{error ?? list.error}</p>}
      <TableTools view={table} placeholder={t("list.search")} note={truncatedNote(list, l)}>
        {view === "kanban" && resource.kanban && <SortSelect view={table} />}
      </TableTools>
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
          {table.rows.map((row) => {
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
          {table.rows.length === 0 && <p className="muted">{t("list.empty")}</p>}
        </div>
      )}
      {data && view === "list" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {resource.columns.map((c) => (
                  <SortTh key={c.name} view={table} col={c.name}>
                    {tx(c.label)}
                  </SortTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
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
              {table.rows.length === 0 && (
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
      {data && <TablePager view={table} />}
      {resource.csv && exportColumns !== null && (
        <ExportDialog
          open
          onClose={() => setExportColumns(null)}
          title={`${t("list.export")} ${tx(resource.title)}`}
          storageKey={`erp.export.${resource.path}`}
          columns={(exportColumns ?? []).map((key) => {
            const field = resource.fields.find((f) => f.name === key);
            return {
              key,
              header: key === "id" ? "id" : field ? tx(field.label) : key,
              group: field?.section ? tx(field.section) : tx(resource.singular),
              key0: key === "id",
            };
          })}
          onExport={exportFile}
        />
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
