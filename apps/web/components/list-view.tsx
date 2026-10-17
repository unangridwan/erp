"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, apiRaw } from "../lib/api";
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
    return refLabels[name]?.get(String(v)) ?? String(v);
  };

  async function exportCsv() {
    const res = await apiRaw(`/${resource.path}/export${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (!res.ok) return setError(res.statusText);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource.path}.csv`;
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
        body: { csv: await file.text() },
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
      <header className="toolbar">
        <h1>{tx(resource.title)}</h1>
        <input
          type="search"
          placeholder={t("list.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        {resource.csv && <button onClick={exportCsv}>{t("list.export")}</button>}
        {resource.csv && writable && (
          <>
            <button onClick={() => fileInput.current?.click()}>{t("list.import")}</button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importCsv(file);
              }}
            />
          </>
        )}
        {writable && (
          <Link className="button primary" href={`/${resource.path}/new`}>
            {t("list.new")}
          </Link>
        )}
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
      {data && (
        <>
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
          <footer className="pager">
            <span className="muted">
              {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, data.total)} {t("list.of")}{" "}
              {data.total}
            </span>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ‹
            </button>
            <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
              ›
            </button>
          </footer>
        </>
      )}
    </>
  );
}
