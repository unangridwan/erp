"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExpenseClaimForm } from "../../../../components/hr/expense-form";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, EXPENSE_STATE_LABEL } from "../../../../lib/resources";

interface Claim {
  id: string;
  name: string;
  employeeName: string;
  date: string;
  description: string | null;
  state: string;
  payMethod: string;
  total: string;
}

/** Klaim biaya karyawan: daftar per status, buat klaim untuk karyawan (HR). */
export default function ExpensesPage() {
  const { l, tx, locale } = useI18n();
  const me = useMe();
  const [state, setState] = useState("");
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Claim[]>(`/expense-claims${state ? `?state=${state}` : ""}`).then(setClaims, (e: Error) =>
      setError(e.message),
    );
  }, [state, version]);
  useEffect(() => {
    api<{ id: string; name: string }[]>("/me/expense-categories").then(setCategories, () =>
      setCategories([]),
    );
  }, []);

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Klaim Biaya", "Expense Claims")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="">{l("Semua status", "All states")}</option>
          {Object.entries(EXPENSE_STATE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {tx(v)}
            </option>
          ))}
        </select>
        {can(me.permissions, "hr.write") && !open && (
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            {l("Klaim baru", "New claim")}
          </button>
        )}
        <Link href="/expense-categories">{l("Kategori klaim", "Expense categories")}</Link>
      </header>
      {error && <p className="error">{error}</p>}
      {open && (
        <ExpenseClaimForm
          categories={categories}
          chooseEmployee
          onSaved={() => {
            setOpen(false);
            setVersion((v) => v + 1);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Nomor", "Number")}</th>
              <th>{l("Karyawan", "Employee")}</th>
              <th>{l("Tanggal", "Date")}</th>
              <th>{l("Keperluan", "Purpose")}</th>
              <th>{l("Dibayar", "Paid")}</th>
              <th className="num">{l("Jumlah", "Amount")}</th>
              <th>{l("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {claims?.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/hr/expenses/${c.id}`}>{c.name}</Link>
                </td>
                <td>{c.employeeName}</td>
                <td>{formatDate(c.date, locale)}</td>
                <td>{c.description}</td>
                <td>{c.payMethod === "cash" ? l("Kas/bank", "Cash/bank") : l("Slip gaji", "Payslip")}</td>
                <td className="num">{money(c.total, locale)}</td>
                <td>
                  <span className={`badge state-${c.state === "paid" ? "sale" : c.state}`}>
                    {tx(EXPENSE_STATE_LABEL[c.state]!)}
                  </span>
                </td>
              </tr>
            ))}
            {claims?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {l("Belum ada klaim.", "No claims yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
