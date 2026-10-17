"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useMe } from "../../../../components/me-context";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { can, PAYROLL_STATE_LABEL } from "../../../../lib/resources";

interface Run {
  id: string;
  name: string;
  periodStart: string;
  paymentDate: string;
  state: string;
  employees: number;
  net: string;
  pph21: string;
}

export default function PayrollRunsPage() {
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [paymentDate, setPaymentDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Run[]>("/payroll-runs")
      .then(setRuns)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const run = await api<{ id: string }>("/payroll-runs", {
        method: "POST",
        body: { period, paymentDate },
      });
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="toolbar">
        <h1>{l("Penggajian", "Payroll Runs")}</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {can(me.permissions, "payroll.write") && (
        <form className="inline-panel" onSubmit={create}>
          <label className="field">
            <span>{l("Bulan", "Month")}</span>
            <input type="month" required value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Tanggal bayar", "Payment date")}</span>
            <input
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </label>
          <button className="primary">{l("Buat & hitung payroll", "Create & compute payroll")}</button>
        </form>
      )}
      {runs && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Payroll", "Payroll")}</th>
                <th>{l("Tanggal bayar", "Payment date")}</th>
                <th className="num">{l("Karyawan", "Employees")}</th>
                <th className="num">PPh 21</th>
                <th className="num">{l("Gaji bersih", "Net pay")}</th>
                <th>{l("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/payroll/runs/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{formatDate(r.paymentDate, locale)}</td>
                  <td className="num">{r.employees}</td>
                  <td className="num">{money(r.pph21, locale)}</td>
                  <td className="num">{money(r.net, locale)}</td>
                  <td>
                    <span
                      className={`badge state-${r.state === "paid" ? "sale" : r.state === "done" ? "posted" : r.state}`}
                    >
                      {tx(PAYROLL_STATE_LABEL[r.state]!)}
                    </span>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {l("Belum ada payroll.", "No payroll runs yet.")}
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
