"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import {
  can,
  INVOICE_STATUS_LABEL,
  ORDER_KINDS,
  ORDER_STATE_LABEL,
  type OrderKind,
} from "../../lib/resources";
import { useMe } from "../me-context";

interface OrderRow {
  id: string;
  name: string;
  state: string;
  dateOrder: string;
  validityDate: string | null;
  partnerName: string;
  userName: string | null;
  clientOrderRef: string | null;
  currencyCode: string;
  amountTotal: string;
  invoiceStatus: string;
}

const PAGE = 50;

export function OrderList({ kind }: { kind: OrderKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = ORDER_KINDS[kind];
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: OrderRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ state: def.state, limit: String(PAGE), offset: String(offset) });
    if (def.invoiceStatus) params.set("invoiceStatus", def.invoiceStatus);
    if (q) params.set("q", q);
    if (mine) params.set("userId", "me");
    const timer = setTimeout(
      () =>
        api<{ items: OrderRow[]; total: number }>(`/sale-orders?${params}`)
          .then(setData)
          .catch((e: Error) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [def, q, mine, offset]);

  const quotations = kind === "quotations";

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        <input
          type="search"
          placeholder={l("Cari nomor, pelanggan, ref…", "Search number, customer, reference…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <label className="field check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>{l("Milik saya", "Mine")}</span>
        </label>
        {quotations && can(me.permissions, "sales.write") && (
          <Link className="button primary" href="/sales/orders/new">
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
                <th>{l("Pelanggan", "Customer")}</th>
                <th>{l("Ref. pelanggan", "Customer ref.")}</th>
                <th>{l("Penjual", "Salesperson")}</th>
                <th className="num">{l("Total", "Total")}</th>
                <th>{quotations ? l("Status", "Status") : l("Penagihan", "Invoicing")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/sales/orders/${o.id}`}>{o.name}</Link>
                  </td>
                  <td>{formatDate(o.dateOrder, locale)}</td>
                  <td>{o.partnerName}</td>
                  <td>{o.clientOrderRef}</td>
                  <td>{o.userName}</td>
                  <td className="num">
                    {o.currencyCode} {money(o.amountTotal, locale)}
                  </td>
                  <td>
                    {quotations ? (
                      <span className={`badge state-${o.state}`}>{tx(ORDER_STATE_LABEL[o.state]!)}</span>
                    ) : (
                      <span className={`badge state-${o.invoiceStatus}`}>
                        {tx(INVOICE_STATUS_LABEL[o.invoiceStatus]!)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {l("Belum ada data.", "No records yet.")}
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
