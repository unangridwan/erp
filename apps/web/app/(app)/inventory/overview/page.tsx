"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  id: string;
  sku: string;
  name: string;
  productType: string;
  tracking: string;
  costMethod: string;
  uomName: string;
  onHand: string;
  incoming: string;
  outgoing: string;
  forecast: string;
  averageCost: string | null;
  value: string | null;
}

/** Stok per produk: tersedia, akan masuk/keluar, perkiraan, dan nilai persediaan. */
export default function StockOverviewPage() {
  const { l, locale } = useI18n();
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const [q, setQ] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (warehouseId) params.set("warehouseId", warehouseId);
    const timer = setTimeout(
      () =>
        api<Row[]>(`/stock/overview?${params}`)
          .then(setRows)
          .catch((e: Error) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [q, warehouseId]);

  const total = rows?.reduce((s, r) => s + Number(r.value ?? 0), 0) ?? 0;
  const n = (v: string) => money(v, locale, 4);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Stok", "Stock")}</h1>
        <input
          type="search"
          placeholder={l("Cari produk…", "Search product…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">{l("Semua gudang", "All warehouses")}</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </header>
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Produk", "Product")}</th>
                <th className="num">{l("Tersedia", "On hand")}</th>
                <th className="num">{l("Akan masuk", "Incoming")}</th>
                <th className="num">{l("Akan keluar", "Outgoing")}</th>
                <th className="num">{l("Perkiraan", "Forecast")}</th>
                <th className="num">{l("Biaya rata-rata", "Average cost")}</th>
                {!warehouseId && <th className="num">{l("Nilai", "Value")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/inventory/card?productId=${r.id}`}>
                      {r.sku} {r.name}
                    </Link>
                    <small className="muted">
                      {" "}
                      ·{" "}
                      {r.productType === "consumable"
                        ? l("habis pakai", "consumable")
                        : r.costMethod.toUpperCase()}
                      {r.tracking !== "none" ? ` · ${r.tracking}` : ""}
                    </small>
                  </td>
                  <td className={`num${Number(r.onHand) < 0 ? " overdue" : ""}`}>
                    {n(r.onHand)} {r.uomName}
                  </td>
                  <td className="num">{n(r.incoming)}</td>
                  <td className="num">{n(r.outgoing)}</td>
                  <td className="num">{n(r.forecast)}</td>
                  <td className="num">{r.averageCost ? money(r.averageCost, locale, 4) : "—"}</td>
                  {!warehouseId && <td className="num">{r.value ? money(r.value, locale) : "—"}</td>}
                </tr>
              ))}
            </tbody>
            {!warehouseId && (
              <tfoot>
                <tr>
                  <th colSpan={6}>{l("Total nilai persediaan", "Total inventory value")}</th>
                  <th className="num">{money(total, locale)}</th>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}
