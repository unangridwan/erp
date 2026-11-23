"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Card {
  product: { id: string; name: string; sku: string };
  opening: { qty: string; value: string | null };
  closing: { qty: string; value: string | null };
  lines: {
    id: string;
    date: string;
    reference: string | null;
    pickingId: string | null;
    partnerName: string | null;
    qtyIn: string;
    qtyOut: string;
    unitCost: string | null;
    value: string | null;
    balanceQty: string;
    balanceValue: string | null;
  }[];
}

/** Kartu stok: mutasi masuk/keluar per produk dengan saldo berjalan. */
function StockCard() {
  const { l, locale } = useI18n();
  const products = useOptions<{ id: string; sku: string; name: string; productType: string }>(
    "/products",
  ).filter((p) => p.productType !== "service");
  const locations = useOptions<{ id: string; completeName: string }>("/stock-locations?usage=internal");
  const [productId, setProductId] = useState(useSearchParams().get("productId") ?? "");
  const [locationId, setLocationId] = useState("");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(today());
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    const params = new URLSearchParams({ productId, from, to });
    if (locationId) params.set("locationId", locationId);
    api<Card>(`/stock/card?${params}`)
      .then((c) => {
        setCard(c);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [productId, locationId, from, to]);

  const n = (v: string) => money(v, locale, 4);
  const withValue = !locationId;

  return (
    <>
      <header className="toolbar">
        <h1>{l("Kartu Stok", "Stock Card")}</h1>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">{l("Pilih produk…", "Select product…")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} {p.name}
            </option>
          ))}
        </select>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">{l("Semua lokasi internal", "All internal locations")}</option>
          {locations.map((x) => (
            <option key={x.id} value={x.id}>
              {x.completeName}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="button" onClick={() => window.print()}>
          {l("Cetak", "Print")}
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {card && productId && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Referensi", "Reference")}</th>
                <th>{l("Partner", "Partner")}</th>
                <th className="num">{l("Masuk", "In")}</th>
                <th className="num">{l("Keluar", "Out")}</th>
                <th className="num">{l("Saldo", "Balance")}</th>
                {withValue && <th className="num">{l("Biaya/unit", "Unit cost")}</th>}
                {withValue && <th className="num">{l("Nilai mutasi", "Value")}</th>}
                {withValue && <th className="num">{l("Saldo nilai", "Balance value")}</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="detail">
                <td colSpan={5}>{l("Saldo awal", "Opening balance")}</td>
                <td className="num">{n(card.opening.qty)}</td>
                {withValue && <td colSpan={2} />}
                {withValue && <td className="num">{money(card.opening.value, locale)}</td>}
              </tr>
              {card.lines.map((x) => (
                <tr key={x.id}>
                  <td>{formatDate(x.date, locale)}</td>
                  <td>
                    {x.pickingId ? (
                      <Link href={`/inventory/pickings/${x.pickingId}`}>{x.reference}</Link>
                    ) : (
                      x.reference
                    )}
                  </td>
                  <td>{x.partnerName}</td>
                  <td className="num">{Number(x.qtyIn) ? n(x.qtyIn) : ""}</td>
                  <td className="num">{Number(x.qtyOut) ? n(x.qtyOut) : ""}</td>
                  <td className="num">{n(x.balanceQty)}</td>
                  {withValue && <td className="num">{x.unitCost ? money(x.unitCost, locale, 4) : ""}</td>}
                  {withValue && <td className="num">{x.value ? money(x.value, locale) : ""}</td>}
                  {withValue && <td className="num">{money(x.balanceValue, locale)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={5}>{l("Saldo akhir", "Closing balance")}</th>
                <th className="num">{n(card.closing.qty)}</th>
                {withValue && <th colSpan={2} />}
                {withValue && <th className="num">{money(card.closing.value, locale)}</th>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

export default function StockCardPage() {
  return (
    <Suspense>
      <StockCard />
    </Suspense>
  );
}
