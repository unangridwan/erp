"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { download } from "../../../../lib/download";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Salesperson {
  userId: string | null;
  userName: string | null;
  invoices: number;
  base: string;
  commission: string;
}
interface Line {
  moveId: string;
  name: string;
  date: string;
  moveType: "out_invoice" | "out_refund";
  paymentState: string;
  partnerName: string;
  userName: string | null;
  base: string;
  planName: string | null;
  rate: string | null;
  basis: "invoiced" | "paid" | null;
  eligible: boolean;
  commission: string;
}
interface Report {
  currencyCode: string;
  salespeople: Salesperson[];
  lines: Line[];
  total: string;
}

/** Komisi penjual dari faktur penjualan terposting per periode. */
export default function CommissionsPage() {
  const { l, locale } = useI18n();
  const now = new Date();
  const [from, setFrom] = useState(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(
    new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10),
  );
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = (v: string) => money(v, locale);
  const query = `dateFrom=${from}&dateTo=${to}`;

  useEffect(() => {
    setError(null);
    api<Report>(`/sales/commissions?${query}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [query]);

  return (
    <>
      <header className="toolbar control-panel">
        <div className="cp-left">
          <h1>{l("Komisi Penjual", "Sales Commissions")}</h1>
        </div>
        <div className="cp-right">
          <label className="field inline">
            <span>{l("Dari", "From")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field inline">
            <span>{l("Sampai", "To")}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            onClick={() =>
              download(`/sales/commissions/export?${query}`, undefined, "komisi.xlsx").catch((e: Error) =>
                setError(e.message),
              )
            }
          >
            Excel
          </button>
          <Link className="button" href="/commission-plans">
            {l("Aturan komisi", "Commission plans")}
          </Link>
        </div>
      </header>
      <p className="muted">
        {l(
          "Dasar komisi = penjualan bersih sebelum pajak per faktur (nota kredit mengurangi), dalam mata uang perusahaan. Penjual diambil dari pesanan penjualan, atau penjual pelanggan. Aturan dipilih berurutan: khusus penjual, tim penjualan, lalu aturan bawaan.",
          "Commission base = net sales before tax per invoice (credit notes deduct), in company currency. The salesperson comes from the sales order, or the customer's salesperson. Plans are matched in order: salesperson, sales team, then the default plan.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Penjual", "Salesperson")}</th>
                  <th className="num">{l("Faktur", "Invoices")}</th>
                  <th className="num">{l("Penjualan bersih", "Net sales")}</th>
                  <th className="num">{l("Komisi", "Commission")}</th>
                </tr>
              </thead>
              <tbody>
                {report.salespeople.map((s) => (
                  <tr key={s.userId ?? "-"}>
                    <td>{s.userName ?? l("(tanpa penjual)", "(no salesperson)")}</td>
                    <td className="num">{s.invoices}</td>
                    <td className="num">{m(s.base)}</td>
                    <td className="num">{m(s.commission)}</td>
                  </tr>
                ))}
                {report.salespeople.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {l("Tidak ada faktur penjualan pada periode ini.", "No sales invoices in this period.")}
                    </td>
                  </tr>
                )}
                <tr className="subtotal">
                  <td colSpan={3}>
                    {l("Total komisi", "Total commission")} ({report.currencyCode})
                  </td>
                  <td className="num">{m(report.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h2>{l("Rincian faktur", "Invoice details")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Faktur", "Invoice")}</th>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Pelanggan", "Customer")}</th>
                  <th>{l("Penjual", "Salesperson")}</th>
                  <th>{l("Aturan", "Plan")}</th>
                  <th className="num">{l("Penjualan bersih", "Net sales")}</th>
                  <th className="num">{l("Komisi", "Commission")}</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((x) => (
                  <tr key={x.moveId}>
                    <td>
                      <Link href={`/accounting/moves/${x.moveId}`}>{x.name}</Link>
                    </td>
                    <td>{formatDate(x.date, locale)}</td>
                    <td>{x.partnerName}</td>
                    <td>{x.userName ?? "—"}</td>
                    <td>
                      {x.planName ? `${x.planName} (${Number(x.rate)}%)` : "—"}
                      {x.planName && !x.eligible && (
                        <span className="muted"> · {l("menunggu lunas", "awaiting payment")}</span>
                      )}
                    </td>
                    <td className="num">{m(x.base)}</td>
                    <td className="num">{m(x.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
