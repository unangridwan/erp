"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { TAX_DOC_STATE_LABEL } from "../../../../lib/resources";

interface VatReport {
  ledger: { outputVat: string; inputVat: string };
  outputInvoices: { state: string; count: number; taxBase: string; vat: string }[];
  inputCredited: { count: number; taxBase: string; vat: string };
  inputReturns: { count: number; taxBase: string; vat: string };
  position: { payable: string; status: "kurang_bayar" | "lebih_bayar" | "nihil" };
}

export default function VatReportPage() {
  const { l, tx, locale } = useI18n();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [report, setReport] = useState<VatReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, month] = period.split("-").map(Number) as [number, number];

  useEffect(() => {
    setError(null);
    api<VatReport>(`/tax/vat-report?year=${year}&month=${month}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [year, month]);

  const status = {
    kurang_bayar: l(
      "Kurang bayar — setor sebelum akhir bulan berikutnya",
      "Payable — pay before the end of next month",
    ),
    lebih_bayar: l("Lebih bayar — dikompensasikan ke masa berikutnya", "Overpaid — carried forward"),
    nihil: l("Nihil", "Nil"),
  };

  return (
    <>
      <header className="toolbar">
        <h1>{l("Rekap SPT Masa PPN", "VAT Return Summary")}</h1>
        <label className="field inline">
          <span>{l("Masa pajak", "Tax period")}</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {report && (
        <>
          <div className="cards">
            <div className="card">
              <span className="muted">
                {l("PPN keluaran (faktur terbit/diekspor)", "Output VAT (issued/exported)")}
              </span>
              <span className="price">
                {money(
                  report.outputInvoices
                    .filter((d) => d.state === "approved" || d.state === "exported")
                    .reduce((s, d) => s + Number(d.vat), 0),
                  locale,
                )}
              </span>
            </div>
            <div className="card">
              <span className="muted">{l("PPN masukan dikreditkan", "Input VAT credited")}</span>
              <span className="price">{money(report.inputCredited.vat, locale)}</span>
              <span className="muted small">
                {report.inputCredited.count} {l("faktur", "invoices")}
              </span>
            </div>
            {report.inputReturns.count > 0 && (
              <div className="card">
                <span className="muted">{l("Retur pajak masukan", "Input VAT returns")}</span>
                <span className="price">−{money(report.inputReturns.vat, locale)}</span>
                <span className="muted small">
                  {report.inputReturns.count} {l("nota retur", "return notes")}
                </span>
              </div>
            )}
            <div className="card current">
              <span className="muted">{status[report.position.status]}</span>
              <span className="price">{money(Math.abs(Number(report.position.payable)), locale)}</span>
            </div>
          </div>
          <div className="split">
            <div className="table-wrap">
              <table>
                <caption>{l("Faktur pajak keluaran per status", "Output tax invoices by status")}</caption>
                <thead>
                  <tr>
                    <th>{l("Status", "Status")}</th>
                    <th className="num">{l("Jumlah", "Count")}</th>
                    <th className="num">DPP</th>
                    <th className="num">PPN</th>
                  </tr>
                </thead>
                <tbody>
                  {report.outputInvoices.map((d) => (
                    <tr key={d.state}>
                      <td>{tx(TAX_DOC_STATE_LABEL[d.state]!)}</td>
                      <td className="num">{d.count}</td>
                      <td className="num">{money(d.taxBase, locale)}</td>
                      <td className="num">{money(d.vat, locale)}</td>
                    </tr>
                  ))}
                  {report.outputInvoices.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {l("Belum ada faktur pajak.", "No tax invoices.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <caption>{l("Pembanding buku besar", "General ledger check")}</caption>
                <tbody>
                  <tr>
                    <td>{l("PPN keluaran di buku besar", "Output VAT in ledger")}</td>
                    <td className="num">{money(report.ledger.outputVat, locale)}</td>
                  </tr>
                  <tr>
                    <td>{l("PPN masukan di buku besar", "Input VAT in ledger")}</td>
                    <td className="num">{money(report.ledger.inputVat, locale)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small">
                {l(
                  "Selisih dengan faktur pajak berarti ada faktur penjualan yang belum dibuatkan faktur pajak, atau faktur masukan yang belum dikreditkan.",
                  "Differences mean some sales invoices have no tax invoice yet, or input invoices are not credited yet.",
                )}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
