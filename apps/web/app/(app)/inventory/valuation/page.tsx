"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";
import { DatasetDrillPanel, type DatasetDrillRequest } from "../../../../components/drilldown-panel";

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
  const [drill, setDrill] = useState<DatasetDrillRequest | null>(null);

  useEffect(() => {
    api<Valuation>(`/stock/valuation?date=${date}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [date]);

  type Item = Valuation["items"][number];
  const columns = useMemo<ViewColumn<Item>[]>(
    () => [
      { key: "product", label: l("Produk", "Product"), value: (r) => `${r.sku} ${r.name}` },
      {
        key: "costMethod",
        label: l("Metode", "Method"),
        type: "enum",
        value: (r) => r.costMethod.toUpperCase(),
      },
      {
        key: "quantity",
        label: l("Kuantitas", "Quantity"),
        type: "number",
        value: (r) => Number(r.quantity),
      },
      {
        key: "averageCost",
        label: l("Biaya rata-rata", "Average cost"),
        type: "number",
        value: (r) => (r.averageCost === null ? null : Number(r.averageCost)),
      },
      { key: "value", label: l("Nilai", "Value"), type: "number", value: (r) => Number(r.value) },
    ],
    [l],
  );
  const table = useTableView(data?.items ?? [], columns, { storageKey: "stock-valuation" });
  const filteredTotal =
    data && table.total !== data.items.length
      ? table.filtered.reduce((sum, r) => sum + Number(r.value), 0)
      : Number(data?.total ?? 0);

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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && <TableTools view={table} />}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="product">
                  {l("Produk", "Product")}
                </SortTh>
                <SortTh view={table} col="costMethod">
                  {l("Metode", "Method")}
                </SortTh>
                <SortTh view={table} col="quantity" className="num">
                  {l("Kuantitas", "Quantity")}
                </SortTh>
                <SortTh view={table} col="averageCost" className="num">
                  {l("Biaya rata-rata", "Average cost")}
                </SortTh>
                <SortTh view={table} col="value" className="num">
                  {l("Nilai", "Value")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.productId}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        setDrill({
                          title: `${r.sku} ${r.name}`,
                          body: {
                            dataset: "stock_moves",
                            filters: { to: date },
                            match: { _productId: r.productId },
                          },
                        })
                      }
                    >
                      {r.sku} {r.name}
                    </button>
                  </td>
                  <td>{r.costMethod.toUpperCase()}</td>
                  <td className="num">{money(r.quantity, locale, 4)}</td>
                  <td className="num">{r.averageCost ? money(r.averageCost, locale, 4) : "—"}</td>
                  <td className="num">{money(r.value, locale)}</td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {data.items.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada persediaan bernilai.", "No valued inventory yet.")}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>
                  {l("Total (cocokkan dengan akun 1-1400)", "Total (reconcile with account 1-1400)")}
                </th>
                <th className="num">{money(filteredTotal, locale)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {data && <TablePager view={table} />}
      <DatasetDrillPanel request={drill} onClose={() => setDrill(null)} />
    </>
  );
}
