"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Lot {
  id: string;
  name: string;
  productName: string;
  sku: string;
  expirationDate: string | null;
  onHand: string;
}

/** Lot & nomor serial beserta stok tersedia dan tanggal kedaluwarsa. */
export default function LotsPage() {
  const { l, locale } = useI18n();
  const [q, setQ] = useState("");
  const [available, setAvailable] = useState(true);
  const [rows, setRows] = useState<Lot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (available) params.set("available", "true");
    const timer = setTimeout(
      () =>
        api<Lot[]>(`/stock/lots?${params}`)
          .then(setRows)
          .catch((e: Error) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [q, available]);

  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Lot / Serial", "Lots / Serial Numbers")}</h1>
        <input
          type="search"
          placeholder={l("Cari nomor…", "Search number…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="field check">
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
          <span>{l("Hanya yang tersedia", "Available only")}</span>
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Lot / serial", "Lot / serial")}</th>
                <th>{l("Produk", "Product")}</th>
                <th className="num">{l("Tersedia", "On hand")}</th>
                <th>{l("Kedaluwarsa", "Expiration")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    {r.sku} {r.productName}
                  </td>
                  <td className="num">{money(r.onHand, locale, 4)}</td>
                  <td className={r.expirationDate && r.expirationDate <= soon ? "overdue" : ""}>
                    {formatDate(r.expirationDate, locale)}
                    {r.expirationDate && r.expirationDate < today()
                      ? ` (${l("kedaluwarsa", "expired")})`
                      : ""}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {l("Belum ada lot.", "No lots yet.")}
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
