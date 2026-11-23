"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface Row {
  id: string;
  productName: string;
  sku: string;
  warehouseCode: string;
  minQty: string;
  maxQty: string;
  onHand: string;
  incoming: string;
  outgoing: string;
  rfq: string;
  forecast: string;
  toOrder: string;
  supplierName: string | null;
}

/** Saran pengadaan dari aturan min/max; jalankan untuk membuat RFQ ke pemasok utama. */
export default function ReplenishmentPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ orderIds: string[]; skipped: { productName: string }[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Row[]>("/replenishment")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  const n = (v: string) => money(v, locale, 4);
  const columns = useMemo<ViewColumn<Row>[]>(() => {
    const qty = (
      key: "onHand" | "incoming" | "outgoing" | "rfq" | "forecast" | "toOrder",
      label: string,
    ) => ({
      key,
      label,
      type: "number" as const,
      value: (r: Row) => Number(r[key]),
    });
    return [
      { key: "product", label: l("Produk", "Product"), value: (r) => `${r.sku} ${r.productName}` },
      { key: "warehouse", label: l("Gudang", "Warehouse"), type: "enum", value: (r) => r.warehouseCode },
      qty("onHand", l("Tersedia", "On hand")),
      qty("incoming", l("Masuk", "Incoming")),
      qty("outgoing", l("Keluar", "Outgoing")),
      qty("rfq", "RFQ"),
      qty("forecast", l("Perkiraan", "Forecast")),
      { key: "minQty", label: "Min / Max", type: "number", value: (r) => Number(r.minQty) },
      qty("toOrder", l("Perlu dipesan", "To order")),
      { key: "supplier", label: l("Pemasok", "Vendor"), type: "enum", value: (r) => r.supplierName },
    ];
  }, [l]);
  const table = useTableView(rows ?? [], columns, { storageKey: "replenishment" });
  const runAll = async () => {
    setError(null);
    try {
      setResult(await api("/replenishment/run", { method: "POST", body: {} }));
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pengadaan Ulang", "Replenishment")}</h1>
        <Link className="button" href="/reorder-rules">
          {l("Aturan pemesanan ulang", "Reordering rules")}
        </Link>
        {can(me.permissions, "purchase.write") && (
          <button
            type="button"
            className="primary"
            disabled={!rows?.some((r) => Number(r.toOrder) > 0)}
            onClick={runAll}
          >
            {l("Buat RFQ", "Create RFQs")}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="notice">
          {l(`${result.orderIds.length} RFQ dibuat.`, `${result.orderIds.length} RFQ(s) created.`)}{" "}
          {result.orderIds.map((id) => (
            <Link key={id} href={`/purchase/orders/${id}`}>
              {l("Buka", "Open")}{" "}
            </Link>
          ))}
          {result.skipped.length > 0 &&
            l(
              ` Tanpa pemasok: ${result.skipped.map((s) => s.productName).join(", ")}.`,
              ` No vendor: ${result.skipped.map((s) => s.productName).join(", ")}.`,
            )}
        </p>
      )}
      {rows && <TableTools view={table} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="product">
                  {l("Produk", "Product")}
                </SortTh>
                <SortTh view={table} col="warehouse">
                  {l("Gudang", "Warehouse")}
                </SortTh>
                <SortTh view={table} col="onHand" className="num">
                  {l("Tersedia", "On hand")}
                </SortTh>
                <SortTh view={table} col="incoming" className="num">
                  {l("Masuk", "Incoming")}
                </SortTh>
                <SortTh view={table} col="outgoing" className="num">
                  {l("Keluar", "Outgoing")}
                </SortTh>
                <SortTh view={table} col="rfq" className="num">
                  RFQ
                </SortTh>
                <SortTh view={table} col="forecast" className="num">
                  {l("Perkiraan", "Forecast")}
                </SortTh>
                <SortTh view={table} col="minQty" className="num">
                  Min / Max
                </SortTh>
                <SortTh view={table} col="toOrder" className="num">
                  {l("Perlu dipesan", "To order")}
                </SortTh>
                <SortTh view={table} col="supplier">
                  {l("Pemasok", "Vendor")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.sku} {r.productName}
                  </td>
                  <td>{r.warehouseCode}</td>
                  <td className="num">{n(r.onHand)}</td>
                  <td className="num">{n(r.incoming)}</td>
                  <td className="num">{n(r.outgoing)}</td>
                  <td className="num">{n(r.rfq)}</td>
                  <td className="num">{n(r.forecast)}</td>
                  <td className="num">
                    {n(r.minQty)} / {n(r.maxQty)}
                  </td>
                  <td className={`num${Number(r.toOrder) > 0 ? " overdue" : ""}`}>{n(r.toOrder)}</td>
                  <td>{r.supplierName ?? <span className="muted">{l("belum ada", "none")}</span>}</td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada aturan pemesanan ulang.", "No reordering rules yet.")}
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
