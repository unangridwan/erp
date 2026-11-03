"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Row {
  orderId: string;
  orderName: string;
  partnerName: string;
  lineId: string;
  name: string;
  quantity: string;
  productType: string | null;
  received: string;
  billed: string;
  status: "to_bill" | "over_billed";
}

/** Pencocokan 3 arah: PO vs barang diterima vs tagihan pemasok. */
export default function MatchingPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Row[]>("/purchase-orders/matching")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const n = (v: string) => money(v, locale, 4);
  const columns = useMemo<ViewColumn<Row>[]>(
    () => [
      { key: "orderName", label: "PO", value: (r) => r.orderName },
      { key: "partner", label: l("Pemasok", "Vendor"), type: "enum", value: (r) => r.partnerName },
      { key: "name", label: l("Produk", "Product"), value: (r) => r.name },
      { key: "quantity", label: l("Dipesan", "Ordered"), type: "number", value: (r) => Number(r.quantity) },
      {
        key: "received",
        label: l("Diterima", "Received"),
        type: "number",
        value: (r) => (r.productType === "service" ? null : Number(r.received)),
      },
      { key: "billed", label: l("Ditagih", "Billed"), type: "number", value: (r) => Number(r.billed) },
      {
        key: "status",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.status,
        text: (r) =>
          r.status === "over_billed"
            ? l("Ditagih melebihi diterima", "Billed more than received")
            : l("Perlu ditagihkan", "To bill"),
      },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, { storageKey: "purchase-matching" });
  return (
    <>
      <header className="toolbar">
        <h1>{l("Pencocokan 3 Arah", "3-Way Matching")}</h1>
      </header>
      <p className="muted">
        {l(
          "Baris PO terkonfirmasi yang jumlah ditagih belum sama dengan jumlah diterima (barang) atau dipesan (jasa).",
          "Confirmed PO lines where the billed quantity differs from the received (goods) or ordered (services) quantity.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows && <TableTools view={table} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="orderName">
                  PO
                </SortTh>
                <SortTh view={table} col="partner">
                  {l("Pemasok", "Vendor")}
                </SortTh>
                <SortTh view={table} col="name">
                  {l("Produk", "Product")}
                </SortTh>
                <SortTh view={table} col="quantity" className="num">
                  {l("Dipesan", "Ordered")}
                </SortTh>
                <SortTh view={table} col="received" className="num">
                  {l("Diterima", "Received")}
                </SortTh>
                <SortTh view={table} col="billed" className="num">
                  {l("Ditagih", "Billed")}
                </SortTh>
                <SortTh view={table} col="status">
                  {l("Status", "Status")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.lineId}>
                  <td>
                    <Link href={`/purchase/orders/${r.orderId}`}>{r.orderName}</Link>
                  </td>
                  <td>{r.partnerName}</td>
                  <td>{r.name}</td>
                  <td className="num">{n(r.quantity)}</td>
                  <td className="num">{r.productType === "service" ? "—" : n(r.received)}</td>
                  <td className="num">{n(r.billed)}</td>
                  <td>
                    {r.status === "over_billed" ? (
                      <span className="badge state-lost">
                        {l("Ditagih melebihi diterima", "Billed more than received")}
                      </span>
                    ) : (
                      <span className="badge state-to_invoice">{l("Perlu ditagihkan", "To bill")}</span>
                    )}
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Semua PO sudah cocok.", "All purchase orders match.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && <TablePager view={table} />}
    </>
  );
}
