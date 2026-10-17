"use client";

import { parseCsv } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useOptions, type JournalOption } from "../../../../components/accounting/use-options";
import { useMe } from "../../../../components/me-context";
import { api, ApiError } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

interface Statement {
  id: string;
  name: string;
  date: string;
  journalName: string;
  lineCount: number;
  openCount: number;
  total: string;
}

const DATE_FORMATS = ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD-MM-YYYY", "DD/MM/YY"];

/** Tebak kolom dari nama header yang umum di mutasi bank Indonesia. */
function guess(headers: string[], ...patterns: RegExp[]) {
  return headers.find((h) => patterns.some((p) => p.test(h))) ?? "";
}

export default function BankStatementsPage() {
  const me = useMe();
  const { l, locale } = useI18n();
  const journals = useOptions<JournalOption>("/journals").filter(
    (j) => j.journalType === "bank" || j.journalType === "cash",
  );
  const [statements, setStatements] = useState<Statement[]>([]);
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [form, setForm] = useState({
    journalId: "",
    name: "",
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    partner: "",
    dateFormat: "DD/MM/YYYY",
    decimal: ",",
    mode: "split",
  });
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; message: string }[]>([]);

  const load = () => api<Statement[]>("/bank-statements").then(setStatements);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function onFile(file: File) {
    const text = await file.text();
    setCsv(text);
    try {
      const rows = parseCsv(text);
      const hs = Object.keys(rows[0] ?? {});
      setHeaders(hs);
      const debit = guess(hs, /^deb/i, /^mutasi.*debet/i, /keluar/i, /^withdraw/i);
      const credit = guess(hs, /^kre/i, /^cred/i, /masuk/i, /^deposit/i);
      setForm((f) => ({
        ...f,
        name: f.name || file.name.replace(/\.csv$/i, ""),
        date: guess(hs, /tanggal/i, /^tgl/i, /date/i),
        description: guess(hs, /keterangan/i, /deskripsi/i, /description/i, /uraian/i, /remark/i),
        debit,
        credit,
        amount: guess(hs, /^jumlah$/i, /^amount$/i, /^nominal$/i),
        mode: debit && credit ? "split" : "single",
      }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRowErrors([]);
    try {
      const mapping = {
        date: form.date,
        description: form.description,
        ...(form.mode === "single" ? { amount: form.amount } : { debit: form.debit, credit: form.credit }),
        ...(form.partner ? { partner: form.partner } : {}),
        dateFormat: form.dateFormat,
        decimal: form.decimal,
      };
      const created = await api<{ id: string }>("/bank-statements/import", {
        method: "POST",
        body: { journalId: form.journalId || journals[0]?.id, name: form.name, csv, mapping },
      });
      window.location.href = `/accounting/bank/${created.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError)
        setRowErrors((err.body.errors as { row: number; message: string }[]) ?? []);
    }
  }

  const column = (
    key: "date" | "description" | "amount" | "debit" | "credit" | "partner",
    label: string,
    optional = false,
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        value={form[key]}
        required={!optional}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      >
        <option value="">—</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Mutasi bank", "Bank statements")}</h1>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nama", "Name")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Jurnal", "Journal")}</th>
              <th className="num">{l("Total mutasi", "Net amount")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/accounting/bank/${s.id}`}>{s.name}</Link>
                </td>
                <td>{formatDate(s.date, locale)}</td>
                <td>{s.journalName}</td>
                <td className="num">{money(s.total, locale)}</td>
                <td>
                  {s.openCount === 0 ? (
                    <span className="badge pay-paid">{l("Selesai", "Done")}</span>
                  ) : (
                    <span className="badge pay-partial">
                      {s.openCount}/{s.lineCount} {l("belum dicocokkan", "to reconcile")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {statements.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {l("Belum ada mutasi diimpor.", "No statements imported yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {can(me.permissions, "accounting.write") && (
        <form className="panel stack invite" onSubmit={submit}>
          <h2>{l("Impor mutasi rekening (CSV)", "Import bank statement (CSV)")}</h2>
          <p className="muted">
            {l(
              "Unduh mutasi dari internet banking dalam format CSV, lalu petakan kolomnya.",
              "Download the statement from internet banking as CSV, then map its columns.",
            )}
          </p>
          <div className="fields">
            <label className="field">
              <span>{l("File CSV *", "CSV file *")}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
              />
            </label>
            <label className="field">
              <span>{l("Jurnal kas/bank", "Bank/cash journal")}</span>
              <select
                value={form.journalId}
                onChange={(e) => setForm((f) => ({ ...f, journalId: e.target.value }))}
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{l("Nama *", "Name *")}</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
          </div>
          {headers.length > 0 && (
            <div className="fields">
              {column("date", l("Kolom tanggal *", "Date column *"))}
              {column("description", l("Kolom keterangan *", "Description column *"))}
              <label className="field">
                <span>{l("Jumlah dalam", "Amounts in")}</span>
                <select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>
                  <option value="split">{l("Dua kolom (debet/kredit)", "Two columns (debit/credit)")}</option>
                  <option value="single">{l("Satu kolom bertanda", "One signed column")}</option>
                </select>
              </label>
              {form.mode === "single" ? (
                column("amount", l("Kolom jumlah *", "Amount column *"))
              ) : (
                <>
                  {column("debit", l("Kolom debet (keluar) *", "Debit column (out) *"))}
                  {column("credit", l("Kolom kredit (masuk) *", "Credit column (in) *"))}
                </>
              )}
              {column("partner", l("Kolom nama partner", "Partner name column"), true)}
              <label className="field">
                <span>{l("Format tanggal", "Date format")}</span>
                <select
                  value={form.dateFormat}
                  onChange={(e) => setForm((f) => ({ ...f, dateFormat: e.target.value }))}
                >
                  {DATE_FORMATS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{l("Format angka", "Number format")}</span>
                <select
                  value={form.decimal}
                  onChange={(e) => setForm((f) => ({ ...f, decimal: e.target.value }))}
                >
                  <option value=",">1.234.567,89</option>
                  <option value=".">1,234,567.89</option>
                </select>
              </label>
            </div>
          )}
          <button className="primary" disabled={!csv}>
            {l("Impor", "Import")}
          </button>
          {error && <p className="error">{error}</p>}
          {rowErrors.length > 0 && (
            <ul className="error">
              {rowErrors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {l("Baris", "Row")} {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </>
  );
}
