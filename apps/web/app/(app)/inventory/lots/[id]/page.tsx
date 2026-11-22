"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "../../../../../components/feedback";
import { openPdf } from "../../../../../components/hr/contract-document";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { LoadFailed, useLoadError } from "../../../../../components/load-failed";

interface Trace {
  id: string;
  name: string;
  sku: string;
  productName: string;
  tracking: string;
  expirationDate: string | null;
  note: string | null;
  onHand: string;
  locations: { locationName: string; quantity: string }[];
  moves: {
    id: string;
    date: string | null;
    quantity: string;
    reference: string | null;
    pickingId: string | null;
    pickingName: string | null;
    pickingType: string | null;
    partnerName: string | null;
    origin: string | null;
    from: string;
    fromUsage: string;
    to: string;
    toUsage: string;
    isInventory: boolean;
  }[];
}

/** Riwayat satu nomor lot/serial: dari mana masuk, dipindah ke mana, dikirim ke siapa, dan posisinya sekarang. */
export default function LotTracePage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [loadError, failLoad] = useLoadError();
  const [t, setT] = useState<Trace | null>(null);
  useEffect(() => {
    api<Trace>(`/stock-lots/${id}/trace`).then(setT).catch(failLoad);
  }, [id]);
  if (!t)
    return loadError ? (
      <LoadFailed message={loadError} />
    ) : (
      <p className="muted">{l("Memuat…", "Loading…")}</p>
    );
  const kind = (m: Trace["moves"][number]) =>
    m.isInventory
      ? l("Penyesuaian / opname", "Adjustment / count")
      : m.pickingType === "incoming"
        ? l("Penerimaan", "Receipt")
        : m.pickingType === "outgoing"
          ? l("Pengiriman", "Delivery")
          : m.pickingType === "dropship"
            ? l("Dropship", "Dropship")
            : m.fromUsage === "customer"
              ? l("Retur pelanggan", "Customer return")
              : m.toUsage === "supplier"
                ? l("Retur ke pemasok", "Return to vendor")
                : l("Transfer internal", "Internal transfer");
  const sign = (m: Trace["moves"][number]) =>
    m.toUsage === "internal" && m.fromUsage !== "internal"
      ? "+"
      : m.fromUsage === "internal" && m.toUsage !== "internal"
        ? "−"
        : "";
  return (
    <div className="stack-wide">
      <header className="toolbar">
        <h1>
          <Link href="/inventory/lots">{l("Lot / Serial", "Lots / Serial Numbers")}</Link> / {t.name}
        </h1>
        <button
          onClick={() =>
            openPdf(`/barcode/labels?lotIds=${t.id}`, `label-${t.name}.pdf`).catch((e: Error) =>
              toast.error(e.message),
            )
          }
        >
          {l("Cetak label", "Print label")}
        </button>
      </header>
      <div className="cards">
        <div className="card">
          <small className="muted">{l("Produk", "Product")}</small>
          <strong>
            {t.sku} {t.productName}
          </strong>
          <small className="muted">
            {t.tracking === "serial" ? l("Nomor serial", "Serial number") : l("Nomor lot", "Lot number")}
          </small>
        </div>
        <div className="card">
          <small className="muted">{l("Stok sekarang", "On hand")}</small>
          <strong>{money(t.onHand, locale, 4)}</strong>
          <small className="muted">
            {t.locations.map((x) => `${x.locationName} (${Number(x.quantity)})`).join(", ") ||
              l("tidak di gudang", "not in stock")}
          </small>
        </div>
        {t.expirationDate && (
          <div className="card">
            <small className="muted">{l("Kedaluwarsa", "Expiration")}</small>
            <strong>{formatDate(t.expirationDate, locale)}</strong>
          </div>
        )}
      </div>
      <h2>{l("Riwayat pergerakan", "Movement history")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Jenis", "Type")}</th>
              <th>{l("Dokumen", "Document")}</th>
              <th>{l("Mitra", "Partner")}</th>
              <th>{l("Dari → ke", "From → to")}</th>
              <th className="num">{l("Jumlah", "Quantity")}</th>
            </tr>
          </thead>
          <tbody>
            {t.moves.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {l("Belum ada pergerakan.", "No movements yet.")}
                </td>
              </tr>
            )}
            {t.moves.map((m) => (
              <tr key={m.id}>
                <td>{formatDate(m.date, locale)}</td>
                <td>{kind(m)}</td>
                <td>
                  {m.pickingId ? (
                    <Link href={`/inventory/pickings/${m.pickingId}`}>{m.pickingName}</Link>
                  ) : (
                    (m.reference ?? "—")
                  )}
                  {m.origin && <small className="muted"> · {m.origin}</small>}
                </td>
                <td>{m.partnerName ?? "—"}</td>
                <td>
                  {m.from} → {m.to}
                </td>
                <td className="num">
                  {sign(m)}
                  {money(m.quantity, locale, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
