"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PairBars } from "../../../../components/flow/money-charts";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Otif {
  count: number;
  onTime: number | null;
  inFull: number | null;
  otif: number | null;
}
interface Deliveries {
  from: string;
  to: string;
  summary: Otif;
  byMonth: (Otif & { month: string })[];
  customers: (Otif & { partner: string })[];
  late: {
    id: string;
    name: string;
    partner: string | null;
    scheduled: string;
    done: string;
    daysLate: number;
    onTime: boolean;
    inFull: boolean;
    href: string | null;
  }[];
  openLate: {
    id: string;
    name: string;
    partner: string | null;
    scheduled: string;
    daysLate: number;
    href: string | null;
  }[];
}
interface Suppliers {
  summary: { suppliers: number; receipts: number; onTime: number | null; inFull: number | null };
  items: {
    partnerId: string | null;
    partner: string;
    receipts: number;
    onTime: number | null;
    inFull: number | null;
    qcPass: number | null;
    qcChecked: number;
    leadActual: number | null;
    leadPlanned: number | null;
    spend: number;
    orders: number;
    score: number | null;
  }[];
}
interface Stock {
  value: number;
  aging: { key: string; label: [string, string]; value: number; share: number | null }[];
  turnover: number | null;
  daysOfInventory: number | null;
  deadStock: {
    count: number;
    value: number;
    items: {
      id: string;
      sku: string | null;
      name: string;
      quantity: number;
      value: number;
      oldest: string;
      lastOut: string | null;
      href: string | null;
    }[];
  };
}

/**
 * Rantai Pasok: pengiriman ke pelanggan tepat waktu & tepat jumlah (OTIF), kinerja pemasok, dan umur persediaan &
 * stok mati — untuk melihat di mana barang tertahan dan siapa yang perlu ditindaklanjuti.
 */
export default function SupplyFlowPage() {
  const { l, locale } = useI18n();
  const me = useMe();
  const [tolerance, setTolerance] = useState(0);
  const [deliveries, setDeliveries] = useState<Deliveries | null>(null);
  const [suppliers, setSuppliers] = useState<Suppliers | null>(null);
  const [stock, setStock] = useState<Stock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canInventory = can(me.permissions, "inventory.read");
  const canPurchase = can(me.permissions, "purchase.read");

  useEffect(() => {
    setError(null);
    if (canInventory)
      api<Deliveries>(`/flow/supply/deliveries?tolerance=${tolerance}`).then(setDeliveries, (e) =>
        setError(e instanceof ApiError ? e.message : String(e)),
      );
    if (canPurchase)
      api<Suppliers>(`/flow/supply/suppliers?tolerance=${tolerance}`).then(setSuppliers, () =>
        setSuppliers(null),
      );
  }, [tolerance, canInventory, canPurchase]);
  useEffect(() => {
    if (canInventory) api<Stock>("/flow/supply/stock").then(setStock, () => setStock(null));
  }, [canInventory]);

  const pct = (v: number | null) =>
    v === null
      ? "—"
      : `${v.toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 })}%`;
  const n1 = (v: number | null) =>
    v === null ? "—" : v.toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 });
  const compact = (v: number) =>
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  const tone = (v: number | null) =>
    v === null ? "" : v >= 95 ? "sc-green" : v >= 80 ? "sc-amber" : "sc-red";
  const monthLabel = (ym: string) =>
    new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale === "id" ? "id-ID" : "en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <nav className="breadcrumb">
            <Link href="/flow">{l("Alur Bisnis", "Business Flow")}</Link>
            <span>/</span>
            <h1>{l("Rantai Pasok", "Supply Chain")}</h1>
          </nav>
        </div>
        <div className="cp-right">
          <label className="inline-field">
            <span className="muted small">{l("Toleransi terlambat", "Lateness tolerance")}</span>
            <select value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))}>
              {[0, 1, 2, 3, 7].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? l("Tanpa toleransi", "None") : l(`${d} hari`, `${d} days`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <p className="muted">
        {l(
          "12 bulan terakhir: apakah pelanggan menerima barang tepat waktu & tepat jumlah, pemasok mana yang andal, dan di mana persediaan tertahan terlalu lama.",
          "Last 12 months: do customers receive goods on time & in full, which suppliers are reliable, and where inventory sits too long.",
        )}
      </p>
      {error && <p className="muted">{error}</p>}

      {deliveries && (
        <section className="panel handoff-panel">
          <h2>{l("Pengiriman ke pelanggan (OTIF)", "Customer deliveries (OTIF)")}</h2>
          <div className="sc-summary">
            <div className={`sc-stat sc-main ${tone(deliveries.summary.otif)}`}>
              <span className="muted small">{l("Tepat waktu & tepat jumlah", "On time & in full")}</span>
              <strong>{pct(deliveries.summary.otif)}</strong>
              <span className="muted small">
                {l(`${deliveries.summary.count} pengiriman`, `${deliveries.summary.count} deliveries`)}
              </span>
            </div>
            <div className={`sc-stat ${tone(deliveries.summary.onTime)}`}>
              <span className="muted small">{l("Tepat waktu", "On time")}</span>
              <strong>{pct(deliveries.summary.onTime)}</strong>
            </div>
            <div className={`sc-stat ${tone(deliveries.summary.inFull)}`}>
              <span className="muted small">{l("Tepat jumlah", "In full")}</span>
              <strong>{pct(deliveries.summary.inFull)}</strong>
            </div>
            <div className={`sc-stat ${deliveries.openLate.length ? "sc-red" : "sc-green"}`}>
              <span className="muted small">
                {l("Belum dikirim, lewat jadwal", "Not shipped, past schedule")}
              </span>
              <strong>{deliveries.openLate.length}</strong>
            </div>
          </div>
          {deliveries.byMonth.length > 0 && (
            <PairBars
              rows={deliveries.byMonth.map((x) => ({
                label: monthLabel(x.month),
                values: [x.otif, x.onTime],
              }))}
              series={[
                { label: "OTIF", className: "in" },
                { label: l("Tepat waktu", "On time"), className: "alt" },
              ]}
              format={(v) => pct(v)}
            />
          )}
          <div className="grid-2">
            <div>
              <h3>{l("Pelanggan dengan OTIF terendah", "Customers with the lowest OTIF")}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Pelanggan", "Customer")}</th>
                      <th className="num">{l("Kirim", "Deliveries")}</th>
                      <th className="num">OTIF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.customers.map((c) => (
                      <tr key={c.partner}>
                        <td>{c.partner}</td>
                        <td className="num">{c.count}</td>
                        <td className="num">{pct(c.otif)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3>{l("Belum dikirim padahal lewat jadwal", "Not shipped but past schedule")}</h3>
              {deliveries.openLate.length ? (
                <ul className="work-list">
                  {deliveries.openLate.map((d) => (
                    <li key={d.id} className="late">
                      <div>
                        {d.href ? <Link href={d.href}>{d.name}</Link> : d.name}
                        <div className="muted small">{d.partner ?? "—"}</div>
                      </div>
                      <span className="badge danger">
                        {l(`${d.daysLate} hari`, `${d.daysLate} days`)} · {formatDate(d.scheduled, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {l("Semua pengiriman sesuai jadwal.", "All deliveries are on schedule.")}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {suppliers && (
        <section className="panel handoff-panel">
          <h2>{l("Kinerja pemasok", "Supplier performance")}</h2>
          <p className="muted small">
            {l(
              `Dari ${suppliers.summary.receipts} penerimaan: tepat waktu ${pct(suppliers.summary.onTime)}, tepat jumlah ${pct(suppliers.summary.inFull)}. Skor = rata-rata tepat waktu, tepat jumlah, dan lolos QC; terendah di atas.`,
              `Of ${suppliers.summary.receipts} receipts: on time ${pct(suppliers.summary.onTime)}, in full ${pct(suppliers.summary.inFull)}. Score = average of on time, in full and QC pass; lowest first.`,
            )}
          </p>
          <div className="table-wrap">
            <table className="wrap-head">
              <thead>
                <tr>
                  <th>{l("Pemasok", "Supplier")}</th>
                  <th className="num">{l("Penerimaan", "Receipts")}</th>
                  <th className="num">{l("Tepat waktu", "On time")}</th>
                  <th className="num">{l("Tepat jumlah", "In full")}</th>
                  <th className="num">{l("Lolos QC", "QC pass")}</th>
                  <th className="num">
                    {l("Lead time aktual / rencana (hari)", "Lead time actual / plan (days)")}
                  </th>
                  <th className="num">{l("Nilai PO", "PO value")}</th>
                  <th className="num">{l("Skor", "Score")}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.items.map((s) => (
                  <tr
                    key={s.partnerId ?? s.partner}
                    className={s.score !== null && s.score < 80 ? "row-late" : undefined}
                  >
                    <td>{s.partner}</td>
                    <td className="num">{s.receipts}</td>
                    <td className="num">{pct(s.onTime)}</td>
                    <td className="num">{pct(s.inFull)}</td>
                    <td className="num">{s.qcChecked ? pct(s.qcPass) : "—"}</td>
                    <td className="num">
                      {n1(s.leadActual)} / {n1(s.leadPlanned)}
                    </td>
                    <td className="num">{compact(s.spend)}</td>
                    <td className="num">
                      <strong>{n1(s.score)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stock && (
        <section className="panel handoff-panel">
          <h2>{l("Persediaan: umur & stok mati", "Inventory: age & dead stock")}</h2>
          <div className="sc-summary">
            <div className="sc-stat">
              <span className="muted small">{l("Nilai persediaan", "Inventory value")}</span>
              <strong title={money(stock.value, locale, 0)}>{compact(stock.value)}</strong>
            </div>
            <div className="sc-stat">
              <span className="muted small">{l("Perputaran (12 bulan)", "Turnover (12 months)")}</span>
              <strong>{stock.turnover === null ? "—" : `${n1(stock.turnover)}×`}</strong>
              <span className="muted small">
                {stock.daysOfInventory === null
                  ? ""
                  : l(
                      `≈ ${n1(stock.daysOfInventory)} hari persediaan`,
                      `≈ ${n1(stock.daysOfInventory)} days of stock`,
                    )}
              </span>
            </div>
            <div className={`sc-stat ${stock.deadStock.count ? "sc-red" : "sc-green"}`}>
              <span className="muted small">
                {l("Stok mati (> 90 hari tanpa keluar)", "Dead stock (> 90 days no issue)")}
              </span>
              <strong title={money(stock.deadStock.value, locale, 0)}>
                {compact(stock.deadStock.value)}
              </strong>
              <span className="muted small">
                {l(`${stock.deadStock.count} produk`, `${stock.deadStock.count} products`)}
              </span>
            </div>
          </div>
          <div className="aging-bar" role="img" aria-label={l("Umur persediaan", "Inventory age")}>
            {stock.aging
              .map((a, i) => ({ ...a, i }))
              .filter((a) => a.value > 0)
              .map(({ i, ...a }) => (
                <span
                  key={a.key}
                  className={`age-${i}`}
                  style={{ width: `${a.share ?? 0}%` }}
                  title={`${l(...a.label)}: ${compact(a.value)}`}
                />
              ))}
          </div>
          <ul className="aging-legend">
            {stock.aging.map((a, i) => (
              <li key={a.key}>
                <i className={`age-${i}`} aria-hidden="true" /> {l(...a.label)}:{" "}
                <strong>{compact(a.value)}</strong> <span className="muted small">({pct(a.share)})</span>
              </li>
            ))}
          </ul>
          {stock.deadStock.items.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Produk", "Product")}</th>
                    <th className="num">{l("Kuantitas", "Quantity")}</th>
                    <th className="num">{l("Nilai", "Value")}</th>
                    <th>{l("Masuk sejak", "In stock since")}</th>
                    <th>{l("Terakhir keluar", "Last issued")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.deadStock.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.href ? <Link href={p.href}>{p.name}</Link> : p.name}
                        {p.sku && <div className="muted small">{p.sku}</div>}
                      </td>
                      <td className="num">{n1(p.quantity)}</td>
                      <td className="num">{money(p.value, locale, 0)}</td>
                      <td>{formatDate(p.oldest, locale)}</td>
                      <td>{p.lastOut ? formatDate(p.lastOut, locale) : l("Belum pernah", "Never")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {!canInventory && !canPurchase && (
        <p className="muted">
          {l("Butuh hak persediaan atau pembelian.", "Requires inventory or purchasing access.")}
        </p>
      )}
    </>
  );
}
