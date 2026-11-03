"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import {
  can,
  INVOICE_STATUS_LABEL,
  ORDER_KINDS,
  ORDER_STATE_LABEL,
  type OrderKind,
} from "../../lib/resources";
import { truncatedNote, useListData } from "../../lib/use-list-data";
import { DataTable, type DataColumn } from "../data-table";
import { useMe } from "../me-context";

interface OrderRow {
  id: string;
  name: string;
  state: string;
  dateOrder: string;
  validityDate: string | null;
  partnerName: string;
  userId: string | null;
  userName: string | null;
  clientOrderRef: string | null;
  currencyCode: string;
  amountTotal: string;
  invoiceStatus: string;
}

/** Penawaran / pesanan penjualan: dimuat sekali, lalu cari, filter, sort & paginasi di browser. */
export function OrderList({ kind }: { kind: OrderKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = ORDER_KINDS[kind];
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const list = useListData<OrderRow>(
    "/sale-orders",
    { state: def.state, invoiceStatus: def.invoiceStatus || null },
    search,
  );
  const rows = useMemo(
    () => (mine ? list.rows.filter((o) => o.userId === me.userId) : list.rows),
    [list.rows, mine, me.userId],
  );
  const quotations = kind === "quotations";

  const columns = useMemo<DataColumn<OrderRow>[]>(
    () => [
      {
        key: "name",
        label: l("Nomor", "Number"),
        value: (o) => o.name,
        render: (o) => <Link href={`/sales/orders/${o.id}`}>{o.name}</Link>,
      },
      {
        key: "dateOrder",
        label: l("Tanggal", "Date"),
        type: "date",
        value: (o) => o.dateOrder,
        text: (o) => formatDate(o.dateOrder, locale),
      },
      { key: "partner", label: l("Pelanggan", "Customer"), value: (o) => o.partnerName },
      { key: "clientOrderRef", label: l("Ref. pelanggan", "Customer ref."), value: (o) => o.clientOrderRef },
      { key: "user", label: l("Penjual", "Salesperson"), type: "enum", value: (o) => o.userName },
      {
        key: "amountTotal",
        label: l("Total", "Total"),
        type: "number",
        className: "num",
        value: (o) => Number(o.amountTotal),
        text: (o) => `${o.currencyCode} ${money(o.amountTotal, locale)}`,
      },
      quotations
        ? {
            key: "state",
            label: l("Status", "Status"),
            type: "enum",
            value: (o) => o.state,
            text: (o) => (ORDER_STATE_LABEL[o.state] ? tx(ORDER_STATE_LABEL[o.state]!) : o.state),
            render: (o) => (
              <span className={`badge state-${o.state}`}>{tx(ORDER_STATE_LABEL[o.state]!)}</span>
            ),
          }
        : {
            key: "invoiceStatus",
            label: l("Penagihan", "Invoicing"),
            type: "enum",
            value: (o) => o.invoiceStatus,
            text: (o) =>
              INVOICE_STATUS_LABEL[o.invoiceStatus]
                ? tx(INVOICE_STATUS_LABEL[o.invoiceStatus]!)
                : o.invoiceStatus,
            render: (o) => (
              <span className={`badge state-${o.invoiceStatus}`}>
                {tx(INVOICE_STATUS_LABEL[o.invoiceStatus]!)}
              </span>
            ),
          },
    ],
    [l, tx, locale, quotations],
  );

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        {quotations && can(me.permissions, "sales.write") && (
          <Link className="button primary" href="/sales/orders/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && <p className="error">{list.error}</p>}
      {!list.loading || list.rows.length ? (
        <DataTable
          rows={rows}
          columns={columns}
          storageKey={`sale-orders.${kind}`}
          rowKey={(o) => o.id}
          defaultSort={{ key: "dateOrder", dir: "desc" }}
          note={truncatedNote(list, l)}
          onSearch={setSearch}
          searchPlaceholder={l("Cari nomor, pelanggan, ref…", "Search number, customer, reference…")}
          empty={l("Belum ada data.", "No records yet.")}
          tools={
            <label className="check">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              <span>{l("Milik saya", "Mine")}</span>
            </label>
          }
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
