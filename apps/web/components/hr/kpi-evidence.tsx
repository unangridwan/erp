"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, money } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

interface Evidence {
  title: string;
  goals: {
    id: string;
    title: string;
    kpi: { code: string; label: [string, string]; unit: string } | null;
    metric: string;
    targetValue: number;
    currentValue: number;
    progress: number;
    expected: number;
    rag: "green" | "amber" | "red";
  }[];
  kpis: {
    code: string;
    label: [string, string];
    area: [string, string];
    unit: "money" | "count" | "percent" | "days";
    value: number | null;
    previous: number | null;
    change: number | null;
  }[];
  flow: { held?: { count: number; late: number } };
}

/**
 * Bukti kinerja otomatis untuk penilaian: sasaran ber-KPI karyawan (nilai, target, status laju) dan KPI dari dokumen
 * yang dipegangnya selama periode siklus. Hanya baca — skor tetap diisi penilai.
 */
export function KpiEvidence({ employeeId, from, to }: { employeeId: string; from: string; to: string }) {
  const { l, locale } = useI18n();
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Evidence>(`/scorecard?scope=employee&id=${employeeId}&from=${from}&to=${to}`).then(
      setData,
      (e: Error) => setError(e.message),
    );
  }, [employeeId, from, to]);
  const n = (v: number) =>
    v.toLocaleString(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 1 });
  const fmt = (unit: string, v: number | null) =>
    v === null
      ? "—"
      : unit === "money" || unit === "currency"
        ? money(v, locale, 0)
        : unit === "percent"
          ? `${n(v)}%`
          : unit === "days"
            ? l(`${n(v)} hari`, `${n(v)} days`)
            : n(v);
  const RAG: Record<string, [string, string, string]> = {
    green: ["ok", "Sesuai laju", "On pace"],
    amber: ["warn", "Sedikit tertinggal", "Slightly behind"],
    red: ["danger", "Tertinggal", "Behind"],
  };
  return (
    <section
      className="panel kpi-evidence"
      aria-label={l("Bukti kinerja otomatis", "Automatic performance evidence")}
    >
      <h2>{l("Bukti kinerja otomatis", "Automatic performance evidence")}</h2>
      <p className="muted small">
        {l(
          `Dihitung dari data transaksi ${formatDate(from, locale)} – ${formatDate(to, locale)}. Gunakan sebagai bahan pertimbangan; skor tetap diisi penilai.`,
          `Computed from transaction data ${formatDate(from, locale)} – ${formatDate(to, locale)}. Use it as input; scores are still entered by the reviewer.`,
        )}
      </p>
      {error && <p className="muted small">{error}</p>}
      {!data && !error && <p className="muted">{l("Memuat…", "Loading…")}</p>}
      {data && (
        <>
          {data.goals.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Sasaran", "Goal")}</th>
                    <th className="num">{l("Capaian", "Actual")}</th>
                    <th className="num">{l("Target", "Target")}</th>
                    <th className="num">{l("Progres", "Progress")}</th>
                    <th>{l("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.goals.map((g) => {
                    const unit = g.kpi?.unit ?? g.metric;
                    const [tone, id, en] = RAG[g.rag]!;
                    return (
                      <tr key={g.id}>
                        <td>
                          {g.title}
                          {g.kpi && <div className="muted small">KPI: {l(...g.kpi.label)}</div>}
                        </td>
                        <td className="num">{fmt(unit, g.currentValue)}</td>
                        <td className="num">{fmt(unit, g.targetValue)}</td>
                        <td className="num">
                          {n(g.progress)}%
                          <div className="muted small">
                            {l(`seharusnya ${n(g.expected)}%`, `expected ${n(g.expected)}%`)}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${tone}`}>{l(id, en)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.kpis.length > 0 ? (
            <ul className="kpi-evidence-list">
              {data.kpis.map((k) => (
                <li key={k.code}>
                  <span className="muted small">{l(...k.area)}</span>
                  <strong>{l(...k.label)}</strong>
                  <span>
                    {fmt(k.unit, k.value)}
                    {k.change !== null && (
                      <span className="muted small">
                        {" "}
                        ({k.change > 0 ? "+" : ""}
                        {n(k.change)}% {l("vs periode lalu", "vs previous")})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            !data.goals.length && (
              <p className="muted">
                {l(
                  "Belum ada sasaran ber-KPI atau data transaksi untuk karyawan ini pada periode siklus.",
                  "No KPI goals or transaction data for this employee in the cycle period.",
                )}
              </p>
            )
          )}
          {data.flow.held && data.flow.held.count > 0 && (
            <p className="muted small">
              {l(
                `Dokumen alur bisnis yang sedang dipegang: ${data.flow.held.count} (${data.flow.held.late} terlambat).`,
                `Business-flow documents currently held: ${data.flow.held.count} (${data.flow.held.late} late).`,
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
