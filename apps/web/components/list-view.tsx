"use client";

import { formatCustomValue, LIST_LOAD_LIMIT, type TableColumnType } from "@erp/shared";
import { useCustomFields } from "./custom-fields";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, apiRaw } from "../lib/api";
import { formatDate, money } from "../lib/format";
import { truncatedNote, useListData } from "../lib/use-list-data";
import { useTableView, type ViewColumn } from "../lib/use-table-view";
import { AuthImage } from "./auth-image";
import { SortSelect, SortTh, TablePager, TableTools, useRowLink } from "./data-table";
import { EmptyState } from "./empty-state";
import { ask, Skeleton, toast } from "./feedback";
import { ExportDialog, type ExportChoice } from "./export-dialog";
import { useI18n } from "../lib/i18n";
import { canCreate, canDelete, canExport, canWrite, type Resource } from "../lib/resources";
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
const COLORS = ["#1f5fbf", "#0e7a6b", "#b54708", "#6941c6", "#067647", "#b42318", "#2b6cb0", "#9a3412"];
/** Warna avatar kartu yang konsisten per nama. */
const avatarColor = (name: string) =>
  COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]!;

/**
 * Pilihan tampilan per resource, diingat di browser. Bawaan: tabel di layar lebar (lebih mudah dipindai &
 * dibandingkan), kartu di ponsel bila resource punya tampilan kartu.
 */
function useViewMode(resource: Resource) {
  const key = `erp.view.${resource.path}`;
  const [view, setViewState] = useState<"kanban" | "list">("list");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "kanban" || saved === "list") setViewState(resource.kanban ? saved : "list");
      else setViewState(resource.kanban && window.innerWidth < 1024 ? "kanban" : "list");
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
  const { t, tx, l, locale } = useI18n();
  const customDefs = useCustomFields(resource.customModel);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<{ row: number; path: string; message: string }[]>([]);
  const [exportColumns, setExportColumns] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const writable = canWrite(me.permissions, resource);
  const refLabels = useRefLabels(resource);
  const [view, setView] = useViewMode(resource);
  // Menu "Lainnya" tertutup saat klik di luar.
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (moreRef.current?.open && !moreRef.current.contains(e.target as Node)) moreRef.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const rowLink = useRowLink();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const deletable = !resource.noDelete && canDelete(me.permissions, resource);
  const hasActive = resource.fields.some((f) => f.name === "active");
  const selectable =
    view === "list" && (deletable || (writable && hasActive) || canExport(me.permissions, resource));

  // Data dimuat sekali (s.d. 5.000 baris); cari/filter/sort/paginasi di browser.
  const list = useListData<Row>(`/${resource.path}`, {}, search);

  const customListDefs = customDefs.filter((d) => d.showInList);
  const listColumns = [
    ...resource.columns,
    ...customListDefs.map((d) => ({
      name: `custom.${d.key}`,
      label: { id: d.label, en: d.labelEn || d.label },
    })),
  ];
  const customDef = (name: string) =>
    name.startsWith("custom.") ? customDefs.find((d) => `custom.${d.key}` === name) : undefined;
  const customRaw = (row: Row, name: string) =>
    ((row.custom ?? {}) as Record<string, unknown>)[name.slice("custom.".length)];

  const cell = (row: Row, name: string) => {
    const def = customDef(name);
    if (def) return formatCustomValue(def, customRaw(row, name), { lang: locale });
    const v = row[name];
    if (v === null || v === undefined) return "";
    const field = resource.fields.find((f) => f.name === name);
    if (field?.type === "select") {
      const option = field.options.find(([key]) => key === v);
      if (option) return tx(option[1]);
    }
    return refLabels[name]?.get(String(v)) ?? String(v);
  };

  /** Nilai untuk ditampilkan: angka dengan pemisah ribuan & tanggal terbaca (ekspor CSV tetap memakai `cell`). */
  const fieldOf = (name: string) => resource.fields.find((f) => f.name === name);
  const numeric = (name: string) => fieldOf(name)?.type === "number";
  const display = (row: Row, name: string) => {
    const field = fieldOf(name);
    const v = row[name];
    if (field?.type === "number" && v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v)))
      return money(v as string | number, locale);
    if (field?.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))
      return formatDate(v.slice(0, 10), locale);
    if (typeof v === "boolean") return v ? l("Ya", "Yes") : l("Tidak", "No");
    return cell(row, name);
  };

  const columns = useMemo<ViewColumn<Row>[]>(
    () =>
      listColumns.map((c) => {
        const field = resource.fields.find((f) => f.name === c.name);
        const def = customDef(c.name);
        if (def)
          return {
            key: c.name,
            label: tx(c.label),
            type: (def.fieldType === "number" || def.fieldType === "money"
              ? "number"
              : def.fieldType === "date"
                ? "date"
                : def.fieldType === "select" || def.fieldType === "boolean"
                  ? "enum"
                  : "text") as TableColumnType,
            value: (row: Row) => {
              const v = customRaw(row, c.name);
              if (def.fieldType === "select" || def.fieldType === "boolean") return cell(row, c.name) || null;
              return Array.isArray(v) ? cell(row, c.name) : (v as string | number | null | undefined);
            },
            text: (row: Row) => cell(row, c.name),
          };
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
    [resource, list.rows, refLabels, tx, l, customDefs, locale],
  );
  const table = useTableView(list.rows, columns, { storageKey: `list.${resource.path}` });
  useEffect(() => setSearch(table.state.q), [table.state.q]);
  const data = list.loading && !list.rows.length ? null : list;
  const shownColumns = listColumns.filter((c) => !table.hidden.includes(c.name));
  // Pilihan hanya untuk baris yang masih ada setelah dimuat ulang.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(list.rows.map((r) => r.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [list.rows]);
  const pageIds = table.rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const recordLabel = (row: Row) => cell(row, resource.columns[0]?.name ?? "id") || row.id;

  async function bulk(kind: "delete" | "archive" | "activate") {
    const ids = [...selected];
    const n = ids.length;
    const verb =
      kind === "delete"
        ? l("Hapus", "Delete")
        : kind === "archive"
          ? l("Arsipkan", "Archive")
          : l("Aktifkan", "Activate");
    if (
      !(await ask({
        title: `${verb} ${n} ${tx(resource.singular).toLowerCase()}`,
        message:
          kind === "delete"
            ? l(
                `Hapus ${n} data terpilih? Tindakan ini tidak bisa dibatalkan.`,
                `Delete ${n} selected records? This cannot be undone.`,
              )
            : l(`${verb} ${n} data terpilih?`, `${verb} ${n} selected records?`),
        confirmLabel: verb,
        danger: kind !== "activate",
      }))
    )
      return;
    setBulkBusy(true);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        if (kind === "delete") await api(`/${resource.path}/${id}`, { method: "DELETE" });
        else await api(`/${resource.path}/${id}`, { method: "PATCH", body: { active: kind === "activate" } });
      } catch (e) {
        const row = list.rows.find((r) => r.id === id);
        failed.push(`${row ? recordLabel(row) : id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    list.reload();
    const ok = n - failed.length;
    if (ok) toast.success(l(`${verb}: ${ok} data berhasil.`, `${verb}: ${ok} records done.`));
    if (failed.length)
      toast.error(
        l(
          `${failed.length} gagal — ${failed.slice(0, 3).join("; ")}`,
          `${failed.length} failed — ${failed.slice(0, 3).join("; ")}`,
        ),
      );
  }

  function exportSelected() {
    const rows = list.rows.filter((r) => selected.has(r.id));
    const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [
      shownColumns.map((c) => esc(tx(c.label))).join(","),
      ...rows.map((r) => shownColumns.map((c) => esc(cell(r, c.name))).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource.path}-terpilih.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(l(`${rows.length} data diekspor.`, `${rows.length} records exported.`));
  }

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
      toast.success(t("list.imported", result));
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setImportErrors((e.body.errors as typeof importErrors) ?? []);
    }
  }

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{tx(resource.title)}</h1>
        </div>
        <div className="cp-right">
          {resource.csv && (canExport(me.permissions, resource) || writable) && (
            <details className="more-menu" ref={moreRef}>
              <summary className="button">{l("Lainnya", "More")}</summary>
              <div className="nav-items right">
                {canExport(me.permissions, resource) && (
                  <button
                    type="button"
                    className="nav-item"
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      void openExport();
                    }}
                  >
                    {t("list.export")}…
                  </button>
                )}
                {writable && (
                  <button
                    type="button"
                    className="nav-item"
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      fileInput.current?.click();
                    }}
                  >
                    {t("list.import")}
                  </button>
                )}
              </div>
            </details>
          )}
          {resource.csv && writable && (
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
          )}
          {resource.kanban && (
            <span className="view-switch" role="group" aria-label={l("Tampilan", "View")}>
              <button
                className={view === "list" ? "active" : ""}
                aria-pressed={view === "list"}
                title={l("Tampilan tabel", "Table view")}
                onClick={() => setView("list")}
              >
                <span aria-hidden>☰</span> {l("Tabel", "Table")}
              </button>
              <button
                className={view === "kanban" ? "active" : ""}
                aria-pressed={view === "kanban"}
                title={l("Tampilan kartu", "Card view")}
                onClick={() => setView("kanban")}
              >
                <span aria-hidden>▦</span> {l("Kartu", "Cards")}
              </button>
            </span>
          )}
          {canCreate(me.permissions, resource) && (
            <Link className="button primary" href={`/${resource.path}/new`}>
              + {t("list.new")}
            </Link>
          )}
        </div>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {(error ?? list.error) && <p className="error">{error ?? list.error}</p>}
      <TableTools
        view={table}
        placeholder={t("list.search")}
        note={truncatedNote(list, l)}
        columnChooser={view === "list"}
      >
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
                    const v = display(row, name);
                    return v ? <span key={name}>{v}</span> : null;
                  })}
                  {tag && <span className="tag">{tag}</span>}
                </span>
              </Link>
            );
          })}
          {table.rows.length === 0 && (
            <EmptyState
              filtered={list.rows.length > 0}
              onClear={table.clearFilters}
              createHref={canCreate(me.permissions, resource) ? `/${resource.path}/new` : undefined}
              createLabel={l(
                `Buat ${tx(resource.singular).toLowerCase()} pertama`,
                `Create the first ${tx(resource.singular).toLowerCase()}`,
              )}
            />
          )}
        </div>
      )}
      {!data && !list.error && <Skeleton rows={6} />}
      {selectable && selected.size > 0 && (
        <div
          className="bulk-bar"
          role="toolbar"
          aria-label={l("Aksi untuk data terpilih", "Actions for selected rows")}
        >
          <strong>{l(`${selected.size} dipilih`, `${selected.size} selected`)}</strong>
          {table.filtered.length > selected.size && (
            <button
              type="button"
              className="link"
              onClick={() => setSelected(new Set(table.filtered.map((r) => r.id)))}
            >
              {l(`Pilih semua ${table.filtered.length} hasil`, `Select all ${table.filtered.length} results`)}
            </button>
          )}
          <span className="bulk-actions">
            {canExport(me.permissions, resource) && (
              <button type="button" onClick={exportSelected} disabled={bulkBusy}>
                {l("Ekspor CSV", "Export CSV")}
              </button>
            )}
            {writable && hasActive && (
              <>
                <button type="button" onClick={() => void bulk("archive")} disabled={bulkBusy}>
                  {l("Arsipkan", "Archive")}
                </button>
                <button type="button" onClick={() => void bulk("activate")} disabled={bulkBusy}>
                  {l("Aktifkan", "Activate")}
                </button>
              </>
            )}
            {deletable && (
              <button
                type="button"
                className="danger"
                onClick={() => void bulk("delete")}
                disabled={bulkBusy}
                aria-busy={bulkBusy}
              >
                {l("Hapus", "Delete")}
              </button>
            )}
            <button type="button" className="link" onClick={() => setSelected(new Set())}>
              {l("Batal pilih", "Clear selection")}
            </button>
          </span>
        </div>
      )}
      {data && view === "list" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {selectable && (
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label={l("Pilih semua di halaman ini", "Select all on this page")}
                      checked={allOnPage}
                      onChange={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          for (const id of pageIds) {
                            if (allOnPage) next.delete(id);
                            else next.add(id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                )}
                {shownColumns.map((c) => (
                  <SortTh
                    key={c.name}
                    view={table}
                    col={c.name}
                    className={numeric(c.name) ? "num" : undefined}
                  >
                    {tx(c.label)}
                  </SortTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const link = rowLink(`/${resource.path}/${row.id}`);
                return (
                  <tr
                    key={row.id}
                    {...link}
                    className={`${link.className}${selected.has(row.id) ? " selected" : ""}`}
                  >
                    {selectable && (
                      <td className="col-check">
                        <input
                          type="checkbox"
                          aria-label={l(`Pilih ${recordLabel(row)}`, `Select ${recordLabel(row)}`)}
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                        />
                      </td>
                    )}
                    {shownColumns.map((c, i) => (
                      <td key={c.name} className={numeric(c.name) ? "num" : undefined}>
                        {i === 0 ? (
                          <Link href={`/${resource.path}/${row.id}`}>{display(row, c.name) || "—"}</Link>
                        ) : (
                          display(row, c.name)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={shownColumns.length + (selectable ? 1 : 0)}>
                    <EmptyState
                      compact
                      filtered={list.rows.length > 0}
                      onClear={table.clearFilters}
                      createHref={canCreate(me.permissions, resource) ? `/${resource.path}/new` : undefined}
                      createLabel={l(
                        `Buat ${tx(resource.singular).toLowerCase()} pertama`,
                        `Create the first ${tx(resource.singular).toLowerCase()}`,
                      )}
                    />
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
            const def = customDef(key);
            return {
              key,
              header: key === "id" ? "id" : field ? tx(field.label) : def ? def.label : key,
              group: field?.section
                ? tx(field.section)
                : def
                  ? l("Field kustom", "Custom fields")
                  : tx(resource.singular),
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
