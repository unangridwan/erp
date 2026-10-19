"use client";

import { Fragment, useEffect, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  occurrences: number;
  minutes: number;
  penalty: string;
  days: { date: string; minutes: number; penalty: string }[];
}

/** Rekap keterlambatan dari absen masuk vs jadwal kerja/shift; potongannya otomatis masuk slip gaji. */
export default function LatenessPage() {
  const { l, locale } = useI18n();
  const employees = useOptions<{ id: string; name: string }>("/employees");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ from, to });
    if (employeeId) params.set("employeeId", employeeId);
    api<Row[]>(`/attendance/lateness?${params}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [from, to, employeeId]);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Keterlambatan", "Lateness")}</h1>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">{l("Semua karyawan", "All employees")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </header>
      <p className="muted">
        {l(
          "Dihitung dari absen masuk pertama per hari kerja terhadap jadwal karyawan (penugasan shift menggantikan jadwal bawaan). Hari libur dikecualikan.",
          "Based on the first check-in per workday against the employee's schedule (shift assignments override the default). Public holidays are excluded.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("No.", "No.")}</th>
                <th>{l("Karyawan", "Employee")}</th>
                <th className="num">{l("Kali terlambat", "Occurrences")}</th>
                <th className="num">{l("Menit", "Minutes")}</th>
                <th className="num">{l("Potongan", "Deduction")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.employeeId}>
                  <tr>
                    <td>{r.employeeNumber}</td>
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setOpen(open === r.employeeId ? null : r.employeeId)}
                      >
                        {open === r.employeeId ? "▾" : "▸"} {r.employeeName}
                      </button>
                    </td>
                    <td className="num">{r.occurrences}</td>
                    <td className="num">{r.minutes}</td>
                    <td className="num">{money(r.penalty, locale)}</td>
                  </tr>
                  {open === r.employeeId &&
                    r.days.map((d) => (
                      <tr key={`${r.employeeId}-${d.date}`} className="muted">
                        <td />
                        <td>{formatDate(d.date, locale)}</td>
                        <td />
                        <td className="num">{d.minutes}</td>
                        <td className="num">{money(d.penalty, locale)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {l("Tidak ada keterlambatan.", "No lateness.")}
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
