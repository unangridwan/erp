"use client";

import { TICKET_CHANNEL_LABEL, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "@erp/shared";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Stats {
  total: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  firstResponseCompliance: number | null;
  resolutionCompliance: number | null;
  avgSatisfaction: number | null;
  rated: number;
}
interface Group extends Stats {
  key: string | null;
  label: string | null;
  open: number;
}
interface Report {
  summary: Stats & { open: number; breachedOpen: number };
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byChannel: Record<string, number>;
  byAgent: Group[];
  byTeam: Group[];
  byCategory: Group[];
}

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Laporan layanan: volume, waktu respons & penyelesaian, kepatuhan SLA, kepuasan, per agen/antrean/kategori. */
export default function SupportReportsPage() {
  const { l } = useI18n();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Report>(`/support/reports?from=${from}&to=${to}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);

  const h = (v: number | null) => (v === null ? "—" : `${v} ${l("jam", "h")}`);
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  const counts = (title: string, map: Record<string, number>, labels: Record<string, [string, string]>) => (
    <section className="panel">
      <h2>{title}</h2>
      <table>
        <tbody>
          {Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <tr key={k}>
                <td>{labels[k] ? l(...labels[k]!) : k}</td>
                <td className="num">{n}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
  const groups = (title: string, rows: Group[], empty: string) => (
    <section className="panel">
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{title}</th>
              <th className="num">{l("Tiket", "Tickets")}</th>
              <th className="num">{l("Terbuka", "Open")}</th>
              <th className="num">{l("Respons rata-rata", "Avg response")}</th>
              <th className="num">{l("Selesai rata-rata", "Avg resolution")}</th>
              <th className="num">{l("SLA respons", "Response SLA")}</th>
              <th className="num">{l("SLA selesai", "Resolution SLA")}</th>
              <th className="num">{l("Kepuasan", "CSAT")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key ?? "none"}>
                <td>{g.label ?? empty}</td>
                <td className="num">{g.total}</td>
                <td className="num">{g.open}</td>
                <td className="num">{h(g.avgFirstResponseHours)}</td>
                <td className="num">{h(g.avgResolutionHours)}</td>
                <td className="num">{pct(g.firstResponseCompliance)}</td>
                <td className="num">{pct(g.resolutionCompliance)}</td>
                <td className="num">{g.avgSatisfaction === null ? "—" : `${g.avgSatisfaction} / 5`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Laporan Layanan", "Service Reporting")}</h1>
        <label className="field">
          <span>{l("Dibuat dari", "Created from")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>{l("sampai", "to")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <ul className="grid">
            <li className="card">
              <span>{l("Tiket", "Tickets")}</span>
              <strong>{data.summary.total}</strong>
              <small className="muted">
                {data.summary.open} {l("terbuka", "open")} · {data.summary.breachedOpen}{" "}
                {l("lewat SLA", "breached")}
              </small>
            </li>
            <li className="card">
              <span>{l("Respons pertama rata-rata", "Avg first response")}</span>
              <strong>{h(data.summary.avgFirstResponseHours)}</strong>
              <small className="muted">SLA {pct(data.summary.firstResponseCompliance)}</small>
            </li>
            <li className="card">
              <span>{l("Penyelesaian rata-rata", "Avg resolution")}</span>
              <strong>{h(data.summary.avgResolutionHours)}</strong>
              <small className="muted">SLA {pct(data.summary.resolutionCompliance)}</small>
            </li>
            <li className="card">
              <span>{l("Kepuasan pelanggan", "Customer satisfaction")}</span>
              <strong>
                {data.summary.avgSatisfaction === null ? "—" : `${data.summary.avgSatisfaction} / 5`}
              </strong>
              <small className="muted">
                {data.summary.rated} {l("penilaian", "ratings")}
              </small>
            </li>
          </ul>
          {groups(l("Agen", "Agent"), data.byAgent, l("(belum ditugaskan)", "(unassigned)"))}
          {groups(l("Antrean", "Queue"), data.byTeam, l("(tanpa antrean)", "(no queue)"))}
          {groups(l("Kategori", "Category"), data.byCategory, l("(tanpa kategori)", "(no category)"))}
          <div className="grid-2">
            {counts(l("Per status", "By status"), data.byStatus, TICKET_STATUS_LABEL)}
            {counts(l("Per prioritas", "By priority"), data.byPriority, TICKET_PRIORITY_LABEL)}
            {counts(l("Per kanal", "By channel"), data.byChannel, TICKET_CHANNEL_LABEL)}
          </div>
        </>
      )}
    </>
  );
}
