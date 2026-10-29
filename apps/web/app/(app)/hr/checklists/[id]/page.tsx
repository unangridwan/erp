"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../../../../components/hr/hr-panels";
import { api } from "../../../../../lib/api";
import { formatDate, today } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";

interface Checklist {
  id: string;
  name: string;
  kind: string;
  employeeId: string;
  employeeName: string;
  baseDate: string;
  state: string;
  tasks: {
    id: string;
    name: string;
    responsible: string;
    userName: string | null;
    dueDate: string;
    action: string | null;
    doneAt: string | null;
  }[];
}

const RESPONSIBLE: Record<string, [string, string]> = {
  hr: ["HR", "HR"],
  manager: ["Atasan", "Manager"],
  employee: ["Karyawan", "Employee"],
  it: ["IT", "IT"],
};

/** Tugas checklist: centang selesai, tenggat, penanggung jawab, tautan pesangon. */
export default function ChecklistPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [c, setC] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () => api<Checklist>(`/hr-checklists/${id}`).then(setC, (e) => setError(errorText(e))),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = (taskId: string, done: boolean) => {
    setError(null);
    api<Checklist>(`/hr-checklists/tasks/${taskId}`, { method: "POST", body: { done } }).then(setC, (e) =>
      setError(errorText(e)),
    );
  };
  if (!c) return <p className="muted">{error ?? l("Memuat…", "Loading…")}</p>;
  const now = today();
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>
          {c.name} — <Link href={`/employees/${c.employeeId}`}>{c.employeeName}</Link>
        </h1>
        <span className={`badge state-${c.state === "done" ? "sale" : "draft"}`}>
          {c.state === "done" ? l("Selesai", "Done") : l("Berjalan", "Open")}
        </span>
      </header>
      <p className="muted">
        {c.kind === "onboarding" ? l("Tanggal masuk", "Start date") : l("Tanggal keluar", "Leaving date")}:{" "}
        {formatDate(c.baseDate, locale)}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th />
              <th>{l("Tugas", "Task")}</th>
              <th>{l("Penanggung jawab", "Owner")}</th>
              <th>{l("Tenggat", "Due")}</th>
            </tr>
          </thead>
          <tbody>
            {c.tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t.name}
                    checked={Boolean(t.doneAt)}
                    onChange={(e) => {
                      if (
                        e.target.checked &&
                        t.action === "deactivate_user" &&
                        !confirm(
                          l(
                            "Akun login karyawan akan dinonaktifkan. Lanjutkan?",
                            "The employee's login will be deactivated. Continue?",
                          ),
                        )
                      )
                        return;
                      toggle(t.id, e.target.checked);
                    }}
                  />
                </td>
                <td>
                  {t.doneAt ? <s>{t.name}</s> : t.name}
                  {t.action === "severance" && (
                    <>
                      {" "}
                      <Link href={`/employees/${c.employeeId}`}>
                        {l("→ hitung pesangon", "→ compute severance")}
                      </Link>
                    </>
                  )}
                </td>
                <td>
                  {l(...RESPONSIBLE[t.responsible]!)}
                  {t.userName ? ` (${t.userName})` : ""}
                </td>
                <td className={!t.doneAt && t.dueDate < now ? "error" : undefined}>
                  {formatDate(t.dueDate, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
