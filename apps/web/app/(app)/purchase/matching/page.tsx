"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

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
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>{l("Pemasok", "Vendor")}</th>
                <th>{l("Produk", "Product")}</th>
                <th className="num">{l("Dipesan", "Ordered")}</th>
                <th className="num">{l("Diterima", "Received")}</th>
                <th className="num">{l("Ditagih", "Billed")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {l("Semua PO sudah cocok.", "All purchase orders match.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
