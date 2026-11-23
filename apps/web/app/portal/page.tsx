"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { portalApi, portalSession } from "../../lib/portal-api";
import { PortalHeader } from "./portal-header";

interface Me {
  name: string;
  partner: { name: string };
  openBalance: string;
}
interface Order {
  id: string;
  name: string;
  state: "sent" | "sale";
  dateOrder: string;
  validityDate: string | null;
  currencyCode: string;
  amountTotal: string;
  companyName: string;
}
interface Invoice {
  id: string;
  name: string;
  moveType: "out_invoice" | "out_refund";
  date: string;
  dueDate: string | null;
  currencyCode: string;
  amountTotal: string;
  amountResidual: string;
  paymentState: string;
}

export default function PortalHome() {
  const router = useRouter();
  const { l, locale } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!portalSession.token()) return router.replace("/portal/login");
    Promise.all([
      portalApi<Me>("/portal/me"),
      portalApi<Order[]>("/portal/orders"),
      portalApi<Invoice[]>("/portal/invoices"),
    ])
      .then(([m, o, i]) => {
        setMe(m);
        setOrders(o);
        setInvoices(i);
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  const paid: Record<string, string> = {
    not_paid: l("Belum dibayar", "Not paid"),
    partial: l("Dibayar sebagian", "Partially paid"),
    paid: l("Lunas", "Paid"),
    reversed: l("Dibatalkan", "Reversed"),
  };

  return (
    <main className="shell">
      <PortalHeader />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {me && (
        <section className="panel">
          <h1>
            {l("Halo", "Hello")}, {me.name}
          </h1>
          <p className="muted">{me.partner.name}</p>
          <p>
            {l("Sisa tagihan", "Outstanding balance")}: <strong>{money(me.openBalance, locale)}</strong>
          </p>
        </section>
      )}
      <h2>{l("Penawaran & pesanan", "Quotations & orders")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Status", "Status")}</th>
              <th className="num">{l("Total", "Total")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/portal/orders/${o.id}`}>{o.name}</Link>
                  <small className="muted"> · {o.companyName}</small>
                </td>
                <td>{formatDate(o.dateOrder, locale)}</td>
                <td>
                  <span className={`badge ${o.state === "sale" ? "state-posted" : "state-sent"}`}>
                    {o.state === "sale"
                      ? l("Pesanan", "Order")
                      : l("Menunggu persetujuan", "Awaiting approval")}
                  </span>
                </td>
                <td className="num">
                  {o.currencyCode} {money(o.amountTotal, locale)}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {l("Belum ada penawaran.", "No quotations yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2>{l("Faktur", "Invoices")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Jatuh tempo", "Due")}</th>
              <th>{l("Status", "Status")}</th>
              <th className="num">{l("Total", "Total")}</th>
              <th className="num">{l("Sisa", "Due amount")}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/portal/invoices/${i.id}`}>{i.name}</Link>
                  {i.moveType === "out_refund" && (
                    <small className="muted"> · {l("nota kredit", "credit note")}</small>
                  )}
                </td>
                <td>{formatDate(i.date, locale)}</td>
                <td>{formatDate(i.dueDate, locale)}</td>
                <td>{paid[i.paymentState] ?? i.paymentState}</td>
                <td className="num">
                  {i.currencyCode} {money(i.amountTotal, locale)}
                </td>
                <td className="num">{money(i.amountResidual, locale)}</td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {l("Belum ada faktur.", "No invoices yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
