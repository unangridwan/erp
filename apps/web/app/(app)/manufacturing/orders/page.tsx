"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { MO_STATE, moPill } from "../../../../components/manufacturing/states";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Row {
  id: string;
  name: string;
  state: string;
  sku: string;
  productName: string;
  quantity: string;
  qtyProduced: string;
  datePlanned: string;
  origin: string | null;
  unitCost: string;
}

/** Daftar order produksi. */
export default function ProductionOrdersPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    api<Row[]>("/production-orders")
      .then(setRows)
      .catch((e: Error) => toast.error(e.message));
  }, []);
  const shown = rows?.filter((r) => !state || r.state === state);
  return (
    <>
      <header className="toolbar">
        <h1>{l("Order Produksi", "Production Orders")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="">{l("Semua status", "All states")}</option>
          {Object.entries(MO_STATE).map(([k, v]) => (
            <option key={k} value={k}>
              {l(...v)}
            </option>
          ))}
        </select>
        {can(me.permissions, "mrp.write") && (
          <Link className="button primary" href="/manufacturing/orders/new">
            {l("Baru", "New")}
          </Link>
        )}
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Produk", "Product")}</th>
              <th className="num">{l("Jumlah", "Quantity")}</th>
              <th>{l("Rencana", "Planned")}</th>
              <th>{l("Asal", "Origin")}</th>
              <th className="num">{l("Biaya/unit", "Unit cost")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {shown?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada order produksi.", "No production orders yet.")}
                </td>
              </tr>
            )}
            {shown?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/manufacturing/orders/${r.id}`}>{r.name}</Link>
                </td>
                <td>
                  {r.sku} {r.productName}
                </td>
                <td className="num">
                  {r.state === "done" ? money(r.qtyProduced, locale, 4) : money(r.quantity, locale, 4)}
                </td>
                <td>{formatDate(r.datePlanned, locale)}</td>
                <td>{r.origin ?? "—"}</td>
                <td className="num">{r.state === "done" ? money(r.unitCost, locale, 2) : "—"}</td>
                <td>
                  <span className={`pill ${moPill(r.state)}`}>
                    {l(...(MO_STATE[r.state] ?? [r.state, r.state]))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
