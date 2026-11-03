"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { SortTh, TablePager, TableTools, type ViewColumn } from "../../../../components/data-table";
import { useTableView } from "../../../../lib/use-table-view";

interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  visibility: "private" | "shared";
  ownerName: string | null;
  mine: boolean;
  updatedAt: string;
}

/** Laporan › Pembuat Laporan: laporan tersimpan milik sendiri & yang dibagikan. */
export default function ReportsPage() {
  const { l, locale } = useI18n();
  const [rows, setRows] = useState<SavedReport[] | null>(null);
  const [datasets, setDatasets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SavedReport[]>("/saved-reports")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
    api<{ key: string; label: string }[]>("/reports/datasets")
      .then((d) => setDatasets(Object.fromEntries(d.map((x) => [x.key, x.label]))))
      .catch(() => undefined);
  }, []);

  const columns = useMemo<ViewColumn<SavedReport>[]>(
    () => [
      {
        key: "name",
        label: l("Laporan", "Report"),
        value: (r) => r.name,
        text: (r) => `${r.name} ${r.description ?? ""}`,
      },
      {
        key: "dataset",
        label: l("Data", "Data"),
        type: "enum",
        value: (r) => r.dataset,
        optionLabel: (v) => datasets[v] ?? v,
      },
      {
        key: "owner",
        label: l("Pemilik", "Owner"),
        type: "enum",
        value: (r) => (r.mine ? l("Saya", "Me") : r.ownerName),
      },
      { key: "updatedAt", label: l("Diubah", "Updated"), type: "date", value: (r) => r.updatedAt },
      {
        key: "visibility",
        label: l("Akses", "Visibility"),
        type: "enum",
        value: (r) => r.visibility,
        optionLabel: (v) => (v === "shared" ? l("Dibagikan", "Shared") : l("Pribadi", "Private")),
        hidden: true,
      },
    ],
    [l, datasets],
  );
  const table = useTableView(rows ?? [], columns, {
    storageKey: "saved-reports",
    defaultSort: { key: "updatedAt", dir: "desc" },
  });

  return (
    <>
      <header className="toolbar">
        <h1>{l("Pembuat Laporan", "Report Builder")}</h1>
        <Link className="button primary" href="/hr/reports/new">
          {l("Laporan baru", "New report")}
        </Link>
      </header>
      <p className="muted">
        {l(
          "Susun laporan sendiri dari data SDM & payroll: pilih kolom, filter, kelompokkan & jumlahkan, tampilkan grafik, simpan, lalu kirim otomatis lewat email sesuai jadwal.",
          "Build your own reports from HR & payroll data: choose columns, filter, group & total, chart, save, then email them on a schedule.",
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <section className="panel stack proj-panel">
        {!rows ? (
          <p className="muted">{l("Memuat…", "Loading…")}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{l("Belum ada laporan tersimpan.", "No saved reports yet.")}</p>
        ) : (
          <>
            <TableTools view={table} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortTh view={table} col="name">
                      {l("Laporan", "Report")}
                    </SortTh>
                    <SortTh view={table} col="dataset">
                      {l("Data", "Data")}
                    </SortTh>
                    <SortTh view={table} col="owner">
                      {l("Pemilik", "Owner")}
                    </SortTh>
                    <SortTh view={table} col="updatedAt">
                      {l("Diubah", "Updated")}
                    </SortTh>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/hr/reports/${r.id}`}>{r.name}</Link>{" "}
                        {r.visibility === "shared" && (
                          <span className="pill">{l("Dibagikan", "Shared")}</span>
                        )}
                        {r.description && (
                          <>
                            <br />
                            <small className="muted">{r.description}</small>
                          </>
                        )}
                      </td>
                      <td>{datasets[r.dataset] ?? r.dataset}</td>
                      <td>{r.mine ? l("Saya", "Me") : (r.ownerName ?? "—")}</td>
                      <td>{formatDate(r.updatedAt.slice(0, 10), locale)}</td>
                    </tr>
                  ))}
                  {table.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {l("Tidak ada data yang cocok dengan filter.", "No rows match the filters.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <TablePager view={table} />
          </>
        )}
      </section>
    </>
  );
}
