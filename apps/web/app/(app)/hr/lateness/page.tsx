"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDate, money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ from, to });
    api<Row[]>(`/attendance/lateness?${params}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  const columns = useMemo<ViewColumn<Row>[]>(
    () => [
      { key: "employeeNumber", label: l("No.", "No."), value: (r) => r.employeeNumber },
      { key: "employee", label: l("Karyawan", "Employee"), value: (r) => r.employeeName },
      {
        key: "occurrences",
        label: l("Kali terlambat", "Occurrences"),
        type: "number",
        value: (r) => r.occurrences,
      },
      { key: "minutes", label: l("Menit", "Minutes"), type: "number", value: (r) => r.minutes },
      { key: "penalty", label: l("Potongan", "Deduction"), type: "number", value: (r) => Number(r.penalty) },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "lateness",
    defaultSort: { key: "minutes", dir: "desc" },
  });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Keterlambatan", "Lateness")}</h1>
        <input
          type="date"
          aria-label={l("Dari", "From")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label={l("Sampai", "To")}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </header>
      <p className="muted">
        {l(
          "Dihitung dari absen masuk pertama per hari kerja terhadap jadwal karyawan (penugasan shift menggantikan jadwal bawaan). Hari libur dikecualikan.",
          "Based on the first check-in per workday against the employee's schedule (shift assignments override the default). Public holidays are excluded.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows && <TableTools view={table} />}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="employeeNumber">
                  {l("No.", "No.")}
                </SortTh>
                <SortTh view={table} col="employee">
                  {l("Karyawan", "Employee")}
                </SortTh>
                <SortTh view={table} col="occurrences" className="num">
                  {l("Kali terlambat", "Occurrences")}
                </SortTh>
                <SortTh view={table} col="minutes" className="num">
                  {l("Menit", "Minutes")}
                </SortTh>
                <SortTh view={table} col="penalty" className="num">
                  {l("Potongan", "Deduction")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
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
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {rows.length
                      ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                      : l("Tidak ada keterlambatan.", "No lateness.")}
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
