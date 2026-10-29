"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l("Laporan", "Report")}</th>
                  <th>{l("Data", "Data")}</th>
                  <th>{l("Pemilik", "Owner")}</th>
                  <th>{l("Diubah", "Updated")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/hr/reports/${r.id}`}>{r.name}</Link>{" "}
                      {r.visibility === "shared" && <span className="pill">{l("Dibagikan", "Shared")}</span>}
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
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
