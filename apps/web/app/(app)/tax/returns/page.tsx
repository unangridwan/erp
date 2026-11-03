"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { download, taxStateClass } from "../../../../lib/download";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, TAX_DOC_STATE_LABEL } from "../../../../lib/resources";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface TaxReturn {
  id: string;
  moveId: string;
  moveName: string;
  partnerName: string | null;
  inputTaxInvoiceId: string | null;
  efakturNumber: string | null;
  invoiceDate: string | null;
  legacy: boolean;
  returnNumber: string;
  returnDate: string;
  taxBase: string;
  vat: string;
  stlg: string;
  state: string;
  coretaxNumber: string | null;
}
interface InputInvoice {
  id: string;
  efakturNumber: string;
  sellerName: string;
  invoiceDate: string;
  vat: string;
}

/** Nota retur pajak masukan: dari nota debit yang diposting, dilaporkan di Coretax (atau CSV RM e-Faktur lama). */
export default function TaxReturnsPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [rows, setRows] = useState<TaxReturn[] | null>(null);
  const [inputs, setInputs] = useState<InputInvoice[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, month] = period.split("-").map(Number) as [number, number];
  const canWrite = can(me.permissions, "tax.write");

  const load = useCallback(() => {
    api<TaxReturn[]>(`/tax-returns?year=${year}&month=${month}`)
      .then((r) => {
        setRows(r);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
    api<InputInvoice[]>("/input-tax-invoices")
      .then(setInputs)
      .catch(() => setInputs([]));
  }, [year, month]);
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
  const columns = useMemo<ViewColumn<TaxReturn>[]>(
    () => [
      {
        key: "returnNumber",
        label: l("Nota debit", "Debit note"),
        value: (r) => r.returnNumber,
        text: (r) => `${r.returnNumber} ${r.moveName}`,
      },
      {
        key: "returnDate",
        label: l("Tanggal nota", "Note date"),
        type: "date",
        value: (r) => r.returnDate,
        hidden: true,
      },
      { key: "partner", label: l("Pemasok", "Vendor"), value: (r) => r.partnerName },
      {
        key: "efakturNumber",
        label: l("Faktur pajak masukan", "Input tax invoice"),
        value: (r) => r.efakturNumber,
        text: (r) => `${r.efakturNumber ?? ""} ${r.coretaxNumber ?? ""}`,
      },
      { key: "taxBase", label: "DPP", type: "number", value: (r) => Number(r.taxBase) },
      { key: "vat", label: "PPN", type: "number", value: (r) => Number(r.vat) },
      { key: "stlg", label: "PPnBM", type: "number", value: (r) => Number(r.stlg) },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (TAX_DOC_STATE_LABEL[v] ? tx(TAX_DOC_STATE_LABEL[v]!) : v),
        text: (r) => (TAX_DOC_STATE_LABEL[r.state] ? tx(TAX_DOC_STATE_LABEL[r.state]!) : r.state),
      },
    ],
    [l, tx],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "tax-returns",
    defaultSort: { key: "returnDate", dir: "asc" },
  });
  const exportable = table.filtered.filter(
    (r) => (r.state === "draft" || r.state === "exported") && r.legacy,
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Nota Retur Pajak Masukan", "Input VAT Returns")}</h1>
        <label className="field inline">
          <span>{l("Masa pajak", "Tax period")}</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </header>
      <p className="muted">
        {l(
          "Dibuat dari nota debit (retur pembelian/pembalikan tagihan) ber-PPN yang sudah diposting. Di Coretax retur dibuat pembeli lewat menu Retur Pajak Masukan; faktur bernomor e-Faktur lama (16 digit) bisa diekspor sebagai CSV RM. Retur yang dilaporkan mengurangi PPN masukan di Rekap PPN.",
          "Built from posted debit notes (purchase returns/bill reversals) with VAT. In Coretax the buyer creates returns under Input VAT Returns; invoices with legacy e-Faktur numbers (16 digits) can be exported as RM CSV. Reported returns reduce input VAT in the VAT summary.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      {canWrite && (
        <div className="inline-panel">
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                const res = await api<{ created: number; skipped: { name: string; reason: string }[] }>(
                  "/tax-returns/generate",
                  { method: "POST", body: { year, month } },
                );
                const skipped = res.skipped.map((s) => `${s.name} (${s.reason})`).join("; ");
                return l(
                  `${res.created} nota retur dibuat${skipped ? `. Dilewati: ${skipped}` : ""}`,
                  `${res.created} returns created${skipped ? `. Skipped: ${skipped}` : ""}`,
                );
              })
            }
          >
            {l("Buat dari nota debit", "Create from debit notes")}
          </button>
          {can(me.permissions, "tax.manage") && (
            <button
              disabled={!selected.size}
              onClick={() =>
                run(async () => {
                  await download("/tax-returns/export-legacy", { ids: [...selected] }, "retur-masukan.csv");
                  return l("CSV RM diunduh.", "RM CSV downloaded.");
                })
              }
            >
              {l(`CSV retur e-Faktur lama (${selected.size})`, `Legacy return CSV (${selected.size})`)}
            </button>
          )}
        </div>
      )}
      {rows && (
        <TableTools
          view={table}
          placeholder={l("Cari nota, pemasok, nomor faktur…", "Search note, vendor, invoice number…")}
        />
      )}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={l("Pilih semua", "Select all")}
                    checked={exportable.length > 0 && exportable.every((r) => selected.has(r.id))}
                    onChange={(e) =>
                      setSelected(new Set(e.target.checked ? exportable.map((r) => r.id) : []))
                    }
                  />
                </th>
                <SortTh view={table} col="returnNumber">
                  {l("Nota debit", "Debit note")}
                </SortTh>
                <SortTh view={table} col="partner">
                  {l("Pemasok", "Vendor")}
                </SortTh>
                <SortTh view={table} col="efakturNumber">
                  {l("Faktur pajak masukan", "Input tax invoice")}
                </SortTh>
                <SortTh view={table} col="taxBase" className="num">
                  DPP
                </SortTh>
                <SortTh view={table} col="vat" className="num">
                  PPN
                </SortTh>
                <SortTh view={table} col="stlg" className="num">
                  PPnBM
                </SortTh>
                <SortTh view={table} col="state">
                  {l("Status", "Status")}
                </SortTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {exportable.includes(r) && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() =>
                          setSelected((cur) => {
                            const next = new Set(cur);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    {r.returnNumber}
                    <div className="muted small">{formatDate(r.returnDate, locale)}</div>
                  </td>
                  <td>{r.partnerName}</td>
                  <td>
                    {canWrite && r.state === "draft" ? (
                      <select
                        aria-label={l("Faktur pajak masukan", "Input tax invoice")}
                        value={r.inputTaxInvoiceId ?? ""}
                        onChange={(e) =>
                          run(() =>
                            api(`/tax-returns/${r.id}`, {
                              method: "PATCH",
                              body: { inputTaxInvoiceId: e.target.value || null },
                            }),
                          )
                        }
                      >
                        <option value="">{l("— pilih —", "— select —")}</option>
                        {inputs.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.efakturNumber} · {i.sellerName} · {money(i.vat, locale)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (r.efakturNumber ?? "—")
                    )}
                    {r.efakturNumber && (
                      <div className="muted small">
                        {r.legacy ? l("e-Faktur lama", "legacy e-Faktur") : "Coretax"}
                        {r.invoiceDate && ` · ${formatDate(r.invoiceDate, locale)}`}
                      </div>
                    )}
                  </td>
                  <td className="num">{money(r.taxBase, locale)}</td>
                  <td className="num">{money(r.vat, locale)}</td>
                  <td className="num">{Number(r.stlg) ? money(r.stlg, locale) : ""}</td>
                  <td>
                    <span className={`badge ${taxStateClass(r.state)}`}>
                      {tx(TAX_DOC_STATE_LABEL[r.state]!)}
                    </span>
                    {r.coretaxNumber && <div className="muted small">{r.coretaxNumber}</div>}
                  </td>
                  <td className="actions">
                    {canWrite && (r.state === "draft" || r.state === "exported") && (
                      <button
                        className="link"
                        onClick={() => {
                          const number = window.prompt(
                            l(
                              "Nomor nota retur dari Coretax/e-Faktur",
                              "Return number from Coretax/e-Faktur",
                            ),
                            r.returnNumber.replace(/\D/g, ""),
                          );
                          if (number)
                            void run(() =>
                              api(`/tax-returns/${r.id}/approve`, { method: "POST", body: { number } }),
                            );
                        }}
                      >
                        {l("Catat dilaporkan", "Mark reported")}
                      </button>
                    )}
                    {canWrite && r.state !== "cancelled" && (
                      <button
                        className="link danger"
                        onClick={() => {
                          if (window.confirm(l("Batalkan nota retur ini?", "Cancel this return?")))
                            void run(() => api(`/tax-returns/${r.id}/cancel`, { method: "POST" }));
                        }}
                      >
                        {l("Batalkan", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Belum ada nota retur pada masa ini.", "No returns in this period.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && <TablePager view={table} />}
    </>
  );
}
