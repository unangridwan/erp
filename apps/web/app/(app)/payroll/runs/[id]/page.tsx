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
    | "earnings"
    | "gross"
    | "pph21"
    | "kesEmployee"
    | "kesEmployer"
    | "tkEmployee"
    | "tkEmployer"
    | "deductions"
    | "net",
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
    kesEmployee: string;
    tkEmployee: string;
    net: string;
    emailedAt: string | null;
    emailError: string | null;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [holidayDate, setHolidayDate] = useState("");
  const [holiday, setHoliday] = useState("");
  const [bankFormat, setBankFormat] = useState("csv");

  const load = () =>
    api<Run>(`/payroll-runs/${id}`)
      .then(setRun)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [id]);

  /** Aksi yang mengembalikan ringkasan (THR, rapel, email): tampilkan pesan lalu muat ulang payroll. */
  async function summaryAction<T>(path: string, body: object, message: (r: T) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<T>(`/payroll-runs/${id}/${path}`, { method: "POST", body });
      setNotice(message(r));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
            <select
              aria-label={l("Format file transfer", "Transfer file format")}
              value={bankFormat}
              onChange={(e) => setBankFormat(e.target.value)}
            >
              <option value="csv">{l("CSV umum (semua bank)", "Generic CSV (all banks)")}</option>
              <option value="bca">BCA — KlikBCA Bisnis</option>
              <option value="mandiri">Mandiri — MCM</option>
              <option value="bri">BRI — CMS</option>
              <option value="bni">BNI — BNIDirect</option>
            </select>
            <button
              type="button"
              onClick={() =>
                download(
                  `/payroll-runs/${id}/bank-transfer?format=${bankFormat}`,
                  `transfer-gaji-${bankFormat}-${run.periodStart.slice(0, 7)}.${bankFormat === "bca" ? "txt" : "csv"}`,
                ).catch((e: Error) => setError(e.message))
              }
            >
              {l("File transfer bank", "Bank transfer file")}
            </button>
            <Link className="button" href={`/payroll/data?runId=${id}`}>
              {l("Impor/ekspor Excel", "Excel import/export")}
            </Link>
            {(
              [
                ["csv", l("Rekap PPh 21 & BPJS", "PPh 21 & BPJS recap"), "pph21-bpjs"],
                ["edabu", "BPJS Kesehatan (e-Dabu)", "bpjs-kesehatan-edabu"],
                ["sipp", "BPJS Ketenagakerjaan (SIPP)", "bpjs-ketenagakerjaan-sipp"],
              ] as const
            ).map(([format, label, file]) => (
              <button
                key={format}
                type="button"
                onClick={() =>
                  download(
                    `/payroll-runs/${id}/recap?format=${format}`,
                    `${file}-${run.periodStart.slice(0, 7)}.csv`,
                  ).catch((e: Error) => setError(e.message))
                }
              >
                {label}
              </button>
            ))}
            {run.state !== "draft" && run.state !== "cancel" && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  confirm(
                    l(
                      "Kirim slip gaji (PDF berkata sandi tanggal lahir) ke email kerja karyawan?",
                      "Email payslips (PDF protected with the birth date) to employees' work emails?",
                    ),
                  ) &&
                  summaryAction<{ sent: number; failed: number; skipped: { name: string }[] }>(
                    "email-payslips",
                    {},
                    (r) =>
                      l(
                        `${r.sent} slip terkirim, ${r.failed} gagal, ${r.skipped.length} dilewati (tanpa email)${r.skipped.length ? `: ${r.skipped.map((x) => x.name).join(", ")}` : ""}.`,
                        `${r.sent} payslips sent, ${r.failed} failed, ${r.skipped.length} skipped (no email)${r.skipped.length ? `: ${r.skipped.map((x) => x.name).join(", ")}` : ""}.`,
                      ),
                  )
                }
              >
                {l("Kirim slip via email", "Email payslips")}
              </button>
            )}
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {run.state === "draft" && can(me.permissions, "payroll.write") && (
        <div className="inline-panel">
          <label className="field">
            <span>{l("Tanggal hari raya", "Holiday date")}</span>
            <input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Hari raya", "Holiday")}</span>
            <input
              placeholder="Idul Fitri 1447 H"
              value={holiday}
              onChange={(e) => setHoliday(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!holidayDate || busy}
            onClick={() =>
              summaryAction<{ total: string; items: { eligible: boolean }[] }>(
                "thr",
                { holidayDate, holiday: holiday || null },
                (r) =>
                  l(
                    `THR ${r.items.filter((i) => i.eligible).length} karyawan, total ${n(r.total)} (Permenaker 6/2016).`,
                    `THR for ${r.items.filter((i) => i.eligible).length} employees, total ${n(r.total)}.`,
                  ),
              )
            }
          >
            {l("Hitung THR", "Compute THR")}
          </button>
          <button
            type="button"
            disabled={busy}
            title={l(
              "Selisih kenaikan upah berlaku mundur terhadap payroll yang sudah diposting",
              "Back pay for retroactive wage increases against posted payrolls",
            )}
            onClick={() =>
              summaryAction<{ total: string; items: unknown[] }>("retro", {}, (r) =>
                l(
                  `Rapel ${r.items.length} karyawan, total ${n(r.total)}.`,
                  `Back pay for ${r.items.length} employees, total ${n(r.total)}.`,
                ),
              )
            }
          >
            {l("Hitung rapel", "Compute back pay")}
          </button>
        </div>
      )}
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
            [l("BPJS Kesehatan — karyawan", "BPJS Health — employee"), run.totals.kesEmployee],
            [l("BPJS Kesehatan — perusahaan", "BPJS Health — employer"), run.totals.kesEmployer],
            [l("BPJS Ketenagakerjaan — karyawan", "BPJS Employment — employee"), run.totals.tkEmployee],
            [l("BPJS Ketenagakerjaan — perusahaan", "BPJS Employment — employer"), run.totals.tkEmployer],
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
              <th className="num">{l("BPJS Kesehatan", "BPJS Health")}</th>
              <th className="num">{l("BPJS Ketenagakerjaan", "BPJS Employment")}</th>
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
                    {p.emailedAt ? ` · ${l("slip terkirim", "slip emailed")}` : ""}
                  </small>
                  {p.emailError && <small className="error"> {p.emailError}</small>}
                </td>
                <td>
                  {p.ptkpStatus} ·{" "}
                  {p.isFinal ? l("tahunan", "annual") : `${p.terCategory} ${Number(p.terRate ?? 0)}%`}
                </td>
                <td className="num">{Number(p.unpaidDays) || ""}</td>
                <td className="num">{n(p.earnings)}</td>
                <td className="num">{n(p.gross)}</td>
                <td className="num">{n(p.pph21)}</td>
                <td className="num">{n(p.kesEmployee)}</td>
                <td className="num">{n(p.tkEmployee)}</td>
                <td className="num">
                  <strong>{n(p.net)}</strong>
                </td>
              </tr>
            ))}
            {run.payslips.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
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
