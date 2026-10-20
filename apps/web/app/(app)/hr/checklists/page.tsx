"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  id: string;
  name: string;
  kind: string;
  employeeId: string;
  employeeName: string;
  baseDate: string;
  state: string;
  tasks: number;
  done: number;
  overdue: number;
}

/** Checklist onboarding/offboarding berjalan dengan progres & tugas lewat tenggat. */
export default function ChecklistsPage() {
  const { l, locale } = useI18n();
  const [state, setState] = useState("open");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Row[]>(`/hr-checklists${state ? `?state=${state}` : ""}`).then(setRows, (e) =>
      setError(errorText(e)),
    );
  }, [state]);
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Checklist Onboarding & Offboarding", "Onboarding & Offboarding")}</h1>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={l("Status", "Status")}>
          <option value="open">{l("Berjalan", "Open")}</option>
          <option value="done">{l("Selesai", "Done")}</option>
          <option value="">{l("Semua", "All")}</option>
        </select>
        <Link href="/hr/checklist-templates">{l("Template", "Templates")}</Link>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l("Karyawan", "Employee")}</th>
              <th>{l("Checklist", "Checklist")}</th>
              <th>{l("Jenis", "Kind")}</th>
              <th>{l("Tanggal acuan", "Base date")}</th>
              <th>{l("Progres", "Progress")}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/employees/${r.employeeId}`}>{r.employeeName}</Link>
                </td>
                <td>
                  <Link href={`/hr/checklists/${r.id}`}>{r.name}</Link>
                </td>
                <td>{r.kind === "onboarding" ? "Onboarding" : "Offboarding"}</td>
                <td>{formatDate(r.baseDate, locale)}</td>
                <td>
                  <progress max={r.tasks} value={r.done} /> {r.done}/{r.tasks}
                  {r.overdue > 0 && (
                    <span className="error">
                      {" "}
                      · {r.overdue} {l("lewat tenggat", "overdue")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {l("Tidak ada checklist.", "No checklists.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
