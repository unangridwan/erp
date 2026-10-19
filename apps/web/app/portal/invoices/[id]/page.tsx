"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { portalApi, portalDownload } from "../../../../lib/portal-api";
import { PortalHeader } from "../../portal-header";

interface Invoice {
  id: string;
  name: string;
  moveType: "out_invoice" | "out_refund";
  date: string;
  dueDate: string | null;
  currencyCode: string;
  amountUntaxed: string;
  amountTotal: string;
  amountResidual: string;
  paymentState: string;
  lines: {
    name: string;
    quantity: string;
    uomName: string | null;
    priceUnit: string;
    discount: string;
    subtotal: string;
  }[];
  taxes: { name: string; amount: string }[];
}

export default function PortalInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi<Invoice>(`/portal/invoices/${id}`)
      .then(setInv)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="shell">
      <PortalHeader />
      {error && <p className="error">{error}</p>}
      {inv && (
        <section className="panel">
          <header className="toolbar control-panel">
            <div className="cp-left">
              <h1>
                {inv.moveType === "out_refund" ? l("Nota kredit", "Credit note") : l("Faktur", "Invoice")}{" "}
                {inv.name}
              </h1>
            </div>
            <div className="cp-right">
              <button
                type="button"
                onClick={() =>
                  portalDownload(`/portal/invoices/${id}/pdf`, `${inv.name}.pdf`).catch((e: Error) =>
                    setError(e.message),
                  )
                }
              >
                PDF
              </button>
            </div>
          </header>
          <p className="muted">
            {formatDate(inv.date, locale)} · {l("jatuh tempo", "due")} {formatDate(inv.dueDate, locale)} ·{" "}
            {l("sisa", "due amount")} {money(inv.amountResidual, locale)}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Deskripsi", "Description")}</th>
                  <th className="num">{l("Qty", "Qty")}</th>
                  <th className="num">{l("Harga", "Price")}</th>
                  <th className="num">{l("Subtotal", "Subtotal")}</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((x, i) => (
                  <tr key={i}>
                    <td>{x.name}</td>
                    <td className="num">
                      {money(x.quantity, locale, 4)} {x.uomName ?? ""}
                    </td>
                    <td className="num">{money(x.priceUnit, locale, 4)}</td>
                    <td className="num">{money(x.subtotal, locale)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td colSpan={3}>{l("Subtotal", "Untaxed")}</td>
                  <td className="num">{money(inv.amountUntaxed, locale)}</td>
                </tr>
                {inv.taxes.map((t, i) => (
                  <tr key={`t${i}`}>
                    <td colSpan={3}>{t.name}</td>
                    <td className="num">{money(t.amount, locale)}</td>
                  </tr>
                ))}
                <tr className="subtotal">
                  <td colSpan={3}>Total</td>
                  <td className="num">
                    {inv.currencyCode} {money(inv.amountTotal, locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
