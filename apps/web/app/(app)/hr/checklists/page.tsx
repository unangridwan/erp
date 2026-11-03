"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Row[]>("/hr-checklists").then(setRows, (e) => setError(errorText(e)));
  }, []);
  const columns = useMemo<ViewColumn<Row>[]>(
    () => [
      { key: "employee", label: l("Karyawan", "Employee"), value: (r) => r.employeeName },
      { key: "name", label: l("Checklist", "Checklist"), value: (r) => r.name },
      {
        key: "kind",
        label: l("Jenis", "Kind"),
        type: "enum",
        value: (r) => r.kind,
        text: (r) => (r.kind === "onboarding" ? "Onboarding" : "Offboarding"),
      },
      { key: "baseDate", label: l("Tanggal acuan", "Base date"), type: "date", value: (r) => r.baseDate },
      {
        key: "progress",
        label: l("Progres", "Progress"),
        type: "number",
        value: (r) => (r.tasks ? Math.round((r.done / r.tasks) * 100) : 0),
        searchable: false,
      },
      {
        key: "state",
        label: l("Status", "Status"),
        type: "enum",
        value: (r) => r.state,
        optionLabel: (v) => (v === "open" ? l("Berjalan", "Open") : v === "done" ? l("Selesai", "Done") : v),
        text: (r) =>
          r.state === "open" ? l("Berjalan", "Open") : r.state === "done" ? l("Selesai", "Done") : r.state,
      },
      {
        key: "overdue",
        label: l("Lewat tenggat", "Overdue"),
        type: "enum",
        value: (r) => (r.overdue > 0 ? "1" : "0"),
        text: (r) =>
          r.overdue > 0 ? l("Ada yang lewat tenggat", "Has overdue tasks") : l("Tepat waktu", "On time"),
      },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "hr-checklists",
    defaultSort: { key: "baseDate", dir: "desc" },
    initialFilters: { state: { kind: "enum", values: ["open"] } },
  });
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Checklist Onboarding & Offboarding", "Onboarding & Offboarding")}</h1>
        <Link href="/hr/checklist-templates">{l("Template", "Templates")}</Link>
      </header>
      {error && <p className="error">{error}</p>}
      <TableTools view={table} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortTh view={table} col="employee">
                {l("Karyawan", "Employee")}
              </SortTh>
              <SortTh view={table} col="name">
                {l("Checklist", "Checklist")}
              </SortTh>
              <SortTh view={table} col="kind">
                {l("Jenis", "Kind")}
              </SortTh>
              <SortTh view={table} col="baseDate">
                {l("Tanggal acuan", "Base date")}
              </SortTh>
              <SortTh view={table} col="progress">
                {l("Progres", "Progress")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
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
            {rows && table.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {rows.length
                    ? l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")
                    : l("Tidak ada checklist.", "No checklists.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePager view={table} />
    </div>
  );
}
