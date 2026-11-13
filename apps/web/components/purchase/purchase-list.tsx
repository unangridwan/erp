"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { truncatedNote, useListData } from "../../lib/use-list-data";
import { DataTable, type DataColumn } from "../data-table";
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

/** RFQ / pesanan pembelian: dimuat sekali, lalu cari, filter, sort & paginasi di browser. */
export function PurchaseList({ kind }: { kind: PurchaseKind }) {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const def = PURCHASE_KINDS[kind];
  const [search, setSearch] = useState("");
  const list = useListData<Row>(
    "/purchase-orders",
    { state: def.state, billStatus: def.billStatus || null },
    search,
  );
  const rfq = kind === "rfq";
  const label = (map: Record<string, Parameters<typeof tx>[0]>, key: string) =>
    map[key] ? tx(map[key]!) : key;

  const columns = useMemo<DataColumn<Row>[]>(() => {
    const cols: DataColumn<Row>[] = [
      {
        key: "name",
        label: l("Nomor", "Reference"),
        value: (o) => o.name,
        render: (o) => <Link href={`/purchase/orders/${o.id}`}>{o.name}</Link>,
      },
      {
        key: "dateOrder",
        label: l("Tanggal", "Date"),
        type: "date",
        value: (o) => o.dateOrder,
        text: (o) => formatDate(o.dateOrder, locale),
      },
      { key: "partner", label: l("Pemasok", "Vendor"), value: (o) => o.partnerName },
      { key: "partnerRef", label: l("Ref. pemasok", "Vendor ref."), value: (o) => o.partnerRef },
      {
        key: "amountTotal",
        label: l("Total", "Total"),
        type: "number",
        className: "num",
        value: (o) => Number(o.amountTotal),
        text: (o) => `${o.currencyCode} ${money(o.amountTotal, locale)}`,
      },
    ];
    if (rfq)
      cols.push({
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (o) => o.state,
        text: (o) => label(PURCHASE_STATE_LABEL, o.state),
        render: (o) => (
          <span className={`badge state-${o.state}`}>{label(PURCHASE_STATE_LABEL, o.state)}</span>
        ),
      });
    else
      cols.push(
        {
          key: "receiptStatus",
          label: l("Penerimaan", "Receipt"),
          type: "enum",
          value: (o) => o.receiptStatus,
          text: (o) => label(RECEIPT_STATUS_LABEL, o.receiptStatus),
          render: (o) => (
            <span className={`badge state-${o.receiptStatus === "full" ? "sale" : "sent"}`}>
              {label(RECEIPT_STATUS_LABEL, o.receiptStatus)}
            </span>
          ),
        },
        {
          key: "billStatus",
          label: l("Tagihan", "Billing"),
          type: "enum",
          value: (o) => o.billStatus,
          text: (o) => label(INVOICE_STATUS_LABEL, o.billStatus),
          render: (o) => (
            <span className={`badge state-${o.billStatus}`}>{label(INVOICE_STATUS_LABEL, o.billStatus)}</span>
          ),
        },
      );
    return cols;
  }, [l, tx, locale, rfq]);

  return (
    <>
      <header className="toolbar">
        <h1>{tx(def.title)}</h1>
        {rfq && can(me.permissions, "purchase.write") && (
          <Link className="button primary" href="/purchase/orders/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      {list.error && <p className="error">{list.error}</p>}
      {!list.loading || list.rows.length ? (
        <DataTable
          customModel="purchase_order"
          rows={list.rows}
          columns={columns}
          storageKey={`purchase-orders.${kind}`}
          rowKey={(o) => o.id}
          rowHref={(o) => `/purchase/orders/${o.id}`}
          defaultSort={{ key: "dateOrder", dir: "desc" }}
          note={truncatedNote(list, l)}
          onSearch={setSearch}
          searchPlaceholder={l("Cari nomor, pemasok, ref…", "Search number, vendor, reference…")}
          empty={l("Belum ada data.", "No records yet.")}
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
