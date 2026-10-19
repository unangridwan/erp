"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, PICKING_KINDS, PICKING_STATE_LABEL, type PickingKind } from "../../lib/resources";
import { useMe } from "../me-context";

interface Row {
  id: string;
  name: string;
  state: string;
  scheduledDate: string;
  dateDone: string | null;
  origin: string | null;
  partnerName: string | null;
  warehouseCode: string;
  backorderOfId: string | null;
  returnOfId: string | null;
}

const PAGE = 50;

export function PickingList({ kind }: { kind: PickingKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = PICKING_KINDS[kind];
  const [q, setQ] = useState("");
  const [state, setState] = useState("draft,ready");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      pickingType: def.type,
      limit: String(PAGE),
      offset: String(offset),
    });
    if (q) params.set("q", q);
    if (state) params.set("state", state);
    const timer = setTimeout(
      () =>
        api<{ items: Row[]; total: number }>(`/pickings?${params}`)
          .then(setData)
          .catch((e: Error) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [def, q, state, offset]);

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        <input
          type="search"
          placeholder={l("Cari nomor, dokumen asal, partner…", "Search number, source, partner…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setOffset(0);
          }}
        >
          <option value="draft,ready">{l("Belum selesai", "To do")}</option>
          <option value="done">{l("Selesai", "Done")}</option>
          <option value="cancel">{l("Batal", "Cancelled")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
        {/* Dropship hanya dibuat dari pesanan penjualan. */}
        {can(me.permissions, "inventory.write") && def.type !== "dropship" && (
          <Link className="button primary" href={`/inventory/pickings/new?type=${def.type}`}>
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Nomor", "Reference")}</th>
                <th>{l("Partner", "Partner")}</th>
                <th>{l("Dokumen asal", "Source document")}</th>
                <th>{l("Jadwal", "Scheduled")}</th>
                <th>{l("Selesai", "Done")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/inventory/pickings/${p.id}`}>{p.name}</Link>
                    {p.backorderOfId && <small className="muted"> · backorder</small>}
                    {p.returnOfId && <small className="muted"> · {l("retur", "return")}</small>}
                  </td>
                  <td>{p.partnerName}</td>
                  <td>{p.origin}</td>
                  <td>{formatDate(p.scheduledDate, locale)}</td>
                  <td>{p.dateDone ? formatDate(p.dateDone.slice(0, 10), locale) : ""}</td>
                  <td>
                    <span className={`badge state-${p.state === "done" ? "posted" : p.state}`}>
                      {tx(PICKING_STATE_LABEL[p.state]!)}
                    </span>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {l("Tidak ada transfer.", "No transfers.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE, data.total)} {l("dari", "of")} {data.total}
          </span>
          <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </button>
        </div>
      )}
    </>
  );
}
