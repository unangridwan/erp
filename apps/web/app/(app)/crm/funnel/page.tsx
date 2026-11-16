"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";
import { LEAD_SOURCES } from "../../../../lib/resources";

interface Group {
  key: string | null;
  label: string | null;
  leads: number;
  opportunities: number;
  won: number;
  lost: number;
  winRate: number | null;
  wonAmount: string;
}
interface Funnel {
  steps: { key: string; count: number; rate: number | null; overall: number | null }[];
  unqualified: number;
  bySource: Group[];
  byUser: Group[];
}
interface Velocity {
  opportunities: number;
  stages: { stageId: string; stageName: string; opportunities: number; avgDays: number | null }[];
  won: number;
  lost: number;
  winRate: number | null;
  avgCycleDays: number | null;
  avgLostCycleDays: number | null;
  avgDealSize: string | null;
  velocityPerDay: string | null;
}

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const yearEnd = () => `${new Date().getFullYear()}-12-31`;

/** Corong lead → peluang → menang dan kecepatan pipeline (lama per tahap, siklus penjualan). */
export default function FunnelPage() {
  const { l, tx, locale } = useI18n();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(yearEnd());
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    Promise.all([
      api<Funnel>(`/leads/reports/funnel?from=${from}&to=${to}`),
      api<Velocity>(`/leads/reports/velocity?from=${from}&to=${to}`),
    ])
      .then(([f, v]) => {
        setFunnel(f);
        setVelocity(v);
      })
      .catch((e: Error) => setError(e.message));
  }, [from, to]);

  const stepLabel: Record<string, string> = {
    leads: l("Lead masuk", "Leads created"),
    contacted: l("Dihubungi", "Contacted"),
    qualified: l("Terkualifikasi", "Qualified"),
    opportunities: l("Jadi peluang", "Opportunities"),
    won: l("Menang", "Won"),
  };
  const max = Math.max(1, ...(funnel?.steps.map((s) => s.count) ?? []));
  const days = (n: number | null) => (n === null ? "—" : `${n.toLocaleString(locale)} ${l("hari", "days")}`);
  const sourceLabel = (s: string | null) => {
    const found = LEAD_SOURCES.find(([v]) => v === s);
    return found ? tx(found[1]) : l("(tanpa sumber)", "(no source)");
  };
  const groupTable = (title: string, rows: Group[], label: (g: Group) => string) => (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{title}</th>
                <th className="num">{l("Lead", "Leads")}</th>
                <th className="num">{l("Peluang", "Opportunities")}</th>
                <th className="num">{l("Menang", "Won")}</th>
                <th className="num">{l("Kalah", "Lost")}</th>
                <th className="num">{l("Rasio menang", "Win rate")}</th>
                <th className="num">{l("Nilai menang", "Won value")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key ?? "none"}>
                  <td>{label(g)}</td>
                  <td className="num">{g.leads}</td>
                  <td className="num">{g.opportunities}</td>
                  <td className="num">{g.won}</td>
                  <td className="num">{g.lost}</td>
                  <td className="num">{g.winRate === null ? "—" : `${g.winRate}%`}</td>
                  <td className="num">{money(g.wonAmount, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Corong & Kecepatan Pipeline", "Funnel & Pipeline Velocity")}</h1>
        <label className="field">
          <span>{l("Dari", "From")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>{l("sampai", "to")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {funnel && velocity && (
        <>
          <ul className="grid">
            <li className="card">
              <span>{l("Rasio menang", "Win rate")}</span>
              <strong>{velocity.winRate === null ? "—" : `${velocity.winRate}%`}</strong>
            </li>
            <li className="card">
              <span>{l("Siklus penjualan rata-rata", "Average sales cycle")}</span>
              <strong>{days(velocity.avgCycleDays)}</strong>
            </li>
            <li className="card">
              <span>{l("Nilai rata-rata per menang", "Average deal size")}</span>
              <strong>{velocity.avgDealSize ? money(velocity.avgDealSize, locale) : "—"}</strong>
            </li>
            <li className="card">
              <span>{l("Kecepatan pipeline / hari", "Pipeline velocity / day")}</span>
              <strong>{velocity.velocityPerDay ? money(velocity.velocityPerDay, locale) : "—"}</strong>
            </li>
          </ul>
          <div className="grid-2">
            <section className="panel">
              <h2>{l("Corong konversi", "Conversion funnel")}</h2>
              <ul className="funnel crm-funnel">
                {funnel.steps.map((s) => (
                  <li key={s.key}>
                    <span>{stepLabel[s.key]}</span>
                    <span className="bar" style={{ width: `${(s.count / max) * 100}%` }} />
                    <strong>{s.count}</strong>
                    <small className="muted">{s.rate === null ? "" : `${s.rate}%`}</small>
                  </li>
                ))}
              </ul>
              <p className="muted">
                {l(
                  "Persentase = konversi dari langkah sebelumnya, untuk lead yang dibuat pada periode.",
                  "Percentage = conversion from the previous step, for leads created in the period.",
                )}{" "}
                {l("Lead tidak layak", "Unqualified leads")}: {funnel.unqualified}
              </p>
            </section>
            <section className="panel">
              <h2>{l("Rata-rata lama di tiap tahap", "Average time in each stage")}</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Tahap", "Stage")}</th>
                      <th className="num">{l("Peluang", "Opportunities")}</th>
                      <th className="num">{l("Rata-rata", "Average")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {velocity.stages.map((s) => (
                      <tr key={s.stageId}>
                        <td>{s.stageName}</td>
                        <td className="num">{s.opportunities}</td>
                        <td className="num">{days(s.avgDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                {l("Menang", "Won")}: {velocity.won} · {l("Kalah", "Lost")}: {velocity.lost} ·{" "}
                {l("Siklus peluang kalah", "Lost cycle")}: {days(velocity.avgLostCycleDays)}
              </p>
            </section>
          </div>
          {groupTable(l("Sumber", "Source"), funnel.bySource, (g) => sourceLabel(g.key))}
          {groupTable(
            l("Salesperson", "Salesperson"),
            funnel.byUser,
            (g) => g.label ?? l("(belum ditugaskan)", "(unassigned)"),
          )}
        </>
      )}
    </>
  );
}
