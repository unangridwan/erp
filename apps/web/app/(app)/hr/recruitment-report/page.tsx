"use client";

import { EXIT_QUESTIONS } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "../../../../components/hr/hr-panels";
import { EXIT_REASON_LABEL, RESIGN_REASON_LABEL } from "../../../../components/hr/offboarding-panel";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { APPLICANT_STAGE_LABEL } from "../../../../lib/resources";

interface Report {
  openings: {
    id: string;
    name: string;
    quota: number;
    hired: number;
    applicants: number;
    filled: boolean;
    daysToFill: number | null;
    daysOpen: number | null;
  }[];
  avgTimeToFill: number | null;
  avgTimeToHire: number | null;
  funnel: { stage: string; count: number }[];
  sources: { key: string; count: number; hired: number }[];
  refuseReasons: { key: string; count: number }[];
}
interface ExitReport {
  leavers: number;
  reasons: { key: string; count: number }[];
  interviews: {
    count: number;
    scores: { key: string; average: number | null }[];
    reasons: { key: string; count: number }[];
    wouldRejoin: number | null;
    wouldRecommend: number | null;
  };
}

const SOURCE: Record<string, [string, string]> = {
  referral: ["Referensi", "Referral"],
  jobportal: ["Portal lowongan", "Job portal"],
  website: ["Situs perusahaan", "Website"],
  walkin: ["Datang langsung", "Walk-in"],
  other: ["Lainnya", "Other"],
};

/** Laporan rekrutmen (time-to-fill, time-to-hire, funnel, sumber, alasan tolak) & alasan karyawan keluar. */
export default function RecruitmentReportPage() {
  const { l, tx } = useI18n();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [r, setR] = useState<Report | null>(null);
  const [x, setX] = useState<ExitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = `from=${from}&to=${to}`;
    api<Report>(`/recruitment/reports?${q}`).then(setR, (e) => setError(errorText(e)));
    api<ExitReport>(`/hr/reports/exit-reasons?${q}`).then(setX, (e) => setError(errorText(e)));
  }, [from, to]);
  const days = (v: number | null) => (v === null ? "—" : `${v} ${l("hari", "days")}`);
  const max = Math.max(1, ...(r?.funnel.map((f) => f.count) ?? [1]));

  return (
    <div className="stack-wide">
      <section className="panel">
        <header className="toolbar">
          <h1>{l("Laporan Rekrutmen & Turnover", "Recruitment & Turnover Report")}</h1>
          <label className="field">
            <span>{l("Dari", "From")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>{l("Sampai", "To")}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </header>
        {error && <p className="error">{error}</p>}
        {r && (
          <>
            <ul className="grid">
              <li className="card">
                <span>{l("Rata-rata time-to-fill", "Avg. time to fill")}</span>
                <strong>{days(r.avgTimeToFill)}</strong>
              </li>
              <li className="card">
                <span>{l("Rata-rata time-to-hire", "Avg. time to hire")}</span>
                <strong>{days(r.avgTimeToHire)}</strong>
              </li>
              <li className="card">
                <span>{l("Lowongan", "Openings")}</span>
                <strong>{r.openings.length}</strong>
              </li>
              <li className="card">
                <span>{l("Karyawan keluar", "Leavers")}</span>
                <strong>{x?.leavers ?? "—"}</strong>
              </li>
            </ul>
            <div className="split">
              <section>
                <h2>{l("Funnel pelamar", "Applicant funnel")}</h2>
                <ul className="funnel">
                  {r.funnel.map((f) => (
                    <li key={f.stage}>
                      <span>{tx(APPLICANT_STAGE_LABEL[f.stage]!)}</span>
                      <span className="bar" style={{ width: `${(f.count / max) * 100}%` }} />
                      <strong>{f.count}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h2>{l("Sumber pelamar", "Applicant sources")}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>{l("Sumber", "Source")}</th>
                      <th className="num">{l("Pelamar", "Applicants")}</th>
                      <th className="num">{l("Diterima", "Hired")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.sources.map((s) => (
                      <tr key={s.key}>
                        <td>{SOURCE[s.key] ? l(...SOURCE[s.key]!) : s.key}</td>
                        <td className="num">{s.count}</td>
                        <td className="num">{s.hired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h2>{l("Alasan penolakan", "Refusal reasons")}</h2>
                <table>
                  <tbody>
                    {r.refuseReasons.map((s) => (
                      <tr key={s.key}>
                        <td>{s.key}</td>
                        <td className="num">{s.count}</td>
                      </tr>
                    ))}
                    {!r.refuseReasons.length && (
                      <tr>
                        <td className="muted">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </div>
            <h2>{l("Lowongan", "Openings")}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Lowongan", "Opening")}</th>
                    <th className="num">{l("Pelamar", "Applicants")}</th>
                    <th className="num">{l("Diterima / kuota", "Hired / quota")}</th>
                    <th className="num">{l("Time-to-fill", "Time to fill")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.openings.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/job-openings/${o.id}`}>{o.name}</Link>
                      </td>
                      <td className="num">{o.applicants}</td>
                      <td className="num">
                        {o.hired} / {o.quota}
                      </td>
                      <td className="num">
                        {o.filled
                          ? days(o.daysToFill)
                          : l(`terbuka ${o.daysOpen} hari`, `open ${o.daysOpen} days`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {x && (
        <section className="panel">
          <h2>{l("Alasan karyawan keluar", "Reasons for leaving")}</h2>
          <div className="split">
            <table>
              <tbody>
                {x.reasons.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {RESIGN_REASON_LABEL[r.key]
                        ? l(...RESIGN_REASON_LABEL[r.key]!)
                        : l("Belum diisi", "Not set")}
                    </td>
                    <td className="num">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <h3>
                {l("Exit interview", "Exit interviews")} ({x.interviews.count})
              </h3>
              <table>
                <tbody>
                  {x.interviews.reasons.map((r) => (
                    <tr key={r.key}>
                      <td>{EXIT_REASON_LABEL[r.key] ? l(...EXIT_REASON_LABEL[r.key]!) : r.key}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                  {EXIT_QUESTIONS.map((q) => {
                    const s = x.interviews.scores.find((v) => v.key === q.key);
                    return (
                      <tr key={q.key}>
                        <td className="muted">{l(q.label[0], q.label[1])}</td>
                        <td className="num">{s?.average ?? "—"} / 5</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="muted">{l("Mau bergabung kembali", "Would rejoin")}</td>
                    <td className="num">{x.interviews.wouldRejoin ?? "—"}%</td>
                  </tr>
                  <tr>
                    <td className="muted">{l("Merekomendasikan perusahaan", "Would recommend")}</td>
                    <td className="num">{x.interviews.wouldRecommend ?? "—"}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
