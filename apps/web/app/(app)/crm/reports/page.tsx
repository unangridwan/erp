"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { money } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Pipeline {
  stages: {
    stageId: string | null;
    stageName: string | null;
    count: number;
    expected: string;
    weighted: string;
  }[];
  won: { count: number; amount: string };
  lost: { count: number; amount: string };
  winRate: string | null;
  lostByReason: { reason: string | null; count: number }[];
}

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const yearEnd = () => `${new Date().getFullYear()}-12-31`;

/** Ringkasan pipeline per tahap serta statistik menang/kalah pada periode. */
export default function PipelineReportPage() {
  const { l, locale } = useI18n();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(yearEnd());
  const [data, setData] = useState<Pipeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Pipeline>(`/leads/pipeline?from=${from}&to=${to}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);

  const totals = data?.stages.reduce(
    (s, r) => ({
      count: s.count + r.count,
      expected: s.expected + Number(r.expected),
      weighted: s.weighted + Number(r.weighted),
    }),
    { count: 0, expected: 0, weighted: 0 },
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Analisis Pipeline", "Pipeline Analysis")}</h1>
        <label className="field">
          <span>{l("Ditutup dari", "Closed from")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>{l("sampai", "to")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {data && totals && (
        <>
          <ul className="grid">
            <li className="card">
              <span>{l("Peluang terbuka", "Open opportunities")}</span>
              <strong>{totals.count}</strong>
            </li>
            <li className="card">
              <span>{l("Nilai tertimbang", "Weighted pipeline")}</span>
              <strong>{money(totals.weighted, locale)}</strong>
            </li>
            <li className="card">
              <span>{l("Menang (periode)", "Won (period)")}</span>
              <strong>
                {data.won.count} · {money(data.won.amount, locale)}
              </strong>
            </li>
            <li className="card">
              <span>{l("Rasio menang", "Win rate")}</span>
              <strong>{data.winRate === null ? "—" : `${data.winRate}%`}</strong>
            </li>
          </ul>
          <section className="panel">
            <h2>{l("Pipeline per tahap", "Pipeline by stage")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{l("Tahap", "Stage")}</th>
                  <th className="num">{l("Jumlah", "Count")}</th>
                  <th className="num">{l("Pendapatan harapan", "Expected revenue")}</th>
                  <th className="num">{l("Tertimbang", "Weighted")}</th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map((s) => (
                  <tr key={s.stageId ?? "none"}>
                    <td>{s.stageName ?? l("(tanpa tahap)", "(no stage)")}</td>
                    <td className="num">{s.count}</td>
                    <td className="num">{money(s.expected, locale)}</td>
                    <td className="num">{money(s.weighted, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{l("Total", "Total")}</th>
                  <th className="num">{totals.count}</th>
                  <th className="num">{money(totals.expected, locale)}</th>
                  <th className="num">{money(totals.weighted, locale)}</th>
                </tr>
              </tfoot>
            </table>
          </section>
          <section className="panel">
            <h2>
              {l("Alasan kalah", "Lost reasons")} ({data.lost.count})
            </h2>
            {data.lostByReason.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              <table>
                <tbody>
                  {data.lostByReason.map((r) => (
                    <tr key={r.reason ?? "none"}>
                      <td>{r.reason ?? l("(tanpa alasan)", "(no reason)")}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}
