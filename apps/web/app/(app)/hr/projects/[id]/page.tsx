"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  isOpenTask,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type ProjectStatus,
  type TaskStatus,
} from "@erp/shared";
import { projectStatusPill } from "../../../../../components/hr/projects-panel";
import { api } from "../../../../../lib/api";
import { formatDate } from "../../../../../lib/format";
import { useI18n } from "../../../../../lib/i18n";

interface Project {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
  app: string;
  managerId: string | null;
  manager: string | null;
  updatedAt: string;
  members: {
    employeeId: string;
    name: string;
    employeeNumber: string;
    role: string | null;
    allocation: string | null;
    hoursThisMonth: string;
    hoursTotal: string;
  }[];
  tasks: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: string;
    dueDate: string | null;
    url: string | null;
    assigneeId: string | null;
    assignee: string | null;
  }[];
  monthlyHours: { month: string; hours: string }[];
}

/** Detail proyek dari aplikasi terhubung: anggota & jam, task, jam per bulan. */
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { l, locale } = useI18n();
  const [p, setP] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) =>
    Number(v).toLocaleString(locale === "id" ? "id-ID" : "en", { maximumFractionDigits: 2 });

  useEffect(() => {
    api<Project>(`/projects/${id}`)
      .then(setP)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (!p) return <p className={error ? "error" : "muted"}>{error ?? l("Memuat…", "Loading…")}</p>;
  const open = p.tasks.filter((t) => isOpenTask(t.status)).length;

  return (
    <>
      <header className="toolbar">
        <nav className="breadcrumb">
          <Link href="/hr/projects">{l("Proyek", "Projects")}</Link>
          <span>/</span>
          <h1>{p.name}</h1>
        </nav>
        {p.url && (
          <a className="button" href={p.url} target="_blank" rel="noreferrer">
            {l(`Buka di ${p.app}`, `Open in ${p.app}`)} ↗
          </a>
        )}
      </header>

      <section className="panel stack proj-panel">
        <div className="o-grid">
          <div>
            <p>
              <span className={`pill ${projectStatusPill(p.status)}`}>
                {l(...PROJECT_STATUS_LABEL[p.status])}
              </span>
              {p.code && <span className="muted"> · {p.code}</span>}
            </p>
            {p.description && <p>{p.description}</p>}
          </div>
          <dl className="o-dl">
            <dt>{l("Manajer", "Manager")}</dt>
            <dd>{p.managerId ? <Link href={`/employees/${p.managerId}`}>{p.manager}</Link> : "—"}</dd>
            <dt>{l("Periode", "Period")}</dt>
            <dd>
              {p.startDate ? formatDate(p.startDate, locale) : "—"} –{" "}
              {p.endDate ? formatDate(p.endDate, locale) : l("berjalan", "ongoing")}
            </dd>
            <dt>{l("Sumber", "Source")}</dt>
            <dd>{p.app}</dd>
          </dl>
        </div>
      </section>

      <section className="panel stack proj-panel">
        <h2>
          {l("Anggota", "Members")} <small className="muted">({p.members.length})</small>
        </h2>
        {p.members.length === 0 ? (
          <p className="muted">{l("Belum ada anggota.", "No members yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Karyawan", "Employee")}</th>
                  <th>{l("Peran", "Role")}</th>
                  <th className="num">{l("Alokasi", "Allocation")}</th>
                  <th className="num">{l("Jam bulan ini", "This month")}</th>
                  <th className="num">{l("Total jam", "Total")}</th>
                </tr>
              </thead>
              <tbody>
                {p.members.map((m) => (
                  <tr key={m.employeeId}>
                    <td>
                      <Link href={`/employees/${m.employeeId}`}>{m.name}</Link>{" "}
                      <small className="muted">{m.employeeNumber}</small>
                    </td>
                    <td>{m.role ?? "—"}</td>
                    <td className="num">{m.allocation ? `${Number(m.allocation)}%` : "—"}</td>
                    <td className="num">{num(m.hoursThisMonth)}</td>
                    <td className="num">{num(m.hoursTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel stack proj-panel">
        <h2>
          Task{" "}
          <small className="muted">
            ({open} {l("terbuka", "open")} / {p.tasks.length})
          </small>
        </h2>
        {p.tasks.length === 0 ? (
          <p className="muted">{l("Belum ada task.", "No tasks yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>{l("Penanggung jawab", "Assignee")}</th>
                  <th>{l("Tenggat", "Due")}</th>
                </tr>
              </thead>
              <tbody>
                {p.tasks.map((t) => (
                  <tr key={t.id} className={isOpenTask(t.status) ? "" : "muted"}>
                    <td>
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer">
                          {t.title}
                        </a>
                      ) : (
                        t.title
                      )}
                      {(t.priority === "high" || t.priority === "urgent") && (
                        <span className="pill warn" style={{ marginLeft: 6 }}>
                          {" "}
                          {t.priority === "urgent" ? l("Mendesak", "Urgent") : l("Tinggi", "High")}
                        </span>
                      )}
                    </td>
                    <td>{l(...TASK_STATUS_LABEL[t.status])}</td>
                    <td>
                      {t.assigneeId ? <Link href={`/employees/${t.assigneeId}`}>{t.assignee}</Link> : "—"}
                    </td>
                    <td>{t.dueDate ? formatDate(t.dueDate, locale) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {p.monthlyHours.length > 0 && (
        <section className="panel stack proj-panel">
          <h2>{l("Jam timesheet per bulan", "Timesheet hours per month")}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {p.monthlyHours.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td className="num">{num(m.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
