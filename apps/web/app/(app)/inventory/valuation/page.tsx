"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Valuation {
  date: string;
  total: string;
  items: {
    productId: string;
    sku: string;
    name: string;
    costMethod: string;
    quantity: string;
    value: string;
    averageCost: string | null;
  }[];
}

/** Nilai persediaan per produk pada tanggal tertentu (untuk dicocokkan dengan saldo akun Persediaan). */
export default function ValuationPage() {
  const { l, locale } = useI18n();
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Valuation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Valuation>(`/stock/valuation?date=${date}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [date]);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Valuasi Persediaan", "Inventory Valuation")}</h1>
        <label className="field">
          <span>{l("Per tanggal", "As of")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" onClick={() => window.print()}>
          {l("Cetak", "Print")}
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Produk", "Product")}</th>
                <th>{l("Metode", "Method")}</th>
                <th className="num">{l("Kuantitas", "Quantity")}</th>
                <th className="num">{l("Biaya rata-rata", "Average cost")}</th>
                <th className="num">{l("Nilai", "Value")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.productId}>
                  <td>
                    {r.sku} {r.name}
                  </td>
                  <td>{r.costMethod.toUpperCase()}</td>
                  <td className="num">{money(r.quantity, locale, 4)}</td>
                  <td className="num">{r.averageCost ? money(r.averageCost, locale, 4) : "—"}</td>
                  <td className="num">{money(r.value, locale)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {l("Belum ada persediaan bernilai.", "No valued inventory yet.")}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>
                  {l("Total (cocokkan dengan akun 1-1400)", "Total (reconcile with account 1-1400)")}
                </th>
                <th className="num">{money(data.total, locale)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
