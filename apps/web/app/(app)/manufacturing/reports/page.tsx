"use client";

import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  productId: string;
  sku: string;
  productName: string;
  orders: number;
  quantity: string;
  material: string;
  conversion: string;
  total: string;
  unitCost: string;
}

/** Laporan biaya produksi per produk (order selesai dalam periode). */
export default function ProductionCostReport() {
  const { l, locale } = useI18n();
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<Row[]>(`/manufacturing/reports/costs?from=${from}&to=${to}`)
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, [from, to]);
  const sum = (k: "material" | "conversion" | "total") => (rows ?? []).reduce((s, r) => s + Number(r[k]), 0);
  return (
    <>
      <header className="toolbar">
        <h1>{l("Biaya Produksi", "Production Costs")}</h1>
        <input
          type="date"
          aria-label={l("Dari", "From")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label={l("Sampai", "To")}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Produk", "Product")}</th>
              <th className="num">{l("Order", "Orders")}</th>
              <th className="num">{l("Diproduksi", "Produced")}</th>
              <th className="num">{l("Bahan", "Materials")}</th>
              <th className="num">{l("Konversi", "Conversion")}</th>
              <th className="num">{l("Total", "Total")}</th>
              <th className="num">{l("Biaya/unit", "Unit cost")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l(
                    "Tidak ada produksi selesai pada periode ini.",
                    "No completed production in this period.",
                  )}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.productId}>
                <td>
                  {r.sku} {r.productName}
                </td>
                <td className="num">{r.orders}</td>
                <td className="num">{money(r.quantity, locale, 4)}</td>
                <td className="num">{money(r.material, locale)}</td>
                <td className="num">{money(r.conversion, locale)}</td>
                <td className="num">{money(r.total, locale)}</td>
                <td className="num">{money(r.unitCost, locale, 2)}</td>
              </tr>
            ))}
          </tbody>
          {rows && rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>{l("Total", "Total")}</td>
                <td className="num">{money(String(sum("material")), locale)}</td>
                <td className="num">{money(String(sum("conversion")), locale)}</td>
                <td className="num">{money(String(sum("total")), locale)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
