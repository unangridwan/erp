"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectStatus } from "@erp/shared";
import { projectStatusPill } from "../../../../components/hr/projects-panel";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface ProjectRow {
  id: string;
  code: string | null;
  name: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
  app: string;
  manager: string | null;
  members: number;
  openTasks: number;
  hoursThisMonth: string;
}

/** SDM › Proyek: proyek dari aplikasi terhubung (baca saja; dikelola di aplikasi proyek). */
export default function ProjectsPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      api<ProjectRow[]>(`/projects?${params}`)
        .then(setRows)
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [status, q]);

  return (
    <>
      <header className="toolbar">
        <h1>{l("Proyek", "Projects")}</h1>
        <input
          type="search"
          placeholder={l("Cari nama / kode…", "Search name / code…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">{l("Semua status", "All statuses")}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {l(...PROJECT_STATUS_LABEL[s])}
            </option>
          ))}
        </select>
      </header>
      <p className="muted">
        {l(
          "Data dikirim aplikasi proyek yang terhubung (Pengaturan › Aplikasi Terhubung); ubah proyek di aplikasi asal.",
          "Data is sent by connected project apps (Settings › Connected Apps); edit projects in the source app.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">{l("Tidak ada proyek.", "No projects.")}</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l("Proyek", "Project")}</th>
                <th>Status</th>
                <th>{l("Manajer", "Manager")}</th>
                <th>{l("Periode", "Period")}</th>
                <th className="num">{l("Anggota", "Members")}</th>
                <th className="num">{l("Task terbuka", "Open tasks")}</th>
                <th className="num">{l("Jam bulan ini", "Hours this month")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/hr/projects/${p.id}`}>{p.name}</Link>
                    {p.code && <small className="muted"> · {p.code}</small>}
                    <br />
                    <small className="muted">{p.app}</small>
                  </td>
                  <td>
                    <span className={`pill ${projectStatusPill(p.status)}`}>
                      {l(...PROJECT_STATUS_LABEL[p.status])}
                    </span>
                  </td>
                  <td>{p.manager ?? "—"}</td>
                  <td>
                    {p.startDate ? formatDate(p.startDate, locale) : "—"}
                    {p.endDate && ` – ${formatDate(p.endDate, locale)}`}
                  </td>
                  <td className="num">{p.members}</td>
                  <td className="num">{p.openTasks}</td>
                  <td className="num">
                    {Number(p.hoursThisMonth).toLocaleString(locale === "id" ? "id-ID" : "en")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
