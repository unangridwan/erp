"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { portalApi, portalDownload } from "../../../../lib/portal-api";
import { PortalHeader } from "../../portal-header";
import { ask } from "../../../../components/feedback";

interface Order {
  id: string;
  name: string;
  state: "sent" | "sale";
  dateOrder: string;
  validityDate: string | null;
  currencyCode: string;
  clientOrderRef: string | null;
  note: string | null;
  amountUntaxed: string;
  amountTax: string;
  amountTotal: string;
  companyName: string;
  canAccept: boolean;
  lines: {
    name: string;
    quantity: string;
    uomName: string | null;
    priceUnit: string;
    discount: string;
    priceSubtotal: string;
  }[];
}

export default function PortalOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    portalApi<Order>(`/portal/orders/${id}`)
      .then(setOrder)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="shell">
      <PortalHeader />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {order && (
        <section className="panel">
          <header className="toolbar control-panel">
            <div className="cp-left">
              <h1>
                {order.state === "sale" ? l("Pesanan", "Order") : l("Penawaran", "Quotation")} {order.name}
              </h1>
            </div>
            <div className="cp-right">
              <button
                type="button"
                onClick={() =>
                  portalDownload(`/portal/orders/${id}/pdf`, `${order.name}.pdf`).catch((e: Error) =>
                    setError(e.message),
                  )
                }
              >
                PDF
              </button>
              {order.canAccept && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await ask(l("Setujui penawaran ini?", "Accept this quotation?")))) return;
                    setBusy(true);
                    try {
                      setOrder(await portalApi<Order>(`/portal/orders/${id}/accept`, { method: "POST" }));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {l("Setujui penawaran", "Accept quotation")}
                </button>
              )}
            </div>
          </header>
          <p className="muted">
            {order.companyName} · {formatDate(order.dateOrder, locale)}
            {order.validityDate &&
              ` · ${l("berlaku s.d.", "valid until")} ${formatDate(order.validityDate, locale)}`}
            {order.clientOrderRef && ` · ${l("ref.", "ref.")} ${order.clientOrderRef}`}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Deskripsi", "Description")}</th>
                  <th className="num">{l("Qty", "Qty")}</th>
                  <th className="num">{l("Harga", "Price")}</th>
                  <th className="num">{l("Disk %", "Disc %")}</th>
                  <th className="num">{l("Subtotal", "Subtotal")}</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((x, i) => (
                  <tr key={i}>
                    <td>{x.name}</td>
                    <td className="num">
                      {money(x.quantity, locale, 4)} {x.uomName ?? ""}
                    </td>
                    <td className="num">{money(x.priceUnit, locale, 4)}</td>
                    <td className="num">{money(x.discount, locale)}</td>
                    <td className="num">{money(x.priceSubtotal, locale)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td colSpan={4}>{l("Subtotal", "Untaxed")}</td>
                  <td className="num">{money(order.amountUntaxed, locale)}</td>
                </tr>
                <tr>
                  <td colSpan={4}>{l("Pajak", "Taxes")}</td>
                  <td className="num">{money(order.amountTax, locale)}</td>
                </tr>
                <tr className="subtotal">
                  <td colSpan={4}>Total</td>
                  <td className="num">
                    {order.currencyCode} {money(order.amountTotal, locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {order.note && <p>{order.note}</p>}
        </section>
      )}
    </main>
  );
}
