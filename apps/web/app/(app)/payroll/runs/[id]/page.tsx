"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { download } from "../../../../../components/accounting/download";
import { useOptions } from "../../../../../components/accounting/use-options";
import { useMe } from "../../../../../components/me-context";
import { api } from "../../../../../lib/api";
import { formatDate, money } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";
import { can, PAYROLL_STATE_LABEL } from "../../../../../lib/resources";

interface Run {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  state: string;
  totals: Record<
    "earnings" | "gross" | "pph21" | "employeeBpjs" | "employerBpjs" | "deductions" | "net",
    string
  >;
  payslips: {
    id: string;
    employeeName: string;
    employeeNumber: string;
    departmentName: string | null;
    ptkpStatus: string;
    terCategory: string;
    terRate: string | null;
    isFinal: boolean;
    unpaidDays: string;
    earnings: string;
    gross: string;
    pph21: string;
    employeeBpjs: string;
    net: string;
  }[];
  accountMove: { id: string; name: string | null } | null;
  paymentMove: { id: string; name: string | null } | null;
}

/** Detail payroll: slip per karyawan, hitung ulang, posting, bayar, file transfer bank & rekap PPh 21/BPJS. */
export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const router = useRouter();
  const { l, tx, locale } = useI18n();
  const journals = useOptions<{ id: string; code: string; name: string; journalType: string }>("/journals");
  const [run, setRun] = useState<Run | null>(null);
  const [journalId, setJournalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Run>(`/payroll-runs/${id}`)
      .then(setRun)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  async function act(path: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      setRun(await api<Run>(`/payroll-runs/${id}/${path}`, { method: "POST", body: body ?? {} }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!run) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const manage = can(me.permissions, "payroll.manage");
  const banks = journals.filter((j) => j.journalType === "bank" || j.journalType === "cash");
  const n = (v: string) => money(v, locale);

  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{run.name}</h1>
        <span
          className={`badge state-${run.state === "paid" ? "sale" : run.state === "done" ? "posted" : run.state}`}
        >
          {tx(PAYROLL_STATE_LABEL[run.state]!)}
        </span>
        {run.state === "draft" && can(me.permissions, "payroll.write") && (
          <button type="button" disabled={busy} onClick={() => act("compute")}>
            {l("Hitung ulang", "Recompute")}
          </button>
        )}
        {run.state === "draft" && manage && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              confirm(
                l(
                  "Posting payroll ke jurnal? Slip tidak bisa diubah lagi.",
                  "Post payroll? Payslips will be locked.",
                ),
              ) && act("post")
            }
          >
            {l("Posting", "Post")}
          </button>
        )}
        {run.state === "draft" && can(me.permissions, "payroll.write") && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm(l("Batalkan payroll ini?", "Cancel this payroll run?"))) return;
              await api(`/payroll-runs/${id}/cancel`, { method: "POST" }).catch((e: Error) =>
                setError(e.message),
              );
              router.replace("/payroll/runs");
            }}
          >
            {l("Batalkan", "Cancel")}
          </button>
        )}
        {manage && (
          <>
            <button
              type="button"
              onClick={() =>
                download(
                  `/payroll-runs/${id}/bank-transfer?format=csv`,
                  `transfer-${run.periodStart.slice(0, 7)}.csv`,
                ).catch((e: Error) => setError(e.message))
              }
            >
              {l("File transfer bank", "Bank transfer file")}
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `/payroll-runs/${id}/recap?format=csv`,
                  `pph21-bpjs-${run.periodStart.slice(0, 7)}.csv`,
                ).catch((e: Error) => setError(e.message))
              }
            >
              {l("Rekap PPh 21 & BPJS", "PPh 21 & BPJS recap")}
            </button>
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        {l("Periode", "Period")} {formatDate(run.periodStart, locale)} – {formatDate(run.periodEnd, locale)} ·{" "}
        {l("dibayar", "paid on")} {formatDate(run.paymentDate, locale)}
        {run.accountMove && (
          <>
            {" · "}
            {l("Jurnal", "Entry")}{" "}
            <Link href={`/accounting/moves/${run.accountMove.id}`}>{run.accountMove.name}</Link>
          </>
        )}
        {run.paymentMove && (
          <>
            {" · "}
            {l("Pembayaran", "Payment")}{" "}
            <Link href={`/accounting/moves/${run.paymentMove.id}`}>{run.paymentMove.name}</Link>
          </>
        )}
      </p>
      {run.state === "done" && manage && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Bayar dari", "Pay from")}</span>
            <select value={journalId} onChange={(e) => setJournalId(e.target.value)}>
              <option value="">—</option>
              {banks.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} {j.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={!journalId || busy}
            onClick={() => act("pay", { journalId, date: run.paymentDate })}
          >
            {l(`Bayar gaji bersih ${n(run.totals.net)}`, `Pay net salaries ${n(run.totals.net)}`)}
          </button>
        </div>
      )}
      <ul className="grid">
        {(
          [
            [l("Total pendapatan", "Total earnings"), run.totals.earnings],
            [l("PPh 21", "PPh 21"), run.totals.pph21],
            [l("BPJS karyawan", "Employee BPJS"), run.totals.employeeBpjs],
            [l("BPJS perusahaan", "Employer BPJS"), run.totals.employerBpjs],
            [l("Gaji bersih", "Net pay"), run.totals.net],
          ] as const
        ).map(([label, value]) => (
          <li key={label} className="card">
            <span>{label}</span>
            <strong>{n(value)}</strong>
          </li>
        ))}
      </ul>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Karyawan", "Employee")}</th>
              <th>PTKP / TER</th>
              <th className="num">{l("Hari tak dibayar", "Unpaid days")}</th>
              <th className="num">{l("Pendapatan", "Earnings")}</th>
              <th className="num">{l("Bruto PPh 21", "PPh 21 gross")}</th>
              <th className="num">PPh 21</th>
              <th className="num">BPJS</th>
              <th className="num">{l("Gaji bersih", "Net")}</th>
            </tr>
          </thead>
          <tbody>
            {run.payslips.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/payroll/payslips/${p.id}`}>{p.employeeName}</Link>
                  <small className="muted">
                    {" "}
                    · {p.employeeNumber}
                    {p.departmentName ? ` · ${p.departmentName}` : ""}
                  </small>
                </td>
                <td>
                  {p.ptkpStatus} ·{" "}
                  {p.isFinal ? l("tahunan", "annual") : `${p.terCategory} ${Number(p.terRate ?? 0)}%`}
                </td>
                <td className="num">{Number(p.unpaidDays) || ""}</td>
                <td className="num">{n(p.earnings)}</td>
                <td className="num">{n(p.gross)}</td>
                <td className="num">{n(p.pph21)}</td>
                <td className="num">{n(p.employeeBpjs)}</td>
                <td className="num">
                  <strong>{n(p.net)}</strong>
                </td>
              </tr>
            ))}
            {run.payslips.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {l(
                    "Tidak ada karyawan dengan kontrak berjalan pada periode ini.",
                    "No employees with a running contract in this period.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
