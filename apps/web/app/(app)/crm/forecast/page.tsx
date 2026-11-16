"use client";

import { periodOf } from "@erp/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "../../../../components/feedback";
import { api } from "../../../../lib/api";
import { money, today } from "../../../../lib/format";
import { useI18n } from "../../../../lib/i18n";

interface Row {
  userId: string | null;
  userName?: string | null;
  closed: string;
  commit: string;
  bestCase: string;
  pipeline: string;
  weighted: string;
  commitForecast: string;
  bestCaseForecast: string;
  quota: string | null;
  adjusted: string | null;
  attainment: number | null;
  gap: string | null;
  count: number;
}
interface Forecast {
  period: { key: string; type: "month" | "quarter"; start: string; end: string; months: string[] };
  rows: Row[];
  teams: (Row & { teamId: string; teamName: string })[];
  total: Row;
  undated: { count: number; amount: string };
  adjustable: "all" | string[];
}

/** Daftar pilihan periode: 6 bulan dan 4 kuartal di sekitar hari ini. */
function periodOptions(type: "month" | "quarter") {
  const now = new Date(`${today()}T00:00:00Z`);
  const out: string[] = [];
  const step = type === "month" ? 1 : 3;
  for (let i = -2; i <= (type === "month" ? 5 : 3); i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i * step, 1));
    out.push(periodOf(d.toISOString().slice(0, 10), type));
  }
  return [...new Set(out)];
}

/** Forecast penjualan per salesperson, tim, dan perusahaan dibanding kuota. */
export default function ForecastPage() {
  const { l, locale } = useI18n();
  const [type, setType] = useState<"month" | "quarter">("month");
  const [period, setPeriod] = useState(periodOf(today(), "month"));
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [edit, setEdit] = useState<{ userId: string; amount: string; note: string } | null>(null);

  useEffect(() => {
    setError(null);
    api<Forecast>(`/crm/forecast?period=${period}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [period, version]);

  const m = (v: string | null) => (v === null ? "—" : money(v, locale, 0));
  const canAdjust = (userId: string | null) =>
    !!data &&
    data.period.type === "month" &&
    !!userId &&
    (data.adjustable === "all" || data.adjustable.includes(userId));

  async function saveAdjustment() {
    if (!edit || !data) return;
    try {
      await api("/crm/forecast/adjustments", {
        method: "PUT",
        body: {
          userId: edit.userId,
          month: data.period.key,
          amount: edit.amount.trim() === "" ? null : edit.amount.trim(),
          note: edit.note || null,
        },
      });
      toast.success(l("Forecast manajer tersimpan", "Manager forecast saved"));
      setEdit(null);
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const cells = (r: Row) => (
    <>
      <td className="num">{m(r.quota)}</td>
      <td className="num">{m(r.closed)}</td>
      <td className="num">{m(r.commit)}</td>
      <td className="num">{m(r.bestCase)}</td>
      <td className="num">{m(r.pipeline)}</td>
      <td className="num">
        <strong>{m(r.commitForecast)}</strong>
      </td>
      <td className="num">{m(r.bestCaseForecast)}</td>
      <td className="num">
        {r.attainment === null ? (
          "—"
        ) : (
          <span className={`badge ${r.attainment >= 100 ? "state-won" : ""}`}>{r.attainment}%</span>
        )}
      </td>
      <td className="num">{m(r.gap)}</td>
    </>
  );

  return (
    <>
      <header className="toolbar">
        <h1>{l("Forecast Penjualan", "Sales Forecast")}</h1>
        <label className="field">
          <span>{l("Jenis periode", "Period type")}</span>
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value as "month" | "quarter";
              setType(t);
              setPeriod(periodOf(today(), t));
              setEdit(null);
            }}
          >
            <option value="month">{l("Bulan", "Month")}</option>
            <option value="quarter">{l("Kuartal", "Quarter")}</option>
          </select>
        </label>
        <label className="field">
          <span>{l("Periode", "Period")}</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periodOptions(type).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <ul className="grid">
            <li className="card">
              <span>{l("Kuota", "Quota")}</span>
              <strong>{m(data.total.quota)}</strong>
            </li>
            <li className="card">
              <span>{l("Closed (menang)", "Closed (won)")}</span>
              <strong>{m(data.total.closed)}</strong>
              {data.total.attainment !== null && (
                <small className="muted">
                  {data.total.attainment}% {l("dari kuota", "of quota")}
                </small>
              )}
            </li>
            <li className="card">
              <span>{l("Forecast commit", "Commit forecast")}</span>
              <strong>{m(data.total.commitForecast)}</strong>
            </li>
            <li className="card">
              <span>{l("Forecast best case", "Best-case forecast")}</span>
              <strong>{m(data.total.bestCaseForecast)}</strong>
            </li>
            <li className="card">
              <span>{l("Pipeline tertimbang", "Weighted pipeline")}</span>
              <strong>{m(data.total.weighted)}</strong>
            </li>
          </ul>
          {data.undated.count > 0 && (
            <p className="notice">
              {l(
                `${data.undated.count} peluang terbuka senilai ${money(data.undated.amount, locale, 0)} belum punya perkiraan closing, jadi tidak masuk forecast periode mana pun.`,
                `${data.undated.count} open opportunities worth ${money(data.undated.amount, locale, 0)} have no expected closing date, so they are not in any period's forecast.`,
              )}{" "}
              <Link href="/crm/opportunities">{l("Lihat peluang", "View opportunities")}</Link>
            </p>
          )}
          <section className="panel">
            <h2>{l("Per salesperson", "By salesperson")}</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{l("Salesperson", "Salesperson")}</th>
                    <th className="num">{l("Kuota", "Quota")}</th>
                    <th className="num">Closed</th>
                    <th className="num">Commit</th>
                    <th className="num">Best case</th>
                    <th className="num">Pipeline</th>
                    <th className="num">{l("Forecast commit", "Commit forecast")}</th>
                    <th className="num">{l("Forecast best case", "Best-case forecast")}</th>
                    <th className="num">{l("Pencapaian", "Attainment")}</th>
                    <th className="num">{l("Kurang dari kuota", "Gap to quota")}</th>
                    <th className="num">{l("Forecast manajer", "Manager forecast")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="muted">
                        {l(
                          "Belum ada peluang dengan perkiraan closing pada periode ini.",
                          "No opportunities with an expected closing date in this period.",
                        )}
                      </td>
                    </tr>
                  )}
                  {data.rows.map((r) => (
                    <tr key={r.userId ?? "none"}>
                      <td>{r.userName ?? l("(belum ditugaskan)", "(unassigned)")}</td>
                      {cells(r)}
                      <td className="num">
                        {edit?.userId === r.userId && r.userId ? (
                          <span className="filters">
                            <input
                              className="num"
                              inputMode="decimal"
                              style={{ width: 130 }}
                              aria-label={l("Forecast manajer", "Manager forecast")}
                              value={edit.amount}
                              onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
                            />
                            <button type="button" className="primary" onClick={saveAdjustment}>
                              {l("Simpan", "Save")}
                            </button>
                            <button type="button" className="link" onClick={() => setEdit(null)}>
                              {l("Batal", "Cancel")}
                            </button>
                          </span>
                        ) : (
                          <>
                            {m(r.adjusted)}{" "}
                            {canAdjust(r.userId) && (
                              <button
                                type="button"
                                className="link"
                                onClick={() =>
                                  setEdit({
                                    userId: r.userId!,
                                    amount: r.adjusted ? String(Number(r.adjusted)) : "",
                                    note: "",
                                  })
                                }
                              >
                                {l("Ubah", "Edit")}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>{l("Total", "Total")}</th>
                    {cells(data.total)}
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted">
              {l(
                "Closed = peluang menang pada periode. Commit, best case, dan pipeline = peluang terbuka dengan perkiraan closing pada periode, menurut kategori forecast tahap (bisa ditimpa per peluang).",
                "Closed = opportunities won in the period. Commit, best case and pipeline = open opportunities expected to close in the period, by the stage's forecast category (can be overridden per opportunity).",
              )}
            </p>
          </section>
          {data.teams.length > 0 && (
            <section className="panel">
              <h2>{l("Per tim", "By team")}</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{l("Tim", "Team")}</th>
                      <th className="num">{l("Kuota", "Quota")}</th>
                      <th className="num">Closed</th>
                      <th className="num">Commit</th>
                      <th className="num">Best case</th>
                      <th className="num">Pipeline</th>
                      <th className="num">{l("Forecast commit", "Commit forecast")}</th>
                      <th className="num">{l("Forecast best case", "Best-case forecast")}</th>
                      <th className="num">{l("Pencapaian", "Attainment")}</th>
                      <th className="num">{l("Kurang dari kuota", "Gap to quota")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teams.map((t) => (
                      <tr key={t.teamId}>
                        <td>{t.teamName}</td>
                        {cells(t)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
