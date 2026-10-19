"use client";

import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { download, readFile, taxStateClass } from "../../../../lib/download";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, TAX_DOC_STATE_LABEL, TRX_CODES } from "../../../../lib/resources";

interface TaxInvoice {
  id: string;
  moveId: string;
  moveName: string;
  reversed: boolean;
  state: string;
  trxCode: string;
  addInfo: string | null;
  facilityStamp: string | null;
  invoiceDate: string;
  ref: string;
  buyerName: string;
  buyerTin: string;
  buyerDocument: string;
  buyerDocumentNumber: string | null;
  taxBase: string;
  otherTaxBase: string;
  vat: string;
  stlg: string;
  efakturNumber: string | null;
  downPayment: number;
  replacesId: string | null;
  replacedNumber: string | null;
  nsfp: string | null;
}

interface Generated {
  created: number;
  skipped: { name: string; reason: string }[];
}

export default function TaxInvoicesPage() {
  const me = useMe();
  const { l, tx, locale } = useI18n();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [docs, setDocs] = useState<TaxInvoice[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Generated | null>(null);
  const [editing, setEditing] = useState<TaxInvoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [year, month] = period.split("-").map(Number) as [number, number];
  const canWrite = can(me.permissions, "tax.write");

  const load = useCallback(() => {
    api<TaxInvoice[]>(`/tax-invoices?year=${year}&month=${month}`)
      .then((rows) => {
        setDocs(rows);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, [year, month]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null);
    setMessage(null);
    setProblems(null);
    try {
      await action();
      if (done) setMessage(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const exportable = (docs ?? []).filter((d) => d.state === "draft" || d.state === "exported");
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Faktur Pajak Keluaran", "Output Tax Invoices")}</h1>
        <label className="field inline">
          <span>{l("Masa pajak", "Tax period")}</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </header>
      <p className="muted">
        {l(
          "Draft dibuat dari faktur penjualan ber-PPN yang sudah diposting. Ekspor XML lalu impor di Coretax (e-Faktur → Impor). Setelah faktur terbit, catat nomornya atau impor daftar faktur dari Coretax.",
          "Drafts are built from posted sales invoices with VAT. Export XML and import it in Coretax (e-Faktur → Import). Once approved, record the number or import the Coretax list.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      {canWrite && (
        <div className="inline-panel">
          <button
            className="primary"
            onClick={() =>
              run(async () =>
                setResult(
                  await api<Generated>("/tax-invoices/generate", { method: "POST", body: { year, month } }),
                ),
              )
            }
          >
            {l("Buat draft dari faktur penjualan", "Create drafts from sales invoices")}
          </button>
          {can(me.permissions, "tax.manage") && (
            <button
              disabled={!selected.size}
              onClick={() =>
                run(
                  () => download("/tax-invoices/export", { ids: [...selected] }, "faktur-keluaran.xml"),
                  l("XML diunduh; status menjadi Diekspor.", "XML downloaded; status set to Exported."),
                )
              }
            >
              {l(`Ekspor XML (${selected.size})`, `Export XML (${selected.size})`)}
            </button>
          )}
          <button
            disabled={!selected.size}
            onClick={() =>
              run(async () => {
                const res = await api<{ checked: number; errors: string[] }>("/tax-invoices/check", {
                  method: "POST",
                  body: { ids: [...selected] },
                });
                if (res.errors.length) setProblems(res.errors);
                else
                  setMessage(
                    l(
                      `${res.checked} faktur memenuhi ketentuan template impor Coretax.`,
                      `${res.checked} invoices pass the Coretax import template rules.`,
                    ),
                  );
              })
            }
          >
            {l(`Periksa (${selected.size})`, `Check (${selected.size})`)}
          </button>
          {can(me.permissions, "tax.manage") && (
            <button
              disabled={!selected.size}
              title={l(
                "Format CSV aplikasi e-Faktur 3.x untuk PKP yang belum memakai Coretax; NSFP diambil dari rentang terdaftar",
                "e-Faktur 3.x CSV for taxpayers not yet on Coretax; NSFP taken from registered ranges",
              )}
              onClick={() =>
                run(
                  () => download("/tax-invoices/export-legacy", { ids: [...selected] }, "efaktur-lama.csv"),
                  l("CSV e-Faktur 3.x diunduh.", "e-Faktur 3.x CSV downloaded."),
                )
              }
            >
              {l(`CSV e-Faktur lama (${selected.size})`, `Legacy e-Faktur CSV (${selected.size})`)}
            </button>
          )}
          <label className="button">
            {l("Impor nomor faktur (CSV Coretax)", "Import invoice numbers (Coretax CSV)")}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  const res = await api<{ approved: number; unmatched: string[] }>(
                    "/tax-invoices/import-numbers",
                    {
                      method: "POST",
                      body: { csv: await readFile(file) },
                    },
                  );
                  setMessage(
                    l(
                      `${res.approved} faktur tercatat terbit${res.unmatched.length ? `; tidak cocok: ${res.unmatched.join(", ")}` : ""}`,
                      `${res.approved} invoices approved${res.unmatched.length ? `; unmatched: ${res.unmatched.join(", ")}` : ""}`,
                    ),
                  );
                });
              }}
            />
          </label>
        </div>
      )}
      {problems && (
        <div className="panel">
          <p className="error">
            {l("Perbaiki sebelum diunggah ke Coretax:", "Fix before uploading to Coretax:")}
          </p>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div className="panel">
          <p>
            {l(
              `${result.created} draft faktur pajak dibuat.`,
              `${result.created} draft tax invoices created.`,
            )}
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="error">
                {l("Dilewati — lengkapi datanya lalu ulangi:", "Skipped — complete the data and retry:")}
              </p>
              <ul>
                {result.skipped.map((s) => (
                  <li key={s.name}>
                    <strong>{s.name}</strong>: {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {editing && (
        <EditPanel
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {docs && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={l("Pilih semua", "Select all")}
                    checked={exportable.length > 0 && exportable.every((d) => selected.has(d.id))}
                    onChange={(e) =>
                      setSelected(new Set(e.target.checked ? exportable.map((d) => d.id) : []))
                    }
                  />
                </th>
                <th>{l("Faktur", "Invoice")}</th>
                <th>{l("Tanggal", "Date")}</th>
                <th>{l("Pembeli", "Buyer")}</th>
                <th>{l("Kode", "Code")}</th>
                <th className="num">DPP</th>
                <th className="num">{l("DPP nilai lain", "Other base")}</th>
                <th className="num">PPN</th>
                <th className="num">PPnBM</th>
                <th>{l("Nomor faktur", "Invoice number")}</th>
                <th>{l("Status", "Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    {(d.state === "draft" || d.state === "exported") && (
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                    )}
                  </td>
                  <td>
                    {d.ref}
                    {d.reversed && <span className="badge state-cancel">{l("dibalik", "reversed")}</span>}
                    {d.downPayment === 1 && (
                      <span className="badge state-draft">{l("uang muka", "down payment")}</span>
                    )}
                    {d.downPayment === 2 && (
                      <span className="badge state-draft">{l("pelunasan", "settlement")}</span>
                    )}
                    {d.replacesId && (
                      <div className="muted small">
                        {l("Pengganti", "Replaces")} {d.replacedNumber}
                      </div>
                    )}
                  </td>
                  <td>{formatDate(d.invoiceDate, locale)}</td>
                  <td>
                    {d.buyerName}
                    <div className="muted small">
                      {d.buyerDocument === "TIN"
                        ? d.buyerTin
                        : `${d.buyerDocument} ${d.buyerDocumentNumber ?? ""}`}
                    </div>
                  </td>
                  <td>{d.trxCode}</td>
                  <td className="num">{money(d.taxBase, locale)}</td>
                  <td className="num">{money(d.otherTaxBase, locale)}</td>
                  <td className="num">{money(d.vat, locale)}</td>
                  <td className="num">{Number(d.stlg) ? money(d.stlg, locale) : ""}</td>
                  <td>
                    {d.efakturNumber ?? ""}
                    {d.nsfp && <div className="muted small">NSFP {d.nsfp}</div>}
                  </td>
                  <td>
                    <span className={`badge ${taxStateClass(d.state)}`}>
                      {tx(TAX_DOC_STATE_LABEL[d.state]!)}
                    </span>
                  </td>
                  <td className="actions">
                    {canWrite && d.state === "draft" && (
                      <button className="link" onClick={() => setEditing(d)}>
                        {l("Ubah", "Edit")}
                      </button>
                    )}
                    {canWrite && (d.state === "draft" || d.state === "exported") && (
                      <button
                        className="link"
                        onClick={() => {
                          const number = window.prompt(
                            l("Nomor faktur dari Coretax", "Invoice number from Coretax"),
                          );
                          if (number)
                            void run(() =>
                              api(`/tax-invoices/${d.id}/approve`, { method: "POST", body: { number } }),
                            );
                        }}
                      >
                        {l("Catat terbit", "Mark approved")}
                      </button>
                    )}
                    {canWrite && d.state === "approved" && (
                      <button
                        className="link"
                        title={l(
                          "Buat draft faktur pengganti (data dihitung ulang dari faktur penjualan)",
                          "Create a replacement draft (recomputed from the sales invoice)",
                        )}
                        onClick={() =>
                          run(
                            () => api(`/tax-invoices/${d.id}/replace`, { method: "POST" }),
                            l(
                              "Draft pengganti dibuat. Buat penggantinya di Coretax (Faktur Keluaran → Ganti), lalu catat nomornya.",
                              "Replacement draft created. Create it in Coretax (Output Invoices → Replace), then record its number.",
                            ),
                          )
                        }
                      >
                        {l("Ganti", "Replace")}
                      </button>
                    )}
                    {canWrite && d.state !== "cancelled" && d.state !== "replaced" && (
                      <button
                        className="link danger"
                        onClick={() => {
                          if (window.confirm(l("Batalkan faktur pajak ini?", "Cancel this tax invoice?")))
                            void run(() => api(`/tax-invoices/${d.id}/cancel`, { method: "POST" }));
                        }}
                      >
                        {l("Batalkan", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={12} className="muted">
                    {l("Belum ada faktur pajak pada masa ini.", "No tax invoices in this period.")}
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

function EditPanel({ doc, onClose, onSaved }: { doc: TaxInvoice; onClose: () => void; onSaved: () => void }) {
  const { l, tx } = useI18n();
  const [trxCode, setTrxCode] = useState(doc.trxCode);
  const [addInfo, setAddInfo] = useState(doc.addInfo ?? "");
  const [facilityStamp, setFacilityStamp] = useState(doc.facilityStamp ?? "");
  const [error, setError] = useState<string | null>(null);
  const facility = trxCode === "07" || trxCode === "08";

  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(`/tax-invoices/${doc.id}`, {
            method: "PATCH",
            body: {
              trxCode,
              addInfo: facility ? addInfo : null,
              facilityStamp: facility ? facilityStamp : null,
            },
          });
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <h2>{doc.ref}</h2>
      {error && <p className="error">{error}</p>}
      <label className="field">
        <span>{l("Kode transaksi", "Transaction code")}</span>
        <select value={trxCode} onChange={(e) => setTrxCode(e.target.value)}>
          {TRX_CODES.map(([code, label]) => (
            <option key={code} value={code}>
              {tx(label)}
            </option>
          ))}
        </select>
      </label>
      {facility && (
        <>
          <label className="field">
            <span>{l("Keterangan tambahan (kode TD.005xx)", "Additional info (TD.005xx)")}</span>
            <input
              value={addInfo}
              required
              onChange={(e) => setAddInfo(e.target.value)}
              placeholder="TD.00501"
            />
          </label>
          <label className="field">
            <span>{l("Cap fasilitas (kode TD.011xx)", "Facility stamp (TD.011xx)")}</span>
            <input
              value={facilityStamp}
              required
              onChange={(e) => setFacilityStamp(e.target.value)}
              placeholder="TD.01101"
            />
          </label>
        </>
      )}
      <div className="form-actions">
        <button className="primary">{l("Simpan & hitung ulang", "Save & recompute")}</button>
        <button type="button" onClick={onClose}>
          {l("Tutup", "Close")}
        </button>
      </div>
    </form>
  );
}
