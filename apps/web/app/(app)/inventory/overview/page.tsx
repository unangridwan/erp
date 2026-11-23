"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { useListData } from "../../../../lib/use-list-data";

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
  reserved: string;
  available: string;
  averageCost: string | null;
  value: string | null;
}

/**
 * Stok per produk: tersedia, akan masuk/keluar, perkiraan, dan nilai persediaan. Gudang menentukan data (dimuat dari
 * API); cari, filter, sort & paginasi di browser.
 */
export default function StockOverviewPage() {
  const { l, locale } = useI18n();
  const warehouses = useOptions<{ id: string; code: string; name: string }>("/warehouses");
  const [warehouseId, setWarehouseId] = useState("");
  const list = useListData<Row>("/stock/overview", { warehouseId: warehouseId || null });

  const columns = useMemo<DataColumn<Row>[]>(() => {
    const qty = (key: keyof Row, label: string): DataColumn<Row> => ({
      key,
      label,
      type: "number",
      className: "num",
      value: (r) => Number(r[key] ?? 0),
      text: (r) => money(String(r[key] ?? 0), locale, 4),
    });
    const kind = (r: Row) =>
      r.productType === "consumable" ? l("habis pakai", "consumable") : r.costMethod.toUpperCase();
    return [
      {
        key: "name",
        label: l("Produk", "Product"),
        value: (r) => `${r.sku} ${r.name}`,
        render: (r) => (
          <>
            <Link href={`/inventory/card?productId=${r.id}`}>
              {r.sku} {r.name}
            </Link>
            <small className="muted">
              {" "}
              · {kind(r)}
              {r.tracking !== "none" ? ` · ${r.tracking}` : ""}
            </small>
          </>
        ),
      },
      { key: "kind", label: l("Jenis / metode", "Type / method"), type: "enum", value: kind, hidden: true },
      {
        ...qty("onHand", l("Di tangan", "On hand")),
        render: (r) => (
          <span className={Number(r.onHand) < 0 ? "overdue" : ""}>
            {money(r.onHand, locale, 4)} {r.uomName}
          </span>
        ),
      },
      qty("reserved", l("Dicadangkan", "Reserved")),
      qty("available", l("Bebas", "Free")),
      qty("incoming", l("Akan masuk", "Incoming")),
      qty("outgoing", l("Akan keluar", "Outgoing")),
      qty("forecast", l("Perkiraan", "Forecast")),
      {
        key: "averageCost",
        label: l("Biaya rata-rata", "Average cost"),
        type: "number",
        className: "num",
        value: (r) => (r.averageCost === null ? null : Number(r.averageCost)),
        text: (r) => (r.averageCost ? money(r.averageCost, locale, 4) : "—"),
      },
      {
        key: "value",
        label: l("Nilai", "Value"),
        type: "number",
        className: "num",
        value: (r) => (r.value === null ? null : Number(r.value)),
        text: (r) => (r.value ? money(r.value, locale) : "—"),
        hidden: !!warehouseId,
      },
    ];
  }, [l, locale, warehouseId]);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Stok", "Stock")}</h1>
        <select
          aria-label={l("Gudang", "Warehouse")}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">{l("Semua gudang", "All warehouses")}</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </header>
      {list.error && (
        <p className="error" role="alert">
          {list.error}
        </p>
      )}
      {!list.loading || list.rows.length ? (
        <DataTable
          rows={list.rows}
          columns={columns}
          storageKey="stock-overview"
          rowKey={(r) => r.id}
          searchPlaceholder={l("Cari produk…", "Search product…")}
          empty={l("Belum ada produk stok.", "No stocked products yet.")}
          foot={
            warehouseId
              ? undefined
              : (filtered) => (
                  <tr>
                    <th colSpan={8}>{l("Total nilai persediaan", "Total inventory value")}</th>
                    <th className="num">
                      {money(
                        filtered.reduce((s, r) => s + Number(r.value ?? 0), 0),
                        locale,
                      )}
                    </th>
                  </tr>
                )
          }
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
