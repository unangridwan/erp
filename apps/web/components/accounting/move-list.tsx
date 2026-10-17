"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { money, formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { can, MOVE_KINDS, type MoveKind } from "../../lib/resources";
import { useMe } from "../me-context";
import { PaymentBadge, StateBadge, TypeLabel } from "./badges";

interface Move {
  id: string;
  name: string | null;
  moveType: string;
  state: string;
  date: string;
  dueDate: string | null;
  ref: string | null;
  partnerName: string | null;
  currencyCode: string;
  amountTotal: string;
  amountResidual: string;
  paymentState: string;
}

const PAGE = 50;

export function MoveList({ kind }: { kind: MoveKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = MOVE_KINDS[kind];
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Move[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isEntry = kind === "entries";

  useEffect(() => {
    const load = async () => {
      // Satu halaman per jenis dokumen (faktur + nota kredit digabung).
      const results = await Promise.all(
        def.types.map((type) => {
          const params = new URLSearchParams({ type, limit: String(PAGE), offset: String(offset) });
          if (q) params.set("q", q);
          if (state) params.set("state", state);
          return api<{ items: Move[]; total: number }>(`/moves?${params}`);
        }),
      );
      const items = results.flatMap((r) => r.items).sort((a, b) => b.date.localeCompare(a.date));
      setData({ items, total: results.reduce((t, r) => t + r.total, 0) });
    };
    const timer = setTimeout(() => load().catch((e: Error) => setError(e.message)), 200);
    return () => clearTimeout(timer);
  }, [def, q, state, offset]);

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        <input
          type="search"
          placeholder={l("Cari nomor, referensi, partner…", "Search number, reference, partner…")}
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
          <option value="">{l("Semua status", "All states")}</option>
          <option value="draft">Draft</option>
          <option value="posted">{l("Diposting", "Posted")}</option>
        </select>
        {can(me.permissions, "accounting.write") && (
          <Link className="button primary" href={`/accounting/moves/new?type=${def.newType}`}>
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
                <th>{l("Nomor", "Number")}</th>
                <th>{l("Tanggal", "Date")}</th>
                {!isEntry && <th>{l("Partner", "Partner")}</th>}
                <th>{l("Referensi", "Reference")}</th>
                {!isEntry && <th>{l("Jatuh tempo", "Due")}</th>}
                <th className="num">{l("Total", "Total")}</th>
                {!isEntry && <th className="num">{l("Sisa", "Due amount")}</th>}
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/accounting/moves/${m.id}`}>{m.name ?? l("Draft", "Draft")}</Link>
                    {m.moveType.endsWith("refund") && (
                      <small className="muted">
                        {" "}
                        · <TypeLabel type={m.moveType} />
                      </small>
                    )}
                  </td>
                  <td>{formatDate(m.date, locale)}</td>
                  {!isEntry && <td>{m.partnerName}</td>}
                  <td>{m.ref}</td>
                  {!isEntry && <td>{formatDate(m.dueDate, locale)}</td>}
                  <td className="num">
                    {isEntry ? "" : `${m.currencyCode} `}
                    {money(m.amountTotal, locale)}
                  </td>
                  {!isEntry && (
                    <td className="num">{m.state === "posted" ? money(m.amountResidual, locale) : ""}</td>
                  )}
                  <td>
                    <StateBadge state={m.state} />{" "}
                    {!isEntry && m.state === "posted" && <PaymentBadge state={m.paymentState} />}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {l("Belum ada dokumen.", "No documents yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE && (
        <footer className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </button>
        </footer>
      )}
    </>
  );
}
