"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@erp/shared";
import { projectStatusPill } from "../../../../components/hr/projects-panel";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProjectRow[]>("/projects")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);
  const columns = useMemo<ViewColumn<ProjectRow>[]>(
    () => [
      {
        key: "name",
        label: l("Proyek", "Project"),
        value: (p) => p.name,
        text: (p) => `${p.name} ${p.code ?? ""} ${p.app}`,
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        value: (p) => p.status,
        optionLabel: (v) =>
          PROJECT_STATUS_LABEL[v as ProjectStatus] ? l(...PROJECT_STATUS_LABEL[v as ProjectStatus]) : v,
      },
      { key: "manager", label: l("Manajer", "Manager"), type: "enum", value: (p) => p.manager },
      { key: "startDate", label: l("Periode", "Period"), type: "date", value: (p) => p.startDate },
      { key: "members", label: l("Anggota", "Members"), type: "number", value: (p) => p.members },
      { key: "openTasks", label: l("Task terbuka", "Open tasks"), type: "number", value: (p) => p.openTasks },
      {
        key: "hoursThisMonth",
        label: l("Jam bulan ini", "Hours this month"),
        type: "number",
        value: (p) => Number(p.hoursThisMonth),
      },
      { key: "app", label: l("Aplikasi", "App"), type: "enum", value: (p) => p.app, hidden: true },
    ],
    [l],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "projects",
    initialFilters: { status: { kind: "enum", values: ["active"] } },
  });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Proyek", "Projects")}</h1>
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
        <TableTools view={table} placeholder={l("Cari nama / kode…", "Search name / code…")} />
      )}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortTh view={table} col="name">
                  {l("Proyek", "Project")}
                </SortTh>
                <SortTh view={table} col="status">
                  Status
                </SortTh>
                <SortTh view={table} col="manager">
                  {l("Manajer", "Manager")}
                </SortTh>
                <SortTh view={table} col="startDate">
                  {l("Periode", "Period")}
                </SortTh>
                <SortTh view={table} col="members" className="num">
                  {l("Anggota", "Members")}
                </SortTh>
                <SortTh view={table} col="openTasks" className="num">
                  {l("Task terbuka", "Open tasks")}
                </SortTh>
                <SortTh view={table} col="hoursThisMonth" className="num">
                  {l("Jam bulan ini", "Hours this month")}
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((p) => (
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
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > 0 && <TablePager view={table} />}
    </>
  );
}
