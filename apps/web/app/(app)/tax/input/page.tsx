"use client";

import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { RefSelect } from "../../../../components/ref-select";
import { api } from "../../../../lib/api";
import { readFile, taxStateClass } from "../../../../lib/download";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, INPUT_TAX_STATE_LABEL } from "../../../../lib/resources";

interface InputInvoice {
  id: string;
  efakturNumber: string;
  invoiceDate: string;
  sellerTin: string;
  sellerName: string;
  taxBase: string;
  vat: string;
  coretaxStatus: string | null;
  partnerName: string | null;
  moveId: string | null;
  moveName: string | null;
  state: string;
  creditMonth: number | null;
  creditYear: number | null;
}

export default function InputTaxPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [docs, setDocs] = useState<InputInvoice[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matching, setMatching] = useState<InputInvoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, month] = period.split("-").map(Number) as [number, number];
  const canWrite = can(me.permissions, "tax.write");

  const load = useCallback(() => {
    api<InputInvoice[]>("/input-tax-invoices")
      .then((rows) => {
        setDocs(rows);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<string | void>) {
    setError(null);
    setMessage(null);
    try {
      const done = await action();
      if (done) setMessage(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const credit = (creditIt: boolean) =>
    run(async () => {
      await api("/input-tax-invoices/credit", {
        method: "POST",
        body: { ids: [...selected], credit: creditIt, year, month },
      });
      return creditIt
        ? l(`Dikreditkan pada masa ${month}/${year}.`, `Credited in period ${month}/${year}.`)
        : l("Ditandai tidak dikreditkan.", "Marked as not credited.");
    });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Faktur Pajak Masukan", "Input Tax Invoices")}</h1>
      </header>
      <p className="muted">
        {l(
          "Unduh daftar faktur dari menu Pajak Masukan di Coretax (simpan sebagai CSV), lalu impor di sini. Faktur dicocokkan otomatis ke pemasok (NPWP) dan tagihan dengan PPN yang sama. PPN masukan bisa dikreditkan paling lambat 3 masa setelah masa faktur.",
          "Download the input invoice list from Coretax (save as CSV) and import it here. Invoices are matched to vendors (NPWP) and bills with the same VAT. Input VAT can be credited up to 3 periods after the invoice period.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      {canWrite && (
        <div className="inline-panel">
          <label className="button primary">
            {l("Impor CSV dari Coretax", "Import Coretax CSV")}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  const res = await api<{
                    imported: number;
                    updated: number;
                    matched: number;
                    errors: { row: number; message: string }[];
                  }>("/input-tax-invoices/import", { method: "POST", body: { csv: await readFile(file) } });
                  const errors = res.errors.map((x) => `baris ${x.row}: ${x.message}`).join("; ");
                  return l(
                    `${res.imported} baru, ${res.updated} diperbarui, ${res.matched} cocok dengan tagihan${errors ? `. Ditolak: ${errors}` : ""}`,
                    `${res.imported} new, ${res.updated} updated, ${res.matched} matched${errors ? `. Rejected: ${errors}` : ""}`,
                  );
                });
              }}
            />
          </label>
          <label className="field">
            <span>{l("Kreditkan pada masa", "Credit in period")}</span>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <button disabled={!selected.size} onClick={() => credit(true)}>
            {l(`Kreditkan (${selected.size})`, `Credit (${selected.size})`)}
          </button>
          <button disabled={!selected.size} onClick={() => credit(false)}>
            {l("Tidak dikreditkan", "Not credited")}
          </button>
        </div>
      )}
      {matching && (
        <div className="panel">
          <h2>
            {l("Cocokkan tagihan", "Match bill")} — {matching.efakturNumber}
          </h2>
          <RefSelect
            name="moveId"
            resource="moves?type=in_invoice&state=posted"
            display="name"
            value={matching.moveId ?? ""}
            onChange={(moveId) =>
              void run(async () => {
                await api(`/input-tax-invoices/${matching.id}`, {
                  method: "PATCH",
                  body: { moveId: moveId || null },
                });
                setMatching(null);
              })
            }
          />
          <div className="form-actions">
            <button type="button" onClick={() => setMatching(null)}>
              {l("Tutup", "Close")}
            </button>
          </div>
        </div>
      )}
      {docs && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>{l("Nomor faktur", "Invoice number")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Penjual", "Seller")}</th>
                <th className="num">DPP</th>
                <th className="num">PPN</th>
                <th>{l("Tagihan", "Bill")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (next.has(d.id)) next.delete(d.id);
                          else next.add(d.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>{d.efakturNumber}</td>
                  <td>{formatDate(d.invoiceDate, locale)}</td>
                  <td>
                    {d.partnerName ?? d.sellerName}
                    <div className="muted small">{d.sellerTin}</div>
                  </td>
                  <td className="num">{money(d.taxBase, locale)}</td>
                  <td className="num">{money(d.vat, locale)}</td>
                  <td>
                    {d.moveName ?? <span className="muted">—</span>}
                    {canWrite && d.state === "new" && (
                      <button className="link" onClick={() => setMatching(d)}>
                        {l("ubah", "change")}
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${taxStateClass(d.state)}`}>
                      {tx(INPUT_TAX_STATE_LABEL[d.state]!)}
                    </span>
                    {d.creditMonth && (
                      <span className="muted small">
                        {" "}
                        {d.creditMonth}/{d.creditYear}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {l("Belum ada faktur masukan.", "No input invoices yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
