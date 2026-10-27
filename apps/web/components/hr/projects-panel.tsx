"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROJECT_STATUS_LABEL, TASK_STATUS_LABEL, type ProjectStatus, type TaskStatus } from "@erp/shared";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

export interface EmployeeProjects {
  projects: {
    id: string;
    code: string | null;
    name: string;
    status: ProjectStatus;
    startDate: string | null;
    endDate: string | null;
    url: string | null;
    app: string;
    role: string | null;
    allocation: string | null;
    isManager: boolean;
    hoursThisMonth: string;
    hoursTotal: string;
    openTasks: number;
  }[];
  activeProjects: number;
  openTasks: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: string;
    dueDate: string | null;
    url: string | null;
    projectId: string;
    projectName: string;
  }[];
  recentTimesheets: {
    id: string;
    date: string;
    hours: string;
    description: string | null;
    approved: boolean;
    projectName: string;
    taskTitle: string | null;
  }[];
  hoursThisMonth: string;
}

export const projectStatusPill = (s: ProjectStatus) =>
  s === "active" ? "ok" : s === "on_hold" ? "warn" : s === "cancelled" ? "bad" : "";

const hours = (v: string, locale: string) =>
  `${Number(v).toLocaleString(locale === "id" ? "id-ID" : "en", { maximumFractionDigits: 2 })} h`;

/**
 * Proyek dari aplikasi terhubung untuk satu karyawan (form karyawan) atau untuk diri sendiri (portal, `mine`).
 * Tautan detail ERP hanya untuk pengguna SDM; selain itu tautan ke aplikasi proyek.
 */
export function ProjectsPanel({ employeeId, mine = false }: { employeeId?: string; mine?: boolean }) {
  const { l, locale } = useI18n();
  const [data, setData] = useState<EmployeeProjects | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<EmployeeProjects>(mine ? "/me/projects" : `/employees/${employeeId}/projects`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [employeeId, mine]);

  if (error) return mine ? null : <p className="error">{error}</p>;
  if (!data) return <p className="muted">{l("Memuat…", "Loading…")}</p>;
  // Portal: sembunyikan bagian bila tidak ada proyek sama sekali.
  if (mine && !data.projects.length && !data.openTasks.length) return null;

  const projectLink = (p: { id: string; name: string; url?: string | null }) =>
    !mine ? (
      <Link href={`/hr/projects/${p.id}`}>{p.name}</Link>
    ) : p.url ? (
      <a href={p.url} target="_blank" rel="noreferrer">
        {p.name}
      </a>
    ) : (
      p.name
    );

  return (
    <section className="panel stack proj-panel">
      <h2>
        {mine ? l("Proyek saya", "My projects") : l("Proyek", "Projects")}{" "}
        <small className="muted">
          · {l("jam bulan ini", "hours this month")}: {hours(data.hoursThisMonth, locale)}
        </small>
      </h2>
      {data.projects.length === 0 ? (
        <p className="muted">
          {l("Belum ada proyek dari aplikasi terhubung.", "No projects from connected apps yet.")}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Proyek", "Project")}</th>
                <th>Status</th>
                <th>{l("Peran", "Role")}</th>
                <th className="num">{l("Alokasi", "Allocation")}</th>
                <th className="num">{l("Task terbuka", "Open tasks")}</th>
                <th className="num">{l("Jam bulan ini", "This month")}</th>
                <th className="num">{l("Total jam", "Total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    {projectLink(p)}
                    {p.code && <small className="muted"> · {p.code}</small>}
                    <br />
                    <small className="muted">
                      {p.app}
                      {p.endDate && ` · ${l("s.d.", "until")} ${formatDate(p.endDate, locale)}`}
                    </small>
                  </td>
                  <td>
                    <span className={`pill ${projectStatusPill(p.status)}`}>
                      {l(...PROJECT_STATUS_LABEL[p.status])}
                    </span>
                  </td>
                  <td>
                    {[p.isManager ? l("Manajer proyek", "Project manager") : null, p.role]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="num">{p.allocation ? `${Number(p.allocation)}%` : "—"}</td>
                  <td className="num">{p.openTasks}</td>
                  <td className="num">{hours(p.hoursThisMonth, locale)}</td>
                  <td className="num">{hours(p.hoursTotal, locale)}</td>
                  <td>
                    {p.url && !mine && (
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {l("Buka di aplikasi", "Open in app")} ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.openTasks.length > 0 && (
        <>
          <h3>{l("Task terbuka", "Open tasks")}</h3>
          <ul className="task-list">
            {data.openTasks.map((t) => (
              <li key={t.id}>
                <span className={`pill ${t.priority === "urgent" || t.priority === "high" ? "warn" : ""}`}>
                  {l(...TASK_STATUS_LABEL[t.status])}
                </span>{" "}
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer">
                    {t.title}
                  </a>
                ) : (
                  t.title
                )}{" "}
                <small className="muted">
                  · {t.projectName}
                  {t.dueDate && ` · ${l("tenggat", "due")} ${formatDate(t.dueDate, locale)}`}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.recentTimesheets.length > 0 && (
        <>
          <h3>{l("Timesheet terbaru", "Recent timesheets")}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Tanggal", "Date")}</th>
                  <th>{l("Proyek / task", "Project / task")}</th>
                  <th>{l("Keterangan", "Description")}</th>
                  <th className="num">{l("Jam", "Hours")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTimesheets.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.date, locale)}</td>
                    <td>
                      {t.projectName}
                      {t.taskTitle && <small className="muted"> · {t.taskTitle}</small>}
                    </td>
                    <td className="muted">{t.description ?? "—"}</td>
                    <td className="num">
                      {hours(t.hours, locale)}
                      {t.approved && " ✓"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
