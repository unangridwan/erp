"use client";

import { useEffect, useMemo, useState } from "react";
import { useOptions } from "../../../../components/accounting/use-options";
import { api } from "../../../../lib/api";
import { today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  id: string;
  employeeId: string;
  employeeName: string;
  checkIn: string;
  checkOut: string | null;
  workedHours: string | null;
  source: string;
}

/** Rekap absensi: daftar masuk/pulang dan total jam per karyawan. */
export default function AttendancePage() {
  const { l, locale } = useI18n();
  const employees = useOptions<{ id: string; name: string }>("/employees");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ from, to });
    if (employeeId) params.set("employeeId", employeeId);
    api<Row[]>(`/attendance?${params}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [from, to, employeeId]);

  const summary = useMemo(() => {
    const map = new Map<string, { name: string; days: Set<string>; hours: number }>();
    for (const r of rows ?? []) {
      const s = map.get(r.employeeId) ?? { name: r.employeeName, days: new Set<string>(), hours: 0 };
      s.days.add(r.checkIn.slice(0, 10));
      s.hours += Number(r.workedHours ?? 0);
      map.set(r.employeeId, s);
    }
    return [...map.values()];
  }, [rows]);
  const time = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(v))
      : "—";

  return (
    <>
      <header className="toolbar">
        <h1>{l("Absensi", "Attendance")}</h1>
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
      {error && <p className="error">{error}</p>}
      {summary.length > 0 && (
        <ul className="grid">
          {summary.map((s) => (
            <li key={s.name} className="card">
              <span>{s.name}</span>
              <strong>
                {s.days.size} {l("hari", "days")} · {s.hours.toFixed(1)} {l("jam", "hours")}
              </strong>
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Karyawan", "Employee")}</th>
                <th>{l("Masuk", "Check in")}</th>
                <th>{l("Pulang", "Check out")}</th>
                <th className="num">{l("Jam kerja", "Worked hours")}</th>
                <th>{l("Sumber", "Source")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employeeName}</td>
                  <td>{time(r.checkIn)}</td>
                  <td>{time(r.checkOut)}</td>
                  <td className="num">{r.workedHours ?? ""}</td>
                  <td>{r.source === "web" ? "Web" : l("Manual", "Manual")}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {l("Belum ada absensi pada periode ini.", "No attendance in this period.")}
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
