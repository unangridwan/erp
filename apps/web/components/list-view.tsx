"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { canWrite, type Resource } from "../lib/resources";
import { useMe } from "./me-context";

type Row = Record<string, unknown> & { id: string };
const PAGE = 50;

export function ListView({ resource }: { resource: Resource }) {
  const me = useMe();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [resource.path, q, offset]);

  return (
    <>
      <header className="toolbar">
        <h1>{resource.title}</h1>
        <input
          type="search"
          placeholder="Cari…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        {canWrite(me.permissions, resource) && (
          <Link className="button primary" href={`/${resource.path}/new`}>
            Baru
          </Link>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {resource.columns.map((c) => (
                    <th key={c.name}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    {resource.columns.map((c, i) => (
                      <td key={c.name}>
                        {i === 0 ? (
                          <Link href={`/${resource.path}/${row.id}`}>{String(row[c.name] ?? "—")}</Link>
                        ) : (
                          String(row[c.name] ?? "")
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={resource.columns.length} className="muted">
                      Belum ada data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="pager">
            <span className="muted">
              {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, data.total)} dari {data.total}
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
