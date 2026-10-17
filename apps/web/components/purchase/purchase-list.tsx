"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import {
  can,
  INVOICE_STATUS_LABEL,
  PURCHASE_KINDS,
  PURCHASE_STATE_LABEL,
  RECEIPT_STATUS_LABEL,
  type PurchaseKind,
} from "../../lib/resources";
import { useMe } from "../me-context";

interface Row {
  id: string;
  name: string;
  state: string;
  dateOrder: string;
  datePlanned: string | null;
  partnerName: string;
  partnerRef: string | null;
  currencyCode: string;
  amountTotal: string;
  billStatus: string;
  receiptStatus: string;
}

const PAGE = 50;

export function PurchaseList({ kind }: { kind: PurchaseKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = PURCHASE_KINDS[kind];
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ state: def.state, limit: String(PAGE), offset: String(offset) });
    if (def.billStatus) params.set("billStatus", def.billStatus);
    if (q) params.set("q", q);
    const timer = setTimeout(
      () =>
        api<{ items: Row[]; total: number }>(`/purchase-orders?${params}`)
          .then(setData)
          .catch((e: Error) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [def, q, offset]);

  const rfq = kind === "rfq";
  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        <input
          type="search"
          placeholder={l("Cari nomor, pemasok, ref…", "Search number, vendor, reference…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        {rfq && can(me.permissions, "purchase.write") && (
          <Link className="button primary" href="/purchase/orders/new">
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
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Pemasok", "Vendor")}</th>
                <th>{l("Ref. pemasok", "Vendor ref.")}</th>
                <th className="num">{l("Total", "Total")}</th>
                <th>{rfq ? l("Status", "Status") : l("Penerimaan", "Receipt")}</th>
                {!rfq && <th>{l("Tagihan", "Billing")}</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/purchase/orders/${o.id}`}>{o.name}</Link>
                  </td>
                  <td>{formatDate(o.dateOrder, locale)}</td>
                  <td>{o.partnerName}</td>
                  <td>{o.partnerRef}</td>
                  <td className="num">
                    {o.currencyCode} {money(o.amountTotal, locale)}
                  </td>
                  <td>
                    {rfq ? (
                      <span className={`badge state-${o.state}`}>{tx(PURCHASE_STATE_LABEL[o.state]!)}</span>
                    ) : (
                      <span className={`badge state-${o.receiptStatus === "full" ? "sale" : "sent"}`}>
                        {tx(RECEIPT_STATUS_LABEL[o.receiptStatus]!)}
                      </span>
                    )}
                  </td>
                  {!rfq && (
                    <td>
                      <span className={`badge state-${o.billStatus}`}>
                        {tx(INVOICE_STATUS_LABEL[o.billStatus]!)}
                      </span>
                    </td>
                  )}
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
