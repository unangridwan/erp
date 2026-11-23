"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, type DataColumn } from "../../../../components/data-table";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { useListData } from "../../../../lib/use-list-data";

interface Lot {
  id: string;
  name: string;
  productName: string;
  sku: string;
  expirationDate: string | null;
  onHand: string;
}

/** Lot & nomor serial beserta stok tersedia dan tanggal kedaluwarsa (dimuat sekali, difilter di browser). */
export default function LotsPage() {
  const { l, locale } = useI18n();
  const [available, setAvailable] = useState(true);
  const list = useListData<Lot>("/stock/lots");
  const rows = useMemo(
    () => (available ? list.rows.filter((r) => Number(r.onHand) > 0) : list.rows),
    [list.rows, available],
  );
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const columns = useMemo<DataColumn<Lot>[]>(
    () => [
      { key: "name", label: l("Lot / serial", "Lot / serial"), value: (r) => r.name },
      {
        key: "product",
        label: l("Produk", "Product"),
        type: "enum",
        value: (r) => `${r.sku} ${r.productName}`,
      },
      {
        key: "onHand",
        label: l("Tersedia", "On hand"),
        type: "number",
        className: "num",
        value: (r) => Number(r.onHand),
        text: (r) => money(r.onHand, locale, 4),
      },
      {
        key: "expirationDate",
        label: l("Kedaluwarsa", "Expiration"),
        type: "date",
        value: (r) => r.expirationDate,
        text: (r) =>
          `${formatDate(r.expirationDate, locale)}${r.expirationDate && r.expirationDate < today() ? ` (${l("kedaluwarsa", "expired")})` : ""}`,
        render: (r) => (
          <span className={r.expirationDate && r.expirationDate <= soon ? "overdue" : ""}>
            {formatDate(r.expirationDate, locale)}
            {r.expirationDate && r.expirationDate < today() ? ` (${l("kedaluwarsa", "expired")})` : ""}
          </span>
        ),
      },
    ],
    [l, locale, soon],
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Lot / Serial", "Lots / Serial Numbers")}</h1>
        <Link className="button" href="/inventory/labels">
          {l("Cetak label barcode", "Print barcode labels")}
        </Link>
      </header>
      {list.error && (
        <p className="error" role="alert">
          {list.error}
        </p>
      )}
      {!list.loading || list.rows.length ? (
        <DataTable
          rows={rows}
          columns={columns}
          storageKey="lots"
          rowKey={(r) => r.id}
          rowHref={(r) => `/inventory/lots/${r.id}`}
          searchPlaceholder={l("Cari nomor, produk…", "Search number, product…")}
          empty={l("Belum ada lot.", "No lots yet.")}
          tools={
            <label className="check">
              <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
              <span>{l("Hanya yang tersedia", "Available only")}</span>
            </label>
          }
        />
      ) : (
        <p className="muted">{l("Memuat…", "Loading…")}</p>
      )}
    </>
  );
}
