"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { DatasetDrillPanel, type DatasetDrillRequest } from "../../../../components/drilldown-panel";

interface Row {
  key: string | null;
  label: string;
  quantity?: string;
  amount: string;
  amountTotal?: string;
  orders: number;
}

const GROUPS = ["product", "partner", "salesperson", "month"] as const;

/** Analisis penjualan dari pesanan terkonfirmasi (nilai sebelum pajak). */
export default function SalesReportPage() {
  const { l, locale } = useI18n();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]>("product");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DatasetDrillRequest | null>(null);

  useEffect(() => {
    api<Row[]>(`/sale-orders/report?from=${from}&to=${to}&groupBy=${groupBy}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [from, to, groupBy]);

  const label: Record<(typeof GROUPS)[number], string> = {
    product: l("Produk", "Product"),
    partner: l("Pelanggan", "Customer"),
    salesperson: l("Penjual", "Salesperson"),
    month: l("Bulan", "Month"),
  };
  const total = rows?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
  const max = Math.max(1, ...(rows?.map((r) => Number(r.amount)) ?? [1]));

  return (
    <>
      <header className="toolbar">
        <h1>{l("Analisis Penjualan", "Sales Analysis")}</h1>
        <label className="field">
          <span>{l("Dari", "From")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>{l("Sampai", "To")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </header>
      <div className="tabs">
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            className={groupBy === g ? "active" : ""}
            onClick={() => setGroupBy(g)}
          >
            {label[g]}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{label[groupBy]}</th>
                {groupBy === "product" && <th className="num">{l("Kuantitas", "Quantity")}</th>}
                <th className="num">{l("Pesanan", "Orders")}</th>
                <th className="num">{l("Penjualan (sebelum pajak)", "Sales (untaxed)")}</th>
                <th style={{ width: "30%" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.key}-${r.label}`}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        setDrill({
                          title: r.label,
                          body: {
                            dataset: "sales_lines",
                            filters: { from, to },
                            match:
                              groupBy === "product"
                                ? { _productId: r.key ?? "" }
                                : groupBy === "partner"
                                  ? { _partnerId: r.key ?? "" }
                                  : groupBy === "salesperson"
                                    ? { _userId: r.key ?? "" }
                                    : { month: r.key ?? "" },
                          },
                        })
                      }
                    >
                      {r.label}
                    </button>
                  </td>
                  {groupBy === "product" && <td className="num">{money(r.quantity, locale, 4)}</td>}
                  <td className="num">{r.orders}</td>
                  <td className="num">{money(r.amount, locale)}</td>
                  <td>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: "var(--accent)",
                        width: `${(Number(r.amount) / max) * 100}%`,
                      }}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {l(
                      "Belum ada pesanan terkonfirmasi pada periode ini.",
                      "No confirmed orders in this period.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th>{l("Total", "Total")}</th>
                {groupBy === "product" && <th />}
                <th />
                <th className="num">{money(total, locale)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <DatasetDrillPanel request={drill} onClose={() => setDrill(null)} />
    </>
  );
}
